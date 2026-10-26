import type { PDFDocumentProxy } from "pdfjs-dist";
import { decodeLocalDocumentLinkFromPdf } from "@morphdoc/core";

export type PdfDestination = string | unknown[];

export interface PdfAnnotationLinkCallbacks {
  onExternalLink: (href: string) => void;
  onNavigateToPage: (pageNumber: number) => void;
}

export interface PdfAnnotationLinkService {
  externalLinkEnabled: boolean;
  addLinkAttributes(
    link: HTMLAnchorElement,
    url: string,
    newWindow?: boolean
  ): void;
  getDestinationHash(destination: PdfDestination): string;
  getAnchorUrl(anchor: string): string;
  goToDestination(destination: PdfDestination): Promise<void>;
  executeNamedAction(action: string): void;
  executeSetOCGState(action: object): Promise<void>;
  getAttachmentContent(id: string): Promise<undefined>;
}

export async function resolvePdfDestinationPage(
  document: Pick<
    PDFDocumentProxy,
    "getDestination" | "getPageIndex" | "numPages"
  >,
  destination: PdfDestination
) {
  const explicitDestination =
    typeof destination === "string"
      ? await document.getDestination(destination)
      : destination;
  if (
    !Array.isArray(explicitDestination) ||
    explicitDestination.length === 0
  ) {
    return undefined;
  }

  const pageReference = explicitDestination[0];
  let pageNumber: number;
  if (
    typeof pageReference === "number" &&
    Number.isInteger(pageReference)
  ) {
    pageNumber = pageReference + 1;
  } else if (
    pageReference &&
    typeof pageReference === "object"
  ) {
    pageNumber =
      (await document.getPageIndex(
        pageReference as Parameters<
          PDFDocumentProxy["getPageIndex"]
        >[0]
      )) + 1;
  } else {
    return undefined;
  }

  return pageNumber >= 1 && pageNumber <= document.numPages
    ? pageNumber
    : undefined;
}

export function resolvePdfNamedActionPage(
  action: string,
  currentPage: number,
  pageCount: number
) {
  switch (action) {
    case "FirstPage":
      return 1;
    case "LastPage":
      return pageCount;
    case "NextPage":
    case "PageDown":
      return Math.min(pageCount, currentPage + 1);
    case "PrevPage":
    case "PageUp":
      return Math.max(1, currentPage - 1);
    default:
      return undefined;
  }
}

export function createPdfAnnotationLinkService(
  document: Pick<
    PDFDocumentProxy,
    "getDestination" | "getPageIndex" | "numPages"
  >,
  currentPage: number,
  callbacks: PdfAnnotationLinkCallbacks
): PdfAnnotationLinkService {
  return {
    externalLinkEnabled: true,
    addLinkAttributes(link, url) {
      const resolvedUrl =
        decodeLocalDocumentLinkFromPdf(url) ?? url;
      link.href = "#";
      link.rel = "noopener noreferrer";
      link.title ||= resolvedUrl;
      link.dataset.pdfExternalHref = resolvedUrl;
      link.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        callbacks.onExternalLink(resolvedUrl);
        return false;
      };
    },
    getDestinationHash() {
      return "#pdf-destination";
    },
    getAnchorUrl() {
      return "#pdf-action";
    },
    async goToDestination(destination) {
      try {
        const pageNumber = await resolvePdfDestinationPage(
          document,
          destination
        );
        if (pageNumber !== undefined) {
          callbacks.onNavigateToPage(pageNumber);
        }
      } catch {
        // 损坏或无法解析的 PDF 目标保持无行为。
      }
    },
    executeNamedAction(action) {
      const pageNumber = resolvePdfNamedActionPage(
        action,
        currentPage,
        document.numPages
      );
      if (pageNumber !== undefined) {
        callbacks.onNavigateToPage(pageNumber);
      }
    },
    async executeSetOCGState() {
      // 精确预览不改变 PDF 可选内容组状态。
    },
    async getAttachmentContent() {
      // 精确预览不下载或执行 PDF 内嵌附件。
      return undefined;
    }
  };
}
