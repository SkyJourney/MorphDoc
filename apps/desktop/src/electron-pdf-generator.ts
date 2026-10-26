import {
  BrowserWindow,
  ipcMain,
  type IpcMainEvent
} from "electron";
import { performance } from "node:perf_hooks";
import type {
  PagedDocumentPayload,
  PagedDocumentRenderResult
} from "@morphdoc/core";
import {
  PDF_RUNTIME_COMPLETE,
  PDF_RUNTIME_FAIL,
  PDF_RUNTIME_READY,
  PDF_RUNTIME_RENDER
} from "./channels.js";
import {
  createElectronPdfPrintOptions,
  isAllowedPdfRuntimeUrl
} from "./pdf-contract.js";

export const DESKTOP_PDF_PARTITION =
  "morphdoc-desktop-pdf";

export interface ElectronPdfGenerationResult {
  pdf: Buffer;
  pageCount: number;
  echartsErrors: string[];
  mermaidErrors: string[];
  timings: {
    documentRenderMs: number;
    pdfPrintMs: number;
    totalMs: number;
  };
}

export interface ElectronPdfGeneratorOptions {
  renderUrl: string;
  preloadPath: string;
  timeoutMs?: number;
}

interface PendingRender {
  requestId: number;
  resolve: (result: PagedDocumentRenderResult) => void;
  reject: (reason: Error) => void;
}

async function waitWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string
) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(message)),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export class ElectronPdfGenerator {
  private readonly renderUrl: string;
  private readonly preloadPath: string;
  private readonly timeoutMs: number;
  private windowPromise: Promise<BrowserWindow> | undefined;
  private renderWindow: BrowserWindow | undefined;
  private pendingRender: PendingRender | undefined;
  private nextRequestId = 1;
  private queue = Promise.resolve();
  private closed = false;

  constructor(options: ElectronPdfGeneratorOptions) {
    this.renderUrl = options.renderUrl;
    this.preloadPath = options.preloadPath;
    this.timeoutMs = options.timeoutMs ?? 60_000;

    ipcMain.on(PDF_RUNTIME_COMPLETE, this.handleRenderComplete);
    ipcMain.on(PDF_RUNTIME_FAIL, this.handleRenderFailure);
  }

  generate(payload: PagedDocumentPayload) {
    if (this.closed) {
      return Promise.reject(new Error("桌面 PDF 引擎已关闭"));
    }

    const operation = this.queue.then(() => this.generateNow(payload));
    this.queue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  async close() {
    this.closed = true;
    ipcMain.removeListener(
      PDF_RUNTIME_COMPLETE,
      this.handleRenderComplete
    );
    ipcMain.removeListener(PDF_RUNTIME_FAIL, this.handleRenderFailure);
    this.pendingRender?.reject(new Error("桌面 PDF 引擎已关闭"));
    this.pendingRender = undefined;

    const windowPromise = this.windowPromise;
    this.windowPromise = undefined;
    this.renderWindow = undefined;
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

  private async generateNow(payload: PagedDocumentPayload) {
    const startedAt = performance.now();
    const window = await this.getWindow();
    const documentRenderStartedAt = performance.now();
    const renderResult = await this.requestRender(window, payload);
    const documentRenderMs =
      performance.now() - documentRenderStartedAt;
    await window.webContents.executeJavaScript(
      "new Promise((resolve) => setTimeout(resolve, 0))"
    );

    const pdfPrintStartedAt = performance.now();
    window.showInactive();
    await new Promise((resolve) => setTimeout(resolve, 50));
    let pdf: Buffer;
    try {
      pdf = await waitWithTimeout(
        window.webContents.printToPDF(
          createElectronPdfPrintOptions(payload, renderResult)
        ),
        this.timeoutMs,
        `桌面 PDF 打印超过 ${this.timeoutMs}ms`
      );
    } catch (error) {
      if (!window.isDestroyed()) {
        window.destroy();
      }
      throw error;
    } finally {
      if (!window.isDestroyed()) {
        window.hide();
      }
    }
    const pdfPrintMs = performance.now() - pdfPrintStartedAt;

    return {
      pdf,
      pageCount: renderResult.pageCount,
      echartsErrors: renderResult.echartsErrors,
      mermaidErrors: renderResult.mermaidErrors,
      timings: {
        documentRenderMs,
        pdfPrintMs,
        totalMs: performance.now() - startedAt
      }
    } satisfies ElectronPdfGenerationResult;
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
        partition: DESKTOP_PDF_PARTITION,
        preload: this.preloadPath
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
      if (this.windowPromise) {
        this.windowPromise = undefined;
      }
      this.renderWindow = undefined;
      this.pendingRender?.reject(
        new Error("桌面 PDF 渲染窗口已关闭")
      );
      this.pendingRender = undefined;
    });
    window.webContents.session.webRequest.onBeforeRequest(
      { urls: ["*://*/*"] },
      (details, callback) => {
        callback({
          cancel: !isAllowedPdfRuntimeUrl(details.url, this.renderUrl)
        });
      }
    );

    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("桌面 PDF 分页运行时启动超时"));
      }, this.timeoutMs);
      const handleReady = (event: IpcMainEvent) => {
        if (event.sender !== window.webContents) {
          return;
        }
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timeout);
        ipcMain.removeListener(PDF_RUNTIME_READY, handleReady);
      };
      ipcMain.on(PDF_RUNTIME_READY, handleReady);
    });

    try {
      await Promise.all([window.loadURL(this.renderUrl), ready]);
      window.webContents.setZoomFactor(1);
      this.renderWindow = window;
      return window;
    } catch (error) {
      window.destroy();
      throw error;
    }
  }

  private requestRender(
    window: BrowserWindow,
    payload: PagedDocumentPayload
  ) {
    if (this.pendingRender) {
      throw new Error("桌面 PDF 渲染器状态异常");
    }

    const requestId = this.nextRequestId++;
    return new Promise<PagedDocumentRenderResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingRender?.requestId === requestId) {
          this.pendingRender = undefined;
          reject(new Error(`桌面 PDF 生成超过 ${this.timeoutMs}ms`));
          if (!window.isDestroyed()) {
            window.destroy();
          }
        }
      }, this.timeoutMs);

      this.pendingRender = {
        requestId,
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      };
      window.webContents.send(PDF_RUNTIME_RENDER, requestId, payload);
    });
  }

  private readonly handleRenderComplete = (
    event: IpcMainEvent,
    requestId: number,
    result: PagedDocumentRenderResult
  ) => {
    const pending = this.pendingRender;
    if (
      !pending ||
      pending.requestId !== requestId ||
      event.sender !== this.renderWindow?.webContents
    ) {
      return;
    }
    this.pendingRender = undefined;
    pending.resolve(result);
  };

  private readonly handleRenderFailure = (
    event: IpcMainEvent,
    requestId: number,
    message: string
  ) => {
    const pending = this.pendingRender;
    if (
      !pending ||
      pending.requestId !== requestId ||
      event.sender !== this.renderWindow?.webContents
    ) {
      return;
    }
    this.pendingRender = undefined;
    pending.reject(
      new Error(
        typeof message === "string" ? message : "桌面 PDF 分页失败"
      )
    );
  };
}
