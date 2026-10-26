import { defaultExportConfig } from "@morphdoc/core";
import { describe, expect, it } from "vitest";
import {
  buildPagedMediaCss,
  continuousDocumentGeometryCss,
  createPagedPreviewRenderRequest,
  documentBaseCss,
  documentGeometryCss,
  documentInteractionCss,
  formatPageNumber,
  isPagedPreviewFrameMessage,
  isPagedPreviewRenderRequest,
  PAGED_PREVIEW_MESSAGE_SCOPE,
  resolvePageNumberAlignment,
  shouldRenderPageNumber,
  type PagedPreviewPayload
} from "../src/paged-preview.js";

const payload: PagedPreviewPayload = {
  articleHtml: '<article id="write"><h1>分页测试</h1></article>',
  fileName: "分页测试.md",
  metadata: {
    title: "分页测试",
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
  themeCss: "#write { color: #333; }",
  exportConfig: defaultExportConfig
};

describe("分页预览协议", () => {
  it("含行内代码的段落避免被 Paged.js 跨页拆分丢失片段", () => {
    const css = buildPagedMediaCss(defaultExportConfig, payload);

    expect(css).toContain("#write > p.md-inline-code-paragraph");
    expect(css).toContain("orphans: 1");
    expect(css).toContain("widows: 1");
  });

  it("生成真实纸张尺寸和页边距 CSS", () => {
    const css = buildPagedMediaCss(defaultExportConfig, payload);

    expect(css).toContain("size: 210mm 297mm");
    expect(css).toContain("margin: 16mm 16mm");
    expect(css).toContain("@bottom-center");
    expect(css).toContain(
      'font-family: "Segoe UI", "Microsoft YaHei", sans-serif'
    );
    expect(css).not.toContain("counter-reset: page");
    expect(css).toContain("#write thead");
    expect(css).toContain("display: table-header-group");
    expect(css).toContain("break-inside: avoid");
    expect(css).toContain(".pagedjs_pages");
    expect(css).toContain("padding: 34px 0");
    expect(css).toContain('html[data-render-target="preview"]');
    expect(css).toContain("overflow-x: hidden");
    expect(css).toContain("overflow-y: hidden");
    expect(css).not.toContain("scrollbar-color");
    expect(css).toContain('html[data-render-target="pdf"]');
    expect(css).toContain("height: auto !important");
    expect(css).toContain("overflow: visible !important");
    expect(css).toContain("page-break-after: auto !important");
    expect(css).toContain("padding: 0");
    expect(css).toContain("break-after: page");
    expect(css).not.toContain("@media print");
  });

  it("安全替换页眉变量并生成三栏页边距盒", () => {
    const css = buildPagedMediaCss(
      {
        ...defaultExportConfig,
        header: {
          ...defaultExportConfig.header,
          enabled: true,
          showDivider: true,
          left: {
            enabled: true,
            content: '${title} — ${filename} "测试"'
          },
          center: {
            enabled: true,
            content: "${author}"
          }
        }
      },
      {
        ...payload,
        metadata: {
          ...payload.metadata,
          author: "内网团队"
        }
      }
    );

    expect(css).toContain("@top-left");
    expect(css).toContain("@top-center");
    expect(css).toContain("@top-right");
    expect(css).toContain(
      'content: "分页测试 — 分页测试.md \\"测试\\""'
    );
    expect(css).toContain('content: "内网团队"');
    expect(css).toContain("border-bottom: 0.2mm solid currentColor");
    expect(css).toContain(
      "transform: translateY(calc(16mm - 8mm - 3mm))"
    );
  });

  it("支持自定义页码模板和起始页码", () => {
    const css = buildPagedMediaCss(
      {
        ...defaultExportConfig,
        footer: {
          ...defaultExportConfig.footer,
          format: "custom",
          template: "第 ${page} / ${pages} 页",
          alignment: "right",
          startFrom: 5
        }
      },
      payload
    );

    expect(css).toContain("@bottom-right");
    expect(
      formatPageNumber(
        {
          ...defaultExportConfig.footer,
          format: "custom",
          template: "第 ${page} / ${pages} 页",
          startFrom: 5
        },
        2,
        8
      )
    ).toBe("第 7 / 8 页");
  });

  it("逐页递增内置页码格式但保持真实总页数", () => {
    expect(
      formatPageNumber(defaultExportConfig.footer, 0, 5)
    ).toBe("1 / 5");
    expect(
      formatPageNumber(defaultExportConfig.footer, 1, 5)
    ).toBe("2 / 5");
    expect(
      formatPageNumber(
        {
          ...defaultExportConfig.footer,
          format: "chinese-page-total",
          startFrom: 5
        },
        3,
        5
      )
    ).toBe("第 8 页 / 共 5 页");
    expect(
      formatPageNumber(
        {
          ...defaultExportConfig.footer,
          format: "dash-page"
        },
        4,
        5
      )
    ).toBe("- 5 -");
    expect(
      formatPageNumber(
        {
          ...defaultExportConfig.footer,
          format: "official-page"
        },
        4,
        5
      )
    ).toBe("— 5 —");
  });

  it("将公文页码放在奇偶页外侧并支持首页隐藏", () => {
    const officialFooter = {
      ...defaultExportConfig.footer,
      alignment: "outer" as const,
      showOnFirstPage: false
    };

    expect(resolvePageNumberAlignment(officialFooter, 0)).toBe(
      "right"
    );
    expect(resolvePageNumberAlignment(officialFooter, 1)).toBe(
      "left"
    );
    expect(resolvePageNumberAlignment(officialFooter, 2)).toBe(
      "right"
    );
    expect(shouldRenderPageNumber(officialFooter, 0)).toBe(false);
    expect(shouldRenderPageNumber(officialFooter, 1)).toBe(true);
  });

  it("在主题 CSS 之后强制分页画布保持透明", () => {
    expect(documentGeometryCss).toContain(
      "background: transparent !important"
    );
  });

  it("由语义文档强制封面结束后换页", () => {
    expect(documentGeometryCss).toContain(
      '#write [data-semantic-break-after="next-page"]'
    );
    expect(documentGeometryCss).toContain(
      "break-after: page !important"
    );
    expect(documentGeometryCss).toContain(
      "page-break-after: always !important"
    );
    expect(documentGeometryCss).not.toContain(
      '[data-semantic-region="cover"][data-semantic-break-after="next-page"]'
    );
    expect(documentGeometryCss).not.toContain(
      "break-after: auto !important"
    );
  });

  it("使用标准 Letter 横向尺寸生成分页规则", () => {
    const css = buildPagedMediaCss(
      {
        ...defaultExportConfig,
        paper: {
          ...defaultExportConfig.paper,
          format: "Letter",
          orientation: "landscape"
        }
      },
      payload
    );

    expect(css).toContain("size: 279.4mm 215.9mm;");
  });

  it("避免围栏容器重复应用行内代码盒模型", () => {
    expect(documentBaseCss).toContain(
      "#write pre.md-fences > code"
    );
    expect(documentBaseCss).toContain("background: transparent;");
    expect(documentBaseCss).toContain("font-size: inherit;");
    expect(documentBaseCss).not.toMatch(
      /#write pre\.md-fences > code,[\s\S]*?font-family:\s*inherit;/u
    );
    expect(documentBaseCss).not.toMatch(
      /#write pre\.md-fences > code\s*\{[^}]*!important/su
    );
  });

  it("只在至少两行的代码组之间分页", () => {
    const css = buildPagedMediaCss(defaultExportConfig, payload);

    expect(css).toContain("#write .md-code-pagination-chunk");
    expect(css).toContain("#write .md-code-line-group");
    expect(css).toContain("page-break-inside: avoid;");
    expect(css).toContain(
      '[data-code-pagination-position="first"]'
    );
    expect(css).toContain(
      '[data-code-pagination-position="last"]'
    );
    expect(css).toContain("#write .md-code-line");
    expect(css).toContain("min-height: 1lh;");
  });

  it("代码围栏按正文宽度保留缩进并自动折行", () => {
    expect(documentBaseCss).toContain("#write pre.md-fences,");
    expect(documentBaseCss).toContain(
      "#write .md-code-pagination-chunk"
    );
    expect(documentBaseCss).toContain("max-width: 100%;");
    expect(documentBaseCss).toContain("padding-left: 8px;");
    expect(documentBaseCss).toContain("white-space: pre-wrap;");
    expect(documentBaseCss).toContain("overflow-wrap: anywhere;");
    expect(documentBaseCss).toContain("word-break: break-word;");
    expect(documentBaseCss).toMatch(
      /#write th,[\s\S]*#write td \{[\s\S]*word-break: break-word;/u,
    );
    expect(documentBaseCss).toMatch(
      /#write th code,[\s\S]*#write td code \{[\s\S]*white-space: pre-wrap;[\s\S]*overflow-wrap: anywhere;[\s\S]*word-break: break-word;/u,
    );

    const css = buildPagedMediaCss(defaultExportConfig, payload);
    expect(css).toContain("#write .md-code-line");
    expect(css).toContain("overflow-wrap: inherit;");
    expect(css).toContain("word-break: inherit;");
  });

  it("以低优先级兜底样式保留链接识别和焦点反馈", () => {
    expect(documentInteractionCss).toContain(":where(#write a[href])");
    expect(documentInteractionCss).toContain(
      "text-decoration-line: underline;"
    );
    expect(documentInteractionCss).toContain(":focus-visible");
    expect(documentInteractionCss).toContain("--md-accent");
    expect(documentInteractionCss).not.toContain("!important");
  });

  it("连续预览由内容高度驱动且不创建内部滚动容器", () => {
    expect(continuousDocumentGeometryCss).toContain(
      "overflow: hidden !important"
    );
    expect(continuousDocumentGeometryCss).toContain(
      "min-height: 0 !important"
    );
    expect(continuousDocumentGeometryCss).toContain(
      '[data-continuous-render-stage="true"]'
    );
    expect(continuousDocumentGeometryCss).toContain(
      "position: fixed !important"
    );
    expect(continuousDocumentGeometryCss).not.toContain("100vh");
  });

  it("生成并识别分页渲染请求", () => {
    const request = createPagedPreviewRenderRequest(7, payload);

    expect(request).toEqual({
      scope: PAGED_PREVIEW_MESSAGE_SCOPE,
      type: "render",
      requestId: 7,
      layout: "paged",
      payload
    });
    expect(isPagedPreviewRenderRequest(request)).toBe(true);
    expect(
      createPagedPreviewRenderRequest(
        8,
        payload,
        "continuous"
      ).layout
    ).toBe("continuous");
    expect(
      isPagedPreviewRenderRequest({
        ...request,
        requestId: "7"
      })
    ).toBe(false);
  });

  it("只接受分页 iframe 协议消息", () => {
    expect(
      isPagedPreviewFrameMessage({
        scope: PAGED_PREVIEW_MESSAGE_SCOPE,
        type: "link",
        href: "https://example.com"
      })
    ).toBe(true);
    expect(
      isPagedPreviewFrameMessage({
        scope: PAGED_PREVIEW_MESSAGE_SCOPE,
        type: "link",
        href: ""
      })
    ).toBe(false);
    expect(
      isPagedPreviewFrameMessage({
        scope: PAGED_PREVIEW_MESSAGE_SCOPE,
        type: "rendered",
        requestId: 3,
        layout: "paged",
        pageCount: 2,
        contentHeight: 2400,
        echartsErrors: [],
        mermaidErrors: []
      })
    ).toBe(true);
    expect(
      isPagedPreviewFrameMessage({
        scope: PAGED_PREVIEW_MESSAGE_SCOPE,
        type: "rendered",
        requestId: 3,
        layout: "paged",
        pageCount: 2,
        echartsErrors: [],
        mermaidErrors: []
      })
    ).toBe(false);
    expect(
      isPagedPreviewFrameMessage({
        scope: "other",
        type: "ready"
      })
    ).toBe(false);
  });
});
