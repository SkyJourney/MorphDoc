import { describe, expect, it } from "vitest";
import { resolveBreakTokenElement } from "../src/paged-break-token.js";

describe("Paged.js 分页断点", () => {
  it("直接返回元素断点", () => {
    const element = {
      nodeType: 1,
      parentElement: null
    } as unknown as Element;

    expect(resolveBreakTokenElement(element)).toBe(element);
  });

  it("文本断点使用父元素继续查找", () => {
    const parentElement = {} as Element;
    const textNode = {
      nodeType: 3,
      parentElement
    } as unknown as Node;

    expect(resolveBreakTokenElement(textNode)).toBe(parentElement);
  });

  it("安全跳过空断点和无父元素节点", () => {
    const detachedTextNode = {
      nodeType: 3,
      parentElement: null
    } as unknown as Node;

    expect(resolveBreakTokenElement(undefined)).toBeUndefined();
    expect(
      resolveBreakTokenElement(detachedTextNode)
    ).toBeUndefined();
  });
});
