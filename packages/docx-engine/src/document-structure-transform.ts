import type {
  DocxDocumentLayoutPlan
} from "@morphdoc/core";
import type {
  DocxSlotStyleToken,
  DocxThemeTokenSet
} from "@morphdoc/docx-theme-engine";
import {
  DRAWING_NAMESPACE,
  WORD_NAMESPACE,
  appendElement,
  colorValue,
  directChildren,
  ensureDirectElement,
  firstDirectChild,
  parseXmlPart,
  removeDirectChildren,
  serializeXmlPart,
  wordCharacterSpacingTwips,
  type XmlDocument,
  type XmlElement
} from "./ooxml.js";
import type {
  PandocStructureBlock,
  PandocStructureContainer,
  PandocStructurePlan,
  PandocStructureSectionBreak
} from "./pandoc-structure.js";
import type { PandocMediaLayoutItem } from "./pandoc-media.js";
import {
  readGeneratedDocxPackage,
  writeGeneratedDocxPackage
} from "./reference-package.js";
import {
  createDocxTokenSlotMap,
  DOCX_SLOT_WORD_STYLE_BINDINGS,
  resolvePandocSyntaxStyleSlot,
  resolveTokenFonts
} from "./token-style-map.js";

type DocxBorderToken = NonNullable<
  NonNullable<DocxSlotStyleToken["borders"]>["top"]
>;

const WORDPROCESSING_DRAWING_NAMESPACE =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const MATH_NAMESPACE =
  "http://schemas.openxmlformats.org/officeDocument/2006/math";
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
// Chromium 预留 6pt；Word/WPS 的分节承载段落还需要额外分页保留量。
const COVER_PAGE_BREAK_SAFETY_PT = 6;
const COVER_CONTENT_CENTER_BIAS_PT = 1.5;
const OFFICE_END_OF_CELL_SAFETY_PT = 18;
const MAX_WORD_BORDER_WIDTH_PT = 12;
const OFFICE_PARAGRAPH_SHADING_HEIGHT_FACTOR = 1.25;

export interface GeneratedDocxStructureReport {
  containerCount: number;
  editableContainerTableCount: number;
  sectionCount: number;
  tableCount: number;
  pageBreakAfterCount: number;
  sectionPageFieldCount: number;
  spaceBetweenParagraphCount: number;
  mediaDrawingCount: number;
}

export interface FinalizedGeneratedDocx {
  content: Uint8Array;
  report: GeneratedDocxStructureReport;
}

interface ContainerDescriptor {
  container: PandocStructureContainer;
  followedBySection: boolean;
}

function setWordAttribute(
  element: XmlElement,
  localName: string,
  value: string
) {
  element.setAttributeNS(
    WORD_NAMESPACE,
    `w:${localName}`,
    value
  );
}

function wordAttribute(
  element: XmlElement,
  localName: string
) {
  return element.getAttributeNS(WORD_NAMESPACE, localName);
}

function ensureFirstElement(
  parent: XmlElement,
  localName: string,
  qualifiedName: string
) {
  const existing = firstDirectChild(
    parent,
    WORD_NAMESPACE,
    localName
  );
  if (existing) {
    return existing;
  }
  const element = parent.ownerDocument!.createElementNS(
    WORD_NAMESPACE,
    qualifiedName
  );
  parent.insertBefore(element, parent.firstChild);
  return element;
}

function paragraphProperties(paragraph: XmlElement) {
  return ensureFirstElement(paragraph, "pPr", "w:pPr");
}

function paragraphText(paragraph: XmlElement) {
  return Array.from(
    paragraph.getElementsByTagNameNS(WORD_NAMESPACE, "t")
  )
    .map((element) => element.textContent ?? "")
    .join("");
}

function paragraphInlineElements(paragraph: XmlElement) {
  return Array.from(
    paragraph.getElementsByTagNameNS(WORD_NAMESPACE, "*")
  ).filter((element) =>
    element.localName === "t" ||
    element.localName === "tab" ||
    element.localName === "br"
  );
}

function maximumTabsPerLine(paragraph: XmlElement) {
  let current = 0;
  let maximum = 0;
  for (const element of paragraphInlineElements(paragraph)) {
    if (element.localName === "tab") {
      current += 1;
      maximum = Math.max(maximum, current);
    } else if (element.localName === "br") {
      current = 0;
    }
  }
  return maximum;
}

function bodyElements(body: XmlElement) {
  return Array.from(body.childNodes).filter(
    (node): node is XmlElement => node.nodeType === 1
  );
}

function markerParagraph(
  body: XmlElement,
  marker: string
): XmlElement {
  const matches = bodyElements(body).filter(
    (element) =>
      element.namespaceURI === WORD_NAMESPACE &&
      element.localName === "p" &&
      paragraphText(element) === marker
  );
  if (matches.length !== 1) {
    throw new Error(
      `DOCX 结构标记数量无效：${marker}（${matches.length}）`
    );
  }
  return matches[0]!;
}

function flattenContainers(
  blocks: readonly PandocStructureBlock[]
): PandocStructureContainer[] {
  return blocks.flatMap((block) =>
    block.kind === "container"
      ? [block, ...flattenContainers(block.blocks)]
      : []
  );
}

function containerDescriptors(
  plan: PandocStructurePlan
): ContainerDescriptor[] {
  const descriptors: ContainerDescriptor[] = [];
  for (const blocks of [plan.prefix, plan.suffix]) {
    for (const [index, block] of blocks.entries()) {
      if (block.kind !== "container") {
        continue;
      }
      descriptors.push({
        container: block,
        followedBySection:
          blocks[index + 1]?.kind === "section-break"
      });
      for (const nested of flattenContainers(block.blocks)) {
        descriptors.push({
          container: nested,
          followedBySection: false
        });
      }
    }
  }
  return descriptors;
}

function sectionBreaks(
  blocks: readonly PandocStructureBlock[]
): PandocStructureSectionBreak[] {
  return blocks.flatMap((block) => {
    if (block.kind === "section-break") {
      return [block];
    }
    return block.kind === "container"
      ? sectionBreaks(block.blocks)
      : [];
  });
}

function toggleParagraphProperty(
  paragraph: XmlElement,
  localName: "keepLines" | "keepNext" | "pageBreakBefore",
  enabled: boolean
) {
  const properties = paragraphProperties(paragraph);
  removeDirectChildren(properties, WORD_NAMESPACE, localName);
  if (enabled) {
    appendElement(
      properties,
      WORD_NAMESPACE,
      `w:${localName}`
    );
  }
}

function appendPageBreak(paragraph: XmlElement): boolean {
  const existing = Array.from(
    paragraph.getElementsByTagNameNS(WORD_NAMESPACE, "br")
  ).some(
    (element) => wordAttribute(element, "type") === "page"
  );
  if (existing) {
    return false;
  }
  const run = appendElement(
    paragraph,
    WORD_NAMESPACE,
    "w:r"
  );
  appendElement(run, WORD_NAMESPACE, "w:br", {
    "w:type": "page"
  });
  return true;
}

function pointsToTwips(points: number) {
  return Math.round(points * 20);
}

function borderAttributes(
  border: DocxBorderToken,
  spacePt = 0
) {
  if (border.style === "none" || border.widthPt <= 0) {
    return {
      "w:val": "nil"
    };
  }
  return {
    "w:val": border.style,
    "w:sz": String(
      Math.max(2, Math.min(96, Math.round(border.widthPt * 8)))
    ),
    "w:space": String(
      Math.max(0, Math.min(31, Math.round(spacePt)))
    ),
    "w:color": colorValue(border.color)
  };
}

function applyContainerSpacing(
  paragraph: XmlElement,
  side: "before" | "after",
  points: number
) {
  if (points <= 0) {
    return;
  }
  const spacing = ensureDirectElement(
    paragraphProperties(paragraph),
    WORD_NAMESPACE,
    "w:spacing"
  );
  setWordAttribute(spacing, side, String(pointsToTwips(points)));
}

function containerHorizontalIndents(
  token: DocxSlotStyleToken,
  contentWidthTwips: number
) {
  let left = pointsToTwips(token.leftIndentPt ?? 0);
  let right = pointsToTwips(token.rightIndentPt ?? 0);
  if (
    token.widthPercent !== undefined &&
    token.widthPercent < 100
  ) {
    const unused = Math.round(
      contentWidthTwips * (1 - token.widthPercent / 100)
    );
    const leftPositioned = (token.leftIndentPt ?? 0) > 0.5;
    const rightPositioned = (token.rightIndentPt ?? 0) > 0.5;
    if (leftPositioned && rightPositioned) {
      left = Math.round(unused / 2);
      right = unused - left;
    } else if (leftPositioned) {
      left = unused;
      right = 0;
    } else {
      left = 0;
      right = unused;
    }
  }
  left += pointsToTwips(token.paddingPt?.left ?? 0);
  right += pointsToTwips(token.paddingPt?.right ?? 0);
  return { left, right };
}

function applyContainerToken(
  paragraphs: readonly XmlElement[],
  token: DocxSlotStyleToken | undefined,
  followedBySection: boolean,
  contentWidthTwips: number
) {
  if (!token || paragraphs.length === 0) {
    return 0;
  }
  for (const [index, paragraph] of paragraphs.entries()) {
    const properties = paragraphProperties(paragraph);
    const indents = containerHorizontalIndents(
      token,
      contentWidthTwips
    );
    if (indents.left > 0 || indents.right > 0) {
      const indentation = ensureDirectElement(
        properties,
        WORD_NAMESPACE,
        "w:ind"
      );
      setWordAttribute(indentation, "left", String(indents.left));
      setWordAttribute(indentation, "right", String(indents.right));
    }
    if (token.backgroundColor) {
      removeDirectChildren(properties, WORD_NAMESPACE, "shd");
      appendElement(properties, WORD_NAMESPACE, "w:shd", {
        "w:val": "clear",
        "w:color": "auto",
        "w:fill": colorValue(token.backgroundColor)
      });
    }
    if (token.borders) {
      const borders =
        firstDirectChild(properties, WORD_NAMESPACE, "pBdr") ??
        appendElement(properties, WORD_NAMESPACE, "w:pBdr");
      for (const side of ["left", "right"] as const) {
        removeDirectChildren(borders, WORD_NAMESPACE, side);
        const border = token.borders[side];
        if (border) {
          appendElement(
            borders,
            WORD_NAMESPACE,
            `w:${side}`,
            borderAttributes(
              border,
              token.paddingPt?.[side] ?? 0
            )
          );
        }
      }
      if (index === 0) {
        removeDirectChildren(borders, WORD_NAMESPACE, "top");
        if (token.borders.top) {
          appendElement(
            borders,
            WORD_NAMESPACE,
            "w:top",
            borderAttributes(
              token.borders.top,
              token.paddingPt?.top ?? 0
            )
          );
        }
      }
      if (index === paragraphs.length - 1) {
        removeDirectChildren(borders, WORD_NAMESPACE, "bottom");
        if (token.borders.bottom) {
          appendElement(
            borders,
            WORD_NAMESPACE,
            "w:bottom",
            borderAttributes(
              token.borders.bottom,
              token.paddingPt?.bottom ?? 0
            )
          );
        }
      }
    }
    if (token.keepLines) {
      toggleParagraphProperty(paragraph, "keepLines", true);
      if (index < paragraphs.length - 1) {
        toggleParagraphProperty(paragraph, "keepNext", true);
      }
    }
    if (token.keepWithNext) {
      toggleParagraphProperty(paragraph, "keepNext", true);
    }
    if (index === 0 && token.pageBreakBefore) {
      toggleParagraphProperty(
        paragraph,
        "pageBreakBefore",
        true
      );
    }
    if (index === 0) {
      applyContainerSpacing(
        paragraph,
        "before",
        (token.spacingBeforePt ?? 0) +
          (token.borders?.top ? 0 : token.paddingPt?.top ?? 0)
      );
    }
    if (index === paragraphs.length - 1) {
      applyContainerSpacing(
        paragraph,
        "after",
        (token.spacingAfterPt ?? 0) +
          (token.borders?.bottom
            ? 0
            : token.paddingPt?.bottom ?? 0)
      );
    }
  }
  return token.pageBreakAfter && !followedBySection
    ? Number(appendPageBreak(paragraphs.at(-1)!))
    : 0;
}

function appendCellMargin(
  cellMargins: XmlElement,
  side: "top" | "right" | "bottom" | "left",
  points: number
) {
  appendElement(cellMargins, WORD_NAMESPACE, `w:${side}`, {
    "w:w": String(pointsToTwips(points)),
    "w:type": "dxa"
  });
}

function estimatedParagraphWidthTwips(
  paragraph: XmlElement,
  token: DocxSlotStyleToken
) {
  const fontSizePt = token.fontSizePt ?? 12;
  const characters = Array.from(paragraphText(paragraph));
  const emWidth = characters.reduce((total, character) => {
    if (/\s/u.test(character)) {
      return total + 0.5;
    }
    if (/^[\u0000-\u024f]$/u.test(character)) {
      return total + 0.55;
    }
    return total + 1;
  }, 0);
  const letterSpacingPt =
    Math.max(0, characters.length - 1) *
    (token.letterSpacingPt ?? 0);
  return pointsToTwips(
    emWidth * fontSizePt +
      letterSpacingPt +
      Math.max(2, fontSizePt * 0.35)
  );
}

function applyDirectRunCharacterSpacing(
  paragraph: XmlElement,
  token: DocxSlotStyleToken
) {
  if (
    token.fontSizePt === undefined &&
    token.letterSpacingPt === undefined
  ) {
    return;
  }
  const spacingTwips = wordCharacterSpacingTwips(
    token.fontSizePt,
    token.letterSpacingPt ?? 0
  );
  for (const run of Array.from(
    paragraph.getElementsByTagNameNS(WORD_NAMESPACE, "r")
  )) {
    const properties = ensureFirstElement(run, "rPr", "w:rPr");
    if (firstDirectChild(properties, WORD_NAMESPACE, "rStyle")) {
      continue;
    }
    const spacing = ensureDirectElement(
      properties,
      WORD_NAMESPACE,
      "w:spacing"
    );
    setWordAttribute(spacing, "val", spacingTwips);
  }
}

function appendRightAlignedBoxContentInset(
  paragraph: XmlElement,
  token: DocxSlotStyleToken
) {
  const insetPt =
    (token.paddingPt?.right ?? 0) +
    (token.borders?.right?.widthPt ?? 0);
  if (insetPt <= 0.01) {
    return;
  }
  const run = appendElement(paragraph, WORD_NAMESPACE, "w:r");
  const properties = appendElement(run, WORD_NAMESPACE, "w:rPr");
  const halfPoints = Math.max(2, Math.round(insetPt * 2));
  appendElement(properties, WORD_NAMESPACE, "w:sz", {
    "w:val": String(halfPoints)
  });
  appendElement(properties, WORD_NAMESPACE, "w:szCs", {
    "w:val": String(halfPoints)
  });
  const text = appendElement(run, WORD_NAMESPACE, "w:t");
  text.setAttributeNS(XML_NAMESPACE, "xml:space", "preserve");
  // Word/WPS 的右对齐段落边框不会像 CSS 一样从文字末端扣除
  // padding/border。用字号等于盒模型右内缩的 em 空格保留可编辑文本，
  // 同时把文字内容推回与 Chromium 相同的内容盒。
  text.textContent = "\u00a0\u00a0";
}

function hasVisibleBorder(token: DocxSlotStyleToken) {
  return Object.values(token.borders ?? {}).some(
    (border) =>
      border && border.style !== "none" && border.widthPt > 0
  );
}

function paragraphVerticalMetrics(token: DocxSlotStyleToken) {
  const before =
    (token.spacingBeforePt ?? 0) +
    (token.borders?.top ? 0 : token.paddingPt?.top ?? 0);
  const after =
    (token.spacingAfterPt ?? 0) +
    (token.borders?.bottom ? 0 : token.paddingPt?.bottom ?? 0);
  const fixed =
    (token.fontSizePt ?? 12) * (token.lineSpacing ?? 1.2) +
    (token.borders?.top?.widthPt ?? 0) +
    (token.borders?.bottom?.widthPt ?? 0);
  return { before, after, fixed };
}

function constrainContainerParagraphSpacing(
  paragraphs: readonly XmlElement[],
  paragraphTokens: ReadonlyMap<string, DocxSlotStyleToken>,
  availableHeightPt: number
) {
  const entries = paragraphs.flatMap((paragraph) => {
    const styleId = paragraphStyleId(paragraph);
    const token = styleId ? paragraphTokens.get(styleId) : undefined;
    return token
      ? [{ paragraph, metrics: paragraphVerticalMetrics(token) }]
      : [];
  });
  const fixedHeightPt = entries.reduce(
    (total, entry) => total + entry.metrics.fixed,
    0
  );
  const spacingHeightPt = entries.reduce(
    (total, entry) =>
      total + entry.metrics.before + entry.metrics.after,
    0
  );
  const spacingScale =
    spacingHeightPt > 0
      ? Math.min(
          1,
          Math.max(0, availableHeightPt - fixedHeightPt) /
            spacingHeightPt
        )
      : 1;
  for (const entry of entries) {
    const spacing = ensureDirectElement(
      paragraphProperties(entry.paragraph),
      WORD_NAMESPACE,
      "w:spacing"
    );
    setWordAttribute(
      spacing,
      "before",
      String(pointsToTwips(entry.metrics.before * spacingScale))
    );
    setWordAttribute(
      spacing,
      "after",
      String(pointsToTwips(entry.metrics.after * spacingScale))
    );
  }
}

function appendConstrainedSpacerParagraph(
  cell: XmlElement,
  heightPt: number,
  spacerColor: string
) {
  if (heightPt <= 0.01) {
    return;
  }
  const spacer = appendElement(cell, WORD_NAMESPACE, "w:p");
  const spacerProperties = appendElement(
    spacer,
    WORD_NAMESPACE,
    "w:pPr"
  );
  appendElement(spacerProperties, WORD_NAMESPACE, "w:spacing", {
    "w:before": "0",
    "w:after": "0",
    "w:line": String(Math.max(1, pointsToTwips(heightPt))),
    "w:lineRule": "exact"
  });
  const spacerRun = appendElement(spacer, WORD_NAMESPACE, "w:r");
  const spacerRunProperties = appendElement(
    spacerRun,
    WORD_NAMESPACE,
    "w:rPr"
  );
  appendElement(spacerRunProperties, WORD_NAMESPACE, "w:sz", {
    "w:val": "2"
  });
  appendElement(spacerRunProperties, WORD_NAMESPACE, "w:szCs", {
    "w:val": "2"
  });
  appendElement(spacerRunProperties, WORD_NAMESPACE, "w:color", {
    "w:val": spacerColor
  });
  const spacerText = appendElement(spacerRun, WORD_NAMESPACE, "w:t");
  spacerText.textContent = ".";
}

function distinctLayoutSpacerColor(backgroundColor: string) {
  const numeric = Number.parseInt(backgroundColor, 16);
  if (!Number.isFinite(numeric)) {
    return "FFFFFE";
  }
  return (numeric ^ 1).toString(16).toUpperCase().padStart(6, "0");
}

function appendContainerDecorationParagraph(
  cell: XmlElement,
  heightPt: number,
  color: string
) {
  const paragraph = appendElement(cell, WORD_NAMESPACE, "w:p");
  const properties = appendElement(paragraph, WORD_NAMESPACE, "w:pPr");
  appendElement(properties, WORD_NAMESPACE, "w:spacing", {
    "w:before": "0",
    "w:after": "0",
    "w:line": String(pointsToTwips(heightPt)),
    "w:lineRule": "exact"
  });
  appendElement(properties, WORD_NAMESPACE, "w:shd", {
    "w:val": "clear",
    "w:color": "auto",
    "w:fill": color
  });
  const run = appendElement(paragraph, WORD_NAMESPACE, "w:r");
  const runProperties = appendElement(run, WORD_NAMESPACE, "w:rPr");
  appendElement(runProperties, WORD_NAMESPACE, "w:color", {
    "w:val": color
  });
  appendElement(runProperties, WORD_NAMESPACE, "w:sz", {
    "w:val": "2"
  });
  appendElement(runProperties, WORD_NAMESPACE, "w:szCs", {
    "w:val": "2"
  });
  const text = appendElement(run, WORD_NAMESPACE, "w:t");
  text.textContent = ".";
}

function createConstrainedContainerLayout(
  rowToReplace: XmlElement,
  elements: readonly XmlElement[],
  paragraphTokens: ReadonlyMap<string, DocxSlotStyleToken>,
  availableHeightPt: number,
  verticalInsets: {
    topPt: number;
    bottomPt: number;
    borderPt: number;
    flowStartSafetyPt: number;
    centerBiasPt: number;
    preserveTerminalSafety?: boolean;
    topDecoration?: { heightPt: number; color: string };
    bottomDecoration?: { heightPt: number; color: string };
  },
  spacerColor: string
) {
  const entries = elements.flatMap((element) => {
    if (
      element.namespaceURI !== WORD_NAMESPACE ||
      element.localName !== "p"
    ) {
      return [];
    }
    const styleId = paragraphStyleId(element);
    const token = styleId ? paragraphTokens.get(styleId) : undefined;
    return token
      ? [{ paragraph: element, metrics: paragraphVerticalMetrics(token) }]
      : [];
  });
  if (entries.length !== elements.length || entries.length === 0) {
    return false;
  }
  const fixedHeightPt = entries.reduce(
    (total, entry) => total + entry.metrics.fixed,
    0
  );
  const spacingHeightPt = entries.reduce(
    (total, entry) =>
      total + entry.metrics.before + entry.metrics.after,
    0
  );
  const terminalHeightPt = Math.min(
    OFFICE_END_OF_CELL_SAFETY_PT,
    entries.at(-1)!.metrics.fixed
  );
  const usableHeightPt = Math.max(
    1,
    availableHeightPt -
      verticalInsets.topPt -
      verticalInsets.bottomPt -
      verticalInsets.borderPt -
      verticalInsets.flowStartSafetyPt -
      (verticalInsets.topDecoration?.heightPt ?? 0) -
      (verticalInsets.bottomDecoration?.heightPt ?? 0) -
      terminalHeightPt
  );
  const hasParagraphDecoration = Boolean(
    verticalInsets.topDecoration || verticalInsets.bottomDecoration
  );
  const spacingBudgetHeightPt =
    usableHeightPt +
    (hasParagraphDecoration || verticalInsets.preserveTerminalSafety
      ? 0
      : terminalHeightPt);
  const spacingScale =
    spacingHeightPt > 0
      ? Math.min(
          1,
          Math.max(0, spacingBudgetHeightPt - fixedHeightPt) /
            spacingHeightPt
        )
      : 1;
  const usedHeightPt =
    fixedHeightPt + spacingHeightPt * spacingScale;
  const centeredLeadingHeightPt = Math.max(
    0,
    (usableHeightPt - usedHeightPt) / 2
  );
  const leadingHeightPt =
    verticalInsets.topPt +
    verticalInsets.flowStartSafetyPt +
    centeredLeadingHeightPt +
    verticalInsets.centerBiasPt;
  const cell = firstDirectChild(
    rowToReplace,
    WORD_NAMESPACE,
    "tc"
  );
  if (!cell) {
    return false;
  }
  if (verticalInsets.topDecoration) {
    appendContainerDecorationParagraph(
      cell,
      verticalInsets.topDecoration.heightPt,
      verticalInsets.topDecoration.color
    );
  }
  appendConstrainedSpacerParagraph(cell, leadingHeightPt, spacerColor);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const beforeHeightPt =
      index === 0
        ? entry.metrics.before * spacingScale
        : (entries[index - 1]!.metrics.after +
            entry.metrics.before) *
          spacingScale;
    appendConstrainedSpacerParagraph(cell, beforeHeightPt, spacerColor);
    const properties = paragraphProperties(entry.paragraph);
    const spacing = ensureDirectElement(
      properties,
      WORD_NAMESPACE,
      "w:spacing"
    );
    setWordAttribute(spacing, "before", "0");
    setWordAttribute(spacing, "after", "0");
    cell.appendChild(entry.paragraph);
  }
  const trailingHeightPt =
    Math.max(
      0,
      entries.at(-1)!.metrics.after * spacingScale +
        verticalInsets.bottomPt +
        centeredLeadingHeightPt -
        verticalInsets.centerBiasPt
    );
  appendConstrainedSpacerParagraph(cell, trailingHeightPt, spacerColor);
  if (verticalInsets.bottomDecoration) {
    appendContainerDecorationParagraph(
      cell,
      verticalInsets.bottomDecoration.heightPt,
      verticalInsets.bottomDecoration.color
    );
  }
  return true;
}

function createEditableContainerTable(
  body: XmlElement,
  start: XmlElement,
  end: XmlElement,
  elements: readonly XmlElement[],
  token: DocxSlotStyleToken,
  contentWidthTwips: number,
  contentHeightTwips: number,
  paragraphTokens: ReadonlyMap<string, DocxSlotStyleToken>
) {
  const document = body.ownerDocument!;
  const widthPercent = token.widthPercent ?? 100;
  const outlineInsetPt = token.outline
    ? Math.max(0, -(token.outlineOffsetPt ?? 0))
    : 0;
  const outlineCellSpacingPt = outlineInsetPt / 2;
  const tableWidth = Math.max(
    1,
    Math.round((contentWidthTwips * widthPercent) / 100)
  );
  const table = document.createElementNS(WORD_NAMESPACE, "w:tbl");
  const topDecorationPt =
    (token.borders?.top?.widthPt ?? 0) > MAX_WORD_BORDER_WIDTH_PT
      ? token.borders!.top!.widthPt
      : 0;
  const bottomDecorationPt =
    (token.borders?.bottom?.widthPt ?? 0) > MAX_WORD_BORDER_WIDTH_PT
      ? token.borders!.bottom!.widthPt
      : 0;
  const tableProperties = appendElement(
    table,
    WORD_NAMESPACE,
    "w:tblPr"
  );
  appendElement(tableProperties, WORD_NAMESPACE, "w:tblW", {
    "w:w": String(tableWidth),
    "w:type": "dxa"
  });
  appendElement(tableProperties, WORD_NAMESPACE, "w:tblInd", {
    "w:w": String(
      pointsToTwips(
        (token.leftIndentPt ?? 0) +
          outlineInsetPt +
          (token.outline ? token.borders?.left?.widthPt ?? 0 : 0)
      )
    ),
    "w:type": "dxa"
  });
  appendElement(tableProperties, WORD_NAMESPACE, "w:tblLayout", {
    "w:type": "fixed"
  });
  if (outlineCellSpacingPt > 0) {
    appendElement(tableProperties, WORD_NAMESPACE, "w:tblCellSpacing", {
      "w:w": String(pointsToTwips(outlineCellSpacingPt)),
      "w:type": "dxa"
    });
  }
  appendElement(tableProperties, WORD_NAMESPACE, "w:tblLook", {
    "w:val": "0000",
    "w:firstRow": "0",
    "w:lastRow": "0",
    "w:firstColumn": "0",
    "w:lastColumn": "0",
    "w:noHBand": "1",
    "w:noVBand": "1"
  });
  if (widthPercent < 100) {
    appendElement(tableProperties, WORD_NAMESPACE, "w:jc", {
      "w:val": "center"
    });
  }
  const borders = appendElement(
    tableProperties,
    WORD_NAMESPACE,
    "w:tblBorders"
  );
  for (const side of [
    "top",
    "left",
    "bottom",
    "right",
    "insideH",
    "insideV"
  ] as const) {
    const border =
      side === "insideH" || side === "insideV"
        ? undefined
        : side === "top" && topDecorationPt > 0
          ? undefined
          : side === "bottom" && bottomDecorationPt > 0
            ? undefined
            : token.borders?.[side];
    appendElement(
      borders,
      WORD_NAMESPACE,
      `w:${side}`,
      border ? borderAttributes(border) : { "w:val": "nil" }
    );
  }
  const grid = appendElement(table, WORD_NAMESPACE, "w:tblGrid");
  appendElement(grid, WORD_NAMESPACE, "w:gridCol", {
    "w:w": String(tableWidth)
  });
  const row = appendElement(table, WORD_NAMESPACE, "w:tr");
  const rowProperties = appendElement(
    row,
    WORD_NAMESPACE,
    "w:trPr"
  );
  appendElement(rowProperties, WORD_NAMESPACE, "w:cantSplit");
  let contentMinimumHeightPt: number | undefined;
  let minimumHeightWasBounded = false;
  let collapsesVerticalPadding = false;
  if (token.minimumHeightPt !== undefined) {
    // A semantic cover followed by its own section must use an exact row:
    // Word honors atLeast rows while WPS collapses them to content height.
    // Preserve a theme's shorter cover box, and only cap oversized boxes to
    // the physical page content area.
    collapsesVerticalPadding = true;
    const boundedMinimumHeightPt = Math.min(
      token.minimumHeightPt,
      Math.max(1, contentHeightTwips / 20 - COVER_PAGE_BREAK_SAFETY_PT)
    );
    minimumHeightWasBounded = boundedMinimumHeightPt < token.minimumHeightPt;
    const renderedMinimumHeightPt = Math.max(
      1,
      boundedMinimumHeightPt - outlineInsetPt
    );
    const verticalPaddingPt =
      collapsesVerticalPadding
        ? 0
        : (token.paddingPt?.top ?? 0) +
          (token.paddingPt?.bottom ?? 0);
    const verticalBorderPt =
      (token.borders?.top?.widthPt ?? 0) +
      (token.borders?.bottom?.widthPt ?? 0);
    contentMinimumHeightPt = Math.max(
      1,
      renderedMinimumHeightPt - verticalPaddingPt - verticalBorderPt
    );
    appendElement(rowProperties, WORD_NAMESPACE, "w:trHeight", {
      "w:val": String(
        pointsToTwips(
          collapsesVerticalPadding
            ? renderedMinimumHeightPt
            : contentMinimumHeightPt
        )
      ),
      "w:hRule": collapsesVerticalPadding ? "exact" : "atLeast"
    });
    if (collapsesVerticalPadding) {
      contentMinimumHeightPt = renderedMinimumHeightPt;
    }
  }
  const cell = appendElement(row, WORD_NAMESPACE, "w:tc");
  const cellProperties = appendElement(
    cell,
    WORD_NAMESPACE,
    "w:tcPr"
  );
  appendElement(cellProperties, WORD_NAMESPACE, "w:tcW", {
    "w:w": String(tableWidth),
    "w:type": "dxa"
  });
  if (token.verticalAlignment) {
    appendElement(cellProperties, WORD_NAMESPACE, "w:vAlign", {
      "w:val": collapsesVerticalPadding ? "top" : token.verticalAlignment
    });
  }
  if (token.backgroundColor) {
    appendElement(cellProperties, WORD_NAMESPACE, "w:shd", {
      "w:val": "clear",
      "w:color": "auto",
      "w:fill": colorValue(token.backgroundColor)
    });
  }
  if (token.outline) {
    const cellBorders = appendElement(
      cellProperties,
      WORD_NAMESPACE,
      "w:tcBorders"
    );
    for (const side of ["top", "left", "bottom", "right"] as const) {
      appendElement(
        cellBorders,
        WORD_NAMESPACE,
        `w:${side}`,
        borderAttributes(token.outline)
      );
    }
  }
  if (token.paddingPt) {
    const margins = appendElement(
      cellProperties,
      WORD_NAMESPACE,
      "w:tcMar"
    );
    for (const side of ["top", "right", "bottom", "left"] as const) {
      appendCellMargin(
        margins,
        side,
        collapsesVerticalPadding
          ? side === "left" || side === "right"
            ? 1
            : 0
          : Math.max(0, (token.paddingPt[side] ?? 0) - outlineInsetPt)
      );
    }
  }
  const innerWidthTwips = Math.max(
    1,
    tableWidth -
      pointsToTwips(token.paddingPt?.left ?? 0) -
      pointsToTwips(token.paddingPt?.right ?? 0) +
      pointsToTwips(outlineInsetPt * 2)
  );
  const childParagraphs = elements.filter(
    (element) =>
      element.namespaceURI === WORD_NAMESPACE &&
      element.localName === "p"
  );
  if (
    token.verticalAlignment &&
    contentMinimumHeightPt !== undefined &&
    !collapsesVerticalPadding
  ) {
    constrainContainerParagraphSpacing(
      childParagraphs,
      paragraphTokens,
      contentMinimumHeightPt
    );
  }
  for (const element of elements) {
    if (
      element.namespaceURI !== WORD_NAMESPACE ||
      element.localName !== "p"
    ) {
      continue;
    }
    const styleId = paragraphStyleId(element);
    const childToken = styleId
      ? paragraphTokens.get(styleId)
      : undefined;
    if (childToken) {
      applyDirectRunCharacterSpacing(element, childToken);
    }
  }
  for (const element of elements) {
      if (
        element.namespaceURI !== WORD_NAMESPACE ||
        element.localName !== "p"
      ) {
        continue;
      }
      const styleId = paragraphStyleId(element);
      const childToken = styleId
        ? paragraphTokens.get(styleId)
        : undefined;
      if (!childToken) {
        continue;
      }
      const childAlignment =
        childToken.selfAlignment ?? token.childAlignment;
      const properties = paragraphProperties(element);
      const containerLeftIndent = collapsesVerticalPadding
        ? pointsToTwips(
            Math.max(0, (token.paddingPt?.left ?? 0) - outlineInsetPt)
          )
        : 0;
      const containerRightIndent = collapsesVerticalPadding
        ? pointsToTwips(
            Math.max(0, (token.paddingPt?.right ?? 0) - outlineInsetPt)
          )
        : 0;
      if (!childAlignment || childAlignment === "stretch") {
        if (containerLeftIndent > 0 || containerRightIndent > 0) {
          const indentation = ensureDirectElement(
            properties,
            WORD_NAMESPACE,
            "w:ind"
          );
          setWordAttribute(indentation, "left", String(containerLeftIndent));
          setWordAttribute(indentation, "right", String(containerRightIndent));
        }
        continue;
      }
      for (const propertyName of ["autoSpaceDE", "autoSpaceDN"] as const) {
        const automaticSpacing = ensureDirectElement(
          properties,
          WORD_NAMESPACE,
          `w:${propertyName}`
        );
        setWordAttribute(automaticSpacing, "val", "0");
      }
      const minimumWidthPercent = childToken.minimumWidthPercent;
      const targetWidthTwips =
        minimumWidthPercent !== undefined
          ? Math.min(
              innerWidthTwips,
              Math.round(
                (innerWidthTwips * minimumWidthPercent) / 100
              ) +
                pointsToTwips(
                  (childToken.fontSizePt ?? 12) * 0.6
                )
            )
          : childToken.selfAlignment &&
              childToken.widthPercent !== undefined &&
              childToken.widthPercent < 100
            ? Math.min(
                innerWidthTwips,
                Math.max(
                  Math.round(
                    (innerWidthTwips * childToken.widthPercent) / 100
                  ) +
                    pointsToTwips(
                      (childToken.fontSizePt ?? 12) * 0.6
                    ),
                  estimatedParagraphWidthTwips(element, childToken) +
                    pointsToTwips(
                      (childToken.paddingPt?.left ?? 0) +
                        (childToken.paddingPt?.right ?? 0) +
                        (childToken.fontSizePt ?? 12)
                    )
                )
              )
          : hasVisibleBorder(childToken) || childToken.backgroundColor
            ? Math.min(
                innerWidthTwips,
                estimatedParagraphWidthTwips(element, childToken) +
                  pointsToTwips(
                    (childToken.paddingPt?.left ?? 0) +
                      (childToken.paddingPt?.right ?? 0) +
                      (childAlignment === "center"
                        ? childToken.fontSizePt ?? 12
                        : 0)
                  )
              )
            : undefined;
      if (targetWidthTwips === undefined) {
        if (containerLeftIndent > 0 || containerRightIndent > 0) {
          const indentation = ensureDirectElement(
            properties,
            WORD_NAMESPACE,
            "w:ind"
          );
          setWordAttribute(indentation, "left", String(containerLeftIndent));
          setWordAttribute(indentation, "right", String(containerRightIndent));
        }
        const justification = ensureDirectElement(
          properties,
          WORD_NAMESPACE,
          "w:jc"
        );
        setWordAttribute(
          justification,
          "val",
          childAlignment === "center"
            ? "center"
            : childAlignment
        );
        continue;
      }
      const unusedWidthTwips = Math.max(
        0,
        innerWidthTwips - targetWidthTwips
      );
      const leftIndent =
        childAlignment === "right"
          ? unusedWidthTwips
          : childAlignment === "center"
            ? Math.round(unusedWidthTwips / 2)
            : 0;
      const rightIndent = unusedWidthTwips - leftIndent;
      const indentation = ensureDirectElement(
        properties,
        WORD_NAMESPACE,
        "w:ind"
      );
      setWordAttribute(
        indentation,
        "left",
        String(containerLeftIndent + leftIndent)
      );
      setWordAttribute(
        indentation,
        "right",
        String(containerRightIndent + rightIndent)
      );
      if (minimumWidthPercent === undefined) {
        const justification = ensureDirectElement(
          properties,
          WORD_NAMESPACE,
          "w:jc"
        );
        setWordAttribute(
          justification,
          "val",
          childAlignment === "center"
            ? "center"
            : childAlignment
        );
      }
      if (
        childAlignment === "right" &&
        (hasVisibleBorder(childToken) || childToken.backgroundColor)
      ) {
        appendRightAlignedBoxContentInset(element, childToken);
      }
  }
  const usesConstrainedLayout =
    collapsesVerticalPadding &&
    contentMinimumHeightPt !== undefined &&
    createConstrainedContainerLayout(
      row,
      elements,
      paragraphTokens,
      Math.max(
        1,
        contentMinimumHeightPt -
          (minimumHeightWasBounded
            ? OFFICE_END_OF_CELL_SAFETY_PT -
              COVER_PAGE_BREAK_SAFETY_PT
            : 0)
      ),
      {
        topPt: Math.max(
          0,
          (token.paddingPt?.top ?? 0) - outlineInsetPt
        ),
        bottomPt: Math.max(
          0,
          (token.paddingPt?.bottom ?? 0) - outlineInsetPt
        ),
        borderPt:
          (topDecorationPt > 0 ? 0 : token.borders?.top?.widthPt ?? 0) +
          (bottomDecorationPt > 0
            ? 0
            : token.borders?.bottom?.widthPt ?? 0),
        // Tight landscape covers already account for a normal top border in
        // their padding budget. A roomier constrained cover with a strongly
        // asymmetric top border still needs the Office flow-start allowance;
        // otherwise its centered content crosses the 6pt cover tolerance.
        flowStartSafetyPt:
          minimumHeightWasBounded &&
          contentMinimumHeightPt >= 500 &&
          topDecorationPt === 0 &&
          (token.borders?.top?.widthPt ?? 0) >
            (token.borders?.bottom?.widthPt ?? 0) + 1
            ? token.borders?.top?.widthPt ?? 0
            : 0,
        centerBiasPt:
          COVER_CONTENT_CENTER_BIAS_PT +
          (topDecorationPt > 0 || bottomDecorationPt > 0 ? 3 : 0) -
          outlineInsetPt * 0.6 +
          (minimumHeightWasBounded && token.outline ? 3 : 0),
        // An inset outline is represented by a second editable cell border.
        // Keep the Office end-of-cell budget for that nested border instead
        // of releasing it back into compressed child spacing.
        preserveTerminalSafety: Boolean(token.outline),
        ...(topDecorationPt > 0
          ? {
              topDecoration: {
                heightPt:
                  topDecorationPt *
                  OFFICE_PARAGRAPH_SHADING_HEIGHT_FACTOR,
                color: colorValue(token.borders!.top!.color)
              }
            }
          : {}),
        ...(bottomDecorationPt > 0
          ? {
              bottomDecoration: {
                heightPt:
                  bottomDecorationPt *
                  OFFICE_PARAGRAPH_SHADING_HEIGHT_FACTOR,
                color: colorValue(token.borders!.bottom!.color)
              }
            }
          : {})
      },
      distinctLayoutSpacerColor(
        token.backgroundColor ? colorValue(token.backgroundColor) : "FFFFFF"
      )
    );
  if (!usesConstrainedLayout) {
    for (const element of elements) {
      cell.appendChild(element);
    }
  }
  body.insertBefore(table, start);
  body.removeChild(start);
  body.removeChild(end);
  return table;
}

function applyContainerRanges(
  body: XmlElement,
  plan: PandocStructurePlan,
  tokens: DocxThemeTokenSet,
  contentWidthTwips: number,
  contentHeightTwips: number
) {
  const slots = createDocxTokenSlotMap(tokens);
  const paragraphTokens = new Map<string, DocxSlotStyleToken>();
  for (const [slot, resolved] of slots) {
    for (const binding of DOCX_SLOT_WORD_STYLE_BINDINGS[slot] ?? []) {
      if (binding.type === "paragraph") {
        paragraphTokens.set(binding.styleId, resolved.style);
      }
    }
  }
  let pageBreakAfterCount = 0;
  let containerCount = 0;
  const editableContainerTables = new Set<XmlElement>();
  for (const descriptor of containerDescriptors(plan)) {
    const { container } = descriptor;
    const start = markerParagraph(body, container.startMarker);
    const end = markerParagraph(body, container.endMarker);
    const elements = bodyElements(body);
    const startIndex = elements.indexOf(start);
    const endIndex = elements.indexOf(end);
    if (startIndex < 0 || endIndex <= startIndex) {
      throw new Error(
        `DOCX 容器标记顺序无效：${container.startMarker}`
      );
    }
    const paragraphs = elements
      .slice(startIndex + 1, endIndex)
      .filter(
        (element) =>
          element.namespaceURI === WORD_NAMESPACE &&
          element.localName === "p"
      );
    const token = container.slot
      ? slots.get(container.slot)?.style
      : undefined;
    const usesEditableTable = Boolean(
      token &&
        descriptor.followedBySection &&
        token.minimumHeightPt !== undefined
    );
    if (usesEditableTable) {
      editableContainerTables.add(
        createEditableContainerTable(
          body,
          start,
          end,
          elements.slice(startIndex + 1, endIndex),
          token!,
          contentWidthTwips,
          contentHeightTwips,
          paragraphTokens
        )
      );
    } else {
      pageBreakAfterCount += applyContainerToken(
        paragraphs,
        token,
        descriptor.followedBySection,
        contentWidthTwips
      );
      body.removeChild(start);
      body.removeChild(end);
    }
    containerCount += 1;
  }
  return {
    containerCount,
    pageBreakAfterCount,
    editableContainerTables
  };
}

function finalSection(body: XmlElement) {
  const section = firstDirectChild(
    body,
    WORD_NAMESPACE,
    "sectPr"
  );
  if (!section) {
    throw new Error("DOCX 正文缺少最终节");
  }
  return section;
}

function paragraphStyleId(paragraph: XmlElement) {
  const properties = firstDirectChild(
    paragraph,
    WORD_NAMESPACE,
    "pPr"
  );
  const style = properties
    ? firstDirectChild(properties, WORD_NAMESPACE, "pStyle")
    : undefined;
  return style ? wordAttribute(style, "val") : undefined;
}

function spaceBetweenStyleIds(
  blocks: readonly PandocStructureBlock[]
): Set<string> {
  const result = new Set<string>();
  for (const block of blocks) {
    if (
      block.kind === "paragraph" &&
      block.layout === "space-between" &&
      block.styleId
    ) {
      result.add(block.styleId);
      continue;
    }
    if (block.kind === "container") {
      for (const styleId of spaceBetweenStyleIds(block.blocks)) {
        result.add(styleId);
      }
    }
  }
  return result;
}

function sectionContentWidthTwips(section: XmlElement) {
  const pageSize = firstDirectChild(
    section,
    WORD_NAMESPACE,
    "pgSz"
  );
  const margins = firstDirectChild(
    section,
    WORD_NAMESPACE,
    "pgMar"
  );
  const width = Number(pageSize && wordAttribute(pageSize, "w"));
  const left = Number(margins && wordAttribute(margins, "left"));
  const right = Number(margins && wordAttribute(margins, "right"));
  const contentWidth = width - left - right;
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) {
    throw new Error("DOCX 双端行无法解析页面内容区宽度");
  }
  return Math.round(contentWidth);
}

function sectionContentHeightTwips(section: XmlElement) {
  const pageSize = firstDirectChild(
    section,
    WORD_NAMESPACE,
    "pgSz"
  );
  const margins = firstDirectChild(
    section,
    WORD_NAMESPACE,
    "pgMar"
  );
  const height = Number(pageSize && wordAttribute(pageSize, "h"));
  const top = Number(margins && wordAttribute(margins, "top"));
  const bottom = Number(margins && wordAttribute(margins, "bottom"));
  const contentHeight = height - top - bottom;
  if (!Number.isFinite(contentHeight) || contentHeight <= 0) {
    throw new Error("DOCX 无法解析页面内容区高度");
  }
  return Math.round(contentHeight);
}

function applySpaceBetweenParagraphs(
  document: XmlDocument,
  section: XmlElement,
  plan: PandocStructurePlan,
  tokens: DocxThemeTokenSet
) {
  const styleIds = spaceBetweenStyleIds([
    ...plan.prefix,
    ...plan.suffix
  ]);
  if (styleIds.size === 0) {
    return 0;
  }
  const contentWidth = sectionContentWidthTwips(section);
  const tokenByStyleId = new Map<string, DocxSlotStyleToken>();
  for (const entry of tokens.slots) {
    for (const binding of
      DOCX_SLOT_WORD_STYLE_BINDINGS[entry.slot] ?? []) {
      if (binding.type === "paragraph") {
        tokenByStyleId.set(binding.styleId, entry.style);
      }
    }
  }
  let count = 0;
  for (const paragraph of Array.from(
    document.getElementsByTagNameNS(WORD_NAMESPACE, "p")
  )) {
    const styleId = paragraphStyleId(paragraph) ?? "";
    if (
      !styleIds.has(styleId) ||
      paragraph.getElementsByTagNameNS(WORD_NAMESPACE, "tab")
        .length === 0
    ) {
      continue;
    }
    const properties = paragraphProperties(paragraph);
    const directIndent = firstDirectChild(
      properties,
      WORD_NAMESPACE,
      "ind"
    );
    const token = tokenByStyleId.get(styleId);
    const tokenRightIndent = pointsToTwips(
      (token?.rightIndentPt ?? 0) +
        (token?.paddingPt?.right ?? 0)
    );
    const directRight = Number(
      directIndent && wordAttribute(directIndent, "right")
    );
    const rightIndent = Number.isFinite(directRight)
      ? directRight
      : tokenRightIndent;
    const position = Math.max(0, contentWidth - rightIndent);
    const tabCount = maximumTabsPerLine(paragraph);
    removeDirectChildren(properties, WORD_NAMESPACE, "tabs");
    const tabs = appendElement(
      properties,
      WORD_NAMESPACE,
      "w:tabs"
    );
    for (let tabIndex = 1; tabIndex <= tabCount; tabIndex += 1) {
      const terminal = tabIndex === tabCount;
      appendElement(tabs, WORD_NAMESPACE, "w:tab", {
        "w:val": terminal ? "right" : "center",
        "w:pos": String(
          terminal
            ? position
            : Math.round((position * tabIndex) / tabCount)
        )
      });
    }
    const justification = ensureDirectElement(
      properties,
      WORD_NAMESPACE,
      "w:jc"
    );
    setWordAttribute(justification, "val", "left");
    count += 1;
  }
  return count;
}

function setSectionPageNumber(
  section: XmlElement,
  start: number
) {
  removeDirectChildren(section, WORD_NAMESPACE, "pgNumType");
  const pageNumber = section.ownerDocument!.createElementNS(
    WORD_NAMESPACE,
    "w:pgNumType"
  );
  setWordAttribute(pageNumber, "start", String(start));
  const insertionPoint =
    firstDirectChild(section, WORD_NAMESPACE, "cols") ??
    firstDirectChild(section, WORD_NAMESPACE, "formProt") ??
    firstDirectChild(section, WORD_NAMESPACE, "vAlign") ??
    firstDirectChild(section, WORD_NAMESPACE, "titlePg");
  section.insertBefore(pageNumber, insertionPoint ?? null);
}

function applySections(
  body: XmlElement,
  plan: PandocStructurePlan,
  containerHandlesVerticalAlignment: boolean,
  usesEvenAndOddPages: boolean
) {
  const breaks = [
    ...sectionBreaks(plan.prefix),
    ...sectionBreaks(plan.suffix)
  ];
  if (breaks.length === 0) {
    return 0;
  }
  const followingSection = finalSection(body);
  for (const sectionBreak of breaks) {
    const marker = markerParagraph(body, sectionBreak.marker);
    const elements = bodyElements(body);
    const markerIndex = elements.indexOf(marker);
    const preceding = elements[markerIndex - 1];
    let previous =
      preceding?.namespaceURI === WORD_NAMESPACE &&
      preceding.localName === "p"
        ? preceding
        : undefined;
    let syntheticSectionCarrier = false;
    if (!previous) {
      previous = body.ownerDocument!.createElementNS(
        WORD_NAMESPACE,
        "w:p"
      );
      body.insertBefore(previous, marker);
      syntheticSectionCarrier = true;
    }
    const coverSection = followingSection.cloneNode(
      true
    ) as XmlElement;
    removeDirectChildren(
      coverSection,
      WORD_NAMESPACE,
      "headerReference",
      "footerReference",
      "pgNumType",
      "titlePg",
      "type",
      "vAlign"
    );
    const type = coverSection.ownerDocument!.createElementNS(
      WORD_NAMESPACE,
      "w:type"
    );
    setWordAttribute(type, "val", "nextPage");
    coverSection.insertBefore(
      type,
      firstDirectChild(coverSection, WORD_NAMESPACE, "pgSz") ??
        coverSection.firstChild
    );
    if (
      sectionBreak.verticalAlignment &&
      !containerHandlesVerticalAlignment
    ) {
      appendElement(coverSection, WORD_NAMESPACE, "w:vAlign", {
        "w:val": sectionBreak.verticalAlignment
      });
    }
    const properties = paragraphProperties(previous);
    if (syntheticSectionCarrier) {
      const spacing = ensureDirectElement(
        properties,
        WORD_NAMESPACE,
        "w:spacing"
      );
      setWordAttribute(spacing, "before", "0");
      setWordAttribute(spacing, "after", "0");
      setWordAttribute(spacing, "line", "1");
      setWordAttribute(spacing, "lineRule", "exact");
      const runProperties = ensureDirectElement(
        properties,
        WORD_NAMESPACE,
        "w:rPr"
      );
      appendElement(runProperties, WORD_NAMESPACE, "w:sz", {
        "w:val": "2"
      });
      appendElement(runProperties, WORD_NAMESPACE, "w:szCs", {
        "w:val": "2"
      });
    }
    removeDirectChildren(properties, WORD_NAMESPACE, "sectPr");
    properties.appendChild(coverSection);
    setSectionPageNumber(
      followingSection,
      sectionBreak.followingPageNumberStart +
        (usesEvenAndOddPages ? breaks.length : 0)
    );
    body.removeChild(marker);
  }
  return breaks.length;
}

function replaceSectionPageFields(
  entries: Map<string, Uint8Array>,
  enabled: boolean
) {
  if (!enabled) {
    return 0;
  }
  let count = 0;
  for (const [partName, content] of entries) {
    if (!/^word\/footer\d+\.xml$/u.test(partName)) {
      continue;
    }
    const document = parseXmlPart(content, partName);
    for (const instruction of Array.from(
      document.getElementsByTagNameNS(
        WORD_NAMESPACE,
        "instrText"
      )
    )) {
      const value = instruction.textContent ?? "";
      const replaced = value.replace(
        /\bNUMPAGES\b/gu,
        "SECTIONPAGES"
      );
      if (replaced === value) {
        continue;
      }
      while (instruction.firstChild) {
        instruction.removeChild(instruction.firstChild);
      }
      instruction.appendChild(
        instruction.ownerDocument!.createTextNode(replaced)
      );
      count += 1;
    }
    entries.set(partName, serializeXmlPart(document));
  }
  return count;
}

function normalizeGeneratedStyles(
  entries: Map<string, Uint8Array>
) {
  const partName = "word/styles.xml";
  const document = parseXmlPart(entries.get(partName)!, partName);
  const styles = document.documentElement;
  if (
    !styles ||
    styles.namespaceURI !== WORD_NAMESPACE ||
    styles.localName !== "styles"
  ) {
    throw new Error("word/styles.xml 的根元素无效");
  }
  const seenStyleIds = new Set<string>();
  for (const style of directChildren(
    styles,
    WORD_NAMESPACE,
    "style"
  )) {
    const styleId = wordAttribute(style, "styleId");
    if (!styleId || !seenStyleIds.has(styleId)) {
      if (styleId) {
        seenStyleIds.add(styleId);
      }
      continue;
    }
    styles.removeChild(style);
  }
  for (const alignment of Array.from(
    styles.getElementsByTagNameNS(WORD_NAMESPACE, "jc")
  )) {
    if (wordAttribute(alignment, "val") === "justify") {
      setWordAttribute(alignment, "val", "both");
    }
  }
  for (const style of directChildren(
    styles,
    WORD_NAMESPACE,
    "style"
  )) {
    if (wordAttribute(style, "type") !== "table") {
      continue;
    }
    const properties = firstDirectChild(
      style,
      WORD_NAMESPACE,
      "tblPr"
    );
    if (properties) {
      removeDirectChildren(properties, WORD_NAMESPACE, "tblW");
    }
  }
  entries.set(partName, serializeXmlPart(document));
}

function applyListNumberingIndents(
  entries: Map<string, Uint8Array>,
  tokens: DocxThemeTokenSet
) {
  const partName = "word/numbering.xml";
  const content = entries.get(partName);
  if (!content) {
    return;
  }
  const slots = createDocxTokenSlotMap(tokens);
  const unordered = slots.get("unordered-list")?.style;
  const ordered = slots.get("ordered-list")?.style;
  const document = parseXmlPart(content, partName);
  for (const abstractNumbering of Array.from(
    document.getElementsByTagNameNS(WORD_NAMESPACE, "abstractNum")
  )) {
    const levels = directChildren(
      abstractNumbering,
      WORD_NAMESPACE,
      "lvl"
    );
    const firstLevel = levels.find(
      (level) => wordAttribute(level, "ilvl") === "0"
    );
    if (!firstLevel) {
      continue;
    }
    const numberFormat = firstDirectChild(
      firstLevel,
      WORD_NAMESPACE,
      "numFmt"
    );
    const token =
      wordAttribute(numberFormat ?? firstLevel, "val") === "bullet"
        ? unordered
        : ordered;
    if (!token) {
      continue;
    }
    const targetLeftPt =
      (token.leftIndentPt ?? 0) +
      (token.paddingPt?.left ?? 0) +
      (token.borders?.left?.widthPt ?? 0);
    if (targetLeftPt <= 0) {
      continue;
    }
    const firstProperties = firstDirectChild(
      firstLevel,
      WORD_NAMESPACE,
      "pPr"
    );
    const firstIndent = firstProperties
      ? firstDirectChild(firstProperties, WORD_NAMESPACE, "ind")
      : undefined;
    const originalFirstLeft = Number(
      firstIndent && wordAttribute(firstIndent, "left")
    );
    const originalFirstHanging = Number(
      firstIndent && wordAttribute(firstIndent, "hanging")
    );
    if (
      !Number.isFinite(originalFirstLeft) ||
      !Number.isFinite(originalFirstHanging)
    ) {
      continue;
    }
    const shift =
      Math.max(
        pointsToTwips(targetLeftPt),
        originalFirstHanging
      ) -
      originalFirstLeft;
    for (const level of levels) {
      const properties = firstDirectChild(
        level,
        WORD_NAMESPACE,
        "pPr"
      );
      const indentation = properties
        ? firstDirectChild(properties, WORD_NAMESPACE, "ind")
        : undefined;
      const originalLeft = Number(
        indentation && wordAttribute(indentation, "left")
      );
      if (!indentation || !Number.isFinite(originalLeft)) {
        continue;
      }
      setWordAttribute(
        indentation,
        "left",
        String(Math.max(0, Math.round(originalLeft + shift)))
      );
    }
  }
  entries.set(partName, serializeXmlPart(document));
}

function sectionContentWidth(section: XmlElement) {
  const pageSize = firstDirectChild(
    section,
    WORD_NAMESPACE,
    "pgSz"
  );
  const margins = firstDirectChild(
    section,
    WORD_NAMESPACE,
    "pgMar"
  );
  const width = Number(pageSize && wordAttribute(pageSize, "w"));
  const left = Number(margins && wordAttribute(margins, "left"));
  const right = Number(margins && wordAttribute(margins, "right"));
  const contentWidth = width - left - right;
  if (
    !Number.isFinite(contentWidth) ||
    contentWidth <= 0
  ) {
    throw new Error("DOCX 内容区宽度无效");
  }
  return Math.round(contentWidth);
}

function applyDirectRunProperties(
  run: XmlElement,
  token: DocxSlotStyleToken,
  includeBackground: boolean,
  includePaddingBox = false,
  eastAsiaFallback?: string
) {
  const namedFont = token.fontCandidates.find(
    (candidate) =>
      !/^(?:serif|sans-serif|monospace|system-ui)$/iu.test(candidate)
  ) ?? "Arial";
  const fonts = resolveTokenFonts(token, {
    latin: namedFont,
    eastAsia: eastAsiaFallback ?? namedFont,
    complexScript: namedFont
  }, {
    preserveFallbackEastAsia: eastAsiaFallback !== undefined
  });
  const properties = ensureFirstElement(run, "rPr", "w:rPr");
  removeDirectChildren(properties, WORD_NAMESPACE, "kern");
  appendElement(properties, WORD_NAMESPACE, "w:kern", {
    "w:val": "2"
  });
  if (token.fontCandidates.length > 0) {
    removeDirectChildren(properties, WORD_NAMESPACE, "rFonts");
    appendElement(properties, WORD_NAMESPACE, "w:rFonts", {
      "w:ascii": fonts.latin,
      "w:hAnsi": fonts.latin,
      "w:eastAsia": fonts.eastAsia,
      "w:cs": fonts.complexScript ?? fonts.latin
    });
  }
  if (token.fontSizePt !== undefined) {
    const halfPoints = String(Math.round(token.fontSizePt * 2));
    removeDirectChildren(properties, WORD_NAMESPACE, "sz", "szCs");
    appendElement(properties, WORD_NAMESPACE, "w:sz", {
      "w:val": halfPoints
    });
    appendElement(properties, WORD_NAMESPACE, "w:szCs", {
      "w:val": halfPoints
    });
  }
  if (token.color !== undefined) {
    removeDirectChildren(properties, WORD_NAMESPACE, "color");
    appendElement(properties, WORD_NAMESPACE, "w:color", {
      "w:val": colorValue(token.color)
    });
  }
  if (includeBackground && token.backgroundColor !== undefined) {
    removeDirectChildren(properties, WORD_NAMESPACE, "shd");
    appendElement(properties, WORD_NAMESPACE, "w:shd", {
      "w:val": "clear",
      "w:color": "auto",
      "w:fill": colorValue(token.backgroundColor)
    });
  }
  if (
    includePaddingBox &&
    token.backgroundColor !== undefined &&
    token.paddingPt !== undefined
  ) {
    const horizontalPaddingPt = Math.max(
      token.paddingPt.left,
      token.paddingPt.right
    );
    if (horizontalPaddingPt > 0) {
      removeDirectChildren(properties, WORD_NAMESPACE, "bdr");
      appendElement(properties, WORD_NAMESPACE, "w:bdr", {
        "w:val": "single",
        "w:sz": String(
          Math.max(2, Math.min(96, Math.round(horizontalPaddingPt * 8)))
        ),
        "w:space": "0",
        "w:color": colorValue(token.backgroundColor)
      });
    }
  }
  for (const [property, enabled] of [
    ["b", token.bold],
    ["bCs", token.bold],
    ["i", token.italic],
    ["iCs", token.italic],
    ["strike", token.strikethrough]
  ] as const) {
    if (enabled === undefined) {
      continue;
    }
    removeDirectChildren(properties, WORD_NAMESPACE, property);
    appendElement(
      properties,
      WORD_NAMESPACE,
      `w:${property}`,
      enabled ? {} : { "w:val": "0" }
    );
  }
  if (token.underline !== undefined) {
    removeDirectChildren(properties, WORD_NAMESPACE, "u");
    appendElement(properties, WORD_NAMESPACE, "w:u", {
      "w:val": token.underline ? "single" : "none"
    });
  }
  if (
    token.fontSizePt !== undefined ||
    token.letterSpacingPt !== undefined
  ) {
    const spacing = ensureDirectElement(
      properties,
      WORD_NAMESPACE,
      "w:spacing"
    );
    setWordAttribute(
      spacing,
      "val",
      wordCharacterSpacingTwips(
        token.fontSizePt,
        token.letterSpacingPt ?? 0
      )
    );
  }
}

function applyDirectRunToken(
  paragraph: XmlElement,
  token: DocxSlotStyleToken
) {
  for (const run of Array.from(
    paragraph.getElementsByTagNameNS(WORD_NAMESPACE, "r")
  )) {
    const properties = ensureFirstElement(run, "rPr", "w:rPr");
    if (firstDirectChild(properties, WORD_NAMESPACE, "rStyle")) {
      continue;
    }
    applyDirectRunProperties(run, token, false);
  }
}

function applyDirectCharacterStyleTokens(
  document: XmlDocument,
  tokens: DocxThemeTokenSet,
  documentLayout: DocxDocumentLayoutPlan
) {
  const slots = createDocxTokenSlotMap(tokens);
  const bodyEastAsiaFont = resolveTokenFonts(
    slots.get("paragraph")?.style ?? slots.get("document")?.style,
    { latin: "Arial", eastAsia: "Arial", complexScript: "Arial" }
  ).eastAsia;
  const tokenByStyleId = new Map<string, DocxSlotStyleToken>();
  for (const entry of tokens.slots) {
    for (const binding of
      DOCX_SLOT_WORD_STYLE_BINDINGS[entry.slot] ?? []) {
      if (binding.type === "character") {
        tokenByStyleId.set(binding.styleId, entry.style);
      }
    }
  }
  const inlineCodeLayouts = documentLayout.inlineCodes ?? [];
  let inlineCodeCursor = 0;
  let count = 0;
  const runs = Array.from(
    document.getElementsByTagNameNS(WORD_NAMESPACE, "r")
  );
  for (const [runIndex, run] of runs.entries()) {
    const properties = firstDirectChild(
      run,
      WORD_NAMESPACE,
      "rPr"
    );
    const runStyle = properties
      ? firstDirectChild(properties, WORD_NAMESPACE, "rStyle")
      : undefined;
    const styleId = runStyle
      ? wordAttribute(runStyle, "val")
      : undefined;
    let paragraph = run.parentNode;
    while (
      paragraph &&
      !(
        paragraph.nodeType === 1 &&
        (paragraph as XmlElement).namespaceURI === WORD_NAMESPACE &&
        (paragraph as XmlElement).localName === "p"
      )
    ) {
      paragraph = paragraph.parentNode;
    }
    const paragraphElement = paragraph as XmlElement | null;
    const paragraphProperties = paragraphElement
      ? firstDirectChild(paragraphElement, WORD_NAMESPACE, "pPr")
      : undefined;
    const paragraphStyle = paragraphProperties
      ? firstDirectChild(paragraphProperties, WORD_NAMESPACE, "pStyle")
      : undefined;
    const isSourceCode = paragraphStyle
      ? wordAttribute(paragraphStyle, "val") === "SourceCode"
      : false;
    const previousRun = runs[runIndex - 1];
    const nextRun = runs[runIndex + 1];
    const isHtmlTagName =
      isSourceCode &&
      styleId === "KeywordTok" &&
      previousRun?.parentNode === run.parentNode &&
      nextRun?.parentNode === run.parentNode &&
      /^<\/?$/u.test(previousRun.textContent ?? "") &&
      /^\/?>$/u.test(nextRun.textContent ?? "");
    const isObjectPropertyKey =
      isSourceCode &&
      styleId === "NormalTok" &&
      nextRun?.parentNode === run.parentNode &&
      /^\s*:\s*$/u.test(nextRun.textContent ?? "");
    const syntaxSlot = isSourceCode && styleId
      ? resolvePandocSyntaxStyleSlot(
          styleId,
          run.textContent ?? "",
          {
            htmlTagName: isHtmlTagName,
            objectPropertyKey: isObjectPropertyKey
          }
        )
      : undefined;
    const token = isSourceCode
      ? syntaxSlot
        ? slots.get(syntaxSlot)?.style ??
          slots.get("code-block-text")?.style
        : slots.get("code-block-text")?.style
      : styleId
        ? tokenByStyleId.get(styleId)
        : undefined;
    if (!token) {
      continue;
    }
    let effectiveToken = token;
    if (!isSourceCode && styleId === "VerbatimChar") {
      const normalizedText = (run.textContent ?? "").normalize("NFKC");
      const measuredIndex = inlineCodeLayouts.findIndex(
        (layout, index) =>
          index >= inlineCodeCursor && layout.text === normalizedText
      );
      if (measuredIndex >= 0) {
        const measured = inlineCodeLayouts[measuredIndex]!;
        inlineCodeCursor = measuredIndex + 1;
        effectiveToken = {
          ...token,
          fontSizePt: measured.fontSizePt,
          letterSpacingPt: measured.letterSpacingPt,
          color: measured.color,
          paddingPt: {
            top: measured.paddingPt.top + measured.borderPt.top,
            right: measured.paddingPt.right + measured.borderPt.right,
            bottom: measured.paddingPt.bottom + measured.borderPt.bottom,
            left: measured.paddingPt.left + measured.borderPt.left
          },
          ...(measured.backgroundColor
            ? { backgroundColor: measured.backgroundColor }
            : {})
        };
        if (!measured.backgroundColor) {
          delete effectiveToken.backgroundColor;
        }
      }
    }
    applyDirectRunProperties(
      run,
      effectiveToken,
      !isSourceCode,
      styleId === "VerbatimChar" && !isSourceCode,
      isSourceCode || styleId === "VerbatimChar"
        ? bodyEastAsiaFont
        : undefined
    );
    count += 1;
  }
  return count;
}

function applyMeasuredEmojiRunColors(
  document: XmlDocument,
  documentLayout: DocxDocumentLayoutPlan
) {
  const measuredRuns = documentLayout.emojiRuns ?? [];
  let cursor = 0;
  let count = 0;
  for (const run of Array.from(
    document.getElementsByTagNameNS(WORD_NAMESPACE, "r")
  )) {
    const text = (run.textContent ?? "").normalize("NFC").trim();
    if (!text) {
      continue;
    }
    const measuredIndex = measuredRuns.findIndex(
      (layout, index) => index >= cursor && layout.text === text
    );
    if (measuredIndex < 0) {
      continue;
    }
    cursor = measuredIndex + 1;
    const properties = ensureFirstElement(run, "rPr", "w:rPr");
    removeDirectChildren(properties, WORD_NAMESPACE, "color");
    appendElement(properties, WORD_NAMESPACE, "w:color", {
      "w:val": colorValue(measuredRuns[measuredIndex]!.color)
    });
    count += 1;
  }
  return count;
}

function applyTableCellToken(
  cell: XmlElement,
  token: DocxSlotStyleToken
) {
  const properties = ensureFirstElement(cell, "tcPr", "w:tcPr");
  if (token.paddingPt) {
    removeDirectChildren(properties, WORD_NAMESPACE, "tcMar");
    const margins = appendElement(
      properties,
      WORD_NAMESPACE,
      "w:tcMar"
    );
    for (const side of ["top", "right", "bottom", "left"] as const) {
      appendCellMargin(margins, side, token.paddingPt[side]);
    }
  }
  if (token.backgroundColor) {
    removeDirectChildren(properties, WORD_NAMESPACE, "shd");
    appendElement(properties, WORD_NAMESPACE, "w:shd", {
      "w:val": "clear",
      "w:color": "auto",
      "w:fill": colorValue(token.backgroundColor)
    });
  }
  if (token.borders) {
    removeDirectChildren(properties, WORD_NAMESPACE, "tcBorders");
    const borders = appendElement(
      properties,
      WORD_NAMESPACE,
      "w:tcBorders"
    );
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const border = token.borders[side];
      if (border) {
        appendElement(
          borders,
          WORD_NAMESPACE,
          `w:${side}`,
          borderAttributes(border, 0)
        );
      }
    }
  }
}

function measuredColumnWidths(
  tableWidthTwips: number,
  percentages: readonly number[]
) {
  const total = percentages.reduce((sum, value) => sum + value, 0);
  let allocated = 0;
  return percentages.map((percentage, index) => {
    const width = index === percentages.length - 1
      ? tableWidthTwips - allocated
      : Math.max(1, Math.round(tableWidthTwips * percentage / total));
    allocated += width;
    return width;
  });
}

function applyMeasuredTableGeometry(
  table: XmlElement,
  properties: XmlElement,
  layout: DocxDocumentLayoutPlan["tables"][number],
  contentWidthTwips: number,
  leadingCellInsetTwips: number
) {
  const indentTwips = Math.max(
    0,
    Math.round(contentWidthTwips * layout.leftOffsetPercent / 100) +
      leadingCellInsetTwips
  );
  const requestedTableWidthTwips = Math.max(
    1,
    Math.round(contentWidthTwips * layout.widthPercent / 100)
  );
  const tableWidthTwips = Math.max(
    1,
    Math.min(
      requestedTableWidthTwips,
      Math.max(1, contentWidthTwips - indentTwips)
    )
  );
  const columnWidths = measuredColumnWidths(
    tableWidthTwips,
    layout.columnWidthPercents
  );
  removeDirectChildren(
    properties,
    WORD_NAMESPACE,
    "tblW",
    "tblLayout",
    "tblInd"
  );
  appendElement(properties, WORD_NAMESPACE, "w:tblW", {
    "w:w": String(tableWidthTwips),
    "w:type": "dxa"
  });
  appendElement(properties, WORD_NAMESPACE, "w:tblInd", {
    "w:w": String(indentTwips),
    "w:type": "dxa"
  });
  appendElement(properties, WORD_NAMESPACE, "w:tblLayout", {
    "w:type": "fixed"
  });
  const grid = ensureFirstElement(table, "tblGrid", "w:tblGrid");
  removeDirectChildren(grid, WORD_NAMESPACE, "gridCol");
  for (const width of columnWidths) {
    appendElement(grid, WORD_NAMESPACE, "w:gridCol", {
      "w:w": String(width)
    });
  }
  for (const row of directChildren(table, WORD_NAMESPACE, "tr")) {
    let column = 0;
    for (const cell of directChildren(row, WORD_NAMESPACE, "tc")) {
      const cellProperties = ensureFirstElement(cell, "tcPr", "w:tcPr");
      const spanElement = firstDirectChild(
        cellProperties,
        WORD_NAMESPACE,
        "gridSpan"
      );
      const span = Math.max(
        1,
        Number(spanElement && wordAttribute(spanElement, "val")) || 1
      );
      const width = columnWidths
        .slice(column, column + span)
        .reduce((sum, value) => sum + value, 0);
      column += span;
      removeDirectChildren(cellProperties, WORD_NAMESPACE, "tcW");
      appendElement(cellProperties, WORD_NAMESPACE, "w:tcW", {
        "w:w": String(Math.max(1, width)),
        "w:type": "dxa"
      });
    }
  }
}

function applyTables(
  document: ReturnType<typeof parseXmlPart>,
  tokens: DocxThemeTokenSet,
  excludedTables: ReadonlySet<XmlElement> = new Set(),
  documentLayout: DocxDocumentLayoutPlan = { tables: [] },
  contentWidthTwips?: number
) {
  const slots = createDocxTokenSlotMap(tokens);
  const tableToken = slots.get("table")?.style;
  const tableCellToken =
    slots.get("table-cell")?.style ?? tableToken;
  const tableHeaderToken =
    slots.get("table-header")?.style ?? tableCellToken;
  const widthPercent = tableToken?.widthPercent ?? 100;
  const tables = Array.from(
    document.getElementsByTagNameNS(WORD_NAMESPACE, "tbl")
  ).filter((table) => !excludedTables.has(table));
  for (const [tableIndex, table] of tables.entries()) {
    const properties = ensureFirstElement(
      table,
      "tblPr",
      "w:tblPr"
    );
    const measuredLayout = documentLayout.tables[tableIndex];
    if (measuredLayout && contentWidthTwips) {
      applyMeasuredTableGeometry(
        table,
        properties,
        measuredLayout,
        contentWidthTwips,
        pointsToTwips(Math.max(
          tableCellToken?.paddingPt?.left ?? 0,
          tableHeaderToken?.paddingPt?.left ?? 0
        ))
      );
    } else {
      removeDirectChildren(
        properties,
        WORD_NAMESPACE,
        "tblW",
        "tblLayout"
      );
      appendElement(properties, WORD_NAMESPACE, "w:tblW", {
        "w:w": String(Math.round(widthPercent * 50)),
        "w:type": "pct"
      });
      appendElement(properties, WORD_NAMESPACE, "w:tblLayout", {
        "w:type": "autofit"
      });
    }

    for (const [rowIndex, row] of directChildren(
      table,
      WORD_NAMESPACE,
      "tr"
    ).entries()) {
      const rowProperties = firstDirectChild(
        row,
        WORD_NAMESPACE,
        "trPr"
      );
      const paragraphToken =
        rowProperties &&
        firstDirectChild(rowProperties, WORD_NAMESPACE, "tblHeader")
          ? tableHeaderToken
          : tableCellToken;
      const isHeaderRow = paragraphToken === tableHeaderToken &&
        tableHeaderToken !== undefined &&
        rowProperties !== undefined &&
        firstDirectChild(
          rowProperties,
          WORD_NAMESPACE,
          "tblHeader"
        ) !== undefined;
      if (tableToken?.keepLines) {
        const ensuredRowProperties = ensureFirstElement(
          row,
          "trPr",
          "w:trPr"
        );
        removeDirectChildren(
          ensuredRowProperties,
          WORD_NAMESPACE,
          "cantSplit"
        );
        appendElement(
          ensuredRowProperties,
          WORD_NAMESPACE,
          "w:cantSplit"
        );
      }
      for (const [cellIndex, cell] of directChildren(
        row,
        WORD_NAMESPACE,
        "tc"
      ).entries()) {
        const measuredCell = measuredLayout?.rows[rowIndex]?.cells[cellIndex];
        const effectiveParagraphToken = paragraphToken && measuredCell
          ? {
              ...paragraphToken,
              backgroundColor: measuredCell.backgroundColor,
              color: measuredCell.color,
              bold: measuredCell.bold,
              italic: measuredCell.italic,
              alignment: measuredCell.alignment
            }
          : paragraphToken;
        const cellProperties = ensureFirstElement(
          cell,
          "tcPr",
          "w:tcPr"
        );
        if (!measuredLayout) {
          removeDirectChildren(
            cellProperties,
            WORD_NAMESPACE,
            "tcW"
          );
          appendElement(
            cellProperties,
            WORD_NAMESPACE,
            "w:tcW",
            {
              "w:w": "0",
              "w:type": "auto"
            }
          );
        }
        if (effectiveParagraphToken) {
          applyTableCellToken(cell, effectiveParagraphToken);
        }
        if (isHeaderRow && tableHeaderToken?.backgroundColor) {
          removeDirectChildren(cellProperties, WORD_NAMESPACE, "shd");
          appendElement(cellProperties, WORD_NAMESPACE, "w:shd", {
            "w:val": "clear",
            "w:color": "auto",
            "w:fill": colorValue(tableHeaderToken.backgroundColor)
          });
        }
        if (effectiveParagraphToken) {
          for (const paragraph of directChildren(
            cell,
            WORD_NAMESPACE,
            "p"
          )) {
            const properties = paragraphProperties(paragraph);
            const wordWrap = ensureFirstElement(
              properties,
              "wordWrap",
              "w:wordWrap"
            );
            setWordAttribute(wordWrap, "val", "1");
            const spacing = ensureFirstElement(
              properties,
              "spacing",
              "w:spacing"
            );
            setWordAttribute(spacing, "before", "0");
            setWordAttribute(spacing, "after", "0");
            for (const property of ["autoSpaceDE", "autoSpaceDN"] as const) {
              const automaticSpacing = ensureFirstElement(
                properties,
                property,
                `w:${property}`
              );
              setWordAttribute(automaticSpacing, "val", "0");
            }
            if (
              effectiveParagraphToken.fontSizePt !== undefined &&
              effectiveParagraphToken.lineSpacing !== undefined
            ) {
              setWordAttribute(
                spacing,
                "line",
                String(
                  pointsToTwips(
                    effectiveParagraphToken.fontSizePt *
                      effectiveParagraphToken.lineSpacing
                  )
                )
              );
              setWordAttribute(spacing, "lineRule", "exact");
            }
            if (effectiveParagraphToken.alignment) {
              const alignment = ensureFirstElement(
                paragraphProperties(paragraph),
                "jc",
                "w:jc"
              );
              setWordAttribute(
                alignment,
                "val",
                effectiveParagraphToken.alignment === "justify"
                  ? "both"
                  : effectiveParagraphToken.alignment
              );
            }
            applyDirectRunToken(paragraph, effectiveParagraphToken);
          }
        }
      }
    }
  }
  return tables.length;
}

function normalizedLayoutText(value: string) {
  return value.replace(/\s+/gu, " ").trim().normalize("NFKC");
}

function collectNumberingHangingIndents(
  entries: ReadonlyMap<string, Uint8Array>
) {
  const content = entries.get("word/numbering.xml");
  const result = new Map<string, number>();
  if (!content) {
    return result;
  }
  const numbering = parseXmlPart(content, "word/numbering.xml");
  const abstractLevels = new Map<string, Map<string, number>>();
  for (const abstractNumbering of Array.from(
    numbering.getElementsByTagNameNS(WORD_NAMESPACE, "abstractNum")
  )) {
    const abstractId = wordAttribute(abstractNumbering, "abstractNumId");
    if (!abstractId) {
      continue;
    }
    const levels = new Map<string, number>();
    for (const level of directChildren(
      abstractNumbering,
      WORD_NAMESPACE,
      "lvl"
    )) {
      const levelId = wordAttribute(level, "ilvl") ?? "0";
      const properties = firstDirectChild(level, WORD_NAMESPACE, "pPr");
      const indentation = properties
        ? firstDirectChild(properties, WORD_NAMESPACE, "ind")
        : undefined;
      const hanging = Number(
        indentation && wordAttribute(indentation, "hanging")
      );
      if (Number.isFinite(hanging) && hanging >= 0) {
        levels.set(levelId, hanging);
      }
    }
    abstractLevels.set(abstractId, levels);
  }
  for (const number of Array.from(
    numbering.getElementsByTagNameNS(WORD_NAMESPACE, "num")
  )) {
    const numberId = wordAttribute(number, "numId");
    const abstractReference = firstDirectChild(
      number,
      WORD_NAMESPACE,
      "abstractNumId"
    );
    const levels = abstractLevels.get(
      wordAttribute(abstractReference ?? number, "val") ?? ""
    );
    if (!numberId || !levels) {
      continue;
    }
    for (const [levelId, hanging] of levels) {
      result.set(`${numberId}:${levelId}`, hanging);
    }
  }
  return result;
}

function applyMeasuredListItemIndents(
  document: XmlDocument,
  documentLayout: DocxDocumentLayoutPlan,
  hangingIndents: ReadonlyMap<string, number>
) {
  const measuredItems = documentLayout.listItems ?? [];
  if (measuredItems.length === 0) {
    return 0;
  }
  const paragraphs = Array.from(
    document.getElementsByTagNameNS(WORD_NAMESPACE, "p")
  ).filter((paragraph) => {
    const properties = firstDirectChild(
      paragraph,
      WORD_NAMESPACE,
      "pPr"
    );
    return Boolean(
      properties &&
      firstDirectChild(properties, WORD_NAMESPACE, "numPr")
    );
  });
  let measuredCursor = 0;
  let appliedCount = 0;
  for (const paragraph of paragraphs) {
    const text = normalizedLayoutText(paragraphText(paragraph));
    const relativeMatchIndex = measuredItems
      .slice(measuredCursor)
      .findIndex((item) => normalizedLayoutText(item.text) === text);
    if (relativeMatchIndex < 0) {
      continue;
    }
    const measuredIndex = measuredCursor + relativeMatchIndex;
    const measured = measuredItems[measuredIndex]!;
    measuredCursor = measuredIndex + 1;
    const properties = paragraphProperties(paragraph);
    const numbering = firstDirectChild(
      properties,
      WORD_NAMESPACE,
      "numPr"
    )!;
    const level = firstDirectChild(numbering, WORD_NAMESPACE, "ilvl");
    const number = firstDirectChild(numbering, WORD_NAMESPACE, "numId");
    const hanging = hangingIndents.get(
      `${wordAttribute(number ?? numbering, "val") ?? ""}:` +
      `${wordAttribute(level ?? numbering, "val") ?? "0"}`
    );
    const targetLeft = pointsToTwips(measured.textStartPt);
    const indentation = ensureDirectElement(
      properties,
      WORD_NAMESPACE,
      "w:ind"
    );
    setWordAttribute(
      indentation,
      "left",
      String(targetLeft)
    );
    if (hanging !== undefined) {
      setWordAttribute(
        indentation,
        "hanging",
        String(Math.min(targetLeft, hanging))
      );
    }
    if (measured.alignment) {
      const alignment = ensureDirectElement(
        properties,
        WORD_NAMESPACE,
        "w:jc"
      );
      setWordAttribute(
        alignment,
        "val",
        measured.alignment === "justify" ? "both" : measured.alignment
      );
    }
    appliedCount += 1;
  }
  return appliedCount;
}

function applyMeasuredTextBlockAlignments(
  document: XmlDocument,
  documentLayout: DocxDocumentLayoutPlan
) {
  const measuredBlocks = documentLayout.textBlocks ?? [];
  if (measuredBlocks.length === 0) {
    return 0;
  }
  const paragraphs = Array.from(
    document.getElementsByTagNameNS(WORD_NAMESPACE, "p")
  );
  let measuredCursor = 0;
  let appliedCount = 0;
  for (const paragraph of paragraphs) {
    const text = normalizedLayoutText(paragraphText(paragraph));
    if (!text) {
      continue;
    }
    const relativeMatchIndex = measuredBlocks
      .slice(measuredCursor)
      .findIndex((item) => normalizedLayoutText(item.text) === text);
    if (relativeMatchIndex < 0) {
      continue;
    }
    const measuredIndex = measuredCursor + relativeMatchIndex;
    const measured = measuredBlocks[measuredIndex]!;
    measuredCursor = measuredIndex + 1;
    if (!measured.alignment) {
      continue;
    }
    const alignment = ensureDirectElement(
      paragraphProperties(paragraph),
      WORD_NAMESPACE,
      "w:jc"
    );
    setWordAttribute(
      alignment,
      "val",
      measured.alignment === "justify" ? "both" : measured.alignment
    );
    appliedCount += 1;
  }
  return appliedCount;
}

function insertMeasuredLineBreak(
  paragraph: XmlElement,
  offset: number
) {
  const inlineElements = paragraphInlineElements(paragraph);
  let characterOffset = 0;
  for (const [index, element] of inlineElements.entries()) {
    if (element.localName !== "t") {
      continue;
    }
    const value = element.textContent ?? "";
    const characters = Array.from(value);
    const nextOffset = characterOffset + characters.length;
    if (offset > nextOffset) {
      characterOffset = nextOffset;
      continue;
    }
    const owner = paragraph.ownerDocument!;
    const nextInline = inlineElements[index + 1];
    if (offset === nextOffset && nextInline?.localName === "tab") {
      const replacement = owner.createElementNS(
        WORD_NAMESPACE,
        "w:br"
      );
      nextInline.parentNode!.replaceChild(replacement, nextInline);
      return true;
    }
    const splitIndex = offset - characterOffset;
    if (splitIndex <= 0 || splitIndex > characters.length) {
      return false;
    }
    const suffix = characters.splice(splitIndex).join("");
    element.textContent = characters.join("");
    const parent = element.parentNode!;
    const lineBreak = owner.createElementNS(WORD_NAMESPACE, "w:br");
    parent.insertBefore(lineBreak, element.nextSibling);
    if (suffix) {
      const continuation = element.cloneNode(false) as XmlElement;
      continuation.textContent = suffix;
      parent.insertBefore(continuation, lineBreak.nextSibling);
    }
    return true;
  }
  return false;
}

function measuredLineBreakOffsetsForParagraph(
  paragraph: XmlElement,
  measured: NonNullable<DocxDocumentLayoutPlan["textBlocks"]>[number]
) {
  if (
    paragraph.getElementsByTagNameNS(WORD_NAMESPACE, "tab").length > 0
  ) {
    return measured.lineBreakOffsets;
  }
  if (
    measured.alignment !== "justify" &&
    measured.alignment !== "distribute"
  ) {
    return [];
  }
  const characters = Array.from(normalizedLayoutText(measured.text));
  return measured.lineBreakOffsets.filter((offset) => {
    const trailingText = characters.slice(offset).join("");
    return /^\p{Script=Han}[\p{P}\p{S}]?$/u.test(trailingText);
  });
}

function paragraphHasInlineCode(paragraph: XmlElement) {
  return Array.from(
    paragraph.getElementsByTagNameNS(WORD_NAMESPACE, "rStyle")
  ).some((style) => wordAttribute(style, "val") === "VerbatimChar");
}

function stabilizeInlineCodeParagraphLineRules(document: XmlDocument) {
  let count = 0;
  for (const paragraph of Array.from(
    document.getElementsByTagNameNS(WORD_NAMESPACE, "p")
  )) {
    if (!paragraphHasInlineCode(paragraph)) {
      continue;
    }
    const spacing = directChildren(
      paragraphProperties(paragraph),
      WORD_NAMESPACE,
      "spacing"
    )[0];
    if (spacing && wordAttribute(spacing, "lineRule") === "exact") {
      setWordAttribute(spacing, "lineRule", "atLeast");
      count += 1;
    }
  }
  return count;
}

function applyMeasuredTextBlockLineBreaks(
  document: XmlDocument,
  documentLayout: DocxDocumentLayoutPlan
) {
  const measuredBlocks = documentLayout.textBlocks ?? [];
  if (measuredBlocks.length === 0) {
    return 0;
  }
  const paragraphs = Array.from(
    document.getElementsByTagNameNS(WORD_NAMESPACE, "p")
  );
  let measuredCursor = 0;
  let appliedCount = 0;
  for (const paragraph of paragraphs) {
    const text = normalizedLayoutText(paragraphText(paragraph));
    if (!text) {
      continue;
    }
    const relativeMatchIndex = measuredBlocks
      .slice(measuredCursor)
      .findIndex((item) => normalizedLayoutText(item.text) === text);
    if (relativeMatchIndex < 0) {
      continue;
    }
    const measuredIndex = measuredCursor + relativeMatchIndex;
    const measured = measuredBlocks[measuredIndex]!;
    measuredCursor = measuredIndex + 1;
    if (measured.linePitchPt !== undefined) {
      const spacing = ensureDirectElement(
        paragraphProperties(paragraph),
        WORD_NAMESPACE,
        "w:spacing"
      );
      setWordAttribute(
        spacing,
        "line",
        String(pointsToTwips(measured.linePitchPt))
      );
      setWordAttribute(
        spacing,
        "lineRule",
        paragraphHasInlineCode(paragraph) ? "atLeast" : "exact"
      );
    }
    for (const offset of [...measuredLineBreakOffsetsForParagraph(
      paragraph,
      measured
    )].sort(
      (left, right) => right - left
    )) {
      if (insertMeasuredLineBreak(paragraph, offset)) {
        appliedCount += 1;
      }
    }
  }
  return appliedCount;
}

function stabilizeTableMathParagraphAlignment(document: XmlDocument) {
  let count = 0;
  for (const paragraph of Array.from(
    document.getElementsByTagNameNS(WORD_NAMESPACE, "p")
  )) {
    const parent = paragraph.parentNode;
    if (
      !parent ||
      parent.nodeType !== 1 ||
      (parent as XmlElement).namespaceURI !== WORD_NAMESPACE ||
      (parent as XmlElement).localName !== "tc"
    ) {
      continue;
    }
    const content = Array.from(paragraph.childNodes).filter(
      (node): node is XmlElement => node.nodeType === 1
    ).filter(
      (child) =>
        !(child.namespaceURI === WORD_NAMESPACE && child.localName === "pPr")
    );
    if (
      content.length === 0 ||
      !content.every(
        (child) =>
          child.namespaceURI === MATH_NAMESPACE &&
          child.localName === "oMath"
      )
    ) {
      continue;
    }
    const run = appendElement(paragraph, WORD_NAMESPACE, "w:r");
    const properties = appendElement(run, WORD_NAMESPACE, "w:rPr");
    appendElement(properties, WORD_NAMESPACE, "w:noProof");
    const text = appendElement(run, WORD_NAMESPACE, "w:t");
    text.setAttributeNS(XML_NAMESPACE, "xml:space", "preserve");
    text.textContent = "\u200B";
    count += 1;
  }
  return count;
}

function pageBreakAfterStyleIds(tokens: DocxThemeTokenSet) {
  const ids = new Set<string>();
  for (const entry of tokens.slots) {
    if (!entry.style.pageBreakAfter) {
      continue;
    }
    for (const binding of
      DOCX_SLOT_WORD_STYLE_BINDINGS[entry.slot] ?? []) {
      if (binding.type === "paragraph") {
        ids.add(binding.styleId);
      }
    }
  }
  return ids;
}

function applyParagraphPageBreaks(
  document: ReturnType<typeof parseXmlPart>,
  tokens: DocxThemeTokenSet
) {
  const styleIds = pageBreakAfterStyleIds(tokens);
  let count = 0;
  for (const paragraph of Array.from(
    document.getElementsByTagNameNS(WORD_NAMESPACE, "p")
  )) {
    const properties = firstDirectChild(
      paragraph,
      WORD_NAMESPACE,
      "pPr"
    );
    const style = properties
      ? firstDirectChild(properties, WORD_NAMESPACE, "pStyle")
      : undefined;
    const styleId = style && wordAttribute(style, "val");
    const carriesSection = Boolean(
      properties &&
        firstDirectChild(properties, WORD_NAMESPACE, "sectPr")
    );
    if (styleId && styleIds.has(styleId) && !carriesSection) {
      count += Number(appendPageBreak(paragraph));
    }
  }
  return count;
}

function drawingParagraph(drawing: XmlElement) {
  let current = drawing.parentNode;
  while (current) {
    const element = current as XmlElement;
    if (
      element.nodeType === 1 &&
      element.namespaceURI === WORD_NAMESPACE &&
      element.localName === "p"
    ) {
      return element;
    }
    current = current.parentNode;
  }
  throw new Error("DOCX 媒体 Drawing 不在正文段落中");
}

function setDrawingExtent(
  element: XmlElement,
  widthEmu: number,
  heightEmu: number
) {
  element.setAttribute("cx", String(widthEmu));
  element.setAttribute("cy", String(heightEmu));
}

function normalizeMediaDrawing(
  drawing: XmlElement,
  item: PandocMediaLayoutItem
) {
  if (
    drawing.getElementsByTagNameNS(
      WORDPROCESSING_DRAWING_NAMESPACE,
      "anchor"
    ).length > 0
  ) {
    throw new Error(`DOCX 媒体 ${item.id} 不得使用浮动锚点`);
  }
  const inlines = Array.from(
    drawing.getElementsByTagNameNS(
      WORDPROCESSING_DRAWING_NAMESPACE,
      "inline"
    )
  );
  if (inlines.length !== 1) {
    throw new Error(`DOCX 媒体 ${item.id} 缺少唯一内联布局`);
  }
  const inline = inlines[0]!;
  for (const attribute of ["distT", "distB", "distL", "distR"]) {
    inline.setAttribute(attribute, "0");
  }
  const extent = firstDirectChild(
    inline,
    WORDPROCESSING_DRAWING_NAMESPACE,
    "extent"
  );
  const documentProperties = firstDirectChild(
    inline,
    WORDPROCESSING_DRAWING_NAMESPACE,
    "docPr"
  );
  if (!extent || !documentProperties) {
    throw new Error(`DOCX 媒体 ${item.id} 的内联属性不完整`);
  }
  setDrawingExtent(extent, item.widthEmu, item.heightEmu);
  documentProperties.setAttribute("descr", item.altText);
  documentProperties.setAttribute("title", "");

  let frameProperties = firstDirectChild(
    inline,
    WORDPROCESSING_DRAWING_NAMESPACE,
    "cNvGraphicFramePr"
  );
  if (!frameProperties) {
    frameProperties = inline.ownerDocument!.createElementNS(
      WORDPROCESSING_DRAWING_NAMESPACE,
      "wp:cNvGraphicFramePr"
    );
    const graphic = firstDirectChild(
      inline,
      DRAWING_NAMESPACE,
      "graphic"
    );
    inline.insertBefore(frameProperties, graphic ?? null);
  }
  let locks = firstDirectChild(
    frameProperties,
    DRAWING_NAMESPACE,
    "graphicFrameLocks"
  );
  if (!locks) {
    locks = appendElement(
      frameProperties,
      DRAWING_NAMESPACE,
      "a:graphicFrameLocks"
    );
  }
  locks.setAttribute("noChangeAspect", "1");

  if (
    drawing.getElementsByTagNameNS(DRAWING_NAMESPACE, "srcRect")
      .length > 0
  ) {
    throw new Error(`DOCX 媒体 ${item.id} 不得使用图片裁切`);
  }
  const transforms = Array.from(
    drawing.getElementsByTagNameNS(DRAWING_NAMESPACE, "xfrm")
  );
  if (transforms.length !== 1) {
    throw new Error(`DOCX 媒体 ${item.id} 缺少唯一图片变换`);
  }
  const transform = transforms[0]!;
  transform.removeAttribute("rot");
  transform.removeAttribute("flipH");
  transform.removeAttribute("flipV");
  const transformedExtent = firstDirectChild(
    transform,
    DRAWING_NAMESPACE,
    "ext"
  );
  if (!transformedExtent) {
    throw new Error(`DOCX 媒体 ${item.id} 缺少图片变换尺寸`);
  }
  setDrawingExtent(
    transformedExtent,
    item.widthEmu,
    item.heightEmu
  );
}

function normalizeMediaParagraphs(
  document: XmlDocument,
  tokens: DocxThemeTokenSet,
  mediaLayout: readonly PandocMediaLayoutItem[]
) {
  const mediaFontSizePt =
    tokens.slots.find((entry) => entry.slot === "figure")?.style
      .fontSizePt ??
    tokens.slots.find((entry) => entry.slot === "paragraph")?.style
      .fontSizePt ??
    10;
  const browserMediaMarginTwips = pointsToTwips(
    mediaFontSizePt * 1.5
  );
  const byBinding = new Map(
    mediaLayout.map((item) => [item.binding, item] as const)
  );
  if (byBinding.size !== mediaLayout.length) {
    throw new Error("DOCX 媒体布局计划包含重复绑定");
  }
  const seen = new Set<string>();
  const paragraphAlignments = new Map<XmlElement, string>();
  const drawings = Array.from(
    document.getElementsByTagNameNS(WORD_NAMESPACE, "drawing")
  );
  for (const drawing of drawings) {
    const paragraph = drawingParagraph(drawing);
    if (mediaLayout.length > 0) {
      const documentProperties = Array.from(
        drawing.getElementsByTagNameNS(
          WORDPROCESSING_DRAWING_NAMESPACE,
          "docPr"
        )
      );
      if (documentProperties.length !== 1) {
        throw new Error("DOCX 媒体缺少唯一文档属性");
      }
      const binding =
        documentProperties[0]!.getAttribute("title") ?? "";
      const item = byBinding.get(binding);
      if (!item || seen.has(binding)) {
        throw new Error("DOCX 媒体与布局计划无法稳定绑定");
      }
      normalizeMediaDrawing(drawing, item);
      seen.add(binding);
      const previousAlignment = paragraphAlignments.get(paragraph);
      if (previousAlignment && previousAlignment !== item.alignment) {
        throw new Error("同一 DOCX 媒体段落包含冲突的对齐方式");
      }
      paragraphAlignments.set(paragraph, item.alignment);
    } else {
      paragraphAlignments.set(paragraph, "center");
    }
  }
  if (seen.size !== mediaLayout.length) {
    throw new Error("DOCX 媒体布局计划未被完整消费");
  }

  for (const [paragraph, alignment] of paragraphAlignments) {
    const properties = paragraphProperties(paragraph);
    const style = ensureDirectElement(
      properties,
      WORD_NAMESPACE,
      "w:pStyle"
    );
    setWordAttribute(style, "val", "Figure");
    const spacing = ensureDirectElement(
      properties,
      WORD_NAMESPACE,
      "w:spacing"
    );
    setWordAttribute(spacing, "line", "240");
    setWordAttribute(spacing, "lineRule", "auto");
    const description = Array.from(
      paragraph.getElementsByTagName("*")
    )
      .find((element) => element.localName === "docPr")
      ?.getAttribute("descr");
    if (/^(?:Mermaid|ECharts)\b/u.test(description ?? "")) {
      setWordAttribute(
        spacing,
        "before",
        String(browserMediaMarginTwips)
      );
      setWordAttribute(
        spacing,
        "after",
        String(browserMediaMarginTwips)
      );
    }
    const justification = ensureDirectElement(
      properties,
      WORD_NAMESPACE,
      "w:jc"
    );
    setWordAttribute(justification, "val", alignment);
  }
  return drawings.length;
}

function ensureNoMarkers(
  body: XmlElement,
  plan: PandocStructurePlan
) {
  const markers = new Set<string>();
  for (const descriptor of containerDescriptors(plan)) {
    markers.add(descriptor.container.startMarker);
    markers.add(descriptor.container.endMarker);
  }
  for (const section of [
    ...sectionBreaks(plan.prefix),
    ...sectionBreaks(plan.suffix)
  ]) {
    markers.add(section.marker);
  }
  const residual = bodyElements(body).find(
    (element) =>
      element.localName === "p" &&
      markers.has(paragraphText(element))
  );
  if (residual) {
    throw new Error(
      `DOCX 结构标记未被消费：${paragraphText(residual)}`
    );
  }
}

function disableAutomaticCharacterSpacing(document: XmlDocument) {
  for (const paragraph of Array.from(
    document.getElementsByTagNameNS(WORD_NAMESPACE, "p")
  )) {
    const properties = paragraphProperties(paragraph);
    for (const propertyName of ["autoSpaceDE", "autoSpaceDN"] as const) {
      const automaticSpacing = ensureDirectElement(
        properties,
        WORD_NAMESPACE,
        `w:${propertyName}`
      );
      setWordAttribute(automaticSpacing, "val", "0");
    }
  }
}

const PANDOC_ALERT_LABELS = new Set([
  "note",
  "tip",
  "important",
  "warning",
  "caution"
]);

function normalizePandocAlertParagraphStyles(
  body: XmlElement,
  documentLayout: DocxDocumentLayoutPlan
) {
  const children = directChildren(body, WORD_NAMESPACE, "p");
  const measuredAlerts = (documentLayout.textBlocks ?? []).filter(
    (block) => block.alertRole !== undefined
  );
  let measuredCursor = 0;
  let count = 0;
  for (const [index, paragraph] of children.entries()) {
    if (
      paragraphStyleId(paragraph) !== "FirstParagraph" ||
      !PANDOC_ALERT_LABELS.has(
        normalizedLayoutText(paragraphText(paragraph)).toLocaleLowerCase(
          "en-US"
        )
      )
    ) {
      continue;
    }
    const content = children[index + 1];
    if (!content || paragraphStyleId(content) !== "BodyText") {
      continue;
    }
    const style = ensureDirectElement(
      paragraphProperties(content),
      WORD_NAMESPACE,
      "w:pStyle"
    );
    setWordAttribute(style, "val", "BlockText");
    for (const [target, role] of [
      [paragraph, "title"],
      [content, "body"]
    ] as const) {
      const text = normalizedLayoutText(paragraphText(target));
      const relativeMatchIndex = measuredAlerts
        .slice(measuredCursor)
        .findIndex(
          (block) =>
            block.alertRole === role &&
            normalizedLayoutText(block.text) === text
        );
      if (relativeMatchIndex < 0) {
        continue;
      }
      const measuredIndex = measuredCursor + relativeMatchIndex;
      const measured = measuredAlerts[measuredIndex]!;
      measuredCursor = measuredIndex + 1;
      const properties = paragraphProperties(target);
      const indentation = ensureDirectElement(
        properties,
        WORD_NAMESPACE,
        "w:ind"
      );
      if (measured.leftIndentPt !== undefined) {
        setWordAttribute(
          indentation,
          "left",
          String(pointsToTwips(measured.leftIndentPt))
        );
      }
      if (measured.rightIndentPt !== undefined) {
        setWordAttribute(
          indentation,
          "right",
          String(pointsToTwips(measured.rightIndentPt))
        );
      }
      applyDirectRunToken(target, {
        fontCandidates: [],
        ...(measured.fontSizePt !== undefined
          ? { fontSizePt: measured.fontSizePt }
          : {}),
        bold: measured.bold,
        italic: measured.italic,
        color: measured.color,
        letterSpacingPt: measured.letterSpacingPt
      });
    }
    count += 1;
  }
  return count;
}

export function finalizeGeneratedDocxStructure(
  content: Uint8Array,
  plan: PandocStructurePlan,
  tokens: DocxThemeTokenSet,
  mediaLayout: readonly PandocMediaLayoutItem[] = [],
  documentLayout: DocxDocumentLayoutPlan = { tables: [] }
): FinalizedGeneratedDocx {
  const source = readGeneratedDocxPackage(content);
  const entries = new Map(source.entries);
  const document = parseXmlPart(
    entries.get("word/document.xml")!,
    "word/document.xml"
  );
  const body = document.getElementsByTagNameNS(
    WORD_NAMESPACE,
    "body"
  )[0];
  if (!body) {
    throw new Error("DOCX 正文结构无效");
  }
  const containers = applyContainerRanges(
    body,
    plan,
    tokens,
    sectionContentWidthTwips(finalSection(body)),
    sectionContentHeightTwips(finalSection(body))
  );
  const settings = parseXmlPart(
    entries.get("word/settings.xml")!,
    "word/settings.xml"
  );
  const usesEvenAndOddPages = Boolean(
    settings.getElementsByTagNameNS(
      WORD_NAMESPACE,
      "evenAndOddHeaders"
    )[0]
  );
  const sectionCount = applySections(
    body,
    plan,
    containers.editableContainerTables.size > 0,
    usesEvenAndOddPages
  );
  normalizePandocAlertParagraphStyles(body, documentLayout);
  disableAutomaticCharacterSpacing(document);
  const final = finalSection(body);
  applyMeasuredTextBlockLineBreaks(document, documentLayout);
  const spaceBetweenParagraphCount =
    applySpaceBetweenParagraphs(document, final, plan, tokens);
  const tableCount = applyTables(
    document,
    tokens,
    containers.editableContainerTables,
    documentLayout,
    sectionContentWidthTwips(final)
  );
  applyMeasuredListItemIndents(
    document,
    documentLayout,
    collectNumberingHangingIndents(entries)
  );
  applyMeasuredTextBlockAlignments(document, documentLayout);
  applyDirectCharacterStyleTokens(document, tokens, documentLayout);
  applyMeasuredEmojiRunColors(document, documentLayout);
  stabilizeInlineCodeParagraphLineRules(document);
  stabilizeTableMathParagraphAlignment(document);
  const mediaDrawingCount = normalizeMediaParagraphs(
    document,
    tokens,
    mediaLayout
  );
  const pageBreakAfterCount =
    containers.pageBreakAfterCount +
    applyParagraphPageBreaks(document, tokens);
  ensureNoMarkers(body, plan);
  entries.set(
    "word/document.xml",
    serializeXmlPart(document)
  );
  const sectionPageFieldCount = replaceSectionPageFields(
    entries,
    sectionCount > 0
  );
  normalizeGeneratedStyles(entries);
  applyListNumberingIndents(entries, tokens);
  return {
    content: writeGeneratedDocxPackage(entries),
    report: {
      containerCount: containers.containerCount,
      editableContainerTableCount:
        containers.editableContainerTables.size,
      sectionCount,
      tableCount,
      pageBreakAfterCount,
      sectionPageFieldCount,
      spaceBetweenParagraphCount,
      mediaDrawingCount
    }
  };
}
