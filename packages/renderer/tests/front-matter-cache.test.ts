import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import {
  MarkdownDocumentParseError,
  renderMarkdown
} from "../src/render-markdown.js";

/**
 * 回归：gray-matter 在解析之前就把内容写入全局缓存 matter.cache，解析失败后条目残留，
 * 同样内容的下一次调用直接命中缓存而不再抛错，整段 YAML 被当作正文渲染，标题被误取为
 * 正文首个标题。缓存还以浅拷贝返回，多次调用会共享同一个 data 对象。
 * 修复方式：调用 matter(source, {})，传入选项即可绕过缓存。
 */
describe("Front Matter 解析不受 gray-matter 缓存影响", () => {
  const invalid = "---\nkey: [front-matter-cache-regression\n---\n\n# 正文标题\n";
  const valid = "---\ntitle: 缓存回归\nauthor: 测试\n---\n\n# 正文标题\n";

  it("同一份无效 Front Matter 每次渲染都抛出同一种错误", () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect(
        () => renderMarkdown(invalid),
        `第 ${attempt} 次渲染`
      ).toThrow(MarkdownDocumentParseError);
    }
  });

  it("无效 Front Matter 不会被当作正文渲染，也不会影响标题提取", () => {
    expect(() => renderMarkdown(invalid)).toThrow(MarkdownDocumentParseError);
    // 修复前：第二次调用起不再抛错，且 metadata.title 被误取为 "正文标题"
    expect(() => renderMarkdown(invalid)).toThrow(MarkdownDocumentParseError);
  });

  it("渲染有效与无效文档后，gray-matter 的全局缓存保持为空", () => {
    renderMarkdown(valid);
    renderMarkdown(valid);
    expect(() => renderMarkdown(invalid)).toThrow(MarkdownDocumentParseError);

    // 直接断言根因：任何缓存条目都意味着重复调用可能命中被污染的结果
    expect(Object.keys(matter.cache)).toEqual([]);
  });

  it("重复渲染同一份有效文档得到相同且彼此独立的元数据", () => {
    const first = renderMarkdown(valid);
    first.metadata.title = "被调用方篡改";
    first.metadata.keywords.push("被调用方追加");
    const second = renderMarkdown(valid);

    expect(second.metadata.title).toBe("缓存回归");
    expect(second.metadata.keywords).not.toContain("被调用方追加");
  });
});
