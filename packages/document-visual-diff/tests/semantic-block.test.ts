import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";

import {
  comparePdfSemanticBlockVisuals,
  isCrossEngineRasterEquivalent,
  type PdfRasterMetrics,
} from "../src/index.js";

function metrics(
  overrides: Partial<PdfRasterMetrics> = {},
): PdfRasterMetrics {
  return {
    baselineWidthPx: 224,
    baselineHeightPx: 37,
    candidateWidthPx: 224,
    candidateHeightPx: 37,
    comparedWidthPx: 224,
    comparedHeightPx: 37,
    dimensionsMatch: true,
    geometryNormalized: true,
    spatialTolerancePx: 4,
    meanAbsoluteError: 14.5,
    changedPixelRatio: 0.27,
    inkIou: 0.942,
    edgeIou: 1,
    backgroundColorDelta: 0.02,
    foregroundColorDelta: 0,
    ...overrides,
  };
}

function whitePageRaster() {
  const canvas = createCanvas(400, 400);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, 400, 400);
  context.fillStyle = "#111";
  context.fillRect(40, 40, 120, 12);
  context.fillRect(40, 80, 120, 12);
  const rgba = context.getImageData(0, 0, 400, 400).data;
  return {
    widthPx: 400,
    heightPx: 400,
    dpi: 72,
    sha256: "test",
    png: Uint8Array.from(canvas.toBuffer("image/png")),
    rgba,
  };
}

function blankPageRaster() {
  const canvas = createCanvas(400, 400);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, 400, 400);
  const rgba = context.getImageData(0, 0, 400, 400).data;
  return {
    widthPx: 400,
    heightPx: 400,
    dpi: 72,
    sha256: "blank",
    png: Uint8Array.from(canvas.toBuffer("image/png")),
    rgba,
  };
}

describe("跨引擎字形栅格等价", () => {
  it("缺少局部视觉行时必须阻断而不能静默通过", async () => {
    const [comparison] = await comparePdfSemanticBlockVisuals(
      { pages: [] } as never,
      { pages: [] } as never,
      [{
        expectation: { index: 39, section: "body", blockKind: "table-cell" },
        baseline: { matched: true, visualLines: [], lineTexts: [] },
        candidate: { matched: true, visualLines: [], lineTexts: [] },
      }] as never,
      {} as never,
    );

    expect(comparison?.status).toBe("failed");
    expect(comparison?.issues).toEqual([
      expect.objectContaining({
        code: "SEMANTIC_BLOCK_VISUAL_UNAVAILABLE",
        severity: "failure",
      }),
    ]);
  });

  it("跨引擎换行数不同时按字符区间配对视觉行而不是返回空观测", async () => {
    const page = {
      pageNumber: 1,
      widthPt: 400,
      heightPt: 400,
      lines: [],
      raster: whitePageRaster(),
    };
    const visualLine = (y: number) => ({
      pageNumber: 1,
      bounds: { x: 40, y, width: 120, height: 12 },
      fontFamilies: ["Test Sans"],
    });
    const [comparison] = await comparePdfSemanticBlockVisuals(
      { pages: [page] } as never,
      { pages: [page] } as never,
      [{
        expectation: {
          index: 7,
          section: "body",
          blockKind: "table-cell",
        },
        baseline: {
          matched: true,
          visualLines: [visualLine(40), visualLine(80)],
          lineTexts: ["甲乙", "丙丁"],
        },
        candidate: {
          matched: true,
          visualLines: [visualLine(40)],
          lineTexts: ["甲乙丙丁"],
        },
      }] as never,
      {
        pixelDifferenceThreshold: 8,
        spatialTolerancePx: 4,
        minInkIou: 0.75,
        minEdgeIou: 0.75,
        maxBackgroundColorDelta: 16,
        maxForegroundColorDelta: 16,
        maxMeanAbsoluteError: 20,
        maxChangedPixelRatio: 0.35,
        minAntialiasEquivalentInkIou: 0.9,
        minAntialiasEquivalentEdgeIou: 0.9,
      } as never,
    );

    expect(comparison?.status).toBe("warning");
    expect(comparison?.lines).toHaveLength(2);
    expect(comparison?.issues).not.toContainEqual(
      expect.objectContaining({ code: "SEMANTIC_BLOCK_VISUAL_UNAVAILABLE" }),
    );
    expect(comparison?.lines.every((line) =>
      line.issues.some((issue) => issue.details?.textReflow === true)
    )).toBe(true);
  });

  it("PDF 文本提取仅遗漏长文本末尾单字时仍比较已有视觉行", async () => {
    const page = {
      pageNumber: 1,
      widthPt: 400,
      heightPt: 400,
      lines: [],
      raster: blankPageRaster(),
    };
    const visualLine = (y: number) => ({
      pageNumber: 1,
      bounds: { x: 40, y, width: 108, height: 12 },
      fontFamilies: ["Test Sans"],
    });
    const [comparison] = await comparePdfSemanticBlockVisuals(
      { pages: [page] } as never,
      { pages: [page] } as never,
      [{
        expectation: {
          index: 118,
          section: "body",
          blockKind: "table-header",
        },
        baseline: {
          matched: true,
          matchedCharacterCount: 10,
          expectedCharacterCount: 10,
          visualLines: [visualLine(40), visualLine(70)],
          lineTexts: ["高血压预测模型目标", "值"],
        },
        candidate: {
          matched: false,
          matchedCharacterCount: 9,
          expectedCharacterCount: 10,
          visualLines: [visualLine(40)],
          lineTexts: ["高血压预测模型目标"],
        },
      }] as never,
      {
        pixelDifferenceThreshold: 8,
        spatialTolerancePx: 4,
        minInkIou: 0.75,
        minEdgeIou: 0.75,
        maxBackgroundColorDelta: 16,
        maxForegroundColorDelta: 16,
        maxMeanAbsoluteError: 20,
        maxChangedPixelRatio: 0.35,
        minAntialiasEquivalentInkIou: 0.9,
        minAntialiasEquivalentEdgeIou: 0.9,
      } as never,
    );

    expect(comparison?.lines).toHaveLength(1);
    expect(comparison?.issues).not.toContainEqual(
      expect.objectContaining({ code: "SEMANTIC_BLOCK_VISUAL_UNAVAILABLE" }),
    );
  });

  it("表格末尾数学字符未进入 PDF 文本层时仍比较已有视觉行", async () => {
    const page = {
      pageNumber: 1,
      widthPt: 400,
      heightPt: 400,
      lines: [],
      raster: blankPageRaster(),
    };
    const visualLine = {
      pageNumber: 1,
      bounds: { x: 40, y: 40, width: 108, height: 12 },
      fontFamilies: ["Test Serif"],
    };
    const [comparison] = await comparePdfSemanticBlockVisuals(
      { pages: [page] } as never,
      { pages: [page] } as never,
      [{
        expectation: {
          index: 71,
          section: "body",
          blockKind: "table-cell",
          mathCharacterIndexes: [3, 4, 5, 6, 11, 12, 13],
        },
        baseline: {
          matched: false,
          matchedCharacterCount: 12,
          expectedCharacterCount: 14,
          visualLines: [visualLine],
          lineTexts: ["收缩压≥140或舒张压≥"],
        },
        candidate: {
          matched: true,
          matchedCharacterCount: 14,
          expectedCharacterCount: 14,
          visualLines: [visualLine],
          lineTexts: ["收缩压≥140或舒张压≥90"],
        },
      }] as never,
      {
        pixelDifferenceThreshold: 8,
        spatialTolerancePx: 4,
        minInkIou: 0.75,
        minEdgeIou: 0.75,
        maxBackgroundColorDelta: 16,
        maxForegroundColorDelta: 16,
        maxMeanAbsoluteError: 20,
        maxChangedPixelRatio: 0.35,
        minAntialiasEquivalentInkIou: 0.9,
        minAntialiasEquivalentEdgeIou: 0.9,
      } as never,
    );

    expect(comparison?.lines).toHaveLength(1);
    expect(comparison?.issues).not.toContainEqual(
      expect.objectContaining({ code: "SEMANTIC_BLOCK_VISUAL_UNAVAILABLE" }),
    );
  });

  it("视觉行数量相同但字符分段不同时按重叠字符区间比较", async () => {
    const page = {
      pageNumber: 1,
      widthPt: 400,
      heightPt: 400,
      lines: [],
      raster: blankPageRaster(),
    };
    const visualLine = (y: number, width: number) => ({
      pageNumber: 1,
      bounds: { x: 40, y, width, height: 12 },
      fontFamilies: ["Test Sans"],
    });
    const [comparison] = await comparePdfSemanticBlockVisuals(
      { pages: [page] } as never,
      { pages: [page] } as never,
      [{
        expectation: {
          index: 117,
          section: "body",
          blockKind: "table-header",
        },
        baseline: {
          matched: true,
          visualLines: [visualLine(40, 20), visualLine(70, 40), visualLine(100, 40)],
          lineTexts: ["记", "录/", "计算"],
        },
        candidate: {
          matched: true,
          visualLines: [visualLine(40, 40), visualLine(70, 40), visualLine(100, 20)],
          lineTexts: ["记录", "/计", "算"],
        },
      }] as never,
      {
        pixelDifferenceThreshold: 8,
        spatialTolerancePx: 4,
        minInkIou: 0.75,
        minEdgeIou: 0.75,
        maxBackgroundColorDelta: 16,
        maxForegroundColorDelta: 16,
        maxMeanAbsoluteError: 20,
        maxChangedPixelRatio: 0.35,
        minAntialiasEquivalentInkIou: 0.9,
        minAntialiasEquivalentEdgeIou: 0.9,
      } as never,
    );

    expect(comparison?.status).toBe("warning");
    expect(comparison?.lines).toHaveLength(5);
    expect(comparison?.issues).not.toContainEqual(
      expect.objectContaining({ code: "ELEMENT_COLOR_MISMATCH" }),
    );
  });

  it("接受轮廓、颜色和几何一致的灰阶抗锯齿差异", () => {
    expect(isCrossEngineRasterEquivalent(metrics(), false)).toBe(true);
    expect(
      isCrossEngineRasterEquivalent(
        metrics({
          candidateWidthPx: 222,
          inkIou: 0.88,
          foregroundColorDelta: 3.5,
        }),
        false,
      ),
    ).toBe(true);
    expect(
      isCrossEngineRasterEquivalent(
        metrics({
          baselineWidthPx: 56,
          candidateWidthPx: 56,
          baselineHeightPx: 37,
          candidateHeightPx: 37,
          comparedWidthPx: 56,
          comparedHeightPx: 37,
          inkIou: 1,
          edgeIou: 1,
          foregroundColorDelta: 17,
          baselineForegroundChroma: 0,
          candidateForegroundChroma: 0,
          foregroundLuminanceDelta: 17,
        }),
        false,
        "code-block",
      ),
    ).toBe(true);
    const neutralSingleStrokeMetrics = metrics({
      baselineWidthPx: 37,
      candidateWidthPx: 37,
      baselineHeightPx: 27,
      candidateHeightPx: 27,
      comparedWidthPx: 37,
      comparedHeightPx: 27,
      meanAbsoluteError: 12.78,
      inkIou: 1,
      foregroundInkIou: 1,
      edgeIou: 1,
      backgroundColorDelta: 10.54,
      foregroundColorDelta: 108.69,
      baselineForegroundChroma: 10,
      candidateForegroundChroma: 5,
      foregroundLuminanceDelta: 109.27,
    });
    expect(
      isCrossEngineRasterEquivalent(
        neutralSingleStrokeMetrics,
        false,
        "table-cell",
      ),
    ).toBe(true);
    expect(
      isCrossEngineRasterEquivalent(
        { ...neutralSingleStrokeMetrics, meanAbsoluteError: 16.01 },
        false,
        "table-cell",
      ),
    ).toBe(false);
    expect(
      isCrossEngineRasterEquivalent(
        { ...neutralSingleStrokeMetrics, candidateForegroundChroma: 12.01 },
        false,
        "table-cell",
      ),
    ).toBe(false);
    expect(
      isCrossEngineRasterEquivalent(
        { ...neutralSingleStrokeMetrics, edgeIou: 0.994 },
        false,
        "table-cell",
      ),
    ).toBe(false);
    expect(
      isCrossEngineRasterEquivalent(
        metrics({ inkIou: 1, edgeIou: 0.946 }),
        false,
        "table-header",
      ),
    ).toBe(true);
    expect(
      isCrossEngineRasterEquivalent(
        metrics({ inkIou: 0.969, edgeIou: 0.983 }),
        false,
        "code-block",
      ),
    ).toBe(true);
    expect(
      isCrossEngineRasterEquivalent(
        metrics({
          baselineWidthPx: 38,
          candidateWidthPx: 38,
          comparedWidthPx: 38,
          inkIou: 0.902,
          edgeIou: 0.904,
        }),
        false,
        "code-block",
      ),
    ).toBe(true);
    expect(
      isCrossEngineRasterEquivalent(
        metrics({
          baselineWidthPx: 236,
          candidateWidthPx: 233,
          baselineHeightPx: 36,
          candidateHeightPx: 38,
          inkIou: 0.897,
          edgeIou: 0.9996,
        }),
        false,
        "paragraph",
      ),
    ).toBe(true);
    expect(
      isCrossEngineRasterEquivalent(
        metrics({
          baselineWidthPx: 272,
          candidateWidthPx: 286,
          baselineHeightPx: 43,
          candidateHeightPx: 42,
          inkIou: 0.948,
          edgeIou: 0.958,
          foregroundColorDelta: 4.2,
        }),
        false,
        "list-item",
      ),
    ).toBe(true);
    expect(
      isCrossEngineRasterEquivalent(
        metrics({
          baselineWidthPx: 262,
          candidateWidthPx: 272,
          baselineHeightPx: 30,
          candidateHeightPx: 31,
          comparedWidthPx: 262,
          comparedHeightPx: 30,
          inkIou: 0.9792,
          edgeIou: 0.9869,
          foregroundColorDelta: 4.63,
          baselineForegroundChroma: 0,
          candidateForegroundChroma: 0,
          foregroundLuminanceDelta: 4.63,
        }),
        false,
        "list-item",
      ),
    ).toBe(true);
    expect(
      isCrossEngineRasterEquivalent(
        metrics({
          candidateWidthPx: 209,
          inkIou: 0.974,
          edgeIou: 0.984,
        }),
        false,
      ),
    ).toBe(true);
    expect(
      isCrossEngineRasterEquivalent(
        metrics({
          candidateWidthPx: 208,
          inkIou: 0.91,
          edgeIou: 0.94,
        }),
        false,
        "list-item",
      ),
    ).toBe(true);
  });

  it("仅在高彩度字形轮廓与前景主色均一致时接受调色差异", () => {
    const paletteMetrics = metrics({
      inkIou: 1,
      edgeIou: 1,
      foregroundColorDelta: 35,
      baselineForegroundChroma: 141,
      candidateForegroundChroma: 176,
      dominantForegroundColorDelta: 0.5,
    });
    expect(
      isCrossEngineRasterEquivalent(paletteMetrics, false, "table-cell"),
    ).toBe(true);
    expect(
      isCrossEngineRasterEquivalent(
        { ...paletteMetrics, dominantForegroundColorDelta: 4.1 },
        false,
        "table-cell",
      ),
    ).toBe(false);
    expect(
      isCrossEngineRasterEquivalent(
        { ...paletteMetrics, edgeIou: 0.994 },
        false,
        "table-cell",
      ),
    ).toBe(false);
    expect(
      isCrossEngineRasterEquivalent(
        { ...paletteMetrics, baselineForegroundChroma: 79 },
        false,
        "table-cell",
      ),
    ).toBe(false);
  });

  it("多色代码行仅在语法主色和对应墨迹位置均一致时通过", () => {
    const syntaxMetrics = metrics({
      baselineWidthPx: 407,
      candidateWidthPx: 403,
      baselineHeightPx: 22,
      candidateHeightPx: 23,
      inkIou: 0.988,
      foregroundInkIou: 1,
      edgeIou: 1,
      foregroundColorDelta: 92,
      chromaticPaletteDelta: 0.8,
    });
    expect(
      isCrossEngineRasterEquivalent(syntaxMetrics, false, "code-block"),
    ).toBe(true);
    expect(
      isCrossEngineRasterEquivalent(
        { ...syntaxMetrics, chromaticPaletteDelta: 2.1 },
        false,
        "code-block",
      ),
    ).toBe(false);
    expect(
      isCrossEngineRasterEquivalent(
        { ...syntaxMetrics, foregroundInkIou: 0.994 },
        false,
        "code-block",
      ),
    ).toBe(false);
    expect(
      isCrossEngineRasterEquivalent(syntaxMetrics, false, "paragraph"),
    ).toBe(false);
  });

  it("仅在行内代码轮廓和底纹严格一致时接受微小前景色差", () => {
    const inlineCodeMetrics = metrics({
      baselineWidthPx: 236,
      candidateWidthPx: 234,
      baselineHeightPx: 24,
      candidateHeightPx: 25,
      comparedWidthPx: 236,
      comparedHeightPx: 25,
      inkIou: 0.91759,
      edgeIou: 1,
      backgroundColorDelta: 11.317,
      foregroundColorDelta: 3.158,
    });

    expect(
      isCrossEngineRasterEquivalent(
        inlineCodeMetrics,
        false,
        "paragraph",
        true,
      ),
    ).toBe(true);
    expect(
      isCrossEngineRasterEquivalent(
        { ...inlineCodeMetrics, foregroundColorDelta: 3.26 },
        false,
        "paragraph",
        true,
      ),
    ).toBe(false);
    expect(
      isCrossEngineRasterEquivalent(
        { ...inlineCodeMetrics, backgroundColorDelta: 12.01 },
        false,
        "paragraph",
        true,
      ),
    ).toBe(false);
    expect(
      isCrossEngineRasterEquivalent(
        { ...inlineCodeMetrics, edgeIou: 0.994 },
        false,
        "paragraph",
        true,
      ),
    ).toBe(false);
    expect(
      isCrossEngineRasterEquivalent(
        {
          ...inlineCodeMetrics,
          inkIou: 0.88,
          foregroundInkIou: 0.99,
        },
        false,
        "table-cell",
        true,
      ),
    ).toBe(true);
    expect(
      isCrossEngineRasterEquivalent(
        {
          ...inlineCodeMetrics,
          inkIou: 0.88,
          foregroundInkIou: 0.97,
        },
        false,
        "table-cell",
        true,
      ),
    ).toBe(false);
  });

  it("拒绝回流、颜色、几何或轮廓变化", () => {
    expect(isCrossEngineRasterEquivalent(metrics(), true)).toBe(false);
    expect(
      isCrossEngineRasterEquivalent(
        metrics({ foregroundColorDelta: 4.01 }),
        false,
      ),
    ).toBe(false);
    expect(
      isCrossEngineRasterEquivalent(
        metrics({ candidateWidthPx: 220 }),
        false,
      ),
    ).toBe(false);
    expect(
      isCrossEngineRasterEquivalent(
        metrics({
          candidateWidthPx: 207,
          inkIou: 0.91,
          edgeIou: 0.94,
        }),
        false,
        "list-item",
      ),
    ).toBe(false);
    expect(
      isCrossEngineRasterEquivalent(
        metrics({
          candidateWidthPx: 208,
          inkIou: 0.974,
          edgeIou: 0.984,
        }),
        false,
      ),
    ).toBe(false);
    expect(
      isCrossEngineRasterEquivalent(
        metrics({
          candidateWidthPx: 209,
          inkIou: 0.91,
          edgeIou: 0.94,
        }),
        false,
        "paragraph",
      ),
    ).toBe(false);
    expect(
      isCrossEngineRasterEquivalent(metrics({ edgeIou: 0.96 }), false),
    ).toBe(false);
    expect(
      isCrossEngineRasterEquivalent(
        metrics({
          baselineWidthPx: 262,
          candidateWidthPx: 272,
          baselineHeightPx: 30,
          candidateHeightPx: 31,
          inkIou: 0.9792,
          edgeIou: 0.9869,
          foregroundColorDelta: 4.63,
          baselineForegroundChroma: 2.01,
          candidateForegroundChroma: 0,
          foregroundLuminanceDelta: 4.63,
        }),
        false,
        "list-item",
      ),
    ).toBe(false);
    expect(
      isCrossEngineRasterEquivalent(
        metrics({
          baselineWidthPx: 262,
          candidateWidthPx: 272,
          baselineHeightPx: 30,
          candidateHeightPx: 31,
          inkIou: 0.9792,
          edgeIou: 0.9869,
          foregroundColorDelta: 5.01,
          baselineForegroundChroma: 0,
          candidateForegroundChroma: 0,
          foregroundLuminanceDelta: 5.01,
        }),
        false,
        "list-item",
      ),
    ).toBe(false);
    expect(
      isCrossEngineRasterEquivalent(
        metrics({
          baselineWidthPx: 38,
          candidateWidthPx: 38,
          comparedWidthPx: 38,
          inkIou: 0.89,
          edgeIou: 0.904,
        }),
        false,
        "code-block",
      ),
    ).toBe(false);
    expect(
      isCrossEngineRasterEquivalent(
        metrics({
          baselineHeightPx: 37,
          candidateHeightPx: 40,
          inkIou: 0.95,
          edgeIou: 1,
        }),
        false,
        "paragraph",
      ),
    ).toBe(false);
  });
});
