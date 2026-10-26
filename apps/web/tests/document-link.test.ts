import { describe, expect, it } from "vitest";
import { resolveWebDocumentLinkAction } from "../src/document-link";

describe("Web 文档链接行为", () => {
  it("保留文档锚点", () => {
    expect(resolveWebDocumentLinkAction("#section")).toEqual({
      type: "anchor",
      href: "#section"
    });
  });

  it("在外部窗口打开 HTTP 链接和浏览器协议", () => {
    expect(
      resolveWebDocumentLinkAction("//example.com/path")
    ).toEqual({
      type: "open",
      href: "https://example.com/path"
    });
    expect(
      resolveWebDocumentLinkAction("mailto:a@example.com")
    ).toEqual({
      type: "open",
      href: "mailto:a@example.com"
    });
    expect(resolveWebDocumentLinkAction("tel:+8612345")).toEqual({
      type: "open",
      href: "tel:+8612345"
    });
  });

  it("忽略本地、未知和危险地址", () => {
    for (const href of [
      "../docs/a.md",
      "C:/docs/a.md",
      "file:///C:/docs/a.md",
      "obsidian://open?vault=x",
      "javascript:alert(1)"
    ]) {
      expect(resolveWebDocumentLinkAction(href)).toEqual({
        type: "ignore"
      });
    }
  });
});
