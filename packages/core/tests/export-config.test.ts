import { describe, expect, it } from "vitest";
import {
  cssPixelsToMillimeters,
  defaultExportConfig,
  exportConfigSchema,
  getPaperDimensionsMm,
  millimetersToCssPixels,
  millimetersToPdfPoints,
  paperDimensionsMm,
  resolvePageMargins,
  supportedMermaidLayouts,
  supportedMermaidLooks,
  supportedMermaidThemes,
  supportedPaperFormats
} from "../src/export-config.js";

describe("导出配置", () => {
  it("只保留五种固定纸张尺寸", () => {
    expect(supportedPaperFormats).toEqual([
      "A3",
      "A4",
      "A5",
      "Letter",
      "Legal"
    ]);
    expect(paperDimensionsMm).toEqual({
      A3: { width: 297, height: 420 },
      A4: { width: 210, height: 297 },
      A5: { width: 148, height: 210 },
      Letter: { width: 215.9, height: 279.4 },
      Legal: { width: 215.9, height: 355.6 }
    });
  });

  it("保持英制纸张的标准尺寸精度", () => {
    expect(getPaperDimensionsMm("Letter", "portrait")).toEqual({
      width: 215.9,
      height: 279.4
    });
    expect(getPaperDimensionsMm("Letter", "landscape")).toEqual({
      width: 279.4,
      height: 215.9
    });
    expect(getPaperDimensionsMm("Legal", "portrait")).toEqual({
      width: 215.9,
      height: 355.6
    });
  });

  it("使用 A4 和 16mm 作为默认纸张配置", () => {
    expect(defaultExportConfig.themeId).toBe("typora-github");
    expect(defaultExportConfig.pageDecorationsMode).toBe("theme");
    expect(defaultExportConfig.paper).toEqual({
      format: "A4",
      orientation: "portrait",
      marginMode: "theme",
      margins: {
        top: "16mm",
        right: "16mm",
        bottom: "16mm",
        left: "16mm"
      }
    });
    expect(exportConfigSchema.safeParse(defaultExportConfig).success).toBe(true);
  });

  it("提供可由主题推荐的页眉和页码配置", () => {
    expect(defaultExportConfig.header).toMatchObject({
      fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif',
      showOnFirstPage: true
    });
    expect(defaultExportConfig.footer).toMatchObject({
      fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif',
      alignment: "center",
      format: "page-total",
      showOnFirstPage: true
    });

    const parsedLegacyV4 = exportConfigSchema.parse({
      ...defaultExportConfig,
      pageDecorationsMode: undefined,
      header: {
        ...defaultExportConfig.header,
        fontFamily: undefined,
        showOnFirstPage: undefined
      },
      footer: {
        ...defaultExportConfig.footer,
        fontFamily: undefined,
        showOnFirstPage: undefined
      }
    });

    expect(parsedLegacyV4.pageDecorationsMode).toBe("theme");
    expect(parsedLegacyV4.header.fontFamily).toContain("Microsoft YaHei");
    expect(parsedLegacyV4.header.showOnFirstPage).toBe(true);
    expect(parsedLegacyV4.footer.fontFamily).toContain("Microsoft YaHei");
    expect(parsedLegacyV4.footer.showOnFirstPage).toBe(true);
  });

  it("允许页眉和页码独立控制正文首页可见性", () => {
    const parsed = exportConfigSchema.parse({
      ...defaultExportConfig,
      header: {
        ...defaultExportConfig.header,
        enabled: true,
        showOnFirstPage: false
      },
      footer: {
        ...defaultExportConfig.footer,
        showOnFirstPage: true
      }
    });

    expect(parsed.header.showOnFirstPage).toBe(false);
    expect(parsed.footer.showOnFirstPage).toBe(true);
  });

  it("支持公文页码格式和奇偶页外侧对齐", () => {
    expect(
      exportConfigSchema.safeParse({
        ...defaultExportConfig,
        footer: {
          ...defaultExportConfig.footer,
          fontFamily: '"MorphDoc Fandol Song", SimSun, serif',
          fontSize: "4.94mm",
          color: "#000000",
          alignment: "outer",
          format: "official-page",
          showOnFirstPage: false
        }
      }).success
    ).toBe(true);
  });

  it("拒绝可能逃逸 CSS 字体声明的页眉页码字体", () => {
    expect(
      exportConfigSchema.safeParse({
        ...defaultExportConfig,
        footer: {
          ...defaultExportConfig.footer,
          fontFamily: 'serif; color: red'
        }
      }).success
    ).toBe(false);
  });

  it("按主题、自定义和全局默认顺序解析页边距", () => {
    const themeMargins = {
      top: "37mm",
      right: "26mm",
      bottom: "35mm",
      left: "28mm"
    };
    expect(resolvePageMargins(defaultExportConfig.paper, themeMargins)).toEqual(
      themeMargins
    );
    expect(resolvePageMargins(defaultExportConfig.paper)).toEqual({
      top: "16mm",
      right: "16mm",
      bottom: "16mm",
      left: "16mm"
    });
    expect(
      resolvePageMargins(
        {
          marginMode: "custom",
          margins: {
            top: "10mm",
            right: "11mm",
            bottom: "12mm",
            left: "13mm"
          }
        },
        themeMargins
      )
    ).toEqual({
      top: "10mm",
      right: "11mm",
      bottom: "12mm",
      left: "13mm"
    });
  });

  it("提供 Mermaid 官方布局、主题、外观和字体默认值", () => {
    expect(supportedMermaidLayouts).toEqual(["dagre", "elk"]);
    expect(supportedMermaidLooks).toEqual([
      "classic",
      "handDrawn",
      "neo"
    ]);
    expect(supportedMermaidThemes).toContain("redux-dark-color");
    expect(defaultExportConfig.mermaid).toEqual({
      layout: "dagre",
      theme: "default",
      look: "classic",
      fontFamily: "Segoe UI, Microsoft YaHei, sans-serif"
    });
  });

  it("拒绝 Mermaid 未支持的导出配置", () => {
    expect(
      exportConfigSchema.safeParse({
        ...defaultExportConfig,
        mermaid: {
          ...defaultExportConfig.mermaid,
          layout: "unknown"
        }
      }).success
    ).toBe(false);
    expect(
      exportConfigSchema.safeParse({
        ...defaultExportConfig,
        mermaid: {
          ...defaultExportConfig.mermaid,
          fontFamily: ""
        }
      }).success
    ).toBe(false);
  });

  it("使用统一的 96 CSS px/in 和 72 PDF pt/in 换算物理尺寸", () => {
    expect(millimetersToCssPixels(25.4)).toBeCloseTo(96);
    expect(cssPixelsToMillimeters(96)).toBeCloseTo(25.4);
    expect(millimetersToCssPixels(210)).toBeCloseTo(793.700787);
    expect(millimetersToPdfPoints(210)).toBeCloseTo(595.275591);
  });

  it("根据方向交换纸张宽高", () => {
    expect(getPaperDimensionsMm("A5", "portrait")).toEqual({
      width: 148,
      height: 210
    });
    expect(getPaperDimensionsMm("A5", "landscape")).toEqual({
      width: 210,
      height: 148
    });
  });

  it("拒绝旧配置版本和已移除的纸张类型", () => {
    expect(
      exportConfigSchema.safeParse({
        ...defaultExportConfig,
        version: 1
      }).success
    ).toBe(false);
    expect(
      exportConfigSchema.safeParse({
        ...defaultExportConfig,
        paper: {
          ...defaultExportConfig.paper,
          format: "Tabloid"
        }
      }).success
    ).toBe(false);
  });

  it("拒绝没有正文可用区域的页边距", () => {
    expect(
      exportConfigSchema.safeParse({
        ...defaultExportConfig,
        paper: {
          ...defaultExportConfig.paper,
          margins: {
            top: "149mm",
            right: "105mm",
            bottom: "149mm",
            left: "105mm"
          }
        }
      }).success
    ).toBe(false);
  });
});
