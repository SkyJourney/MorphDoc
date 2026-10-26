export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function getScrollProgress(metrics: ScrollMetrics) {
  const range = metrics.scrollHeight - metrics.clientHeight;
  if (range <= 0) {
    return 0;
  }

  return clamp(metrics.scrollTop / range, 0, 1);
}

export function getSyncedScrollTop(
  source: ScrollMetrics,
  target: ScrollMetrics
) {
  const targetRange = Math.max(
    0,
    target.scrollHeight - target.clientHeight
  );
  return getScrollProgress(source) * targetRange;
}
