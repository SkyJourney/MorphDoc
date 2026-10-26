import { describe, expect, it, vi } from "vitest";
import {
  defaultExportConfig,
  type ThemeManifest
} from "@morphdoc/core";
import {
  DOCX_STYLE_SLOTS,
  type DocxThemeStyleCaptureAdapter
} from "@morphdoc/docx-theme-engine";
import {
  DocxThemeTokenService,
  type PreparedDocxExport
} from "../src/index.js";

function manifest(
  docxStyle: ThemeManifest["docxStyle"] = {
    mode: "auto",
    basePreset: "technical"
  }
): ThemeManifest {
  return {
    manifestVersion: 1,
    id: "test-theme",
    name: "测试主题",
    version: "1.0.0",
    description: "测试",
    author: "测试",
    license: "内部许可",
    entry: "theme.css",
    domPreset: "generic",
    defaultFontSize: "16px",
    supportedFeatures: [],
    category: "general",
    compatibleProfiles: [],
    docxStyle,
    bundled: true
  };
}

function prepared(
  docxStyle?: ThemeManifest["docxStyle"]
): PreparedDocxExport {
  return {
    request: {
      markdown: "# 测试",
      fileName: "测试.md",
      language: "zh-CN",
      resources: [],
      exportConfig: {
        ...defaultExportConfig,
        themeId: "test-theme"
      }
    },
    document: {
      rendererVersion: 1,
      articleHtml:
        '<article id="write"><h1>测试</h1></article>',
      bodyHtml: "<h1>测试</h1>",
      metadata: {
        title: "测试",
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
      warnings: []
    },
    theme: {
      manifest: manifest(docxStyle),
      source: "bundled",
      css: "#write { font-family: Test; }",
      fonts: []
    }
  };
}

function adapter(): DocxThemeStyleCaptureAdapter {
  return {
    themeStyleBaseUrl:
      "http://localhost:5173/preview-frame.html",
    captureThemeStyle: vi.fn(async (request) => ({
      schemaVersion: 1,
      themeId: request.themeId,
      themeFingerprint: request.themeFingerprint,
      viewport: {
        widthPx: 794,
        heightPx: 1123,
        deviceScaleFactor: 1
      },
      rootFontSizePx: 16,
      slots: DOCX_STYLE_SLOTS.map(({ name }) => ({
        slot: name,
        matched: false
      }))
    }))
  };
}

describe("DOCX 主题令牌准备服务", () => {
  it("按主题指纹缓存跨端样式快照", async () => {
    const captureAdapter = adapter();
    const service = new DocxThemeTokenService(captureAdapter);

    const first = await service.prepare(prepared());
    const second = await service.prepare(prepared());

    expect(captureAdapter.captureThemeStyle).toHaveBeenCalledTimes(1);
    expect(first.tokens).toEqual(second.tokens);
    expect(first.tokens.themeId).toBe("test-theme");
    expect(first.tokens.themeFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.tokens.slots).toHaveLength(DOCX_STYLE_SLOTS.length);
  });

  it("显式模式跳过浏览器采集并只产生信息级降级诊断", async () => {
    const captureAdapter = adapter();
    const service = new DocxThemeTokenService(captureAdapter);

    const result = await service.prepare(
      prepared({
        mode: "explicit",
        basePreset: "technical"
      })
    );

    expect(captureAdapter.captureThemeStyle).not.toHaveBeenCalled();
    expect(result.tokens.mode).toBe("explicit");
    expect(result.warnings).toEqual([]);
    expect(
      result.tokens.diagnostics.every(
        (diagnostic) => diagnostic.severity === "info"
      )
    ).toBe(true);
  });
});
