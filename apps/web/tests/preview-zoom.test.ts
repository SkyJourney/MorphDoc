import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREVIEW_ZOOM,
  MAXIMUM_PREVIEW_ZOOM,
  MINIMUM_PREVIEW_ZOOM,
  PREVIEW_ZOOM_STORAGE_KEY,
  loadPreviewZoom,
  normalizePreviewZoom,
  parsePreviewZoom,
  savePreviewZoom
} from "../src/preview-zoom";

function createMemoryStorage(initialValue: string | null = null) {
  let value = initialValue;
  return {
    getItem(key: string) {
      return key === PREVIEW_ZOOM_STORAGE_KEY ? value : null;
    },
    setItem(key: string, nextValue: string) {
      if (key === PREVIEW_ZOOM_STORAGE_KEY) {
        value = nextValue;
      }
    },
    read() {
      return value;
    }
  };
}

describe("预览缩放", () => {
  it("默认使用 100%，并限制在 50% 到 400%", () => {
    expect(parsePreviewZoom(null)).toBe(DEFAULT_PREVIEW_ZOOM);
    expect(normalizePreviewZoom(20)).toBe(MINIMUM_PREVIEW_ZOOM);
    expect(normalizePreviewZoom(450)).toBe(MAXIMUM_PREVIEW_ZOOM);
    expect(normalizePreviewZoom(124.6)).toBe(125);
  });

  it("无效手动输入回退到当前缩放值", () => {
    expect(parsePreviewZoom("", 135)).toBe(135);
    expect(parsePreviewZoom("not-a-number", 135)).toBe(135);
  });

  it("保存并恢复浏览器缩放偏好", () => {
    const storage = createMemoryStorage();
    savePreviewZoom(145, storage);
    expect(storage.read()).toBe("145");
    expect(loadPreviewZoom(storage)).toBe(145);
  });
});
