import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type FrameLocator, type Page } from "@playwright/test";

/** 预览帧向父页面发送的渲染事件，由 addInitScript 注入的监听器记录。 */
declare global {
  interface Window {
    __renderEvents?: Array<{ type: string; at: number }>;
    __pwned?: boolean;
  }
}

const fixtureDirectory = resolve(__dirname, "../../fixtures/markdown/static");

/** 预览帧最后一次事件之后需要保持静默的毫秒数，用来确认没有后续重渲染。 */
const settleMilliseconds = 700;

async function recordRenderEvents(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__renderEvents = [];
    window.addEventListener("message", (event: MessageEvent) => {
      const type = (event.data as { type?: string } | null)?.type;
      if (type === "rendering" || type === "rendered" || type === "error") {
        window.__renderEvents?.push({ type, at: performance.now() });
      }
    });
  });
}

async function renderedCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window.__renderEvents ?? []).filter((event) => event.type === "rendered").length
  );
}

/**
 * 等待预览稳定：已出现新的 rendered 事件，最后一个事件就是 rendered，且之后一段时间内
 * 没有新的渲染开始。依据的是应用自身的消息协议，而不是固定睡眠。
 */
async function waitForPreviewSettled(page: Page, previouslyRendered: number): Promise<void> {
  await page.waitForFunction(
    ({ previous, quiet }) => {
      const events = window.__renderEvents ?? [];
      const rendered = events.filter((event) => event.type === "rendered").length;
      const last = events[events.length - 1];
      return (
        rendered > previous &&
        last?.type === "rendered" &&
        performance.now() - last.at > quiet
      );
    },
    { previous: previouslyRendered, quiet: settleMilliseconds },
    { timeout: 60_000 }
  );
}

function previewFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe[title="文档内容预览"]');
}

/** 打开应用、等待默认示例渲染完成，再载入指定夹具并等待其渲染稳定。 */
async function openFixture(page: Page, file: string): Promise<void> {
  await recordRenderEvents(page);
  await page.goto("/");
  await waitForPreviewSettled(page, 0);
  const before = await renderedCount(page);
  await page
    .locator('input[type="file"][accept*=".md"]')
    .setInputFiles(resolve(fixtureDirectory, file));
  await waitForPreviewSettled(page, before);
}

/** 收集页面与控制台错误，用于断言应用在渲染夹具时没有抛出异常。 */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console.error: ${message.text()}`);
    }
  });
  return errors;
}

interface ScenarioSpec {
  file: string;
  /** 预览帧内必须出现的选择器（以及期望的最少数量）。 */
  expect: Array<{ selector: string; atLeast: number }>;
  /** 为真时要求预览帧内全部图片都已成功解码（图表以静态 SVG 图片呈现）。 */
  imagesLoaded?: boolean;
  /**
   * 为真时要求公式里的内联 SVG 在真实浏览器中确实被绘制：渲染尺寸非零；由 path 绘制的
   * SVG 还必须带驼峰的 viewBox（sanitize-html 输出小写 viewbox，由浏览器的 HTML 解析
   * 还原）。划线类（\cancel 等）的 SVG 由百分比坐标的 line 绘制，KaTeX 本来就不给它们
   * 设置 viewBox，因此不对其要求。
   */
  mathSvgRendered?: boolean;
  /**
   * 为真时要求公式的结构性内联样式在真实浏览器中生效：字形重音符有非零的 left 偏移，
   * \phantom 的内容颜色为透明，数组列分隔线有非零边框宽度，\rule 的尺寸非零。
   * 这些样式任何一个被安全过滤器丢弃，公式都会悄悄显示错误。
   */
  mathLayoutRendered?: boolean;
  /**
   * 为真时要求上标、下标、分式与上下限被正确缩小：每个 katex-sizing 元素的计算字号都严格
   * 小于公式根字号（本场景的实测为 0.7 倍与 0.5 倍）。生成标记的 KaTeX 与提供样式表的
   * KaTeX 版本错开时，新旧 class 名对不上，这些元素不再缩小，公式整体偏大。
   */
  mathSizingRendered?: boolean;
  /** 是否生成视觉基线。 */
  visual: boolean;
}

const scenarios: ScenarioSpec[] = [
  {
    file: "gfm-basic.md",
    expect: [
      { selector: "h1", atLeast: 1 },
      { selector: "table", atLeast: 1 },
      // 围栏代码在预览中被拆成可分页的片段，而不是 <pre>
      { selector: "[data-code-pagination-position]", atLeast: 3 }
    ],
    visual: true
  },
  {
    file: "cjk-mixed.md",
    expect: [
      { selector: "h1", atLeast: 1 },
      { selector: "table", atLeast: 1 }
    ],
    visual: true
  },
  {
    file: "math.md",
    // 高斯积分与三个根号：每个根号都由内联 SVG 绘制
    expect: [
      { selector: ".katex", atLeast: 3 },
      { selector: ".katex svg", atLeast: 4 }
    ],
    mathSvgRendered: true,
    mathSizingRendered: true,
    visual: true
  },
  {
    file: "math-svg.md",
    expect: [
      { selector: ".katex", atLeast: 10 },
      { selector: ".katex svg path", atLeast: 10 },
      { selector: ".katex svg line", atLeast: 3 }
    ],
    mathSvgRendered: true,
    visual: true
  },
  {
    file: "math-layout.md",
    expect: [
      { selector: ".katex .accent-body", atLeast: 5 },
      { selector: ".katex .vertical-separator", atLeast: 3 },
      { selector: ".katex .katex-rule", atLeast: 3 },
      { selector: ".katex .katex-hline", atLeast: 1 },
      { selector: '.katex [style*="color:transparent"]', atLeast: 2 }
    ],
    mathLayoutRendered: true,
    visual: true
  },
  {
    file: "diagrams.md",
    // 两个 Mermaid 与一个 ECharts 都被冻结为静态 SVG 图片
    expect: [
      { selector: ".mermaid img", atLeast: 2 },
      { selector: ".md-echarts img", atLeast: 1 }
    ],
    imagesLoaded: true,
    visual: true
  },
  {
    file: "tables-edge.md",
    expect: [{ selector: "table", atLeast: 3 }],
    visual: true
  },
  {
    file: "security-xss.md",
    expect: [{ selector: "p", atLeast: 5 }],
    visual: false
  },
  {
    file: "images-paths.md",
    expect: [{ selector: "p", atLeast: 3 }],
    visual: false
  }
];

test.describe("预览渲染（功能）", () => {
  for (const scenario of scenarios) {
    test(`${scenario.file} 渲染成功且没有页面错误`, async ({ page }) => {
      const errors = collectErrors(page);
      await openFixture(page, scenario.file);

      const frame = previewFrame(page);
      await expect(frame.locator(".pagedjs_page").first()).toBeVisible();
      for (const { selector, atLeast } of scenario.expect) {
        expect(
          await frame.locator(selector).count(),
          `预览帧内 ${selector} 的数量`
        ).toBeGreaterThanOrEqual(atLeast);
      }
      if (scenario.imagesLoaded) {
        const allDecoded = await frame
          .locator("img")
          .evaluateAll((images) =>
            images.every((image) => (image as HTMLImageElement).naturalWidth > 0)
          );
        expect(allDecoded, "预览帧内全部图片均已成功解码").toBe(true);
      }
      if (scenario.mathSvgRendered) {
        const report = await frame.locator(".katex svg").evaluateAll((svgs) =>
          svgs.map((svg) => {
            const box = svg.getBoundingClientRect();
            return {
              drawnByPath: svg.querySelector("path") !== null,
              viewBox: svg.getAttribute("viewBox"),
              width: box.width,
              height: box.height
            };
          })
        );
        expect(report.length, "预览帧内公式 SVG 的数量").toBeGreaterThan(0);
        for (const [index, item] of report.entries()) {
          const label = `第 ${index + 1} 个公式 SVG`;
          expect(item.width, `${label}的渲染宽度`).toBeGreaterThan(0);
          expect(item.height, `${label}的渲染高度`).toBeGreaterThan(0);
          if (item.drawnByPath) {
            expect(item.viewBox, `${label}的 viewBox（驼峰）`).not.toBeNull();
          }
        }
        // 确认确实覆盖到了 path 与 line 两类 SVG，避免断言因分类全空而形同虚设
        expect(report.some((item) => item.drawnByPath), "存在由 path 绘制的 SVG").toBe(true);
      }
      if (scenario.mathLayoutRendered) {
        const layout = await frame.locator(".katex").first().evaluate((first) => {
          const root = first.ownerDocument;
          const px = (value: string): number => Number.parseFloat(value);
          const all = (selector: string): Element[] => Array.from(root.querySelectorAll(selector));
          return {
            accentOffsets: all(".katex .accent-body").map((el) => px(getComputedStyle(el).left)),
            phantomColors: all('.katex [style*="color:transparent"]').map((el) => getComputedStyle(el).color),
            separators: all(".katex .vertical-separator").map((el) => ({
              width: px(getComputedStyle(el).borderRightWidth),
              style: getComputedStyle(el).borderRightStyle
            })),
            rules: all(".katex .katex-rule").map((el) => {
              const box = el.getBoundingClientRect();
              return { width: box.width, height: box.height };
            }),
            hlines: all(".katex .katex-hline").map((el) => px(getComputedStyle(el).borderBottomWidth))
          };
        });

        // 字形重音符靠 left 与底字居中：缺少该样式时 left 为 0，重音符偏向一侧
        for (const [index, offset] of layout.accentOffsets.entries()) {
          expect(Math.abs(offset), `第 ${index + 1} 个重音符的 left 偏移`).toBeGreaterThan(0);
        }
        // \phantom 靠 color:transparent 隐藏内容：缺少时隐藏的内容会显示出来
        for (const color of layout.phantomColors) {
          expect(color, "隐形占位的计算颜色").toBe("rgba(0, 0, 0, 0)");
        }
        for (const [index, separator] of layout.separators.entries()) {
          expect(separator.width, `第 ${index + 1} 条列分隔线的边框宽度`).toBeGreaterThan(0);
          expect(["solid", "dashed"], `第 ${index + 1} 条列分隔线的边框样式`).toContain(separator.style);
        }
        // 至少有一条虚线分隔线，确认 dashed 也被保留
        expect(
          layout.separators.some((separator) => separator.style === "dashed"),
          "存在虚线列分隔线"
        ).toBe(true);
        // \rule 与 \vdots 缺少 border-*-width 与 bottom 时会缩成零尺寸
        for (const [index, rule] of layout.rules.entries()) {
          expect(rule.width + rule.height, `第 ${index + 1} 条规则线的尺寸`).toBeGreaterThan(0);
        }
        for (const [index, width] of layout.hlines.entries()) {
          expect(width, `第 ${index + 1} 条横线的边框宽度`).toBeGreaterThan(0);
        }
      }
      if (scenario.mathSizingRendered) {
        const sizes = await frame.locator(".katex").first().evaluate((first) => {
          const root = first.ownerDocument;
          const fontSize = (el: Element): number => Number.parseFloat(getComputedStyle(el).fontSize);
          return {
            base: fontSize(first),
            sizing: Array.from(root.querySelectorAll(".katex .katex-sizing")).map(fontSize)
          };
        });

        expect(sizes.sizing.length, "存在 katex-sizing 元素").toBeGreaterThan(0);
        for (const [index, size] of sizes.sizing.entries()) {
          expect(size, `第 ${index + 1} 个缩放元素的字号应小于公式根字号 ${sizes.base}`).toBeLessThan(
            sizes.base
          );
        }
      }
      expect(errors).toEqual([]);
    });
  }

  test("恶意输入不会在页面或预览帧中执行脚本", async ({ page }) => {
    await openFixture(page, "security-xss.md");

    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    const frameHandle = await page.locator('iframe[title="文档内容预览"]').elementHandle();
    const frame = await frameHandle?.contentFrame();
    expect(await frame?.evaluate(() => window.__pwned)).toBeUndefined();
    // 限定在文档页内容内：预览帧自身的 HTML 外壳含有应用的 <script>，不属于文档内容。
    // 危险标签应被转义为文字，不应以元素形式存在于文档页中。
    await expect(
      previewFrame(page).locator(
        ".pagedjs_page script, .pagedjs_page iframe, .pagedjs_page object, .pagedjs_page embed"
      )
    ).toHaveCount(0);
    await expect(previewFrame(page).locator(".pagedjs_page").first()).toContainText(
      "正常段落必须保留。"
    );
  });
});

test.describe("表格分页接缝", () => {
  /**
   * 缺陷背景：Paged.js 内置过滤器会把带内联 style 的元素（如被稳定化的 table）标成
   * “不显示”，标题的 break-after: avoid 因此越过表格，落到表格之后的图表上；图表放不下时
   * 断点回退到整张表之前，表现为表格整体被推到下一页、续页留下空页、整张表从头重放。
   *
   * 缺陷与主题有关：GitHub 等主题自带 `tr { page-break-after: auto }`，最后一行会把
   * 表格之后元素的 data-previous-break-after 覆盖成 auto，恰好掩盖了问题；下面两个主题
   * 没有这条规则，缺陷会暴露。
   */
  const themeIds = ["formal-feasibility", "tender-classic"];

  async function openSeamFixture(page: Page, themeId: string): Promise<void> {
    await openFixture(page, "table-chart-seam.md");
    const renderedBeforeThemeChange = await renderedCount(page);
    await page.getByLabel("预览主题").selectOption(themeId);
    await waitForPreviewSettled(page, renderedBeforeThemeChange);
  }

  for (const themeId of themeIds) {
    // 直接断言因果机制，不依赖字体与页面几何：标题的“避免在其后分页”必须落在紧随其后的
    // 表格上，而不能越过表格落到图表上。该断言在缺陷存在时必然失败。
    test(`table-chart-seam.md 在 ${themeId} 主题下标题的 break-after 标记落在表格上`, async ({ page }) => {
      const errors = collectErrors(page);
      await openSeamFixture(page, themeId);

      const marks = await previewFrame(page)
        .locator(".pagedjs_page")
        .first()
        .evaluate((first) => {
          const refsWith = (selector: string) =>
            new Set(
              Array.from(first.ownerDocument.querySelectorAll<HTMLElement>(selector)).map(
                (element) => element.dataset.ref
              )
            ).size;
          return {
            tablesMarked: refsWith('table[data-previous-break-after="avoid"]'),
            figuresMarked: refsWith('figure[data-previous-break-after="avoid"]')
          };
        });

      // 夹具中每个小节都是“标题 → 表格 → 图表”，小节数取自夹具本身
      const sectionCount = readFileSync(
        resolve(fixtureDirectory, "table-chart-seam.md"),
        "utf8"
      )
        .split("\n")
        .filter((line) => line.startsWith("### ")).length;
      expect(sectionCount, "夹具应当有多个小节").toBeGreaterThan(5);
      expect(marks.tablesMarked, "带有标题 break-after 标记的表格数").toBe(sectionCount);
      expect(marks.figuresMarked, "越过表格被标记的图表数").toBe(0);
      expect(errors).toEqual([]);
    });

    // 兜底的结果断言：几何上能否命中缺陷取决于字体与页面尺寸，所以这组断言在缺陷存在时
    // 不一定失败，只用来守住最终输出的完整性。
    test(`table-chart-seam.md 在 ${themeId} 主题下没有重复行、空页和被推走的表格`, async ({ page }) => {
      const errors = collectErrors(page);
      await openSeamFixture(page, themeId);

      const report = await previewFrame(page)
        .locator(".pagedjs_page")
        .first()
        .evaluate((first) => {
          const doc = first.ownerDocument;
          const pages = Array.from(doc.querySelectorAll<HTMLElement>(".pagedjs_page"));
          const rowPages = new Map<string, number[]>();
          const blankPages: number[] = [];
          const pushedAwayHeadings: string[] = [];
          for (const [index, pageElement] of pages.entries()) {
            const area = pageElement.querySelector<HTMLElement>(".pagedjs_area");
            if (!area) continue;
            for (const row of Array.from(
              area.querySelectorAll<HTMLElement>(
                '[data-morphdoc-table-row-id][data-morphdoc-table-row-keep-whole="true"]'
              )
            )) {
              const id = row.dataset.morphdocTableRowId!;
              rowPages.set(id, [...(rowPages.get(id) ?? []), index + 1]);
            }
            const hasContent =
              (area.textContent ?? "").trim().length > 0 ||
              area.querySelector("img, svg, canvas") !== null;
            if (!hasContent) blankPages.push(index + 1);
            for (const heading of Array.from(area.querySelectorAll<HTMLElement>("h3"))) {
              // 标题之后再没有可见内容：它后面的表格被整体推到了下一页，或者只剩下
              // 一个被隐藏的空拆分表（表头放得下、首行放不下时 Paged.js 会这样断开）。
              let hasVisibleFollower = false;
              for (
                let next = heading.nextElementSibling;
                next;
                next = next.nextElementSibling
              ) {
                const box = next.getBoundingClientRect();
                if (getComputedStyle(next).display !== "none" && box.height > 0.5) {
                  hasVisibleFollower = true;
                  break;
                }
              }
              if (!hasVisibleFollower) {
                pushedAwayHeadings.push(`${heading.textContent?.trim()}@第${index + 1}页`);
              }
            }
          }
          return {
            pageCount: pages.length,
            rowCount: rowPages.size,
            duplicatedRows: Array.from(rowPages)
              .filter(([, list]) => list.length > 1)
              .map(([id, list]) => `${id}@${list.join(",")}`),
            blankPages,
            pushedAwayHeadings
          };
        });

      // 期望行数取自夹具本身（每个正文行以 | ` 开头）；不一致说明有行丢失或重复
      const expectedRows = readFileSync(
        resolve(fixtureDirectory, "table-chart-seam.md"),
        "utf8"
      )
        .split("\n")
        .filter((line) => line.startsWith("| `")).length;
      expect(report.rowCount, "表格正文行总数").toBe(expectedRows);
      expect(report.duplicatedRows, "重复出现的表格行").toEqual([]);
      expect(report.blankPages, "空白页").toEqual([]);
      expect(report.pushedAwayHeadings, "表格被整体推走而孤立的标题").toEqual([]);
      expect(report.pageCount, "夹具应跨多页，否则接缝场景没有被覆盖").toBeGreaterThan(8);
      expect(errors).toEqual([]);
    });
  }
});

test.describe("预览渲染（视觉基线，仅 Linux）", () => {
  test.skip(
    process.platform !== "linux",
    "视觉基线只在 Linux 上生成与比对，其他系统的字体栅格化不同"
  );
  // 预览滚动容器的可见高度 = 视口高度 - 211px。视口过矮时整页 A4（1123px）会被裁切，
  // 基线就只覆盖页面上半部分；1500px 时可见高度为 1289px，足以容纳完整的首页。
  test.use({ viewport: { width: 1440, height: 1500 } });

  for (const scenario of scenarios.filter(({ visual }) => visual)) {
    test(`${scenario.file} 首页与基线一致`, async ({ page }) => {
      await openFixture(page, scenario.file);

      await expect(previewFrame(page).locator(".pagedjs_page").first()).toHaveScreenshot(
        `${scenario.file.replace(/\.md$/u, "")}.png`
      );
    });
  }
});
