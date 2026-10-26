import {
  DOCX_MEDIA_RASTER_SCALE,
  MAXIMUM_DOCX_MEDIA_EDGE_PIXELS,
  MAXIMUM_DOCX_MEDIA_COUNT,
  MAXIMUM_DOCX_MEDIA_PIXELS,
  type DocxMediaCapturePlan,
  type DocxMediaCaptureTarget,
  type DocxMediaAlignment,
  type DocxMediaKind,
  type DocxDocumentLayoutPlan,
  type DocxEmojiRunLayout,
  type DocxInlineCodeLayout,
  type DocxListItemLayout,
  type DocxTableLayout,
  type DocxTextBlockLayout,
  type PagedDocumentPayload
} from "@morphdoc/core";
import { PagedDocumentRuntime } from "./paged-document-runtime.js";
import { stabilizePagedTableColumns } from "./paged-table-handler.js";

export interface DocxMediaRenderDimensions {
  contentWidthPx: number;
  contentHeightPx: number;
}

export type DocxTableGeometry = Pick<
  DocxTableLayout,
  "ordinal" | "widthPercent" | "leftOffsetPercent" |
    "columnWidthPercents"
>;

declare global {
  interface Window {
    __morphDocRenderDocxMedia?: (
      payload: PagedDocumentPayload,
      dimensions: DocxMediaRenderDimensions
    ) => Promise<DocxMediaCapturePlan>;
  }
}

function finitePositive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getMediaKind(element: Element): DocxMediaKind {
  if (element.matches("img.md-document-image")) {
    return "image";
  }
  if (element.closest(".md-echarts")) {
    return "echarts";
  }
  return "mermaid";
}

function getCaption(element: Element) {
  return (
    element
      .closest("figure")
      ?.querySelector("figcaption")
      ?.textContent?.trim() || undefined
  );
}

function getAltText(
  element: Element,
  kind: DocxMediaKind,
  kindOrdinal: number
) {
  if (element instanceof HTMLImageElement) {
    return element.alt.trim() || `图片 ${kindOrdinal}`;
  }
  const labelled =
    element.getAttribute("aria-label")?.trim() ||
    element
      .closest<HTMLElement>("[aria-label]")
      ?.getAttribute("aria-label")
      ?.trim();
  if (labelled) {
    return labelled;
  }
  return kind === "echarts"
    ? `ECharts 图表 ${kindOrdinal}`
    : `Mermaid 图表 ${kindOrdinal}`;
}

function fitElementToContent(
  element: HTMLElement | SVGSVGElement,
  dimensions: DocxMediaRenderDimensions
) {
  const initial = element.getBoundingClientRect();
  const width = finitePositive(initial.width, dimensions.contentWidthPx);
  const height = finitePositive(
    initial.height,
    Math.min(dimensions.contentHeightPx, width * 0.75)
  );
  const fitScale = Math.min(
    1,
    dimensions.contentWidthPx / width,
    dimensions.contentHeightPx / height
  );
  if (fitScale < 1) {
    element.style.width = `${width * fitScale}px`;
    element.style.height = `${height * fitScale}px`;
    element.style.maxWidth = "none";
    element.style.maxHeight = "none";
  }
  return element.getBoundingClientRect();
}

function getMediaAlignment(
  article: HTMLElement,
  rect: DOMRect
): DocxMediaAlignment {
  const articleRect = article.getBoundingClientRect();
  const articleWidth = finitePositive(articleRect.width, rect.width);
  if (rect.width >= articleWidth - 2) {
    return "center";
  }

  const leftScore = Math.abs(rect.left - articleRect.left);
  const centerScore = Math.abs(
    (rect.left + rect.right) / 2 -
      (articleRect.left + articleRect.right) / 2
  );
  const rightScore = Math.abs(articleRect.right - rect.right);
  const minimumScore = Math.min(
    leftScore,
    centerScore,
    rightScore
  );
  if (centerScore <= minimumScore + 2) {
    return "center";
  }
  return leftScore <= rightScore ? "left" : "right";
}

function getRasterScale(width: number, height: number) {
  return Math.min(
    DOCX_MEDIA_RASTER_SCALE,
    MAXIMUM_DOCX_MEDIA_EDGE_PIXELS / width,
    MAXIMUM_DOCX_MEDIA_EDGE_PIXELS / height,
    Math.sqrt(MAXIMUM_DOCX_MEDIA_PIXELS / (width * height))
  );
}

function createGeometryCss(dimensions: DocxMediaRenderDimensions) {
  return `
#preview-root {
  width: ${dimensions.contentWidthPx}px !important;
  padding: 0 !important;
}

#write {
  width: ${dimensions.contentWidthPx}px !important;
  padding: 0 !important;
  box-shadow: none !important;
}
`;
}

function average(values: readonly number[], fallback: number) {
  return values.length > 0
    ? values.reduce((total, value) => total + value, 0) / values.length
    : fallback;
}

function collectTableColumnWidths(table: HTMLTableElement, tableRect: DOMRect) {
  const stabilizedColumns = Array.from(
    table.querySelectorAll<HTMLTableColElement>(
      ":scope > colgroup[data-stabilized-columns=\"true\"] > col"
    )
  );
  const stabilizedWidths = stabilizedColumns.map((column) =>
    Number(column.dataset.stabilizedWidthPx)
  );
  if (
    stabilizedWidths.length > 0 &&
    stabilizedWidths.every((width) => Number.isFinite(width) && width > 0)
  ) {
    // 这组轨道来自分页前的完整自动布局。后续为稳定 Paged.js 克隆
    // 写入的 col/cell 辅助宽度可能反过来扰动源表二次测量，DOCX 必须
    // 使用最初与 Chromium 分页基线一致的列轨，而不是辅助样式后的值。
    return stabilizedWidths;
  }
  const rows = Array.from(table.rows);
  const columnCount = rows.reduce(
    (maximum, row) =>
      Math.max(
        maximum,
        Array.from(row.cells).reduce(
          (total, cell) => total + Math.max(1, cell.colSpan),
          0
        )
      ),
    0
  );
  if (columnCount < 1) {
    return [tableRect.width];
  }
  const boundaries = Array.from(
    { length: columnCount + 1 },
    () => [] as number[]
  );
  boundaries[0]!.push(0);
  boundaries[columnCount]!.push(tableRect.width);
  for (const row of rows) {
    let column = 0;
    for (const cell of Array.from(row.cells)) {
      const span = Math.max(1, cell.colSpan);
      const rect = cell.getBoundingClientRect();
      boundaries[column]?.push(
        Math.max(0, Math.min(tableRect.width, rect.left - tableRect.left))
      );
      column = Math.min(columnCount, column + span);
      boundaries[column]?.push(
        Math.max(0, Math.min(tableRect.width, rect.right - tableRect.left))
      );
    }
  }
  const resolved = boundaries.map((samples, index) =>
    average(samples, (tableRect.width * index) / columnCount)
  );
  resolved[0] = 0;
  resolved[columnCount] = tableRect.width;
  for (let index = 1; index < resolved.length; index += 1) {
    resolved[index] = Math.max(
      resolved[index - 1]! + 0.01,
      resolved[index]!
    );
  }
  return resolved.slice(1).map(
    (boundary, index) => boundary - resolved[index]!
  );
}

function cssColor(value: string) {
  const match = value.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)$/iu
  );
  if (!match) {
    return undefined;
  }
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (!Number.isFinite(alpha) || alpha <= 0.01) {
    return undefined;
  }
  return `#${[match[1], match[2], match[3]]
    .map((component) =>
      Math.max(0, Math.min(255, Math.round(Number(component))))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

function effectiveCellBackground(
  cell: HTMLTableCellElement,
  table: HTMLTableElement
) {
  let current: Element | null = cell;
  while (current) {
    const color = cssColor(getComputedStyle(current).backgroundColor);
    if (color) {
      return color;
    }
    if (current === table) {
      break;
    }
    current = current.parentElement;
  }
  return "#ffffff";
}

function cellAlignment(value: string): "left" | "center" | "right" | "justify" {
  if (value === "center" || value === "right" || value === "justify") {
    return value;
  }
  return "left";
}

const DOCX_TEXT_BLOCK_SELECTOR =
  "h1, h2, h3, h4, h5, h6, p, li, th, td, figcaption, " +
  ".md-alert-text, .doc-classification, .doc-issue-row, .doc-printing-row, " +
  ".doc-briefing-meta";

function textNodeCharacters(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const characters: Array<{
    node: Text;
    start: number;
    end: number;
    character: string;
  }> = [];
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    let offset = 0;
    for (const character of Array.from(node.data)) {
      const end = offset + character.length;
      characters.push({ node, start: offset, end, character });
      offset = end;
    }
    current = walker.nextNode();
  }
  return characters;
}

function characterRect(
  range: Range,
  character: ReturnType<typeof textNodeCharacters>[number]
) {
  if (typeof range.getBoundingClientRect !== "function") {
    return undefined;
  }
  range.setStart(character.node, character.start);
  range.setEnd(character.node, character.end);
  const rect = range.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : undefined;
}

function hasDistributedLastLine(
  _element: HTMLElement,
  computed: CSSStyleDeclaration,
  _lastLine: readonly DOMRect[]
) {
  const textAlignLast = computed.textAlignLast.trim().toLowerCase();
  return textAlignLast === "justify" || textAlignLast === "distribute";
}

export function collectDocxTextBlockLayouts(
  article: HTMLElement
): DocxTextBlockLayout[] {
  const articleRect = article.getBoundingClientRect();
  const candidates = Array.from(
    article.querySelectorAll<HTMLElement>(DOCX_TEXT_BLOCK_SELECTOR)
  ).filter((element) => {
    if (element.closest('[data-semantic-region="cover"], pre')) {
      return false;
    }
    if (element.querySelector("br")) {
      return false;
    }
    return !Array.from(
      element.querySelectorAll<HTMLElement>(DOCX_TEXT_BLOCK_SELECTOR)
    ).some((descendant) => descendant !== element);
  });
  return candidates.flatMap((element, index) => {
    const range = document.createRange();
    const output: string[] = [];
    const lineBreakOffsets: number[] = [];
    const lineCharacterRects: DOMRect[][] = [];
    let previousLineTop: number | undefined;
    let previousLineHeight = 0;
    let pendingWhitespace = false;
    for (const character of textNodeCharacters(element)) {
      if (/\s/u.test(character.character)) {
        pendingWhitespace = output.length > 0;
        continue;
      }
      const rect = characterRect(range, character);
      if (!rect) {
        continue;
      }
      if (pendingWhitespace && output.length > 0) {
        output.push(" ");
      }
      pendingWhitespace = false;
      if (
        previousLineTop !== undefined &&
        Math.abs(rect.top - previousLineTop) >
          Math.max(1, Math.min(previousLineHeight, rect.height) * 0.25)
      ) {
        const offset = output.length;
        if (offset > 0 && lineBreakOffsets.at(-1) !== offset) {
          lineBreakOffsets.push(offset);
        }
        lineCharacterRects.push([]);
      } else if (lineCharacterRects.length === 0) {
        lineCharacterRects.push([]);
      }
      lineCharacterRects.at(-1)!.push(rect);
      output.push(character.character.normalize("NFKC"));
      previousLineTop = rect.top;
      previousLineHeight = rect.height;
    }
    const text = output.join("").trim();
    const computed = getComputedStyle(element);
    const alert = element.closest<HTMLElement>(".md-alert");
    const alertRole = element.matches(".md-alert-text")
      ? "title" as const
      : alert
        ? "body" as const
        : undefined;
    const alertRect = alert?.getBoundingClientRect();
    const alertComputed = alert ? getComputedStyle(alert) : undefined;
    const alertLeft = alertRect && alertComputed
      ? alertRect.left +
        Number.parseFloat(alertComputed.borderLeftWidth || "0") +
        Number.parseFloat(alertComputed.paddingLeft || "0")
      : undefined;
    const alertRight = alertRect && alertComputed
      ? alertRect.right -
        Number.parseFloat(alertComputed.borderRightWidth || "0") -
        Number.parseFloat(alertComputed.paddingRight || "0")
      : undefined;
    const letterSpacingPx = computed.letterSpacing === "normal"
      ? 0
      : Number.parseFloat(computed.letterSpacing);
    const lastLine = lineCharacterRects.at(-1) ?? [];
    const distributed = hasDistributedLastLine(
      element,
      computed,
      lastLine
    );
    const lineTops = lineCharacterRects
      .map((rects) => rects.length > 0
        ? Math.min(...rects.map((rect) => rect.top))
        : undefined)
      .filter((top): top is number => top !== undefined);
    const linePitchPx = lineTops.length > 1
      ? lineTops.slice(1).reduce(
          (sum, top, lineIndex) => sum + top - lineTops[lineIndex]!,
          0
        ) / (lineTops.length - 1)
      : undefined;
    return text
      ? [{
          ordinal: index + 1,
          text,
          letterSpacingPt: Number.isFinite(letterSpacingPx)
            ? letterSpacingPx * 0.75
            : 0,
          ...(alertRole && alertLeft !== undefined && alertRight !== undefined
            ? {
                alertRole,
                fontSizePt: cssPixelsToPoints(computed.fontSize),
                bold: computed.fontWeight === "bold" ||
                  Number.parseInt(computed.fontWeight, 10) >= 600,
                italic: computed.fontStyle === "italic" ||
                  computed.fontStyle === "oblique",
                color: cssColor(computed.color) ?? "#000000",
                leftIndentPt: Math.max(0, (alertLeft - articleRect.left) * 0.75),
                rightIndentPt: Math.max(0, (articleRect.right - alertRight) * 0.75)
              }
            : {}),
          alignment: distributed
            ? "distribute" as const
            : cellAlignment(computed.textAlign),
          ...(linePitchPx !== undefined && linePitchPx > 0
            ? { linePitchPt: linePitchPx * 0.75 }
            : {}),
          lineBreakOffsets
        }]
      : [];
  });
}

function listItemCharacters(item: HTMLLIElement) {
  return textNodeCharacters(item).filter(({ node }) => {
    const parent = node.parentElement;
    const nestedList = parent?.closest("ul, ol");
    return nestedList === item.parentElement;
  });
}

export function collectDocxListItemLayouts(
  article: HTMLElement
): DocxListItemLayout[] {
  const articleLeft = article.getBoundingClientRect().left;
  return Array.from(article.querySelectorAll<HTMLLIElement>("li")).flatMap(
    (item, index) => {
      const range = document.createRange();
      const characters = listItemCharacters(item);
      const text = characters
        .map(({ character }) => character)
        .join("")
        .replace(/\s+/gu, " ")
        .trim()
        .normalize("NFKC");
      const firstVisibleCharacter = characters.find(
        (character) =>
          !/\s/u.test(character.character) &&
          characterRect(range, character) !== undefined
      );
      if (!text || !firstVisibleCharacter) {
        return [];
      }
      const rect = characterRect(range, firstVisibleCharacter);
      if (!rect) {
        return [];
      }
      const visibleRects = characters.flatMap((character) => {
        const characterBounds = characterRect(range, character);
        return characterBounds ? [characterBounds] : [];
      });
      const lastLineTop = visibleRects.length > 0
        ? Math.max(...visibleRects.map((bounds) => bounds.top))
        : 0;
      const lastLine = visibleRects.filter(
        (bounds) => Math.abs(bounds.top - lastLineTop) <= 1
      );
      const computed = getComputedStyle(item);
      const distributed = hasDistributedLastLine(item, computed, lastLine);
      let listDepth = -1;
      for (
        let ancestor: Element | null = item.parentElement;
        ancestor && article.contains(ancestor);
        ancestor = ancestor.parentElement
      ) {
        if (ancestor.matches("ul, ol")) {
          listDepth += 1;
        }
      }
      return [{
        ordinal: index + 1,
        text,
        depth: Math.max(0, listDepth),
        textStartPt: Math.max(
          0,
          (rect.left - articleLeft) * 0.75
        ),
        ...(distributed ? { alignment: "distribute" as const } : {})
      }];
    }
  );
}

function cssPixelsToPoints(value: string) {
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) ? pixels * 0.75 : 0;
}

const EMOJI_ONLY_TEXT = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200d|\ufe0f|\s)+$/u;

function sampledEmojiColor(text: string, computed: CSSStyleDeclaration) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return undefined;
  }
  context.font = computed.font;
  const metrics = context.measureText(text);
  const fontSize = Math.max(12, Number.parseFloat(computed.fontSize) || 16);
  canvas.width = Math.max(1, Math.ceil(metrics.width + fontSize));
  canvas.height = Math.max(1, Math.ceil(fontSize * 2));
  const renderContext = canvas.getContext("2d", { willReadFrequently: true });
  if (!renderContext) {
    return undefined;
  }
  renderContext.clearRect(0, 0, canvas.width, canvas.height);
  renderContext.font = computed.font;
  renderContext.textBaseline = "middle";
  renderContext.fillStyle = computed.color;
  renderContext.fillText(text, fontSize / 2, canvas.height / 2);
  const pixels = renderContext.getImageData(
    0,
    0,
    canvas.width,
    canvas.height
  ).data;
  const histogram = new Map<string, number>();
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] ?? 0;
    if (alpha < 96) {
      continue;
    }
    const red = pixels[index] ?? 0;
    const green = pixels[index + 1] ?? 0;
    const blue = pixels[index + 2] ?? 0;
    if (Math.max(red, green, blue) - Math.min(red, green, blue) < 16) {
      continue;
    }
    const key = [red, green, blue]
      .map((value) => Math.round(value / 8) * 8)
      .join(",");
    histogram.set(key, (histogram.get(key) ?? 0) + alpha);
  }
  const dominant = Array.from(histogram.entries()).sort(
    ([, left], [, right]) => right - left
  )[0]?.[0];
  if (!dominant) {
    return undefined;
  }
  const channels = dominant.split(",").map(Number);
  if (channels.length !== 3 || channels.some((value) => !Number.isFinite(value))) {
    return undefined;
  }
  return `#${channels
    .map((value) => Math.min(255, value).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function collectDocxEmojiRunLayouts(
  article: HTMLElement
): DocxEmojiRunLayout[] {
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  const layouts: DocxEmojiRunLayout[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? "").normalize("NFC").trim();
    const parent = node.parentElement;
    if (!text || !parent || !EMOJI_ONLY_TEXT.test(text)) {
      continue;
    }
    const color = sampledEmojiColor(text, getComputedStyle(parent));
    if (!color) {
      continue;
    }
    layouts.push({ ordinal: layouts.length + 1, text, color });
  }
  return layouts;
}

export function collectDocxInlineCodeLayouts(
  article: HTMLElement
): DocxInlineCodeLayout[] {
  return Array.from(
    article.querySelectorAll<HTMLElement>("code")
  ).filter(
    (element) =>
      !element.closest("pre, .md-code-pagination-chunk")
  ).flatMap((element, index) => {
    const text = (element.textContent ?? "").normalize("NFKC");
    if (!text) {
      return [];
    }
    const computed = getComputedStyle(element);
    const fontSizePt = cssPixelsToPoints(computed.fontSize);
    if (fontSizePt <= 0) {
      return [];
    }
    const color = cssColor(computed.color) ?? "#000000";
    const backgroundColor = cssColor(computed.backgroundColor);
    return [{
      ordinal: index + 1,
      text,
      fontSizePt,
      letterSpacingPt: computed.letterSpacing === "normal"
        ? 0
        : cssPixelsToPoints(computed.letterSpacing),
      color,
      ...(backgroundColor ? { backgroundColor } : {}),
      paddingPt: {
        top: cssPixelsToPoints(computed.paddingTop),
        right: cssPixelsToPoints(computed.paddingRight),
        bottom: cssPixelsToPoints(computed.paddingBottom),
        left: cssPixelsToPoints(computed.paddingLeft)
      },
      borderPt: {
        top: cssPixelsToPoints(computed.borderTopWidth),
        right: cssPixelsToPoints(computed.borderRightWidth),
        bottom: cssPixelsToPoints(computed.borderBottomWidth),
        left: cssPixelsToPoints(computed.borderLeftWidth)
      }
    }];
  });
}

export function collectDocxDocumentLayoutPlan(
  root: ParentNode,
  dimensions: DocxMediaRenderDimensions
): DocxDocumentLayoutPlan {
  const article = root.querySelector<HTMLElement>("#write");
  if (!article) {
    throw new Error("DOCX 布局舞台缺少 #write 文档容器");
  }
  const articleRect = article.getBoundingClientRect();
  const contentWidth = finitePositive(
    articleRect.width,
    dimensions.contentWidthPx
  );
  const tables = Array.from(
    article.querySelectorAll<HTMLTableElement>("table")
  ).map((table, index): DocxTableLayout => {
    const rect = table.getBoundingClientRect();
    const width = finitePositive(rect.width, contentWidth);
    const columnWidths = collectTableColumnWidths(table, rect);
    const columnTotal = columnWidths.reduce(
      (total, value) => total + value,
      0
    );
    return {
      ordinal: index + 1,
      widthPercent: Math.min(300, (width / contentWidth) * 100),
      leftOffsetPercent: Math.max(
        0,
        Math.min(100, ((rect.left - articleRect.left) / contentWidth) * 100)
      ),
      columnWidthPercents: columnWidths.map(
        (value) => (value / columnTotal) * 100
      ),
      rows: Array.from(table.rows).map((row) => ({
        cells: Array.from(row.cells).map((cell) => {
          const computed = getComputedStyle(cell);
          return {
            columnSpan: Math.max(1, cell.colSpan),
            backgroundColor: effectiveCellBackground(cell, table),
            color: cssColor(computed.color) ?? "#000000",
            bold: Number.parseInt(computed.fontWeight, 10) >= 600 ||
              computed.fontWeight === "bold",
            italic: computed.fontStyle === "italic" ||
              computed.fontStyle === "oblique",
            alignment: cellAlignment(computed.textAlign)
          };
        })
      }))
    };
  });
  const emojiRuns = collectDocxEmojiRunLayouts(article);
  return {
    tables,
    textBlocks: collectDocxTextBlockLayouts(article),
    listItems: collectDocxListItemLayouts(article),
    inlineCodes: collectDocxInlineCodeLayouts(article),
    ...(emojiRuns.length > 0 ? { emojiRuns } : {})
  };
}

export function collectPagedDocxTableGeometries(
  root: ParentNode,
  dimensions: DocxMediaRenderDimensions
): DocxTableGeometry[] {
  const tablesByReference = new Map<string, HTMLTableElement[]>();
  let anonymousTableIndex = 0;
  for (const table of root.querySelectorAll<HTMLTableElement>(
    ".pagedjs_pages table"
  )) {
    const reference = table.dataset.ref ??
      `__anonymous_table_${anonymousTableIndex += 1}`;
    const tables = tablesByReference.get(reference) ?? [];
    tables.push(table);
    tablesByReference.set(reference, tables);
  }
  const geometries: DocxTableGeometry[] = [];
  for (const tables of tablesByReference.values()) {
    const table = tables.reduce((best, candidate) => {
      const visibleArea = (element: HTMLTableElement) => {
        const content = element.closest<HTMLElement>(
          ".pagedjs_area, #write"
        );
        const contentRect = content?.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        if (!contentRect) {
          return Math.max(0, rect.width) * Math.max(0, rect.height);
        }
        const width = Math.max(
          0,
          Math.min(rect.right, contentRect.right) -
            Math.max(rect.left, contentRect.left)
        );
        const height = Math.max(
          0,
          Math.min(rect.bottom, contentRect.bottom) -
            Math.max(rect.top, contentRect.top)
        );
        return width * height;
      };
      return visibleArea(candidate) > visibleArea(best)
        ? candidate
        : best;
    });
    const content = table.closest<HTMLElement>(
      ".pagedjs_area, #write"
    );
    const contentRect = content?.getBoundingClientRect();
    const contentWidth = finitePositive(
      contentRect?.width ?? 0,
      dimensions.contentWidthPx
    );
    const contentLeft = contentRect?.left ?? 0;
    const rect = table.getBoundingClientRect();
    const width = finitePositive(rect.width, contentWidth);
    const columnWidths = collectTableColumnWidths(table, rect);
    const columnTotal = columnWidths.reduce(
      (total, value) => total + value,
      0
    );
    geometries.push({
      ordinal: geometries.length + 1,
      widthPercent: Math.min(300, (width / contentWidth) * 100),
      leftOffsetPercent: Math.max(
        0,
        Math.min(100, ((rect.left - contentLeft) / contentWidth) * 100)
      ),
      columnWidthPercents: columnWidths.map(
        (value) => (value / columnTotal) * 100
      )
    });
  }
  return geometries;
}

export function mergePagedTableGeometries(
  layout: DocxDocumentLayoutPlan,
  pagedGeometries: readonly DocxTableGeometry[]
): DocxDocumentLayoutPlan {
  return {
    ...layout,
    tables: layout.tables.map((table, index) => {
      const geometry = pagedGeometries[index];
      if (
        !geometry ||
        geometry.columnWidthPercents.length !==
          table.columnWidthPercents.length
      ) {
        return table;
      }
      return {
        ...table,
        widthPercent: geometry.widthPercent,
        leftOffsetPercent: geometry.leftOffsetPercent,
        columnWidthPercents: [...geometry.columnWidthPercents]
      };
    })
  };
}

export function collectDocxMediaCaptureTargets(
  root: ParentNode,
  dimensions: DocxMediaRenderDimensions
) {
  const article = root.querySelector<HTMLElement>("#write");
  if (!article) {
    throw new Error("DOCX 媒体舞台缺少 #write 文档容器");
  }
  const candidates = Array.from(
    article.querySelectorAll<HTMLElement | SVGSVGElement>(
      [
        "img.md-document-image",
        ".mermaid:not(.mermaid-error) svg",
        ".md-echarts:not(.md-echarts-error) .md-echarts-host svg"
      ].join(",")
    )
  );
  if (candidates.length > MAXIMUM_DOCX_MEDIA_COUNT) {
    throw new Error(
      `DOCX 媒体数量不能超过 ${MAXIMUM_DOCX_MEDIA_COUNT}`
    );
  }

  const kindOrdinals: Record<DocxMediaKind, number> = {
    image: 0,
    mermaid: 0,
    echarts: 0
  };
  return candidates.map((element, index): DocxMediaCaptureTarget => {
    const kind = getMediaKind(element);
    kindOrdinals[kind] += 1;
    const kindOrdinal = kindOrdinals[kind];
    const rect = fitElementToContent(element, dimensions);
    const width = finitePositive(rect.width, 1);
    const height = finitePositive(rect.height, 1);
    const captureX = Math.max(
      0,
      Math.floor(rect.left + window.scrollX)
    );
    const captureY = Math.max(
      0,
      Math.floor(rect.top + window.scrollY)
    );
    const captureWidth = Math.max(
      1,
      Math.ceil(rect.right + window.scrollX) - captureX
    );
    const captureHeight = Math.max(
      1,
      Math.ceil(rect.bottom + window.scrollY) - captureY
    );
    const id = `docx-media-${index + 1}`;
    element.dataset.docxMediaId = id;
    return {
      id,
      kind,
      ordinal: index + 1,
      kindOrdinal,
      altText: getAltText(element, kind, kindOrdinal),
      ...(getCaption(element)
        ? { caption: getCaption(element) }
        : {}),
      alignment: getMediaAlignment(article, rect),
      displayWidthPx: width,
      displayHeightPx: height,
      captureX,
      captureY,
      captureWidthPx: captureWidth,
      captureHeightPx: captureHeight,
      rasterScale: getRasterScale(captureWidth, captureHeight)
    };
  });
}

export async function renderDocxMediaCapturePlan(
  runtime: PagedDocumentRuntime,
  root: HTMLElement,
  payload: PagedDocumentPayload,
  dimensions: DocxMediaRenderDimensions
): Promise<DocxMediaCapturePlan> {
  const pagedResult = await runtime.render(payload, {
    target: "pdf",
    // DOCX 只消费分页表格的宽度、偏移和列宽比例；完整行结构与样式随后
    // 从连续 DOM 重新采集。Paged.js 偶发丢失边界行时允许几何降级，
    // 正常 PDF 渲染仍保持严格的正文行完整性门禁。
    allowIncompleteTableGeometry: true
  });
  if (!pagedResult) {
    throw new Error("DOCX 分页布局渲染已取消");
  }
  const pagedTableGeometries = collectPagedDocxTableGeometries(
    root,
    dimensions
  );
  const renderResult = await runtime.renderContinuous(payload, {
    geometryCss: createGeometryCss(dimensions),
    themeMedia: "print"
  });
  if (!renderResult) {
    throw new Error("DOCX 媒体渲染已取消");
  }
  stabilizePagedTableColumns(root, dimensions.contentHeightPx);
  const continuousLayout = collectDocxDocumentLayoutPlan(
    root,
    dimensions
  );
  return {
    targets: collectDocxMediaCaptureTargets(root, dimensions),
    echartsErrors: Array.from(new Set([
      ...pagedResult.echartsErrors,
      ...renderResult.echartsErrors
    ])),
    mermaidErrors: Array.from(new Set([
      ...pagedResult.mermaidErrors,
      ...renderResult.mermaidErrors
    ])),
    documentLayout: mergePagedTableGeometries(
      continuousLayout,
      pagedTableGeometries
    )
  };
}
