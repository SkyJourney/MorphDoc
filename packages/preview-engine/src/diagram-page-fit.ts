import {
  getPaperDimensionsMm,
  lengthToMillimeters,
  millimetersToCssPixels,
  type ExportConfig
} from "@morphdoc/core";

export interface DiagramDimensions {
  width: number;
  height: number;
}

export interface DiagramPageFit extends DiagramDimensions {
  scaled: boolean;
}

export interface SvgDiagramFitOptions {
  containerSelector: string;
  svgSelector?: string;
  resolvePageContent?: (
    container: HTMLElement,
    pageContent: DiagramDimensions
  ) => DiagramDimensions;
  onFit?: (
    container: HTMLElement,
    svg: SVGSVGElement,
    fit: DiagramPageFit
  ) => void;
}

const PAGE_FIT_EPSILON_PX = 1;

function parsePixelValue(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getPrecedingMediaTitleHeight(
  element: HTMLElement
) {
  const title = element.previousElementSibling;
  if (
    !(title instanceof HTMLElement) ||
    !/^H[1-6]$/.test(title.tagName)
  ) {
    return 0;
  }

  const style = getComputedStyle(title);
  title.style.setProperty("break-after", "avoid-page", "important");
  title.style.setProperty(
    "page-break-after",
    "avoid",
    "important"
  );
  return (
    title.getBoundingClientRect().height +
    parsePixelValue(style.marginTop) +
    parsePixelValue(style.marginBottom)
  );
}

export function ensurePageBreakAfter(element: HTMLElement) {
  const existingMarker = element.nextElementSibling;
  if (
    existingMarker instanceof HTMLElement &&
    existingMarker.dataset.mediaPageBreak === "true"
  ) {
    return existingMarker;
  }
  const marker = element.ownerDocument.createElement("div");
  marker.dataset.mediaPageBreak = "true";
  marker.setAttribute("aria-hidden", "true");
  marker.style.setProperty("height", "0", "important");
  marker.style.setProperty("break-before", "page", "important");
  marker.style.setProperty(
    "page-break-before",
    "always",
    "important"
  );
  element.after(marker);
  return marker;
}

export function parseSvgViewBox(
  value: string | null
): DiagramDimensions | undefined {
  if (!value) {
    return undefined;
  }

  const values = value
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number(part));
  const [, , width = Number.NaN, height = Number.NaN] = values;

  if (
    values.length !== 4 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }

  return { width, height };
}

function parseSvgDimensions(
  svg: SVGSVGElement
): DiagramDimensions | undefined {
  const width = Number.parseFloat(svg.getAttribute("width") ?? "");
  const height = Number.parseFloat(
    svg.getAttribute("height") ?? ""
  );
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  return { width, height };
}

export function getPageContentDimensions(
  config: ExportConfig
): DiagramDimensions {
  const paper = getPaperDimensionsMm(
    config.paper.format,
    config.paper.orientation
  );
  const width =
    paper.width -
    lengthToMillimeters(config.paper.margins.left) -
    lengthToMillimeters(config.paper.margins.right);
  const height =
    paper.height -
    lengthToMillimeters(config.paper.margins.top) -
    lengthToMillimeters(config.paper.margins.bottom);

  return {
    width: millimetersToCssPixels(width),
    height: millimetersToCssPixels(height)
  };
}

export function calculateDiagramPageFit(
  intrinsic: DiagramDimensions,
  pageContent: DiagramDimensions
): DiagramPageFit {
  const heightAfterWidthFit =
    (pageContent.width * intrinsic.height) / intrinsic.width;

  if (heightAfterWidthFit <= pageContent.height) {
    return {
      width: pageContent.width,
      height: heightAfterWidthFit,
      scaled: false
    };
  }

  const height = Math.max(
    0,
    pageContent.height - PAGE_FIT_EPSILON_PX
  );
  return {
    width: (height * intrinsic.width) / intrinsic.height,
    height,
    scaled: true
  };
}

export function fitSvgDiagramsToPage(
  root: ParentNode,
  config: ExportConfig,
  options: SvgDiagramFitOptions
) {
  const pageContent = getPageContentDimensions(config);
  const containers = Array.from(
    root.querySelectorAll<HTMLElement>(options.containerSelector)
  );

  for (const container of containers) {
    const svg = container.querySelector<SVGSVGElement>(
      options.svgSelector ?? "svg"
    );
    const intrinsic = svg
      ? parseSvgViewBox(svg.getAttribute("viewBox")) ??
        parseSvgDimensions(svg)
      : undefined;
    if (!svg || !intrinsic) {
      continue;
    }

    const resolvedPageContent =
      options.resolvePageContent?.(container, pageContent) ??
      pageContent;
    const availablePageContent = {
      width: resolvedPageContent.width,
      height: Math.max(
        0,
        resolvedPageContent.height -
          getPrecedingMediaTitleHeight(container)
      )
    };
    const fit = calculateDiagramPageFit(
      intrinsic,
      availablePageContent
    );
    if (!fit.scaled) {
      continue;
    }

    container.dataset.pageHeightFitted = "true";
    container.style.setProperty("margin-block", "0", "important");
    container.style.setProperty("break-after", "page", "important");
    container.style.setProperty(
      "page-break-after",
      "always",
      "important"
    );
    ensurePageBreakAfter(container);
    if (!svg.getAttribute("viewBox")) {
      svg.setAttribute(
        "viewBox",
        `0 0 ${intrinsic.width} ${intrinsic.height}`
      );
    }
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.style.setProperty("display", "block");
    svg.style.setProperty("width", `${fit.width}px`, "important");
    svg.style.setProperty("height", `${fit.height}px`, "important");
    svg.style.setProperty("max-width", "100%", "important");
    svg.style.setProperty(
      "max-height",
      `${fit.height}px`,
      "important"
    );
    options.onFit?.(container, svg, fit);
  }
}
