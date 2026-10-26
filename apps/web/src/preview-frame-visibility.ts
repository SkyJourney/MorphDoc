interface PreviewFrameVisibilityTarget {
  dataset: DOMStringMap;
}

export function beginPreviewFrameRender(
  target: PreviewFrameVisibilityTarget,
  requestId: number
) {
  target.dataset.rendering = "true";
  target.dataset.renderingRequestId = String(requestId);
}

export function completePreviewFrameRender(
  target: PreviewFrameVisibilityTarget,
  requestId: number
) {
  if (target.dataset.renderingRequestId !== String(requestId)) {
    return false;
  }

  delete target.dataset.rendering;
  delete target.dataset.renderingRequestId;
  return true;
}
