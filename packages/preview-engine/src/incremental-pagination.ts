export interface PagedBreakTokenLike {
  node?: Node;
  offset?: number;
}

export interface PagedPageLike {
  element: HTMLElement;
  startToken?: PagedBreakTokenLike;
}

export interface IncrementalPaginationPlan {
  prefixLength: number;
  invalidationPageIndex: number;
  startToken: PagedBreakTokenLike | undefined;
}

function getNodeReference(node: Node | undefined) {
  if (!node) {
    return undefined;
  }
  if (node instanceof HTMLElement && node.dataset.ref) {
    return node.dataset.ref;
  }
  return node.parentElement?.dataset.ref;
}

function pageContainsReference(
  page: PagedPageLike,
  reference: string
) {
  return Array.from(
    page.element.querySelectorAll<HTMLElement>("[data-ref]")
  ).some((element) => element.dataset.ref === reference);
}

export function findSourceNodePageIndex(
  pages: readonly PagedPageLike[],
  sourceNode: Node | undefined
) {
  const reference = getNodeReference(sourceNode);
  if (!reference) {
    return undefined;
  }
  const pageIndex = pages.findIndex((page) =>
    pageContainsReference(page, reference)
  );
  return pageIndex >= 0 ? pageIndex : undefined;
}

export function createIncrementalPaginationPlan(
  prefixLength: number,
  previousNodeCount: number,
  sourceNodes: readonly Node[],
  pages: readonly PagedPageLike[]
): IncrementalPaginationPlan | undefined {
  if (
    prefixLength <= 0 ||
    pages.length === 0 ||
    prefixLength > sourceNodes.length ||
    prefixLength > previousNodeCount
  ) {
    return undefined;
  }

  const boundaryNode =
    sourceNodes[prefixLength] ??
    sourceNodes[prefixLength - 1];
  const boundaryPageIndex =
    findSourceNodePageIndex(pages, boundaryNode);
  if (boundaryPageIndex === undefined) {
    return undefined;
  }

  // 媒体块允许回填到上一页，因此变化边界必须额外向前回退一页。
  const invalidationPageIndex = Math.max(
    0,
    boundaryPageIndex - 1
  );
  return {
    prefixLength,
    invalidationPageIndex,
    startToken: pages[invalidationPageIndex]?.startToken
  };
}

export function assignPagedSourceReferences(
  root: Node,
  createReference: () => string
) {
  const elements: Element[] = [];
  if (root instanceof Element) {
    elements.push(root);
  }
  const queryRoot = root as Node & {
    querySelectorAll?: ParentNode["querySelectorAll"];
  };
  if (typeof queryRoot.querySelectorAll === "function") {
    elements.push(...Array.from(queryRoot.querySelectorAll("*")));
  }

  for (const element of elements) {
    if (!element.hasAttribute("data-ref")) {
      element.setAttribute("data-ref", createReference());
    }
    if (element.id) {
      element.setAttribute("data-id", element.id);
    }
  }
}
