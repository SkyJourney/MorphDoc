import { describe, expect, it } from "vitest";
import {
  createPagedDocumentPayload,
  defaultExportConfig,
  type RenderedMarkdownDocument
} from "../src/index.js";

describe("分页文档载荷", () => {
  it("从统一渲染结果提取预览与 PDF 共用字段", () => {
    const document: RenderedMarkdownDocument = {
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
      features: ["table"],
      warnings: []
    };

    expect(
      createPagedDocumentPayload({
        document,
        fileName: "测试.md",
        themeCss: "#write { color: #333; }",
        exportConfig: defaultExportConfig
      })
    ).toEqual({
      articleHtml: document.articleHtml,
      fileName: "测试.md",
      metadata: document.metadata,
      semanticDocument: document.semanticDocument,
      features: document.features,
      themeCss: "#write { color: #333; }",
      exportConfig: defaultExportConfig
    });
  });
});
