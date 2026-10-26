import { describe, expect, it, vi } from "vitest";
import type { Browser } from "playwright";
import { defaultExportConfig } from "@morphdoc/core";
import {
  ConcurrencyGate,
  PdfEngineClosedError,
  PdfEngineOverloadedError,
  PdfRenderTimeoutError,
  PlaywrightPdfGenerator,
  isAllowedPdfRequestUrl,
  readPdfEngineRuntimeLimits,
  type PdfRenderPayload
} from "../src/pdf-engine.js";

function payload(): PdfRenderPayload {
  return {
    articleHtml: '<article id="write"><h1>测试</h1></article>',
    fileName: "测试.md",
    metadata: {
      title: "测试",
      author: "",
      subject: "",
      keywords: [],
      language: "zh-CN"
    },
    features: [],
    themeCss: "#write { color: #333; }",
    exportConfig: defaultExportConfig
  };
}

function fakeBrowser(
  options: { hangOnGoto?: boolean; hangOnNewContext?: boolean } = {}
) {
  let releaseNewContext: (() => void) | undefined;
  const route = vi.fn();
  const closeContext = vi.fn(async () => undefined);
  const closeBrowser = vi.fn(async () => undefined);
  const pdfBuffer = Buffer.from("%PDF-test");
  const page = {
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    emulateMedia: vi.fn(async () => undefined),
    goto: options.hangOnGoto
      ? vi.fn(() => new Promise(() => undefined))
      : vi.fn(async () => undefined),
    waitForFunction: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => ({
      pageCount: 2,
      echartsErrors: [],
      mermaidErrors: [],
      timings: {
        setupMs: 1,
        echartsMs: 1.5,
        echartsFitMs: 1.75,
        mermaidMs: 2,
        mermaidFitMs: 3,
        mermaidConversionMs: 3.5,
        resourceWaitMs: 4,
        paginationMs: 5,
        finalizeMs: 6,
        totalMs: 21
      }
    })),
    pdf: vi.fn(async () => pdfBuffer)
  };
  const context = {
    route,
    newPage: vi.fn(async () => page),
    close: closeContext
  };
  const browser = {
    newContext: options.hangOnNewContext
      ? vi.fn(
          () =>
            new Promise<typeof context>((resolve) => {
              releaseNewContext = () => resolve(context);
            })
        )
      : vi.fn(async () => context),
    close: closeBrowser,
    on: vi.fn()
  } as unknown as Browser;

  return {
    browser,
    closeBrowser,
    closeContext,
    context,
    page,
    pdfBuffer,
    releaseNewContext() {
      releaseNewContext?.();
    },
    route
  };
}

describe("PDF 并发控制", () => {
  it("限制并发并拒绝超过排队上限的任务", async () => {
    const gate = new ConcurrencyGate(1, 1);
    let releaseFirst: (() => void) | undefined;
    const first = gate.run(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        })
    );
    const second = gate.run(async () => undefined);

    await expect(
      gate.run(async () => undefined)
    ).rejects.toBeInstanceOf(PdfEngineOverloadedError);

    releaseFirst?.();
    await first;
    await second;
  });
});

describe("PDF 运行参数", () => {
  it("读取容器环境变量", () => {
    expect(
      readPdfEngineRuntimeLimits({
        PDF_CONCURRENCY: "1",
        PDF_MAX_QUEUE: "4",
        PDF_TIMEOUT_MS: "120000"
      })
    ).toEqual({
      concurrency: 1,
      maxQueue: 4,
      timeoutMs: 120_000
    });
  });

  it("缺少环境变量时使用默认值", () => {
    expect(readPdfEngineRuntimeLimits({})).toEqual({
      concurrency: 2,
      maxQueue: 8,
      timeoutMs: 180_000
    });
  });

  it.each([
    ["PDF_CONCURRENCY", "0"],
    ["PDF_MAX_QUEUE", "-1"],
    ["PDF_TIMEOUT_MS", "999"],
    ["PDF_CONCURRENCY", "1.5"]
  ])("拒绝无效的 %s", (name, value) => {
    expect(() =>
      readPdfEngineRuntimeLimits({ [name]: value })
    ).toThrow(name);
  });
});

describe("PDF 网络策略", () => {
  it("只允许渲染同源和内嵌资源", () => {
    const origin = "http://127.0.0.1:5173";
    expect(
      isAllowedPdfRequestUrl(
        "http://127.0.0.1:5173/api/themes/a.css",
        origin
      )
    ).toBe(true);
    expect(isAllowedPdfRequestUrl("data:image/png;base64,AA", origin))
      .toBe(true);
    expect(isAllowedPdfRequestUrl("blob:http://127.0.0.1/id", origin))
      .toBe(true);
    expect(
      isAllowedPdfRequestUrl("https://example.com/font.woff2", origin)
    ).toBe(false);
  });
});

describe("Playwright PDF 生成器", () => {
  it("复用浏览器、隔离上下文并返回 PDF", async () => {
    const fake = fakeBrowser();
    const generator = new PlaywrightPdfGenerator({
      launchBrowser: async () => fake.browser,
      timeoutMs: 1_000
    });

    const first = await generator.generate(payload());
    const second = await generator.generate(payload());

    expect(first.pdf.toString()).toBe("%PDF-test");
    expect(first.pdf).toBe(fake.pdfBuffer);
    expect(first.pageCount).toBe(2);
    expect(first.timings).toEqual(
      expect.objectContaining({
        queueMs: expect.any(Number),
        browserMs: expect.any(Number),
        contextMs: expect.any(Number),
        navigationMs: expect.any(Number),
        documentRenderMs: expect.any(Number),
        runtimeSetupMs: 1,
        echartsMs: 1.5,
        echartsFitMs: 1.75,
        mermaidMs: 2,
        mermaidFitMs: 3,
        mermaidConversionMs: 3.5,
        resourceWaitMs: 4,
        paginationMs: 5,
        finalizeMs: 6,
        runtimeTotalMs: 21,
        pdfPrintMs: expect.any(Number),
        totalMs: expect.any(Number)
      })
    );
    expect(second.pdf.toString()).toBe("%PDF-test");
    expect(fake.browser.newContext).toHaveBeenCalledTimes(2);
    expect(fake.closeContext).toHaveBeenCalledTimes(2);
    expect(fake.page.pdf).toHaveBeenCalledWith(
      expect.objectContaining({
        pageRanges: "1-2",
        preferCSSPageSize: true,
        printBackground: true,
        scale: 1
      })
    );

    await generator.close();
    expect(fake.closeBrowser).toHaveBeenCalledTimes(1);
    await expect(generator.generate(payload())).rejects.toBeInstanceOf(
      PdfEngineClosedError
    );
  });

  it("可以在首个生成请求前预热浏览器", async () => {
    const fake = fakeBrowser();
    const launchBrowser = vi.fn(async () => fake.browser);
    const generator = new PlaywrightPdfGenerator({
      launchBrowser,
      timeoutMs: 1_000
    });

    await generator.warmup();
    await generator.warmup();
    expect(launchBrowser).toHaveBeenCalledTimes(1);
    expect(fake.browser.newContext).not.toHaveBeenCalled();

    await generator.generate(payload());
    expect(launchBrowser).toHaveBeenCalledTimes(1);
    await generator.close();
  });

  it("超时后关闭独立上下文", async () => {
    const fake = fakeBrowser({ hangOnGoto: true });
    const generator = new PlaywrightPdfGenerator({
      launchBrowser: async () => fake.browser,
      timeoutMs: 10
    });

    await expect(generator.generate(payload())).rejects.toBeInstanceOf(
      PdfRenderTimeoutError
    );
    expect(fake.closeContext).toHaveBeenCalledTimes(1);
    await generator.close();
  });

  it("浏览器启动阶段也受生成超时限制", async () => {
    const fake = fakeBrowser();
    let releaseBrowser: (() => void) | undefined;
    const generator = new PlaywrightPdfGenerator({
      launchBrowser: () =>
        new Promise<Browser>((resolve) => {
          releaseBrowser = () => resolve(fake.browser);
        }),
      timeoutMs: 10
    });

    await expect(generator.generate(payload())).rejects.toBeInstanceOf(
      PdfRenderTimeoutError
    );
    releaseBrowser?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await generator.close();
  });

  it("上下文创建阶段也受生成超时限制并清理迟到上下文", async () => {
    const fake = fakeBrowser({ hangOnNewContext: true });
    const generator = new PlaywrightPdfGenerator({
      launchBrowser: async () => fake.browser,
      timeoutMs: 10
    });

    await expect(generator.generate(payload())).rejects.toBeInstanceOf(
      PdfRenderTimeoutError
    );
    fake.releaseNewContext();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.closeContext).toHaveBeenCalledTimes(1);
    await generator.close();
  });
});
