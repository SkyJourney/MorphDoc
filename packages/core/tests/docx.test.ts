import { describe, expect, it } from "vitest";
import {
  DOCX_MIME_TYPE,
  DOCX_MEDIA_RASTER_SCALE,
  DOCX_PANDOC_VERSION,
  MAXIMUM_DOCX_MEDIA_COUNT,
  MAXIMUM_DOCX_MEDIA_EDGE_PIXELS,
  MAXIMUM_DOCX_MARKDOWN_LENGTH,
  MAXIMUM_DOCX_RESOURCE_COUNT,
  createDocxFileName,
  defaultExportConfig,
  docxCapabilitySchema,
  docxMediaCapturePlanSchema,
  docxExportErrorResponseSchema,
  docxExportRequestSchema,
  docxThemeStyleSchema
} from "../src/index.js";

describe("DOCX 共享协议", () => {
  it("解析跨端导出请求并补齐稳定默认值", () => {
    expect(
      docxExportRequestSchema.parse({
        markdown: "# 文档",
        exportConfig: defaultExportConfig
      })
    ).toEqual({
      markdown: "# 文档",
      fileName: "文档.md",
      language: "zh-CN",
      resources: [],
      exportConfig: defaultExportConfig
    });
  });

  it("校验导出配置与请求资源结构", () => {
    expect(
      docxExportRequestSchema.safeParse({
        markdown: "# 文档",
        exportConfig: {}
      }).success
    ).toBe(false);
    expect(
      docxExportRequestSchema.safeParse({
        markdown: "# 文档",
        resources: [{ path: "", data: "" }],
        exportConfig: defaultExportConfig
      }).success
    ).toBe(false);
  });

  it("拒绝超过共享协议上限的 Markdown", () => {
    expect(
      docxExportRequestSchema.safeParse({
        markdown: "x".repeat(MAXIMUM_DOCX_MARKDOWN_LENGTH + 1),
        exportConfig: defaultExportConfig
      }).success
    ).toBe(false);
  });

  it("生成跨平台安全的 DOCX 文件名", () => {
    expect(createDocxFileName("C:\\资料\\项目报告.markdown")).toBe(
      "项目报告.docx"
    );
    expect(createDocxFileName("../../非法:*?.md")).toBe("非法___.docx");
    expect(createDocxFileName("   ")).toBe("文档.docx");
    expect(createDocxFileName(undefined)).toBe("文档.docx");
  });

  it("只将精确版本识别为可用能力", () => {
    expect(
      docxCapabilitySchema.parse({
        format: "docx",
        status: "available",
        expectedVersion: DOCX_PANDOC_VERSION,
        detectedVersion: DOCX_PANDOC_VERSION
      })
    ).toEqual({
      format: "docx",
      status: "available",
      expectedVersion: "3.9.0.2",
      detectedVersion: "3.9.0.2"
    });
    expect(
      docxCapabilitySchema.safeParse({
        format: "docx",
        status: "available",
        expectedVersion: DOCX_PANDOC_VERSION,
        detectedVersion: "3.8"
      }).success
    ).toBe(false);
    expect(
      docxCapabilitySchema.safeParse({
        format: "docx",
        status: "version-mismatch",
        expectedVersion: DOCX_PANDOC_VERSION,
        detectedVersion: "3.8",
        message: "Pandoc 版本不匹配"
      }).success
    ).toBe(true);
  });

  it("暴露标准 DOCX MIME", () => {
    expect(DOCX_MIME_TYPE).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  });

  it("提供可跨 HTTP 与 IPC 传递的错误响应", () => {
    expect(
      docxExportErrorResponseSchema.parse({
        error: "DOCX_RUNTIME_NOT_FOUND",
        message: "未找到 Pandoc"
      })
    ).toEqual({
      error: "DOCX_RUNTIME_NOT_FOUND",
      message: "未找到 Pandoc",
      retryable: false
    });
  });

  it("校验 DOCX PNG 媒体捕获计划", () => {
    expect(DOCX_MEDIA_RASTER_SCALE).toBe(3.125);
    expect(MAXIMUM_DOCX_MEDIA_EDGE_PIXELS).toBe(4096);
    expect(
      docxMediaCapturePlanSchema.parse({
        targets: [
          {
            id: "docx-media-1",
            kind: "mermaid",
            ordinal: 1,
            kindOrdinal: 1,
            altText: "流程图",
            caption: "处理流程",
            alignment: "center",
            displayWidthPx: 640,
            displayHeightPx: 320,
            captureX: 20,
            captureY: 120,
            captureWidthPx: 640,
            captureHeightPx: 320,
            rasterScale: 3.125
          }
        ],
        echartsErrors: [],
        mermaidErrors: []
      }).targets
    ).toHaveLength(1);
    expect(
      docxMediaCapturePlanSchema.safeParse({
        targets: [
          {
            id: "../越界",
            kind: "image",
            ordinal: 1,
            kindOrdinal: 1,
            altText: "",
            alignment: "center",
            displayWidthPx: 100,
            displayHeightPx: 100,
            captureX: 0,
            captureY: 0,
            captureWidthPx: 100,
            captureHeightPx: 100,
            rasterScale: 3.125
          }
        ],
        echartsErrors: [],
        mermaidErrors: []
      }).success
    ).toBe(false);
  });

  it("区分用户资源上限与渲染后媒体上限", () => {
    expect(MAXIMUM_DOCX_RESOURCE_COUNT).toBe(50);
    expect(MAXIMUM_DOCX_MEDIA_COUNT).toBe(100);
    expect(
      docxExportRequestSchema.safeParse({
        markdown: "# 文档",
        resources: Array.from({ length: 51 }, (_, index) => ({
          path: `asset-${index}.png`,
          data: "AA=="
        })),
        exportConfig: defaultExportConfig
      }).success
    ).toBe(false);
    const targets = Array.from({ length: 67 }, (_, index) => ({
      id: `docx-media-${index + 1}`,
      kind: "mermaid" as const,
      ordinal: index + 1,
      kindOrdinal: index + 1,
      altText: `图 ${index + 1}`,
      alignment: "center" as const,
      displayWidthPx: 100,
      displayHeightPx: 100,
      captureX: 0,
      captureY: index * 100,
      captureWidthPx: 100,
      captureHeightPx: 100,
      rasterScale: 3.125
    }));
    expect(
      docxMediaCapturePlanSchema.safeParse({
        targets,
        echartsErrors: [],
        mermaidErrors: []
      }).success
    ).toBe(true);
  });
});

describe("DOCX 主题样式协议", () => {
  it("接受预设和受限样式覆盖", () => {
    expect(
      docxThemeStyleSchema.parse({
        preset: "formal",
        body: {
          fonts: {
            latin: "Times New Roman",
            eastAsia: "SimSun"
          },
          sizePt: 12,
          lineSpacing: 1.5
        },
        headings: {
          sizesPt: [22, 18, 16, 14, 12, 10.5],
          color: "#1f2937"
        },
        table: {
          borderColor: "#d1d5db",
          cellMarginMm: 1.5
        }
      })
    ).toMatchObject({
      preset: "formal",
      body: { sizePt: 12, lineSpacing: 1.5 }
    });
  });

  it("拒绝危险字体名称和越界样式值", () => {
    expect(() =>
      docxThemeStyleSchema.parse({
        preset: "general",
        body: {
          fonts: {
            latin: "Arial; DROP",
            eastAsia: "宋体"
          },
          sizePt: 200
        }
      })
    ).toThrow();
  });

  it("接受自动映射模式和兼容预设", () => {
    expect(
      docxThemeStyleSchema.parse({
        mode: "auto-with-overrides",
        basePreset: "technical",
        overrides: {
          table: {
            headerBackgroundColor: "#f6f8fa"
          }
        }
      })
    ).toMatchObject({
      mode: "auto-with-overrides",
      basePreset: "technical",
      overrides: {
        table: {
          headerBackgroundColor: "#f6f8fa"
        }
      }
    });
  });
});
