import { chromium, type Browser } from "playwright";
import { performance } from "node:perf_hooks";
import type {
  PagedDocumentPayload,
  PagedDocumentRenderResult
} from "@morphdoc/core";

export type PdfRenderPayload = PagedDocumentPayload;

export interface PdfGenerationResult {
  pdf: Buffer;
  pageCount: number;
  echartsErrors: string[];
  mermaidErrors: string[];
  timings: PdfGenerationTimings;
}

export interface PdfGenerationTimings {
  queueMs: number;
  browserMs: number;
  contextMs: number;
  navigationMs: number;
  documentRenderMs: number;
  runtimeSetupMs: number;
  echartsMs: number;
  echartsFitMs: number;
  mermaidMs: number;
  mermaidFitMs: number;
  mermaidConversionMs: number;
  resourceWaitMs: number;
  paginationMs: number;
  finalizeMs: number;
  runtimeTotalMs: number;
  pdfPrintMs: number;
  totalMs: number;
}

export interface PdfGenerator {
  generate(payload: PdfRenderPayload): Promise<PdfGenerationResult>;
  warmup?(): Promise<void>;
  close(): Promise<void>;
}

export interface PdfEngineOptions {
  renderOrigin?: string;
  concurrency?: number;
  maxQueue?: number;
  timeoutMs?: number;
  launchBrowser?: () => Promise<Browser>;
}

export interface PdfEngineRuntimeLimits {
  concurrency: number;
  maxQueue: number;
  timeoutMs: number;
}

interface PdfDocumentResult
  extends Omit<PdfGenerationResult, "timings"> {
  timings: Pick<
    PdfGenerationTimings,
    | "navigationMs"
    | "documentRenderMs"
    | "runtimeSetupMs"
    | "echartsMs"
    | "echartsFitMs"
    | "mermaidMs"
    | "mermaidFitMs"
    | "mermaidConversionMs"
    | "resourceWaitMs"
    | "paginationMs"
    | "finalizeMs"
    | "runtimeTotalMs"
    | "pdfPrintMs"
  >;
}

export class PdfEngineOverloadedError extends Error {
  constructor() {
    super("PDF 生成队列已满");
    this.name = "PdfEngineOverloadedError";
  }
}

export class PdfEngineClosedError extends Error {
  constructor() {
    super("PDF 生成服务已关闭");
    this.name = "PdfEngineClosedError";
  }
}

export class PdfRenderTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`PDF 生成超过 ${timeoutMs}ms`);
    this.name = "PdfRenderTimeoutError";
  }
}

export class ConcurrencyGate {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(
    private readonly limit: number,
    private readonly maxQueue: number
  ) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("PDF 并发数必须是正整数");
    }
    if (!Number.isInteger(maxQueue) || maxQueue < 0) {
      throw new Error("PDF 排队上限必须是非负整数");
    }
  }

  async run<T>(task: () => Promise<T>) {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire() {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }

    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(new PdfEngineOverloadedError());
    }

    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release() {
    this.active -= 1;
    this.queue.shift()?.();
  }
}

function normalizeRenderOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("PDF 渲染地址必须使用 HTTP 或 HTTPS");
  }
  return url.origin;
}

function readIntegerEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number
) {
  const rawValue = environment[name];
  if (rawValue === undefined || rawValue.trim() === "") {
    return fallback;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${name} 必须是整数`);
  }

  const value = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} 不能小于 ${minimum}`);
  }
  return value;
}

export function readPdfEngineRuntimeLimits(
  environment: NodeJS.ProcessEnv = process.env
): PdfEngineRuntimeLimits {
  return {
    concurrency: readIntegerEnvironment(
      environment,
      "PDF_CONCURRENCY",
      2,
      1
    ),
    maxQueue: readIntegerEnvironment(
      environment,
      "PDF_MAX_QUEUE",
      8,
      0
    ),
    timeoutMs: readIntegerEnvironment(
      environment,
      "PDF_TIMEOUT_MS",
      180_000,
      1_000
    )
  };
}

export function isAllowedPdfRequestUrl(
  requestUrl: string,
  renderOrigin: string
) {
  const url = new URL(requestUrl);
  if (["about:", "blob:", "data:"].includes(url.protocol)) {
    return true;
  }
  return url.origin === renderOrigin;
}

async function waitWithPdfTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number
) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new PdfRenderTimeoutError(timeoutMs));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function closeContextWithin(
  context: Awaited<ReturnType<Browser["newContext"]>>,
  timeoutMs: number
) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      context.close().catch(() => undefined),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, Math.min(timeoutMs, 5_000));
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export class PlaywrightPdfGenerator implements PdfGenerator {
  private readonly renderOrigin: string;
  private readonly renderUrl: string;
  private readonly timeoutMs: number;
  private readonly gate: ConcurrencyGate;
  private readonly launchBrowser: () => Promise<Browser>;
  private browserPromise: Promise<Browser> | undefined;
  private closed = false;

  constructor(options: PdfEngineOptions = {}) {
    const runtimeLimits = readPdfEngineRuntimeLimits();
    this.renderOrigin = normalizeRenderOrigin(
      options.renderOrigin ??
        process.env.PDF_RENDER_ORIGIN ??
        "http://localhost:5173"
    );
    this.renderUrl = new URL(
      "/preview-frame.html?target=pdf",
      this.renderOrigin
    ).href;
    this.timeoutMs = options.timeoutMs ?? runtimeLimits.timeoutMs;
    this.gate = new ConcurrencyGate(
      options.concurrency ?? runtimeLimits.concurrency,
      options.maxQueue ?? runtimeLimits.maxQueue
    );
    this.launchBrowser =
      options.launchBrowser ??
      (() =>
        chromium.launch({
          headless: true
        }));
  }

  generate(payload: PdfRenderPayload) {
    if (this.closed) {
      return Promise.reject(new PdfEngineClosedError());
    }

    const queuedAt = performance.now();
    return this.gate.run(() =>
      this.generateWithBrowser(
        payload,
        queuedAt,
        performance.now() - queuedAt
      )
    );
  }

  async warmup() {
    if (this.closed) {
      throw new PdfEngineClosedError();
    }
    await waitWithPdfTimeout(this.getBrowser(), this.timeoutMs);
  }

  async close() {
    this.closed = true;
    const browserPromise = this.browserPromise;
    this.browserPromise = undefined;
    if (!browserPromise) {
      return;
    }

    try {
      const browser = await browserPromise;
      await browser.close();
    } catch {
      // 启动失败时没有可关闭的浏览器。
    }
  }

  private getBrowser() {
    if (!this.browserPromise) {
      const browserPromise = this.launchBrowser();
      this.browserPromise = browserPromise;
      void browserPromise
        .then((browser) => {
          browser.on("disconnected", () => {
            if (this.browserPromise === browserPromise) {
              this.browserPromise = undefined;
            }
          });
        })
        .catch(() => {
          if (this.browserPromise === browserPromise) {
            this.browserPromise = undefined;
          }
        });
    }

    return this.browserPromise;
  }

  private async generateWithBrowser(
    payload: PdfRenderPayload,
    queuedAt: number,
    queueMs: number
  ): Promise<PdfGenerationResult> {
    let context:
      | Awaited<ReturnType<Browser["newContext"]>>
      | undefined;
    let expired = false;

    try {
      const operation = (async (): Promise<PdfGenerationResult> => {
        const browserStartedAt = performance.now();
        const browser = await this.getBrowser();
        const browserMs = performance.now() - browserStartedAt;
        if (expired) {
          throw new PdfRenderTimeoutError(this.timeoutMs);
        }

        const contextStartedAt = performance.now();
        const createdContext = await browser.newContext({
          locale: payload.metadata.language || "zh-CN",
          serviceWorkers: "block"
        });
        context = createdContext;
        const contextMs = performance.now() - contextStartedAt;
        if (expired) {
          await closeContextWithin(createdContext, this.timeoutMs);
          throw new PdfRenderTimeoutError(this.timeoutMs);
        }

        await createdContext.route("**/*", async (route) => {
          if (
            isAllowedPdfRequestUrl(
              route.request().url(),
              this.renderOrigin
            )
          ) {
            await route.continue();
            return;
          }
          await route.abort("blockedbyclient");
        });

        const generated = await this.renderWithContext(
          createdContext,
          payload
        );
        return {
          ...generated,
          timings: {
            queueMs,
            browserMs,
            contextMs,
            ...generated.timings,
            totalMs: performance.now() - queuedAt
          }
        };
      })();

      return await waitWithPdfTimeout(operation, this.timeoutMs);
    } finally {
      expired = true;
      if (context) {
        await closeContextWithin(context, this.timeoutMs);
      }
    }
  }

  private async renderWithContext(
    context: Awaited<ReturnType<Browser["newContext"]>>,
    payload: PdfRenderPayload
  ): Promise<PdfDocumentResult> {
    const navigationStartedAt = performance.now();
    const page = await context.newPage();
    page.setDefaultTimeout(this.timeoutMs);
    page.setDefaultNavigationTimeout(this.timeoutMs);
    await page.emulateMedia({ media: "print" });
    await page.goto(this.renderUrl, {
      waitUntil: "domcontentloaded",
      timeout: this.timeoutMs
    });
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.runtimeReady === "true",
      undefined,
      { timeout: this.timeoutMs }
    );
    const navigationMs = performance.now() - navigationStartedAt;

    const documentRenderStartedAt = performance.now();
    const renderResult = await page.evaluate(
      async (renderPayload): Promise<PagedDocumentRenderResult> => {
        const renderer = (
          window as typeof window & {
            __morphDocRender?: (
              payload: PdfRenderPayload,
              target: "pdf"
            ) => Promise<PagedDocumentRenderResult>;
          }
        ).__morphDocRender;
        if (!renderer) {
          throw new Error("PDF 分页运行时不可用");
        }
        return renderer(renderPayload, "pdf");
      },
      payload
    );
    const documentRenderMs =
      performance.now() - documentRenderStartedAt;

    const pdfPrintStartedAt = performance.now();
    const pdf = await page.pdf({
      displayHeaderFooter: false,
      margin: {
        top: "0",
        right: "0",
        bottom: "0",
        left: "0"
      },
      pageRanges: `1-${Math.max(renderResult.pageCount, 1)}`,
      preferCSSPageSize: true,
      printBackground: payload.exportConfig.print.background,
      scale: payload.exportConfig.print.scale
    });
    const pdfPrintMs = performance.now() - pdfPrintStartedAt;

    return {
      pdf,
      pageCount: renderResult.pageCount,
      echartsErrors: renderResult.echartsErrors,
      mermaidErrors: renderResult.mermaidErrors,
      timings: {
        navigationMs,
        documentRenderMs,
        runtimeSetupMs: renderResult.timings.setupMs,
        echartsMs: renderResult.timings.echartsMs,
        echartsFitMs: renderResult.timings.echartsFitMs,
        mermaidMs: renderResult.timings.mermaidMs,
        mermaidFitMs: renderResult.timings.mermaidFitMs,
        mermaidConversionMs:
          renderResult.timings.mermaidConversionMs,
        resourceWaitMs: renderResult.timings.resourceWaitMs,
        paginationMs: renderResult.timings.paginationMs,
        finalizeMs: renderResult.timings.finalizeMs,
        runtimeTotalMs: renderResult.timings.totalMs,
        pdfPrintMs
      }
    };
  }
}

export function createPdfGenerator(options: PdfEngineOptions = {}) {
  return new PlaywrightPdfGenerator(options);
}
