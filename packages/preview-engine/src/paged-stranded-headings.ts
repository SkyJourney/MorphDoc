import { forceBreakBefore } from "./paged-break-control.js";
import type { PaginationInvariant } from "./paged-pagination-invariants.js";

/**
 * 标题孤立：页面上最后一个有内容的块是标题，它所属的正文却排到了下一页。
 *
 * ## 成因
 *
 * 标题的 `break-after: avoid` 表达的是“标题必须与后面的内容同页”。Paged.js 只能
 * 在相邻两个元素之间落实这个约束，下面两种情形会让它失效：
 *
 * - **连续标题**：`h2` 后紧跟 `h3`，`h3` 被推到下一页，`h2` 留在页末；
 * - **表格内断开**：标题后是表格，表头放得下、首行放不下，Paged.js 在表头之后
 *   断开，页面上只剩标题和一个被隐藏的空表壳。
 *
 * 两者的外在表现一致，因此用同一个不变量表达：**页面上最后一个有内容的块不得是
 * 标题**（文档最后一页除外）。
 *
 * ## 修复
 *
 * 让孤立标题从下一页开始（`forceBreakBefore`），使它与后面的内容重新相遇。
 * 连续的尾部标题只需要让其中的第一个换页，后面的标题自然跟随，否则每个标题
 * 都被强制换页会各占一页。
 *
 * ## 范围
 *
 * 只处理文档根容器的直接子级标题。嵌套在引用、列表或封面等结构里的标题由它们
 * 所在的块整体分页，这里不干预。
 */

/** 重新分页的源文档与分页结果之间对应标题所用的稳定标识。 */
export const HEADING_IDENTITY_ATTRIBUTE = "data-morphdoc-heading-id";

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";
const MEDIA_SELECTOR = "img, svg, canvas, video, iframe, hr";

/**
 * 给源文档中的标题标注按文档顺序编号的稳定标识。
 *
 * 重新分页用的源文档在送入 Paged.js 之前没有 `data-ref`，需要自己建立对应关系。
 * 分页结果里的标题是源标题的克隆，属性会被保留。
 *
 * @param root 源文档
 * @returns 本次新标注的标题数量
 */
export function stampHeadingIdentities(root: ParentNode) {
  let stamped = 0;
  for (const [index, heading] of Array.from(
    root.querySelectorAll(HEADING_SELECTOR)
  ).entries()) {
    if (!heading.hasAttribute(HEADING_IDENTITY_ATTRIBUTE)) {
      heading.setAttribute(HEADING_IDENTITY_ATTRIBUTE, `heading-${index + 1}`);
      stamped += 1;
    }
  }
  return stamped;
}

/** 判断元素在分页结果中是否占据了可见的版面。 */
export type VisibilityPredicate = (element: Element) => boolean;

/**
 * 默认的可见性判定：元素生成了布局盒，且宽高不为零。
 *
 * `display: none` 的空表壳没有布局盒；零高度的分页标记宽高为零，都不算内容。
 */
export const isRenderedElementVisible: VisibilityPredicate = (element) => {
  if (element.getClientRects().length === 0) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0.5 && rect.height > 0.5;
};

function isHeading(element: Element) {
  return element.matches(HEADING_SELECTOR);
}

/** 块是否带有读者能看到的内容：文字或图形。 */
function hasVisibleContent(
  element: Element,
  isVisible: VisibilityPredicate
) {
  if (!isVisible(element)) {
    return false;
  }
  return (
    (element.textContent ?? "").trim().length > 0 ||
    element.matches(MEDIA_SELECTOR) ||
    element.querySelector(MEDIA_SELECTOR) !== null
  );
}

/** 取得一页中承载正文的根容器的直接子级。 */
function pageFlowChildren(page: Element) {
  const area = page.querySelector(".pagedjs_area");
  if (!area) {
    return [];
  }
  const root =
    area.querySelector("article") ??
    area.querySelector(".pagedjs_page_content > div");
  return root ? Array.from(root.children) : [];
}

/**
 * 找出被孤立在页末的标题。
 *
 * @param rendered 分页结果根节点
 * @param isVisible 可见性判定，测试时可替换
 * @returns 需要换页的标题标识（每处孤立的尾部标题序列只返回第一个）
 */
export function strandedPagedHeadingIds(
  rendered: ParentNode,
  isVisible: VisibilityPredicate = isRenderedElementVisible
) {
  const pages = Array.from(rendered.querySelectorAll(".pagedjs_page"));
  const flows = pages.map((page) =>
    pageFlowChildren(page).map((child) => ({
      child,
      visible: hasVisibleContent(child, isVisible)
    }))
  );
  // 某页之后是否还有带内容的页面：文档最后一页的尾部标题无处可去，不处理
  const hasContentAfter = new Array<boolean>(pages.length).fill(false);
  let contentSeen = false;
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    hasContentAfter[index] = contentSeen;
    if (flows[index]!.some((entry) => entry.visible)) {
      contentSeen = true;
    }
  }

  const stranded: string[] = [];
  for (const [pageIndex, flow] of flows.entries()) {
    if (!hasContentAfter[pageIndex]) {
      continue;
    }
    const visibleBlocks = flow.filter((entry) => entry.visible);
    const last = visibleBlocks.at(-1);
    if (!last || !isHeading(last.child)) {
      continue;
    }
    // 向前合并连续的尾部标题，只处理其中的第一个
    let firstIndex = visibleBlocks.length - 1;
    while (
      firstIndex > 0 &&
      isHeading(visibleBlocks[firstIndex - 1]!.child)
    ) {
      firstIndex -= 1;
    }
    // 本页只有这些标题：换页后只会在下一页再次孤立，没有意义
    if (firstIndex === 0) {
      continue;
    }
    const id = visibleBlocks[firstIndex]!.child.getAttribute(
      HEADING_IDENTITY_ATTRIBUTE
    );
    if (id) {
      stranded.push(id);
    }
  }
  return stranded;
}

/**
 * 让孤立的标题从下一页开始。
 *
 * @param source 重新分页所用的源文档
 * @param headingIds 需要换页的标题标识
 * @returns 本次新增强制分页的标题数；此前已经施加过的不重复计数
 */
export function forceStrandedHeadingsToNextPage(
  source: ParentNode,
  headingIds: readonly string[]
) {
  const requested = new Set(headingIds);
  let added = 0;
  for (const heading of Array.from(
    source.querySelectorAll(`[${HEADING_IDENTITY_ATTRIBUTE}]`)
  )) {
    const id = heading.getAttribute(HEADING_IDENTITY_ATTRIBUTE);
    if (id && requested.has(id) && forceBreakBefore(heading)) {
      added += 1;
    }
  }
  return added;
}

/** 标题孤立不变量的标识。 */
export const STRANDED_HEADING_INVARIANT_ID = "heading-stranded";

/**
 * 标题孤立不变量。
 *
 * 只是版面瑕疵，因此严重程度为 `warning`：修复失败时保留当前结果，不让导出失败。
 */
export function createStrandedHeadingInvariant(
  isVisible: VisibilityPredicate = isRenderedElementVisible
): PaginationInvariant {
  return {
    id: STRANDED_HEADING_INVARIANT_ID,
    title: "分页后标题孤立在页末",
    severity: "warning",
    detect: ({ rendered }) => strandedPagedHeadingIds(rendered, isVisible),
    repair: ({ source }, headingIds) =>
      forceStrandedHeadingsToNextPage(source, headingIds)
  };
}
