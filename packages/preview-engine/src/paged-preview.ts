import {
  getPaperDimensionsMm,
  type ExportConfig,
  type MarkdownDocumentMetadata,
  type PagedDocumentPayload
} from "@morphdoc/core";
export const PAGED_PREVIEW_MESSAGE_SCOPE = "morphdoc:paged-preview";

export type PreviewMetadata = MarkdownDocumentMetadata;
export type PagedPreviewPayload = PagedDocumentPayload;

export interface PagedPreviewRenderRequest {
  scope: typeof PAGED_PREVIEW_MESSAGE_SCOPE;
  type: "render";
  requestId: number;
  layout: "paged" | "continuous";
  payload: PagedPreviewPayload;
}

export type PagedPreviewFrameMessage =
  | {
      scope: typeof PAGED_PREVIEW_MESSAGE_SCOPE;
      type: "ready";
    }
  | {
      scope: typeof PAGED_PREVIEW_MESSAGE_SCOPE;
      type: "link";
      href: string;
    }
  | {
      scope: typeof PAGED_PREVIEW_MESSAGE_SCOPE;
      type: "rendering";
      requestId: number;
      layout: "paged" | "continuous";
    }
  | {
      scope: typeof PAGED_PREVIEW_MESSAGE_SCOPE;
      type: "rendered";
      requestId: number;
      layout: "paged" | "continuous";
      pageCount: number;
      contentHeight: number;
      echartsErrors: string[];
      mermaidErrors: string[];
    }
  | {
      scope: typeof PAGED_PREVIEW_MESSAGE_SCOPE;
      type: "error";
      requestId: number;
      message: string;
    };

export const documentBaseCss = `
:root {
  color-scheme: light;
  background: transparent;
}

* {
  box-sizing: border-box;
}

html,
body {
  width: 100%;
  min-width: 0;
  margin: 0;
  padding: 0;
  overflow: hidden;
  background: transparent;
}

img,
svg {
  max-width: 100%;
}

#write pre.md-fences,
#write .md-code-pagination-chunk {
  min-width: 0;
  max-width: 100%;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

#write pre.md-fences > code,
#write .md-code-pagination-chunk > code {
  display: block;
  min-width: 0;
  max-width: 100%;
  padding: 0;
  padding-left: 8px;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  font-size: inherit;
  font-weight: inherit;
  line-height: inherit;
  white-space: inherit;
  overflow-wrap: inherit;
  word-break: inherit;
}

.md-document-image-block {
  break-inside: avoid;
  page-break-inside: avoid;
  text-align: center;
}

.md-document-image-block > .md-document-image {
  display: block;
  margin-inline: auto;
}

.md-document-image-caption {
  margin-top: 0.55em;
  color: #64748b;
  font-size: 0.875em;
  line-height: 1.5;
  text-align: center;
}

#write table {
  width: 100%;
  table-layout: auto;
}

#write table[data-stabilized-columns="true"] {
  table-layout: fixed !important;
}

#write th,
#write td {
  overflow-wrap: anywhere;
  word-break: break-word;
}

#write th code,
#write td code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.mermaid {
  display: flex;
  justify-content: center;
  margin: 1.5em 0;
  overflow: visible;
}

.mermaid-error {
  display: block;
  padding: 0.85em 1em;
  border: 1px solid #dc2626;
  color: #991b1b;
  background: #fef2f2;
  white-space: pre-wrap;
}

.md-echarts {
  break-inside: avoid;
  page-break-inside: avoid;
}
`;

export const documentGeometryCss = `
html,
body,
#preview-root {
  background: transparent !important;
}

#write [data-semantic-break-after="next-page"] {
  break-after: page !important;
  page-break-after: always !important;
}

#write {
  width: 100% !important;
  max-width: none !important;
  margin: 0 !important;
  padding: 0 !important;
}
`;

export const documentInteractionCss = `
:where(#write a[href]) {
  color: var(--md-link-color, var(--md-accent, #0969da));
  text-decoration-line: underline;
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.16em;
  cursor: pointer;
}

:where(#write a[href]:hover) {
  color: var(--md-link-hover-color, #0550ae);
}

:where(#write a[href]:focus-visible) {
  border-radius: 2px;
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
`;

export const continuousDocumentGeometryCss = `
html,
body,
#preview-root {
  height: auto !important;
  min-height: 0 !important;
  overflow: hidden !important;
  background: transparent !important;
}

#preview-root {
  padding: 34px 0;
}

#write {
  width: 100% !important;
  max-width: none !important;
  height: auto !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 16mm !important;
  background: #fff;
  box-shadow: 0 3px 16px rgb(34 43 38 / 16%);
}

#write[data-continuous-render-stage="true"] {
  position: fixed !important;
  inset: 0 auto auto 0 !important;
  z-index: -1 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
`;

function cssString(value: string) {
  return JSON.stringify(value)
    .replace(/\u2028/g, "\\2028 ")
    .replace(/\u2029/g, "\\2029 ");
}

function resolveHeaderContent(
  template: string,
  payload: Pick<PagedPreviewPayload, "fileName" | "metadata">
) {
  const values: Record<string, string> = {
    title: payload.metadata.title,
    author: payload.metadata.author,
    filename: payload.fileName
  };

  return template.replace(
    /\$\{(title|author|filename)\}/g,
    (_, name: string) => values[name] ?? ""
  );
}

export function formatPageNumber(
  config: ExportConfig["footer"],
  pageIndex: number,
  totalPages: number
) {
  const page = config.startFrom + pageIndex;

  if (config.format === "page") {
    return String(page);
  }
  if (config.format === "page-total") {
    return `${page} / ${totalPages}`;
  }
  if (config.format === "chinese-page-total") {
    return `第 ${page} 页 / 共 ${totalPages} 页`;
  }
  if (config.format === "dash-page") {
    return `- ${page} -`;
  }
  if (config.format === "official-page") {
    return `— ${page} —`;
  }

  return (config.template || "${page} / ${pages}")
    .replace(/\$\{page\}/g, String(page))
    .replace(/\$\{pages\}/g, String(totalPages));
}

function marginBox(
  position: "top" | "bottom",
  alignment: "left" | "center" | "right",
  content: string,
  options: {
    color: string;
    fontFamily: string;
    fontSize: string;
    height: string;
    pageMargin: string;
    showDivider: boolean;
  }
) {
  const border =
    options.showDivider && position === "top"
      ? "border-bottom: 0.2mm solid currentColor;"
      : options.showDivider
        ? "border-top: 0.2mm solid currentColor;"
        : "";
  const verticalAlignment = position === "top" ? "bottom" : "top";
  const verticalOffset =
    position === "top"
      ? `calc(${options.pageMargin} - ${options.height} - ${options.fontSize})`
      : `calc(${options.height} - ${options.fontSize})`;

  return `
  @${position}-${alignment} {
    content: ${content};
    height: ${options.height};
    color: ${options.color};
    font-family: ${options.fontFamily};
    font-size: ${options.fontSize};
    font-weight: 400;
    line-height: 1.25;
    text-align: ${alignment};
    vertical-align: ${verticalAlignment};
    transform: translateY(${verticalOffset});
    ${border}
  }`;
}

function buildHeaderCss(
  config: ExportConfig,
  payload: Pick<PagedPreviewPayload, "fileName" | "metadata">
) {
  if (!config.header.enabled) {
    return "";
  }

  const options = {
    color: config.header.color,
    fontFamily: config.header.fontFamily,
    fontSize: config.header.fontSize,
    height: config.header.height,
    pageMargin: config.paper.margins.top,
    showDivider: config.header.showDivider
  };

  return (["left", "center", "right"] as const)
    .map((alignment) => {
      const slot = config.header[alignment];
      const value = slot.enabled
        ? resolveHeaderContent(slot.content, payload)
        : "";
      return marginBox(
        "top",
        alignment,
        cssString(value),
        options
      );
    })
    .join("\n");
}

function buildFooterCss(config: ExportConfig) {
  if (!config.footer.enabled) {
    return "";
  }

  const options = {
    color: config.footer.color,
    fontFamily: config.footer.fontFamily,
    fontSize: config.footer.fontSize,
    height: config.footer.height,
    pageMargin: config.paper.margins.bottom,
    showDivider: config.footer.showDivider
  };

  return (["left", "center", "right"] as const)
    .map((alignment) =>
      marginBox(
        "bottom",
        alignment,
        alignment === config.footer.alignment
          ? cssString("")
          : cssString(""),
        options
      )
    )
    .join("\n");
}

export function resolvePageNumberAlignment(
  config: ExportConfig["footer"],
  pageIndex: number
): "left" | "center" | "right" {
  if (config.alignment !== "outer") {
    return config.alignment;
  }
  return pageIndex % 2 === 0 ? "right" : "left";
}

export function shouldRenderPageNumber(
  config: ExportConfig["footer"],
  pageIndex: number
) {
  return config.showOnFirstPage || pageIndex !== 0;
}

export function buildPagedMediaCss(
  config: ExportConfig,
  payload: Pick<PagedPreviewPayload, "fileName" | "metadata">
) {
  const dimensions = getPaperDimensionsMm(
    config.paper.format,
    config.paper.orientation
  );

  return `
@page {
  size: ${dimensions.width}mm ${dimensions.height}mm;
  margin: ${config.paper.margins.top} ${config.paper.margins.right}
    ${config.paper.margins.bottom} ${config.paper.margins.left};
${buildHeaderCss(config, payload)}
${buildFooterCss(config)}
}

#write p,
#write li {
  orphans: 3;
  widows: 3;
}

#write > p.md-inline-code-paragraph {
  orphans: 1;
  widows: 1;
}

#write li {
  text-align-last: left;
}

#write h1,
#write h2,
#write h3,
#write h4,
#write h5,
#write h6 {
  break-after: avoid;
  break-inside: avoid;
}

#write thead {
  display: table-header-group;
}

#write tfoot {
  display: table-footer-group;
}

#write tr,
#write pre,
#write blockquote,
#write .katex-display,
#write .mermaid,
#write .md-echarts {
  break-inside: avoid;
}

#write .md-code-pagination-chunk {
  break-inside: avoid;
  page-break-inside: avoid;
}

#write .md-code-pagination-chunk > code {
  display: block;
}

#write .md-code-pagination-chunk:not(
  [data-code-pagination-position="first"]
):not([data-code-pagination-position="only"]) {
  margin-top: 0 !important;
  padding-top: 0 !important;
  border-top: 0 !important;
  border-top-left-radius: 0 !important;
  border-top-right-radius: 0 !important;
}

#write .md-code-pagination-chunk:not(
  [data-code-pagination-position="last"]
):not([data-code-pagination-position="only"]) {
  margin-bottom: 0 !important;
  padding-bottom: 0 !important;
  border-bottom: 0 !important;
  border-bottom-left-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
}

#write .md-code-line-group {
  display: block;
}

#write .md-code-line {
  display: block;
  min-height: 1lh;
  white-space: inherit;
  overflow-wrap: inherit;
  word-break: inherit;
}

#write .md-code-line-indent {
  display: inline-block;
  white-space: pre;
}

#write table[data-empty-split-table="true"] {
  display: none;
}

#write img,
#write svg {
  break-inside: avoid;
  page-break-inside: avoid;
}

#write .md-document-image-block {
  break-inside: avoid;
  page-break-inside: avoid;
}

${
  config.print.pageBreakBeforeH1
    ? `#write h1:not(:first-child) {
  break-before: page;
}`
    : ""
}

.pagedjs_pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  width: max-content;
  min-width: 100%;
  margin: 0 auto;
  padding: 34px 0;
}

html[data-render-target="preview"] {
  height: 100%;
  overflow-x: hidden;
  overflow-y: hidden;
}

html[data-render-target="preview"] body {
  min-height: 100%;
  overflow: visible;
}

.pagedjs_page {
  flex: none;
  margin: 0 !important;
  background: #fff;
  box-shadow: 0 18px 48px rgb(37 49 43 / 16%);
}

html[data-render-target="pdf"],
html[data-render-target="pdf"] body {
  height: auto !important;
  min-height: 0 !important;
  overflow: visible !important;
  background: #fff !important;
  border: 0 !important;
  break-before: auto !important;
  break-after: auto !important;
  page-break-before: auto !important;
  page-break-after: auto !important;
}

html[data-render-target="pdf"] .pagedjs_pages {
  display: block;
  width: auto;
  min-width: 0;
  padding: 0;
}

html[data-render-target="pdf"] .pagedjs_page {
  box-shadow: none;
  break-after: page;
}
`;
}

export function createPagedPreviewRenderRequest(
  requestId: number,
  payload: PagedPreviewPayload,
  layout: "paged" | "continuous" = "paged"
): PagedPreviewRenderRequest {
  return {
    scope: PAGED_PREVIEW_MESSAGE_SCOPE,
    type: "render",
    requestId,
    layout,
    payload
  };
}

export function isPagedPreviewRenderRequest(
  value: unknown
): value is PagedPreviewRenderRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PagedPreviewRenderRequest>;
  return (
    candidate.scope === PAGED_PREVIEW_MESSAGE_SCOPE &&
    candidate.type === "render" &&
    Number.isInteger(candidate.requestId) &&
    (candidate.layout === "paged" ||
      candidate.layout === "continuous") &&
    Boolean(candidate.payload) &&
    typeof candidate.payload?.articleHtml === "string" &&
    typeof candidate.payload?.themeCss === "string"
  );
}

export function isPagedPreviewFrameMessage(
  value: unknown
): value is PagedPreviewFrameMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PagedPreviewFrameMessage>;
  if (
    candidate.scope !== PAGED_PREVIEW_MESSAGE_SCOPE ||
    !["ready", "link", "rendering", "rendered", "error"].includes(
      candidate.type ?? ""
    )
  ) {
    return false;
  }

  if (candidate.type === "ready") {
    return true;
  }

  if (candidate.type === "link") {
    return (
      typeof candidate.href === "string" &&
      candidate.href.trim().length > 0
    );
  }

  if (candidate.type === "rendering") {
    return (
      Number.isInteger(candidate.requestId) &&
      (candidate.layout === "paged" ||
        candidate.layout === "continuous")
    );
  }

  if (candidate.type === "error") {
    return (
      Number.isInteger(candidate.requestId) &&
      typeof candidate.message === "string"
    );
  }

  if (candidate.type !== "rendered") {
    return false;
  }
  const rendered = candidate as Partial<
    Extract<PagedPreviewFrameMessage, { type: "rendered" }>
  >;
  return (
    Number.isInteger(rendered.requestId) &&
    (rendered.layout === "paged" ||
      rendered.layout === "continuous") &&
    Number.isInteger(rendered.pageCount) &&
    typeof rendered.contentHeight === "number" &&
    Number.isFinite(rendered.contentHeight) &&
    rendered.contentHeight > 0 &&
    Array.isArray(rendered.echartsErrors) &&
    Array.isArray(rendered.mermaidErrors)
  );
}
