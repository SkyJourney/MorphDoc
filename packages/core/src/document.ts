import type { ExportConfig } from "./export-config.js";
import type { DocumentProfile } from "./document-profile.js";
import type { SemanticDocumentModel } from "./semantic-document.js";
import type { ThemeFeature } from "./theme.js";

export interface MarkdownDocumentMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string[];
  language: string;
  document?: DocumentProfile;
}

export interface RenderedMarkdownDocument {
  rendererVersion: number;
  articleHtml: string;
  bodyHtml: string;
  metadata: MarkdownDocumentMetadata;
  semanticDocument: SemanticDocumentModel;
  features: ThemeFeature[];
  warnings: string[];
}

export interface PagedDocumentPayload {
  articleHtml: string;
  fileName: string;
  metadata: MarkdownDocumentMetadata;
  semanticDocument: SemanticDocumentModel;
  features: ThemeFeature[];
  themeCss: string;
  exportConfig: ExportConfig;
}

export interface CreatePagedDocumentPayloadOptions {
  document: RenderedMarkdownDocument;
  fileName: string;
  themeCss: string;
  exportConfig: ExportConfig;
}

export function createPagedDocumentPayload({
  document,
  fileName,
  themeCss,
  exportConfig
}: CreatePagedDocumentPayloadOptions): PagedDocumentPayload {
  return {
    articleHtml: document.articleHtml,
    fileName,
    metadata: document.metadata,
    semanticDocument: document.semanticDocument,
    features: document.features,
    themeCss,
    exportConfig
  };
}

export interface PagedDocumentTimings {
  setupMs: number;
  echartsMs: number;
  echartsFitMs: number;
  mermaidMs: number;
  mermaidFitMs: number;
  mermaidConversionMs: number;
  resourceWaitMs: number;
  paginationMs: number;
  finalizeMs: number;
  totalMs: number;
}

export interface PagedDocumentRenderResult {
  pageCount: number;
  echartsErrors: string[];
  mermaidErrors: string[];
  timings: PagedDocumentTimings;
}
