import type { ExportConfig } from "@morphdoc/core";
import {
  calculateDiagramPageFit,
  ensurePageBreakAfter,
  getPageContentDimensions,
  getPrecedingMediaTitleHeight
} from "./diagram-page-fit.js";

function getImageBlock(image: HTMLImageElement) {
  const parent = image.parentElement;
  if (parent?.classList.contains("md-document-image-block")) {
    return parent;
  }
  if (
    parent?.tagName === "P" &&
    Array.from(parent.childNodes).every(
      (node) =>
        node === image ||
        (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim())
    )
  ) {
    parent.classList.add("md-document-image-block");
    return parent;
  }
  return undefined;
}

export function prepareDocumentImageBlocks(root: ParentNode) {
  const images = Array.from(
    root.querySelectorAll<HTMLImageElement>("img.md-document-image")
  );
  let prepared = 0;

  for (const image of images) {
    if (getImageBlock(image)) {
      prepared += 1;
    }
  }

  return prepared;
}

export function fitDocumentImagesToPage(
  root: ParentNode,
  config: ExportConfig,
  options: { prepareBlocks?: boolean } = {}
) {
  const pageContent = getPageContentDimensions(config);
  if (options.prepareBlocks !== false) {
    prepareDocumentImageBlocks(root);
  }
  const images = Array.from(
    root.querySelectorAll<HTMLImageElement>("img.md-document-image")
  );

  for (const image of images) {
    const block = getImageBlock(image);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (width <= 0 || height <= 0) {
      continue;
    }
    const imageHeight = image.getBoundingClientRect().height;
    const blockHeight = block?.getBoundingClientRect().height ?? imageHeight;
    const nonImageHeight = Math.max(0, blockHeight - imageHeight);
    const titleHeight = block
      ? getPrecedingMediaTitleHeight(block)
      : 0;
    const fit = calculateDiagramPageFit(
      { width, height },
      {
        width: pageContent.width,
        height: Math.max(
          0,
          pageContent.height - nonImageHeight - titleHeight
        )
      }
    );
    if (!fit.scaled) {
      continue;
    }
    if (block?.classList.contains("md-document-image-block")) {
      block.dataset.pageHeightFitted = "true";
      block.style.setProperty("margin-block", "0", "important");
      block.style.setProperty("break-after", "page", "important");
      block.style.setProperty(
        "page-break-after",
        "always",
        "important"
      );
      ensurePageBreakAfter(block);
    }
    image.dataset.pageHeightFitted = "true";
    image.style.setProperty("display", "block");
    image.style.setProperty("width", `${fit.width}px`, "important");
    image.style.setProperty("height", `${fit.height}px`, "important");
    image.style.setProperty("max-width", "100%", "important");
    image.style.setProperty(
      "max-height",
      `${fit.height}px`,
      "important"
    );
    image.style.setProperty("object-fit", "contain");
    image.style.setProperty("margin-inline", "auto");
  }
}
