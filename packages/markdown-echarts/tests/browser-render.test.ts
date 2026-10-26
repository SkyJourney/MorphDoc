// @vitest-environment happy-dom

import MarkdownIt from "markdown-it";
import { describe, expect, it, vi } from "vitest";
import {
  markdownItECharts
} from "../src/index.js";
import {
  disposeEChartsBlocks,
  renderEChartsBlocks,
  type EChartsEngine,
  type EChartsInstanceLike
} from "../src/browser.js";

function createDocumentWithChart() {
  const markdown = new MarkdownIt().use(markdownItECharts);
  document.body.innerHTML = markdown.render(`
\`\`\`echarts
version: 1
height: 80mm
caption: 测试图表
option:
  xAxis:
    type: category
    data: [A, B]
  yAxis:
    type: value
  series:
    - type: bar
      data: [1, 2]
\`\`\`
`);
}

function fakeEngine(
  configureSvg?: (svg: SVGSVGElement) => void
) {
  const dispose = vi.fn();
  const resize = vi.fn();
  const setOption = vi.fn();
  const init = vi.fn(
    (container: HTMLElement): EChartsInstanceLike => {
      dispose.mockImplementation(() => container.replaceChildren());
      const handlers = new Map<string, () => void>();
      return {
        setOption(option, setOptionOptions) {
          setOption(option, setOptionOptions);
          const svg = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg"
          );
          svg.setAttribute("viewBox", "0 0 400 300");
          const text = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "text"
          );
          text.textContent = "测试图表";
          svg.append(text);
          configureSvg?.(svg);
          container.replaceChildren(svg);
          handlers.get("finished")?.();
        },
        on(eventName, handler) {
          handlers.set(eventName, handler);
        },
        off(eventName) {
          handlers.delete(eventName);
        },
        resize,
        dispose
      };
    }
  );
  return {
    engine: { init } satisfies EChartsEngine,
    init,
    dispose,
    resize,
    setOption
  };
}

describe("浏览器 ECharts 渲染", () => {
  it("生成安全的内联 SVG 并释放实例", async () => {
    createDocumentWithChart();
    const { engine, init, dispose } = fakeEngine();

    const outcomes = await renderEChartsBlocks(document, {
      engine,
      outputMode: "inline-svg"
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.success).toBe(true);
    expect(init).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      undefined,
      expect.objectContaining({ renderer: "svg" })
    );
    expect(document.querySelector(".md-echarts-host svg")).not.toBeNull();
    expect(dispose).toHaveBeenCalledOnce();
    expect(
      document.querySelector(".md-echarts")?.getAttribute(
        "data-echarts-pending"
      )
    ).toBeNull();
  });

  it("全局及系列级动画始终关闭", async () => {
    createDocumentWithChart();
    const { engine, setOption } = fakeEngine();

    await renderEChartsBlocks(document, {
      engine,
      outputMode: "interactive"
    });

    expect(setOption).toHaveBeenCalledWith(
      expect.objectContaining({
        animation: false,
        animationDelay: 0,
        animationDelayUpdate: 0,
        animationDuration: 0,
        animationDurationUpdate: 0,
        series: [
          expect.objectContaining({
            animation: false,
            animationDelay: 0,
            animationDelayUpdate: 0,
            animationDuration: 0,
            animationDurationUpdate: 0
          })
        ]
      }),
      { notMerge: true }
    );
  });

  it("生成 SVG Data URL 图片", async () => {
    createDocumentWithChart();
    const { engine } = fakeEngine();

    const outcomes = await renderEChartsBlocks(document, {
      engine,
      outputMode: "svg-image"
    });

    expect(outcomes[0]?.success).toBe(true);
    const image = document.querySelector<HTMLImageElement>(
      ".md-echarts-svg-image"
    );
    expect(image?.src).toMatch(/^data:image\/svg\+xml/u);
    expect(image?.alt).toBe("测试图表");
  });

  it("交互模式保留实例并支持统一销毁", async () => {
    createDocumentWithChart();
    const { engine, dispose } = fakeEngine();

    const outcomes = await renderEChartsBlocks(document, {
      engine,
      outputMode: "interactive"
    });

    expect(outcomes[0]?.instance).toBeDefined();
    expect(dispose).not.toHaveBeenCalled();
    disposeEChartsBlocks(document);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("拒绝渲染器产生的外部 SVG 资源", async () => {
    createDocumentWithChart();
    const onError = vi.fn();
    const { engine } = fakeEngine((svg) => {
      const image = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "image"
      );
      image.setAttribute("href", "https://example.com/chart.png");
      svg.append(image);
    });

    const outcomes = await renderEChartsBlocks(document, {
      engine,
      outputMode: "inline-svg",
      onError
    });

    expect(outcomes[0]?.success).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
    expect(document.querySelector(".md-echarts-error")).not.toBeNull();
    expect(document.body.textContent).toContain("外部 SVG 链接");
  });
});
