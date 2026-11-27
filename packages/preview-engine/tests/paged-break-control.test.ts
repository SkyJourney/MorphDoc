// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  FORCE_BREAK_AFTER_ATTRIBUTE,
  FORCE_BREAK_BEFORE_ATTRIBUTE,
  clearForcedBreak,
  forceBreakAfter,
  forceBreakBefore,
  hasForcedBreak,
  pagedBreakControlCss
} from "../src/paged-break-control.js";

describe("分页意图", () => {
  it("forceBreakBefore 写入语义属性并报告是否为新增", () => {
    const element = document.createElement("p");

    expect(forceBreakBefore(element)).toBe(true);
    expect(element.getAttribute(FORCE_BREAK_BEFORE_ATTRIBUTE)).toBe("page");
    expect(hasForcedBreak(element, "before")).toBe(true);
    expect(hasForcedBreak(element, "after")).toBe(false);
  });

  it("forceBreakAfter 写入独立的语义属性", () => {
    const element = document.createElement("p");

    expect(forceBreakAfter(element)).toBe(true);
    expect(element.getAttribute(FORCE_BREAK_AFTER_ATTRIBUTE)).toBe("page");
    expect(hasForcedBreak(element, "after")).toBe(true);
    expect(hasForcedBreak(element, "before")).toBe(false);
  });

  it("重复调用是幂等的，第二次返回 false", () => {
    const element = document.createElement("p");

    expect(forceBreakBefore(element)).toBe(true);
    expect(forceBreakBefore(element)).toBe(false);
    expect(forceBreakAfter(element)).toBe(true);
    expect(forceBreakAfter(element)).toBe(false);
  });

  it("clearForcedBreak 取消声明并报告取消前是否存在", () => {
    const element = document.createElement("p");
    forceBreakBefore(element);

    expect(clearForcedBreak(element, "before")).toBe(true);
    expect(hasForcedBreak(element, "before")).toBe(false);
    expect(clearForcedBreak(element, "before")).toBe(false);
  });

  it("不写任何内联样式：内联样式不会被 Paged.js 识别，写了只会造成误导", () => {
    const element = document.createElement("p");

    forceBreakBefore(element);
    forceBreakAfter(element);

    expect(element.hasAttribute("style")).toBe(false);
  });

  it("映射规则覆盖 before 与 after，且与属性常量保持一致", () => {
    expect(pagedBreakControlCss).toContain(
      `[${FORCE_BREAK_BEFORE_ATTRIBUTE}="page"]`
    );
    expect(pagedBreakControlCss).toContain("break-before: page");
    expect(pagedBreakControlCss).toContain(
      `[${FORCE_BREAK_AFTER_ATTRIBUTE}="page"]`
    );
    expect(pagedBreakControlCss).toContain("break-after: page");
  });
});
