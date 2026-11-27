// @vitest-environment happy-dom

import { defaultExportConfig } from "@morphdoc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPrecedingHeadingChain,
  getPrecedingMediaTitleHeight
} from "../src/diagram-page-fit.js";
import { fitOversizedEChartsToPage } from "../src/echarts-page-fit.js";
import { findMediaBackfillCandidates } from "../src/media-page-backfill.js";

function box(top: number, height: number, width = 600) {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({})
  } as DOMRect;
}

/** 给元素指定尺寸与外边距：外边距用长写属性，happy-dom 能解析它们。 */
function sized(
  element: HTMLElement,
  options: { top: number; height: number; marginTop?: number; marginBottom?: number }
) {
  element.style.marginTop = `${options.marginTop ?? 0}px`;
  element.style.marginBottom = `${options.marginBottom ?? 0}px`;
  element.getBoundingClientRect = () => box(options.top, options.height);
}

/**
 * 构造测试结构并挂到文档上：happy-dom 只对已挂载的元素计算样式，
 * 不挂载就读不到外边距，高度相关的断言会悄悄少算。
 */
function structure(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("媒体块之前的连续标题", () => {
  it("前一个兄弟不是标题时，没有连续标题", () => {
    const root = structure("<h2>标题</h2><p>段落</p><div class='media'></div>");

    expect(getPrecedingHeadingChain(root.querySelector(".media")!)).toEqual([]);
  });

  it("按文档顺序返回紧邻的连续标题，遇到非标题就停止", () => {
    const root = structure(
      "<h1>更早的标题</h1><p>隔开的段落</p><h2>章</h2><h3>节</h3><h4>小节</h4><div class='media'></div>"
    );

    expect(
      getPrecedingHeadingChain(root.querySelector(".media")!).map((title) => title.tagName)
    ).toEqual(["H2", "H3", "H4"]);
  });

  it("文档开头的媒体块没有前一个兄弟，返回空数组", () => {
    const root = structure("<div class='media'></div>");

    expect(getPrecedingHeadingChain(root.firstElementChild!)).toEqual([]);
  });
});

describe("媒体块之前整串标题占用的高度", () => {
  it("没有标题时为 0", () => {
    const root = structure("<p>段落</p><div class='media'></div>");

    expect(getPrecedingMediaTitleHeight(root.querySelector(".media") as HTMLElement)).toBe(0);
  });

  it("只有一个标题时：高度加上下外边距，与此前的算法完全相同", () => {
    const root = structure("<h2>标题</h2><div class='media'></div>");
    sized(root.querySelector("h2")!, { top: 0, height: 40, marginTop: 10, marginBottom: 12 });

    expect(getPrecedingMediaTitleHeight(root.querySelector(".media") as HTMLElement)).toBe(62);
  });

  it("多个连续标题：各自高度相加，相邻外边距折叠只计较大者，最外侧外边距照常计入", () => {
    const root = structure("<h2>章</h2><h3>节</h3><div class='media'></div>");
    sized(root.querySelector("h2")!, { top: 0, height: 30, marginTop: 20, marginBottom: 10 });
    sized(root.querySelector("h3")!, { top: 60, height: 28, marginTop: 14, marginBottom: 12 });

    // 20（章的上外边距）+ 30 + max(10, 14) + 28 + 12（节的下外边距）
    expect(getPrecedingMediaTitleHeight(root.querySelector(".media") as HTMLElement)).toBe(104);
  });

  it("三个连续标题同样逐个计入", () => {
    const root = structure("<h2>章</h2><h3>节</h3><h4>小节</h4><div class='media'></div>");
    sized(root.querySelector("h2")!, { top: 0, height: 30, marginTop: 5, marginBottom: 5 });
    sized(root.querySelector("h3")!, { top: 40, height: 20, marginTop: 5, marginBottom: 5 });
    sized(root.querySelector("h4")!, { top: 70, height: 10, marginTop: 5, marginBottom: 5 });

    // 5 + 30 + 5 + 20 + 5 + 10 + 5
    expect(getPrecedingMediaTitleHeight(root.querySelector(".media") as HTMLElement)).toBe(80);
  });

  it("被段落隔开的更早标题不计入", () => {
    const root = structure("<h1>更早</h1><p>段落</p><h2>紧邻</h2><div class='media'></div>");
    sized(root.querySelector("h1")!, { top: 0, height: 99 });
    sized(root.querySelector("h2")!, { top: 200, height: 40 });

    expect(getPrecedingMediaTitleHeight(root.querySelector(".media") as HTMLElement)).toBe(40);
  });

  it("每个标题都被标记为与后面内容同页", () => {
    const root = structure("<h2>章</h2><h3>节</h3><div class='media'></div>");
    for (const title of Array.from(root.querySelectorAll("h2, h3"))) {
      (title as HTMLElement).getBoundingClientRect = () => box(0, 10);
    }

    getPrecedingMediaTitleHeight(root.querySelector(".media") as HTMLElement);

    for (const title of Array.from(root.querySelectorAll<HTMLElement>("h2, h3"))) {
      expect(title.style.getPropertyValue("break-after")).toBe("avoid-page");
    }
  });
});

describe("整页缩放要为整串连续标题留出高度", () => {
  function chartAfter(headings: Array<{ tag: string; height: number }>) {
    const root = document.createElement("div");
    root.innerHTML =
      headings.map((heading) => `<${heading.tag}>标题</${heading.tag}>`).join("") +
      '<figure class="md-echarts"><div class="md-echarts-host" style="height: 2000px">' +
      '<svg width="1000" height="2000"></svg></div></figure>';
    for (const [index, heading] of headings.entries()) {
      sized(root.querySelectorAll<HTMLElement>("h1, h2, h3, h4")[index]!, {
        top: index * 50,
        height: heading.height
      });
    }
    const figure = root.querySelector<HTMLElement>(".md-echarts")!;
    const host = root.querySelector<HTMLElement>(".md-echarts-host")!;
    figure.getBoundingClientRect = () => box(300, 2000);
    host.getBoundingClientRect = () => box(300, 2000);
    fitOversizedEChartsToPage(root, defaultExportConfig);
    return Number.parseFloat(host.style.height);
  }

  it("一个标题：从页面内容区扣除它的高度", () => {
    expect(chartAfter([{ tag: "h3", height: 40 }])).toBeCloseTo(1000.5748 - 40, 3);
  });

  it("章标题紧跟节标题：两个标题的高度都要扣除，否则三者合起来比一页还高", () => {
    // 这正是此前的缺陷：只扣除紧邻的 h3，h2 的高度被漏掉，Paged.js 放不下整串内容，
    // 报 “Unable to layout item” 并把图表重复渲染
    expect(
      chartAfter([
        { tag: "h2", height: 30 },
        { tag: "h3", height: 40 }
      ])
    ).toBeCloseTo(1000.5748 - 70, 3);
  });

  it("三个连续标题同样全部扣除", () => {
    expect(
      chartAfter([
        { tag: "h2", height: 30 },
        { tag: "h3", height: 40 },
        { tag: "h4", height: 20 }
      ])
    ).toBeCloseTo(1000.5748 - 90, 3);
  });
});

describe("回填把整串连续标题当作媒体组的一部分", () => {
  /**
   * 几何沿用 media-page-backfill 的既有用例：上一页剩余 450px，图基线高度 400。
   * 只有一个标题时媒体组的固定高度是 80，缩放率 0.92；
   * 再多一个紧挨着的标题，固定高度涨到 130，缩放率低于下限，候选应当消失。
   */
  function groupWith(extraHeading: boolean) {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="pagedjs_page"><div class="pagedjs_page_content">
        <div data-ref="previous-content">上一页内容</div>
      </div></div>
      <div class="pagedjs_page"><div class="pagedjs_page_content">
        ${extraHeading ? "<h1>更靠前的标题</h1>" : ""}
        <h2>图片标题</h2>
        <figure class="md-document-image-block" data-ref="media-block"
          data-media-backfill-id="media-1"
          data-media-baseline-width="600" data-media-baseline-height="400">
          <img class="md-document-image">
        </figure>
      </div></div>`;
    const contents = root.querySelectorAll<HTMLElement>(".pagedjs_page_content");
    contents[0]!.getBoundingClientRect = () => box(100, 1000, 700);
    root.querySelector<HTMLElement>("[data-ref='previous-content']")!.getBoundingClientRect =
      () => box(100, 550, 700);
    contents[1]!.getBoundingClientRect = () => box(100, 1000, 700);
    if (extraHeading) {
      root.querySelector<HTMLElement>("h1")!.getBoundingClientRect = () => box(100, 40);
    }
    root.querySelector<HTMLElement>("h2")!.getBoundingClientRect = () => box(150, 40);
    root.querySelector<HTMLElement>("figure")!.getBoundingClientRect = () => box(200, 330);
    root.querySelector<HTMLElement>("img")!.getBoundingClientRect = () => box(200, 300);
    return root;
  }

  it("一个标题：按既有行为产生候选", () => {
    expect(findMediaBackfillCandidates(groupWith(false))).toEqual([
      { id: "media-1", scale: 0.92 }
    ]);
  });

  it("两个连续标题：组的固定高度包含两个标题，放不下就不回填", () => {
    expect(findMediaBackfillCandidates(groupWith(true))).toEqual([]);
  });
});

describe("回填的强制换页判定要看整串连续标题", () => {
  /**
   * happy-dom 读不到内联的 break-before，所以用桩让带 data-force-before 的元素返回
   * `breakBefore: "page"`，其余属性照常。几何刻意让“不强制时候选存在”：第一个标题的
   * 顶部与第二个标题重合、高度几乎为零，媒体组的固定高度与只有一个标题时相同（80），
   * 缩放率 0.92。这样候选是否消失只取决于强制换页判定，而不是固定高度变大。
   */
  function groupWithForcedFirstHeading(forced: boolean) {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="pagedjs_page"><div class="pagedjs_page_content">
        <div data-ref="previous-content">上一页内容</div>
      </div></div>
      <div class="pagedjs_page"><div class="pagedjs_page_content">
        <h1 ${forced ? 'data-force-before="true"' : ""}>章标题</h1>
        <h2>图片标题</h2>
        <figure class="md-document-image-block" data-ref="media-block"
          data-media-backfill-id="media-1"
          data-media-baseline-width="600" data-media-baseline-height="400">
          <img class="md-document-image">
        </figure>
      </div></div>`;
    document.body.append(root);
    const contents = root.querySelectorAll<HTMLElement>(".pagedjs_page_content");
    contents[0]!.getBoundingClientRect = () => box(100, 1000, 700);
    root.querySelector<HTMLElement>("[data-ref='previous-content']")!.getBoundingClientRect =
      () => box(100, 550, 700);
    contents[1]!.getBoundingClientRect = () => box(100, 1000, 700);
    root.querySelector<HTMLElement>("h1")!.getBoundingClientRect = () => box(150, 0.5);
    root.querySelector<HTMLElement>("h2")!.getBoundingClientRect = () => box(150, 40);
    root.querySelector<HTMLElement>("figure")!.getBoundingClientRect = () => box(200, 330);
    root.querySelector<HTMLElement>("img")!.getBoundingClientRect = () => box(200, 300);

    const original = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
      const style = original(element, pseudo);
      if (!(element instanceof HTMLElement) || element.dataset.forceBefore !== "true") {
        return style;
      }
      return new Proxy(style, {
        get: (target, property) =>
          property === "breakBefore" ? "page" : Reflect.get(target, property)
      });
    });
    return root;
  }

  it("对照：没有强制换页时，几何允许回填，产生候选", () => {
    expect(findMediaBackfillCandidates(groupWithForcedFirstHeading(false))).toEqual([
      { id: "media-1", scale: 0.92 }
    ]);
  });

  it("连续标题中靠前的那个声明了之前换页：整个媒体组只能从新页开始，不回填", () => {
    expect(findMediaBackfillCandidates(groupWithForcedFirstHeading(true))).toEqual([]);
  });
});
