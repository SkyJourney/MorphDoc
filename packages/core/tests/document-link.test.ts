import { describe, expect, it } from "vitest";
import {
  classifyDocumentLink,
  decodeLocalDocumentLinkFromPdf,
  encodeLocalDocumentLinkForPdf,
  isSafeDocumentLink
} from "../src/document-link.js";

describe("文档链接分类", () => {
  it("识别文档锚点和网络链接", () => {
    expect(classifyDocumentLink("#章节一").kind).toBe("anchor");
    expect(
      classifyDocumentLink("https://example.com/a").kind
    ).toBe("network");
    expect(
      classifyDocumentLink("//example.com/a").normalizedHref
    ).toBe("https://example.com/a");
  });

  it("识别浏览器协议处理器和未知协议", () => {
    expect(classifyDocumentLink("mailto:a@example.com")).toMatchObject({
      kind: "protocol",
      scheme: "mailto"
    });
    expect(classifyDocumentLink("tel:+8612345")).toMatchObject({
      kind: "protocol",
      scheme: "tel"
    });
    expect(classifyDocumentLink("obsidian://open?vault=x")).toMatchObject({
      kind: "protocol",
      scheme: "obsidian"
    });
  });

  it("识别跨目录、绝对路径、UNC 和 file URI", () => {
    for (const href of [
      "../docs/a.md",
      "/opt/docs/a.md",
      "C:/docs/a.md",
      "D:\\docs\\a.md",
      "\\\\server\\share\\a.md",
      "file:///C:/docs/a.md"
    ]) {
      expect(classifyDocumentLink(href).kind).toBe("local");
    }
  });

  it("拒绝危险协议、控制字符和无效网络地址", () => {
    for (const href of [
      "javascript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html;base64,WA=="
    ]) {
      expect(classifyDocumentLink(href).kind).toBe("unsafe");
      expect(isSafeDocumentLink(href)).toBe(false);
    }
    expect(classifyDocumentLink("https://[invalid").kind).toBe(
      "invalid"
    );
    expect(classifyDocumentLink("a\u0000b").kind).toBe("invalid");
  });

  it("为 PDF 注释编码并还原本地链接", () => {
    for (const href of [
      "../docs/说明.md#章节",
      "C:/docs/a.md",
      "file:///D:/docs/a.md"
    ]) {
      const encoded = encodeLocalDocumentLinkForPdf(href);
      expect(encoded).toMatch(
        /^https:\/\/morphdoc\.local\.invalid\/document-link\?/u
      );
      expect(decodeLocalDocumentLinkFromPdf(encoded ?? "")).toBe(
        href
      );
    }
  });

  it("不编码网络链接且拒绝伪造的 PDF 本地链接", () => {
    expect(
      encodeLocalDocumentLinkForPdf("https://example.com")
    ).toBeUndefined();
    expect(
      decodeLocalDocumentLinkFromPdf(
        "https://morphdoc.local.invalid/document-link?href=https%3A%2F%2Fexample.com"
      )
    ).toBeUndefined();
    expect(
      decodeLocalDocumentLinkFromPdf(
        "https://example.com/document-link?href=..%2Fa.md"
      )
    ).toBeUndefined();
  });
});
