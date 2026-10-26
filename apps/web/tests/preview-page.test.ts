import { describe, expect, it } from "vitest";
import {
  getNearestPageNumber,
  getPreviewPageScrollTop,
  normalizePreviewPageNumber
} from "../src/preview-page";

const pages = [
  { top: 0, bottom: 100 },
  { top: 124, bottom: 224 },
  { top: 248, bottom: 348 }
];

describe("getNearestPageNumber", () => {
  it("返回视口中心所在的页面", () => {
    expect(getNearestPageNumber(180, pages)).toBe(2);
  });

  it("在页间空隙中返回距离最近的页面", () => {
    expect(getNearestPageNumber(110, pages)).toBe(1);
    expect(getNearestPageNumber(116, pages)).toBe(2);
  });

  it("没有页面或中心坐标无效时返回 0", () => {
    expect(getNearestPageNumber(20, [])).toBe(0);
    expect(getNearestPageNumber(Number.NaN, pages)).toBe(0);
  });
});

describe("normalizePreviewPageNumber", () => {
  it("保留有效的整数页码", () => {
    expect(normalizePreviewPageNumber("12", 3, 65)).toBe(12);
  });

  it("将越界页码限制在有效范围", () => {
    expect(normalizePreviewPageNumber("0", 3, 65)).toBe(1);
    expect(normalizePreviewPageNumber("99", 3, 65)).toBe(65);
  });

  it("无效输入恢复当前页", () => {
    expect(normalizePreviewPageNumber("", 7, 65)).toBe(7);
    expect(normalizePreviewPageNumber("3.5", 7, 65)).toBe(7);
    expect(normalizePreviewPageNumber("abc", 7, 65)).toBe(7);
  });

  it("没有可用页面时返回 0", () => {
    expect(normalizePreviewPageNumber("1", 0, 0)).toBe(0);
  });
});

describe("getPreviewPageScrollTop", () => {
  it("按目标页相对滚动容器的位置计算滚动量", () => {
    expect(getPreviewPageScrollTop(200, 900, 120)).toBe(980);
  });

  it("避免返回负数或无效滚动量", () => {
    expect(getPreviewPageScrollTop(20, 10, 100)).toBe(0);
    expect(getPreviewPageScrollTop(Number.NaN, 10, 0)).toBe(0);
  });
});
