// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  INLINE_STYLE_STASH_ATTRIBUTE,
  restoreStashedInlineStyles,
  stashInlineStylesForPaged
} from "../src/paged-inline-style-guard.js";

function createRoot(html: string) {
  const root = document.createElement("article");
  root.innerHTML = html;
  return root;
}

describe("Paged.js 内联样式防误判", () => {
  it("暂存后元素不再带 style 属性，原值记录在暂存属性中", () => {
    const root = createRoot(
      '<table style="table-layout: fixed"><tbody><tr>' +
        '<td style="width: 10px">单元格</td></tr></tbody></table>'
    );

    const stashed = stashInlineStylesForPaged(root);

    const table = root.querySelector("table")!;
    const cell = root.querySelector("td")!;
    expect(stashed).toBe(2);
    expect(table.hasAttribute("style")).toBe(false);
    expect(cell.hasAttribute("style")).toBe(false);
    expect(table.getAttribute(INLINE_STYLE_STASH_ATTRIBUTE)).toBe(
      "table-layout: fixed"
    );
    expect(cell.getAttribute(INLINE_STYLE_STASH_ATTRIBUTE)).toBe(
      "width: 10px"
    );
  });

  it("还原后样式与暂存前逐字一致，暂存属性被清除", () => {
    const html =
      '<figure style="margin: 0 !important; break-inside: avoid">图</figure>' +
      '<div style="">空样式</div>';
    const root = createRoot(html);
    const before = Array.from(root.querySelectorAll("[style]")).map(
      (element) => element.getAttribute("style")
    );

    stashInlineStylesForPaged(root);
    const restored = restoreStashedInlineStyles(root);

    const after = Array.from(root.querySelectorAll("[style]")).map(
      (element) => element.getAttribute("style")
    );
    expect(restored).toBe(2);
    expect(after).toEqual(before);
    expect(
      root.querySelector(`[${INLINE_STYLE_STASH_ATTRIBUTE}]`)
    ).toBeNull();
  });

  it("内联 display:none 的元素保持原样，继续交给内置过滤器标记", () => {
    const root = createRoot(
      '<p style="display: none">隐藏</p><p style="color: red">可见</p>'
    );

    const stashed = stashInlineStylesForPaged(root);

    const [hidden, visible] = Array.from(root.querySelectorAll("p"));
    expect(stashed).toBe(1);
    expect(hidden!.getAttribute("style")).toBe("display: none");
    expect(hidden!.hasAttribute(INLINE_STYLE_STASH_ATTRIBUTE)).toBe(false);
    expect(visible!.hasAttribute("style")).toBe(false);
  });

  it("没有内联样式的元素不受影响", () => {
    const root = createRoot("<p>普通段落</p><table><tbody></tbody></table>");

    expect(stashInlineStylesForPaged(root)).toBe(0);
    expect(restoreStashedInlineStyles(root)).toBe(0);
    expect(root.querySelector("p")!.attributes.length).toBe(0);
  });

  it("重复暂存是幂等的，不会丢失上一轮异常中断残留的样式", () => {
    const root = createRoot('<div style="padding: 4px">内容</div>');

    stashInlineStylesForPaged(root);
    // 模拟分页中途失败：还原步骤没有执行，再次开始新一轮分页
    stashInlineStylesForPaged(root);
    restoreStashedInlineStyles(root);

    expect(root.querySelector("div")!.getAttribute("style")).toBe(
      "padding: 4px"
    );
  });

  it("嵌套元素的样式各自独立暂存与还原", () => {
    const root = createRoot(
      '<div style="margin: 1px"><span style="color: blue">文本</span></div>'
    );

    stashInlineStylesForPaged(root);
    restoreStashedInlineStyles(root);

    expect(root.querySelector("div")!.getAttribute("style")).toBe(
      "margin: 1px"
    );
    expect(root.querySelector("span")!.getAttribute("style")).toBe(
      "color: blue"
    );
  });
});
