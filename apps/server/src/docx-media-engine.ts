import { chromium, type Browser, type BrowserContext } from "playwright";
import type {
  DocxMediaCaptureAdapter,
  DocxMediaCaptureRequest
} from "@morphdoc/application";
import type {
  DocxThemeStyleCaptureAdapter,
  DocxThemeStyleCaptureRequest
} from "@morphdoc/docx-theme-engine";
import { captureDocxMediaWithPlaywrightPage } from "./playwright-docx-media-capture.js";
import { captureDocxThemeStyleWithPlaywrightPage } from "./playwright-docx-theme-style.js";
import { isAllowedPdfRequestUrl } from "./pdf-engine.js";

export interface ServerDocxMediaCaptureAdapter
  extends DocxMediaCaptureAdapter,
    DocxThemeStyleCaptureAdapter {
  warmup?(): Promise<void>;
  close(): Promise<void>;
}

export interface PlaywrightDocxMediaEngineOptions {
  renderOrigin?: string;
  launchBrowser?: () => Promise<Browser>;
}

function normalizeRenderOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("DOCX 媒体渲染地址必须使用 HTTP 或 HTTPS");
  }
  return url.origin;
}

async function closeContext(context: BrowserContext) {
  await context.close().catch(() => undefined);
}

export class PlaywrightDocxMediaEngine
  implements ServerDocxMediaCaptureAdapter
{
  readonly themeStyleBaseUrl: string;
  private readonly renderOrigin: string;
  private readonly renderUrl: string;
  private readonly launchBrowser: () => Promise<Browser>;
  private browserPromise: Promise<Browser> | undefined;
  private closed = false;

  constructor(options: PlaywrightDocxMediaEngineOptions = {}) {
    this.renderOrigin = normalizeRenderOrigin(
      options.renderOrigin ??
        process.env.PDF_RENDER_ORIGIN ??
        "http://localhost:5173"
    );
    this.renderUrl = new URL(
      "/preview-frame.html?target=continuous",
      this.renderOrigin
    ).href;
    this.themeStyleBaseUrl = this.renderUrl;
    this.launchBrowser =
      options.launchBrowser ??
      (() =>
        chromium.launch({
          headless: true
        }));
  }

  async warmup() {
    if (this.closed) {
      throw new Error("DOCX 媒体服务已关闭");
    }
    await this.getBrowser();
  }

  async capture(
    request: DocxMediaCaptureRequest,
    signal?: AbortSignal
  ) {
    if (this.closed) {
      throw new Error("DOCX 媒体服务已关闭");
    }
    signal?.throwIfAborted();

    const browser = await this.getBrowser();
    signal?.throwIfAborted();
    const context = await browser.newContext({
      locale: request.payload.metadata.language || "zh-CN",
      serviceWorkers: "block"
    });
    const abort = () => {
      void closeContext(context);
    };
    signal?.addEventListener("abort", abort, { once: true });

    try {
      await context.route("**/*", async (route) => {
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
      const page = await context.newPage();
      await page.goto(this.renderUrl, {
        waitUntil: "domcontentloaded"
      });
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.runtimeReady === "true"
      );
      signal?.throwIfAborted();
      return await captureDocxMediaWithPlaywrightPage(
        page,
        request,
        signal
      );
    } finally {
      signal?.removeEventListener("abort", abort);
      await closeContext(context);
    }
  }

  async captureThemeStyle(
    request: DocxThemeStyleCaptureRequest,
    signal?: AbortSignal
  ) {
    if (this.closed) {
      throw new Error("DOCX 媒体服务已关闭");
    }
    signal?.throwIfAborted();
    if (new URL(request.baseUrl).origin !== this.renderOrigin) {
      throw new Error("DOCX 主题样式资源地址必须与渲染地址同源");
    }

    const browser = await this.getBrowser();
    signal?.throwIfAborted();
    const context = await browser.newContext({
      locale: "zh-CN",
      serviceWorkers: "block"
    });
    const abort = () => {
      void closeContext(context);
    };
    signal?.addEventListener("abort", abort, { once: true });

    try {
      await context.route("**/*", async (route) => {
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
      const page = await context.newPage();
      await page.goto(this.renderUrl, {
        waitUntil: "domcontentloaded"
      });
      return await captureDocxThemeStyleWithPlaywrightPage(
        page,
        request,
        signal
      );
    } finally {
      signal?.removeEventListener("abort", abort);
      await closeContext(context);
    }
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
      // 浏览器启动失败时没有可关闭的实例。
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
}

export function createDocxMediaEngine(
  options: PlaywrightDocxMediaEngineOptions = {}
) {
  return new PlaywrightDocxMediaEngine(options);
}
