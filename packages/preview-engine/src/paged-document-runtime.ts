import type {
  PagedDocumentRenderResult,
  PagedDocumentTimings
} from "@morphdoc/core";
import {
  Previewer,
  type PagedBreakToken
} from "pagedjs";
import {
  createNodeSignature,
  findCommonPrefixLength,
  mountContinuousRenderStage
} from "./continuous-preview.js";
import { prepareCodeBlockPagination } from "./code-block-pagination.js";
import { fitOversizedEChartsToPage } from "./echarts-page-fit.js";
import {
  fitDocumentImagesToPage,
  prepareDocumentImageBlocks
} from "./document-image-fit.js";
import {
  assignPagedSourceReferences,
  createIncrementalPaginationPlan,
  type IncrementalPaginationPlan
} from "./incremental-pagination.js";
import {
  applyMediaBackfillCandidates,
  findMediaBackfillCandidates,
  getMediaBackfillIdsInDocumentOrder,
  prepareMediaBackfillBlocks
} from "./media-page-backfill.js";
import { createMermaidSiteConfig } from "./mermaid-config.js";
import {
  fitOversizedMermaidToPage,
  getPageContentDimensions
} from "./mermaid-page-fit.js";
import { renderMermaidDefinitions } from "./mermaid-renderer.js";
import { replaceMermaidSvgWithImages } from "./mermaid-static-image.js";
import type { MermaidOutputMode } from "./mermaid-static-image.js";
import { enablePrintMediaForPreview } from "./preview-styles.js";
import {
  forcePagedTableRowsToNextPage,
  missingPagedTableRowIds,
  stabilizePagedTableColumns
} from "./paged-table-handler.js";
import {
  buildPagedMediaCss,
  continuousDocumentGeometryCss,
  documentBaseCss,
  documentGeometryCss,
  documentInteractionCss,
  type PagedPreviewPayload
} from "./paged-preview.js";
import { constrainSemanticCoversToPage } from "./semantic-cover-fit.js";
import type { PagedRenderTarget } from "./paged-render-target.js";
import { preparePdfDocumentLinks } from "./pdf-document-links.js";
import { classifyPagedPages } from "./paged-page-sequence.js";
import { applyPagedPageDecorations } from "./paged-page-decorations.js";

export type {
  PagedDocumentRenderResult,
  PagedDocumentTimings
} from "@morphdoc/core";

export interface PagedDocumentRenderOptions {
  target: PagedRenderTarget;
  shouldContinue?: () => boolean;
  mermaidOutput?: MermaidOutputMode;
  allowIncompleteTableGeometry?: boolean;
}

export interface ContinuousDocumentRenderOptions {
  shouldContinue?: () => boolean;
  geometryCss?: string;
  themeMedia?: "preview" | "print";
}

export interface PreviewEngineStyles {
  highlightCss: string;
  katexCss: string;
  echartsCss: string;
}

export function protectFittableInlineCodeParagraphs(
  root: ParentNode,
  pageContentHeightPx: number
) {
  if (!Number.isFinite(pageContentHeightPx) || pageContentHeightPx <= 0) {
    return 0;
  }
  let protectedCount = 0;
  for (const paragraph of root.querySelectorAll<HTMLElement>(
    "#write > p.md-inline-code-paragraph"
  )) {
    const height = paragraph.getBoundingClientRect().height;
    if (!(height > 0 && height <= pageContentHeightPx)) {
      continue;
    }
    paragraph.style.setProperty("break-inside", "avoid", "important");
    paragraph.style.setProperty(
      "page-break-inside",
      "avoid",
      "important"
    );
    paragraph.dataset.morphdocInlineCodeKeepWhole = "true";
    protectedCount += 1;
  }
  return protectedCount;
}

export const DEFAULT_IMAGE_READY_TIMEOUT_MS = 10_000;

function waitForImage(
  image: HTMLImageElement,
  timeoutMs: number
) {
  if (image.complete) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      image.removeEventListener("load", finish);
      image.removeEventListener("error", finish);
      resolve();
    };
    const timeout = window.setTimeout(finish, timeoutMs);

    // 先监听事件，再检查 complete 和调用 decode，避免 Electron 中图片
    // 已经失败后才注册 error 监听器而永久等待。
    image.addEventListener("load", finish, { once: true });
    image.addEventListener("error", finish, { once: true });
    if (image.complete) {
      finish();
      return;
    }

    void image.decode().then(finish, () => {
      // decode 失败时仍允许尚未到达的 load/error 事件完成等待；若事件
      // 已经发生，complete 会立即结束。最终由有界超时兜底。
      if (image.complete) {
        finish();
      }
    });
  });
}

export function waitForImages(
  container: ParentNode,
  timeoutMs = DEFAULT_IMAGE_READY_TIMEOUT_MS
) {
  const images = Array.from(container.querySelectorAll("img"));
  return Promise.all(images.map((image) => waitForImage(image, timeoutMs)));
}

function stylesheet(
  documentRef: Document,
  css: string,
  name: string
) {
  return {
    [`${documentRef.location.href}#${name}`]: css
  };
}

function mountMeasurementContainer(
  documentRef: Document,
  content: DocumentFragment,
  payload: PagedPreviewPayload,
  target: PagedRenderTarget,
  styles: PreviewEngineStyles
) {
  const pageContent = getPageContentDimensions(payload.exportConfig);
  const style = documentRef.createElement("style");
  const themeCss =
    target === "preview"
      ? enablePrintMediaForPreview(payload.themeCss)
      : payload.themeCss;
  style.dataset.pagedMeasurementStyle = "true";
  style.textContent = [
    documentBaseCss,
    styles.highlightCss,
    styles.katexCss,
    styles.echartsCss,
    themeCss,
    documentInteractionCss,
    documentGeometryCss
  ].join("\n");

  const host = documentRef.createElement("div");
  host.dataset.pagedMeasurementHost = "true";
  host.style.cssText = [
    "position: fixed",
    "left: -100000px",
    "top: 0",
    `width: ${pageContent.width}px`,
    "height: auto",
    "opacity: 0",
    "pointer-events: none",
    "contain: layout style paint"
  ].join(";");

  documentRef.head.append(style);
  host.append(content);
  documentRef.body.append(host);

  return {
    host,
    restore() {
      content.append(...Array.from(host.childNodes));
      host.remove();
      style.remove();
    }
  };
}

function removeTrailingPdfPageBreak(container: ParentNode) {
  const pages = Array.from(
    container.querySelectorAll<HTMLElement>(".pagedjs_page")
  );
  pages
    .at(-1)
    ?.style.setProperty("break-after", "auto", "important");
}

const PAGED_SPLIT_BLOCK_SELECTOR = [
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li",
  "blockquote", "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  "figure", "figcaption", "pre", "section", "article", "div"
].join(",");

export function removeInheritedPagedSplitJustification(
  container: ParentNode
) {
  let count = 0;
  for (const element of Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-align-last-split-element="justify"]'
    )
  )) {
    if (
      !Array.from(element.children).some((child) =>
        child.matches(PAGED_SPLIT_BLOCK_SELECTOR)
      )
    ) {
      continue;
    }
    element.removeAttribute("data-align-last-split-element");
    count += 1;
  }
  return count;
}

function createPagedRenderIdentity(
  payload: PagedPreviewPayload,
  options: PagedDocumentRenderOptions
) {
  return JSON.stringify({
    target: options.target,
    mermaidOutput: options.mermaidOutput,
    themeCss: payload.themeCss,
    exportConfig: payload.exportConfig,
    semanticDocument: payload.semanticDocument,
    metadata: payload.metadata,
    features: payload.features
  });
}

function getArticle(container: ParentNode) {
  return (
    container.querySelector<HTMLElement>("#write") ?? undefined
  );
}

function replacePreparedPrefix(
  nextArticle: HTMLElement,
  previousArticle: HTMLElement,
  prefixLength: number
) {
  const nextNodes = Array.from(nextArticle.childNodes);
  const previousNodes = Array.from(previousArticle.childNodes);
  for (let index = 0; index < prefixLength; index += 1) {
    const nextNode = nextNodes[index];
    const previousNode = previousNodes[index];
    if (!nextNode || !previousNode) {
      break;
    }
    nextNode.replaceWith(previousNode.cloneNode(true));
  }
}

function collectRenderErrors(
  container: ParentNode,
  selector: string
) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(selector)
  ).map(
    (element, index) =>
      `图表 ${index + 1}：${
        element.textContent?.trim() || "未知错误"
      }`
  );
}

export class PagedDocumentRuntime {
  private activePreviewer: Previewer | undefined;
  private pagedIdentity = "";
  private pagedLastResult:
    | PagedDocumentRenderResult
    | undefined;
  private pagedReferenceSequence = 0;
  private pagedSignatures: string[] = [];
  private mermaidRenderSequence = 0;
  private mermaidPromise:
    | Promise<(typeof import("mermaid"))["default"]>
    | undefined;
  private echartsPromise:
    | Promise<
        typeof import("@morphdoc/markdown-echarts/browser")
      >
    | undefined;
  private continuousSignatures: string[] = [];
  private continuousIdentity = "";
  private continuousStyle: HTMLStyleElement | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly styles: PreviewEngineStyles
  ) {}

  private disposeActivePreviewer() {
    if (!this.activePreviewer) {
      return;
    }

    this.activePreviewer.chunker.destroy();
    this.activePreviewer.polisher.destroy();
    this.activePreviewer = undefined;
  }

  private resetPagedState() {
    this.pagedIdentity = "";
    this.pagedLastResult = undefined;
    this.pagedSignatures = [];
  }

  destroy() {
    this.disposeActivePreviewer();
    this.resetPagedState();
  }

  private createPagedReference() {
    this.pagedReferenceSequence += 1;
    return `md-paged-${this.pagedReferenceSequence}`;
  }

  private async continuePagination(
    previewer: Previewer,
    plan: Pick<
      IncrementalPaginationPlan,
      "invalidationPageIndex" | "startToken"
    >
  ) {
    const chunker = previewer.chunker;
    chunker.rendered = false;
    chunker.removePages(plan.invalidationPageIndex);
    await chunker.loadFonts();
    const rendered = await chunker.render(
      chunker.source,
      plan.startToken as PagedBreakToken | undefined
    );
    if (rendered.canceled) {
      throw new Error("Paged.js 增量分页被中断");
    }
    chunker.rendered = true;
    chunker.pagesArea.style.setProperty(
      "--pagedjs-page-count",
      String(chunker.total)
    );
    await chunker.hooks.afterRendered.trigger(
      chunker.pages,
      chunker
    );
    return chunker.total;
  }

  private async continueMediaBackfill(
    previewer: Previewer,
    shouldContinue: () => boolean
  ) {
    const source = previewer.chunker.source;
    const mediaIds = getMediaBackfillIdsInDocumentOrder(source);
    let candidates = new Map(
      findMediaBackfillCandidates(this.root).map((candidate) => [
        candidate.id,
        candidate
      ])
    );

    for (const mediaId of mediaIds) {
      if (!shouldContinue()) {
        break;
      }
      const candidate = candidates.get(mediaId);
      const sourceBlock = Array.from(
        source.querySelectorAll<HTMLElement>(
          "[data-media-backfill-id]"
        )
      ).find(
        (element) =>
          element.dataset.mediaBackfillId === mediaId
      );
      if (
        !candidate ||
        !sourceBlock ||
        sourceBlock.dataset.mediaBackfilled === "true"
      ) {
        continue;
      }

      const pageIndex = previewer.chunker.pages.findIndex(
        (page) =>
          Array.from(
            page.element.querySelectorAll<HTMLElement>(
              "[data-media-backfill-id]"
            )
          ).some(
            (element) =>
              element.dataset.mediaBackfillId === mediaId
          )
      );
      if (
        pageIndex < 0 ||
        applyMediaBackfillCandidates(source, [candidate]) === 0
      ) {
        continue;
      }

      const invalidationPageIndex = Math.max(0, pageIndex - 1);
      await this.continuePagination(previewer, {
        invalidationPageIndex,
        startToken:
          previewer.chunker.pages[invalidationPageIndex]
            ?.startToken
      });
      candidates = new Map(
        findMediaBackfillCandidates(this.root).map(
          (nextCandidate) => [
            nextCandidate.id,
            nextCandidate
          ]
        )
      );
    }

    return previewer.chunker.total;
  }

  private resetContinuousState() {
    this.continuousSignatures = [];
    this.continuousIdentity = "";
    this.continuousStyle?.remove();
    this.continuousStyle = undefined;
  }

  private applyContinuousStyles(
    documentRef: Document,
    payload: PagedPreviewPayload,
    geometryCss = "",
    themeMedia: ContinuousDocumentRenderOptions["themeMedia"] = "preview"
  ) {
    const style =
      this.continuousStyle ?? documentRef.createElement("style");
    style.dataset.continuousPreviewStyle = "true";
    style.textContent = [
      documentBaseCss,
      this.styles.highlightCss,
      this.styles.katexCss,
      this.styles.echartsCss,
      themeMedia === "preview"
        ? enablePrintMediaForPreview(payload.themeCss)
        : payload.themeCss,
      documentInteractionCss,
      continuousDocumentGeometryCss,
      geometryCss
    ].join("\n");
    if (!style.isConnected) {
      documentRef.head.append(style);
    }
    this.continuousStyle = style;
  }

  private loadMermaid() {
    if (!this.mermaidPromise) {
      this.mermaidPromise = Promise.all([
        import("mermaid"),
        import("@mermaid-js/layout-elk")
      ]).then(
        ([{ default: mermaid }, { default: elkLayouts }]) => {
          mermaid.registerLayoutLoaders(elkLayouts);
          return mermaid;
        }
      );
    }

    return this.mermaidPromise;
  }

  private loadECharts() {
    if (!this.echartsPromise) {
      this.echartsPromise = import(
        "@morphdoc/markdown-echarts/browser"
      );
    }
    return this.echartsPromise;
  }

  private async renderECharts(
    container: ParentNode,
    payload: PagedPreviewPayload,
    concurrency = 2
  ) {
    if (!payload.features.includes("echarts")) {
      return [];
    }

    const { renderEChartsBlocks } = await this.loadECharts();
    const outcomes = await renderEChartsBlocks(container, {
      outputMode: "inline-svg",
      concurrency,
      timeoutMs: 5_000
    });

    return outcomes.flatMap((outcome, index) =>
      outcome.success
        ? []
        : [
            `图表 ${index + 1}：${
              outcome.error?.message ?? "未知错误"
            }`
          ]
    );
  }

  private async replaceEChartsSvgWithImages(container: ParentNode) {
    const { freezeEChartsSvg } = await this.loadECharts();
    const figures = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".md-echarts:not(.md-echarts-error)"
      )
    );
    for (const figure of figures) {
      const host = figure.querySelector<HTMLElement>(
        ".md-echarts-host"
      );
      const svg = host?.querySelector<SVGSVGElement>("svg");
      if (!host || !svg) {
        continue;
      }
      const label =
        host.getAttribute("aria-label") || "ECharts 图表";
      host.replaceChildren(
        freezeEChartsSvg(host, svg, "svg-image", label)
      );
      figure.dataset.echartsRendered = "svg-image";
    }
    await waitForImages(container);
  }

  private async renderMermaid(
    container: DocumentFragment,
    payload: PagedPreviewPayload
  ) {
    if (!payload.features.includes("mermaid")) {
      return [];
    }

    const nodes = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".mermaid[data-mermaid-pending]"
      )
    );
    if (nodes.length === 0) {
      return [];
    }

    const mermaid = await this.loadMermaid();
    mermaid.initialize(
      createMermaidSiteConfig(payload.exportConfig.mermaid)
    );
    const outcomes = await renderMermaidDefinitions(
      nodes.map((node) => node.textContent ?? ""),
      async (definition) => {
        this.mermaidRenderSequence += 1;
        return mermaid.render(
          `mermaid-paged-document-${this.mermaidRenderSequence}`,
          definition
        );
      }
    );
    const errors: string[] = [];

    for (const [index, outcome] of outcomes.entries()) {
      const node = nodes[index];
      if (!node) {
        continue;
      }

      node.removeAttribute("data-mermaid-pending");
      if (outcome.success) {
        node.innerHTML = outcome.svg;
        outcome.bindFunctions?.(node);
        continue;
      }

      const message =
        outcome.error instanceof Error
          ? outcome.error.message
          : "未知错误";
      node.classList.add("mermaid-error");
      node.textContent =
        `Mermaid 图表 ${index + 1} 渲染失败：${message}`;
      errors.push(`图表 ${index + 1}：${message}`);
    }

    return errors;
  }

  async render(
    payload: PagedPreviewPayload,
    options: PagedDocumentRenderOptions
  ): Promise<PagedDocumentRenderResult | undefined> {
    const totalStartedAt = performance.now();
    const shouldContinue = options.shouldContinue ?? (() => true);
    if (!shouldContinue()) {
      return undefined;
    }

    const setupStartedAt = performance.now();
    const documentRef = this.root.ownerDocument;
    this.resetContinuousState();
    documentRef.documentElement.dataset.renderTarget = options.target;
    documentRef.documentElement.dataset.previewLayout = "paged";
    documentRef.documentElement.lang =
      payload.metadata.language || "zh-CN";
    documentRef.title =
      payload.metadata.title || "Markdown 分页文档";

    const template = documentRef.createElement("template");
    template.innerHTML = payload.articleHtml;
    let content = template.content;
    const nextArticle = getArticle(content);
    if (!nextArticle) {
      throw new Error("分页预览缺少 #write 文档容器");
    }
    if (options.target === "pdf") {
      preparePdfDocumentLinks(nextArticle);
    }
    const nextSignatures = Array.from(
      nextArticle.childNodes
    ).map(createNodeSignature);
    const pagedIdentity = createPagedRenderIdentity(
      payload,
      options
    );
    const cachedSource = this.activePreviewer?.chunker.source;
    const cachedArticle = cachedSource
      ? getArticle(cachedSource)
      : undefined;
    const prefixLength =
      options.target === "preview" &&
      cachedArticle &&
      pagedIdentity === this.pagedIdentity
        ? findCommonPrefixLength(
            this.pagedSignatures,
            nextSignatures
          )
        : 0;

    if (
      this.pagedLastResult &&
      prefixLength === this.pagedSignatures.length &&
      prefixLength === nextSignatures.length
    ) {
      return this.pagedLastResult;
    }

    const incrementalPlan =
      cachedArticle && this.activePreviewer
        ? createIncrementalPaginationPlan(
            prefixLength,
            this.pagedSignatures.length,
            Array.from(cachedArticle.childNodes),
            this.activePreviewer.chunker.pages
          )
        : undefined;
    const incrementalPreviewer = incrementalPlan
      ? this.activePreviewer
      : undefined;

    if (incrementalPlan && cachedArticle) {
      replacePreparedPrefix(
        nextArticle,
        cachedArticle,
        incrementalPlan.prefixLength
      );
    } else {
      this.disposeActivePreviewer();
      this.resetPagedState();
      this.root.replaceChildren();
    }
    prepareCodeBlockPagination(nextArticle);
    const setupMs = performance.now() - setupStartedAt;

    const mermaidStartedAt = performance.now();
    let mermaidErrors = await this.renderMermaid(content, payload);
    const mermaidMs = performance.now() - mermaidStartedAt;

    let echartsErrors: string[] = [];
    let echartsMs = 0;
    let echartsFitMs = 0;
    let mermaidFitMs = 0;
    let mermaidConversionMs = 0;
    if (
      payload.features.includes("echarts") ||
      content.querySelector(".mermaid svg") ||
      content.querySelector("img.md-document-image") ||
      content.querySelector("table") ||
      content.querySelector('[data-semantic-region="cover"]')
    ) {
      const measurement = mountMeasurementContainer(
        documentRef,
        content,
        payload,
        options.target,
        this.styles
      );
      try {
        await documentRef.fonts.ready;
        protectFittableInlineCodeParagraphs(
          measurement.host,
          getPageContentDimensions(payload.exportConfig).height
        );
        stabilizePagedTableColumns(
          measurement.host,
          getPageContentDimensions(payload.exportConfig).height
        );
        constrainSemanticCoversToPage(
          measurement.host,
          getPageContentDimensions(payload.exportConfig).height
        );

        const echartsStartedAt = performance.now();
        echartsErrors = await this.renderECharts(
          measurement.host,
          payload
        );
        echartsMs = performance.now() - echartsStartedAt;
        await waitForImages(measurement.host);
        prepareDocumentImageBlocks(measurement.host);
        prepareMediaBackfillBlocks(measurement.host);
        fitDocumentImagesToPage(
          measurement.host,
          payload.exportConfig,
          { prepareBlocks: false }
        );

        const echartsFitStartedAt = performance.now();
        fitOversizedEChartsToPage(
          measurement.host,
          payload.exportConfig
        );
        await this.replaceEChartsSvgWithImages(measurement.host);
        echartsFitMs =
          performance.now() - echartsFitStartedAt;

        const mermaidFitStartedAt = performance.now();
        fitOversizedMermaidToPage(
          measurement.host,
          payload.exportConfig
        );
        mermaidFitMs = performance.now() - mermaidFitStartedAt;

        const mermaidConversionStartedAt = performance.now();
        if (options.mermaidOutput === "svg-image") {
          replaceMermaidSvgWithImages(measurement.host);
          await waitForImages(measurement.host);
        }
        mermaidConversionMs =
          performance.now() - mermaidConversionStartedAt;
      } finally {
        measurement.restore();
      }
    }

    if (incrementalPlan) {
      mermaidErrors = collectRenderErrors(
        content,
        ".mermaid-error"
      );
      echartsErrors = collectRenderErrors(
        content,
        ".md-echarts-error"
      );
    }

    if (!shouldContinue()) {
      return undefined;
    }

    const resourceWaitStartedAt = performance.now();
    await documentRef.fonts.ready;
    await waitForImages(content);
    const resourceWaitMs = performance.now() - resourceWaitStartedAt;

    const paginationStartedAt = performance.now();
    const stylesheets = [
      stylesheet(documentRef, documentBaseCss, "document-base"),
      stylesheet(
        documentRef,
        this.styles.highlightCss,
        "highlight"
      ),
      stylesheet(documentRef, this.styles.katexCss, "katex"),
      stylesheet(documentRef, this.styles.echartsCss, "echarts"),
      stylesheet(documentRef, payload.themeCss, "theme"),
      stylesheet(
        documentRef,
        documentInteractionCss,
        "document-interaction"
      ),
      stylesheet(
        documentRef,
        documentGeometryCss,
        "document-geometry"
      ),
      stylesheet(
        documentRef,
        buildPagedMediaCss(payload.exportConfig, payload),
        "paged-media"
      )
    ];
    const paginateFully = async (sourceContent: DocumentFragment) => {
      const repaginationSource = sourceContent.cloneNode(
        true
      ) as DocumentFragment;
      let previewer = new Previewer();
      this.activePreviewer = previewer;
      let flow = await previewer.preview(
        sourceContent,
        stylesheets,
        this.root
      );
      const maximumTableRowRecoveryAttempts = 3;
      for (
        let attempt = 0;
        attempt < maximumTableRowRecoveryAttempts;
        attempt += 1
      ) {
        const missingRowIds = missingPagedTableRowIds(
          repaginationSource,
          this.root
        );
        if (missingRowIds.length === 0) {
          break;
        }
        const recoveredCount = forcePagedTableRowsToNextPage(
          repaginationSource,
          missingRowIds
        );
        if (recoveredCount !== missingRowIds.length) {
          throw new Error(
            `分页表格行恢复标记不完整：缺失 ${missingRowIds.length} 行，` +
              `仅定位 ${recoveredCount} 行`
          );
        }
        previewer.chunker.destroy();
        previewer.polisher.destroy();
        previewer = new Previewer();
        this.activePreviewer = previewer;
        flow = await previewer.preview(
          repaginationSource.cloneNode(true) as DocumentFragment,
          stylesheets,
          this.root
        );
      }
      const unresolvedTableRowIds = missingPagedTableRowIds(
        repaginationSource,
        this.root
      );
      if (
        unresolvedTableRowIds.length > 0 &&
        !options.allowIncompleteTableGeometry
      ) {
        throw new Error(
          `分页后表格正文行缺失：${unresolvedTableRowIds.join(", ")}`
        );
      }
      const mediaIds = getMediaBackfillIdsInDocumentOrder(
        repaginationSource
      );
      let mediaCandidates = new Map(
        findMediaBackfillCandidates(this.root).map(
          (candidate) => [candidate.id, candidate]
        )
      );
      for (const mediaId of mediaIds) {
        if (!shouldContinue()) {
          break;
        }
        const candidate = mediaCandidates.get(mediaId);
        if (
          !candidate ||
          applyMediaBackfillCandidates(repaginationSource, [
            candidate
          ]) === 0
        ) {
          continue;
        }

        previewer.chunker.destroy();
        previewer.polisher.destroy();
        previewer = new Previewer();
        this.activePreviewer = previewer;
        flow = await previewer.preview(
          repaginationSource.cloneNode(
            true
          ) as DocumentFragment,
          stylesheets,
          this.root
        );
        mediaCandidates = new Map(
          findMediaBackfillCandidates(this.root).map(
            (nextCandidate) => [
              nextCandidate.id,
              nextCandidate
            ]
          )
        );
      }
      return flow.total;
    };

    let pageCount: number;
    if (incrementalPlan && incrementalPreviewer) {
      const fallbackContent = content.cloneNode(
        true
      ) as DocumentFragment;
      try {
        const source = incrementalPreviewer.chunker.source;
        const sourceArticle = getArticle(source);
        const preparedArticle = getArticle(content);
        if (!sourceArticle || !preparedArticle) {
          throw new Error("分页缓存缺少 #write 文档容器");
        }

        const sourceNodes = Array.from(
          sourceArticle.childNodes
        );
        for (
          let index = sourceNodes.length - 1;
          index >= incrementalPlan.prefixLength;
          index -= 1
        ) {
          sourceNodes[index]?.remove();
        }
        const preparedNodes = Array.from(
          preparedArticle.childNodes
        );
        for (const node of preparedNodes.slice(
          incrementalPlan.prefixLength
        )) {
          assignPagedSourceReferences(
            node,
            () => this.createPagedReference()
          );
          sourceArticle.append(node);
        }

        await incrementalPreviewer.chunker.hooks.afterParsed.trigger(
          source,
          incrementalPreviewer.chunker
        );
        pageCount = await this.continuePagination(
          incrementalPreviewer,
          incrementalPlan
        );
        pageCount = await this.continueMediaBackfill(
          incrementalPreviewer,
          shouldContinue
        );
      } catch {
        this.disposeActivePreviewer();
        this.resetPagedState();
        this.root.replaceChildren();
        content = fallbackContent;
        pageCount = await paginateFully(content);
      }
    } else {
      pageCount = await paginateFully(content);
    }
    const paginationMs = performance.now() - paginationStartedAt;

    if (!shouldContinue()) {
      this.disposeActivePreviewer();
      this.resetPagedState();
      this.root.replaceChildren();
      return undefined;
    }

    const finalizeStartedAt = performance.now();
    removeInheritedPagedSplitJustification(this.root);
    const pageSequence = classifyPagedPages(this.root, payload);
    pageCount = pageSequence.physicalPageCount;
    applyPagedPageDecorations(this.root, payload, pageSequence);
    if (options.target === "pdf") {
      removeTrailingPdfPageBreak(this.root);
    }
    const finalizeMs = performance.now() - finalizeStartedAt;

    const result: PagedDocumentRenderResult = {
      pageCount,
      echartsErrors,
      mermaidErrors,
      timings: {
        setupMs,
        echartsMs,
        echartsFitMs,
        mermaidMs,
        mermaidFitMs,
        mermaidConversionMs,
        resourceWaitMs,
        paginationMs,
        finalizeMs,
        totalMs: performance.now() - totalStartedAt
      }
    };
    if (options.target === "preview") {
      this.pagedIdentity = pagedIdentity;
      this.pagedSignatures = nextSignatures;
      this.pagedLastResult = result;
    } else {
      this.resetPagedState();
    }
    return result;
  }

  async renderContinuous(
    payload: PagedPreviewPayload,
    options: ContinuousDocumentRenderOptions = {}
  ): Promise<PagedDocumentRenderResult | undefined> {
    const totalStartedAt = performance.now();
    const shouldContinue = options.shouldContinue ?? (() => true);
    if (!shouldContinue()) {
      return undefined;
    }

    const setupStartedAt = performance.now();
    const documentRef = this.root.ownerDocument;
    this.destroy();
    documentRef.documentElement.dataset.renderTarget = "preview";
    documentRef.documentElement.dataset.previewLayout = "continuous";
    documentRef.documentElement.lang =
      payload.metadata.language || "zh-CN";
    documentRef.title =
      payload.metadata.title || "Markdown 连续预览";
    this.applyContinuousStyles(
      documentRef,
      payload,
      options.geometryCss,
      options.themeMedia
    );

    const template = documentRef.createElement("template");
    template.innerHTML = payload.articleHtml;
    const nextArticle =
      template.content.querySelector<HTMLElement>("#write");
    if (!nextArticle) {
      throw new Error("连续预览缺少 #write 文档容器");
    }
    const nextNodes = Array.from(nextArticle.childNodes);
    const nextSignatures = nextNodes.map(createNodeSignature);
    const identity = JSON.stringify({
      themeCss: payload.themeCss,
      mermaid: payload.exportConfig.mermaid,
      geometryCss: options.geometryCss,
      themeMedia: options.themeMedia ?? "preview"
    });
    const currentArticle =
      this.root.querySelector<HTMLElement>(":scope > #write");
    const prefixLength =
      currentArticle && identity === this.continuousIdentity
        ? findCommonPrefixLength(
            this.continuousSignatures,
            nextSignatures
          )
        : 0;
    const suffix = documentRef.createDocumentFragment();
    for (const node of nextNodes.slice(prefixLength)) {
      suffix.append(node);
    }
    const setupMs = performance.now() - setupStartedAt;

    const mermaidStartedAt = performance.now();
    const mermaidErrors = await this.renderMermaid(suffix, payload);
    const mermaidMs = performance.now() - mermaidStartedAt;

    const resourceWaitStartedAt = performance.now();
    await documentRef.fonts.ready;
    const stage = mountContinuousRenderStage(
      this.root,
      nextArticle,
      suffix
    );
    let renderedSuffix: DocumentFragment;
    let echartsErrors: string[];
    let echartsMs: number;
    let resourceWaitMs: number;
    try {
      stage.article.getBoundingClientRect();
      const echartsStartedAt = performance.now();
      echartsErrors = await this.renderECharts(
        stage.article,
        payload,
        1
      );
      echartsMs = performance.now() - echartsStartedAt;
      await waitForImages(stage.article);
      resourceWaitMs =
        performance.now() - resourceWaitStartedAt;
      if (!shouldContinue()) {
        return undefined;
      }
      renderedSuffix = stage.takeContent();
    } finally {
      stage.dispose();
    }

    const finalizeStartedAt = performance.now();
    let article = currentArticle;
    if (!article || prefixLength === 0) {
      article = nextArticle.cloneNode(false) as HTMLElement;
      this.root.replaceChildren(article);
    } else {
      for (
        let index = article.childNodes.length - 1;
        index >= prefixLength;
        index -= 1
      ) {
        article.childNodes[index]?.remove();
      }
    }
    article.append(renderedSuffix);
    this.continuousSignatures = nextSignatures;
    this.continuousIdentity = identity;
    const finalizeMs = performance.now() - finalizeStartedAt;

    return {
      pageCount: 0,
      echartsErrors,
      mermaidErrors,
      timings: {
        setupMs,
        echartsMs,
        echartsFitMs: 0,
        mermaidMs,
        mermaidFitMs: 0,
        mermaidConversionMs: 0,
        resourceWaitMs,
        paginationMs: 0,
        finalizeMs,
        totalMs: performance.now() - totalStartedAt
      }
    };
  }
}

declare global {
  interface Window {
    __morphDocRender?: (
      payload: PagedPreviewPayload,
      target?: PagedRenderTarget
    ) => Promise<PagedDocumentRenderResult>;
  }
}
