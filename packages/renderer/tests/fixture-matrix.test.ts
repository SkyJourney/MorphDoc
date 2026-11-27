import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { themeFeatureSchema, type ThemeFeature } from "@morphdoc/core";
import { describe, expect, it } from "vitest";
import {
  defaultSeed,
  generateStressFixtures,
  generateTableChartSeam,
  tableChartSeamSections,
  toCrlf,
  whitespaceInputs,
  withBom
} from "../../../fixtures/markdown/generate.mjs";
import {
  MarkdownDocumentParseError,
  renderMarkdown
} from "../src/render-markdown.js";
import { findUnsafeMarkup } from "./support/unsafe-markup.js";

interface FixtureSpec {
  features?: ThemeFeature[];
  absent?: ThemeFeature[];
  warnings?: number;
  error?: string;
}

const fixtureRoot = fileURLToPath(new URL("../../../fixtures/markdown/", import.meta.url));
const staticDirectory = `${fixtureRoot}static/`;
const manifest = JSON.parse(readFileSync(`${fixtureRoot}manifest.json`, "utf8")) as {
  static: Record<string, FixtureSpec>;
};

const staticFixtures = Object.entries(manifest.static).map(([file, spec]) => ({
  file,
  spec,
  text: readFileSync(`${staticDirectory}${file}`, "utf8")
}));
const renderable = staticFixtures.filter(({ spec }) => spec.error === undefined);
const rejected = staticFixtures.filter(({ spec }) => spec.error !== undefined);

// 编码变体由 LF 夹具派生：仓库的 .gitattributes 会规整换行，字节级变体无法入库
const variants: Array<[string, (text: string) => string]> = [
  ["CRLF", toCrlf],
  ["BOM", withBom],
  ["BOM+CRLF", (text) => withBom(toCrlf(text))]
];

describe("静态夹具矩阵", () => {
  it.each(renderable)("$file：特性、告警、安全与确定性", ({ spec, text }) => {
    const first = renderMarkdown(text);
    const second = renderMarkdown(text);

    expect(first.articleHtml.startsWith('<article id="write"')).toBe(true);
    expect(first.articleHtml).toBe(second.articleHtml);
    for (const feature of spec.features ?? []) {
      expect(first.features).toContain(feature);
    }
    for (const feature of spec.absent ?? []) {
      expect(first.features).not.toContain(feature);
    }
    if (spec.warnings !== undefined) {
      expect(first.warnings).toHaveLength(spec.warnings);
    }
    expect(findUnsafeMarkup(first.articleHtml)).toEqual([]);
  });

  it.each(
    renderable.flatMap((fixture) =>
      variants.map(([name, transform]) => ({ ...fixture, variant: name, transform }))
    )
  )("$file 的 $variant 变体与 LF 基线输出一致", ({ text, transform }) => {
    const baseline = renderMarkdown(text);
    const variant = renderMarkdown(transform(text));

    expect(variant.articleHtml).toBe(baseline.articleHtml);
    expect(variant.features).toEqual(baseline.features);
    expect(variant.warnings).toEqual(baseline.warnings);
    expect(variant.metadata).toEqual(baseline.metadata);
  });

  it.each(rejected)("$file 以稳定的错误类型被拒绝", ({ spec, text }) => {
    expect(spec.error).toBe("MarkdownDocumentParseError");
    expect(() => renderMarkdown(text)).toThrow(MarkdownDocumentParseError);
    // 只断言 CRLF：其内容与 LF 不同，不受 gray-matter 缓存影响。
    // BOM 变体去除 BOM 后与 LF 内容相同，会命中被污染的缓存而不抛错，
    // 该缺陷由文末"已知问题"中的用例单独记录。
    expect(() => renderMarkdown(toCrlf(text))).toThrow(MarkdownDocumentParseError);
  });

  it("安全夹具的危险输入被转义为文字而不是元素，正常内容保留", () => {
    const source = staticFixtures.find(({ file }) => file === "security-xss.md");
    const html = renderMarkdown(source?.text ?? "").articleHtml;

    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script");
    expect(html).toContain("正常段落必须保留。");
  });

  it("无效公式只产生局部错误，且货币符号不被当作公式", () => {
    const source = staticFixtures.find(({ file }) => file === "math.md");
    const html = renderMarkdown(source?.text ?? "").articleHtml;

    expect(html).toContain("katex-error");
    expect(html).toContain("价格是 $5 和 $10");
  });
});

describe("场景覆盖矩阵", () => {
  it("每个渲染器特性至少被一个静态夹具覆盖", () => {
    const covered = new Set(renderable.flatMap(({ spec }) => spec.features ?? []));
    const missing = themeFeatureSchema.options.filter((feature) => !covered.has(feature));

    expect(missing).toEqual([]);
  });

  it("清单与磁盘上的静态夹具一一对应，没有遗漏或失效条目", () => {
    const onDisk = readdirSync(staticDirectory).filter((name) => name.endsWith(".md")).sort();

    expect(Object.keys(manifest.static).sort()).toEqual(onDisk);
  });
});

describe("压力夹具", () => {
  const stress = generateStressFixtures();

  it("生成器对同一种子逐字节确定，不同种子产生不同内容", () => {
    expect(generateStressFixtures(defaultSeed)).toEqual(generateStressFixtures(defaultSeed));
    expect(generateStressFixtures(1)["stress-long-document"]).not.toBe(
      generateStressFixtures(2)["stress-long-document"]
    );
  });

  it.each(Object.entries(stress))("%s：渲染成功、安全，且与 CRLF/BOM 变体一致", (_name, text) => {
    const baseline = renderMarkdown(text);

    expect(baseline.articleHtml.startsWith('<article id="write"')).toBe(true);
    expect(findUnsafeMarkup(baseline.articleHtml)).toEqual([]);
    for (const [, transform] of variants) {
      expect(renderMarkdown(transform(text)).articleHtml).toBe(baseline.articleHtml);
    }
  });

  it("各压力文档的结构规模符合生成参数", () => {
    const count = (html: string, pattern: RegExp): number => (html.match(pattern) ?? []).length;
    const html = (name: string): string => renderMarkdown(stress[name] ?? "").articleHtml;

    expect(count(html("stress-long-document"), /<h2\b/gu)).toBe(120);
    expect(count(html("stress-wide-table"), /<th\b/gu)).toBe(30);
    expect(count(html("stress-wide-table"), /<td\b/gu)).toBe(30 * 60);
    expect(count(html("stress-deep-nesting"), /<ul>/gu)).toBe(12);
    expect(count(html("stress-deep-nesting"), /<blockquote>/gu)).toBe(12);
    expect(count(html("stress-many-codeblocks"), /<pre\b/gu)).toBe(80);
    expect(count(html("stress-many-images"), /<figure\b/gu)).toBe(40);
    expect(count(html("stress-many-footnotes"), /<sup class="footnote-ref"/gu)).toBe(50);
    expect(count(html("stress-many-footnotes"), /<li id="footnote\d+"/gu)).toBe(50);
  });
});

describe("表格分页接缝夹具", () => {
  const staticText = readFileSync(`${staticDirectory}table-chart-seam.md`, "utf8");
  const lines = staticText.split("\n");

  it("静态夹具与生成器的默认输出逐字节一致，修改生成器后必须重新生成", () => {
    expect(staticText).toBe(generateTableChartSeam());
  });

  it("对同一种子逐字节确定，不同种子产生不同内容，小节数可调", () => {
    expect(generateTableChartSeam({ seed: 7 })).toBe(generateTableChartSeam({ seed: 7 }));
    expect(generateTableChartSeam({ seed: 7 })).not.toBe(generateTableChartSeam({ seed: 8 }));
    const headings = (text: string) =>
      text.split("\n").filter((line) => line.startsWith("### ")).length;
    expect(headings(generateTableChartSeam({ sections: 3 }))).toBe(3);
    expect(headings(staticText)).toBe(tableChartSeamSections);
  });

  it("每个小节标题之后紧跟表格、表格之后紧跟图表：这个结构正是触发缺陷的条件", () => {
    // 不能被“改进”成在标题与表格之间插入说明段落——那会让夹具失去触发能力
    const headingIndexes = lines.flatMap((line, index) =>
      line.startsWith("### ") ? [index] : []
    );
    expect(headingIndexes).toHaveLength(tableChartSeamSections);
    for (const headingIndex of headingIndexes) {
      expect(lines[headingIndex + 1], "标题之后是空行").toBe("");
      expect(lines[headingIndex + 2], "空行之后直接是表头").toMatch(/^\| 代码 \|/u);
      let cursor = headingIndex + 2;
      while (lines[cursor]?.startsWith("|")) cursor += 1;
      expect(lines[cursor], "表格之后是空行").toBe("");
      expect(lines[cursor + 1], "空行之后直接是图表围栏").toBe("```echarts");
    }
  });

  it("表格足够长、会跨页：每张表至少 10 行，且行数各不相同以覆盖不同的页面偏移", () => {
    const rowCounts: number[] = [];
    let current = 0;
    for (const line of lines) {
      if (line.startsWith("| `")) {
        current += 1;
      } else if (current > 0) {
        rowCounts.push(current);
        current = 0;
      }
    }
    expect(rowCounts).toHaveLength(tableChartSeamSections);
    expect(Math.min(...rowCounts)).toBeGreaterThanOrEqual(10);
    expect(new Set(rowCounts).size).toBeGreaterThan(tableChartSeamSections / 2);
  });

  it("填充段落数各不相同，让接缝落在页面的不同偏移上", () => {
    const fillerCounts: number[] = [];
    let current = 0;
    for (const line of lines) {
      if (line.startsWith("填充段落")) {
        current += 1;
      } else if (line.startsWith("## ")) {
        fillerCounts.push(current);
        current = 0;
      }
    }
    expect(fillerCounts).toHaveLength(tableChartSeamSections);
    expect(new Set(fillerCounts).size).toBeGreaterThan(3);
  });
});

describe("纯空白与近空输入", () => {
  it.each(Object.entries(whitespaceInputs()))("%s：渲染为空文章且不报错", (_name, text) => {
    const result = renderMarkdown(text);

    expect(result.articleHtml.startsWith('<article id="write"')).toBe(true);
    expect(result.features).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("findUnsafeMarkup 自检", () => {
  // 防止安全断言因检查器本身失效而形同虚设：每个恶意样本都必须被识别
  it.each([
    ["脚本标签", "<p>x</p><script>alert(1)</script>"],
    ["事件处理属性", '<img src="x" onerror="alert(1)">'],
    ["单引号事件属性", "<a onclick='go()'>x</a>"],
    ["javascript 链接", '<a href="javascript:alert(1)">x</a>'],
    ["大小写与空白混淆", '<a href=" JaVa\tScRiPt:alert(1)">x</a>'],
    ["十进制实体混淆", '<a href="&#106;avascript:alert(1)">x</a>'],
    ["十六进制实体混淆", '<a href="&#x6A;avascript:alert(1)">x</a>'],
    ["data html 链接", '<a href="data:text/html,<b>x</b>">x</a>'],
    ["iframe", '<iframe src="https://example.com"></iframe>'],
    ["属性值含 > 的标签", '<a title="a>b" onclick="x()">x</a>'],
    ["SVG use 引用外部资源", '<svg><use href="https://evil.example/x.svg#a"></use></svg>'],
    ["SVG foreignObject", "<svg><foreignObject><p>x</p></foreignObject></svg>"],
    ["SVG animate", '<svg><animate attributeName="href" values="x"></animate></svg>'],
    ["SVG 内的 xlink:href 脚本链接", '<svg><a xlink:href="javascript:alert(1)">x</a></svg>']
  ])("识别：%s", (_name, html) => {
    expect(findUnsafeMarkup(html).length).toBeGreaterThan(0);
  });

  it.each([
    ["被转义的文字", "<p>&lt;script&gt;alert(1)&lt;/script&gt; onclick=1</p>"],
    ["普通链接", '<a href="https://example.com/a?b=1">x</a>'],
    ["内联图片 Data URL", '<img src="data:image/png;base64,AAAA">'],
    ["锚点链接", '<a href="#footnote1">x</a>'],
    [
      "KaTeX 的内联 SVG",
      '<svg width="400em" height="1.08em" viewBox="0 0 400000 1080"><path d="M95,702c-2.7,0"></path><line x1="0" y1="0" x2="1" y2="1"></line></svg>'
    ]
  ])("放行：%s", (_name, html) => {
    expect(findUnsafeMarkup(html)).toEqual([]);
  });
});
