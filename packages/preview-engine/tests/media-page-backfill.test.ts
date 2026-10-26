// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  applyMediaBackfillCandidates,
  calculateMediaBackfillScale,
  findMediaBackfillCandidates,
  getMediaBackfillIdsInDocumentOrder,
  prepareMediaBackfillBlocks
} from "../src/media-page-backfill.js";
import { getPrecedingMediaTitleHeight } from "../src/diagram-page-fit.js";

function rect(width: number, height: number) {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({})
  };
}

function positionedRect(
  top: number,
  width: number,
  height: number
) {
  return {
    ...rect(width, height),
    y: top,
    top,
    bottom: top + height
  };
}

describe("媒体分页空白回填", () => {
  it("全页适配时保留前置标题高度并避免标题孤行", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <h2 style="margin: 10px 0 12px">媒体标题</h2>
      <div class="mermaid"></div>
    `;
    const title = root.querySelector<HTMLElement>("h2")!;
    const block = root.querySelector<HTMLElement>(".mermaid")!;
    title.getBoundingClientRect = () =>
      positionedRect(100, 600, 40);

    expect(getPrecedingMediaTitleHeight(block)).toBe(40);
    expect(title.style.getPropertyValue("break-after")).toBe(
      "avoid-page"
    );
    expect(title.style.getPropertyPriority("break-after")).toBe(
      "important"
    );
  });

  it("按限宽后的基准高度计算额外缩放率", () => {
    expect(
      calculateMediaBackfillScale({
        remainingHeight: 420,
        fixedHeight: 30,
        baselineVisualHeight: 430
      })
    ).toBeCloseTo(388 / 430, 6);
  });

  it("缩小超过阈值或无需缩小时不回填", () => {
    expect(
      calculateMediaBackfillScale({
        remainingHeight: 300,
        fixedHeight: 30,
        baselineVisualHeight: 430
      })
    ).toBeUndefined();
    expect(
      calculateMediaBackfillScale({
        remainingHeight: 500,
        fixedHeight: 30,
        baselineVisualHeight: 430
      })
    ).toBeUndefined();
  });

  it("记录图片限宽后的实际基准尺寸", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <figure class="md-document-image-block">
        <img class="md-document-image">
        <figcaption>标题</figcaption>
      </figure>
    `;
    const image = root.querySelector("img")!;
    image.getBoundingClientRect = () => rect(640, 480);

    expect(prepareMediaBackfillBlocks(root)).toBe(1);
    const figure = root.querySelector<HTMLElement>("figure")!;
    expect(figure.dataset.mediaBackfillKind).toBe("image");
    expect(figure.dataset.mediaBaselineWidth).toBe("640");
    expect(figure.dataset.mediaBaselineHeight).toBe("480");
  });

  it("保持媒体元素在源文档中的串行处理顺序", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <figure data-media-backfill-id="media-2"></figure>
      <div><figure data-media-backfill-id="media-1"></figure></div>
      <figure></figure>
    `;

    expect(getMediaBackfillIdsInDocumentOrder(root)).toEqual([
      "media-2",
      "media-1"
    ]);
  });

  it("根据上一页剩余区域生成一次回填候选", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="pagedjs_page">
        <div class="pagedjs_page_content">
          <div
            class="pagedjs_page_content_flow"
            data-ref="previous-content"
          >上一页内容</div>
        </div>
      </div>
      <div class="pagedjs_page">
        <div class="pagedjs_page_content">
          <h2 data-ref="media-title">图片标题</h2>
          <figure
            class="md-document-image-block"
            data-media-backfill-id="media-1"
            data-media-baseline-width="600"
            data-media-baseline-height="400"
          >
            <img class="md-document-image">
          </figure>
        </div>
      </div>
    `;
    const pageContents = root.querySelectorAll<HTMLElement>(
      ".pagedjs_page_content"
    );
    const previousFlow =
      pageContents[0]!.firstElementChild as HTMLElement;
    const title = root.querySelector<HTMLElement>("h2")!;
    const block = root.querySelector<HTMLElement>("figure")!;
    const image = root.querySelector<HTMLImageElement>("img")!;
    pageContents[0]!.getBoundingClientRect = () =>
      positionedRect(100, 700, 1_000);
    previousFlow.getBoundingClientRect = () =>
      positionedRect(100, 700, 550);
    pageContents[1]!.getBoundingClientRect = () =>
      positionedRect(100, 700, 1_000);
    title.getBoundingClientRect = () =>
      positionedRect(100, 600, 40);
    block.getBoundingClientRect = () =>
      positionedRect(150, 600, 330);
    image.getBoundingClientRect = () =>
      positionedRect(150, 600, 300);

    expect(findMediaBackfillCandidates(root)).toEqual([
      { id: "media-1", scale: 0.92 }
    ]);
  });

  it("显式分页的媒体块不会回填到上一页", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="pagedjs_page">
        <div class="pagedjs_page_content"></div>
      </div>
      <div class="pagedjs_page">
        <div class="pagedjs_page_content">
          <h2 data-ref="media-title" style="break-before: page">
            图片标题
          </h2>
          <figure
            class="md-document-image-block"
            data-ref="media-block"
            data-media-backfill-id="media-1"
            data-media-baseline-width="600"
            data-media-baseline-height="400"
          >
            <img class="md-document-image">
          </figure>
        </div>
      </div>
    `;
    const pageContents = root.querySelectorAll<HTMLElement>(
      ".pagedjs_page_content"
    );
    const title = root.querySelector<HTMLElement>("h2")!;
    const block = root.querySelector<HTMLElement>("figure")!;
    const image = root.querySelector<HTMLImageElement>("img")!;
    pageContents[0]!.getBoundingClientRect = () =>
      positionedRect(100, 700, 1_000);
    pageContents[1]!.getBoundingClientRect = () =>
      positionedRect(100, 700, 1_000);
    title.getBoundingClientRect = () =>
      positionedRect(100, 600, 40);
    block.getBoundingClientRect = () =>
      positionedRect(150, 600, 330);
    image.getBoundingClientRect = () =>
      positionedRect(150, 600, 300);

    expect(findMediaBackfillCandidates(root)).toEqual([]);
  });

  it("忽略媒体之前其他内容的显式分页规则", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="pagedjs_page">
        <div class="pagedjs_page_content">
          <div data-ref="previous-content">上一页内容</div>
        </div>
      </div>
      <div class="pagedjs_page">
        <div class="pagedjs_page_content">
          <h1 data-ref="earlier-heading" style="break-before: page">
            本页章节
          </h1>
          <h2 data-ref="media-title">图片标题</h2>
          <figure
            class="md-document-image-block"
            data-ref="media-block"
            data-media-backfill-id="media-1"
            data-media-baseline-width="600"
            data-media-baseline-height="400"
          >
            <img class="md-document-image">
          </figure>
        </div>
      </div>
    `;
    const pageContents = root.querySelectorAll<HTMLElement>(
      ".pagedjs_page_content"
    );
    const previousFlow = root.querySelector<HTMLElement>(
      "[data-ref='previous-content']"
    )!;
    const earlierHeading = root.querySelector<HTMLElement>("h1")!;
    const title = root.querySelector<HTMLElement>("h2")!;
    const block = root.querySelector<HTMLElement>("figure")!;
    const image = root.querySelector<HTMLImageElement>("img")!;
    pageContents[0]!.getBoundingClientRect = () =>
      positionedRect(100, 700, 1_000);
    previousFlow.getBoundingClientRect = () =>
      positionedRect(100, 700, 550);
    pageContents[1]!.getBoundingClientRect = () =>
      positionedRect(100, 700, 1_000);
    earlierHeading.getBoundingClientRect = () =>
      positionedRect(100, 600, 40);
    title.getBoundingClientRect = () =>
      positionedRect(150, 600, 40);
    block.getBoundingClientRect = () =>
      positionedRect(200, 600, 330);
    image.getBoundingClientRect = () =>
      positionedRect(200, 600, 300);

    expect(findMediaBackfillCandidates(root)).toEqual([
      { id: "media-1", scale: 0.92 }
    ]);
  });

  it("将候选缩放应用到图片和 ECharts 主体", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <h2>图片标题保持原尺寸</h2>
      <figure
        class="md-document-image-block"
        data-media-backfill-id="media-1"
        data-media-backfill-kind="image"
        data-media-baseline-width="800"
        data-media-baseline-height="600"
      >
        <img class="md-document-image">
      </figure>
      <figure
        class="md-echarts"
        data-media-backfill-id="media-2"
        data-media-backfill-kind="echarts"
        data-media-baseline-width="700"
        data-media-baseline-height="500"
      >
        <div class="md-echarts-host"><svg></svg></div>
      </figure>
      <div
        class="mermaid"
        data-media-backfill-id="media-3"
        data-media-backfill-kind="mermaid"
        data-media-baseline-width="600"
        data-media-baseline-height="400"
      >
        <svg></svg>
      </div>
    `;

    expect(
      applyMediaBackfillCandidates(root, [
        { id: "media-1", scale: 0.9 },
        { id: "media-2", scale: 0.88 },
        { id: "media-3", scale: 0.9 }
      ])
    ).toBe(3);
    const title = root.querySelector<HTMLElement>("h2")!;
    const image = root.querySelector<HTMLImageElement>(
      "img.md-document-image"
    )!;
    const host = root.querySelector<HTMLElement>(".md-echarts-host")!;
    const svg = root.querySelector<SVGSVGElement>("svg")!;
    const mermaidSvg = root.querySelector<SVGSVGElement>(
      ".mermaid svg"
    )!;
    expect(title.getAttribute("style")).toBeNull();
    expect(image.style.width).toBe("720px");
    expect(image.style.height).toBe("540px");
    expect(host.style.width).toBe("616px");
    expect(host.style.height).toBe("440px");
    expect(svg.style.width).toBe("616px");
    expect(svg.style.height).toBe("440px");
    expect(mermaidSvg.style.width).toBe("540px");
    expect(mermaidSvg.style.height).toBe("360px");
  });
});
