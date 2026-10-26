// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { preparePdfDocumentLinks } from "../src/pdf-document-links.js";

describe("PDF 本地链接准备", () => {
  it("只改写本地链接并保留网络、协议和锚点", () => {
    const root = document.createElement("article");
    root.innerHTML = [
      '<a href="../README.md">本地</a>',
      '<a href="file:///C:/docs/a.md">文件</a>',
      '<a href="https://example.com">网络</a>',
      '<a href="mailto:a@example.com">邮件</a>',
      '<a href="#chapter">锚点</a>'
    ].join("");

    expect(preparePdfDocumentLinks(root)).toBe(2);
    const hrefs = Array.from(root.querySelectorAll("a")).map(
      (link) => link.getAttribute("href")
    );
    expect(hrefs[0]).toContain(
      "https://morphdoc.local.invalid/document-link?"
    );
    expect(hrefs[1]).toContain(
      "https://morphdoc.local.invalid/document-link?"
    );
    expect(hrefs.slice(2)).toEqual([
      "https://example.com",
      "mailto:a@example.com",
      "#chapter"
    ]);
  });
});
