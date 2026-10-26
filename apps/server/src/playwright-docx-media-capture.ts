import type { Page } from "playwright";
import type {
  DocxMediaCaptureAdapter,
  DocxMediaCaptureRequest
} from "@morphdoc/application";
import type { DocxMediaCapturePlan } from "@morphdoc/core";

interface CaptureScreenshotResult {
  data: string;
}

async function renderCapturePlan(
  page: Page,
  request: DocxMediaCaptureRequest
) {
  return page.evaluate(
    async ({ payload, dimensions }): Promise<DocxMediaCapturePlan> => {
      const renderer = (
        window as typeof window & {
          __morphDocRenderDocxMedia?: (
            renderPayload: typeof payload,
            renderDimensions: typeof dimensions
          ) => Promise<DocxMediaCapturePlan>;
        }
      ).__morphDocRenderDocxMedia;
      if (!renderer) {
        throw new Error("DOCX 媒体渲染运行时不可用");
      }
      return renderer(payload, dimensions);
    },
    request
  );
}

export async function captureDocxMediaWithPlaywrightPage(
  page: Page,
  request: DocxMediaCaptureRequest,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  await page.emulateMedia({ media: "print" });
  const plan = await renderCapturePlan(page, request);
  signal?.throwIfAborted();
  const session = await page.context().newCDPSession(page);
  try {
    const captures = [];
    for (const target of plan.targets) {
      signal?.throwIfAborted();
      const result = (await session.send("Page.captureScreenshot", {
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
      })) as CaptureScreenshotResult;
      captures.push({
        id: target.id,
        png: Buffer.from(result.data, "base64")
      });
    }
    signal?.throwIfAborted();
    return { plan, captures };
  } finally {
    await session.detach();
  }
}

export class PlaywrightDocxMediaCaptureAdapter
  implements DocxMediaCaptureAdapter
{
  constructor(private readonly page: Page) {}

  capture(request: DocxMediaCaptureRequest, signal?: AbortSignal) {
    return captureDocxMediaWithPlaywrightPage(
      this.page,
      request,
      signal
    );
  }
}
