import type {
  PdfDocumentSnapshot,
  PdfEditableContentLine,
  PdfPointBounds,
  PdfTextItemSnapshot,
  PdfTextLineSnapshot,
  VisualPageSemanticExpectation,
} from "./types.js";

const ZERO_WIDTH_AND_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200d\u2060\ufe0e\ufe0f\ufeff]/gu;
const CJK_RADICAL_VARIANTS = new Map([
  ["⺠", "民"],
  ["⻅", "见"],
  ["⻆", "角"],
  ["⻓", "长"],
  ["⻔", "门"],
  ["⻚", "页"],
  ["⻛", "风"],
  ["⻝", "食"],
  ["⻣", "骨"],
  ["⻋", "车"],
  ["⻬", "齐"],
]);
const PAGE_NUMBER_PATTERNS = [
  /^(?:[-—–]\s*)?\d+(?:\s*[/／]\s*\d+)?(?:\s*[-—–])?$/u,
  /^第\s*\d+\s*页(?:\s*(?:[/／]|共)\s*\d+\s*页)?$/u,
  /^\d+\s*页(?:\s*(?:[/／]|共)\s*\d+\s*页)?$/u,
];

export function normalizePdfText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/戶/gu, "户")
    .replace(/[\u2e80-\u2eff]/gu, (character) =>
      CJK_RADICAL_VARIANTS.get(character) ?? character
    )
    // Chromium、Word 与 WPS 的 PDF 文本层会以不同方式保留弯引号；
    // 统一为 ASCII 只用于可编辑文本定位，不改变栅格视觉比较。
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    // Chromium 的部分 CJK 字体把 Markdown em dash 提取为 horizontal bar；
    // 二者在此仅作为语义定位字符归一，不影响后续栅格视觉比较。
    .replace(/―/gu, "—")
    // Chromium 的部分 CJK 字体会把数字区间中的 en dash 提取为两个
    // ASCII hyphen。只归一数字/百分比区间，避免改写代码中的普通 `--`。
    .replace(/(?<=[\d%])\s*--(?:\s*(?=\d)|\s*$)/gu, "–")
    .replace(ZERO_WIDTH_AND_CONTROL, "")
    .replace(/\u00a0/gu, " ")
    .replace(/[ \t]+/gu, " ")
    .trim();
}

export function normalizePdfContentText(value: string): string {
  return normalizePdfText(value).replace(/\s+/gu, "");
}

export function normalizePdfEditableText(value: string): string {
  return normalizePdfContentText(value).replace(/[☐☑☒•◦▪\uf0b7]/gu, "");
}

function isExpectedHeaderLine(
  line: PdfTextLineSnapshot,
  pageHeightPt: number,
  expectation: VisualPageSemanticExpectation | undefined,
): boolean {
  if (
    !expectation?.headerVisible ||
    line.bounds.y + line.bounds.height / 2 > pageHeightPt * 0.12
  ) {
    return false;
  }
  const lineText = normalizePdfEditableText(line.normalizedText);
  return (expectation.headerSlots ?? []).some((slot) => {
    const slotText = normalizePdfEditableText(slot.text);
    return slotText.length > 0 && lineText.includes(slotText);
  });
}

function isInternalLayoutSpacerLine(line: PdfTextLineSnapshot): boolean {
  return (
    normalizePdfEditableText(line.normalizedText) === "." &&
    line.bounds.height <= 1.5 &&
    line.items.length === 1
  );
}

export function buildPdfEditableContentText(
  snapshot: PdfDocumentSnapshot,
  pageSemantics: readonly VisualPageSemanticExpectation[] = [],
): string {
  return buildPdfEditableContentLines(snapshot, pageSemantics)
    .map((item) => item.normalizedText)
    .join("");
}

export function buildPdfEditableContentLines(
  snapshot: PdfDocumentSnapshot,
  pageSemantics: readonly VisualPageSemanticExpectation[] = [],
): PdfEditableContentLine[] {
  return snapshot.pages.flatMap((page) => {
    const expectation = pageSemantics.find(
      (item) => item.physicalPageNumber === page.pageNumber,
    );
    return page.lines.flatMap((line) => {
      if (
        line.role !== "content" ||
        isExpectedHeaderLine(line, page.heightPt, expectation) ||
        isInternalLayoutSpacerLine(line)
      ) {
        return [];
      }
      const normalizedText = normalizePdfEditableText(line.normalizedText);
      return normalizedText
        ? [{ pageNumber: page.pageNumber, line, normalizedText }]
        : [];
    });
  });
}

function unionBounds(items: readonly PdfTextItemSnapshot[]): PdfPointBounds {
  const left = Math.min(...items.map((item) => item.bounds.x));
  const top = Math.min(...items.map((item) => item.bounds.y));
  const right = Math.max(
    ...items.map((item) => item.bounds.x + item.bounds.width),
  );
  const bottom = Math.max(
    ...items.map((item) => item.bounds.y + item.bounds.height),
  );
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) {
    return value;
  }
  return ((sorted[middle - 1] ?? value) + value) / 2;
}

function mergeInlineScriptGroups(
  sourceGroups: readonly PdfTextItemSnapshot[][],
  typicalHeight: number,
): PdfTextItemSnapshot[][] {
  const groups = sourceGroups.map((group) => [...group]);
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (!group || group.length === 0) {
      continue;
    }
    const groupHeight = median(group.map((item) => item.bounds.height));
    if (groupHeight > typicalHeight * 0.9) {
      continue;
    }
    const groupBounds = unionBounds(group);
    for (const adjacentIndex of [index - 1, index + 1]) {
      const adjacent = groups[adjacentIndex];
      if (!adjacent || adjacent.length === 0) {
        continue;
      }
      const adjacentHeight = median(
        adjacent.map((item) => item.bounds.height),
      );
      if (adjacentHeight < groupHeight / 0.9) {
        continue;
      }
      const adjacentBounds = unionBounds(adjacent);
      const verticalOverlap = Math.min(
        groupBounds.y + groupBounds.height,
        adjacentBounds.y + adjacentBounds.height,
      ) - Math.max(groupBounds.y, adjacentBounds.y);
      const horizontallyContained =
        groupBounds.x >= adjacentBounds.x - typicalHeight * 0.5 &&
        groupBounds.x + groupBounds.width <=
          adjacentBounds.x + adjacentBounds.width + typicalHeight * 0.5;
      // Chromium 会把行末公式按较小字号单独提取；公式片段可能从正文
      // 最后一个字符的右缘开始，并向右超出正文组，因此不能只用“被正文
      // 水平包含”判断同行。仅在两组真实垂直重叠且小字号组紧贴较大字号
      // 组右缘时合并，避免把下一视觉行或相邻表格单元格误并入当前行。
      const adjacentRight = adjacentBounds.x + adjacentBounds.width;
      const touchesAdjacentRight =
        groupBounds.x >= adjacentBounds.x &&
        Math.abs(groupBounds.x - adjacentRight) <= typicalHeight * 0.5;
      if (
        verticalOverlap <= 0 ||
        (!horizontallyContained && !touchesAdjacentRight)
      ) {
        continue;
      }
      adjacent.push(...group);
      groups[index] = [];
      break;
    }
  }
  return groups.filter((group) => group.length > 0);
}

function joinLineItems(items: readonly PdfTextItemSnapshot[]): string {
  let result = "";
  let previous: PdfTextItemSnapshot | undefined;
  for (const item of items) {
    const text = item.normalizedText;
    if (!text) {
      continue;
    }
    if (previous && result) {
      const gap =
        item.bounds.x - (previous.bounds.x + previous.bounds.width);
      const referenceHeight = Math.max(
        1,
        Math.min(previous.bounds.height, item.bounds.height),
      );
      if (
        gap > referenceHeight * 0.24 &&
        !result.endsWith(" ") &&
        !text.startsWith(" ")
      ) {
        result += " ";
      }
    }
    result += text;
    previous = item;
  }
  return normalizePdfText(result);
}

export function isPageNumberLine(
  lineText: string,
  bounds: PdfPointBounds,
  pageHeightPt: number,
): boolean {
  const normalized = normalizePdfText(lineText);
  if (!PAGE_NUMBER_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  const lineMiddle = bounds.y + bounds.height / 2;
  const topBand = pageHeightPt * 0.08;
  const bottomBand = pageHeightPt * 0.85;
  return lineMiddle <= topBand || lineMiddle >= bottomBand;
}

export function aggregatePdfTextLines(
  sourceItems: readonly PdfTextItemSnapshot[],
  pageHeightPt: number,
): PdfTextLineSnapshot[] {
  const sourceOrder = new Map(
    sourceItems.map((item, index) => [item, index] as const),
  );
  const items = sourceItems
    .filter((item) => item.normalizedText.length > 0)
    .sort(
      (left, right) =>
        left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x,
    );
  const typicalHeight = median(items.map((item) => item.bounds.height));
  // Office/WPS 会让同一视觉行内不同字体或单元格的基线产生约 2pt
  // 浮动；按 15% 聚合会把这些片段错误拆行并改变阅读顺序。
  // 20% 仍远小于正常行距，同时能覆盖常见的 10–12pt 字号偏差。
  const baselineTolerance = Math.max(2, typicalHeight * 0.2);
  const initialGroups: PdfTextItemSnapshot[][] = [];

  for (const item of items) {
    const lastGroup = initialGroups.at(-1);
    const lastBaseline = lastGroup
      ? median(lastGroup.map((entry) => entry.baselineY))
      : undefined;
    if (
      lastGroup &&
      lastBaseline !== undefined &&
      Math.abs(item.baselineY - lastBaseline) <= baselineTolerance
    ) {
      lastGroup.push(item);
    } else {
      initialGroups.push([item]);
    }
  }

  const groups = mergeInlineScriptGroups(initialGroups, typicalHeight);

  return groups.map((group) => {
    const sortedItems = [...group].sort(
      (left, right) => {
        const leftRight = left.bounds.x + left.bounds.width;
        const rightRight = right.bounds.x + right.bounds.width;
        const horizontallyOverlapping =
          left.bounds.x < rightRight && right.bounds.x < leftRight;
        // PDF.js 的文本流保留字符阅读顺序，但不同字体的窄标点可能与
        // 相邻全角字符发生水平重叠。此时单纯按 x 排序会把闭引号移到
        // 左括号之后，破坏语义块定位；只对真实重叠片段保留文本流顺序，
        // 其余片段仍按几何位置排序，兼容 Office 表格等非阅读序文本流。
        return horizontallyOverlapping
          ? (sourceOrder.get(left) ?? 0) - (sourceOrder.get(right) ?? 0)
          : left.bounds.x - right.bounds.x;
      },
    );
    const bounds = unionBounds(sortedItems);
    const normalizedText = joinLineItems(sortedItems);
    return {
      text: normalizedText,
      normalizedText,
      bounds,
      baselineY: median(sortedItems.map((item) => item.baselineY)),
      role: isPageNumberLine(normalizedText, bounds, pageHeightPt)
        ? "page-number"
        : "content",
      items: sortedItems,
    };
  });
}

export function buildPageContentText(
  lines: readonly PdfTextLineSnapshot[],
): string {
  return lines
    .filter((line) => line.role === "content")
    .map((line) => line.normalizedText)
    .filter(Boolean)
    .join("\n");
}
