import { describe, expect, it } from "vitest";

import { createPdfDocumentSnapshot } from "../src/index.js";
import { createMinimalPdf } from "./pdf-fixture.js";

describe("PDF.js 页面快照", () => {
  it("从真实 PDF 同时提取纸张、文本和稳定 PNG", async () => {
    const pdf = createMinimalPdf();
    const first = await createPdfDocumentSnapshot(pdf, {
      source: { kind: "custom", label: "fixture" },
      dpi: 144,
    });
    const second = await createPdfDocumentSnapshot(pdf, {
      source: { kind: "custom", label: "fixture" },
      dpi: 144,
    });

    expect(first.pageCount).toBe(1);
    expect(first.pages[0]?.widthPt).toBeCloseTo(595, 3);
    expect(first.pages[0]?.heightPt).toBeCloseTo(842, 3);
    expect(first.contentText).toContain("Visual diff fixture");
    expect(first.fonts).toEqual([
      expect.objectContaining({
        name: "Helvetica",
        fallbackFamily: "sans-serif",
        isType3Font: false,
        missingFile: true,
      }),
    ]);
    expect(first.pages[0]?.items[0]).toMatchObject({
      fontFamily: "Helvetica",
      fallbackFontFamily: "sans-serif",
    });
    expect(first.pages[0]?.raster).toMatchObject({
      widthPx: 1190,
      heightPx: 1684,
      dpi: 144,
    });
    expect(first.pages[0]?.raster?.png.byteLength).toBeGreaterThan(1000);
    expect(first.pages[0]?.raster?.sha256).toBe(
      second.pages[0]?.raster?.sha256,
    );
  });

  it("允许关闭栅格输出以执行轻量结构门禁", async () => {
    const snapshot = await createPdfDocumentSnapshot(createMinimalPdf(), {
      source: { kind: "custom", label: "fixture" },
      includeRaster: false,
    });
    expect(snapshot.pages[0]?.raster).toBeUndefined();
  });
});
