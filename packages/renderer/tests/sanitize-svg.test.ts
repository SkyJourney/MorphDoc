import { describe, expect, it } from "vitest";
import { renderMarkdown, sanitizeRenderedHtml } from "../src/render-markdown.js";
import { findUnsafeMarkup } from "./support/unsafe-markup.js";

/**
 * 回归：KaTeX 用内联 SVG 绘制根号、可拉伸箭头、宽重音符、上下括号和划线，安全过滤器曾把
 * svg 与 path 一并移除，$\sqrt{\pi}$ 显示成不带根号的 π，数学含义可能改变。
 * 现在只放行 KaTeX 实际产生的 svg、path、line 及其属性；其余 SVG 能力仍被拒绝。
 */
describe("KaTeX 的 SVG 被保留", () => {
  it.each([
    ["根号", "$\\sqrt{x}$"],
    ["带根次的根号", "$\\sqrt[3]{x^2+1}$"],
    ["根号内含分式", "$\\sqrt{\\frac{a}{b}}$"],
    ["可拉伸箭头", "$A \\xrightarrow{heat} B$"],
    ["宽重音符", "$\\widehat{ABC}$"],
    ["向量箭头", "$\\overrightarrow{AB}$"],
    ["上括号", "$\\overbrace{a+b}^{n}$"],
    ["下括号", "$\\underbrace{a+b}_{n}$"],
    ["划线", "$\\cancel{x}$"],
    // 普通的 \Big( 直接用字体字形绘制，不产生 SVG；只有拉伸得很高的定界符才会用 SVG
    ["拉伸的大括号", "$\\left\\{ \\begin{array}{c} a \\\\ b \\\\ c \\\\ d \\end{array} \\right.$"]
  ])("%s 保留 svg 且没有公式错误", (_name, source) => {
    const { articleHtml } = renderMarkdown(source);

    expect(articleHtml).toMatch(/<svg\b/u);
    expect(articleHtml).not.toContain("katex-error");
    expect(findUnsafeMarkup(articleHtml)).toEqual([]);
  });

  it("根号保留绘制所需的路径数据与尺寸属性", () => {
    const { articleHtml } = renderMarkdown("$\\sqrt{\\pi}$");

    expect(articleHtml).toMatch(/<path\b[^>]*\sd="M[^"]+"/u);
    // sanitize-html 会把属性名转为小写，浏览器解析内联 SVG 时再还原为 viewBox
    expect(articleHtml).toMatch(/<svg\b[^>]*\sviewbox="[^"]+"/iu);
    expect(articleHtml).toMatch(/<svg\b[^>]*\swidth="[^"]+"/u);
    expect(articleHtml).toMatch(/<svg\b[^>]*\sheight="[^"]+"/u);
  });

  it("划线保留 line 的坐标属性", () => {
    const { articleHtml } = renderMarkdown("$\\cancel{x}$");

    expect(articleHtml).toMatch(/<line\b[^>]*\sx1="[^"]+"[^>]*\sy1="[^"]+"[^>]*\sx2="[^"]+"[^>]*\sy2="[^"]+"/u);
  });

  it("math-svg 夹具涉及的各类公式没有因过滤而变成空壳", () => {
    const { articleHtml } = renderMarkdown("$\\sqrt{x}$ 与 $\\xrightarrow{a}$ 与 $\\widehat{AB}$");

    // 每个公式至少带一个 svg；修复前该数量为 0
    expect((articleHtml.match(/<svg\b/gu) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("sanitizeRenderedHtml 仍然拒绝其他 SVG 能力", () => {
  const sanitize = sanitizeRenderedHtml;

  it("移除 svg 与图形元素上的事件处理属性", () => {
    const html = sanitize(
      '<svg onload="alert(1)" onclick="alert(2)"><path d="M0 0" onmouseover="alert(3)"></path><line x1="0" y1="0" x2="1" y2="1" onfocus="alert(4)"></line></svg>'
    );

    expect(html).not.toMatch(/\son[a-z]+\s*=/iu);
    expect(html).not.toContain("alert");
    expect(html).toContain("<svg");
    expect(html).toContain("<path");
  });

  it("移除脚本，且不保留脚本正文", () => {
    const html = sanitize("<svg><script>window.__pwned = 1</script><path d=\"M0 0\"></path></svg>");

    expect(html).not.toContain("<script");
    expect(html).not.toContain("__pwned");
  });

  it.each([
    ["use 引用外部资源", '<svg><use href="https://evil.example/x.svg#a"></use></svg>', "<use"],
    ["use 的 xlink:href 脚本链接", '<svg><use xlink:href="javascript:alert(1)"></use></svg>', "<use"],
    ["foreignObject 嵌入 HTML", '<svg><foreignObject><iframe src="https://evil.example"></iframe></foreignObject></svg>', "foreignobject"],
    ["image 加载外部图片", '<svg><image href="https://evil.example/x.png"></image></svg>', "<image"],
    ["animate 改写属性", '<svg><a><animate attributeName="href" values="javascript:alert(1)"></animate></a></svg>', "<animate"],
    ["set 改写属性", '<svg><set attributeName="onload" to="alert(1)"></set></svg>', "<set"],
    ["内嵌 style 元素", "<svg><style>body{display:none}</style></svg>", "<style"]
  ])("移除 %s", (_name, input, forbidden) => {
    const html = sanitize(input).toLowerCase();

    expect(html).not.toContain(forbidden);
    expect(html).not.toContain("javascript:");
    expect(findUnsafeMarkup(sanitize(input))).toEqual([]);
  });

  it("移除 svg 上的 xmlns、href 与 xlink:href", () => {
    const html = sanitize(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" href="https://evil.example" xlink:href="javascript:alert(1)"><path d="M0 0"></path></svg>'
    );

    expect(html).not.toContain("xmlns");
    expect(html).not.toContain("href");
    expect(html).not.toContain("javascript:");
  });

  it("只保留 style 中的 width，其余声明包括 url 与 expression 都被移除", () => {
    const html = sanitize(
      '<svg style="width:0.471em;background:url(javascript:alert(1));position:fixed;top:0"><path d="M0 0"></path></svg>'
    );

    expect(html).toContain('style="width:0.471em"');
    expect(html).not.toContain("url(");
    expect(html).not.toContain("position");

    expect(sanitize('<svg style="width:expression(alert(1))"></svg>')).not.toContain("expression");
  });

  it("移除图形元素上的表现属性与引用型属性", () => {
    const html = sanitize(
      '<svg><path d="M0 0" fill="url(https://evil.example/x.svg#p)" stroke="url(#a)" style="fill:red" filter="url(#f)" clip-path="url(#c)"></path></svg>'
    );

    expect(html).toContain('d="M0 0"');
    expect(html).not.toMatch(/\s(fill|stroke|filter|clip-path|style)=/u);
    expect(html).not.toContain("url(");
  });

  it("保留 KaTeX 实际使用的属性并只保留这些属性", () => {
    const html = sanitize(
      '<svg width="400em" height="1.08em" viewBox="0 0 400000 1080" preserveAspectRatio="xMinYMin slice" data-x="1" tabindex="0"><path d="M95,702c-2.7,0"></path></svg>'
    );

    expect(html).toContain('width="400em"');
    expect(html).toContain('height="1.08em"');
    expect(html).toMatch(/viewbox="0 0 400000 1080"/iu);
    expect(html).toMatch(/preserveaspectratio="xMinYMin slice"/iu);
    expect(html).not.toContain("data-x");
    expect(html).not.toContain("tabindex");
  });

  it("Markdown 里的原始 svg 先被转义为文字，不会形成元素", () => {
    const { articleHtml } = renderMarkdown('<svg onload="alert(1)"><circle r="5"/></svg>');

    expect(articleHtml).toContain("&lt;svg");
    expect(articleHtml).not.toMatch(/<svg\b/u);
  });
});
