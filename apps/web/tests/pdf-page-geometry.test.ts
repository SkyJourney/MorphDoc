import { describe, expect, it } from "vitest";
import {
  getPdfCanvasRenderScale,
  getPdfPageCssDimensions,
  getPrecisePdfDocumentWidth,
  PDF_PAGE_CSS_SCALE
} from "../src/pdf-page-geometry";

describe("精确 PDF 页面尺寸", () => {
  it("按 96 CSS PPI 映射 PDF 点尺寸", () => {
    expect(PDF_PAGE_CSS_SCALE).toBeCloseTo(4 / 3);
    expect(
      getPdfPageCssDimensions(595.275591, 841.889764)
    ).toEqual({
      width: expect.closeTo(793.700788, 5),
      height: expect.closeTo(1122.519685, 5)
    });
  });

  it("按预览缩放比例调整 PDF 页面显示尺寸", () => {
    expect(
      getPdfPageCssDimensions(595.275591, 841.889764, 1.5)
    ).toEqual({
      width: expect.closeTo(1190.551182, 5),
      height: expect.closeTo(1683.779528, 5)
    });
  });

  it("结合显示宽度和设备像素比计算 Canvas 比例", () => {
    expect(getPdfCanvasRenderScale(600, 800, 2)).toBeCloseTo(
      8 / 3
    );
    expect(getPdfCanvasRenderScale(0, 800, 2)).toBe(0);
  });

  it.each([
    [50, 457],
    [100, 854],
    [120, 1013],
    [400, 3235]
  ])("在 %i%% 缩放下把双侧固定留白计入滚动宽度", (zoom, expected) => {
    expect(
      getPrecisePdfDocumentWidth(
        [595.275591],
        zoom / 100,
        30
      )
    ).toBe(expected);
  });

  it("按混合纸张中最宽页面计算精确预览滚动宽度", () => {
    expect(
      getPrecisePdfDocumentWidth([595.275591, 792], 1.2, 30)
    ).toBe(1328);
    expect(getPrecisePdfDocumentWidth([], 1.2, 30)).toBe(0);
  });
});
