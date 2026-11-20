import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/render-markdown.js";

/**
 * 回归：特性检测曾对整段 HTML 做关键字匹配，正文里恰好出现的 katex、mermaid、footnote
 * 等普通单词，以及代码块里展示的标记文本，都会让文档被误判为启用了对应特性。
 * 现在只在真实标签的 class 属性中匹配。
 */
describe("特性检测只依据真实元素", () => {
  const featureWords = ["footnote", "mermaid", "katex", "md-echarts", "md-task-list-item", "footnotes"];

  it.each(featureWords)("正文中的普通单词 %s 不触发任何特性", (word) => {
    const { features } = renderMarkdown(`普通段落提到 ${word} 这个词。`);

    expect(features).toEqual([]);
  });

  it("标题、链接文字、表格单元格和强调中的关键字同样不触发", () => {
    const { features } = renderMarkdown(
      [
        "## footnote 与 katex",
        "",
        "[mermaid](https://example.com) 和 **md-echarts**",
        "",
        "| 名称 |",
        "| --- |",
        "| katex footnote |"
      ].join("\n")
    );

    expect(features).toEqual(["table"]);
  });

  it("代码块里展示的 class 属性文本不被当作真实元素", () => {
    const { features } = renderMarkdown(
      [
        "```html",
        '<span class="katex">x</span>',
        '<div class="mermaid">graph TD</div>',
        '<sup class="footnote-ref">1</sup>',
        '<figure class="md-echarts"></figure>',
        '<li class="md-task-list-item">任务</li>',
        "```",
        "",
        "```text",
        'class="katex" class="mermaid" class="footnote-ref"',
        "```"
      ].join("\n")
    );

    expect(features).toEqual(["code"]);
  });

  it("行内代码里的 class 属性文本不被当作真实元素", () => {
    const { features } = renderMarkdown('写法是 `<span class="katex">` 与 `class="mermaid"`。');

    expect(features).toEqual([]);
  });

  // 以下保证修复没有造成漏判：每种真实结构都必须仍被识别
  it.each([
    ["行内公式", "$x^2$", ["katex"]],
    ["块级公式", "$$\nx^2\n$$", ["katex"]],
    ["语法错误的公式占位", "$\\frac{1}{$", ["katex"]],
    ["Mermaid", "```mermaid\nflowchart LR\n  A-->B\n```", ["mermaid"]],
    [
      "ECharts",
      "```echarts\noption:\n  xAxis:\n    type: category\n    data: [a]\n  series:\n    - type: bar\n      data: [1]\n```",
      ["code", "echarts"]
    ],
    ["配置无效的 ECharts 占位", "```echarts\noption:\n  series:\n    - type: bar\n```", ["echarts"]],
    ["脚注", "正文[^1]\n\n[^1]: 脚注。", ["footnote"]],
    ["任务列表", "- [x] 完成\n- [ ] 待办", ["task-list"]],
    ["表格", "| a |\n| --- |\n| 1 |", ["table"]],
    ["围栏代码", "```ts\nconst a = 1;\n```", ["code"]]
  ])("仍然识别真实的%s", (_name, source, expected) => {
    expect(renderMarkdown(source).features).toEqual(expected);
  });

  it("真实结构与同名文字并存时只依据真实结构", () => {
    const { features } = renderMarkdown("katex 只是个词，但这里有公式 $x$。\n\nfootnote 也只是个词。");

    expect(features).toEqual(["katex"]);
  });
});
