import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import {
  createPagedDocumentPayload,
  defaultExportConfig,
  type DocxMediaCapturePlan
} from "@morphdoc/core";
import { captureDocxMediaWithPlaywrightPage } from "../src/playwright-docx-media-capture.js";

const plan: DocxMediaCapturePlan = {
  targets: [
    {
      id: "docx-media-1",
      kind: "echarts",
      ordinal: 1,
      kindOrdinal: 1,
      altText: "图表",
      alignment: "center",
      displayWidthPx: 320,
      displayHeightPx: 180,
      captureX: 10,
      captureY: 20,
      captureWidthPx: 320,
      captureHeightPx: 180,
      rasterScale: 3.125
    }
  ],
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

describe("Playwright DOCX 媒体捕获", () => {
  it("按运行时计划以目标倍率捕获 PNG", async () => {
    const detach = vi.fn(async () => undefined);
    const send = vi.fn(async () => ({
      data: Buffer.from("png").toString("base64")
    }));
    const page = {
      emulateMedia: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => plan),
      context: () => ({
        newCDPSession: vi.fn(async () => ({ send, detach }))
      })
    } as unknown as Page;

    const result = await captureDocxMediaWithPlaywrightPage(
      page,
      request
    );

    expect(result.plan).toBe(plan);
    expect(page.emulateMedia).toHaveBeenCalledWith({ media: "print" });
    expect(result.captures[0]).toEqual({
      id: "docx-media-1",
      png: Buffer.from("png")
    });
    expect(send).toHaveBeenCalledWith("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        x: 10,
        y: 20,
        width: 320,
        height: 180,
        scale: 3.125
      }
    });
    expect(detach).toHaveBeenCalledOnce();
  });
});
