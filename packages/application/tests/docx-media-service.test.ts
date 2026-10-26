import { describe, expect, it } from "vitest";
import {
  defaultExportConfig,
  type DocxMediaCapturePlan,
  type ThemeManifest
} from "@morphdoc/core";
import {
  getDocxMediaRenderDimensions,
  prepareDocxMedia,
  type DocxMediaCaptureAdapter,
  type PreparedDocxExport
} from "../src/index.js";

function createPng(width: number, height: number) {
  const content = new Uint8Array(24);
  content.set([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
  ]);
  content.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(content.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return content;
}

const manifest: ThemeManifest = {
  manifestVersion: 1,
  id: "test-theme",
  name: "测试主题",
  version: "1.0.0",
  description: "测试",
  author: "测试",
  license: "内部许可",
  entry: "theme.css",
  domPreset: "typora",
  defaultFontSize: "16px",
  supportedFeatures: ["mermaid", "echarts"],
  category: "general",
  compatibleProfiles: [],
  pageDefaults: {
    margins: {
      top: "20mm",
      right: "20mm",
      bottom: "20mm",
      left: "20mm"
    }
  },
  bundled: true
};

const prepared: PreparedDocxExport = {
  request: {
    markdown: "# 文档",
    fileName: "报告.md",
    language: "zh-CN",
    resources: [],
    exportConfig: {
      ...defaultExportConfig,
      themeId: manifest.id
    }
  },
  document: {
    rendererVersion: 1,
    articleHtml: '<article id="write"></article>',
    bodyHtml: "",
    metadata: {
      title: "文档",
      author: "",
      subject: "",
      keywords: [],
      language: "zh-CN"
    },
    semanticDocument: {
      schemaVersion: 1,
      titlePolicy: {
        metadataTitle: "suppress",
        firstBodyHeading: "keep"
      },
      regions: []
    },
    features: [],
    warnings: ["原始图片已降级"]
  },
  theme: {
    manifest,
    source: "bundled",
    css: "#write { color: black; }",
    fonts: []
  }
};

function createPlan(): DocxMediaCapturePlan {
  return {
    targets: [
      {
        id: "docx-media-1",
        kind: "echarts",
        ordinal: 1,
        kindOrdinal: 1,
        altText: "收入趋势",
        caption: "年度收入",
        alignment: "center",
        displayWidthPx: 320,
        displayHeightPx: 160,
        captureX: 0,
        captureY: 0,
        captureWidthPx: 320,
        captureHeightPx: 160,
        rasterScale: 3.125
      }
    ],
    echartsErrors: [],
    mermaidErrors: []
  };
}

describe("DOCX 媒体预处理服务", () => {
  it("按主题页边距计算媒体内容区域", () => {
    const dimensions = getDocxMediaRenderDimensions(prepared);
    expect(dimensions.contentWidthPx).toBeCloseTo(
      ((210 - 40) * 96) / 25.4
    );
    expect(dimensions.contentHeightPx).toBeCloseTo(
      ((297 - 40) * 96) / 25.4
    );
  });

  it("校验并输出稳定 PNG 媒体清单", async () => {
    const adapter: DocxMediaCaptureAdapter = {
      capture: async ({ dimensions, payload }) => {
        expect(dimensions.contentWidthPx).toBeGreaterThan(600);
        expect(payload.articleHtml).toContain('id="write"');
        return {
          plan: createPlan(),
          captures: [
            {
              id: "docx-media-1",
              png: createPng(1000, 500)
            }
          ]
        };
      }
    };

    const result = await prepareDocxMedia(prepared, adapter);

    expect(result.resources[0]).toMatchObject({
      id: "docx-media-1",
      fileName: "media-001.png",
      contentType: "image/png",
      pixelWidth: 1000,
      pixelHeight: 500,
      caption: "年度收入"
    });
    expect(result.warnings).toEqual(["原始图片已降级"]);
    expect(result.totalBytes).toBe(24);
  });

  it("拒绝伪 PNG、缺失捕获和尺寸不一致", async () => {
    const capture = async (
      png: Uint8Array,
      includeCapture = true
    ) =>
      prepareDocxMedia(prepared, {
        capture: async () => ({
          plan: createPlan(),
          captures: includeCapture
            ? [{ id: "docx-media-1", png }]
            : []
        })
      });

    await expect(capture(new Uint8Array(24))).rejects.toThrow(
      "不是有效 PNG"
    );
    await expect(
      capture(createPng(1000, 500), false)
    ).rejects.toThrow("不匹配");
    await expect(capture(createPng(990, 500))).rejects.toThrow(
      "尺寸与捕获计划不一致"
    );
  });
});
