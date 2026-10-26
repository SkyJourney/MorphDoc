export const PREVIEW_ZOOM_STORAGE_KEY = "morphdoc.preview-zoom.v1";
export const DEFAULT_PREVIEW_ZOOM = 100;
export const MINIMUM_PREVIEW_ZOOM = 50;
export const MAXIMUM_PREVIEW_ZOOM = 400;
export const PREVIEW_ZOOM_SLIDER_STEP = 5;

type PreviewZoomStorage = Pick<Storage, "getItem" | "setItem">;

export function normalizePreviewZoom(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_PREVIEW_ZOOM;
  }
  return Math.min(
    MAXIMUM_PREVIEW_ZOOM,
    Math.max(MINIMUM_PREVIEW_ZOOM, Math.round(value))
  );
}

export function parsePreviewZoom(
  value: string | null,
  fallback = DEFAULT_PREVIEW_ZOOM
) {
  if (!value?.trim()) {
    return normalizePreviewZoom(fallback);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? normalizePreviewZoom(parsed)
    : normalizePreviewZoom(fallback);
}

export function loadPreviewZoom(
  storage: PreviewZoomStorage = window.localStorage
) {
  try {
    return parsePreviewZoom(storage.getItem(PREVIEW_ZOOM_STORAGE_KEY));
  } catch {
    return DEFAULT_PREVIEW_ZOOM;
  }
}

export function savePreviewZoom(
  value: number,
  storage: PreviewZoomStorage = window.localStorage
) {
  try {
    storage.setItem(
      PREVIEW_ZOOM_STORAGE_KEY,
      String(normalizePreviewZoom(value))
    );
  } catch {
    // 预览缩放是非关键偏好，浏览器禁用缓存时保持当前会话值即可。
  }
}
