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

const HEADING_PATTERN = /^H[1-6]$/;

/**
 * 紧邻在元素之前的连续标题，按文档顺序排列（最靠前的在前）。
 *
 * 标题的 `break-after: avoid` 要求它与后面的内容同页，而连续的标题会一环扣一环：
 * `h2` 要与 `h3` 同页，`h3` 又要与媒体同页，于是整串标题都要跟着媒体块走。因此
 * “媒体块及其前面整串连续标题”才是不可拆分的整体，而不是“媒体块加最多一个标题”。
 * 凡是需要回答“媒体块前面有哪些标题”的地方都应使用本函数，避免各处各自只看一个。
 *
 * @param element 媒体块
 * @returns 连续标题；前一个兄弟不是标题时返回空数组
 */
export function getPrecedingHeadingChain(element: Element) {
  const chain: HTMLElement[] = [];
  let sibling = element.previousElementSibling;
  while (
    sibling instanceof HTMLElement &&
    HEADING_PATTERN.test(sibling.tagName)
  ) {
    chain.unshift(sibling);
    sibling = sibling.previousElementSibling;
  }
  return chain;
}

/**
 * 媒体块之前整串连续标题占用的高度（含外边距）。
 *
 * 整页缩放时要从页面内容区里扣除这部分高度，因为标题会与媒体块同页。此前只计入
 * 紧邻的一个标题：`h2` 紧跟 `h3` 再接整页图表时，`h2` 的高度没有被扣除，三者合起来
 * 比一页高，Paged.js 放不下而报 “Unable to layout item”，并把媒体块重复渲染。
 *
 * 相邻标题之间的外边距会折叠，只计较大的一个；整串最外侧的外边距照常计入。只有一个
 * 标题时结果与此前完全相同。
 */
export function getPrecedingMediaTitleHeight(
  element: HTMLElement
) {
  const chain = getPrecedingHeadingChain(element);
  if (chain.length === 0) {
    return 0;
  }

  let total = 0;
  let previousBottomMargin: number | undefined;
  for (const title of chain) {
    const style = getComputedStyle(title);
    title.style.setProperty("break-after", "avoid-page", "important");
    title.style.setProperty(
      "page-break-after",
      "avoid",
      "important"
    );
    const marginTop = parsePixelValue(style.marginTop);
    total +=
      previousBottomMargin === undefined
        ? marginTop
        : Math.max(previousBottomMargin, marginTop);
    total += title.getBoundingClientRect().height;
    previousBottomMargin = parsePixelValue(style.marginBottom);
  }
  return total + (previousBottomMargin ?? 0);
}

/**
 * 在元素之后插入零高度的分页标记。
 *
 * 注意：标记上的内联 `break-before` 不会被 Paged.js 识别，对分页没有作用；缩放到整页的
 * 媒体块靠“撑满一页后自然溢出”把后续内容推到下一页。改用 `forceBreakAfter` 的评估结论见
 * 下面 `fitSvgDiagramsToPage` 中的说明。
 */
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
    // 这里的内联 break-after 与随后的占位标记同样不会被 Paged.js 识别。曾评估改用
    // forceBreakAfter 并去掉占位标记：只有一个标题紧接整页图表时分页结果逐页一致，但连续
    // 标题紧接整页图表时，迁移后流程图会额外出现重复渲染，当时据此暂不迁移。那次重复的根因
    // 是整页缩放只扣除紧邻的一个标题，已由 getPrecedingHeadingChain 修复，迁移的前提已
    // 具备，需要用修复后的构建重新评估。
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
