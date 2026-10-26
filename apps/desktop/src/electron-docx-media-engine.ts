import { BrowserWindow } from "electron";
import type {
  DocxMediaCaptureAdapter,
  DocxMediaCaptureRequest
} from "@morphdoc/application";
import type {
  DocxThemeStyleCaptureAdapter,
  DocxThemeStyleCaptureRequest
} from "@morphdoc/docx-theme-engine";
import { captureDocxMediaWithElectronWebContents } from "./electron-docx-media-capture.js";
import { captureDocxThemeStyleWithElectronWebContents } from "./electron-docx-theme-style.js";
import { isAllowedPdfRuntimeUrl } from "./pdf-contract.js";

export const DESKTOP_DOCX_PARTITION =
  "morphdoc-desktop-docx";

export interface ElectronDocxMediaEngineOptions {
  renderUrl: string;
}

export async function withActiveDocxCaptureSurface<T>(
  window: Pick<
    BrowserWindow,
    "showInactive" | "hide" | "isDestroyed"
  >,
  operation: () => Promise<T>,
  settleMs = 50
) {
  window.showInactive();
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  try {
    return await operation();
  } finally {
    if (!window.isDestroyed()) {
      window.hide();
    }
  }
}

export class ElectronDocxMediaEngine
  implements DocxMediaCaptureAdapter, DocxThemeStyleCaptureAdapter
{
  readonly themeStyleBaseUrl: string;
  private readonly renderUrl: string;
  private windowPromise: Promise<BrowserWindow> | undefined;
  private queue = Promise.resolve();
  private closed = false;

  constructor(options: ElectronDocxMediaEngineOptions) {
    this.renderUrl = options.renderUrl;
    this.themeStyleBaseUrl = this.renderUrl;
  }

  capture(
    request: DocxMediaCaptureRequest,
    signal?: AbortSignal
  ) {
    if (this.closed) {
      return Promise.reject(new Error("桌面 DOCX 媒体引擎已关闭"));
    }
    const operation = this.queue.then(() =>
      this.captureNow(request, signal)
    );
    this.queue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  captureThemeStyle(
    request: DocxThemeStyleCaptureRequest,
    signal?: AbortSignal
  ) {
    if (this.closed) {
      return Promise.reject(new Error("桌面 DOCX 媒体引擎已关闭"));
    }
    const operation = this.queue.then(() =>
      this.captureThemeStyleNow(request, signal)
    );
    this.queue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  async close() {
    this.closed = true;
    await this.queue;
    const windowPromise = this.windowPromise;
    this.windowPromise = undefined;
    if (!windowPromise) {
      return;
    }
    try {
      const window = await windowPromise;
      if (!window.isDestroyed()) {
        window.destroy();
      }
    } catch {
      // 创建失败时没有需要关闭的窗口。
    }
  }

  private async captureNow(
    request: DocxMediaCaptureRequest,
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted();
    const window = await this.getWindow();
    signal?.throwIfAborted();
    const abort = () => {
      if (!window.isDestroyed()) {
        window.destroy();
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      return await withActiveDocxCaptureSurface(
        window,
        () =>
          captureDocxMediaWithElectronWebContents(
            window.webContents,
            request,
            signal
          )
      );
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  private async captureThemeStyleNow(
    request: DocxThemeStyleCaptureRequest,
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted();
    if (
      new URL(request.baseUrl).origin !==
      new URL(this.renderUrl).origin
    ) {
      throw new Error("桌面 DOCX 主题资源地址必须与渲染地址同源");
    }
    const window = await this.getWindow();
    signal?.throwIfAborted();
    const abort = () => {
      if (!window.isDestroyed()) {
        window.destroy();
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      return await captureDocxThemeStyleWithElectronWebContents(
        window.webContents,
        request,
        signal
      );
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  private getWindow() {
    if (!this.windowPromise) {
      this.windowPromise = this.createWindow().catch((error) => {
        this.windowPromise = undefined;
        throw error;
      });
    }
    return this.windowPromise;
  }

  private async createWindow() {
    const window = new BrowserWindow({
      show: false,
      focusable: false,
      opacity: 0,
      skipTaskbar: true,
      x: -32_000,
      y: -32_000,
      width: 1280,
      height: 900,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: DESKTOP_DOCX_PARTITION
      }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      const target = new URL(url);
      const renderTarget = new URL(this.renderUrl);
      if (
        target.origin !== renderTarget.origin ||
        target.pathname !== renderTarget.pathname
      ) {
        event.preventDefault();
      }
    });
    window.webContents.on("destroyed", () => {
      this.windowPromise = undefined;
    });
    window.webContents.session.webRequest.onBeforeRequest(
      { urls: ["*://*/*"] },
      (details, callback) => {
        callback({
          cancel: !isAllowedPdfRuntimeUrl(details.url, this.renderUrl)
        });
      }
    );

    try {
      await window.loadURL(this.renderUrl);
      await window.webContents.executeJavaScript(`
        new Promise((resolve, reject) => {
          if (document.documentElement.dataset.runtimeReady === "true") {
            resolve();
            return;
          }
          const timeout = setTimeout(() => {
            observer.disconnect();
            reject(new Error("桌面 DOCX 媒体运行时启动超时"));
          }, 10000);
          const observer = new MutationObserver(() => {
            if (document.documentElement.dataset.runtimeReady === "true") {
              clearTimeout(timeout);
              observer.disconnect();
              resolve();
            }
          });
          observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-runtime-ready"]
          });
        })
      `);
      window.webContents.setZoomFactor(1);
      return window;
    } catch (error) {
      window.destroy();
      throw error;
    }
  }
}
