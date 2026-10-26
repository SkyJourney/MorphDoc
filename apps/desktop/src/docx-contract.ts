import {
  ApplicationRequestError,
  DocxExportServiceError
} from "@morphdoc/application";
import type {
  DocxCapability,
  DocxExportDiagnostics,
  DocxExportErrorCode,
  DocxGenerationTimings
} from "@morphdoc/core";
import { docxExportErrorCodeSchema } from "@morphdoc/core";

export interface DesktopDocxExportSuccess {
  ok: true;
  saved: boolean;
  fileName: string;
  diagnostics: DocxExportDiagnostics;
  timings: DocxGenerationTimings;
}

export interface DesktopDocxExportFailure {
  ok: false;
  error: DocxExportErrorCode;
  message: string;
  retryable: boolean;
}

export type DesktopDocxExportOutcome =
  | DesktopDocxExportSuccess
  | DesktopDocxExportFailure;

export type DesktopDocxCapability = DocxCapability;

function readSafeDesktopMediaDetail(error: DocxExportServiceError) {
  const cause = error.cause;
  if (!(cause instanceof Error)) {
    return undefined;
  }
  return /^桌面 DOCX (?:媒体布局超过 \d+ms|第 \d+\/\d+ 个媒体（(?:image|mermaid|echarts)）PNG 捕获超过 \d+ms)$/u.test(
    cause.message
  )
    ? cause.message
    : undefined;
}

export function toDesktopDocxExportFailure(
  error: unknown
): DesktopDocxExportFailure {
  if (error instanceof ApplicationRequestError) {
    const parsedCode = docxExportErrorCodeSchema.safeParse(
      error.code
    );
    if (!parsedCode.success) {
      return {
        ok: false,
        error: "DOCX_GENERATION_FAILED",
        message: "DOCX 导出失败",
        retryable: false
      };
    }
    return {
      ok: false,
      error: parsedCode.data,
      message: error.message,
      retryable: false
    };
  }
  if (error instanceof DocxExportServiceError) {
    const detail = readSafeDesktopMediaDetail(error);
    return {
      ok: false,
      error: error.code,
      message: detail ? `${error.message}：${detail}` : error.message,
      retryable: error.retryable
    };
  }
  return {
    ok: false,
    error: "DOCX_GENERATION_FAILED",
    message: "DOCX 导出失败",
    retryable: false
  };
}
