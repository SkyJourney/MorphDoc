import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  ApplicationRequestError,
  DocxExportServiceError,
  type DocxMediaCaptureAdapter
} from "@morphdoc/application";
import {
  DOCX_MIME_TYPE,
  defaultExportConfig,
  type DocxCapability,
  type DocxExportResult
} from "@morphdoc/core";
import { buildApp } from "../src/app.js";
import type { PdfGenerator } from "../src/pdf-engine.js";
import type { ServerDocxMediaCaptureAdapter } from "../src/docx-media-engine.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const availableCapability: DocxCapability = {
  format: "docx",
  status: "available",
  expectedVersion: "3.9.0.2",
  detectedVersion: "3.9.0.2"
};

function generatedDocx(): DocxExportResult {
  return {
    docx: new Uint8Array([80, 75, 3, 4]),
    fileName: "测试报告.docx",
    diagnostics: {
      warnings: ["字体可能被替换"],
      echartsErrors: ["图表 1"],
      mermaidErrors: []
    },
    timings: {
      queueMs: 1,
      probeMs: 2,
      prepareMs: 3,
      themeStyleMs: 4,
      mediaMs: 5,
      referenceMs: 6,
      pandocMs: 7,
      validationMs: 8,
      totalMs: 36
    }
  };
}

function createDocxService(
  overrides: {
    capability?: DocxCapability;
    generate?: (request: unknown) => Promise<DocxExportResult>;
  } = {}
) {
  return {
    getCapability: vi
      .fn()
      .mockResolvedValue(
        overrides.capability ?? availableCapability
      ),
    generate: vi.fn(
      overrides.generate ?? (async () => generatedDocx())
    ),
    close: vi.fn(async () => undefined)
  };
}

function createMediaAdapter() {
  return {
    themeStyleBaseUrl:
      "http://localhost:5173/preview-frame.html",
    capture: vi.fn<
      DocxMediaCaptureAdapter["capture"]
    >(async () => ({
      plan: {
        targets: [],
        echartsErrors: [],
        mermaidErrors: []
      },
      captures: []
    })),
    captureThemeStyle: vi.fn(async () => {
      throw new Error("此测试使用注入的 DOCX 导出服务");
    }),
    close: vi.fn(async () => undefined)
  } satisfies ServerDocxMediaCaptureAdapter;
}

function createPdfGenerator() {
  return {
    generate: vi.fn(),
    close: vi.fn(async () => undefined)
  } as unknown as PdfGenerator;
}

function createTestApp(
  service = createDocxService(),
  mediaAdapter = createMediaAdapter()
) {
  app = buildApp({
    logger: false,
    pdfGenerator: createPdfGenerator(),
    docxExportService: service,
    docxMediaAdapter: mediaAdapter
  });
  return { app, service, mediaAdapter };
}

describe("DOCX HTTP API", () => {
  it("在统一 capability 中报告 DOCX 运行时状态", async () => {
    const { app: instance, service } = createTestApp();

    const response = await instance.inject({
      method: "GET",
      url: "/api/capabilities"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().docx).toEqual(availableCapability);
    expect(response.json().implemented).toContain("docx-export");
    expect(service.getCapability).toHaveBeenCalledTimes(1);
  });

  it("通过独立端点返回不可用 capability", async () => {
    const capability: DocxCapability = {
      format: "docx",
      status: "not-found",
      expectedVersion: "3.9.0.2",
      message: "未找到 Pandoc 运行时"
    };
    const { app: instance } = createTestApp(
      createDocxService({ capability })
    );

    const response = await instance.inject({
      method: "GET",
      url: "/api/docx/capability"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(capability);
  });

  it("生成 DOCX 并返回安全文件名、诊断和耗时", async () => {
    const { app: instance, service, mediaAdapter } =
      createTestApp();
    const payload = {
      markdown: "# 测试报告",
      fileName: "目录/测试报告.md",
      language: "zh-CN",
      resources: [],
      exportConfig: defaultExportConfig
    };

    const response = await instance.inject({
      method: "POST",
      url: "/api/docx",
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain(
      DOCX_MIME_TYPE
    );
    expect(response.headers["content-disposition"]).toContain(
      "filename*=UTF-8''%E6%B5%8B%E8%AF%95%E6%8A%A5%E5%91%8A.docx"
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-docx-warning-count"]).toBe("1");
    expect(response.headers["x-echarts-error-count"]).toBe("1");
    expect(response.headers["x-mermaid-error-count"]).toBe("0");
    expect(response.headers["server-timing"]).toContain(
      "runtime-probe;dur=2.0"
    );
    expect(response.headers["server-timing"]).toContain(
      "pandoc;dur=7.0"
    );
    expect(response.rawPayload).toEqual(
      Buffer.from([80, 75, 3, 4])
    );
    expect(service.generate).toHaveBeenCalledWith(payload, {
      mediaAdapter,
      signal: expect.any(AbortSignal)
    });
  });

  it("映射应用请求错误", async () => {
    const service = createDocxService({
      generate: async () => {
        throw new ApplicationRequestError(
          400,
          "INVALID_EXPORT_CONFIG",
          "导出配置无效"
        );
      }
    });
    const { app: instance } = createTestApp(service);

    const response = await instance.inject({
      method: "POST",
      url: "/api/docx",
      payload: {}
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "INVALID_EXPORT_CONFIG",
      message: "导出配置无效",
      retryable: false
    });
  });

  it("映射可重试的队列错误", async () => {
    const service = createDocxService({
      generate: async () => {
        throw new DocxExportServiceError(
          429,
          "DOCX_QUEUE_FULL",
          "DOCX 生成队列已满",
          true
        );
      }
    });
    const { app: instance } = createTestApp(service);

    const response = await instance.inject({
      method: "POST",
      url: "/api/docx",
      payload: {}
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("5");
    expect(response.json()).toEqual({
      error: "DOCX_QUEUE_FULL",
      message: "DOCX 生成队列已满",
      retryable: true
    });
  });

  it("关闭应用时按顺序释放共享服务与媒体浏览器", async () => {
    const service = createDocxService();
    const mediaAdapter = createMediaAdapter();
    const { app: instance } = createTestApp(
      service,
      mediaAdapter
    );

    await instance.close();

    expect(service.close).toHaveBeenCalledTimes(1);
    expect(mediaAdapter.close).toHaveBeenCalledTimes(1);
    app = undefined;
  });
});
