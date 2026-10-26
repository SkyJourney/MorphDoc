// @vitest-environment happy-dom

import { defaultExportConfig } from "@morphdoc/core";
import { describe, expect, it } from "vitest";
import { fitOversizedEChartsToPage } from "../src/echarts-page-fit.js";

describe("ECharts 单页高度适配", () => {
  it("将超高 SVG 和宿主同步缩放到单页内容区", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <h2 style="margin: 10px 0">大型图表</h2>
      <figure class="md-echarts">
        <div class="md-echarts-host" style="height: 2000px">
          <svg width="1000" height="2000"></svg>
        </div>
      </figure>
    `;

    const figure = root.querySelector<HTMLElement>(".md-echarts");
    const title = root.querySelector<HTMLElement>("h2");
    const host = root.querySelector<HTMLElement>(
      ".md-echarts-host"
    );
    const svg = root.querySelector<SVGSVGElement>("svg");
    if (title) {
      title.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 700,
        bottom: 40,
        width: 700,
        height: 40,
        toJSON: () => ({})
      });
    }
    fitOversizedEChartsToPage(root, defaultExportConfig);

    expect(figure?.dataset.pageHeightFitted).toBe("true");
    expect(title?.style.breakAfter).toBe("avoid-page");
    expect(figure?.style.breakAfter).toBe("page");
    expect(figure?.style.pageBreakAfter).toBe("always");
    expect(figure?.nextElementSibling).toHaveProperty(
      "dataset.mediaPageBreak",
      "true"
    );
    expect(Number.parseFloat(host?.style.height ?? "0")).toBeCloseTo(
      960.5748,
      3
    );
    expect(host?.style.aspectRatio).toBe("");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 1000 2000");
    expect(Number.parseFloat(svg?.style.height ?? "0")).toBeCloseTo(
      960.5748,
      3
    );
  });

  it("普通高度图表不改变作者设置的宿主高度", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <figure class="md-echarts">
        <div class="md-echarts-host" style="height: 300px">
          <svg viewBox="0 0 1000 400"></svg>
        </div>
      </figure>
    `;

    fitOversizedEChartsToPage(root, defaultExportConfig);

    const figure = root.querySelector<HTMLElement>(".md-echarts");
    const host = root.querySelector<HTMLElement>(
      ".md-echarts-host"
    );
    expect(figure?.dataset.pageHeightFitted).toBeUndefined();
    expect(host?.style.height).toBe("300px");
  });
});
