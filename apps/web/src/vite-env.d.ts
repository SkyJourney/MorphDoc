/// <reference types="vite/client" />

import type {
  DocxCapability,
  DocxExportDiagnostics,
  DocxExportErrorCode,
  DocxExportRequestInput,
  DocxGenerationTimings,
  DocxMediaCapturePlan,
  PagedDocumentPayload,
  PagedDocumentRenderResult,
  RenderedMarkdownDocument,
  ThemeCategory,
  DocumentProfileName
} from "@morphdoc/core";

declare global {
  const __APP_VERSION__: string;
  const __APP_DISPLAY_NAME__: string;
  const __APP_WINDOW_TITLE__: string;
  const __APP_SLOGAN__: string;
  const __APP_DESCRIPTION__: string;

  interface DesktopPdfResult {
    pdf: Uint8Array;
    pageCount: number;
    echartsErrors: string[];
    mermaidErrors: string[];
  }

  type DesktopDocxExportOutcome =
    | {
        ok: true;
        saved: boolean;
        fileName: string;
        diagnostics: DocxExportDiagnostics;
        timings: DocxGenerationTimings;
      }
    | {
        ok: false;
        error: DocxExportErrorCode;
        message: string;
        retryable: boolean;
      };

  interface DesktopApplicationBridge {
    openMarkdown(): Promise<
      | {
          markdown: string;
          fileName: string;
        }
      | undefined
    >;
    consumePendingMarkdown(): Promise<
      | {
          markdown: string;
          fileName: string;
        }
      | undefined
    >;
    discardPendingMarkdown(): Promise<void>;
    onMarkdownOpened(
      listener: (reason: "open" | "reload" | "replace") => void
    ): () => void;
    startNewMarkdown(): Promise<void>;
    createNewWindow(): Promise<void>;
    resolveWindowClose(close: boolean): Promise<void>;
    onWindowCloseRequested(listener: () => void): () => void;
    setDocumentDirty(dirty: boolean): Promise<void>;
    openDocumentLink(href: string): Promise<void>;
    saveMarkdown(
      fileName: string,
      markdown: string
    ): Promise<{ fileName: string } | undefined>;
    saveMarkdownAs(
      fileName: string,
      markdown: string
    ): Promise<{ fileName: string } | undefined>;
    openThemeDirectory(): Promise<string>;
    refreshThemes(): Promise<void>;
    renderMarkdown(input: {
      markdown: string;
      language: string;
      resources?: Array<{
        path: string;
        data: string;
      }>;
    }): Promise<RenderedMarkdownDocument>;
    listThemes(): Promise<{
      themes: Array<{
        id: string;
        name: string;
        version: string;
        description: string;
        category: ThemeCategory;
        compatibleProfiles: DocumentProfileName[];
        bundled: boolean;
        source: "bundled" | "local";
      }>;
    }>;
    getThemeCss(themeId: string): Promise<string>;
    generatePdf(payload: PagedDocumentPayload): Promise<DesktopPdfResult>;
    savePdf(fileName: string, pdf: Uint8Array): Promise<boolean>;
    getDocxCapability(): Promise<DocxCapability>;
    exportDocx(
      request: DocxExportRequestInput
    ): Promise<DesktopDocxExportOutcome>;
  }

  interface DesktopPdfRuntimeBridge {
    ready(): void;
    onRender(
      listener: (
        requestId: number,
        payload: PagedDocumentPayload
      ) => Promise<void> | void
    ): () => void;
    complete(
      requestId: number,
      result: PagedDocumentRenderResult
    ): void;
    fail(requestId: number, message: string): void;
  }

  interface Window {
    morphDocDesktop?: DesktopApplicationBridge;
    __morphDocDesktopPdf?: DesktopPdfRuntimeBridge;
    __morphDocRenderDocxMedia?: (
      payload: PagedDocumentPayload,
      dimensions: {
        contentWidthPx: number;
        contentHeightPx: number;
      }
    ) => Promise<DocxMediaCapturePlan>;
  }
}
