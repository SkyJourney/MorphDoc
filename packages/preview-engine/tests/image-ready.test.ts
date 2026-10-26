// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { waitForImages } from "../src/index.js";

function createPendingImage() {
  const image = document.createElement("img");
  Object.defineProperty(image, "complete", {
    configurable: true,
    get: () => false
  });
  return image;
}

describe("文档图片就绪等待", () => {
  it("图片正常加载后立即完成", async () => {
    const image = createPendingImage();
    image.decode = vi.fn(() => new Promise(() => undefined));
    document.body.replaceChildren(image);

    const waiting = waitForImages(document, 1_000);
    image.dispatchEvent(new Event("load"));

    await expect(waiting).resolves.toEqual([undefined]);
  });

  it("decode 拒绝且图片已经失败时不会错过 error 状态", async () => {
    let complete = false;
    const image = document.createElement("img");
    Object.defineProperty(image, "complete", {
      configurable: true,
      get: () => complete
    });
    image.decode = vi.fn(async () => {
      complete = true;
      throw new Error("decode failed");
    });
    document.body.replaceChildren(image);

    await expect(waitForImages(document, 1_000)).resolves.toEqual([
      undefined
    ]);
  });

  it("图片永不响应时由局部超时结束等待", async () => {
    vi.useFakeTimers();
    try {
      const image = createPendingImage();
      image.decode = vi.fn(() => new Promise(() => undefined));
      document.body.replaceChildren(image);

      const waiting = waitForImages(document, 25);
      await vi.advanceTimersByTimeAsync(25);

      await expect(waiting).resolves.toEqual([undefined]);
    } finally {
      vi.useRealTimers();
    }
  });
});
