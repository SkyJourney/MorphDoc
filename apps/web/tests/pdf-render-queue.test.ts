import { describe, expect, it, vi } from "vitest";
import { PdfPageRenderQueue } from "../src/pdf-render-queue";

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("PdfPageRenderQueue", () => {
  it("限制并发并优先渲染可见页", async () => {
    const queue = new PdfPageRenderQueue(1);
    const order: number[] = [];
    let releaseFirst: (() => void) | undefined;

    queue.schedule(
      1,
      () =>
        new Promise<void>((resolve) => {
          order.push(1);
          releaseFirst = resolve;
        })
    );
    queue.schedule(2, async () => {
      order.push(2);
    });
    queue.schedule(8, async () => {
      order.push(8);
    });
    queue.setVisible(8, true);

    expect(order).toEqual([1]);
    releaseFirst?.();
    await flushPromises();
    expect(order).toEqual([1, 8, 2]);
  });

  it("优先预渲染滚动方向上的相邻页面", async () => {
    const queue = new PdfPageRenderQueue(1);
    const order: number[] = [];
    let releaseFirst: (() => void) | undefined;

    queue.schedule(
      5,
      () =>
        new Promise<void>((resolve) => {
          order.push(5);
          releaseFirst = resolve;
        })
    );
    queue.setVisible(5, true);
    queue.setVisible(5, false);
    queue.setVisible(6, true);
    queue.schedule(4, async () => {
      order.push(4);
    });
    queue.schedule(7, async () => {
      order.push(7);
    });

    releaseFirst?.();
    await flushPromises();
    expect(order).toEqual([5, 7, 4]);
  });

  it("取消尚未开始的任务", async () => {
    const queue = new PdfPageRenderQueue(1);
    let releaseFirst: (() => void) | undefined;
    const cancelledTask = vi.fn();

    queue.schedule(
      1,
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        })
    );
    const cancel = queue.schedule(2, async () => {
      cancelledTask();
    });
    cancel();

    releaseFirst?.();
    await flushPromises();
    expect(cancelledTask).not.toHaveBeenCalled();
  });
});
