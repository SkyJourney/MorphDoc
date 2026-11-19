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
    expect: [{ selector: ".katex", atLeast: 3 }],
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

test.describe("预览渲染（视觉基线，仅 Linux）", () => {
  test.skip(
    process.platform !== "linux",
    "视觉基线只在 Linux 上生成与比对，其他系统的字体栅格化不同"
  );

  for (const scenario of scenarios.filter(({ visual }) => visual)) {
    test(`${scenario.file} 首页与基线一致`, async ({ page }) => {
      await openFixture(page, scenario.file);

      await expect(previewFrame(page).locator(".pagedjs_page").first()).toHaveScreenshot(
        `${scenario.file.replace(/\.md$/u, "")}.png`
      );
    });
  }
});
