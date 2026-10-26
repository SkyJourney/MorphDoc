import type {
  ExportConfig,
  PagedDocumentPayload
} from "@morphdoc/core";
import type { MarkdownImageResource } from "./application-backend";

export interface PdfExportRequest {
  markdown: string;
  fileName: string;
  language: string;
  resources: MarkdownImageResource[];
  exportConfig: ExportConfig;
}

export interface PdfExportResult {
  blob: Blob;
  fileName: string;
  pageCount: number | undefined;
  echartsErrorCount: number;
  mermaidErrorCount: number;
}

export interface CachedPdfExport {
  key: string;
  result: PdfExportResult;
}

export function createPdfExportCacheKey(request: PdfExportRequest) {
  return JSON.stringify([
    request.markdown,
    request.fileName,
    request.language,
    request.resources,
    request.exportConfig
  ]);
}

export function getCachedPdfExport(
  cache: CachedPdfExport | undefined,
  key: string
) {
  return cache?.key === key ? cache.result : undefined;
}

export async function getOrRequestPdfExport(
  request: PdfExportRequest,
  cache: CachedPdfExport | undefined,
  requester: (
    request: PdfExportRequest
  ) => Promise<PdfExportResult> = requestPdfExport
): Promise<CachedPdfExport> {
  const key = createPdfExportCacheKey(request);
  const cached = getCachedPdfExport(cache, key);
  return {
    key,
    result: cached ?? (await requester(request))
  };
}

function parseNumericHeader(value: string | null) {
  if (value === null) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function parseContentDispositionFileName(
  contentDisposition: string | null,
  fallbackFileName = "document.pdf"
) {
  const encoded = contentDisposition?.match(
    /filename\*=UTF-8''([^;]+)/i
  )?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // 使用兼容文件名回退。
    }
  }

  return (
    contentDisposition
      ?.match(/filename="([^"]+)"/i)?.[1]
      ?.trim() || fallbackFileName
  );
}

async function readErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as {
      message?: unknown;
    };
    if (typeof payload.message === "string") {
      return payload.message;
    }
  } catch {
    // 非 JSON 错误响应使用通用提示。
  }
  return "PDF 导出失败";
}

export async function requestPdfExport(
  request: PdfExportRequest,
  fetcher: typeof fetch = fetch
): Promise<PdfExportResult> {
  const response = await fetcher("/api/pdf", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return {
    blob: await response.blob(),
    fileName: parseContentDispositionFileName(
      response.headers.get("content-disposition")
    ),
    pageCount: parseNumericHeader(
      response.headers.get("x-pdf-page-count")
    ),
    echartsErrorCount:
      parseNumericHeader(
        response.headers.get("x-echarts-error-count")
      ) ?? 0,
    mermaidErrorCount:
      parseNumericHeader(
        response.headers.get("x-mermaid-error-count")
      ) ?? 0
  };
}

export async function requestDesktopPdfExport(
  payload: PagedDocumentPayload
): Promise<PdfExportResult> {
  const bridge = window.morphDocDesktop;
  if (!bridge) {
    throw new Error("桌面 PDF 引擎不可用");
  }

  const result = await bridge.generatePdf(payload);
  const pdfBytes = Uint8Array.from(result.pdf);
  return {
    blob: new Blob([pdfBytes.buffer], { type: "application/pdf" }),
    fileName: payload.fileName.replace(/\.(md|markdown)$/i, "") + ".pdf",
    pageCount: result.pageCount,
    echartsErrorCount: result.echartsErrors.length,
    mermaidErrorCount: result.mermaidErrors.length
  };
}

export async function downloadPdf(blob: Blob, fileName: string) {
  if (window.morphDocDesktop) {
    return window.morphDocDesktop.savePdf(
      fileName,
      new Uint8Array(await blob.arrayBuffer())
    );
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
