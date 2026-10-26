import {
  createDocxThemeStyleCaptureScript,
  parseDocxThemeStyleRuntimeCapture,
  type DocxThemeStyleCaptureRequest,
  type DocxThemeStyleSnapshot
} from "@morphdoc/docx-theme-engine";
import type { Page } from "playwright";

export async function captureDocxThemeStyleWithPlaywrightPage(
  page: Page,
  request: DocxThemeStyleCaptureRequest,
  signal?: AbortSignal
): Promise<DocxThemeStyleSnapshot> {
  signal?.throwIfAborted();
  await page.emulateMedia({ media: "print" });
  const capture = await page.evaluate(
    createDocxThemeStyleCaptureScript(request)
  );
  signal?.throwIfAborted();
  return parseDocxThemeStyleRuntimeCapture(request, capture);
}
