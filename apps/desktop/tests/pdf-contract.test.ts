import { describe, expect, it } from "vitest";
import {
  createPagedDocumentPayload,
  defaultExportConfig
} from "@morphdoc/core";
import {
  createElectronPdfPrintOptions,
  isAllowedPdfRuntimeUrl,
  parsePagedDocumentPayload
} from "../src/pdf-contract.js";
import {
  parseMarkdownRenderRequest,
  parseFontPackResourceUrl,
  parseThemeId,
  parseThemeResourceUrl
} from "../src/application-contract.js";

const payload = createPagedDocumentPayload({
  document: {
    rendererVersion: 1,
    articleHtml: '<article id="write"><h1>测试</h1></article>',
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
    features: ["mermaid"],
    warnings: []
  },
  fileName: "测试.md",
  themeCss: "#write { color: black; }",
  exportConfig: defaultExportConfig
});

describe("桌面 PDF 载荷", () => {
  it("校验并保留合法的共享分页载荷", () => {
    expect(parsePagedDocumentPayload(payload)).toEqual(payload);
  });

  it("拒绝无效功能标识", () => {
    expect(() =>
      parsePagedDocumentPayload({
        ...payload,
        features: ["remote-script"]
      })
    ).toThrow();
  });

  it("映射为与 Playwright 对齐的 Electron 打印参数", () => {
    expect(
      createElectronPdfPrintOptions(payload, {
        pageCount: 3,
        echartsErrors: [],
        mermaidErrors: [],
        timings: {
          setupMs: 0,
          echartsMs: 0,
          echartsFitMs: 0,
          mermaidMs: 0,
          mermaidFitMs: 0,
          mermaidConversionMs: 0,
          resourceWaitMs: 0,
          paginationMs: 0,
          finalizeMs: 0,
          totalMs: 0
        }
      })
    ).toEqual({
      displayHeaderFooter: false,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      pageRanges: "1-3",
      preferCSSPageSize: true,
      printBackground: true,
      scale: 1
    });
  });
});

describe("桌面 PDF 网络边界", () => {
  const renderUrl =
    "http://localhost:5173/preview-frame.html?target=pdf";

  it("允许同源和内嵌资源", () => {
    expect(
      isAllowedPdfRuntimeUrl(
        "http://localhost:5173/assets/runtime.js",
        renderUrl
      )
    ).toBe(true);
    expect(isAllowedPdfRuntimeUrl("data:image/png;base64,AA", renderUrl))
      .toBe(true);
    expect(
      isAllowedPdfRuntimeUrl(
        "morphdoc://theme/typora-like/font.woff2",
        renderUrl
      )
    ).toBe(true);
    expect(
      isAllowedPdfRuntimeUrl(
        "morphdoc://font-pack/official-cjk/1.0.0/serif/web?v=abc",
        renderUrl
      )
    ).toBe(true);
  });

  it("拒绝外部网络资源", () => {
    expect(
      isAllowedPdfRuntimeUrl("https://example.com/image.png", renderUrl)
    ).toBe(false);
  });
});

describe("桌面应用服务 IPC 载荷", () => {
  it("只提取 Markdown 渲染所需字段", () => {
    expect(
      parseMarkdownRenderRequest({
        markdown: "# 测试",
        language: "zh-CN",
        ignored: true
      })
    ).toEqual({
      markdown: "# 测试",
      language: "zh-CN"
    });
  });

  it("校验主题 ID 与主题资源地址", () => {
    expect(parseThemeId("typora-like")).toBe("typora-like");
    expect(
      parseThemeResourceUrl(
        "morphdoc://theme/typora-like/fonts/test.woff2"
      )
    ).toEqual({
      themeId: "typora-like",
      assetPath: "fonts/test.woff2"
    });
    expect(() => parseThemeId("../outside")).toThrow("主题 ID 无效");
    expect(
      parseThemeResourceUrl("morphdoc://bundle/index.html")
    ).toBeUndefined();
  });

  it("只接受字体包 Web 资源地址", () => {
    expect(
      parseFontPackResourceUrl(
        "morphdoc://font-pack/official-cjk/1.0.0/serif-regular/web?v=abc"
      )
    ).toEqual({
      packId: "official-cjk",
      packVersion: "1.0.0",
      faceId: "serif-regular",
      kind: "web"
    });
    expect(() =>
      parseFontPackResourceUrl(
        "morphdoc://font-pack/official-cjk/1.0.0/serif-regular/docx"
      )
    ).toThrow("字体包资源地址无效");
  });
});
