export interface PageVerticalRange {
  top: number;
  bottom: number;
}

export function getPreviewPageScrollTop(
  currentScrollTop: number,
  pageViewportTop: number,
  scrollerViewportTop: number
) {
  if (
    !Number.isFinite(currentScrollTop) ||
    !Number.isFinite(pageViewportTop) ||
    !Number.isFinite(scrollerViewportTop)
  ) {
    return 0;
  }

  return Math.max(
    0,
    currentScrollTop + pageViewportTop - scrollerViewportTop
  );
}

export function normalizePreviewPageNumber(
  value: string,
  current: number,
  total: number
) {
  if (!Number.isInteger(total) || total < 1) {
    return 0;
  }

  const normalizedValue = value.trim();
  const fallback = Number.isInteger(current)
    ? Math.min(Math.max(current, 1), total)
    : 1;

  if (normalizedValue.length === 0) {
    return fallback;
  }

  const parsed = Number(normalizedValue);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, 1), total);
}

export function getNearestPageNumber(
  viewportCenter: number,
  pages: readonly PageVerticalRange[]
) {
  if (pages.length === 0 || !Number.isFinite(viewportCenter)) {
    return 0;
  }

  let nearestPage = 1;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const [index, page] of pages.entries()) {
    const distance =
      viewportCenter < page.top
        ? page.top - viewportCenter
        : viewportCenter > page.bottom
          ? viewportCenter - page.bottom
          : 0;

    if (distance < nearestDistance) {
      nearestPage = index + 1;
      nearestDistance = distance;
    }
  }

  return nearestPage;
}
