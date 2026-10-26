import type {
  PagedDocumentPayload,
  SemanticDocumentSectionIntent
} from "@morphdoc/core";

export type PagedPageKind = "cover" | "body-first" | "body-rest";

export interface PagedPageState {
  physicalPageIndex: number;
  kind: PagedPageKind;
  bodyPageIndex?: number;
  pageNumber?: number;
}

export interface PagedPageSequence {
  pages: PagedPageState[];
  physicalPageCount: number;
  bodyPageCount: number;
  bodyPageNumberStart: number;
}

function findCoverSectionIntent(
  payload: Pick<PagedDocumentPayload, "semanticDocument">
): SemanticDocumentSectionIntent | undefined {
  return payload.semanticDocument.regions.find(
    (region) => region.kind === "cover" && region.section
  )?.section;
}

export function createPagedPageSequence(
  physicalPageCount: number,
  coverPageIndexes: ReadonlySet<number>,
  bodyPageNumberStart: number
): PagedPageSequence {
  const pages: PagedPageState[] = [];
  let bodyPageIndex = 0;

  for (
    let physicalPageIndex = 0;
    physicalPageIndex < physicalPageCount;
    physicalPageIndex += 1
  ) {
    if (coverPageIndexes.has(physicalPageIndex)) {
      pages.push({ physicalPageIndex, kind: "cover" });
      continue;
    }

    pages.push({
      physicalPageIndex,
      kind: bodyPageIndex === 0 ? "body-first" : "body-rest",
      bodyPageIndex,
      pageNumber: bodyPageNumberStart + bodyPageIndex
    });
    bodyPageIndex += 1;
  }

  return {
    pages,
    physicalPageCount,
    bodyPageCount: bodyPageIndex,
    bodyPageNumberStart
  };
}

export function classifyPagedPages(
  container: ParentNode,
  payload: Pick<
    PagedDocumentPayload,
    "semanticDocument" | "exportConfig"
  >
): PagedPageSequence {
  const pageElements = Array.from(
    container.querySelectorAll<HTMLElement>(".pagedjs_page")
  );
  const coverIntent = findCoverSectionIntent(payload);
  const coverPageIndexes = new Set<number>();

  if (coverIntent) {
    for (const [pageIndex, page] of pageElements.entries()) {
      if (page.querySelector('[data-semantic-region="cover"]')) {
        coverPageIndexes.add(pageIndex);
      }
    }
  }

  const sequence = createPagedPageSequence(
    pageElements.length,
    coverPageIndexes,
    coverIntent?.followingPageNumberStart ??
      payload.exportConfig.footer.startFrom
  );

  for (const state of sequence.pages) {
    const page = pageElements[state.physicalPageIndex];
    if (!page) {
      continue;
    }
    page.dataset.pageKind = state.kind;
    page.dataset.physicalPageIndex = String(state.physicalPageIndex);
    if (state.bodyPageIndex === undefined) {
      delete page.dataset.bodyPageIndex;
      delete page.dataset.pageNumber;
    } else {
      page.dataset.bodyPageIndex = String(state.bodyPageIndex);
      page.dataset.pageNumber = String(state.pageNumber);
    }
  }

  return sequence;
}
