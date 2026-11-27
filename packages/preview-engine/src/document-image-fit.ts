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
      // 关于下面的内联 break-after / 占位标记：Paged.js 只从 CSS 规则解析 break-* 声明，元素上的
      // 内联样式会被完全忽略，所以它们对分页没有任何作用。缩放后的块撑满一页，其后的内容靠
      // “自然溢出”落到下一页。
      // 曾评估改用 forceBreakAfter（paged-break-control.ts）：只有一个标题紧接整页媒体时分页结果
      // 逐页一致，但连续标题紧接整页媒体时，迁移后流程图会额外出现重复渲染，当时据此暂不迁移。
      // 那次重复的根因是整页缩放只扣除紧邻的一个标题，已由 getPrecedingHeadingChain 修复，
      // 迁移的前提已具备，需要用修复后的构建重新评估。
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
