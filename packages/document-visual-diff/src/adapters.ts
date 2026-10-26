import { performance } from "node:perf_hooks";

import type { PdfSnapshotSource } from "./types.js";

export interface PdfAdapterCapability {
  available: boolean;
  adapterId: string;
  source: PdfSnapshotSource;
  detail?: string;
}

export interface PdfAdapterGeneration {
  source: PdfSnapshotSource;
  pdf: Uint8Array;
  pageCount?: number;
  elapsedMs: number;
  diagnostics: string[];
}

export interface PdfArtifactAdapter<TInput> {
  readonly id: string;
  readonly source: PdfSnapshotSource;
  probe(): Promise<PdfAdapterCapability>;
  generate(input: TInput): Promise<PdfAdapterGeneration>;
}

export type ChromiumPdfProducerResult =
  | Uint8Array
  | {
      pdf: Uint8Array;
      pageCount?: number;
      diagnostics?: string[];
    };

export interface ChromiumPdfAdapterOptions<TInput> {
  label?: string;
  fileName?: string;
  generate: (input: TInput) => Promise<ChromiumPdfProducerResult>;
}

export function assertPdfBytes(
  pdf: Uint8Array,
  label = "PDF",
): void {
  if (!(pdf instanceof Uint8Array) || pdf.byteLength < 8) {
    throw new Error(`${label} 内容无效或过短`);
  }
  const signature = new TextDecoder("ascii").decode(pdf.subarray(0, 5));
  if (signature !== "%PDF-") {
    throw new Error(`${label} 缺少有效的 PDF 文件签名`);
  }
}

export function createChromiumPdfAdapter<TInput>(
  options: ChromiumPdfAdapterOptions<TInput>,
): PdfArtifactAdapter<TInput> {
  const source: PdfSnapshotSource = {
    kind: "chromium",
    label: options.label ?? "Chromium",
    ...(options.fileName ? { fileName: options.fileName } : {}),
  };
  return {
    id: "chromium",
    source,
    async probe() {
      return {
        available: true,
        adapterId: "chromium",
        source,
        detail: "由调用方提供现有 Chromium PDF 生成链",
      };
    },
    async generate(input) {
      const startedAt = performance.now();
      const produced = await options.generate(input);
      const result =
        produced instanceof Uint8Array ? { pdf: produced } : produced;
      assertPdfBytes(result.pdf, source.label);
      return {
        source,
        pdf: result.pdf,
        ...(result.pageCount === undefined
          ? {}
          : { pageCount: result.pageCount }),
        elapsedMs: performance.now() - startedAt,
        diagnostics: result.diagnostics ?? [],
      };
    },
  };
}
