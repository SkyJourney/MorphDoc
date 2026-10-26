const COVER_HEIGHT_EPSILON_PX = 0.5;
const COVER_PAGE_BREAK_SAFETY_PX = 8;

function pixelValue(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function constrainCoverChildSpacing(
  cover: HTMLElement,
  pageContentHeightPx: number
) {
  const coverStyle = getComputedStyle(cover);
  const availableHeightPx = Math.max(
    0,
    pageContentHeightPx -
      pixelValue(coverStyle.paddingTop) -
      pixelValue(coverStyle.paddingBottom) -
      pixelValue(coverStyle.borderTopWidth) -
      pixelValue(coverStyle.borderBottomWidth)
  );
  const children = Array.from(cover.children).flatMap((child) => {
    if (!(child instanceof HTMLElement)) {
      return [];
    }
    const style = getComputedStyle(child);
    if (style.display === "none" || style.position === "absolute") {
      return [];
    }
    return [{
      element: child,
      heightPx: child.getBoundingClientRect().height,
      marginTopPx: pixelValue(style.marginTop),
      marginBottomPx: pixelValue(style.marginBottom)
    }];
  });
  const fixedHeightPx = children.reduce(
    (total, child) => total + child.heightPx,
    0
  );
  const spacingHeightPx = children.reduce(
    (total, child) =>
      total + child.marginTopPx + child.marginBottomPx,
    0
  );
  if (
    children.length === 0 ||
    spacingHeightPx <= COVER_HEIGHT_EPSILON_PX ||
    fixedHeightPx + spacingHeightPx <=
      availableHeightPx + COVER_HEIGHT_EPSILON_PX
  ) {
    return 1;
  }
  const spacingScale = Math.min(
    1,
    Math.max(0, availableHeightPx - fixedHeightPx) / spacingHeightPx
  );
  for (const child of children) {
    child.element.style.marginTop =
      `${child.marginTopPx * spacingScale}px`;
    child.element.style.marginBottom =
      `${child.marginBottomPx * spacingScale}px`;
  }
  cover.dataset.semanticCoverSpacingScale =
    spacingScale.toFixed(6);
  return spacingScale;
}

function stabilizeConstrainedCoverFlow(cover: HTMLElement) {
  const style = getComputedStyle(cover);
  if (style.display !== "flex" && style.display !== "inline-flex") {
    return;
  }
  const layout = cover.ownerDocument.createElement("div");
  layout.dataset.semanticCoverLayout = "flex";
  layout.style.display = "flex";
  layout.style.width = "100%";
  layout.style.height = "100%";
  layout.style.minHeight = "0";
  layout.style.flexDirection = style.flexDirection;
  layout.style.alignItems = style.alignItems;
  layout.style.justifyContent = style.justifyContent;
  layout.append(...Array.from(cover.childNodes));
  cover.append(layout);
  cover.style.display = "block";
}

function insertCoverPageBreakAnchor(cover: HTMLElement) {
  const anchor = cover.ownerDocument.createElement("div");
  anchor.dataset.semanticCoverPageBreakAnchor = "true";
  anchor.setAttribute("aria-hidden", "true");
  anchor.style.cssText = [
    "height: 0",
    "margin: 0",
    "padding: 0",
    "border: 0",
    "line-height: 0"
  ].join(";");
  anchor.style.setProperty("break-after", "page", "important");
  anchor.style.setProperty("page-break-after", "always", "important");
  cover.after(anchor);
}

export const semanticCoverSelector =
  '[data-semantic-region="cover"][data-semantic-break-after="next-page"]';

export function constrainSemanticCoversToPage(
  root: ParentNode,
  pageContentHeightPx: number
) {
  if (!Number.isFinite(pageContentHeightPx) || pageContentHeightPx <= 0) {
    return 0;
  }
  let constrainedCount = 0;
  for (const cover of Array.from(
    root.querySelectorAll<HTMLElement>(semanticCoverSelector)
  )) {
    const height = cover.getBoundingClientRect().height;
    if (
      !Number.isFinite(height) ||
      height <= pageContentHeightPx + COVER_HEIGHT_EPSILON_PX
    ) {
      continue;
    }
    const fittedHeightPx = Math.max(
      1,
      pageContentHeightPx - COVER_PAGE_BREAK_SAFETY_PX
    );
    const constrainedHeight = `${fittedHeightPx}px`;
    cover.style.boxSizing = "border-box";
    cover.style.height = constrainedHeight;
    cover.style.minHeight = constrainedHeight;
    cover.style.maxHeight = constrainedHeight;
    cover.style.overflow = "hidden";
    cover.style.setProperty("break-inside", "auto", "important");
    cover.style.setProperty("page-break-inside", "auto", "important");
    cover.dataset.semanticCoverFit = "constrained";
    cover.dataset.semanticCoverPageBreak = "natural";
    cover.removeAttribute("data-semantic-break-after");
    constrainCoverChildSpacing(cover, fittedHeightPx);
    stabilizeConstrainedCoverFlow(cover);
    insertCoverPageBreakAnchor(cover);
    constrainedCount += 1;
  }
  return constrainedCount;
}
