import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  countInRendered,
  expectContentConserved,
  readPageBlocks,
  readPageHealth,
  renderPagedDocument,
  type PagedRenderOptions
} from "./support/paged-render";

/**
 * 整页缩放的媒体块、连续标题、被约束的封面。
 *
 * 缩放到整页高度的图片、图表、流程图，以及被约束为单页的封面，其后都要换页。代码里的
 * 内联 `break-after` 不会被 Paged.js 识别（死代码），分页结果正确是因为被缩放的块恰好撑满
 * 一页、后面的内容自然溢出。评估过改用 `forceBreakAfter`：封面锚点会因此多出空白页，
 * 不能迁移；图片与图表在单个标题时输出一致，但连续标题时会重复渲染——后者的根因是整页缩放
 * 只扣除紧邻的一个标题，已由 `getPrecedingHeadingChain` 修复。
 *
 * 连续标题（`##` 紧跟 `###` 再接整页图表）此前会让 Paged.js 报 “Unable to layout item”
 * 并重复渲染图表；在 main 上则是章标题被孤立在上一页。两种结果都是错的，本文件固化
 * “整串标题跟着媒体走，媒体只渲染一次”。
 */

const fixtureDirectory = resolve(__dirname, "../../fixtures/markdown/static");
const read = (file: string) => readFileSync(resolve(fixtureDirectory, file), "utf8");

const mediaConfigs: Array<{ label: string; options: PagedRenderOptions }> = [
  { label: "typora-github A4 竖向", options: { themeId: "typora-github" } },
  {
    label: "formal-feasibility A3 横向",
    options: { themeId: "formal-feasibility", format: "A3", orientation: "landscape" }
  },
  {
    label: "tender-classic A5 横向",
    options: { themeId: "tender-classic", format: "A5", orientation: "landscape" }
  }
];

/** 夹具里整页缩放的媒体块：1 张图片、2 张图表、1 张流程图。 */
const EXPECTED_FITTED_BLOCKS = 4;

test.describe("整页缩放的媒体块", () => {
  for (const config of mediaConfigs) {
    test(`${config.label}：其后同页没有任何内容，没有空白页，内容守恒`, async ({ page }) => {
      const { articleHtml, layoutWarnings } = await renderPagedDocument(
        page,
        read("tall-media.md"),
        config.options
      );
      expect(layoutWarnings, "Paged.js 放弃了某段内容的布局").toEqual([]);
      const pages = await readPageBlocks(page);

      const fitted = pages.flatMap((blocks, pageIndex) =>
        blocks.flatMap((block, blockIndex) =>
          block.fitted ? [{ pageIndex, blockIndex, block }] : []
        )
      );
      expect(
        fitted.length,
        "夹具应当有 4 个被缩放到整页的媒体块，否则这组断言没有覆盖到任何东西"
      ).toBe(EXPECTED_FITTED_BLOCKS);
      for (const { pageIndex, blockIndex, block } of fitted) {
        const followers = pages[pageIndex]!.slice(blockIndex + 1);
        expect(
          followers.map((follower) => `${follower.tag}:${follower.text}`),
          `${block.tag}（第 ${pageIndex + 1} 页，底边 ${block.bottomRatio.toFixed(3)}）之后同页还有内容`
        ).toEqual([]);
        expect(block.bottomRatio, "被缩放的块应当撑满页面").toBeGreaterThan(0.9);
      }

      const health = await readPageHealth(page);
      expect(health.blankPages, "空白页").toEqual([]);
      expect(health.strandedHeadings, "孤立在页末的标题").toEqual([]);
      await expectContentConserved(page, articleHtml, config.label);
    });
  }
});

test.describe("连续标题紧接整页媒体", () => {
  for (const config of mediaConfigs) {
    test(`${config.label}：整串标题与媒体同页，媒体只渲染一次，Paged.js 没有放弃布局`, async ({
      page
    }) => {
      const { articleHtml, layoutWarnings } = await renderPagedDocument(
        page,
        read("heading-chain-media.md"),
        config.options
      );
      // 此前：Paged.js 报 “Unable to layout item”，随后把图表重复渲染
      expect(layoutWarnings, "Paged.js 放弃了某段内容的布局").toEqual([]);

      const pages = await readPageBlocks(page);
      const fitted = pages.flatMap((blocks, pageIndex) =>
        blocks.flatMap((block, blockIndex) =>
          block.fitted ? [{ pageIndex, blockIndex }] : []
        )
      );
      expect(
        fitted.length,
        "夹具有 1 张图表和 1 张流程图，各自都应被缩放到整页，且只出现一次"
      ).toBe(2);
      for (const { pageIndex, blockIndex } of fitted) {
        const before = pages[pageIndex]!.slice(0, blockIndex).map((block) => block.tag);
        // 媒体之前是 h2 + h3 两个连续标题，并且它们就在同一页上、位于页首：
        // 既没有被孤立在上一页（main 上的结果），也没有被拆开
        expect(before, `第 ${pageIndex + 1} 页上媒体之前的块`).toEqual(["h2", "h3"]);
        expect(
          pages[pageIndex]!.slice(blockIndex + 1).map((block) => block.tag),
          "整页媒体之后同页没有内容"
        ).toEqual([]);
      }

      const health = await readPageHealth(page);
      expect(health.blankPages, "空白页").toEqual([]);
      expect(health.strandedHeadings, "孤立在页末的标题").toEqual([]);
      // 守恒检查包含媒体块个数：图表、流程图被重复渲染时这里会失败
      await expectContentConserved(page, articleHtml, config.label);
    });
  }
});

test.describe("被约束的独立封面", () => {
  test("A5 横向：封面被约束为单页，之后不产生空白页，正文从下一页开始", async ({ page }) => {
    const { articleHtml } = await renderPagedDocument(page, read("cover-tender.md"), {
      themeId: "tender-classic",
      format: "A5",
      orientation: "landscape"
    });
    const pages = await readPageBlocks(page);

    const covers = pages.flatMap((blocks, pageIndex) =>
      blocks.flatMap((block, blockIndex) =>
        block.coverFit ? [{ pageIndex, blockIndex }] : []
      )
    );
    expect(
      covers,
      "A5 横向的投标封面应当高于页面而被约束；否则这条用例没有覆盖到约束封面的路径"
    ).toHaveLength(1);
    const { pageIndex, blockIndex } = covers[0]!;
    expect(pageIndex, "封面在第一页").toBe(0);
    expect(
      pages[pageIndex]!.slice(blockIndex + 1).map((block) => block.tag),
      "封面之后同页没有内容"
    ).toEqual([]);
    expect(pages[pageIndex + 1]?.[0]?.tag, "下一页以正文标题开头").toBe("h1");

    // 零高度的分页锚点仍然存在，但没有被强制换页：否则它被挤到下一页后会得到一张空白页
    expect(await countInRendered(page, "[data-semantic-cover-page-break-anchor]")).toBe(1);
    expect(await countInRendered(page, "[data-semantic-cover-page-break-anchor][data-morphdoc-break-after]")).toBe(0);

    const health = await readPageHealth(page);
    expect(health.blankPages, "约束封面不得引入空白页").toEqual([]);
    await expectContentConserved(page, articleHtml, "A5 封面");
  });

  test("A4 竖向：封面放得下，不被约束，之后同样没有空白页", async ({ page }) => {
    await renderPagedDocument(page, read("cover-tender.md"), { themeId: "tender-classic" });
    const pages = await readPageBlocks(page);

    expect(pages.flat().filter((block) => block.coverFit)).toHaveLength(0);
    expect((await readPageHealth(page)).blankPages).toEqual([]);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages[1]?.[0]?.tag, "第二页以正文标题开头").toBe("h1");
  });
});
