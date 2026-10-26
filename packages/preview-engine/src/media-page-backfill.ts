export type MediaBackfillKind = "image" | "mermaid" | "echarts";

export interface MediaBackfillGeometry {
  remainingHeight: number;
  fixedHeight: number;
  baselineVisualHeight: number;
}

export interface MediaBackfillCandidate {
  id: string;
  scale: number;
}

export interface MediaBackfillOptions {
  minimumScale?: number;
  safetyGapPx?: number;
}

const MEDIA_BLOCK_SELECTOR = [
  ".md-document-image-block",
  ".mermaid:not(.mermaid-error)",
  ".md-echarts:not(.md-echarts-error)"
].join(", ");
const DEFAULT_MINIMUM_SCALE = 0.88;
const DEFAULT_SAFETY_GAP_PX = 2;
const SCALE_EPSILON = 0.001;

function finitePositive(value: string | undefined) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function getMediaKind(block: Element): MediaBackfillKind | undefined {
  if (block.classList.contains("md-document-image-block")) {
    return "image";
  }
  if (block.classList.contains("mermaid")) {
    return "mermaid";
  }
  if (block.classList.contains("md-echarts")) {
    return "echarts";
  }
  return undefined;
}

function getMediaVisual(
  block: Element,
  kind: MediaBackfillKind
): HTMLElement | SVGSVGElement | undefined {
  if (kind === "image") {
    return (
      block.querySelector<HTMLImageElement>("img.md-document-image") ??
      undefined
    );
  }
  if (kind === "echarts") {
    return (
      block.querySelector<HTMLElement>(".md-echarts-host") ??
      undefined
    );
  }
  return (
    block.querySelector<SVGSVGElement>("svg") ??
    block.querySelector<HTMLImageElement>("img") ??
    undefined
  );
}

function parsePixelValue(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getOuterBottom(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return (
    rect.bottom +
    parsePixelValue(getComputedStyle(element).marginBottom)
  );
}

function getOuterTop(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return (
    rect.top -
    parsePixelValue(getComputedStyle(element).marginTop)
  );
}

function getMediaGroupTop(
  block: HTMLElement,
  pageContentTop: number
) {
  const title = block.previousElementSibling;
  if (
    title instanceof HTMLElement &&
    /^H[1-6]$/.test(title.tagName)
  ) {
    return Math.max(
      pageContentTop,
      getOuterTop(title)
    );
  }
  return Math.max(
    pageContentTop,
    getOuterTop(block)
  );
}

function getLastContentBottom(pageContent: HTMLElement) {
  const contentRect = pageContent.getBoundingClientRect();
  const leafElements = Array.from(
    pageContent.querySelectorAll<HTMLElement>("[data-ref]")
  ).filter(
    (element) => !element.querySelector("[data-ref]")
  );
  let bottom = contentRect.top;

  for (const element of leafElements) {
    const rect = element.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.bottom <= contentRect.top ||
      rect.top >= contentRect.bottom
    ) {
      continue;
    }
    bottom = Math.max(
      bottom,
      Math.min(getOuterBottom(element), contentRect.bottom)
    );
  }
  return bottom;
}

function hasForcedBreakBefore(block: HTMLElement) {
  const title = block.previousElementSibling;
  const elements = [
    block,
    title instanceof HTMLElement && /^H[1-6]$/.test(title.tagName)
      ? title
      : undefined
  ].filter((element): element is HTMLElement => Boolean(element));
  return elements.some((element) => {
    const style = getComputedStyle(element);
    return (
      style.breakBefore === "page" ||
      style.pageBreakBefore === "always"
    );
  });
}

export function calculateMediaBackfillScale(
  geometry: MediaBackfillGeometry,
  options: MediaBackfillOptions = {}
) {
  const minimumScale =
    options.minimumScale ?? DEFAULT_MINIMUM_SCALE;
  const safetyGapPx =
    options.safetyGapPx ?? DEFAULT_SAFETY_GAP_PX;
  if (
    !Number.isFinite(geometry.remainingHeight) ||
    !Number.isFinite(geometry.fixedHeight) ||
    !Number.isFinite(geometry.baselineVisualHeight) ||
    geometry.remainingHeight <= 0 ||
    geometry.fixedHeight < 0 ||
    geometry.baselineVisualHeight <= 0 ||
    !Number.isFinite(minimumScale) ||
    minimumScale <= 0 ||
    minimumScale >= 1 ||
    !Number.isFinite(safetyGapPx) ||
    safetyGapPx < 0
  ) {
    return undefined;
  }

  const availableVisualHeight =
    geometry.remainingHeight -
    geometry.fixedHeight -
    safetyGapPx;
  const scale =
    availableVisualHeight / geometry.baselineVisualHeight;
  if (
    scale < minimumScale ||
    scale >= 1 - SCALE_EPSILON
  ) {
    return undefined;
  }
  return scale;
}

export function prepareMediaBackfillBlocks(root: ParentNode) {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>(MEDIA_BLOCK_SELECTOR)
  );
  let prepared = 0;

  for (const [index, block] of blocks.entries()) {
    const kind = getMediaKind(block);
    const visual = kind ? getMediaVisual(block, kind) : undefined;
    const rect = visual?.getBoundingClientRect();
    if (
      !kind ||
      !visual ||
      !rect ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      continue;
    }

    block.dataset.mediaBackfillId = `media-${index + 1}`;
    block.dataset.mediaBackfillKind = kind;
    block.dataset.mediaBaselineWidth = String(rect.width);
    block.dataset.mediaBaselineHeight = String(rect.height);
    prepared += 1;
  }

  return prepared;
}

export function getMediaBackfillIdsInDocumentOrder(
  root: ParentNode
) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      "[data-media-backfill-id]"
    )
  ).flatMap((block) =>
    block.dataset.mediaBackfillId
      ? [block.dataset.mediaBackfillId]
      : []
  );
}

export function findMediaBackfillCandidates(
  root: ParentNode,
  options: MediaBackfillOptions = {}
) {
  const pages = Array.from(
    root.querySelectorAll<HTMLElement>(".pagedjs_page")
  );
  const candidates: MediaBackfillCandidate[] = [];
  const candidateIds = new Set<string>();

  for (let pageIndex = 1; pageIndex < pages.length; pageIndex += 1) {
    const previousPage = pages[pageIndex - 1];
    const currentPage = pages[pageIndex];
    const previousContent =
      previousPage?.querySelector<HTMLElement>(
        ".pagedjs_page_content"
      );
    const currentContent =
      currentPage?.querySelector<HTMLElement>(
        ".pagedjs_page_content"
      );
    if (!previousContent || !currentContent) {
      continue;
    }

    const mediaBlocks = Array.from(
      currentContent.querySelectorAll<HTMLElement>(
        "[data-media-backfill-id]"
      )
    ).sort(
      (left, right) =>
        left.getBoundingClientRect().top -
        right.getBoundingClientRect().top
    );
    const block = mediaBlocks[0];
    if (!block) {
      continue;
    }

    const kind = getMediaKind(block);
    const visual = kind ? getMediaVisual(block, kind) : undefined;
    const id = block.dataset.mediaBackfillId;
    const baselineVisualHeight = finitePositive(
      block.dataset.mediaBaselineHeight
    );
    if (!kind || !visual || !id || !baselineVisualHeight) {
      continue;
    }

    if (hasForcedBreakBefore(block)) {
      continue;
    }
    const currentContentRect = currentContent.getBoundingClientRect();
    const visualHeight = visual.getBoundingClientRect().height;
    const mediaGroupTop = getMediaGroupTop(
      block,
      currentContentRect.top
    );
    const fixedHeight = Math.max(
      0,
      getOuterBottom(block) -
        mediaGroupTop -
        visualHeight
    );

    const previousContentRect =
      previousContent.getBoundingClientRect();
    const previousFlowBottom =
      getLastContentBottom(previousContent);
    const remainingHeight = Math.max(
      0,
      previousContentRect.bottom - previousFlowBottom
    );
    const scale = calculateMediaBackfillScale(
      {
        remainingHeight,
        fixedHeight,
        baselineVisualHeight
      },
      options
    );
    if (scale === undefined || candidateIds.has(id)) {
      continue;
    }
    candidateIds.add(id);
    candidates.push({ id, scale });
  }

  return candidates;
}

function setVisualSize(
  visual: HTMLElement | SVGSVGElement,
  width: number,
  height: number
) {
  visual.style.setProperty("display", "block");
  visual.style.setProperty("width", `${width}px`, "important");
  visual.style.setProperty("height", `${height}px`, "important");
  visual.style.setProperty("max-width", "100%", "important");
  visual.style.setProperty("max-height", `${height}px`, "important");
  visual.style.setProperty("margin-inline", "auto", "important");
}

export function applyMediaBackfillCandidates(
  source: ParentNode,
  candidates: MediaBackfillCandidate[]
) {
  let applied = 0;
  for (const candidate of candidates) {
    const block = Array.from(
      source.querySelectorAll<HTMLElement>(
        "[data-media-backfill-id]"
      )
    ).find(
      (element) =>
        element.dataset.mediaBackfillId === candidate.id
    );
    const kind = block ? getMediaKind(block) : undefined;
    const baselineWidth = finitePositive(
      block?.dataset.mediaBaselineWidth
    );
    const baselineHeight = finitePositive(
      block?.dataset.mediaBaselineHeight
    );
    const visual =
      block && kind ? getMediaVisual(block, kind) : undefined;
    if (
      !block ||
      !kind ||
      !visual ||
      !baselineWidth ||
      !baselineHeight ||
      !Number.isFinite(candidate.scale) ||
      candidate.scale <= 0 ||
      candidate.scale >= 1
    ) {
      continue;
    }

    const width = baselineWidth * candidate.scale;
    const height = baselineHeight * candidate.scale;
    block.dataset.mediaBackfilled = "true";
    block.dataset.mediaBackfillScale = String(candidate.scale);
    setVisualSize(visual, width, height);

    if (kind === "image") {
      visual.style.setProperty("object-fit", "contain");
    } else if (kind === "echarts") {
      const svg = block.querySelector<SVGSVGElement>(
        ".md-echarts-host svg"
      );
      if (svg) {
        setVisualSize(svg, width, height);
      }
      visual.style.removeProperty("aspect-ratio");
    }
    applied += 1;
  }
  return applied;
}
