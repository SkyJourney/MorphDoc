import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveDesktopDocumentLinkAction } from "../src/desktop-document-link.js";

describe("桌面文档链接动作", () => {
  const markdownPath = path.resolve("D:/文档/章节/当前.md");

  it("保留锚点并把网络和自定义协议交给系统", () => {
    expect(resolveDesktopDocumentLinkAction("#标题")).toEqual({
      type: "anchor",
      href: "#标题"
    });
    expect(
      resolveDesktopDocumentLinkAction("//example.com/path")
    ).toEqual({
      type: "external",
      href: "https://example.com/path"
    });
    expect(
      resolveDesktopDocumentLinkAction("mailto:user@example.com")
    ).toEqual({
      type: "external",
      href: "mailto:user@example.com"
    });
    expect(
      resolveDesktopDocumentLinkAction("obsidian://open?vault=docs")
    ).toEqual({
      type: "external",
      href: "obsidian://open?vault=docs"
    });
  });

  it("允许相对路径越过 Markdown 目录", () => {
    expect(
      resolveDesktopDocumentLinkAction(
        "../../共享/说明.pdf#page=2",
        markdownPath
      )
    ).toEqual({
      type: "local",
      filePath: path.resolve(
        path.dirname(markdownPath),
        "../../共享/说明.pdf"
      )
    });
  });

  it("解析绝对路径、file URI 和 URL 编码", () => {
    const absolutePath = path.resolve("C:/资料/项目说明.md");
    expect(
      resolveDesktopDocumentLinkAction(absolutePath, markdownPath)
    ).toEqual({
      type: "local",
      filePath: path.normalize(absolutePath)
    });
    expect(
      resolveDesktopDocumentLinkAction(
        pathToFileURL(absolutePath).href,
        markdownPath
      )
    ).toEqual({
      type: "local",
      filePath: path.normalize(absolutePath)
    });
    expect(
      resolveDesktopDocumentLinkAction(
        "../%E5%85%B1%E4%BA%AB/%E8%AF%B4%E6%98%8E.pdf",
        markdownPath
      )
    ).toEqual({
      type: "local",
      filePath: path.resolve(
        path.dirname(markdownPath),
        "../共享/说明.pdf"
      )
    });
  });

  it("拒绝危险链接和无文件基准的相对路径", () => {
    expect(
      resolveDesktopDocumentLinkAction("javascript:alert(1)")
    ).toEqual({ type: "ignore" });
    expect(() =>
      resolveDesktopDocumentLinkAction("../说明.pdf")
    ).toThrow("尚未保存");
  });
});
