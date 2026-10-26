import { describe, expect, it } from "vitest";
import {
  getScrollProgress,
  getSyncedScrollTop
} from "../src/scroll-sync";

describe("编辑与预览滚动同步", () => {
  it("按可滚动范围计算阅读进度", () => {
    expect(
      getScrollProgress({
        scrollTop: 600,
        scrollHeight: 1600,
        clientHeight: 400
      })
    ).toBe(0.5);
  });

  it("把源区域进度映射到目标区域", () => {
    expect(
      getSyncedScrollTop(
        {
          scrollTop: 600,
          scrollHeight: 1600,
          clientHeight: 400
        },
        {
          scrollTop: 0,
          scrollHeight: 5000,
          clientHeight: 1000
        }
      )
    ).toBe(2000);
  });

  it("处理无滚动范围和越界位置", () => {
    expect(
      getScrollProgress({
        scrollTop: 100,
        scrollHeight: 500,
        clientHeight: 500
      })
    ).toBe(0);
    expect(
      getScrollProgress({
        scrollTop: 1800,
        scrollHeight: 1600,
        clientHeight: 400
      })
    ).toBe(1);
  });
});
