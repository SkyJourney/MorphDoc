// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { withHiddenWindowAnimationFrames } from "../src/hidden-window-animation-frame";

describe("隐藏窗口动画帧调度", () => {
  it("使用定时器驱动动画帧并在成功后恢复", async () => {
    const original = window.requestAnimationFrame;
    const callback = vi.fn();

    await withHiddenWindowAnimationFrames(window, async () => {
      expect(window.requestAnimationFrame).not.toBe(original);
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame((timestamp) => {
          callback(timestamp);
          resolve();
        });
      });
    });

    expect(callback).toHaveBeenCalledOnce();
    expect(window.requestAnimationFrame).toBe(original);
  });

  it("操作失败后仍恢复原动画帧函数", async () => {
    const original = window.requestAnimationFrame;

    await expect(
      withHiddenWindowAnimationFrames(window, async () => {
        throw new Error("render failed");
      })
    ).rejects.toThrow("render failed");

    expect(window.requestAnimationFrame).toBe(original);
  });
});
