import katex from "katex";
import { describe, expect, it } from "vitest";
import { sanitizeRenderedHtml } from "../src/render-markdown.js";

/**
 * 回归：安全过滤器不得改变 KaTeX 公式的显示。
 *
 * KaTeX 用内联 style 完成定位与绘制。白名单漏掉某个属性时，公式会悄悄显示错误：
 * 重音符偏离底字（缺 left）、\phantom 的隐藏内容显示出来（缺 color:transparent）、
 * 数组的 | 列分隔线消失、\rule 缩成零尺寸（缺 border-*-width 与 bottom）。
 * 以 KaTeX 原始输出为基准，对比过滤前后内联样式声明的变化。
 *
 * 另已在真实 Chromium 中对 139 个公式做过逐像素对比：除颜色类命令外，过滤前后一致。
 */

/** 把 KaTeX 输出里所有 style 属性拆成 属性名 → 出现次数。 */
function declarationCounts(html: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of html.matchAll(/\sstyle="([^"]*)"/gu)) {
    for (const part of (match[1] ?? "").split(";")) {
      const name = part.split(":")[0]?.trim().toLowerCase();
      if (name) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function render(formula: string, displayMode = false): string {
  return katex.renderToString(formula, {
    displayMode,
    output: "html",
    throwOnError: false,
    strict: "ignore",
    trust: false
  });
}

/** 被过滤器丢弃（出现次数减少）的内联样式属性。 */
function droppedProperties(formula: string, displayMode = false): string[] {
  const before = declarationCounts(render(formula, displayMode));
  const after = declarationCounts(sanitizeRenderedHtml(render(formula, displayMode)));
  return [...before]
    .filter(([name, count]) => (after.get(name) ?? 0) < count)
    .map(([name]) => name)
    .sort();
}

// 以下属性被丢弃经像素对比确认没有可见影响：position 在样式表中已有对应规则，
// border-style 与 border-width 由 .fbox 等样式表规则提供
const harmlessDrops = new Set(["position", "border-style", "border-width"]);

const structuralFormulas = [
  // 重音符
  "\\vec{v}", "\\hat{x}", "\\bar{x}", "\\dot{x}", "\\ddot{x}", "\\dddot{x}", "\\tilde{x}",
  "\\check{x}", "\\acute{x}", "\\grave{x}", "\\breve{x}", "\\mathring{x}",
  "\\widehat{ABC}", "\\widetilde{ABC}", "\\overrightarrow{AB}", "\\overleftarrow{AB}", "\\utilde{AB}",
  // 根号、箭头、括号、划线
  "\\sqrt{x}", "\\sqrt[3]{x}", "\\sqrt{\\frac{a}{b}}", "\\xrightarrow{heat}", "\\xleftarrow[down]{up}",
  "\\overbrace{a+b}^{n}", "\\underbrace{a+b}_{n}", "\\cancel{x}", "\\bcancel{x}", "\\xcancel{x}",
  // 分式与大算符
  "\\frac{a}{b}", "\\dfrac{a}{b}", "\\binom{n}{k}", "\\cfrac{1}{1+\\cfrac{1}{x}}",
  "\\sum_{i=1}^{n} i", "\\prod_{i=1}^{n} i", "\\int_{0}^{1} x\\,dx", "\\oint f", "\\iint f",
  "\\bigcup_{i} A_i", "\\bigoplus_{i} A_i", "\\lim_{x\\to 0} f(x)", "\\sum\\limits_{i=1}^{n} i",
  // 数组与矩阵：\hline、| 与 || 列分隔线、虚线、行距
  "\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}",
  "\\begin{array}{c|c} a & b \\\\ \\hline c & d \\end{array}",
  "\\begin{array}{|c|c|} \\hline a & b \\\\ \\hline c & d \\\\ \\hline \\end{array}",
  "\\begin{array}{c||c} a & b \\\\ \\hline\\hline c & d \\end{array}",
  "\\begin{array}{c:c} a & b \\\\ \\hdashline c & d \\end{array}",
  "\\begin{matrix} a & b \\\\[1em] c & d \\end{matrix}",
  "\\begin{cases} a & x>0 \\\\ b & x\\le 0 \\end{cases}",
  "\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}",
  // 规则线、省略号、隐形占位
  "\\rule{1em}{1em}", "\\rule[0.2em]{2em}{0.1em}", "\\rule{0.5pt}{2em}", "\\vdots", "\\ddots", "\\cdots",
  "\\phantom{x} y", "\\hphantom{abc} y", "\\vphantom{\\frac{a}{b}} y", "x\\phantom{\\sqrt{2}}y",
  // 框与偏移
  "\\boxed{x}", "\\fbox{x}", "\\underline{ab}", "\\overline{ab}", "\\raisebox{0.5em}{x}",
  "\\left\\{ \\begin{array}{c} a \\\\ b \\\\ c \\\\ d \\end{array} \\right.",
  "x^{2}_{i}", "{}^{14}_{6}C", "\\mathbb{R}^{n}", "\\text{abc}", "\\not=", "\\stackrel{!}{=}"
];

describe("安全过滤器不改变 KaTeX 的结构性内联样式", () => {
  it.each(structuralFormulas)("%s 的内联样式只丢弃已确认无可见影响的属性", (formula) => {
    for (const displayMode of [false, true]) {
      const unexpected = droppedProperties(formula, displayMode).filter(
        (name) => !harmlessDrops.has(name)
      );

      expect(unexpected, `${displayMode ? "块级" : "行内"}公式被丢弃的样式属性`).toEqual([]);
    }
  });

  it("语料确实覆盖了需要保留的各类结构性样式，避免断言因语料为空而形同虚设", () => {
    const seen = new Set<string>();
    for (const formula of structuralFormulas) {
      for (const name of declarationCounts(render(formula)).keys()) {
        seen.add(name);
      }
    }

    for (const required of [
      "left",
      "top",
      "height",
      "border-right-width",
      "border-right-style",
      "border-top-width",
      "bottom",
      "margin",
      "color"
    ]) {
      expect(seen.has(required), `语料应当产生 ${required}`).toBe(true);
    }
  });

  it("字形重音符保留 left 偏移", () => {
    // 宽重音符（\widehat 等）是整段拉伸的 SVG，不靠 left 定位，因此不在此列
    for (const formula of ["\\vec{v}", "\\hat{x}", "\\bar{x}", "\\dot{x}", "\\tilde{x}"]) {
      const original = declarationCounts(render(formula)).get("left") ?? 0;
      const kept = declarationCounts(sanitizeRenderedHtml(render(formula))).get("left") ?? 0;

      expect(original, `${formula} 原本应带 left`).toBeGreaterThan(0);
      expect(kept, `${formula} 过滤后应保留 left`).toBe(original);
    }
  });

  it("\\phantom 系列保留 color:transparent，隐藏的内容不会显示出来", () => {
    for (const formula of ["\\phantom{x} y", "\\hphantom{abc} y", "\\vphantom{x} y"]) {
      expect(sanitizeRenderedHtml(render(formula)), formula).toContain("color:transparent");
    }
  });

  it("数组保留列分隔线与 \\hline 所需的边框和间距", () => {
    const html = sanitizeRenderedHtml(
      render("\\begin{array}{c|c} a & b \\\\ \\hline c & d \\end{array}")
    );

    expect(html).toMatch(/border-right-width:[\d.]+em/u);
    expect(html).toContain("border-right-style:solid");
    expect(html).toMatch(/margin:0 -[\d.]+em/u);
    expect(html).toMatch(/border-bottom-width:[\d.]+em/u);
  });

  it("数组的虚线分隔线保留 dashed", () => {
    const html = sanitizeRenderedHtml(render("\\begin{array}{c:c} a & b \\end{array}"));

    expect(html).toContain("border-right-style:dashed");
  });

  it("\\rule 保留尺寸与偏移，不会缩成零尺寸", () => {
    const html = sanitizeRenderedHtml(render("\\rule[0.2em]{2em}{0.1em}"));

    expect(html).toContain("border-right-width:2em");
    expect(html).toContain("border-top-width:0.1em");
    expect(html).toContain("bottom:0.2em");
  });
});

describe("结构性样式的取值被严格限制", () => {
  const spanWith = (style: string): string => sanitizeRenderedHtml(`<span style="${style}">x</span>`);

  it("color 只放行 transparent，用户颜色与危险取值都被移除", () => {
    expect(spanWith("color:transparent")).toContain("color:transparent");
    for (const value of ["red", "#ff0000", "rgb(255,0,0)", "url(javascript:alert(1))", "expression(alert(1))"]) {
      expect(spanWith(`color:${value}`), `color:${value}`).not.toContain("color");
    }
  });

  it("border-right-style 只放行 solid 与 dashed", () => {
    expect(spanWith("border-right-style:solid")).toContain("solid");
    expect(spanWith("border-right-style:dashed")).toContain("dashed");
    for (const value of ["dotted", "double", "url(x)"]) {
      expect(spanWith(`border-right-style:${value}`), value).not.toContain("border-right-style");
    }
    // ";" 会把它拆成两条声明：合法的保留，不在白名单内的 background 被丢弃
    expect(spanWith("border-right-style:solid;background:red")).toBe(
      '<span style="border-right-style:solid">x</span>'
    );
  });

  it("margin 只接受 1 到 4 个数值，且单位仅限 em", () => {
    expect(spanWith("margin:0 -0.02em")).toContain("margin:0 -0.02em");
    expect(spanWith("margin:0.5em")).toContain("margin:0.5em");
    for (const value of ["0 -0.02em 0 0 0", "1px", "auto", "calc(1em+1px)", "0 url(x)", "-9999px"]) {
      expect(spanWith(`margin:${value}`), value).not.toContain("margin");
    }
  });

  it("border 宽度、bottom 与 left 只接受长度，不接受表达式或 url", () => {
    for (const property of ["border-right-width", "border-top-width", "bottom", "left"]) {
      expect(spanWith(`${property}:0.2em`), property).toContain(`${property}:0.2em`);
      for (const value of ["calc(1em+1px)", "expression(alert(1))", "url(x)", "thin", "inherit"]) {
        expect(spanWith(`${property}:${value}`), `${property}:${value}`).not.toContain(property);
      }
    }
  });

  it("始终不放行 position:fixed、absolute 等可能脱离文档流的取值，也不放行背景与外链类属性", () => {
    for (const style of [
      "position:fixed",
      "position:absolute",
      "background:url(https://evil.example/x.png)",
      "background-color:red",
      "background-image:url(x)",
      "z-index:9999",
      "pointer-events:none",
      "transform:scale(100)"
    ]) {
      expect(spanWith(style), style).toBe("<span>x</span>");
    }
  });
});

describe("用户颜色命令的当前行为（设计决定待定）", () => {
  // \color、\colorbox 等命令的颜色目前被移除，预览与 PDF 中公式始终使用主题颜色，
  // 也与走 Pandoc 的 DOCX 公式保持一致。是否支持用户颜色是产品决定：若改为支持，
  // 需要为颜色值设计严格规则（只接受十六进制与命名颜色），并同步评估 DOCX 的差异。
  it.each([
    ["\\color{red} x", "color:red"],
    ["\\textcolor{blue}{x}", "color:blue"],
    ["\\colorbox{yellow}{x}", "background-color:yellow"],
    ["{\\color{#ff0000} x}", "color:#ff0000"]
  ])("%s 的颜色被移除", (formula, declaration) => {
    expect(render(formula)).toContain(declaration);
    expect(sanitizeRenderedHtml(render(formula))).not.toContain(declaration);
  });
});
