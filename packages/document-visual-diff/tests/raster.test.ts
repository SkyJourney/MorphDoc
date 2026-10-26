import { createHash } from "node:crypto";

import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";

import {
  comparePageRasters,
  type PdfPageRaster,
} from "../src/index.js";

function raster(rectangleX: number): PdfPageRaster {
  const canvas = createCanvas(80, 100);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 80, 100);
  context.fillStyle = "#111111";
  context.fillRect(rectangleX, 20, 20, 40);
  const png = Uint8Array.from(canvas.toBuffer("image/png"));
  return {
    widthPx: 80,
    heightPx: 100,
    dpi: 144,
    sha256: createHash("sha256").update(png).digest("hex"),
    png,
  };
}

function differentlySizedRaster(width: number, height: number): PdfPageRaster {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#111111";
  context.fillRect(width * 0.25, height * 0.2, width * 0.25, height * 0.4);
  const png = Uint8Array.from(canvas.toBuffer("image/png"));
  return {
    widthPx: width,
    heightPx: height,
    dpi: 144,
    sha256: createHash("sha256").update(png).digest("hex"),
    png,
  };
}

describe("PDF 栅格差异", () => {
  it("相同页面的全部指标为无差异", async () => {
    const page = raster(10);
    const result = await comparePageRasters(page, page);
    expect(result.metrics).toMatchObject({
      dimensionsMatch: true,
      spatialTolerancePx: 4,
      meanAbsoluteError: 0,
      changedPixelRatio: 0,
      inkIou: 1,
      foregroundInkIou: 1,
      edgeIou: 1,
      backgroundColorDelta: 0,
      foregroundColorDelta: 0,
    });
    expect(result.artifacts.overlayPng.subarray(0, 8)).toEqual(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  });

  it("分别量化块背景色与背景相对的前景形状", async () => {
    const coloredRaster = (background: string, foreground: string) => {
      const canvas = createCanvas(80, 40);
      const context = canvas.getContext("2d");
      context.fillStyle = background;
      context.fillRect(0, 0, 80, 40);
      context.fillStyle = foreground;
      context.fillRect(20, 10, 40, 20);
      const png = Uint8Array.from(canvas.toBuffer("image/png"));
      return {
        widthPx: 80,
        heightPx: 40,
        dpi: 144,
        sha256: createHash("sha256").update(png).digest("hex"),
        png,
      } satisfies PdfPageRaster;
    };
    const sameShape = await comparePageRasters(
      coloredRaster("#f2f2f2", "#202020"),
      coloredRaster("#ffffff", "#202020"),
    );

    expect(sameShape.metrics.inkIou).toBe(1);
    expect(sameShape.metrics.backgroundColorDelta).toBeGreaterThan(10);
    expect(sameShape.metrics.foregroundColorDelta).toBeLessThan(1);
  });

  it("双背景占比翻转时仍独立量化核心字形拓扑", async () => {
    const inlineCodeRaster = (fullHeightShading: boolean) => {
      const canvas = createCanvas(216, 25);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 216, 25);
      context.fillStyle = "#f3f3f3";
      context.fillRect(28, fullHeightShading ? 0 : 5, 120, fullHeightShading ? 25 : 16);
      context.fillStyle = "#333333";
      context.fillRect(34, 10, 80, 4);
      const png = Uint8Array.from(canvas.toBuffer("image/png"));
      return {
        widthPx: 216,
        heightPx: 25,
        dpi: 144,
        sha256: createHash("sha256").update(png).digest("hex"),
        png,
      } satisfies PdfPageRaster;
    };
    const result = await comparePageRasters(
      inlineCodeRaster(false),
      inlineCodeRaster(true),
    );

    expect(result.metrics.backgroundColorDelta).toBeGreaterThan(10);
    expect(result.metrics.foregroundInkIou).toBe(1);
  });

  it("渐变背景不会把深色文字误判为背景", async () => {
    const gradientRaster = (gradient: boolean) => {
      const canvas = createCanvas(160, 40);
      const context = canvas.getContext("2d");
      if (gradient) {
        const fill = context.createLinearGradient(0, 0, 160, 0);
        fill.addColorStop(0, "#edf5fa");
        fill.addColorStop(1, "#ffffff");
        context.fillStyle = fill;
      } else {
        context.fillStyle = "#f6fafc";
      }
      context.fillRect(0, 0, 160, 40);
      context.fillStyle = "#0b3557";
      context.fillRect(4, 4, 148, 32);
      const png = Uint8Array.from(canvas.toBuffer("image/png"));
      return {
        widthPx: 160,
        heightPx: 40,
        dpi: 144,
        sha256: createHash("sha256").update(png).digest("hex"),
        png,
      } satisfies PdfPageRaster;
    };

    const result = await comparePageRasters(
      gradientRaster(true),
      gradientRaster(false),
    );
    expect(result.metrics.foregroundColorDelta).toBeLessThan(1);
    expect(result.metrics.backgroundColorDelta).toBeLessThan(8);
    expect(result.metrics.inkIou).toBeGreaterThan(0.95);
  });

  it("裁剪跨过深色盒边界时不会把外部白色误判为盒背景", async () => {
    const boxedRaster = (exposeOutside: boolean) => {
      const canvas = createCanvas(80, 40);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 80, 40);
      context.fillStyle = "#464646";
      context.fillRect(0, 0, exposeOutside ? 68 : 80, exposeOutside ? 32 : 40);
      context.fillStyle = "#ffffff";
      context.fillRect(18, 10, 32, 16);
      const png = Uint8Array.from(canvas.toBuffer("image/png"));
      return {
        widthPx: 80,
        heightPx: 40,
        dpi: 144,
        sha256: createHash("sha256").update(png).digest("hex"),
        png,
      } satisfies PdfPageRaster;
    };

    const result = await comparePageRasters(
      boxedRaster(true),
      boxedRaster(false),
    );
    expect(result.metrics.backgroundColorDelta).toBeLessThan(1);
    expect(result.metrics.foregroundColorDelta).toBeLessThan(1);
  });

  it("量化位移并生成稳定叠加图与热力图", async () => {
    const result = await comparePageRasters(raster(10), raster(20), {
      spatialTolerancePx: 0,
    });
    expect(result.metrics.meanAbsoluteError).toBeGreaterThan(10);
    expect(result.metrics.changedPixelRatio).toBeCloseTo(0.1, 2);
    expect(result.metrics.inkIou).toBeCloseTo(1 / 3, 2);
    expect(result.metrics.edgeIou).toBeLessThan(0.4);
    expect(result.artifacts.overlaySha256).toHaveLength(64);
    expect(result.artifacts.heatmapSha256).toHaveLength(64);
  });

  it("只容忍三个像素以内的跨引擎栅格偏移", async () => {
    const near = await comparePageRasters(raster(10), raster(13));
    const far = await comparePageRasters(raster(10), raster(17));

    expect(near.metrics.inkIou).toBe(1);
    expect(near.metrics.edgeIou).toBe(1);
    expect(far.metrics.inkIou).toBeLessThan(0.75);
    expect(far.metrics.edgeIou).toBeLessThan(0.6);
  });

  it("空间容差不改变原始像素热力图", async () => {
    const baseline = raster(10);
    const candidate = raster(12);
    const tolerant = await comparePageRasters(baseline, candidate);
    const exact = await comparePageRasters(baseline, candidate, {
      spatialTolerancePx: 0,
    });

    expect(tolerant.metrics.inkIou).toBeGreaterThan(exact.metrics.inkIou);
    expect(tolerant.artifacts.heatmapSha256).toBe(
      exact.artifacts.heatmapSha256,
    );
  });

  it("可按物理页面基线规范化一像素的栅格舍入差", async () => {
    const result = await comparePageRasters(
      differentlySizedRaster(80, 100),
      differentlySizedRaster(81, 101),
      {
        targetWidthPx: 80,
        targetHeightPx: 100,
        geometryNormalized: true,
      },
    );
    expect(result.metrics).toMatchObject({
      baselineWidthPx: 80,
      candidateWidthPx: 81,
      comparedWidthPx: 80,
      dimensionsMatch: false,
      geometryNormalized: true,
    });
    expect(result.metrics.meanAbsoluteError).toBeLessThan(2);
  });
});
