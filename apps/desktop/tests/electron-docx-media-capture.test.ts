import { describe, expect, it, vi } from "vitest";
import type { WebContents } from "electron";
import {
  createPagedDocumentPayload,
  defaultExportConfig,
  type DocxMediaCapturePlan
} from "@morphdoc/core";
import { captureDocxMediaWithElectronWebContents } from "../src/electron-docx-media-capture.js";

const plan: DocxMediaCapturePlan = {
  targets: [
    {
      id: "docx-media-1",
      kind: "image",
      ordinal: 1,
      kindOrdinal: 1,
      altText: "图片",
      alignment: "center",
      displayWidthPx: 200,
      displayHeightPx: 100,
      captureX: 12,
      captureY: 24,
      captureWidthPx: 200,
      captureHeightPx: 100,
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
      semanticDocument: {
        schemaVersion: 1,
        titlePolicy: {
          metadataTitle: "emit",
          firstBodyHeading: "keep"
        },
        regions: []
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

describe("Electron DOCX 媒体捕获", () => {
  it("复用隐藏 Chromium 并在捕获后释放调试会话", async () => {
    let attached = false;
    const attach = vi.fn(() => {
      attached = true;
    });
    const detach = vi.fn(() => {
      attached = false;
    });
    const sendCommand = vi.fn(async () => ({
      data: Buffer.from("png").toString("base64")
    }));
    const webContents = {
      executeJavaScript: vi.fn(async () => plan),
      debugger: {
        isAttached: vi.fn(() => attached),
        attach,
        detach,
        sendCommand
      }
    } as unknown as WebContents;

    const result = await captureDocxMediaWithElectronWebContents(
      webContents,
      request
    );

    expect(result.captures[0]).toEqual({
      id: "docx-media-1",
      png: Buffer.from("png")
    });
    expect(attach).toHaveBeenCalledWith("1.3");
    expect(sendCommand).toHaveBeenCalledWith(
      "Emulation.setEmulatedMedia",
      { media: "print" }
    );
    expect(sendCommand).toHaveBeenCalledWith(
      "Emulation.setEmulatedMedia",
      { media: "screen" }
    );
    expect(sendCommand).toHaveBeenCalledWith(
      "Page.captureScreenshot",
      expect.objectContaining({
        format: "png",
        clip: expect.objectContaining({ scale: 3.125 })
      })
    );
    expect(detach).toHaveBeenCalledOnce();
  });

  it("媒体布局永久不返回时报告局部超时", async () => {
    let attached = false;
    const webContents = {
      executeJavaScript: vi.fn(() => new Promise(() => undefined)),
      debugger: {
        isAttached: vi.fn(() => attached),
        attach: vi.fn(() => {
          attached = true;
        }),
        detach: vi.fn(() => {
          attached = false;
        }),
        sendCommand: vi.fn(async () => undefined)
      }
    } as unknown as WebContents;

    await expect(
      captureDocxMediaWithElectronWebContents(
        webContents,
        request,
        undefined,
        { renderMs: 10, screenshotMs: 10 }
      )
    ).rejects.toThrow("桌面 DOCX 媒体布局超过 10ms");
  });

  it("单个 PNG 永久不返回时报告媒体编号和类型", async () => {
    let attached = false;
    const detach = vi.fn(() => {
      attached = false;
    });
    const webContents = {
      executeJavaScript: vi.fn(async () => plan),
      debugger: {
        isAttached: vi.fn(() => attached),
        attach: vi.fn(() => {
          attached = true;
        }),
        detach,
        sendCommand: vi.fn((method: string) =>
          method === "Page.captureScreenshot"
            ? new Promise(() => undefined)
            : Promise.resolve(undefined)
        )
      }
    } as unknown as WebContents;

    await expect(
      captureDocxMediaWithElectronWebContents(
        webContents,
        request,
        undefined,
        { renderMs: 10, screenshotMs: 10 }
      )
    ).rejects.toThrow(
      "桌面 DOCX 第 1/1 个媒体（image）PNG 捕获超过 10ms"
    );
    expect(detach).toHaveBeenCalledOnce();
  });
});
