import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOCX_MIME_TYPE,
  defaultExportConfig,
  type DocxCapability
} from "@morphdoc/core";
import {
  createDocxDiagnosticsMessage,
  getDocxCapability,
  requestDesktopDocxExport,
  requestDocxExport
} from "../src/docx-export";

afterEach(() => {
  vi.unstubAllGlobals();
});

const availableCapability: DocxCapability = {
  format: "docx",
  status: "available",
  expectedVersion: "3.9.0.2",
  detectedVersion: "3.9.0.2"
};

const request = {
  markdown: "# 测试",
  fileName: "测试.md",
  language: "zh-CN",
  resources: [],
  exportConfig: defaultExportConfig
};

describe("DOCX 导出客户端", () => {
  it("在 Web 环境读取服务端 capability", async () => {
    vi.stubGlobal("window", {});
    const fetcher = vi.fn(async () =>
      Response.json(availableCapability)
    );

    await expect(getDocxCapability(fetcher)).resolves.toEqual(
      availableCapability
    );
    expect(fetcher).toHaveBeenCalledWith("/api/docx/capability");
  });

  it("在 Desktop 环境通过最小 IPC 读取 capability", async () => {
    const getDesktopCapability = vi.fn(
      async () => availableCapability
    );
    vi.stubGlobal("window", {
      morphDocDesktop: {
        getDocxCapability: getDesktopCapability
      }
    });
    const fetcher = vi.fn();

    await expect(getDocxCapability(fetcher)).resolves.toEqual(
      availableCapability
    );
    expect(getDesktopCapability).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("请求 DOCX 并读取文件名与诊断头", async () => {
    vi.stubGlobal("window", {});
    const fetcher = vi.fn(async () => {
      return new Response(new Blob(["PK-test"]), {
        status: 200,
        headers: {
          "content-type": DOCX_MIME_TYPE,
          "content-disposition":
            "attachment; filename=\"document.docx\"; " +
            "filename*=UTF-8''%E6%B5%8B%E8%AF%95.docx",
          "x-docx-warning-count": "2",
          "x-echarts-error-count": "1",
          "x-mermaid-error-count": "0"
        }
      });
    });

    const result = await requestDocxExport(request, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/docx",
      expect.objectContaining({ method: "POST" })
    );
    expect(result.fileName).toBe("测试.docx");
    expect(result.warningCount).toBe(2);
    expect(result.echartsErrorCount).toBe(1);
    expect(result.mermaidErrorCount).toBe(0);
    expect(await result.blob.text()).toBe("PK-test");
  });

  it("拒绝服务端返回的非 DOCX 文件", async () => {
    vi.stubGlobal("window", {});
    const fetcher = vi.fn(async () =>
      new Response("error page", {
        status: 200,
        headers: { "content-type": "text/html" }
      })
    );

    await expect(
      requestDocxExport(request, fetcher)
    ).rejects.toThrow("DOCX 服务返回了无效文件类型");
  });

  it("显示服务端结构化错误", async () => {
    vi.stubGlobal("window", {});
    const fetcher = vi.fn(async () =>
      Response.json(
        { message: "Pandoc 版本不匹配" },
        { status: 503 }
      )
    );

    await expect(
      requestDocxExport(request, fetcher)
    ).rejects.toThrow("Pandoc 版本不匹配");
  });

  it("Desktop 保存取消保持为正常结果", async () => {
    const exportDocx = vi.fn(async () => ({
      ok: true as const,
      saved: false,
      fileName: "测试.docx",
      diagnostics: {
        warnings: [],
        echartsErrors: [],
        mermaidErrors: []
      },
      timings: {
        queueMs: 0,
        probeMs: 0,
        prepareMs: 0,
        themeStyleMs: 0,
        mediaMs: 0,
        referenceMs: 0,
        pandocMs: 0,
        validationMs: 0,
        totalMs: 0
      }
    }));
    vi.stubGlobal("window", {
      morphDocDesktop: { exportDocx }
    });

    await expect(
      requestDesktopDocxExport(request)
    ).resolves.toEqual({
      saved: false,
      fileName: "测试.docx",
      warningCount: 0,
      echartsErrorCount: 0,
      mermaidErrorCount: 0
    });
  });

  it("Desktop 失败结果转换为可展示错误", async () => {
    vi.stubGlobal("window", {
      morphDocDesktop: {
        exportDocx: vi.fn(async () => ({
          ok: false as const,
          error: "DOCX_QUEUE_FULL" as const,
          message: "DOCX 生成队列已满",
          retryable: true
        }))
      }
    });

    await expect(
      requestDesktopDocxExport(request)
    ).rejects.toThrow("DOCX 生成队列已满");
  });

  it("生成简洁的 DOCX 诊断摘要", () => {
    expect(
      createDocxDiagnosticsMessage({
        warningCount: 0,
        echartsErrorCount: 0,
        mermaidErrorCount: 0
      })
    ).toBe("纸张、样式和可编辑结构已写入文档");
    expect(
      createDocxDiagnosticsMessage({
        warningCount: 2,
        echartsErrorCount: 1,
        mermaidErrorCount: 3
      })
    ).toBe(
      "2 条提示，1 个 ECharts 图表失败，3 个 Mermaid 图表失败"
    );
  });
});
