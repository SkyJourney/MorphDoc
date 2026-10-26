import {
  formatPageNumber,
  resolvePageNumberAlignment,
  type PagedPreviewPayload
} from "./paged-preview.js";
import type { PagedPageSequence } from "./paged-page-sequence.js";

const alignments = ["left", "center", "right"] as const;

function setMarginBoxesVisible(
  page: HTMLElement,
  position: "top" | "bottom",
  visible: boolean
) {
  for (const alignment of alignments) {
    const box = page.querySelector<HTMLElement>(
      `.pagedjs_margin-${position}-${alignment}`
    );
    if (!box) {
      continue;
    }
    if (visible) {
      box.style.removeProperty("visibility");
    } else {
      box.style.setProperty("visibility", "hidden", "important");
    }
  }
}

function clearInjectedPageNumbers(page: HTMLElement) {
  for (const alignment of alignments) {
    const content = page.querySelector<HTMLElement>(
      `.pagedjs_margin-bottom-${alignment} .pagedjs_margin-content`
    );
    if (!content) {
      continue;
    }
    content.textContent = "";
    content.removeAttribute("data-page-number-rendered");
    content.removeAttribute("data-page-number-alignment");
  }
}

export function applyPagedPageDecorations(
  container: ParentNode,
  payload: PagedPreviewPayload,
  sequence: PagedPageSequence
) {
  const pages = Array.from(
    container.querySelectorAll<HTMLElement>(".pagedjs_page")
  );
  const pageNumberConfig = {
    ...payload.exportConfig.footer,
    startFrom: sequence.bodyPageNumberStart
  };

  for (const state of sequence.pages) {
    const page = pages[state.physicalPageIndex];
    if (!page) {
      continue;
    }

    clearInjectedPageNumbers(page);
    const isCover = state.kind === "cover";
    const isBodyFirst = state.kind === "body-first";
    const headerVisible =
      payload.exportConfig.header.enabled &&
      !isCover &&
      (!isBodyFirst || payload.exportConfig.header.showOnFirstPage);
    const footerVisible =
      payload.exportConfig.footer.enabled &&
      !isCover &&
      (!isBodyFirst || payload.exportConfig.footer.showOnFirstPage);

    setMarginBoxesVisible(page, "top", headerVisible);
    setMarginBoxesVisible(page, "bottom", footerVisible);
    page.dataset.headerVisible = String(headerVisible);
    page.dataset.footerVisible = String(footerVisible);

    if (
      !footerVisible ||
      state.bodyPageIndex === undefined ||
      state.pageNumber === undefined
    ) {
      continue;
    }

    const alignment = resolvePageNumberAlignment(
      pageNumberConfig,
      state.bodyPageIndex
    );
    const content = page.querySelector<HTMLElement>(
      `.pagedjs_margin-bottom-${alignment} .pagedjs_margin-content`
    );
    if (!content) {
      continue;
    }

    content.textContent = formatPageNumber(
      pageNumberConfig,
      state.bodyPageIndex,
      sequence.bodyPageCount
    );
    content.setAttribute("data-page-number-rendered", "true");
    content.setAttribute("data-page-number-alignment", alignment);
  }
}
