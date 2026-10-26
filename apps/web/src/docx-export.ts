import {
  DOCX_MIME_TYPE,
  type DocxCapability,
  type DocxExportRequestInput
} from "@morphdoc/core";
import { parseContentDispositionFileName } from "./pdf-export";

export interface DocxExportResult {
  blob: Blob;
  fileName: string;
  warningCount: number;
  echartsErrorCount: number;
  mermaidErrorCount: number;
}

export interface DesktopDocxExportResult {
  saved: boolean;
  fileName: string;
  warningCount: number;
  echartsErrorCount: number;
  mermaidErrorCount: number;
}

function parseNumericHeader(value: string | null) {
  if (value === null) {
    return 0;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
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
  return "DOCX 导出失败";
}

export async function getDocxCapability(
  fetcher: typeof fetch = fetch
): Promise<DocxCapability> {
  const bridge = window.morphDocDesktop;
  if (bridge) {
    return bridge.getDocxCapability();
  }
  const response = await fetcher("/api/docx/capability");
  if (!response.ok) {
    throw new Error("无法检测 DOCX 导出能力");
  }
  return (await response.json()) as DocxCapability;
}

export async function requestDocxExport(
  request: DocxExportRequestInput,
  fetcher: typeof fetch = fetch
): Promise<DocxExportResult> {
  const response = await fetcher("/api/docx", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(request)
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const contentType =
    response.headers.get("content-type")?.split(";")[0]?.trim();
  if (contentType !== DOCX_MIME_TYPE) {
    throw new Error("DOCX 服务返回了无效文件类型");
  }
  return {
    blob: await response.blob(),
    fileName: parseContentDispositionFileName(
      response.headers.get("content-disposition"),
      "document.docx"
    ),
    warningCount: parseNumericHeader(
      response.headers.get("x-docx-warning-count")
    ),
    echartsErrorCount: parseNumericHeader(
      response.headers.get("x-echarts-error-count")
    ),
    mermaidErrorCount: parseNumericHeader(
      response.headers.get("x-mermaid-error-count")
    )
  };
}

export async function requestDesktopDocxExport(
  request: DocxExportRequestInput
): Promise<DesktopDocxExportResult> {
  const bridge = window.morphDocDesktop;
  if (!bridge) {
    throw new Error("桌面 DOCX 引擎不可用");
  }
  const outcome = await bridge.exportDocx(request);
  if (!outcome.ok) {
    throw new Error(outcome.message);
  }
  return {
    saved: outcome.saved,
    fileName: outcome.fileName,
    warningCount: outcome.diagnostics.warnings.length,
    echartsErrorCount: outcome.diagnostics.echartsErrors.length,
    mermaidErrorCount: outcome.diagnostics.mermaidErrors.length
  };
}

export function downloadDocx(result: DocxExportResult) {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function createDocxDiagnosticsMessage(result: {
  warningCount: number;
  echartsErrorCount: number;
  mermaidErrorCount: number;
}) {
  const messages = [];
  if (result.warningCount > 0) {
    messages.push(`${result.warningCount} 条提示`);
  }
  if (result.echartsErrorCount > 0) {
    messages.push(`${result.echartsErrorCount} 个 ECharts 图表失败`);
  }
  if (result.mermaidErrorCount > 0) {
    messages.push(`${result.mermaidErrorCount} 个 Mermaid 图表失败`);
  }
  return messages.length > 0
    ? messages.join("，")
    : "纸张、样式和可编辑结构已写入文档";
}
