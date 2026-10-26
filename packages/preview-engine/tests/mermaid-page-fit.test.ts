import { defaultExportConfig } from "@morphdoc/core";
import { describe, expect, it } from "vitest";
import {
  calculateMermaidPageFit,
  getPageContentDimensions,
  parseSvgViewBox
} from "../src/mermaid-page-fit.js";

describe("Mermaid 单页高度适配", () => {
  it("解析 SVG viewBox 尺寸", () => {
    expect(parseSvgViewBox("0 0 1200 2400")).toEqual({
      width: 1200,
      height: 2400
    });
    expect(parseSvgViewBox("0,0,800,600")).toEqual({
      width: 800,
      height: 600
    });
    expect(parseSvgViewBox("0 0 0 600")).toBeUndefined();
    expect(parseSvgViewBox(null)).toBeUndefined();
  });

  it("使用纸张和页边距计算正文区域", () => {
    const dimensions = getPageContentDimensions(defaultExportConfig);

    expect(dimensions.width).toBeCloseTo(672.7559, 3);
    expect(dimensions.height).toBeCloseTo(1001.5748, 3);
  });

  it("宽度适配后未超高时保持普通 Mermaid 布局", () => {
    const fit = calculateMermaidPageFit(
      { width: 1600, height: 900 },
      { width: 672, height: 1000 }
    );

    expect(fit).toEqual({
      width: 672,
      height: 378,
      scaled: false
    });
  });

  it("宽度适配后超高时按页面高度等比例缩小", () => {
    const fit = calculateMermaidPageFit(
      { width: 1000, height: 2000 },
      { width: 672, height: 1000 }
    );

    expect(fit.scaled).toBe(true);
    expect(fit.height).toBe(999);
    expect(fit.width).toBe(499.5);
  });
});
