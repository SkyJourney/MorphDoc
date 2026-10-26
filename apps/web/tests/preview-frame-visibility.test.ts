import { describe, expect, it } from "vitest";
import {
  beginPreviewFrameRender,
  completePreviewFrameRender
} from "../src/preview-frame-visibility";

function createTarget() {
  return {
    dataset: {} as DOMStringMap
  };
}

describe("分页 iframe 渲染可见性", () => {
  it("渲染期间隐藏，当前请求完成后恢复显示", () => {
    const target = createTarget();

    beginPreviewFrameRender(target, 12);
    expect(target.dataset).toMatchObject({
      rendering: "true",
      renderingRequestId: "12"
    });

    expect(completePreviewFrameRender(target, 12)).toBe(true);
    expect(target.dataset.rendering).toBeUndefined();
    expect(target.dataset.renderingRequestId).toBeUndefined();
  });

  it("旧请求完成时不会提前显示新请求的半成品", () => {
    const target = createTarget();

    beginPreviewFrameRender(target, 12);
    beginPreviewFrameRender(target, 13);

    expect(completePreviewFrameRender(target, 12)).toBe(false);
    expect(target.dataset).toMatchObject({
      rendering: "true",
      renderingRequestId: "13"
    });
  });
});
