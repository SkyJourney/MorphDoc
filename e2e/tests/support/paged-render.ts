import { expect, type Page } from "@playwright/test";

/**
 * 分页运行时的端到端测试支撑。
 *
 * 直接调用预览帧暴露的 `__morphDocRender`，不经过界面：渲染入口、导出配置和
 * 页面内的检查函数集中在这里，避免每个测试各写一份。
 *
 * 检查函数的设计取向：优先断言**不变量**（内容守恒、行不重复、不溢出），而不是
 * 固定的页数或坐标——后者会随字体与系统变化，用来守住行为反而会制造误报。
 */

declare global {
  interface Window {
    __morphDocRender?: (
      payload: unknown,
      target: "pdf"
    ) => Promise<{ pageCount: number }>;
  }
}

export type PagedFormat = "A3" | "A4" | "A5";
export type PagedOrientation = "portrait" | "landscape";

export interface PagedRenderOptions {
  themeId?: string;
  format?: PagedFormat;
  orientation?: PagedOrientation;
  /** 在送入分页运行时之前改写文章 HTML，用来注入特殊标记。 */
  mutateHtml?: (html: string) => string;
}

export interface RenderedPagedDocument {
  pageCount: number;
  /** 实际送入分页运行时的文章 HTML，用于与分页结果比对。 */
  articleHtml: string;
  /**
   * 分页过程中 Paged.js 报出的 “Unable to layout item” 警告。
   *
   * 这是 Paged.js 放弃某一段内容的布局时的信号：它随后会把内容堆在一页里或重复渲染。
   * 任何一份正常文档都不应出现，所以它是比具体页数、坐标更通用的健康检查。
   */
  layoutWarnings: string[];
}

const disabledSlot = { enabled: false, content: "" };

/** 运行时实际读取的导出配置字段；其余取值与应用默认配置一致。 */
function buildExportConfig(
  themeId: string,
  format: PagedFormat,
  orientation: PagedOrientation,
  margins: Record<string, string>
) {
  return {
    version: 4,
    name: "端到端测试",
    themeId,
    pageDecorationsMode: "theme",
    mermaid: {
      layout: "dagre",
      theme: "default",
      look: "classic",
      fontFamily: "sans-serif"
    },
    paper: { format, orientation, marginMode: "custom", margins },
    header: {
      enabled: false,
      height: "8mm",
      showOnFirstPage: true,
      showDivider: false,
      fontSize: "3mm",
      fontFamily: "sans-serif",
      color: "#6b7280",
      left: disabledSlot,
      center: disabledSlot,
      right: disabledSlot
    },
    footer: {
      enabled: false,
      height: "8mm",
      showDivider: false,
      fontSize: "3mm",
      fontFamily: "sans-serif",
      color: "#6b7280",
      alignment: "center",
      format: "page-total",
      startFrom: 1,
      showOnFirstPage: true
    },
    metadata: { title: "", author: "", subject: "", keywords: [], language: "zh-CN" },
    print: { background: true, scale: 1, pageBreakBeforeH1: false }
  };
}

const defaultMargins = {
  top: "16mm",
  right: "16mm",
  bottom: "16mm",
  left: "16mm"
};

/**
 * 渲染 Markdown 并把分页结果留在当前页面中，供后续检查函数读取。
 *
 * 页边距沿用主题声明的默认值，与应用界面选择主题时的行为一致。
 */
export async function renderPagedDocument(
  page: Page,
  markdown: string,
  options: PagedRenderOptions = {}
): Promise<RenderedPagedDocument> {
  const themeId = options.themeId ?? "typora-github";
  const format = options.format ?? "A4";
  const orientation = options.orientation ?? "portrait";

  const rendered = await page.request.post("/api/render", { data: { markdown } });
  expect(rendered.ok(), "/api/render 应当成功").toBe(true);
  const renderedDocument = (await rendered.json()) as { articleHtml: string };

  const themeCss = await (
    await page.request.get(`/api/themes/${themeId}/css`)
  ).text();
  const themeList = (await (await page.request.get("/api/themes")).json()) as
    | { themes?: ThemeSummary[] }
    | ThemeSummary[];
  const themes = Array.isArray(themeList) ? themeList : (themeList.themes ?? []);
  const margins =
    themes.find((theme) => theme.id === themeId)?.pageDefaults?.margins ??
    defaultMargins;

  const layoutWarnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" && /Unable to layout item/u.test(message.text())) {
      layoutWarnings.push(message.text());
    }
  });
  await page.emulateMedia({ media: "print" });
  await page.goto("/preview-frame.html?target=pdf");
  await page.waitForFunction(
    () => document.documentElement.dataset.runtimeReady === "true"
  );

  const articleHtml = (options.mutateHtml ?? ((html) => html))(
    renderedDocument.articleHtml
  );
  const payload = {
    ...renderedDocument,
    articleHtml,
    fileName: "e2e.md",
    themeCss,
    exportConfig: buildExportConfig(themeId, format, orientation, margins)
  };
  const result = await page.evaluate(
    (input) => window.__morphDocRender!(input, "pdf"),
    payload
  );
  return { pageCount: result.pageCount, articleHtml, layoutWarnings };
}

interface ThemeSummary {
  id: string;
  pageDefaults?: { margins?: Record<string, string> };
}

/** 分页结果中一个表格片段（同一张表跨页后每页各有一个片段）的观测。 */
export interface TableFragmentReport {
  /** 所在页码，从 1 开始。 */
  page: number;
  /** `data-morphdoc-table-fit` 的取值；没有适配时为 `null`。 */
  fit: string | null;
  /** 第一个单元格的左内边距（px）。 */
  paddingLeft: number;
  /** 表格右边缘超出页面内容区右边缘的距离（px），未超出时为负数或 0。 */
  overflow: number;
  /** 表格右边缘超出其直接父容器内容区右边缘的距离（px）。 */
  overflowInParent: number;
  /** 片段内的表头文字（去除空白）；没有表头时为空串。 */
  headText: string;
  /** 片段内的正文行。 */
  rows: Array<{ id: string; keepWhole: boolean; text: string }>;
}

export async function readTableFragments(
  page: Page
): Promise<TableFragmentReport[]> {
  return page.evaluate(() => {
    const reports: TableFragmentReport[] = [];
    const pages = Array.from(document.querySelectorAll(".pagedjs_page"));
    for (const [index, pageElement] of pages.entries()) {
      const area = pageElement.querySelector(".pagedjs_area");
      if (!area) continue;
      const areaRect = area.getBoundingClientRect();
      for (const table of Array.from(area.querySelectorAll("table"))) {
        const rect = table.getBoundingClientRect();
        if (rect.height < 0.5) continue; // Paged.js 留下的被隐藏的空表壳
        const parent = table.parentElement;
        const parentStyle = parent ? getComputedStyle(parent) : undefined;
        const parentRect = parent?.getBoundingClientRect();
        const parentContentRight = parentRect
          ? parentRect.right - Number.parseFloat(parentStyle?.paddingRight ?? "0")
          : rect.right;
        const firstCell = table.querySelector("td, th");
        reports.push({
          page: index + 1,
          fit: table.getAttribute("data-morphdoc-table-fit"),
          paddingLeft: firstCell
            ? Number.parseFloat(getComputedStyle(firstCell).paddingLeft)
            : 0,
          overflow: rect.right - areaRect.right,
          overflowInParent: rect.right - parentContentRight,
          headText: (table.querySelector("thead")?.textContent ?? "").replace(/\s+/g, ""),
          rows: Array.from(table.querySelectorAll("tbody > tr")).map((row) => ({
            id: (row as HTMLElement).dataset.morphdocTableRowId ?? "",
            keepWhole: (row as HTMLElement).dataset.morphdocTableRowKeepWhole === "true",
            text: (row.textContent ?? "").replace(/\s+/g, "")
          }))
        });
      }
    }
    return reports;
  });
}

/** 统计“整行保持不拆”的正文行在分页结果中出现的次数。 */
export function wholeRowOccurrences(fragments: readonly TableFragmentReport[]) {
  const counts = new Map<string, number>();
  for (const fragment of fragments) {
    for (const row of fragment.rows) {
      if (row.id && row.keepWhole) {
        counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** 内容守恒检查的结果。 */
export interface ConservationReport {
  sourceLength: number;
  renderedLength: number;
  equal: boolean;
  /**
   * 媒体块个数不一致的描述，例如 `.md-echarts：源 2 个、结果 3 个`；全部一致时为空数组。
   *
   * 文字比对要排除图表与流程图（分页前是源码、分页后是矢量图，文字对不上），所以图表被
   * 重复渲染或被吞掉时文字比对看不见，必须单独核对个数。
   */
  mediaMismatches: string[];
  /** 首个不一致位置前后的文字，便于定位；一致时为空串。 */
  sourceContext: string;
  renderedContext: string;
  firstDifference: number;
}

/**
 * 内容守恒：分页前后的文字必须逐字一致（忽略空白）。
 *
 * 这是最通用的“有没有丢内容、多内容”的检查：表格行丢失、整表重放、段落被吞掉
 * 或复制，都会让分页结果的文字与源文档不一致。
 *
 * 比对时排除三类会合法地不一致的内容：
 * - `thead`：续页会重复表头；
 * - `.mermaid`、`.md-echarts`：分页前后分别是源码与矢量图片，文字不对应；
 * - `script`、`style`：不是读者可见内容。
 */
export async function measureContentConservation(
  page: Page,
  sourceHtml: string
): Promise<ConservationReport> {
  return page.evaluate((html) => {
    const normalize = (root: Element) => {
      const clone = root.cloneNode(true) as Element;
      for (const element of Array.from(
        clone.querySelectorAll("thead, .mermaid, .md-echarts, script, style")
      )) {
        element.remove();
      }
      return (clone.textContent ?? "").replace(/\s+/g, "");
    };
    const sourceBody = new DOMParser().parseFromString(html, "text/html").body;
    const source = normalize(sourceBody);
    const mediaMismatches: string[] = [];
    for (const selector of [".md-echarts", ".mermaid", "img.md-document-image"]) {
      const expected = sourceBody.querySelectorAll(selector).length;
      const actual = document.querySelectorAll(`.pagedjs_page ${selector}`).length;
      if (expected !== actual) {
        mediaMismatches.push(`${selector}：源 ${expected} 个、结果 ${actual} 个`);
      }
    }
    const rendered = Array.from(
      document.querySelectorAll(".pagedjs_page .pagedjs_area")
    )
      .map((area) => normalize(area))
      .join("");
    let firstDifference = -1;
    const limit = Math.min(source.length, rendered.length);
    for (let index = 0; index < limit; index += 1) {
      if (source[index] !== rendered[index]) {
        firstDifference = index;
        break;
      }
    }
    if (firstDifference < 0 && source.length !== rendered.length) {
      firstDifference = limit;
    }
    const context = (text: string) =>
      firstDifference < 0
        ? ""
        : text.slice(Math.max(0, firstDifference - 30), firstDifference + 60);
    return {
      sourceLength: source.length,
      renderedLength: rendered.length,
      equal: firstDifference < 0,
      mediaMismatches,
      sourceContext: context(source),
      renderedContext: context(rendered),
      firstDifference
    };
  }, sourceHtml);
}

/** 断言内容守恒，失败时给出可定位的上下文。 */
export async function expectContentConserved(
  page: Page,
  sourceHtml: string,
  label = "分页结果"
) {
  const report = await measureContentConservation(page, sourceHtml);
  expect(
    report.equal,
    `${label}与源文档文字不一致：源 ${report.sourceLength} 字、结果 ${report.renderedLength} 字；` +
      `首个差异在第 ${report.firstDifference} 字。源：「${report.sourceContext}」结果：「${report.renderedContext}」`
  ).toBe(true);
  expect(report.mediaMismatches, `${label}：媒体块（图表、流程图、图片）个数分页前后不一致`).toEqual([]);
}

/** 分页结果的版面健康度。 */
export interface PageHealth {
  pageCount: number;
  /** 既没有文字也没有图形的页码（空白页）。 */
  blankPages: number[];
  /**
   * 页面最后一个可见块是标题、其前面还有别的内容、而它之后还有内容的页（标题孤立在页末）。
   *
   * 这一类可以通过“让标题换页”修复，分页不变量会处理，所以应当始终为空。
   */
  strandedHeadings: string[];
  /**
   * 整页只剩标题、其后还有内容的页码。
   *
   * 标题串加上后面的表头与首行合起来比一页还高时，标题无论怎么挪都不可能与内容同页，
   * 分页不变量会跳过这种情形（见 paged-stranded-headings.ts）。它是几何上的限制，不是
   * 缺陷，单独统计以便用专门的用例如实记录，而不是混进 `strandedHeadings` 或被放宽掉。
   */
  headingOnlyPages: number[];
}

/**
 * 检查分页结果的版面健康度：空白页、孤立在页末的标题、整页只剩标题的页。
 *
 * 只看文档根容器的直接子级，与分页不变量（`paged-stranded-headings.ts`）的判定保持一致。
 */
export async function readPageHealth(page: Page): Promise<PageHealth> {
  return page.evaluate(() => {
    const pages = Array.from(document.querySelectorAll(".pagedjs_page"));
    const blankPages: number[] = [];
    const strandedHeadings: string[] = [];
    const headingOnlyPages: number[] = [];
    const visibleBlocks = (pageElement: Element) =>
      Array.from(pageElement.querySelector(".pagedjs_area article")?.children ?? []).filter(
        (child) => {
          const box = child.getBoundingClientRect();
          return (
            getComputedStyle(child).display !== "none" &&
            box.height > 0.5 &&
            ((child.textContent ?? "").trim().length > 0 ||
              child.matches("img, svg, canvas, hr") ||
              child.querySelector("img, svg, canvas, hr") !== null)
          );
        }
      );
    const isHeading = (element: Element) => /^H[1-6]$/.test(element.tagName);
    const hasContent = pages.map((pageElement) => visibleBlocks(pageElement).length > 0);
    for (const [index, pageElement] of pages.entries()) {
      const blocks = visibleBlocks(pageElement);
      if (blocks.length === 0) {
        blankPages.push(index + 1);
        continue;
      }
      const last = blocks.at(-1)!;
      const hasLaterContent = hasContent.slice(index + 1).some(Boolean);
      if (!isHeading(last) || !hasLaterContent) continue;
      if (blocks.every(isHeading)) {
        headingOnlyPages.push(index + 1);
      } else {
        strandedHeadings.push(`${(last.textContent ?? "").trim().slice(0, 30)}@第${index + 1}页`);
      }
    }
    return { pageCount: pages.length, blankPages, strandedHeadings, headingOnlyPages };
  });
}

/** 分页结果中一页上的一个可见块（文档根容器的直接子级）。 */
export interface PageBlock {
  tag: string;
  /** 块的文字前 12 个字符（去除空白），用于定位。 */
  text: string;
  /** 被缩放到整页高度的媒体块（`data-page-height-fitted`），或其内部带有该标记。 */
  fitted: boolean;
  /** 被约束为单页的封面（`data-semantic-cover-fit`）。 */
  coverFit: boolean;
  /** 测试注入的探针（`data-e2e-probe`）。 */
  probe: string | null;
  /** 块的底边相对页面内容区的位置，0 到 1。 */
  bottomRatio: number;
}

/**
 * 逐页读取可见块。
 *
 * “可见”指没有被隐藏，且高度大于 0.5px **或者是测试探针**：探针刻意是零高度，
 * 用来检验“没有任何内容能与整页媒体同页”，所以必须保留在结果里。
 */
export async function readPageBlocks(page: Page): Promise<PageBlock[][]> {
  return page.evaluate(() => {
    const pages = Array.from(document.querySelectorAll(".pagedjs_page"));
    return pages.map((pageElement) => {
      const area = pageElement.querySelector(".pagedjs_area");
      const areaRect = area?.getBoundingClientRect();
      const root = pageElement.querySelector(".pagedjs_area article");
      return Array.from(root?.children ?? [])
        .filter((child) => {
          if (getComputedStyle(child).display === "none") return false;
          return (
            child.getBoundingClientRect().height > 0.5 ||
            child.hasAttribute("data-e2e-probe")
          );
        })
        .map((child) => ({
          tag: child.tagName.toLowerCase(),
          text: (child.textContent ?? "").replace(/\s+/g, "").slice(0, 12),
          fitted:
            child.getAttribute("data-page-height-fitted") === "true" ||
            child.querySelector('[data-page-height-fitted="true"]') !== null,
          coverFit: child.hasAttribute("data-semantic-cover-fit"),
          probe: child.getAttribute("data-e2e-probe"),
          bottomRatio: areaRect
            ? (child.getBoundingClientRect().bottom - areaRect.top) / areaRect.height
            : 0
        }));
    });
  });
}

/** 统计分页结果中匹配选择器的元素个数（含所有页面）。 */
export async function countInRendered(page: Page, selector: string): Promise<number> {
  return page.evaluate(
    (css) => document.querySelectorAll(`.pagedjs_page ${css}`).length,
    selector
  );
}
