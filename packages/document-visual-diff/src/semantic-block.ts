import { createHash } from "node:crypto";

import { createCanvas, loadImage } from "@napi-rs/canvas";

import { comparePageRasters } from "./raster.js";
import type {
  PdfDocumentSnapshot,
  PdfPageRaster,
  PdfParagraphLayoutComparison,
  PdfPointBounds,
  PdfSemanticBlockVisualComparison,
  PdfSemanticBlockVisualLineComparison,
  VisualDiffIssue,
  VisualDiffThresholds,
} from "./types.js";

const BLOCK_RASTER_HORIZONTAL_PADDING_PT = 4;
const BLOCK_RASTER_VERTICAL_PADDING_PT = 1;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

function assertPngRaster(
  raster: PdfPageRaster,
  description: string,
): void {
  const valid = PNG_SIGNATURE.every(
    (value, index) => raster.png[index] === value,
  );
  if (!valid) {
    const header = Array.from(raster.png.slice(0, 16))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    throw new Error(
      `${description} 不是有效 PNG：${raster.widthPx}x${raster.heightPx}，` +
        `${raster.png.byteLength} 字节，头部 ${header}`,
    );
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function status(issues: readonly VisualDiffIssue[]) {
  return issues.some((issue) => issue.severity === "failure")
    ? ("failed" as const)
    : issues.length > 0
      ? ("warning" as const)
      : ("passed" as const);
}

function normalizeFontFamily(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/^[A-Z]{6}\+/u, "")
    .replace(/["']/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function collectFonts(
  lines: PdfParagraphLayoutComparison["baseline"]["visualLines"],
): string[] {
  return [
    ...new Set(
      lines.flatMap((line) => line.fontFamilies.map(normalizeFontFamily)),
    ),
  ].sort();
}

interface TextLineSpan {
  lineIndex: number;
  start: number;
  end: number;
}

interface ReflowedTextLinePair {
  baselineLineIndex: number;
  candidateLineIndex: number;
  baselineStart: number;
  baselineEnd: number;
  candidateStart: number;
  candidateEnd: number;
}

function buildTextLineSpans(lineTexts: readonly string[]): TextLineSpan[] {
  let offset = 0;
  return lineTexts.map((text, lineIndex) => {
    const start = offset;
    offset += Array.from(text).length;
    return { lineIndex, start, end: offset };
  });
}

function pairReflowedTextLines(
  baselineTexts: readonly string[],
  candidateTexts: readonly string[],
): ReflowedTextLinePair[] {
  const baselineSpans = buildTextLineSpans(baselineTexts);
  const candidateSpans = buildTextLineSpans(candidateTexts);
  return baselineSpans.flatMap((baseline) =>
    candidateSpans.flatMap((candidate) =>
      Math.max(baseline.start, candidate.start) <
          Math.min(baseline.end, candidate.end)
        ? (() => {
            const overlapStart = Math.max(baseline.start, candidate.start);
            const overlapEnd = Math.min(baseline.end, candidate.end);
            return [{
            baselineLineIndex: baseline.lineIndex,
            candidateLineIndex: candidate.lineIndex,
              baselineStart: overlapStart - baseline.start,
              baselineEnd: overlapEnd - baseline.start,
              candidateStart: overlapStart - candidate.start,
              candidateEnd: overlapEnd - candidate.start,
            }];
          })()
        : [],
    ),
  );
}

function sliceTextLineBounds(
  bounds: PdfPointBounds,
  text: string,
  start: number,
  end: number,
): PdfPointBounds {
  const length = Math.max(1, Array.from(text).length);
  const leftRatio = Math.max(0, Math.min(1, start / length));
  const rightRatio = Math.max(leftRatio, Math.min(1, end / length));
  return {
    ...bounds,
    x: bounds.x + bounds.width * leftRatio,
    width: Math.max(0, bounds.width * (rightRatio - leftRatio)),
  };
}

async function cropRaster(
  raster: PdfPageRaster,
  bounds: PdfPointBounds,
): Promise<PdfPageRaster> {
  const pixelsPerPoint = raster.dpi / 72;
  const left = Math.max(
    0,
    Math.floor(
      (bounds.x - BLOCK_RASTER_HORIZONTAL_PADDING_PT) * pixelsPerPoint,
    ),
  );
  const top = Math.max(
    0,
    Math.floor(
      (bounds.y - BLOCK_RASTER_VERTICAL_PADDING_PT) * pixelsPerPoint,
    ),
  );
  const right = Math.min(
    raster.widthPx,
    Math.ceil(
      (bounds.x + bounds.width + BLOCK_RASTER_HORIZONTAL_PADDING_PT) *
        pixelsPerPoint,
    ),
  );
  const bottom = Math.min(
    raster.heightPx,
    Math.ceil(
      (bounds.y + bounds.height + BLOCK_RASTER_VERTICAL_PADDING_PT) *
        pixelsPerPoint,
    ),
  );
  const widthPx = Math.max(1, right - left);
  const heightPx = Math.max(1, bottom - top);
  const source = await loadImage(Buffer.from(raster.png));
  const canvas = createCanvas(widthPx, heightPx);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, widthPx, heightPx);
  context.drawImage(
    source,
    left,
    top,
    widthPx,
    heightPx,
    0,
    0,
    widthPx,
    heightPx,
  );
  const rgba = context.getImageData(0, 0, widthPx, heightPx).data;
  const png = Uint8Array.from(canvas.toBuffer("image/png"));
  return {
    widthPx,
    heightPx,
    dpi: raster.dpi,
    sha256: sha256(png),
    png,
    rgba,
  };
}

async function padRaster(
  raster: PdfPageRaster,
  widthPx: number,
  heightPx: number,
): Promise<PdfPageRaster> {
  if (raster.widthPx === widthPx && raster.heightPx === heightPx) {
    return raster;
  }
  const canvas = createCanvas(widthPx, heightPx);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, widthPx, heightPx);
  if (raster.rgba?.length === raster.widthPx * raster.heightPx * 4) {
    const sourceCanvas = createCanvas(raster.widthPx, raster.heightPx);
    const sourceContext = sourceCanvas.getContext("2d");
    const sourceData = sourceContext.createImageData(
      raster.widthPx,
      raster.heightPx,
    );
    sourceData.data.set(raster.rgba);
    sourceContext.putImageData(sourceData, 0, 0);
    context.drawImage(sourceCanvas, 0, 0);
  } else {
    const source = await loadImage(Buffer.from(raster.png));
    context.drawImage(source, 0, 0);
  }
  const rgba = context.getImageData(0, 0, widthPx, heightPx).data;
  const png = Uint8Array.from(canvas.toBuffer("image/png"));
  return {
    widthPx,
    heightPx,
    dpi: raster.dpi,
    sha256: sha256(png),
    png,
    rgba,
  };
}

function localRasterIssues(
  paragraphIndex: number,
  lineIndex: number,
  blockKind: string | undefined,
  hasInlineCode: boolean,
  metrics: NonNullable<PdfSemanticBlockVisualLineComparison["metrics"]>,
  thresholds: VisualDiffThresholds,
  textReflow: boolean,
): VisualDiffIssue[] {
  const shapeFailed =
    metrics.inkIou < thresholds.minInkIou ||
    metrics.edgeIou < thresholds.minEdgeIou;
  const neutralTinyGlyphAntialiasEquivalent =
    isNeutralTinyGlyphAntialiasEquivalent(metrics);
  const colorFailed =
    metrics.backgroundColorDelta > thresholds.maxBackgroundColorDelta ||
    (metrics.foregroundColorDelta > thresholds.maxForegroundColorDelta &&
      !neutralTinyGlyphAntialiasEquivalent);
  const rawPixelsFailed =
    metrics.meanAbsoluteError > thresholds.maxMeanAbsoluteError ||
    metrics.changedPixelRatio > thresholds.maxChangedPixelRatio;
  const antialiasEquivalent =
    metrics.inkIou >= thresholds.minAntialiasEquivalentInkIou &&
    metrics.edgeIou >= thresholds.minAntialiasEquivalentEdgeIou &&
    !colorFailed;
  const crossEngineRasterEquivalent = isCrossEngineRasterEquivalent(
    metrics,
    textReflow,
    blockKind,
    hasInlineCode,
  );
  const failed = (colorFailed && !crossEngineRasterEquivalent) ||
    (!textReflow && (
    (shapeFailed && !crossEngineRasterEquivalent) ||
    (rawPixelsFailed && !antialiasEquivalent && !crossEngineRasterEquivalent)
  ));
  if (!failed) {
    return [];
  }
  return [
    {
      code: "SEMANTIC_BLOCK_RASTER_MISMATCH",
      severity: "failure",
      message: `第 ${paragraphIndex + 1} 个语义块的第 ${lineIndex + 1} 行局部视觉差异超限`,
      details: {
        paragraphIndex,
        lineIndex,
        meanAbsoluteError: metrics.meanAbsoluteError,
        changedPixelRatio: metrics.changedPixelRatio,
        inkIou: metrics.inkIou,
        edgeIou: metrics.edgeIou,
        backgroundColorDelta: metrics.backgroundColorDelta,
        foregroundColorDelta: metrics.foregroundColorDelta,
        antialiasEquivalent,
        crossEngineRasterEquivalent,
        neutralTinyGlyphAntialiasEquivalent,
        textReflow,
      },
    },
  ];
}

function isNeutralTinyGlyphAntialiasEquivalent(
  metrics: NonNullable<PdfSemanticBlockVisualLineComparison["metrics"]>,
) {
  // 极细的中性标点（例如表格占位长横线）在 WPS 中可能只保留一层
  // 灰阶覆盖，前景色估算因此会比 Chromium/Word 明显变亮。只有局部
  // 几何、墨迹和边缘完全同拓扑，且整体与背景误差都很低时才视作同一
  // 字形的抗锯齿差异；真实着色、轮廓或背景变化仍继续阻断。
  return Math.max(
    metrics.baselineWidthPx,
    metrics.candidateWidthPx,
  ) <= 64 &&
    Math.max(
      metrics.baselineHeightPx,
      metrics.candidateHeightPx,
    ) <= 48 &&
    metrics.inkIou >= 0.995 &&
    (metrics.foregroundInkIou ?? metrics.inkIou) >= 0.995 &&
    metrics.edgeIou >= 0.995 &&
    metrics.meanAbsoluteError <= 16 &&
    metrics.backgroundColorDelta <= 12 &&
    (metrics.baselineForegroundChroma ?? Number.POSITIVE_INFINITY) <= 12 &&
    (metrics.candidateForegroundChroma ?? Number.POSITIVE_INFINITY) <= 12 &&
    (metrics.foregroundLuminanceDelta ?? Number.POSITIVE_INFINITY) <= 120;
}

function isNeutralForegroundToneEquivalent(
  metrics: NonNullable<PdfSemanticBlockVisualLineComparison["metrics"]>,
) {
  return (metrics.baselineForegroundChroma ?? Number.POSITIVE_INFINITY) <= 2 &&
    (metrics.candidateForegroundChroma ?? Number.POSITIVE_INFINITY) <= 2 &&
    (metrics.foregroundLuminanceDelta ?? Number.POSITIVE_INFINITY) <= 5;
}

function isChromaticPaletteEquivalent(
  metrics: NonNullable<PdfSemanticBlockVisualLineComparison["metrics"]>,
) {
  return metrics.inkIou >= 0.995 &&
    metrics.edgeIou >= 0.995 &&
    (metrics.baselineForegroundChroma ?? 0) >= 80 &&
    (metrics.candidateForegroundChroma ?? 0) >= 80 &&
    (metrics.dominantForegroundColorDelta ?? Number.POSITIVE_INFINITY) <= 4;
}

function isSyntaxPaletteEquivalent(
  metrics: NonNullable<PdfSemanticBlockVisualLineComparison["metrics"]>,
  blockKind?: string,
) {
  if (blockKind !== "code-block") {
    return false;
  }
  const widthDelta = Math.abs(
    metrics.baselineWidthPx - metrics.candidateWidthPx,
  );
  const heightDelta = Math.abs(
    metrics.baselineHeightPx - metrics.candidateHeightPx,
  );
  return widthDelta <= Math.max(
    4,
    Math.ceil(metrics.baselineWidthPx * 0.015),
  ) &&
    heightDelta <= 1 &&
    metrics.inkIou >= 0.985 &&
    (metrics.foregroundInkIou ?? 0) >= 0.995 &&
    metrics.edgeIou >= 0.995 &&
    metrics.backgroundColorDelta <= 4 &&
    (metrics.chromaticPaletteDelta ?? Number.POSITIVE_INFINITY) <= 2;
}

/**
 * Word、WPS 与 Chromium 会用不同的灰阶覆盖率栅格化同一套嵌入字形。
 * 只有轮廓拓扑、颜色和局部几何同时近等时，才把较大的原始像素差视为
 * 跨引擎栅格等价；任何回流、着色变化或可见形状变化仍由严格门禁阻断。
 */
export function isCrossEngineRasterEquivalent(
  metrics: NonNullable<PdfSemanticBlockVisualLineComparison["metrics"]>,
  textReflow: boolean,
  blockKind?: string,
  hasInlineCode = false,
): boolean {
  if (textReflow) {
    return false;
  }
  const widthDelta = Math.abs(
    metrics.baselineWidthPx - metrics.candidateWidthPx,
  );
  const heightDelta = Math.abs(
    metrics.baselineHeightPx - metrics.candidateHeightPx,
  );
  const preciseGeometryEquivalent =
    widthDelta <= Math.max(2, Math.ceil(metrics.baselineWidthPx * 0.01)) &&
    heightDelta <= 1;
  const verticalMetricGeometryEquivalent =
    widthDelta <= Math.max(2, Math.ceil(metrics.baselineWidthPx * 0.01)) &&
    heightDelta <= 2;
  const fontMetricGeometryEquivalent =
    widthDelta <= Math.max(2, metrics.baselineWidthPx * 0.07) &&
    heightDelta <= 1;
  const listFontMetricGeometryEquivalent =
    widthDelta <= Math.max(2, metrics.baselineWidthPx * 0.075) &&
    heightDelta <= 2;
  const tinyGlyphGeometryEquivalent =
    Math.max(metrics.baselineWidthPx, metrics.candidateWidthPx) <= 48 &&
    widthDelta <= 2 &&
    heightDelta <= 1;
  const neutralTinyGlyphAntialiasEquivalent =
    isNeutralTinyGlyphAntialiasEquivalent(metrics);
  const colorEquivalent =
    neutralTinyGlyphAntialiasEquivalent ||
    (
      metrics.backgroundColorDelta <= 4 &&
      (metrics.foregroundColorDelta <=
        (blockKind === "list-item" ? 4.5 : 4) ||
        isNeutralForegroundToneEquivalent(metrics) ||
        isChromaticPaletteEquivalent(metrics) ||
        isSyntaxPaletteEquivalent(metrics, blockKind))
    );
  const inlineCodeShadingEquivalent =
    hasInlineCode &&
    widthDelta <= Math.max(3, Math.ceil(metrics.baselineWidthPx * 0.015)) &&
    heightDelta <= 2 &&
    metrics.edgeIou >= 0.995 &&
    (metrics.inkIou >= 0.9 ||
      (metrics.foregroundInkIou ?? 0) >= 0.98) &&
    metrics.foregroundColorDelta <= 3.25 &&
    metrics.backgroundColorDelta <= 12;
  const topologyEquivalent =
    (preciseGeometryEquivalent &&
      metrics.inkIou >= 0.99 &&
      metrics.edgeIou >= 0.9) ||
    (tinyGlyphGeometryEquivalent &&
      metrics.inkIou >= 0.9 &&
      metrics.edgeIou >= 0.9) ||
    (blockKind === "code-block" &&
      preciseGeometryEquivalent &&
      metrics.inkIou >= 0.96 &&
      metrics.edgeIou >= 0.98) ||
    (["paragraph", "list-item", "block-quote"].includes(blockKind ?? "") &&
      verticalMetricGeometryEquivalent &&
      metrics.inkIou >= 0.88 &&
      metrics.edgeIou >= 0.995) ||
    (preciseGeometryEquivalent &&
      metrics.edgeIou >= 0.995 &&
      metrics.inkIou >= 0.86) ||
    (fontMetricGeometryEquivalent &&
      metrics.edgeIou >= 0.98 &&
      metrics.inkIou >= 0.97) ||
    (blockKind === "list-item" &&
      listFontMetricGeometryEquivalent &&
      metrics.edgeIou >= 0.93 &&
      metrics.inkIou >= 0.9) ||
    (preciseGeometryEquivalent &&
      metrics.edgeIou >= 0.97 &&
      metrics.inkIou >= 0.97);
  return inlineCodeShadingEquivalent ||
    (colorEquivalent && topologyEquivalent);
}

export async function comparePdfSemanticBlockVisuals(
  baseline: PdfDocumentSnapshot,
  candidate: PdfDocumentSnapshot,
  paragraphs: readonly PdfParagraphLayoutComparison[],
  thresholds: VisualDiffThresholds,
): Promise<PdfSemanticBlockVisualComparison[]> {
  const comparisons: PdfSemanticBlockVisualComparison[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.expectation.section !== "body") {
      continue;
    }
    const issues: VisualDiffIssue[] = [];
    const baselineFonts = collectFonts(paragraph.baseline.visualLines);
    const candidateFonts = collectFonts(paragraph.candidate.visualLines);

    const lines: PdfSemanticBlockVisualLineComparison[] = [];
    const flowTextBlock = [
      "paragraph",
      "list-item",
      "block-quote",
      "code-block",
    ].includes(paragraph.expectation.blockKind ?? "paragraph");
    const comparableLineCount = Math.min(
      paragraph.baseline.visualLines.length,
      paragraph.candidate.visualLines.length,
    );
    const hasUsableVisualMapping = (layout: typeof paragraph.baseline) => {
      if (layout.matched) {
        return true;
      }
      const expected = layout.expectedCharacterCount ?? 0;
      const matched = layout.matchedCharacterCount ?? 0;
      const coverage = expected === 0 ? 0 : matched / expected;
      const mathCharacterIndexes = new Set(
        paragraph.expectation.mathCharacterIndexes ?? [],
      );
      const missingTailIsMath =
        matched < expected &&
        Array.from(
          { length: expected - matched },
          (_, offset) => matched + offset,
        ).every((index) => mathCharacterIndexes.has(index));
      return layout.visualLines.length > 0 &&
        ((expected >= 10 && expected - matched === 1 && coverage >= 0.9) ||
          (missingTailIsMath && coverage >= 0.8));
    };
    const equalLineSegmentation =
      paragraph.baseline.visualLines.length ===
        paragraph.candidate.visualLines.length &&
      paragraph.baseline.lineTexts.every(
        (text, index) => text === paragraph.candidate.lineTexts[index],
      );
    if (
      !hasUsableVisualMapping(paragraph.baseline) ||
      !hasUsableVisualMapping(paragraph.candidate) ||
      comparableLineCount === 0
    ) {
      issues.push({
        code: "SEMANTIC_BLOCK_VISUAL_UNAVAILABLE",
        severity: "failure",
        message: `第 ${paragraph.expectation.index + 1} 个语义块缺少可比较的局部视觉观测`,
        details: { paragraphIndex: paragraph.expectation.index },
      });
    } else if (equalLineSegmentation) {
      for (let lineIndex = 0; lineIndex < comparableLineCount; lineIndex += 1) {
        const baselineLine = paragraph.baseline.visualLines[lineIndex];
        const candidateLine = paragraph.candidate.visualLines[lineIndex];
        const baselinePage = baselineLine
          ? baseline.pages[baselineLine.pageNumber - 1]
          : undefined;
        const candidatePage = candidateLine
          ? candidate.pages[candidateLine.pageNumber - 1]
          : undefined;
        if (
          !baselineLine ||
          !candidateLine ||
          !baselinePage?.raster ||
          !candidatePage?.raster
        ) {
          const unavailable: VisualDiffIssue = {
            code: "SEMANTIC_BLOCK_VISUAL_UNAVAILABLE",
            severity: "failure",
            message: `第 ${paragraph.expectation.index + 1} 个语义块的第 ${lineIndex + 1} 行缺少栅格`,
            details: {
              paragraphIndex: paragraph.expectation.index,
              lineIndex,
            },
          };
          issues.push(unavailable);
          lines.push({
            lineIndex,
            baselinePageNumber: baselineLine?.pageNumber ?? -1,
            candidatePageNumber: candidateLine?.pageNumber ?? -1,
            issues: [unavailable],
          });
          continue;
        }
        const [baselineCrop, candidateCrop] = await Promise.all([
          cropRaster(baselinePage.raster, baselineLine.bounds),
          cropRaster(candidatePage.raster, candidateLine.bounds),
        ]);
        assertPngRaster(
          baselineCrop,
          `第 ${paragraph.expectation.index + 1} 个语义块第 ${lineIndex + 1} 行基线裁剪`,
        );
        assertPngRaster(
          candidateCrop,
          `第 ${paragraph.expectation.index + 1} 个语义块第 ${lineIndex + 1} 行候选裁剪`,
        );
        const baselineLineText = paragraph.baseline.lineTexts[lineIndex] ?? "";
        const candidateLineText = paragraph.candidate.lineTexts[lineIndex] ?? "";
        const textReflow = flowTextBlock &&
          baselineLineText !== candidateLineText;
        const cropWidthRatio = Math.min(
          baselineCrop.widthPx,
          candidateCrop.widthPx,
        ) / Math.max(baselineCrop.widthPx, candidateCrop.widthPx);
        const normalizeFlowGeometry = flowTextBlock &&
          !textReflow &&
          cropWidthRatio >= 0.75;
        let result;
        try {
          result = normalizeFlowGeometry
            ? await comparePageRasters(baselineCrop, candidateCrop, {
                pixelDifferenceThreshold: thresholds.pixelDifferenceThreshold,
                spatialTolerancePx: thresholds.spatialTolerancePx,
                targetWidthPx: baselineCrop.widthPx,
                targetHeightPx: baselineCrop.heightPx,
                geometryNormalized: true,
              })
            : await (async () => {
                const widthPx = Math.max(
                  baselineCrop.widthPx,
                  candidateCrop.widthPx,
                );
                const heightPx = Math.max(
                  baselineCrop.heightPx,
                  candidateCrop.heightPx,
                );
                const [baselinePadded, candidatePadded] = await Promise.all([
                  padRaster(baselineCrop, widthPx, heightPx),
                  padRaster(candidateCrop, widthPx, heightPx),
                ]);
                return comparePageRasters(
                  baselinePadded,
                  candidatePadded,
                  thresholds.pixelDifferenceThreshold,
                );
              })();
        } catch (error) {
          throw new Error(
            `第 ${paragraph.expectation.index + 1} 个语义块第 ${lineIndex + 1} 行栅格比较失败：` +
              `基线 ${baselineCrop.widthPx}x${baselineCrop.heightPx}/${baselineCrop.png.byteLength}，` +
              `候选 ${candidateCrop.widthPx}x${candidateCrop.heightPx}/${candidateCrop.png.byteLength}；` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const lineIssues = localRasterIssues(
          paragraph.expectation.index,
          lineIndex,
          paragraph.expectation.blockKind,
          paragraph.expectation.hasInlineCode === true,
          result.metrics,
          thresholds,
          textReflow,
        );
        issues.push(...lineIssues);
        lines.push({
          lineIndex,
          baselinePageNumber: baselineLine.pageNumber,
          candidatePageNumber: candidateLine.pageNumber,
          metrics: result.metrics,
          ...(lineIssues.length > 0 ? { artifacts: result.artifacts } : {}),
          issues: lineIssues,
        });
      }
    } else {
      const reflowPairs = pairReflowedTextLines(
        paragraph.baseline.lineTexts,
        paragraph.candidate.lineTexts,
      );
      const sliceByCharacterOverlap =
        paragraph.baseline.visualLines.length ===
        paragraph.candidate.visualLines.length;
      if (reflowPairs.length === 0) {
        issues.push({
          code: "SEMANTIC_BLOCK_VISUAL_UNAVAILABLE",
          severity: "failure",
          message: `第 ${paragraph.expectation.index + 1} 个语义块无法按文本区间配对跨引擎视觉行`,
          details: { paragraphIndex: paragraph.expectation.index },
        });
      }
      for (let pairIndex = 0; pairIndex < reflowPairs.length; pairIndex += 1) {
        const pair = reflowPairs[pairIndex]!;
        const baselineLine =
          paragraph.baseline.visualLines[pair.baselineLineIndex];
        const candidateLine =
          paragraph.candidate.visualLines[pair.candidateLineIndex];
        const baselinePage = baselineLine
          ? baseline.pages[baselineLine.pageNumber - 1]
          : undefined;
        const candidatePage = candidateLine
          ? candidate.pages[candidateLine.pageNumber - 1]
          : undefined;
        if (
          !baselineLine ||
          !candidateLine ||
          !baselinePage?.raster ||
          !candidatePage?.raster
        ) {
          const unavailable: VisualDiffIssue = {
            code: "SEMANTIC_BLOCK_VISUAL_UNAVAILABLE",
            severity: "failure",
            message: `第 ${paragraph.expectation.index + 1} 个语义块的跨引擎重排行缺少栅格`,
            details: {
              paragraphIndex: paragraph.expectation.index,
              lineIndex: pairIndex,
            },
          };
          issues.push(unavailable);
          lines.push({
            lineIndex: pairIndex,
            baselinePageNumber: baselineLine?.pageNumber ?? -1,
            candidatePageNumber: candidateLine?.pageNumber ?? -1,
            issues: [unavailable],
          });
          continue;
        }
        const baselineBounds = sliceByCharacterOverlap
          ? sliceTextLineBounds(
              baselineLine.bounds,
              paragraph.baseline.lineTexts[pair.baselineLineIndex] ?? "",
              pair.baselineStart,
              pair.baselineEnd,
            )
          : baselineLine.bounds;
        const candidateBounds = sliceByCharacterOverlap
          ? sliceTextLineBounds(
              candidateLine.bounds,
              paragraph.candidate.lineTexts[pair.candidateLineIndex] ?? "",
              pair.candidateStart,
              pair.candidateEnd,
            )
          : candidateLine.bounds;
        const [baselineCrop, candidateCrop] = await Promise.all([
          cropRaster(baselinePage.raster, baselineBounds),
          cropRaster(candidatePage.raster, candidateBounds),
        ]);
        assertPngRaster(
          baselineCrop,
          `第 ${paragraph.expectation.index + 1} 个语义块重排行基线裁剪`,
        );
        assertPngRaster(
          candidateCrop,
          `第 ${paragraph.expectation.index + 1} 个语义块重排行候选裁剪`,
        );
        const widthPx = Math.max(
          baselineCrop.widthPx,
          candidateCrop.widthPx,
        );
        const heightPx = Math.max(
          baselineCrop.heightPx,
          candidateCrop.heightPx,
        );
        const [baselinePadded, candidatePadded] = await Promise.all([
          padRaster(baselineCrop, widthPx, heightPx),
          padRaster(candidateCrop, widthPx, heightPx),
        ]);
        const result = await comparePageRasters(
          baselinePadded,
          candidatePadded,
          thresholds.pixelDifferenceThreshold,
        );
        const reflowIssue: VisualDiffIssue = {
          code: "PARAGRAPH_LINE_BREAK_MISMATCH",
          severity: "warning",
          message: `第 ${paragraph.expectation.index + 1} 个语义块发生允许的跨引擎流式换行`,
          details: {
            paragraphIndex: paragraph.expectation.index,
            lineIndex: pairIndex,
            baselineLineIndex: pair.baselineLineIndex,
            candidateLineIndex: pair.candidateLineIndex,
            textReflow: true,
          },
        };
        const lineIssues = [
          reflowIssue,
          ...localRasterIssues(
            paragraph.expectation.index,
            pairIndex,
            paragraph.expectation.blockKind,
            paragraph.expectation.hasInlineCode === true,
            result.metrics,
            thresholds,
            true,
          ),
        ];
        issues.push(...lineIssues);
        lines.push({
          lineIndex: pairIndex,
          baselinePageNumber: baselineLine.pageNumber,
          candidatePageNumber: candidateLine.pageNumber,
          metrics: result.metrics,
          ...(lineIssues.some((issue) => issue.severity === "failure")
            ? { artifacts: result.artifacts }
            : {}),
          issues: lineIssues,
        });
      }
    }
    comparisons.push({
      expectation: paragraph.expectation,
      status: status(issues),
      baselineFontFamilies: baselineFonts,
      candidateFontFamilies: candidateFonts,
      lines,
      issues,
    });
  }
  return comparisons;
}
