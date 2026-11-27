import { expect, test, type Page } from "@playwright/test";
import { renderPagedDocument } from "./support/paged-render";

/**
 * Paged.js 契约测试。
 *
 * 分页意图机制（packages/preview-engine/src/paged-break-control.ts）建立在对
 * Paged.js 行为的几项判断之上。这些判断都是实测得出的，不是文档保证：
 *
 * 1. 元素上的语义属性 + 共享 CSS 映射规则能让 Paged.js 强制换页；
 * 2. 文档首个元素之前、最后一个元素之后的强制分页不产生空白页；
 * 3. 表格行之间的强制分页有效，续页自动重复表头；
 * 4. 内联样式里的 break-before / break-after 不被 Paged.js 识别。
 *
 * 升级 Paged.js 后，这里是第一道防线：任何一项失效，都说明适配层的假设变了。
 * 直接调用预览帧的 `__morphDocRender`，不经过界面，避免被界面行为干扰。
 */

const markdown = [
  "# 标题",
  "",
  "段落甲",
  "",
  "段落乙",
  "",
  "段落丙",
  "",
  "| 表头一 | 表头二 |",
  "| --- | --- |",
  "| 行一 | 数据一 |",
  "| 行二 | 数据二 |",
  ""
].join("\n");

interface RenderedPages {
  pageCount: number;
  /** 每页内容区的纯文本（去除空白）。 */
  texts: string[];
}

/** 渲染 Markdown，允许在送入分页运行时之前改写文章 HTML。 */
async function renderPages(
  page: Page,
  mutateHtml: (html: string) => string,
  source: string = markdown
): Promise<RenderedPages> {
  const { pageCount } = await renderPagedDocument(page, source, { mutateHtml });
  const texts = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".pagedjs_page")).map((pageElement) =>
      (pageElement.querySelector(".pagedjs_area")?.textContent ?? "").replace(/\s+/g, "")
    )
  );
  return { pageCount, texts };
}

const BEFORE = "data-morphdoc-break-before";
const AFTER = "data-morphdoc-break-after";

test.describe("Paged.js 契约（分页意图）", () => {
  test("基线：没有任何标记时内容落在同一页", async ({ page }) => {
    const { pageCount } = await renderPages(page, (html) => html);
    expect(pageCount).toBe(1);
  });

  test("语义属性 before 让目标元素从新页开始", async ({ page }) => {
    const { pageCount, texts } = await renderPages(page, (html) =>
      html.replace("<p>段落乙</p>", `<p ${BEFORE}="page">段落乙</p>`)
    );
    expect(pageCount).toBe(2);
    expect(texts[0]).toContain("段落甲");
    expect(texts[0]).not.toContain("段落乙");
    expect(texts[1]).toContain("段落乙");
  });

  test("语义属性 after 让目标元素之后的内容从新页开始", async ({ page }) => {
    const { pageCount, texts } = await renderPages(page, (html) =>
      html.replace("<p>段落甲</p>", `<p ${AFTER}="page">段落甲</p>`)
    );
    expect(pageCount).toBe(2);
    expect(texts[0]).toContain("段落甲");
    expect(texts[0]).not.toContain("段落乙");
    expect(texts[1]).toContain("段落乙");
  });

  test("文档首个元素之前的强制分页不产生空白页", async ({ page }) => {
    const { pageCount, texts } = await renderPages(page, (html) =>
      html.replace("<h1", `<h1 ${BEFORE}="page"`)
    );
    expect(pageCount).toBe(1);
    expect(texts[0]).toContain("标题");
  });

  test("文档最后一个元素之后的强制分页不产生空白页", async ({ page }) => {
    const { pageCount } = await renderPages(page, (html) =>
      html.replace("<table", `<table ${AFTER}="page"`)
    );
    expect(pageCount).toBe(1);
  });

  test("表格行之间的强制分页有效，续页自动重复表头", async ({ page }) => {
    const { pageCount, texts } = await renderPages(page, (html) =>
      html.replace("<tr>\n<td>行二", `<tr ${BEFORE}="page">\n<td>行二`)
    );
    expect(pageCount).toBe(2);
    expect(texts[0]).toContain("行一");
    expect(texts[0]).not.toContain("行二");
    // 续页以重复的表头开头，随后才是被强制换页的行
    expect(texts[1]).toBe("表头一表头二行二数据二");
  });

  test("已知限制：内联样式中的 break-before / break-after 不被 Paged.js 识别", async ({
    page
  }) => {
    // 此前项目里多处用内联样式表达强制分页，实测没有任何效果。该用例记录这一事实；
    // 若 Paged.js 升级后开始识别内联样式，它会失败，届时应重新评估适配层的写法。
    const inlineBefore = await renderPages(page, (html) =>
      html.replace(
        "<p>段落乙</p>",
        '<p style="break-before: page !important">段落乙</p>'
      )
    );
    expect(inlineBefore.pageCount).toBe(1);

    const inlineAfter = await renderPages(page, (html) =>
      html.replace(
        "<p>段落甲</p>",
        '<p style="break-after: page !important">段落甲</p>'
      )
    );
    expect(inlineAfter.pageCount).toBe(1);
  });
});

/**
 * 连续标题（章标题紧跟节标题）会让 Paged.js 的 `break-after: avoid` 失效：节标题被
 * 推到下一页，章标题留在页末。用固定种子的线性同余序列生成大量“章 + 节 + 短段落”，
 * 让页面边界落在各种位置。断言任何一页（最后一页除外）都不以标题结尾。
 */
function chapterChainMarkdown() {
  let state = 20261127;
  const next = (bound: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % bound;
  };
  const lines: string[] = ["# 连续标题回归", ""];
  for (let chapter = 1; chapter <= 80; chapter += 1) {
    for (let paragraph = 0; paragraph < next(4); paragraph += 1) {
      lines.push(`填充段落 ${chapter}-${paragraph}：把后续内容推到页面的不同位置，并且保持稳定。`, "");
    }
    // 正文要有数行：只有章、节标题都放得下而正文放不下时，Paged.js 才会只把节标题
    // 带走、把章标题留在页末；一行的短段落几乎不会落进这个窗口。
    const body = "这是该章的第一段正文，用来占据数行版面并保持内容稳定。".repeat(4 + next(5));
    lines.push(`## 第 ${chapter} 章`, "", `### ${chapter}.1 小节`, "", body, "");
  }
  return lines.join("\n");
}

test.describe("分页不变量：标题不孤立在页末", () => {
  test("连续的章、节标题不会被拆在两页", async ({ page }) => {
    const result = await renderPages(page, (html) => html, chapterChainMarkdown());
    expect(result.pageCount, "夹具应跨足够多的页，页面边界才会落在各种位置").toBeGreaterThan(12);

    const stranded = await page.evaluate(() => {
      const pages = Array.from(document.querySelectorAll(".pagedjs_page"));
      const found: string[] = [];
      for (const [index, pageElement] of pages.entries()) {
        if (index === pages.length - 1) continue;
        const root = pageElement.querySelector(".pagedjs_area article");
        const blocks = Array.from(root?.children ?? []).filter((child) => {
          const box = child.getBoundingClientRect();
          return (
            getComputedStyle(child).display !== "none" &&
            box.height > 0.5 &&
            (child.textContent ?? "").trim().length > 0
          );
        });
        const last = blocks.at(-1);
        if (last && /^H[1-6]$/.test(last.tagName)) {
          found.push(`${last.textContent?.trim()}@第${index + 1}页`);
        }
      }
      return found;
    });
    expect(stranded, "页末孤立的标题").toEqual([]);
  });
});

/**
 * 内联样式守卫（packages/preview-engine/src/paged-inline-style-guard.ts）。
 *
 * Paged.js 内置过滤器会把带内联 style 的元素误标为“不显示”。守卫在过滤器运行前暂存
 * 内联样式、运行后原样还原，要保证三件事：误判被消除、真正的 display:none 仍被识别、
 * 样式不丢失也不泄漏暂存属性。单元测试只能在没有布局的环境里验证暂存与还原，
 * 这里在真实的 Paged.js 里验证它们对分页结果的影响。
 */
test.describe("内联样式守卫（真实 Paged.js）", () => {
  test("带内联样式的表格不再被标为不显示，真正的 display:none 仍然被标记", async ({ page }) => {
    await renderPages(page, (html) =>
      html.replace("<p>段落乙</p>", '<p>段落乙</p><p style="display: none">被隐藏的段落</p>')
    );

    const flags = await page.evaluate(() => ({
      // 表格被稳定化时写入了内联 style（table-layout:fixed）
      tablesWithInlineStyle: document.querySelectorAll("table[style]").length,
      tablesUndisplayed: document.querySelectorAll("table[data-undisplayed]").length,
      hiddenParagraphUndisplayed: Array.from(
        document.querySelectorAll("p[data-undisplayed]")
      ).filter((paragraph) => paragraph.textContent?.includes("被隐藏的段落")).length
    }));

    expect(flags.tablesWithInlineStyle, "夹具应当有带内联样式的表格").toBeGreaterThan(0);
    expect(flags.tablesUndisplayed, "带内联样式的表格被误标为不显示").toBe(0);
    expect(flags.hiddenParagraphUndisplayed, "真正的 display:none 必须仍被识别").toBe(1);
  });

  test("分页完成后没有残留暂存属性，内联样式原样保留", async ({ page }) => {
    await renderPages(page, (html) =>
      html.replace(
        "<p>段落甲</p>",
        '<p style="color: rgb(1, 2, 3); margin-left: 7px">段落甲</p>'
      )
    );

    const state = await page.evaluate(() => {
      const colored = Array.from(document.querySelectorAll(".pagedjs_area p")).find(
        (paragraph) => paragraph.textContent?.includes("段落甲")
      ) as HTMLElement | undefined;
      const table = document.querySelector(".pagedjs_area table") as HTMLElement | null;
      const cell = document.querySelector(".pagedjs_area td") as HTMLElement | null;
      return {
        leaked: document.querySelectorAll("[data-morphdoc-inline-style]").length,
        color: colored ? getComputedStyle(colored).color : null,
        marginLeft: colored ? getComputedStyle(colored).marginLeft : null,
        tableLayout: table?.style.tableLayout ?? null,
        cellWidth: cell?.style.width ?? null
      };
    });

    expect(state.leaked, "暂存属性不得泄漏到分页结果").toBe(0);
    expect(state.color, "原有内联颜色被保留").toBe("rgb(1, 2, 3)");
    expect(state.marginLeft, "原有内联边距被保留").toBe("7px");
    expect(state.tableLayout, "表格稳定化写入的内联样式被保留").toBe("fixed");
    expect(state.cellWidth, "单元格冻结宽度被保留").toMatch(/px$/u);
  });

  test("连续渲染两次：暂存属性不累积，第二次结果与第一次一致", async ({ page }) => {
    const first = await renderPages(page, (html) => html);
    const second = await renderPages(page, (html) => html);

    expect(second.pageCount).toBe(first.pageCount);
    expect(second.texts).toEqual(first.texts);
    expect(
      await page.evaluate(() => document.querySelectorAll("[data-morphdoc-inline-style]").length)
    ).toBe(0);
  });
});
