// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { constrainSemanticCoversToPage } from "../src/semantic-cover-fit.js";

function createCover(height: number) {
  const root = document.createElement("div");
  root.innerHTML = `
    <header
      data-semantic-region="cover"
      data-semantic-break-after="next-page"
    >封面</header>
  `;
  const cover = root.querySelector<HTMLElement>("header")!;
  cover.getBoundingClientRect = () =>
    ({ height } as DOMRect);
  document.body.append(root);
  return { root, cover };
}

describe("语义封面页面适配", () => {
  it("只将超过横向页面内容区的封面收束为单页高度", () => {
    const { root, cover } = createCover(900);
    cover.style.display = "flex";
    cover.style.flexDirection = "column";
    cover.style.alignItems = "center";
    cover.style.justifyContent = "center";

    expect(constrainSemanticCoversToPage(root, 680)).toBe(1);
    expect(cover.style.boxSizing).toBe("border-box");
    expect(cover.style.height).toBe("672px");
    expect(cover.style.minHeight).toBe("672px");
    expect(cover.style.maxHeight).toBe("672px");
    expect(cover.style.overflow).toBe("hidden");
    expect(cover.style.display).toBe("block");
    expect(cover.style.getPropertyValue("break-inside")).toBe("auto");
    expect(cover.style.getPropertyPriority("break-inside")).toBe("important");
    expect(cover.dataset.semanticCoverFit).toBe("constrained");
    expect(cover.dataset.semanticCoverPageBreak).toBe("natural");
    expect(cover.hasAttribute("data-semantic-break-after")).toBe(false);
    const anchor = cover.nextElementSibling as HTMLElement | null;
    expect(anchor?.dataset.semanticCoverPageBreakAnchor).toBe("true");
    expect(anchor?.style.height).toBe("0px");
    expect(anchor?.style.getPropertyValue("break-after")).toBe("page");
    expect(anchor?.style.getPropertyPriority("break-after")).toBe(
      "important"
    );
    const layout = cover.querySelector<HTMLElement>(
      '[data-semantic-cover-layout="flex"]'
    );
    expect(layout?.style.display).toBe("flex");
    expect(layout?.style.flexDirection).toBe("column");
    expect(layout?.style.alignItems).toBe("center");
    expect(layout?.style.justifyContent).toBe("center");
  });

  it("纵向页面可以容纳主题封面时保持主题原始高度", () => {
    const { root, cover } = createCover(680);

    expect(constrainSemanticCoversToPage(root, 900)).toBe(0);
    expect(cover.getAttribute("style")).toBeNull();
    expect(cover.dataset.semanticCoverFit).toBeUndefined();
  });

  it("横向页面按同一比例压缩封面子元素纵向间距", () => {
    const { root, cover } = createCover(900);
    cover.style.display = "flex";
    cover.style.flexDirection = "column";
    cover.innerHTML = `
      <p style="margin-top: 50px; margin-bottom: 50px">标题</p>
      <p style="margin-top: 50px; margin-bottom: 50px">日期</p>
    `;
    for (const child of Array.from(cover.children)) {
      Object.defineProperty(child, "getBoundingClientRect", {
        value: () => ({ height: 100 } as DOMRect),
      });
    }

    expect(constrainSemanticCoversToPage(root, 300)).toBe(1);
    expect(cover.dataset.semanticCoverSpacingScale).toBe("0.460000");
    const layout = cover.querySelector<HTMLElement>(
      '[data-semantic-cover-layout="flex"]'
    )!;
    for (const child of Array.from(layout.children)) {
      expect((child as HTMLElement).style.marginTop).toBe("23px");
      expect((child as HTMLElement).style.marginBottom).toBe("23px");
    }
  });
});
