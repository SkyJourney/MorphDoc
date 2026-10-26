import { describe, expect, it, vi } from "vitest";
import type { Browser } from "playwright";
import {
  createPagedDocumentPayload,
  defaultExportConfig,
  type DocxMediaCapturePlan
} from "@morphdoc/core";
import { PlaywrightDocxMediaEngine } from "../src/docx-media-engine.js";

const emptyPlan: DocxMediaCapturePlan = {
  targets: [],
  echartsErrors: [],
  mermaidErrors: []
};

const request = {
  payload: createPagedDocumentPayload({
    document: {
      rendererVersion: 1,
      articleHtml: '<article id="write"></article>',
      bodyHtml: "",
      metadata: {
        title: "",
        author: "",
        subject: "",
        keywords: [],
        language: "zh-CN"
      },
      features: [],
      warnings: []
    },
    fileName: "test.md",
    themeCss: "",
    exportConfig: defaultExportConfig
  }),
  dimensions: {
    contentWidthPx: 600,
    contentHeightPx: 900
  }
};

describe("Server DOCX 媒体浏览器", () => {
  it("使用请求级上下文并阻止非同源网络访问", async () => {
    const continueRoute = vi.fn(async () => undefined);
    const abortRoute = vi.fn(async () => undefined);
    const detach = vi.fn(async () => undefined);
    const page = {
      goto: vi.fn(async () => undefined),
      emulateMedia: vi.fn(async () => undefined),
      waitForFunction: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => emptyPlan),
      context: () => context
    };
    const context = {
      route: vi.fn(
        async (
          _pattern: string,
          handler: (route: {
            request(): { url(): string };
            continue(): Promise<void>;
            abort(reason: string): Promise<void>;
          }) => Promise<void>
        ) => {
          await handler({
            request: () => ({
              url: () => "http://renderer.test/assets/runtime.js"
            }),
            continue: continueRoute,
            abort: abortRoute
          });
          await handler({
            request: () => ({
              url: () => "https://external.test/tracker.js"
            }),
            continue: continueRoute,
            abort: abortRoute
          });
        }
      ),
      newPage: vi.fn(async () => page),
      newCDPSession: vi.fn(async () => ({
        send: vi.fn(),
        detach
      })),
      close: vi.fn(async () => undefined)
    };
    const browser = {
      newContext: vi.fn(async () => context),
      on: vi.fn(),
      close: vi.fn(async () => undefined)
    } as unknown as Browser;
    const engine = new PlaywrightDocxMediaEngine({
      renderOrigin: "http://renderer.test",
      launchBrowser: vi.fn(async () => browser)
    });

    const result = await engine.capture(request);

    expect(result.plan).toEqual(emptyPlan);
    expect(browser.newContext).toHaveBeenCalledWith({
      locale: "zh-CN",
      serviceWorkers: "block"
    });
    expect(page.goto).toHaveBeenCalledWith(
      "http://renderer.test/preview-frame.html?target=continuous",
      { waitUntil: "domcontentloaded" }
    );
    expect(page.emulateMedia).toHaveBeenCalledWith({ media: "print" });
    expect(continueRoute).toHaveBeenCalledTimes(1);
    expect(abortRoute).toHaveBeenCalledWith("blockedbyclient");
    expect(detach).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();

    await engine.close();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("关闭后拒绝预热和媒体捕获", async () => {
    const engine = new PlaywrightDocxMediaEngine({
      renderOrigin: "http://renderer.test",
      launchBrowser: vi.fn()
    });

    await engine.close();

    await expect(engine.warmup()).rejects.toThrow(
      "DOCX 媒体服务已关闭"
    );
    await expect(engine.capture(request)).rejects.toThrow(
      "DOCX 媒体服务已关闭"
    );
  });
});
