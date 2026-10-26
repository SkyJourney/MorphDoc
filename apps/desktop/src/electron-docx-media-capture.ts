import type { WebContents } from "electron";
import type {
  DocxMediaCaptureAdapter,
  DocxMediaCaptureRequest
} from "@morphdoc/application";
import type { DocxMediaCapturePlan } from "@morphdoc/core";

interface CaptureScreenshotResult {
  data: string;
}

export interface ElectronDocxMediaCaptureTimeouts {
  renderMs: number;
  screenshotMs: number;
}

const DEFAULT_CAPTURE_TIMEOUTS: ElectronDocxMediaCaptureTimeouts = {
  renderMs: 30_000,
  screenshotMs: 20_000
};

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
  signal?: AbortSignal
) {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () =>
      finish(() => reject(signal?.reason ?? new Error("操作已取消")));
    const timeout = setTimeout(
      () => finish(() => reject(new Error(message))),
      timeoutMs
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    );
  });
}

function createRenderScript(request: DocxMediaCaptureRequest) {
  const serialized = JSON.stringify(request);
  return `(async () => {
    const request = ${serialized};
    const renderer = window.__morphDocRenderDocxMedia;
    if (!renderer) {
      throw new Error("DOCX 媒体渲染运行时不可用");
    }
    return renderer(request.payload, request.dimensions);
  })()`;
}

export async function captureDocxMediaWithElectronWebContents(
  webContents: WebContents,
  request: DocxMediaCaptureRequest,
  signal?: AbortSignal,
  timeouts: ElectronDocxMediaCaptureTimeouts = DEFAULT_CAPTURE_TIMEOUTS
) {
  signal?.throwIfAborted();
  const ownsDebugger = !webContents.debugger.isAttached();
  if (ownsDebugger) {
    webContents.debugger.attach("1.3");
  }

  try {
    await webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
      media: "print"
    });
    const plan = (await withTimeout(
      webContents.executeJavaScript(createRenderScript(request), true),
      timeouts.renderMs,
      `桌面 DOCX 媒体布局超过 ${timeouts.renderMs}ms`,
      signal
    )) as DocxMediaCapturePlan;
    signal?.throwIfAborted();
    const captures = [];
    for (const target of plan.targets) {
      signal?.throwIfAborted();
      const result = (await withTimeout(
        webContents.debugger.sendCommand(
          "Page.captureScreenshot",
          {
            format: "png",
            fromSurface: true,
            captureBeyondViewport: true,
            clip: {
              x: target.captureX,
              y: target.captureY,
              width: target.captureWidthPx,
              height: target.captureHeightPx,
              scale: target.rasterScale
            }
          }
        ),
        timeouts.screenshotMs,
        `桌面 DOCX 第 ${target.ordinal}/${plan.targets.length} 个媒体（${target.kind}）PNG 捕获超过 ${timeouts.screenshotMs}ms`,
        signal
      )) as CaptureScreenshotResult;
      captures.push({
        id: target.id,
        png: Buffer.from(result.data, "base64")
      });
    }
    signal?.throwIfAborted();
    return { plan, captures };
  } finally {
    if (webContents.debugger.isAttached()) {
      await webContents.debugger
        .sendCommand("Emulation.setEmulatedMedia", { media: "screen" })
        .catch(() => undefined);
      if (ownsDebugger && webContents.debugger.isAttached()) {
        webContents.debugger.detach();
      }
    }
  }
}

export class ElectronDocxMediaCaptureAdapter
  implements DocxMediaCaptureAdapter
{
  constructor(private readonly webContents: WebContents) {}

  capture(request: DocxMediaCaptureRequest, signal?: AbortSignal) {
    return captureDocxMediaWithElectronWebContents(
      this.webContents,
      request,
      signal
    );
  }
}
