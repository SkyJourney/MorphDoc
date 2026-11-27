import { expect, test } from "@playwright/test";
import {
  expectContentConserved,
  readTableFragments,
  renderPagedDocument,
  wholeRowOccurrences,
  type PagedFormat,
  type PagedOrientation,
  type TableFragmentReport
} from "./support/paged-render";

/**
 * 表格适配页宽（packages/preview-engine/src/paged-table-fit.ts）的端到端测试。
 *
 * 缺陷背景：列很多的表格自动布局下比页面更宽，冻结列宽时把水平溢出带进了
 * Paged.js，它在单元格文字中间把一整行切成两段，页数也成倍增加。
 *
 * 断言的是不变量，不是固定页数或坐标：字体与系统不同，列数的临界点会移动，
 * 但“不溢出、行不丢不重、内容守恒、状态随表格变宽单调递进”在任何环境都应成立。
 */

/**
 * 溢出容差：表格使用折叠边框，最外层边框有一半在盒子之外，实测表格比页面内容区
 * 宽 0.7px 左右，列宽之和并没有超出。容差取不到两条边框的宽度。
 */
const BORDER_TOLERANCE_PX = 1.5;

const FIT_RANK: Record<string, number> = { none: 0, compact: 1, scaled: 2 };
const rankOf = (fit: string | null) => FIT_RANK[fit ?? "none"]!;

/** 生成确定的数字单元格内容，列数、行数可调。 */
function wideTableMarkdown(columns: number, rows: number) {
  const headers = Array.from({ length: columns }, (_, index) => `指标${index + 1}`);
  const lines = [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => " ---: |").join("")}`
  ];
  for (let row = 1; row <= rows; row += 1) {
    const cells = headers.map((_, column) =>
      (((row * 37 + column * 11) % 900) / 10 + 100).toFixed(2)
    );
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

function documentWith(table: string) {
  return `# 宽表\n\n前置段落。\n\n${table}\n\n后置段落。\n`;
}

/** 表格片段的整体适配状态：取各片段中最高的一级，片段之间应当一致。 */
function fitOf(fragments: readonly TableFragmentReport[]) {
  const modes = new Set(fragments.map((fragment) => fragment.fit ?? "none"));
  expect(modes.size, `同一张表的各页片段适配状态应当一致，实际：${[...modes]}`).toBe(1);
  return fragments[0]!.fit;
}

const THEMES = ["typora-github", "formal-feasibility"] as const;
const SWEEP_COLUMNS = [4, 8, 12, 16, 20, 24, 30, 36, 45, 60];

test.describe("表格适配页宽：列数扫描", () => {
  for (const themeId of THEMES) {
    test(`${themeId}：从窄到宽的每个列数都不溢出、不丢行、不重行，内容守恒`, async ({ page }) => {
      const rows = 40;
      const modes: Array<string | null> = [];
      for (const columns of SWEEP_COLUMNS) {
        const { articleHtml } = await renderPagedDocument(
          page,
          documentWith(wideTableMarkdown(columns, rows)),
          { themeId }
        );
        const fragments = await readTableFragments(page);
        const label = `${themeId} ${columns} 列`;

        expect(fragments.length, `${label}：应当有表格`).toBeGreaterThan(0);
        for (const fragment of fragments) {
          expect(
            fragment.overflow,
            `${label}：第 ${fragment.page} 页的表格右边缘超出页面内容区 ${fragment.overflow}px`
          ).toBeLessThanOrEqual(BORDER_TOLERANCE_PX);
        }

        // 行完整：40 行各出现一次（整行保持不拆的行不得重复，也不得丢失）
        const occurrences = wholeRowOccurrences(fragments);
        const allIds = new Set(
          fragments.flatMap((fragment) => fragment.rows.map((row) => row.id))
        );
        expect(allIds.size, `${label}：正文行总数`).toBe(rows);
        expect(
          [...occurrences].filter(([, count]) => count !== 1),
          `${label}：出现次数不是 1 的整行`
        ).toEqual([]);

        // 适配状态与内边距一致：有适配则内边距被压缩，没有则保持主题原值
        const fit = fitOf(fragments);
        for (const fragment of fragments) {
          if (fit) {
            expect(fragment.paddingLeft, `${label}：压缩后的左内边距`).toBeCloseTo(2, 1);
          } else {
            expect(fragment.paddingLeft, `${label}：未适配时保持主题内边距`).toBeGreaterThan(2);
          }
        }
        modes.push(fit);
        await expectContentConserved(page, articleHtml, label);
      }

      // 随着列数增加，适配状态只能递进：不处理 → compact → scaled
      const ranks = modes.map(rankOf);
      expect(ranks, `适配状态应随列数单调递进：${modes}`).toEqual(
        [...ranks].sort((a, b) => a - b)
      );
      // 两端必须被覆盖：最窄的表不被改动，最宽的表被缩列；中间必须出现 compact，
      // 否则说明压缩内边距这一级已经没有被任何场景用到
      expect(modes[0], "4 列的表格不应被改动").toBeNull();
      expect(modes.at(-1), "60 列的表格必须缩列").toBe("scaled");
      expect(new Set(modes.map((mode) => mode ?? "none"))).toEqual(
        new Set(["none", "compact", "scaled"])
      );
    });
  }
});

test.describe("表格适配页宽：页面与容器", () => {
  test("同一张表：页面够宽时不处理，页面窄时才适配", async ({ page }) => {
    const markdown = documentWith(wideTableMarkdown(21, 30));
    const cases: Array<[PagedFormat, PagedOrientation]> = [
      ["A3", "landscape"],
      ["A4", "portrait"]
    ];
    const fits: Array<string | null> = [];
    for (const [format, orientation] of cases) {
      await renderPagedDocument(page, markdown, { format, orientation });
      const fragments = await readTableFragments(page);
      fits.push(fitOf(fragments));
      for (const fragment of fragments) {
        expect(fragment.overflow, `${format} ${orientation}`).toBeLessThanOrEqual(
          BORDER_TOLERANCE_PX
        );
      }
    }

    expect(fits[0], "A3 横向足够宽，21 列不应被改动").toBeNull();
    expect(fits[1], "A4 竖向放不下 21 列，必须适配").not.toBeNull();
  });

  test("嵌套在引用块里的表格按容器宽度适配，而不是页面宽度", async ({ page }) => {
    const table = wideTableMarkdown(16, 12);
    const quoted = table
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");

    await renderPagedDocument(page, `# 引用\n\n${quoted}\n`);
    const fragments = await readTableFragments(page);

    expect(fragments.length).toBeGreaterThan(0);
    for (const fragment of fragments) {
      expect(
        fragment.overflowInParent,
        `引用块内的表格超出了引用块内容区 ${fragment.overflowInParent}px`
      ).toBeLessThanOrEqual(BORDER_TOLERANCE_PX);
    }
  });
});

test.describe("表格适配页宽：跨页与超高行", () => {
  test("适配后的宽表跨页：每页重复同一表头，行完整，内容守恒", async ({ page }) => {
    const rows = 150;
    const { articleHtml, pageCount } = await renderPagedDocument(
      page,
      documentWith(wideTableMarkdown(24, rows))
    );
    const fragments = await readTableFragments(page);

    expect(pageCount, "夹具应当跨多页").toBeGreaterThan(3);
    expect(fragments.length, "表格应当出现在多个页面").toBeGreaterThan(3);
    // 24 列放不进 A4 竖向：必须被适配，且每一页的片段都不溢出页面
    expect(fitOf(fragments), "24 列的表格应当被适配").not.toBeNull();
    for (const fragment of fragments) {
      expect(
        fragment.overflow,
        `第 ${fragment.page} 页的表格片段超出页面内容区 ${fragment.overflow}px`
      ).toBeLessThanOrEqual(BORDER_TOLERANCE_PX);
    }
    const expectedHead = fragments[0]!.headText;
    expect(expectedHead).toContain("指标1");
    for (const fragment of fragments) {
      expect(fragment.headText, `第 ${fragment.page} 页的表头`).toBe(expectedHead);
    }
    expect(
      new Set(fragments.flatMap((fragment) => fragment.rows.map((row) => row.id))).size
    ).toBe(rows);
    expect(
      [...wholeRowOccurrences(fragments)].filter(([, count]) => count !== 1)
    ).toEqual([]);
    await expectContentConserved(page, articleHtml);
  });

  test("单元格里有超过一页高的文字：该行允许被切开，导出不报错，文字一个不少", async ({
    page
  }) => {
    // 一个单元格里放大段文字，这一行比整页还高，无法整行放下。
    // 文字必须逐句编号、互不相同：Paged.js 按文字内容定位断点，完全周期重复的文字
    // （同一句话重复数百遍）会让它定位错位而空转，那不是真实文档会有的内容。
    const longText = Array.from(
      { length: 700 },
      (_, index) => `第${String(index + 1).padStart(4, "0")}句，超高单元格内的长文字。`
    ).join("");
    const table = wideTableMarkdown(18, 6).split("\n");
    table[3] = table[3]!.replace(/\|\s*[\d.]+\s*\|/, `| ${longText} |`);

    const { articleHtml, pageCount } = await renderPagedDocument(
      page,
      documentWith(table.join("\n"))
    );
    const fragments = await readTableFragments(page);

    expect(pageCount, "超高行应当跨页").toBeGreaterThan(1);
    const tallRows = fragments
      .flatMap((fragment) => fragment.rows)
      .filter((row) => !row.keepWhole);
    expect(tallRows.length, "应当存在被标记为允许切开的超高行").toBeGreaterThan(0);
    // 其余整行保持不拆的行仍然各出现一次
    expect(
      [...wholeRowOccurrences(fragments)].filter(([, count]) => count !== 1)
    ).toEqual([]);
    await expectContentConserved(page, articleHtml);
  });
});
