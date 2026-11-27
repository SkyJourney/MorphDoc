// @vitest-environment happy-dom

import { defaultExportConfig } from "@morphdoc/core";
import { describe, expect, it } from "vitest";
import { fitOversizedMermaidToPage } from "../src/mermaid-page-fit.js";

/**
 * `fitOversizedMermaidToPage` 此前没有任何直接测试。Mermaid 与 ECharts 共用
 * `fitSvgDiagramsToPage`，这里单独覆盖 Mermaid 入口的缩放行为与幂等性。
 *
 * 分页行为（缩放后的图之后内容是否落到下一页）依赖真实的 Paged.js，由
 * e2e/tests/media-fit.spec.ts 在真实浏览器里验证，不在这里断言。
 */
function mermaidRoot(viewBox: string) {
  const root = document.createElement("div");
  root.innerHTML =
    `<div class="mermaid"><svg viewBox="${viewBox}"></svg></div>` +
    "<p>紧随其后的正文</p>";
  return root;
}

describe("Mermaid 单页适配", () => {
  it("超高图缩放到整页内容区之内，并标记为已适配", () => {
    const root = mermaidRoot("0 0 1000 3000");
    const container = root.querySelector<HTMLElement>(".mermaid")!;
    const svg = root.querySelector("svg")!;

    fitOversizedMermaidToPage(root, defaultExportConfig);

    expect(container.dataset.pageHeightFitted).toBe("true");
    expect(container.style.getPropertyValue("margin-block")).toBe("0");
    const height = Number.parseFloat(svg.style.height);
    const width = Number.parseFloat(svg.style.width);
    // 默认配置的页面内容区约 1001px 高：缩放后略小于它，且保持 1:3 的宽高比
    expect(height).toBeGreaterThan(900);
    expect(height).toBeLessThan(1002);
    expect(width / height).toBeCloseTo(1000 / 3000, 3);
    expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
  });

  it("没有超高的图保持普通布局，不做任何标记", () => {
    const root = mermaidRoot("0 0 1000 400");
    const container = root.querySelector<HTMLElement>(".mermaid")!;
    const svg = root.querySelector("svg")!;

    fitOversizedMermaidToPage(root, defaultExportConfig);

    expect(container.dataset.pageHeightFitted).toBeUndefined();
    expect(svg.style.height).toBe("");
  });

  it("重复适配是幂等的：结果逐字相同，后续正文不受影响", () => {
    const root = mermaidRoot("0 0 1000 3000");

    fitOversizedMermaidToPage(root, defaultExportConfig);
    const once = root.innerHTML;
    fitOversizedMermaidToPage(root, defaultExportConfig);

    expect(root.innerHTML).toBe(once);
    expect(root.querySelector("p")!.getAttribute("style")).toBeNull();
  });

  it("多张图各自独立判定：超高的缩放，不超高的保持原样", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="mermaid"><svg viewBox="0 0 1000 3000"></svg></div>' +
      '<div class="mermaid"><svg viewBox="0 0 1000 300"></svg></div>' +
      '<div class="mermaid"><svg viewBox="0 0 800 4000"></svg></div>';
    const containers = Array.from(root.querySelectorAll<HTMLElement>(".mermaid"));

    fitOversizedMermaidToPage(root, defaultExportConfig);

    expect(containers.map((container) => container.dataset.pageHeightFitted)).toEqual([
      "true",
      undefined,
      "true"
    ]);
  });

  it("没有 viewBox 也没有尺寸属性的图无法判断是否超高，原样保留", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="mermaid"><svg></svg></div>';
    const container = root.querySelector<HTMLElement>(".mermaid")!;

    fitOversizedMermaidToPage(root, defaultExportConfig);

    expect(container.dataset.pageHeightFitted).toBeUndefined();
  });

  it("没有 SVG 的 Mermaid 容器（渲染失败的占位）被跳过", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="mermaid"><pre>语法错误</pre></div>';

    expect(() => fitOversizedMermaidToPage(root, defaultExportConfig)).not.toThrow();
    expect(
      root.querySelector<HTMLElement>(".mermaid")!.dataset.pageHeightFitted
    ).toBeUndefined();
  });
});
