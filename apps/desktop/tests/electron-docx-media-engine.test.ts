import { describe, expect, it, vi } from "vitest";
import { withActiveDocxCaptureSurface } from "../src/electron-docx-media-engine.js";

function createWindow() {
  let destroyed = false;
  return {
    showInactive: vi.fn(),
    hide: vi.fn(),
    isDestroyed: vi.fn(() => destroyed),
    destroy: () => {
      destroyed = true;
    }
  };
}

describe("Electron DOCX 捕获合成表面", () => {
  it("截图期间无焦点显示窗口并在完成后隐藏", async () => {
    const window = createWindow();
    const operation = vi.fn(async () => "captured");

    await expect(
      withActiveDocxCaptureSurface(window, operation, 0)
    ).resolves.toBe("captured");

    expect(window.showInactive).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledOnce();
    expect(window.hide).toHaveBeenCalledOnce();
  });

  it("窗口在失败期间销毁时不再隐藏", async () => {
    const window = createWindow();

    await expect(
      withActiveDocxCaptureSurface(
        window,
        async () => {
          window.destroy();
          throw new Error("capture failed");
        },
        0
      )
    ).rejects.toThrow("capture failed");

    expect(window.showInactive).toHaveBeenCalledOnce();
    expect(window.hide).not.toHaveBeenCalled();
  });
});
