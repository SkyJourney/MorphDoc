import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  expectContentConserved,
  readPageHealth,
  readTableFragments,
  renderPagedDocument,
  wholeRowOccurrences,
  type PagedRenderOptions
} from "./support/paged-render";

/**
 * 内容守恒与版面健康度：对全部静态夹具、多种主题与纸张逐一检查。
 *
 * 这是最通用的一道防线，不依赖任何已知缺陷的具体形态：
 *
 * - **内容守恒**：分页前后的文字必须逐字一致，图表、流程图、图片的个数也必须相等。
 *   表格行丢失、整表重放、段落被吞或被复制，都会让两边的文字对不上；媒体块被重复渲染
 *   文字看不出来，靠个数核对；
 * - **Paged.js 没有放弃布局**：不得出现 “Unable to layout item” 警告；
 * - **整行不重复**：整行保持不拆的表格正文行，在分页结果中必须恰好出现一次；
 * - **没有空白页**，**标题不孤立在页末**。
 *
 * 夹具清单直接读目录，新增的静态夹具会被自动纳入，不需要改这里。
 */

const fixtureDirectory = resolve(__dirname, "../../fixtures/markdown/static");
const manifest = JSON.parse(
  readFileSync(resolve(__dirname, "../../fixtures/markdown/manifest.json"), "utf8")
) as { static: Record<string, { error?: string }> };

/** 按设计就会被渲染器拒绝的夹具没有分页结果可言，排除。 */
const fixtures = readdirSync(fixtureDirectory)
  .filter((file) => file.endsWith(".md"))
  .filter((file) => !manifest.static[file]?.error)
  .sort();

interface ConservationConfig {
  label: string;
  options: PagedRenderOptions;
}

/** 主题的字体、内边距、页边距各不相同，纸张尺寸也不同，分页边界落点因此各异。 */
const configs: ConservationConfig[] = [
  { label: "typora-github A4 竖向", options: { themeId: "typora-github" } },
  {
    label: "formal-feasibility A3 横向",
    options: { themeId: "formal-feasibility", format: "A3", orientation: "landscape" }
  },
  { label: "tender-classic A4 竖向", options: { themeId: "tender-classic" } },
  // 小纸张：独立封面会高于页面而被约束，窄页面也最容易暴露分页边界问题
  {
    label: "tender-classic A5 横向",
    options: { themeId: "tender-classic", format: "A5", orientation: "landscape" }
  }
];

test.describe("已知限制", () => {
  test("窄页面下标题串加表头与首行比一页还高：标题串独占一页，不变量无法修复也不应放宽检查", async ({
    page
  }) => {
    // A5 横向的内容区只有 370px，15 列表格在窄列下折行严重：表头约 142px、首行约 142px，
    // 加上 137px 的标题串共约 421px，比一页还高，标题无论怎么挪都不可能与内容同页。
    // 如果将来这个限制被消除（例如表格自动缩小字号），本用例会失败，届时应改为常规断言。
    const markdown = readFileSync(resolve(fixtureDirectory, "table-chart-seam.md"), "utf8");
    await renderPagedDocument(page, markdown, {
      themeId: "tender-classic",
      format: "A5",
      orientation: "landscape"
    });

    const health = await readPageHealth(page);

    expect(health.headingOnlyPages.length, "应当存在整页只剩标题的页").toBeGreaterThan(0);
    expect(health.strandedHeadings, "可修复的孤立标题仍然必须为零").toEqual([]);
    expect(health.blankPages).toEqual([]);
  });
});

test.describe("内容守恒与版面健康度", () => {
  test("夹具清单不为空，且包含接缝夹具", () => {
    expect(fixtures.length).toBeGreaterThan(10);
    expect(fixtures).toContain("table-chart-seam.md");
  });

  for (const file of fixtures) {
    for (const config of configs) {
      test(`${file} · ${config.label}`, async ({ page }) => {
        const markdown = readFileSync(resolve(fixtureDirectory, file), "utf8");
        const { articleHtml, pageCount, layoutWarnings } = await renderPagedDocument(
          page,
          markdown,
          config.options
        );
        const label = `${file} · ${config.label}`;

        // Paged.js 放弃某段内容的布局时会报 “Unable to layout item”，随后内容被堆叠或重复；
        // 任何一份正常夹具都不应出现
        expect(layoutWarnings, `${label}：Paged.js 放弃了某段内容的布局`).toEqual([]);

        await expectContentConserved(page, articleHtml, label);

        const fragments = await readTableFragments(page);
        expect(
          [...wholeRowOccurrences(fragments)].filter(([, count]) => count !== 1),
          `${label}：出现次数不是 1 的整行`
        ).toEqual([]);

        const health = await readPageHealth(page);
        expect(health.pageCount).toBe(pageCount);
        // 空文档本来就只有一页空白，不属于缺陷
        const hasContent = articleHtml.replace(/<[^>]*>/g, "").trim().length > 0;
        if (hasContent) {
          expect(health.blankPages, `${label}：空白页`).toEqual([]);
        }
        expect(health.strandedHeadings, `${label}：孤立在页末的标题`).toEqual([]);
      });
    }
  }
});
