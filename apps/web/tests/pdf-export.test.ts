import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import {
  createPagedDocumentPayload,
  defaultExportConfig
} from "@morphdoc/core";
import {
  createPdfExportCacheKey,
  downloadPdf,
  getCachedPdfExport,
  getOrRequestPdfExport,
  parseContentDispositionFileName,
  requestDesktopPdfExport,
  requestPdfExport,
  type CachedPdfExport,
  type PdfExportRequest
} from "../src/pdf-export";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PDF 导出客户端", () => {
  it("仅复用与当前文档和导出配置完全匹配的 PDF", () => {
    const request: PdfExportRequest = {
      markdown: "# 测试",
      fileName: "测试.md",
      language: "zh-CN",
      exportConfig: defaultExportConfig
    };
    const key = createPdfExportCacheKey(request);
    const result = {
      blob: new Blob(["%PDF-test"]),
      fileName: "测试.pdf",
      pageCount: 1,
      echartsErrorCount: 0,
      mermaidErrorCount: 0
    };
    const cache: CachedPdfExport = { key, result };

    expect(getCachedPdfExport(cache, key)).toBe(result);
    expect(
      getCachedPdfExport(
        cache,
        createPdfExportCacheKey({
          ...request,
          markdown: "# 已修改"
        })
      )
    ).toBeUndefined();
    expect(
      getCachedPdfExport(
        cache,
        createPdfExportCacheKey({
          ...request,
          exportConfig: {
            ...defaultExportConfig,
            paper: {
              ...defaultExportConfig.paper,
              orientation: "landscape"
            }
          }
        })
      )
    ).toBeUndefined();
  });

  it("命中缓存时复用同一个 PDF Blob 且不重复请求", async () => {
    const request: PdfExportRequest = {
      markdown: "# 测试",
      fileName: "测试.md",
      language: "zh-CN",
      exportConfig: defaultExportConfig
    };
    const result = {
      blob: new Blob(["%PDF-cached"]),
      fileName: "测试.pdf",
      pageCount: 1,
      echartsErrorCount: 0,
      mermaidErrorCount: 0
    };
    const cache: CachedPdfExport = {
      key: createPdfExportCacheKey(request),
      result
    };
    const requester = vi.fn();

    const resolved = await getOrRequestPdfExport(
      request,
      cache,
      requester
    );

    expect(requester).not.toHaveBeenCalled();
    expect(resolved).toEqual(cache);
    expect(resolved.result.blob).toBe(result.blob);
  });

  it("缓存失效时请求并保存当前 PDF", async () => {
    const request: PdfExportRequest = {
      markdown: "# 新内容",
      fileName: "测试.md",
      language: "zh-CN",
      exportConfig: defaultExportConfig
    };
    const result = {
      blob: new Blob(["%PDF-new"]),
      fileName: "测试.pdf",
      pageCount: 2,
      echartsErrorCount: 0,
      mermaidErrorCount: 0
    };
    const requester = vi.fn(async () => result);

    const resolved = await getOrRequestPdfExport(
      request,
      undefined,
      requester
    );

    expect(requester).toHaveBeenCalledOnce();
    expect(resolved.key).toBe(createPdfExportCacheKey(request));
    expect(resolved.result).toBe(result);
  });

  it("优先解析 UTF-8 下载文件名", () => {
    expect(
      parseContentDispositionFileName(
        "attachment; filename=\"document.pdf\"; " +
          "filename*=UTF-8''%E6%B5%8B%E8%AF%95.pdf"
      )
    ).toBe("测试.pdf");
  });

  it("请求 PDF 并读取生成信息", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(new Blob(["%PDF-test"]), {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition":
            "attachment; filename=\"document.pdf\"",
          "x-pdf-page-count": "4",
          "x-echarts-error-count": "2",
          "x-mermaid-error-count": "1"
        }
      });
    });

    const result = await requestPdfExport(
      {
        markdown: "# 测试",
        fileName: "测试.md",
        language: "zh-CN",
        exportConfig: defaultExportConfig
      },
      fetcher
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/api/pdf",
      expect.objectContaining({ method: "POST" })
    );
    expect(result.fileName).toBe("document.pdf");
    expect(result.pageCount).toBe(4);
    expect(result.echartsErrorCount).toBe(2);
    expect(result.mermaidErrorCount).toBe(1);
    expect(await result.blob.text()).toBe("%PDF-test");
  });

  it("显示服务端返回的错误信息", async () => {
    const fetcher = vi.fn(async () => {
      return Response.json(
        { message: "PDF 生成队列已满" },
        { status: 503 }
      );
    });

    await expect(
      requestPdfExport(
        {
          markdown: "# 测试",
          fileName: "测试.md",
          language: "zh-CN",
          exportConfig: defaultExportConfig
        },
        fetcher
      )
    ).rejects.toThrow("PDF 生成队列已满");
  });

  it("桌面端使用共享分页载荷生成并保存 PDF", async () => {
    const payload = createPagedDocumentPayload({
      document: {
        rendererVersion: 1,
        articleHtml: '<article id="write">测试</article>',
        bodyHtml: "测试",
        metadata: {
          title: "测试",
          author: "",
          subject: "",
          keywords: [],
          language: "zh-CN"
        },
        features: [],
        warnings: []
      },
      fileName: "测试.md",
      themeCss: "",
      exportConfig: defaultExportConfig
    });
    const generatePdf = vi.fn(async () => ({
      pdf: new TextEncoder().encode("%PDF-desktop"),
      pageCount: 2,
      echartsErrors: [],
      mermaidErrors: ["图表 1"]
    }));
    const savePdf = vi.fn(async () => true);
    vi.stubGlobal("window", {
      morphDocDesktop: { generatePdf, savePdf }
    });

    const generated = await requestDesktopPdfExport(payload);
    const saved = await downloadPdf(generated.blob, generated.fileName);

    expect(generatePdf).toHaveBeenCalledWith(payload);
    expect(generated.fileName).toBe("测试.pdf");
    expect(generated.pageCount).toBe(2);
    expect(generated.mermaidErrorCount).toBe(1);
    expect(savePdf).toHaveBeenCalledWith(
      "测试.pdf",
      expect.any(Uint8Array)
    );
    expect(saved).toBe(true);
  });
});
