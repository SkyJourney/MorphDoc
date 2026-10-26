import {
  createDocxThemeStyleCaptureScript,
  parseDocxThemeStyleRuntimeCapture,
  type DocxThemeStyleCaptureRequest,
  type DocxThemeStyleSnapshot
} from "@morphdoc/docx-theme-engine";
import type { WebContents } from "electron";

export async function captureDocxThemeStyleWithElectronWebContents(
  webContents: WebContents,
  request: DocxThemeStyleCaptureRequest,
  signal?: AbortSignal
): Promise<DocxThemeStyleSnapshot> {
  signal?.throwIfAborted();
  const ownsDebugger = !webContents.debugger.isAttached();
  if (ownsDebugger) {
    webContents.debugger.attach("1.3");
  }
  try {
    await webContents.debugger.sendCommand(
      "Emulation.setEmulatedMedia",
      { media: "print" }
    );
    const capture = await webContents.executeJavaScript(
      createDocxThemeStyleCaptureScript(request),
      true
    );
    signal?.throwIfAborted();
    return parseDocxThemeStyleRuntimeCapture(request, capture);
  } finally {
    if (
      !webContents.isDestroyed() &&
      webContents.debugger.isAttached()
    ) {
      await webContents.debugger
        .sendCommand("Emulation.setEmulatedMedia", {
          media: "screen"
        })
        .catch(() => undefined);
      if (ownsDebugger && webContents.debugger.isAttached()) {
        webContents.debugger.detach();
      }
    }
  }
}
