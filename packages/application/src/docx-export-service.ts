import { performance } from "node:perf_hooks";
import {
  createDocxFileName,
  type DocxCapability,
  type DocxExportErrorCode,
  type DocxExportResult
} from "@morphdoc/core";
import {
  PandocDocxConversionError,
  type PandocDocxConversionInput,
  type PandocDocxConversionResult,
  type PandocRuntimeResolution
} from "@morphdoc/docx-engine";
import {
  ApplicationRequestError,
  type ApplicationService,
  type PreparedDocxExport
} from "./application-service.js";
import {
  prepareDocxMedia,
  type DocxMediaCaptureAdapter
} from "./docx-media-service.js";
import type {
  DocxThemeTokenProvider,
  PreparedDocxThemeTokens
} from "./docx-theme-token-service.js";
import type { ImageResolutionContext } from "./image-resources.js";

const DEFAULT_DOCX_CONCURRENCY = 1;
const DEFAULT_DOCX_MAX_QUEUE = 4;
const DEFAULT_DOCX_TIMEOUT_MS = 90_000;

export interface DocxExportRuntimeLimits {
  concurrency: number;
  maxQueue: number;
  timeoutMs: number;
}

export interface DocxCapabilityProvider {
  probe(): Promise<PandocRuntimeResolution>;
}

export interface DocxConversionPort {
  convert(
    input: PandocDocxConversionInput,
    signal?: AbortSignal
  ): Promise<PandocDocxConversionResult>;
}

export interface DocxExportServiceOptions {
  application: Pick<ApplicationService, "prepareDocxExport">;
  runtime: DocxCapabilityProvider;
  converter: DocxConversionPort;
  themeTokens: DocxThemeTokenProvider;
  limits?: Partial<DocxExportRuntimeLimits>;
}

export interface GenerateDocxOptions {
  mediaAdapter: DocxMediaCaptureAdapter;
  imageContext?: ImageResolutionContext;
  signal?: AbortSignal;
}

export class DocxExportServiceError extends Error {
  constructor(
    readonly statusCode: 429 | 500 | 503 | 504,
    readonly code: DocxExportErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "DocxExportServiceError";
  }
}

class DocxQueueFullError extends Error {}
class DocxServiceClosedError extends Error {}

interface QueueEntry {
  resolve: () => void;
  reject: (error: unknown) => void;
  signal: AbortSignal;
  abort: () => void;
}

class DocxConcurrencyGate {
  private active = 0;
  private closed = false;
  private readonly queue: QueueEntry[] = [];

  constructor(
    private readonly limit: number,
    private readonly maxQueue: number
  ) {}

  async run<T>(
    task: () => Promise<T>,
    signal: AbortSignal
  ): Promise<T> {
    await this.acquire(signal);
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  close() {
    this.closed = true;
    for (const entry of this.queue.splice(0)) {
      entry.signal.removeEventListener("abort", entry.abort);
      entry.reject(new DocxServiceClosedError());
    }
  }

  private acquire(signal: AbortSignal) {
    if (this.closed) {
      return Promise.reject(new DocxServiceClosedError());
    }
    if (signal.aborted) {
      return Promise.reject(signal.reason);
    }
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(new DocxQueueFullError());
    }
    return new Promise<void>((resolve, reject) => {
      const entry: QueueEntry = {
        resolve,
        reject,
        signal,
        abort: () => {
          const index = this.queue.indexOf(entry);
          if (index >= 0) {
            this.queue.splice(index, 1);
          }
          reject(signal.reason);
        }
      };
      signal.addEventListener("abort", entry.abort, { once: true });
      this.queue.push(entry);
    });
  }

  private release() {
    this.active -= 1;
    while (this.queue.length) {
      const entry = this.queue.shift()!;
      entry.signal.removeEventListener("abort", entry.abort);
      if (entry.signal.aborted) {
        entry.reject(entry.signal.reason);
        continue;
      }
      this.active += 1;
      entry.resolve();
      break;
    }
  }
}

function readIntegerEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number
) {
  const raw = environment[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  if (!/^\d+$/u.test(raw)) {
    throw new Error(`${name} 必须是整数`);
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} 不能小于 ${minimum}`);
  }
  return value;
}

export function readDocxExportRuntimeLimits(
  environment: NodeJS.ProcessEnv = process.env
): DocxExportRuntimeLimits {
  return {
    concurrency: readIntegerEnvironment(
      environment,
      "DOCX_CONCURRENCY",
      DEFAULT_DOCX_CONCURRENCY,
      1
    ),
    maxQueue: readIntegerEnvironment(
      environment,
      "DOCX_MAX_QUEUE",
      DEFAULT_DOCX_MAX_QUEUE,
      0
    ),
    timeoutMs: readIntegerEnvironment(
      environment,
      "DOCX_TIMEOUT_MS",
      DEFAULT_DOCX_TIMEOUT_MS,
      1_000
    )
  };
}

function resolveLimits(
  values: Partial<DocxExportRuntimeLimits> = {}
): DocxExportRuntimeLimits {
  const limits = {
    concurrency: values.concurrency ?? DEFAULT_DOCX_CONCURRENCY,
    maxQueue: values.maxQueue ?? DEFAULT_DOCX_MAX_QUEUE,
    timeoutMs: values.timeoutMs ?? DEFAULT_DOCX_TIMEOUT_MS
  };
  if (!Number.isInteger(limits.concurrency) || limits.concurrency < 1) {
    throw new Error("DOCX 并发数必须是正整数");
  }
  if (!Number.isInteger(limits.maxQueue) || limits.maxQueue < 0) {
    throw new Error("DOCX 排队上限必须是非负整数");
  }
  if (
    !Number.isInteger(limits.timeoutMs) ||
    limits.timeoutMs < 10 ||
    limits.timeoutMs > 10 * 60_000
  ) {
    throw new Error("DOCX 总超时必须在 10ms 到 10 分钟之间");
  }
  return limits;
}

function capabilityError(capability: Exclude<
  DocxCapability,
  { status: "available" }
>) {
  const mapping = {
    "not-found": "DOCX_RUNTIME_NOT_FOUND",
    "version-mismatch": "DOCX_RUNTIME_VERSION_MISMATCH",
    "not-executable": "DOCX_RUNTIME_NOT_EXECUTABLE",
    "probe-timeout": "DOCX_RUNTIME_PROBE_TIMEOUT"
  } as const;
  return new DocxExportServiceError(
    capability.status === "probe-timeout" ? 504 : 503,
    mapping[capability.status],
    capability.message,
    capability.status === "probe-timeout"
  );
}

function conversionError(error: PandocDocxConversionError) {
  const statusCode =
    error.code === "DOCX_RENDER_TIMEOUT"
      ? 504
      : error.code === "DOCX_RUNTIME_NOT_FOUND"
        ? 503
        : 500;
  return new DocxExportServiceError(
    statusCode,
    error.code,
    error.message,
    error.code === "DOCX_RENDER_TIMEOUT",
    { cause: error }
  );
}

export class DocxExportService {
  private readonly limits: DocxExportRuntimeLimits;
  private readonly gate: DocxConcurrencyGate;
  private readonly controllers = new Set<AbortController>();
  private readonly jobs = new Set<Promise<unknown>>();
  private closePromise: Promise<void> | undefined;
  private closed = false;

  constructor(private readonly options: DocxExportServiceOptions) {
    this.limits = resolveLimits(options.limits);
    this.gate = new DocxConcurrencyGate(
      this.limits.concurrency,
      this.limits.maxQueue
    );
  }

  async getCapability() {
    return (await this.options.runtime.probe()).capability;
  }

  generate(
    request: unknown,
    options: GenerateDocxOptions
  ): Promise<DocxExportResult> {
    if (this.closed) {
      return Promise.reject(
        new DocxExportServiceError(
          503,
          "DOCX_GENERATION_FAILED",
          "DOCX 导出服务已关闭",
          false
        )
      );
    }
    const job = this.runGeneration(request, options);
    this.jobs.add(job);
    void job.finally(() => this.jobs.delete(job)).catch(() => undefined);
    return job;
  }

  close() {
    this.closePromise ??= this.closeInternal();
    return this.closePromise;
  }

  private async closeInternal() {
    this.closed = true;
    this.gate.close();
    for (const controller of this.controllers) {
      controller.abort(new DocxServiceClosedError());
    }
    await Promise.allSettled([...this.jobs]);
  }

  private async runGeneration(
    request: unknown,
    options: GenerateDocxOptions
  ) {
    const totalStarted = performance.now();
    const queuedAt = performance.now();
    const controller = new AbortController();
    this.controllers.add(controller);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("DOCX 总超时"));
    }, this.limits.timeoutMs);
    timeout.unref();
    const abortFromCaller = () =>
      controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abortFromCaller, {
      once: true
    });
    if (options.signal?.aborted) {
      abortFromCaller();
    }

    try {
      return await this.gate.run(async () => {
        const queueMs = performance.now() - queuedAt;
        controller.signal.throwIfAborted();

        const probeStarted = performance.now();
        const resolution = await this.options.runtime.probe();
        const probeMs = performance.now() - probeStarted;
        if (resolution.capability.status !== "available") {
          throw capabilityError(resolution.capability);
        }
        controller.signal.throwIfAborted();

        const prepareStarted = performance.now();
        const prepared =
          await this.options.application.prepareDocxExport(
            request,
            options.imageContext ?? {}
          );
        const prepareMs = performance.now() - prepareStarted;
        controller.signal.throwIfAborted();

        let themeStyleMs = 0;
        let mediaMs = 0;
        const [themeTokens, media] = await Promise.all([
          (async () => {
            const started = performance.now();
            try {
              return await this.options.themeTokens.prepare(
                prepared,
                controller.signal
              );
            } finally {
              themeStyleMs = performance.now() - started;
            }
          })(),
          (async () => {
            const started = performance.now();
            try {
              return await prepareDocxMedia(
                prepared,
                options.mediaAdapter,
                controller.signal
              );
            } finally {
              mediaMs = performance.now() - started;
            }
          })()
        ]);
        controller.signal.throwIfAborted();

        const conversion = await this.options.converter.convert(
          this.createConversionInput(
            prepared,
            themeTokens,
            media
          ),
          controller.signal
        );
        return {
          docx: conversion.docx,
          fileName: createDocxFileName(prepared.request.fileName),
          diagnostics: {
            warnings: [
              ...media.warnings,
              ...themeTokens.warnings,
              ...(prepared.theme.fontPack?.diagnostics ?? [])
                .filter((diagnostic) => diagnostic.severity !== "info")
                .map((diagnostic) => diagnostic.message)
            ],
            echartsErrors: media.echartsErrors,
            mermaidErrors: media.mermaidErrors
          },
          timings: {
            queueMs,
            probeMs,
            prepareMs,
            themeStyleMs,
            mediaMs,
            referenceMs: conversion.timings.referenceMs,
            pandocMs: conversion.timings.pandocMs,
            validationMs: conversion.timings.validationMs,
            totalMs: performance.now() - totalStarted
          }
        };
      }, controller.signal);
    } catch (error) {
      if (
        error instanceof ApplicationRequestError ||
        error instanceof DocxExportServiceError
      ) {
        throw error;
      }
      if (error instanceof PandocDocxConversionError) {
        throw conversionError(error);
      }
      if (error instanceof DocxQueueFullError) {
        throw new DocxExportServiceError(
          429,
          "DOCX_QUEUE_FULL",
          "DOCX 生成队列已满",
          true
        );
      }
      if (error instanceof DocxServiceClosedError) {
        throw new DocxExportServiceError(
          503,
          "DOCX_GENERATION_FAILED",
          "DOCX 导出服务已关闭",
          false
        );
      }
      if (controller.signal.aborted) {
        throw new DocxExportServiceError(
          504,
          "DOCX_RENDER_TIMEOUT",
          timedOut ? "DOCX 导出超过总超时" : "DOCX 导出已取消",
          timedOut,
          { cause: error }
        );
      }
      throw new DocxExportServiceError(
        500,
        "DOCX_GENERATION_FAILED",
        "DOCX 导出失败",
        false,
        { cause: error }
      );
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener(
        "abort",
        abortFromCaller
      );
      this.controllers.delete(controller);
    }
  }

  private createConversionInput(
    prepared: PreparedDocxExport,
    themeTokens: PreparedDocxThemeTokens,
    media: Awaited<ReturnType<typeof prepareDocxMedia>>
  ): PandocDocxConversionInput {
    return {
      markdown: prepared.document.markdownBody,
      fileName: prepared.request.fileName,
      language: prepared.request.language,
      exportConfig: prepared.request.exportConfig,
      theme: prepared.theme.manifest,
      themeTokens: themeTokens.tokens,
      fonts: prepared.theme.fonts,
      metadata: prepared.document.metadata,
      semanticDocument: prepared.document.semanticDocument,
      media
    };
  }
}
