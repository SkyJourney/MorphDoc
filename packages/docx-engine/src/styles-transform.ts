import type { DocxFontFamily } from "@morphdoc/core";
import type {
  DocxSlotStyleToken,
  DocxStyleSlotName,
  DocxThemeTokenSet
} from "@morphdoc/docx-theme-engine";
import type { ResolvedDocxThemeStyle } from "./style-presets.js";
import {
  DOCX_SLOT_WORD_STYLE_BINDINGS,
  PANDOC_SYNTAX_STYLE_IDS,
  collectDocxTokenFonts,
  createDocxTokenSlotMap,
  resolvePandocSyntaxStyleSlot,
  resolveTokenFonts
} from "./token-style-map.js";
import {
  DRAWING_NAMESPACE,
  WORD_NAMESPACE,
  appendElement,
  colorValue,
  directChildren,
  ensureDirectElement,
  firstDirectChild,
  millimetersToTwips,
  parseXmlPart,
  pointsToHalfPoints,
  pointsToTwips,
  removeDirectChildren,
  serializeXmlPart,
  wordCharacterSpacingTwips,
  type XmlElement
} from "./ooxml.js";

function setFonts(parent: XmlElement, fonts: DocxFontFamily) {
  removeDirectChildren(parent, WORD_NAMESPACE, "rFonts");
  appendElement(parent, WORD_NAMESPACE, "w:rFonts", {
    "w:ascii": fonts.latin,
    "w:hAnsi": fonts.latin,
    "w:eastAsia": fonts.eastAsia,
    "w:cs": fonts.complexScript ?? fonts.latin
  });
}

function setRunStyle(
  parent: XmlElement,
  options: {
    fonts?: DocxFontFamily;
    sizePt?: number;
    color?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    backgroundColor?: string;
  }
) {
  removeDirectChildren(
    parent,
    WORD_NAMESPACE,
    "rFonts",
    "sz",
    "szCs",
    "color",
    "b",
    "bCs",
    "i",
    "iCs",
    "u",
    "shd",
    "spacing",
    "kern"
  );
  if (options.fonts) {
    setFonts(parent, options.fonts);
  }
  if (options.bold) {
    appendElement(parent, WORD_NAMESPACE, "w:b");
    appendElement(parent, WORD_NAMESPACE, "w:bCs");
  }
  if (options.italic) {
    appendElement(parent, WORD_NAMESPACE, "w:i");
    appendElement(parent, WORD_NAMESPACE, "w:iCs");
  }
  if (options.color) {
    appendElement(parent, WORD_NAMESPACE, "w:color", {
      "w:val": colorValue(options.color)
    });
  }
  if (options.underline) {
    appendElement(parent, WORD_NAMESPACE, "w:u", {
      "w:val": "single"
    });
  }
  if (options.backgroundColor) {
    appendElement(parent, WORD_NAMESPACE, "w:shd", {
      "w:val": "clear",
      "w:color": "auto",
      "w:fill": colorValue(options.backgroundColor)
    });
  }
  if (options.sizePt !== undefined) {
    const size = pointsToHalfPoints(options.sizePt);
    appendElement(parent, WORD_NAMESPACE, "w:sz", {
      "w:val": size
    });
    appendElement(parent, WORD_NAMESPACE, "w:szCs", {
      "w:val": size
    });
    appendElement(parent, WORD_NAMESPACE, "w:spacing", {
      "w:val": wordCharacterSpacingTwips(options.sizePt)
    });
  }
  appendElement(parent, WORD_NAMESPACE, "w:kern", {
    "w:val": "2"
  });
}

function setParagraphSpacing(
  parent: XmlElement,
  options: {
    beforePt: number;
    afterPt: number;
    fontSizePt: number;
    lineSpacing: number;
    firstLineIndentChars?: number;
  }
) {
  removeDirectChildren(parent, WORD_NAMESPACE, "spacing", "ind");
  appendElement(parent, WORD_NAMESPACE, "w:spacing", {
    "w:before": pointsToTwips(options.beforePt),
    "w:after": pointsToTwips(options.afterPt),
    "w:line": pointsToTwips(
      options.fontSizePt * options.lineSpacing
    ),
    "w:lineRule": "exact"
  });
  if (options.firstLineIndentChars !== undefined) {
    appendElement(parent, WORD_NAMESPACE, "w:ind", {
      "w:firstLineChars": String(
        Math.round(options.firstLineIndentChars * 100)
      )
    });
  }
}

function findStyle(styles: XmlElement, styleId: string) {
  return Array.from(
    styles.getElementsByTagNameNS(WORD_NAMESPACE, "style")
  ).find(
    (element) =>
      element.getAttributeNS(WORD_NAMESPACE, "styleId") === styleId
  );
}

function ensureStyle(
  styles: XmlElement,
  styleId: string,
  type: "paragraph" | "character" | "table",
  basedOn?: string
) {
  const existing = findStyle(styles, styleId);
  if (existing) {
    return existing;
  }
  const style = appendElement(styles, WORD_NAMESPACE, "w:style", {
    "w:type": type,
    "w:customStyle": "1",
    "w:styleId": styleId
  });
  appendElement(style, WORD_NAMESPACE, "w:name", {
    "w:val": styleId.replace(/([a-z])([A-Z])/gu, "$1 $2")
  });
  if (basedOn) {
    appendElement(style, WORD_NAMESPACE, "w:basedOn", {
      "w:val": basedOn
    });
  }
  return style;
}

function setWordAttribute(
  element: XmlElement,
  name: string,
  value: string
) {
  element.setAttributeNS(WORD_NAMESPACE, `w:${name}`, value);
}

function toggleProperty(
  parent: XmlElement,
  localName: string,
  enabled: boolean | undefined
) {
  if (enabled === undefined) {
    return;
  }
  removeDirectChildren(parent, WORD_NAMESPACE, localName);
  if (enabled) {
    appendElement(parent, WORD_NAMESPACE, `w:${localName}`);
  }
}

function fallbackFontsForSlot(
  slot: DocxStyleSlotName,
  fallback: ResolvedDocxThemeStyle
) {
  if (slot.startsWith("heading-") || slot.endsWith("-title")) {
    return fallback.headings.fonts;
  }
  if (
    slot === "inline-code" ||
    slot === "code-block" ||
    slot === "code-block-text" ||
    slot.startsWith("code-token-")
  ) {
    return {
      ...fallback.code.fonts,
      eastAsia: fallback.body.fonts.eastAsia
    };
  }
  if (
    slot === "table" ||
    slot === "table-header" ||
    slot === "table-cell"
  ) {
    return fallback.table.fonts;
  }
  if (slot === "caption") {
    return fallback.caption.fonts;
  }
  return fallback.body.fonts;
}

function fallbackFontSizeForSlot(
  slot: DocxStyleSlotName,
  fallback: ResolvedDocxThemeStyle
) {
  const headingMatch = /^heading-([1-6])$/u.exec(slot);
  if (headingMatch) {
    return fallback.headings.sizesPt[
      Number.parseInt(headingMatch[1]!, 10) - 1
    ]!;
  }
  if (slot === "document-title") {
    return fallback.headings.sizesPt[0] + 4;
  }
  if (slot.endsWith("-title")) {
    return fallback.headings.sizesPt[0];
  }
  if (
    slot === "inline-code" ||
    slot === "code-block" ||
    slot === "code-block-text" ||
    slot.startsWith("code-token-")
  ) {
    return fallback.code.sizePt;
  }
  if (
    slot === "table" ||
    slot === "table-header" ||
    slot === "table-cell"
  ) {
    return fallback.table.sizePt;
  }
  if (slot === "caption") {
    return fallback.caption.sizePt;
  }
  return fallback.body.sizePt;
}

function applyTokenRunStyle(
  parent: XmlElement,
  token: DocxSlotStyleToken,
  fallbackFonts: DocxFontFamily,
  preserveFallbackEastAsia = false
) {
  removeDirectChildren(parent, WORD_NAMESPACE, "kern");
  appendElement(parent, WORD_NAMESPACE, "w:kern", {
    "w:val": "2"
  });
  if (token.fontCandidates.length) {
    setFonts(parent, resolveTokenFonts(token, fallbackFonts, {
      preserveFallbackEastAsia
    }));
  }
  if (token.fontSizePt !== undefined) {
    removeDirectChildren(parent, WORD_NAMESPACE, "sz", "szCs");
    const size = pointsToHalfPoints(token.fontSizePt);
    appendElement(parent, WORD_NAMESPACE, "w:sz", {
      "w:val": size
    });
    appendElement(parent, WORD_NAMESPACE, "w:szCs", {
      "w:val": size
    });
  }
  if (token.color !== undefined) {
    removeDirectChildren(parent, WORD_NAMESPACE, "color");
    appendElement(parent, WORD_NAMESPACE, "w:color", {
      "w:val": colorValue(token.color)
    });
  }
  if (token.backgroundColor !== undefined) {
    removeDirectChildren(parent, WORD_NAMESPACE, "shd");
    appendElement(parent, WORD_NAMESPACE, "w:shd", {
      "w:val": "clear",
      "w:color": "auto",
      "w:fill": colorValue(token.backgroundColor)
    });
  }
  if (token.underline !== undefined) {
    removeDirectChildren(parent, WORD_NAMESPACE, "u");
    if (token.underline) {
      appendElement(parent, WORD_NAMESPACE, "w:u", {
        "w:val": "single"
      });
    }
  }
  if (
    token.letterSpacingPt !== undefined ||
    token.fontSizePt !== undefined
  ) {
    removeDirectChildren(parent, WORD_NAMESPACE, "spacing");
    appendElement(parent, WORD_NAMESPACE, "w:spacing", {
      "w:val": wordCharacterSpacingTwips(
        token.fontSizePt,
        token.letterSpacingPt ?? 0
      )
    });
  }
  toggleProperty(parent, "b", token.bold);
  toggleProperty(parent, "bCs", token.bold);
  toggleProperty(parent, "i", token.italic);
  toggleProperty(parent, "iCs", token.italic);
  toggleProperty(parent, "strike", token.strikethrough);
  toggleProperty(parent, "vanish", token.hidden);
}

function applyTokenBorders(
  parent: XmlElement,
  token: DocxSlotStyleToken,
  horizontalContentPaddingInBorderSpace = false
) {
  if (!token.borders) {
    return;
  }
  removeDirectChildren(parent, WORD_NAMESPACE, "pBdr");
  const borders = appendElement(
    parent,
    WORD_NAMESPACE,
    "w:pBdr"
  );
  for (const side of [
    "top",
    "right",
    "bottom",
    "left"
  ] as const) {
    const border = token.borders[side];
    if (!border) {
      continue;
    }
    appendElement(borders, WORD_NAMESPACE, `w:${side}`, {
      "w:val": border.style,
      "w:sz": String(
        Math.max(0, Math.min(160, Math.round(border.widthPt * 8)))
      ),
      "w:space": String(
        Math.max(
          0,
          Math.min(
            31,
            Math.round(
              horizontalContentPaddingInBorderSpace && side === "left"
                ? Math.floor(
                    Math.max(
                      0,
                      (token.paddingPt?.left ?? 0) +
                        (token.contentPaddingLeftPt ?? 0) -
                        border.widthPt * 2
                    )
                  )
                : token.paddingPt?.[side] ?? 0
            )
          )
        )
      ),
      "w:color": colorValue(border.color)
    });
  }
}

function applyTokenParagraphStyle(
  parent: XmlElement,
  token: DocxSlotStyleToken,
  fallbackFontSizePt: number,
  horizontalPaddingThroughBorderSpace = false
) {
  for (const propertyName of ["autoSpaceDE", "autoSpaceDN"] as const) {
    const automaticSpacing = ensureDirectElement(
      parent,
      WORD_NAMESPACE,
      `w:${propertyName}`
    );
    setWordAttribute(automaticSpacing, "val", "0");
  }
  const spacingBeforePt =
    token.spacingBeforePt !== undefined ||
    (token.paddingPt?.top ?? 0) > 0
      ? (token.spacingBeforePt ?? 0) +
        (token.borders?.top ? 0 : token.paddingPt?.top ?? 0)
      : undefined;
  const spacingAfterPt =
    token.spacingAfterPt !== undefined ||
    (token.paddingPt?.bottom ?? 0) > 0
      ? (token.spacingAfterPt ?? 0) +
        (token.borders?.bottom
          ? 0
          : token.paddingPt?.bottom ?? 0)
      : undefined;
  if (
    spacingBeforePt !== undefined ||
    spacingAfterPt !== undefined ||
    token.lineSpacing !== undefined
  ) {
    const spacing = ensureDirectElement(
      parent,
      WORD_NAMESPACE,
      "w:spacing"
    );
    if (spacingBeforePt !== undefined) {
      setWordAttribute(
        spacing,
        "before",
        pointsToTwips(spacingBeforePt)
      );
    }
    if (spacingAfterPt !== undefined) {
      setWordAttribute(
        spacing,
        "after",
        pointsToTwips(spacingAfterPt)
      );
    }
    if (token.lineSpacing !== undefined) {
      setWordAttribute(
        spacing,
        "line",
        pointsToTwips(
          (token.fontSizePt ?? fallbackFontSizePt) *
            token.lineSpacing
        )
      );
      setWordAttribute(spacing, "lineRule", "exact");
    }
  }
  const leftIndentPt =
    token.leftIndentPt !== undefined ||
    (token.paddingPt?.left ?? 0) > 0 ||
    (token.contentPaddingLeftPt ?? 0) > 0 ||
    (token.borders?.left?.widthPt ?? 0) > 0
      ? (token.leftIndentPt ?? 0) +
        (token.paddingPt?.left ?? 0) +
        (token.contentPaddingLeftPt ?? 0) +
        (token.borders?.left?.widthPt ?? 0)
      : undefined;
  const rightIndentPt =
    token.rightIndentPt !== undefined ||
    (token.paddingPt?.right ?? 0) > 0 ||
    (token.borders?.right?.widthPt ?? 0) > 0
      ? (token.rightIndentPt ?? 0) +
        // 带边框代码块通过 w:pBdr/w:space 表达 CSS 右内边距。
        // 若再把 padding/border 写进 w:ind，Word/WPS 会重复扣减
        // 内容宽度，使本可容纳的等宽代码行在末尾额外回流。
        (horizontalPaddingThroughBorderSpace && token.borders?.right
          ? 0
          : (token.paddingPt?.right ?? 0) +
            (token.borders?.right?.widthPt ?? 0))
      : undefined;
  if (
    token.firstLineIndentPt !== undefined ||
    leftIndentPt !== undefined ||
    rightIndentPt !== undefined
  ) {
    const indent = ensureDirectElement(
      parent,
      WORD_NAMESPACE,
      "w:ind"
    );
    if (token.firstLineIndentPt !== undefined) {
      setWordAttribute(
        indent,
        "firstLine",
        pointsToTwips(token.firstLineIndentPt)
      );
      indent.removeAttributeNS(WORD_NAMESPACE, "firstLineChars");
    }
    if (leftIndentPt !== undefined) {
      setWordAttribute(
        indent,
        "left",
        pointsToTwips(leftIndentPt)
      );
      indent.removeAttributeNS(WORD_NAMESPACE, "leftChars");
    }
    if (rightIndentPt !== undefined) {
      setWordAttribute(
        indent,
        "right",
        pointsToTwips(rightIndentPt)
      );
    }
  }
  if (token.alignment !== undefined) {
    removeDirectChildren(parent, WORD_NAMESPACE, "jc");
    appendElement(parent, WORD_NAMESPACE, "w:jc", {
      "w:val":
        token.alignment === "justify"
          ? "both"
          : token.alignment
    });
  }
  if (token.backgroundColor !== undefined) {
    removeDirectChildren(parent, WORD_NAMESPACE, "shd");
    appendElement(parent, WORD_NAMESPACE, "w:shd", {
      "w:val": "clear",
      "w:color": "auto",
      "w:fill": colorValue(token.backgroundColor)
    });
  }
  applyTokenBorders(
    parent,
    token,
    horizontalPaddingThroughBorderSpace
  );
  toggleProperty(parent, "keepLines", token.keepLines);
  toggleProperty(parent, "keepNext", token.keepWithNext);
  toggleProperty(
    parent,
    "pageBreakBefore",
    token.pageBreakBefore
  );
}

function applyBodyStyle(
  styles: XmlElement,
  style: ResolvedDocxThemeStyle
) {
  const defaults = firstDirectChild(
    styles,
    WORD_NAMESPACE,
    "docDefaults"
  );
  if (!defaults) {
    throw new Error("word/styles.xml 缺少 w:docDefaults");
  }
  const defaultRun = ensureDirectElement(
    ensureDirectElement(
      defaults,
      WORD_NAMESPACE,
      "w:rPrDefault"
    ),
    WORD_NAMESPACE,
    "w:rPr"
  );
  setRunStyle(defaultRun, {
    fonts: style.body.fonts,
    sizePt: style.body.sizePt,
    color: style.body.color
  });
  const defaultParagraph = ensureDirectElement(
    ensureDirectElement(
      defaults,
      WORD_NAMESPACE,
      "w:pPrDefault"
    ),
    WORD_NAMESPACE,
    "w:pPr"
  );
  setParagraphSpacing(defaultParagraph, {
    beforePt: style.body.spacingBeforePt,
    afterPt: style.body.spacingAfterPt,
    fontSizePt: style.body.sizePt,
    lineSpacing: style.body.lineSpacing,
    firstLineIndentChars: style.body.firstLineIndentChars
  });

  for (const styleId of [
    "Normal",
    "BodyText",
    "FirstParagraph",
    "FootnoteText",
    "Definition",
    "Figure"
  ]) {
    const target = ensureStyle(
      styles,
      styleId,
      "paragraph",
      styleId === "Normal" ? undefined : "Normal"
    );
    const pPr = ensureDirectElement(
      target,
      WORD_NAMESPACE,
      "w:pPr"
    );
    setParagraphSpacing(pPr, {
      beforePt: style.body.spacingBeforePt,
      afterPt: style.body.spacingAfterPt,
      fontSizePt: style.body.sizePt,
      lineSpacing: style.body.lineSpacing,
      firstLineIndentChars: style.body.firstLineIndentChars
    });
    const rPr = ensureDirectElement(
      target,
      WORD_NAMESPACE,
      "w:rPr"
    );
    setRunStyle(rPr, {
      fonts: style.body.fonts,
      sizePt: style.body.sizePt,
      color: style.body.color
    });
  }

  const compact = ensureStyle(
    styles,
    "Compact",
    "paragraph",
    "BodyText"
  );
  setParagraphSpacing(
    ensureDirectElement(compact, WORD_NAMESPACE, "w:pPr"),
    {
      beforePt: 0,
      afterPt: 0,
      fontSizePt: style.body.sizePt,
      lineSpacing: style.body.lineSpacing,
      firstLineIndentChars: 0
    }
  );
}

function applyHeadings(
  styles: XmlElement,
  style: ResolvedDocxThemeStyle
) {
  for (let level = 1; level <= 6; level += 1) {
    const sizePt = style.headings.sizesPt[level - 1]!;
    for (const styleId of [
      `Heading${level}`,
      `Heading${level}Char`
    ]) {
      const target = ensureStyle(
        styles,
        styleId,
        styleId.endsWith("Char") ? "character" : "paragraph",
        styleId.endsWith("Char")
          ? "DefaultParagraphFont"
          : "Normal"
      );
      if (!styleId.endsWith("Char")) {
        const pPr = ensureDirectElement(
          target,
          WORD_NAMESPACE,
          "w:pPr"
        );
        setParagraphSpacing(pPr, {
          beforePt: style.headings.spacingBeforePt,
          afterPt: style.headings.spacingAfterPt,
          fontSizePt: sizePt,
          lineSpacing: 1.25
        });
        if (!firstDirectChild(pPr, WORD_NAMESPACE, "keepNext")) {
          appendElement(pPr, WORD_NAMESPACE, "w:keepNext");
        }
        if (!firstDirectChild(pPr, WORD_NAMESPACE, "keepLines")) {
          appendElement(pPr, WORD_NAMESPACE, "w:keepLines");
        }
      }
      setRunStyle(
        ensureDirectElement(target, WORD_NAMESPACE, "w:rPr"),
        {
          fonts: style.headings.fonts,
          sizePt,
          color: style.headings.color,
          bold: style.headings.bold
        }
      );
    }
  }

  for (const [styleId, sizePt] of [
    ["Title", style.headings.sizesPt[0] + 4],
    ["TitleChar", style.headings.sizesPt[0] + 4],
    ["Subtitle", style.headings.sizesPt[1]],
    ["SubtitleChar", style.headings.sizesPt[1]]
  ] as const) {
    const target = ensureStyle(
      styles,
      styleId,
      styleId.endsWith("Char") ? "character" : "paragraph",
      styleId.endsWith("Char")
        ? "DefaultParagraphFont"
        : "Normal"
    );
    if (!styleId.endsWith("Char")) {
      const pPr = ensureDirectElement(
        target,
        WORD_NAMESPACE,
        "w:pPr"
      );
      setParagraphSpacing(pPr, {
        beforePt: 0,
        afterPt: style.headings.spacingAfterPt,
        fontSizePt: sizePt,
        lineSpacing: 1.25
      });
      removeDirectChildren(pPr, WORD_NAMESPACE, "jc");
      appendElement(pPr, WORD_NAMESPACE, "w:jc", {
        "w:val": "center"
      });
    }
    setRunStyle(
      ensureDirectElement(target, WORD_NAMESPACE, "w:rPr"),
      {
        fonts: style.headings.fonts,
        sizePt,
        color: style.headings.color,
        bold: styleId.startsWith("Title")
      }
    );
  }
}

function applyCodeAndQuote(
  styles: XmlElement,
  style: ResolvedDocxThemeStyle
) {
  const inlineCode = ensureStyle(
    styles,
    "VerbatimChar",
    "character",
    "BodyTextChar"
  );
  setRunStyle(
    ensureDirectElement(inlineCode, WORD_NAMESPACE, "w:rPr"),
    {
      fonts: style.code.fonts,
      sizePt: style.code.sizePt,
      color: style.code.color,
      backgroundColor: style.code.backgroundColor
    }
  );

  const sourceCode = ensureStyle(
    styles,
    "SourceCode",
    "paragraph",
    "Normal"
  );
  const codePPr = ensureDirectElement(
    sourceCode,
    WORD_NAMESPACE,
    "w:pPr"
  );
  setParagraphSpacing(codePPr, {
    beforePt: 3,
    afterPt: 3,
    fontSizePt: style.code.sizePt,
    lineSpacing: style.code.lineSpacing,
    firstLineIndentChars: 0
  });
  removeDirectChildren(codePPr, WORD_NAMESPACE, "shd", "pBdr");
  appendElement(codePPr, WORD_NAMESPACE, "w:shd", {
    "w:val": "clear",
    "w:color": "auto",
    "w:fill": colorValue(style.code.backgroundColor)
  });
  const codeBorders = appendElement(
    codePPr,
    WORD_NAMESPACE,
    "w:pBdr"
  );
  for (const side of ["top", "left", "bottom", "right"]) {
    appendElement(codeBorders, WORD_NAMESPACE, `w:${side}`, {
      "w:val": "single",
      "w:sz": "4",
      "w:space": "2",
      "w:color": colorValue(style.code.borderColor)
    });
  }
  setRunStyle(
    ensureDirectElement(sourceCode, WORD_NAMESPACE, "w:rPr"),
    {
      fonts: style.code.fonts,
      sizePt: style.code.sizePt,
      color: style.code.color,
      backgroundColor: style.code.backgroundColor
    }
  );

  const quote = ensureStyle(
    styles,
    "BlockText",
    "paragraph",
    "BodyText"
  );
  const quotePPr = ensureDirectElement(
    quote,
    WORD_NAMESPACE,
    "w:pPr"
  );
  setParagraphSpacing(quotePPr, {
    beforePt: 6,
    afterPt: 6,
    fontSizePt: style.body.sizePt,
    lineSpacing: style.body.lineSpacing,
    firstLineIndentChars: 0
  });
  removeDirectChildren(quotePPr, WORD_NAMESPACE, "ind", "shd", "pBdr");
  appendElement(quotePPr, WORD_NAMESPACE, "w:ind", {
    "w:leftChars": String(style.blockQuote.leftIndentChars * 100)
  });
  appendElement(quotePPr, WORD_NAMESPACE, "w:shd", {
    "w:val": "clear",
    "w:color": "auto",
    "w:fill": colorValue(style.blockQuote.backgroundColor)
  });
  const quoteBorders = appendElement(
    quotePPr,
    WORD_NAMESPACE,
    "w:pBdr"
  );
  appendElement(quoteBorders, WORD_NAMESPACE, "w:left", {
    "w:val": "single",
    "w:sz": "18",
    "w:space": "6",
    "w:color": colorValue(style.blockQuote.borderColor)
  });
  setRunStyle(
    ensureDirectElement(quote, WORD_NAMESPACE, "w:rPr"),
    {
      fonts: style.body.fonts,
      sizePt: style.body.sizePt,
      color: style.blockQuote.color,
      italic: style.blockQuote.italic
    }
  );
}

function applyTableAndCaption(
  styles: XmlElement,
  style: ResolvedDocxThemeStyle
) {
  const table = ensureStyle(styles, "Table", "table", "TableNormal");
  const tblPr = ensureDirectElement(
    table,
    WORD_NAMESPACE,
    "w:tblPr"
  );
  removeDirectChildren(
    tblPr,
    WORD_NAMESPACE,
    "tblW",
    "tblCellMar",
    "tblBorders"
  );
  const margins = appendElement(
    tblPr,
    WORD_NAMESPACE,
    "w:tblCellMar"
  );
  const cellMargin = String(
    millimetersToTwips(style.table.cellMarginMm)
  );
  for (const side of ["top", "left", "bottom", "right"]) {
    appendElement(margins, WORD_NAMESPACE, `w:${side}`, {
      "w:w": cellMargin,
      "w:type": "dxa"
    });
  }
  const borders = appendElement(
    tblPr,
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
  ]) {
    appendElement(borders, WORD_NAMESPACE, `w:${side}`, {
      "w:val": "single",
      "w:sz": "4",
      "w:space": "0",
      "w:color": colorValue(style.table.borderColor)
    });
  }
  setRunStyle(
    ensureDirectElement(table, WORD_NAMESPACE, "w:rPr"),
    {
      fonts: style.table.fonts,
      sizePt: style.table.sizePt,
      color: style.table.color
    }
  );
  let firstRow = directChildren(
    table,
    WORD_NAMESPACE,
    "tblStylePr"
  ).find(
    (element) =>
      element.getAttributeNS(WORD_NAMESPACE, "type") === "firstRow"
  );
  if (!firstRow) {
    firstRow = appendElement(
      table,
      WORD_NAMESPACE,
      "w:tblStylePr",
      { "w:type": "firstRow" }
    );
  }
  setRunStyle(
    ensureDirectElement(firstRow, WORD_NAMESPACE, "w:rPr"),
    {
      fonts: style.table.fonts,
      sizePt: style.table.sizePt,
      color: style.table.headerColor,
      bold: true
    }
  );
  const cellProperties = ensureDirectElement(
    firstRow,
    WORD_NAMESPACE,
    "w:tcPr"
  );
  removeDirectChildren(cellProperties, WORD_NAMESPACE, "shd");
  appendElement(cellProperties, WORD_NAMESPACE, "w:shd", {
    "w:val": "clear",
    "w:color": "auto",
    "w:fill": colorValue(style.table.headerBackgroundColor)
  });

  for (const styleId of ["Caption", "TableCaption", "ImageCaption"]) {
    const caption = ensureStyle(
      styles,
      styleId,
      "paragraph",
      styleId === "Caption" ? "Normal" : "Caption"
    );
    const pPr = ensureDirectElement(
      caption,
      WORD_NAMESPACE,
      "w:pPr"
    );
    setParagraphSpacing(pPr, {
      beforePt: 3,
      afterPt: 6,
      fontSizePt: style.caption.sizePt,
      lineSpacing: 1.25
    });
    removeDirectChildren(pPr, WORD_NAMESPACE, "jc");
    appendElement(pPr, WORD_NAMESPACE, "w:jc", {
      "w:val":
        styleId === "ImageCaption" ? "center" : style.caption.alignment
    });
    setRunStyle(
      ensureDirectElement(caption, WORD_NAMESPACE, "w:rPr"),
      {
        fonts: style.caption.fonts,
        sizePt: style.caption.sizePt,
        color: style.caption.color,
        italic: style.caption.italic
      }
    );
  }

  const hyperlink = ensureStyle(
    styles,
    "Hyperlink",
    "character",
    "BodyTextChar"
  );
  setRunStyle(
    ensureDirectElement(hyperlink, WORD_NAMESPACE, "w:rPr"),
    {
      color: style.hyperlink.color,
      underline: style.hyperlink.underline
    }
  );
}

function applyTableTokenStyles(
  styles: XmlElement,
  slots: ReadonlyMap<
    DocxStyleSlotName,
    { style: DocxSlotStyleToken }
  >,
  fallback: ResolvedDocxThemeStyle
) {
  const tableToken = slots.get("table")?.style;
  const cellToken =
    slots.get("table-cell")?.style ?? tableToken;
  const headerToken =
    slots.get("table-header")?.style ?? cellToken;
  if (!tableToken && !cellToken && !headerToken) {
    return;
  }
  const table = ensureStyle(
    styles,
    "Table",
    "table",
    "TableNormal"
  );
  const tblPr = ensureDirectElement(
    table,
    WORD_NAMESPACE,
    "w:tblPr"
  );
  removeDirectChildren(tblPr, WORD_NAMESPACE, "tblW");
  const padding = cellToken?.paddingPt ?? tableToken?.paddingPt;
  if (padding) {
    removeDirectChildren(tblPr, WORD_NAMESPACE, "tblCellMar");
    const margins = appendElement(
      tblPr,
      WORD_NAMESPACE,
      "w:tblCellMar"
    );
    for (const side of [
      "top",
      "right",
      "bottom",
      "left"
    ] as const) {
      appendElement(margins, WORD_NAMESPACE, `w:${side}`, {
        "w:w": pointsToTwips(padding[side]),
        "w:type": "dxa"
      });
    }
  }
  const tableBorders =
    tableToken?.borders || cellToken?.borders
      ? {
          ...cellToken?.borders,
          ...tableToken?.borders
        }
      : undefined;
  if (tableBorders) {
    removeDirectChildren(tblPr, WORD_NAMESPACE, "tblBorders");
    const borders = appendElement(
      tblPr,
      WORD_NAMESPACE,
      "w:tblBorders"
    );
    for (const side of [
      "top",
      "right",
      "bottom",
      "left"
    ] as const) {
      const border = tableBorders[side];
      if (!border) {
        continue;
      }
      appendElement(borders, WORD_NAMESPACE, `w:${side}`, {
        "w:val": border.style,
        "w:sz": String(Math.round(border.widthPt * 8)),
        "w:space": "0",
        "w:color": colorValue(border.color)
      });
    }
    const insideHorizontal =
      cellToken?.borders?.top ?? cellToken?.borders?.bottom;
    const insideVertical =
      cellToken?.borders?.left ?? cellToken?.borders?.right;
    for (const [side, border] of [
      ["insideH", insideHorizontal],
      ["insideV", insideVertical]
    ] as const) {
      if (!border) {
        continue;
      }
      appendElement(borders, WORD_NAMESPACE, `w:${side}`, {
        "w:val": border.style,
        "w:sz": String(Math.round(border.widthPt * 8)),
        "w:space": "0",
        "w:color": colorValue(border.color)
      });
    }
  }
  if (cellToken) {
    applyTokenRunStyle(
      ensureDirectElement(table, WORD_NAMESPACE, "w:rPr"),
      cellToken,
      fallback.table.fonts
    );
  }
  let firstRow = directChildren(
    table,
    WORD_NAMESPACE,
    "tblStylePr"
  ).find(
    (element) =>
      element.getAttributeNS(WORD_NAMESPACE, "type") === "firstRow"
  );
  if (!firstRow) {
    firstRow = appendElement(
      table,
      WORD_NAMESPACE,
      "w:tblStylePr",
      { "w:type": "firstRow" }
    );
  }
  if (headerToken) {
    applyTokenRunStyle(
      ensureDirectElement(firstRow, WORD_NAMESPACE, "w:rPr"),
      headerToken,
      fallback.table.fonts
    );
    if (headerToken.backgroundColor !== undefined) {
      const tcPr = ensureDirectElement(
        firstRow,
        WORD_NAMESPACE,
        "w:tcPr"
      );
      removeDirectChildren(tcPr, WORD_NAMESPACE, "shd");
      appendElement(tcPr, WORD_NAMESPACE, "w:shd", {
        "w:val": "clear",
        "w:color": "auto",
        "w:fill": colorValue(
          headerToken.backgroundColor
        )
      });
    }
  }
}

function applyTokenStyles(
  styles: XmlElement,
  tokens: DocxThemeTokenSet,
  fallback: ResolvedDocxThemeStyle
) {
  const slots = createDocxTokenSlotMap(tokens);
  const documentToken = slots.get("document")?.style;
  if (documentToken) {
    const defaults = firstDirectChild(
      styles,
      WORD_NAMESPACE,
      "docDefaults"
    );
    if (defaults) {
      applyTokenRunStyle(
        ensureDirectElement(
          ensureDirectElement(
            defaults,
            WORD_NAMESPACE,
            "w:rPrDefault"
          ),
          WORD_NAMESPACE,
          "w:rPr"
        ),
        documentToken,
        fallback.body.fonts
      );
      applyTokenParagraphStyle(
        ensureDirectElement(
          ensureDirectElement(
            defaults,
            WORD_NAMESPACE,
            "w:pPrDefault"
          ),
          WORD_NAMESPACE,
          "w:pPr"
        ),
        documentToken,
        documentToken.fontSizePt ?? fallback.body.sizePt
      );
    }
  }
  for (const [slot, entry] of slots) {
    const bindings = DOCX_SLOT_WORD_STYLE_BINDINGS[slot];
    if (!bindings) {
      continue;
    }
    for (const binding of bindings) {
      const target = ensureStyle(
        styles,
        binding.styleId,
        binding.type,
        binding.basedOn
      );
      if (binding.type === "paragraph") {
        const paragraphToken =
          binding.styleId === "ImageCaption"
            ? { ...entry.style, alignment: "center" as const }
            : entry.style;
        const paragraphProperties = ensureDirectElement(
          target,
          WORD_NAMESPACE,
          "w:pPr"
        );
        // SourceCode 的主题令牌来自浏览器完整计算样式。背景透明时，
        // normalizer 会省略 backgroundColor；这里必须先清除基础模板的
        // 兜底底纹，否则模板灰底会泄漏成主题代码块的整段背景。
        if (binding.styleId === "SourceCode") {
          removeDirectChildren(
            paragraphProperties,
            WORD_NAMESPACE,
            "shd"
          );
        }
        applyTokenParagraphStyle(
          paragraphProperties,
          paragraphToken,
          fallbackFontSizeForSlot(slot, fallback),
          binding.styleId === "SourceCode"
        );
      }
      const runToken = binding.styleId === "SourceCode"
        ? slots.get("code-block-text")?.style ?? entry.style
        : entry.style;
      const runProperties = ensureDirectElement(
        target,
        WORD_NAMESPACE,
        "w:rPr"
      );
      if (binding.styleId === "SourceCode") {
        removeDirectChildren(
          runProperties,
          WORD_NAMESPACE,
          "shd"
        );
      }
      applyTokenRunStyle(
        runProperties,
        runToken,
        fallbackFontsForSlot(slot, fallback),
        binding.styleId === "SourceCode" ||
          slot === "inline-code" ||
          slot === "code-block" ||
          slot === "code-block-text" ||
          slot.startsWith("code-token-")
      );
    }
  }
  const codeTextToken =
    slots.get("code-block-text")?.style ??
    slots.get("code-block")?.style;
  if (codeTextToken) {
    const baseStyleId = "MdSourceCodeChar";
    const baseStyle = ensureStyle(
      styles,
      baseStyleId,
      "character",
      "BodyTextChar"
    );
    applyTokenRunStyle(
      ensureDirectElement(baseStyle, WORD_NAMESPACE, "w:rPr"),
      codeTextToken,
      {
        ...fallback.code.fonts,
        eastAsia: fallback.body.fonts.eastAsia
      },
      true
    );
    for (const styleId of PANDOC_SYNTAX_STYLE_IDS) {
      const target = ensureStyle(
        styles,
        styleId,
        "character",
        baseStyleId
      );
      const basedOn = firstDirectChild(
        target,
        WORD_NAMESPACE,
        "basedOn"
      );
      if (basedOn) {
        setWordAttribute(basedOn, "val", baseStyleId);
      }
      const syntaxSlot = resolvePandocSyntaxStyleSlot(styleId);
      const syntaxToken = syntaxSlot
        ? slots.get(syntaxSlot)?.style
        : undefined;
      if (syntaxToken) {
        applyTokenRunStyle(
          ensureDirectElement(target, WORD_NAMESPACE, "w:rPr"),
          syntaxToken,
          {
            ...fallback.code.fonts,
            eastAsia: fallback.body.fonts.eastAsia
          },
          true
        );
      }
    }
  }
  applyTableTokenStyles(styles, slots, fallback);
}

export function transformStylesXml(
  content: Uint8Array,
  style: ResolvedDocxThemeStyle,
  tokens?: DocxThemeTokenSet
) {
  const document = parseXmlPart(content, "word/styles.xml");
  const styles = document.documentElement!;
  if (
    styles.namespaceURI !== WORD_NAMESPACE ||
    styles.localName !== "styles"
  ) {
    throw new Error("word/styles.xml 根元素无效");
  }
  applyBodyStyle(styles, style);
  applyHeadings(styles, style);
  applyCodeAndQuote(styles, style);
  applyTableAndCaption(styles, style);
  if (tokens) {
    applyTokenStyles(styles, tokens, style);
  }
  return serializeXmlPart(document);
}

export function transformFontTableXml(
  content: Uint8Array,
  style: ResolvedDocxThemeStyle,
  tokens?: DocxThemeTokenSet
) {
  const document = parseXmlPart(content, "word/fontTable.xml");
  const root = document.documentElement!;
  const requiredFonts = new Set<string>();
  for (const fonts of [
    style.body.fonts,
    style.headings.fonts,
    style.code.fonts,
    style.table.fonts,
    style.caption.fonts
  ]) {
    requiredFonts.add(fonts.latin);
    requiredFonts.add(fonts.eastAsia);
    if (fonts.complexScript) {
      requiredFonts.add(fonts.complexScript);
    }
  }
  if (tokens) {
    for (const font of collectDocxTokenFonts(tokens)) {
      requiredFonts.add(font);
    }
  }
  const existing = new Set(
    Array.from(
      root.getElementsByTagNameNS(WORD_NAMESPACE, "font")
    ).map((element) => element.getAttributeNS(WORD_NAMESPACE, "name"))
  );
  for (const name of requiredFonts) {
    if (!existing.has(name)) {
      const font = appendElement(root, WORD_NAMESPACE, "w:font", {
        "w:name": name
      });
      appendElement(font, WORD_NAMESPACE, "w:family", {
        "w:val": name === style.code.fonts.latin ? "modern" : "auto"
      });
    }
  }
  return serializeXmlPart(document);
}

export function transformThemeFontsXml(
  content: Uint8Array,
  style: ResolvedDocxThemeStyle,
  tokens?: DocxThemeTokenSet
) {
  const document = parseXmlPart(content, "word/theme/theme1.xml");
  const slots = tokens
    ? createDocxTokenSlotMap(tokens)
    : undefined;
  const headingFonts = resolveTokenFonts(
    slots?.get("heading-1")?.style,
    style.headings.fonts
  );
  const bodyFonts = resolveTokenFonts(
    slots?.get("paragraph")?.style ??
      slots?.get("document")?.style,
    style.body.fonts
  );
  for (const schemeName of ["majorFont", "minorFont"]) {
    const scheme = document.getElementsByTagNameNS(
      DRAWING_NAMESPACE,
      schemeName
    )[0];
    if (!scheme) {
      continue;
    }
    const latin = scheme.getElementsByTagNameNS(
      DRAWING_NAMESPACE,
      "latin"
    )[0];
    const eastAsia = scheme.getElementsByTagNameNS(
      DRAWING_NAMESPACE,
      "ea"
    )[0];
    latin?.setAttribute(
      "typeface",
      schemeName === "majorFont"
        ? headingFonts.latin
        : bodyFonts.latin
    );
    eastAsia?.setAttribute(
      "typeface",
      schemeName === "majorFont"
        ? headingFonts.eastAsia
        : bodyFonts.eastAsia
    );
  }
  return serializeXmlPart(document);
}
