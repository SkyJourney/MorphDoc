import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildApp } from "../src/app.js";
import {
  createPdfContentDisposition,
  createPdfFileName
} from "../src/app.js";
import { createThemeRegistry } from "@morphdoc/application";
import {
  PdfEngineOverloadedError,
  type PdfGenerator
} from "../src/pdf-engine.js";
import { defaultExportConfig } from "@morphdoc/core";

let app: FastifyInstance | undefined;
let temporaryDirectory: string | undefined;

function localThemeManifest(
  id: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    manifestVersion: 1,
    id,
    name: "本地测试主题",
    version: "local",
    description: "本地主题测试",
    author: "test",
    license: "local-only",
    entry: "theme.css",
    domPreset: "typora",
    defaultFontSize: "16px",
    supportedFeatures: ["code", "table"],
    bundled: false,
    ...overrides
  };
}

function sha256(content: Uint8Array | string) {
  return createHash("sha256").update(content).digest("hex");
}

async function createServerFontPack(root: string) {
  const directory = join(root, "official-cjk", "1.0.0");
  const web = Buffer.from([31, 32, 33, 34]);
  const docx = Buffer.from([41, 42, 43, 44, 45]);
  const license = "SIL Open Font License 1.1";
  await mkdir(join(directory, "fonts"), { recursive: true });
  await writeFile(join(directory, "fonts", "serif.woff2"), web);
  await writeFile(join(directory, "fonts", "serif.ttf"), docx);
  await writeFile(join(directory, "OFL.txt"), license, "utf8");
  await writeFile(
    join(directory, "font-pack.json"),
    JSON.stringify({
      manifestVersion: 1,
      id: "official-cjk",
      version: "1.0.0",
      name: "政务中文字体包",
      description: "Server 字体包资源测试",
      license: "OFL-1.1",
      licenseFile: "OFL.txt",
      licenseSha256: sha256(license),
      licenseBytes: Buffer.byteLength(license),
      compatibility: {
        minimumAppVersion: "0.6.0",
        maximumAppVersionExclusive: "0.7.0"
      },
      faces: [
        {
          id: "serif-regular",
          targets: ["FandolSong", "MorphDoc Fandol Song"],
          weight: 400,
          style: "normal",
          web: {
            path: "fonts/serif.woff2",
            format: "woff2",
            bytes: web.byteLength,
            sha256: sha256(web)
          },
          docx: {
            path: "fonts/serif.ttf",
            format: "truetype",
            bytes: docx.byteLength,
            sha256: sha256(docx)
          }
        }
      ]
    }),
    "utf8"
  );
  return { web };
}

afterEach(async () => {
  await app?.close();
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  app = undefined;
  temporaryDirectory = undefined;
});

describe("预览 API", () => {
  it("关闭应用时释放 PDF 生成器", async () => {
    const close = vi.fn(async () => undefined);
    const pdfGenerator = {
      generate: vi.fn(),
      close
    } as unknown as PdfGenerator;
    app = buildApp({ pdfGenerator, logger: false });

    await app.close();

    expect(close).toHaveBeenCalledTimes(1);
    app = undefined;
  });

  it("按配置在应用就绪时预热 PDF 浏览器", async () => {
    const warmup = vi.fn(async () => undefined);
    app = buildApp({
      logger: false,
      prewarmPdfBrowser: true,
      pdfGenerator: {
        generate: vi.fn(),
        warmup,
        close: vi.fn(async () => undefined)
      } as unknown as PdfGenerator
    });

    await app.ready();
    expect(warmup).toHaveBeenCalledTimes(1);
  });

  it("渲染 Markdown 并返回安全文章结构", async () => {
    app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/render",
      payload: {
        markdown: "# 文档\n\n<script>alert('xss')</script>"
      }
    });

    expect(response.statusCode).toBe(200);
    const result = response.json();
    expect(result.articleHtml).toContain('id="write"');
    expect(result.articleHtml).not.toContain("<script");
    expect(result.metadata.title).toBe("文档");
  });

  it("拒绝非字符串 Markdown", async () => {
    app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/render",
      payload: {
        markdown: 42
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("INVALID_MARKDOWN");
  });

  it("将无效 Front Matter 映射为文档请求错误", async () => {
    app = buildApp({ logger: false });
    const response = await app.inject({
      method: "POST",
      url: "/api/render",
      payload: {
        markdown: "---\ntitle: [未闭合\n---\n\n# 文档"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("INVALID_FRONT_MATTER");
  });

  it("返回内置主题 CSS", async () => {
    app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/themes/typora-like/css"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/css");
    expect(response.body).toContain("#write");
  });

  it("为主题 CSS 提供经过注册器验证的字体包 Web 资源", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "morphdoc-font-pack-"));
    const fontPack = await createServerFontPack(temporaryDirectory);
    app = buildApp({
      logger: false,
      fontPacks: {
        roots: [temporaryDirectory],
        appVersion: "0.6.0"
      }
    });

    const cssResponse = await app.inject({
      method: "GET",
      url: "/api/themes/gov-red-standard/css"
    });
    expect(cssResponse.statusCode).toBe(200);
    expect(cssResponse.body).toContain("morphdoc-font-packs:official-cjk@1.0.0");
    expect(cssResponse.body).toContain(
      "/api/font-packs/official-cjk/1.0.0/serif-regular/web?v="
    );

    const assetResponse = await app.inject({
      method: "GET",
      url: `/api/font-packs/official-cjk/1.0.0/serif-regular/web?v=${sha256(fontPack.web)}`
    });
    expect(assetResponse.statusCode).toBe(200);
    expect(assetResponse.headers["content-type"]).toContain("font/woff2");
    expect(assetResponse.headers["cache-control"]).toContain("immutable");
    expect(assetResponse.rawPayload).toEqual(fontPack.web);

    const missingResponse = await app.inject({
      method: "GET",
      url: "/api/font-packs/official-cjk/2.0.0/serif-regular/web"
    });
    expect(missingResponse.statusCode).toBe(404);
  });

  it("发现本地主题并安全提供相对字体资源", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "morphdoc-theme-"));
    const themeDirectory = join(temporaryDirectory, "local-test");
    await mkdir(join(themeDirectory, "partials", "fonts"), {
      recursive: true
    });
    await writeFile(
      join(themeDirectory, "theme.json"),
      JSON.stringify(
        localThemeManifest("local-test", {
          base: "typora-base.css"
        })
      ),
      "utf8"
    );
    await writeFile(
      join(themeDirectory, "typora-base.css"),
      "/* base-layer */ table { width: 100%; border-collapse: collapse; }",
      "utf8"
    );
    await writeFile(
      join(themeDirectory, "theme.css"),
      [
        "@include-when-export url(https://example.com/font.css);",
        "@import \"partials/typography.css\";",
        "#write { font-family: LocalTest; }"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(themeDirectory, "partials", "typography.css"),
      [
        "/* imported-layer */",
        "@font-face { src: url('./fonts/test.woff2') format('woff2'); }"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(themeDirectory, "partials", "fonts", "test.woff2"),
      Buffer.from([0, 1, 2, 3])
    );

    app = buildApp({
      localThemeRoot: temporaryDirectory,
      logger: false
    });
    const themesResponse = await app.inject({
      method: "GET",
      url: "/api/themes"
    });
    expect(themesResponse.statusCode).toBe(200);
    expect(themesResponse.json().themes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "local-test",
          bundled: false,
          source: "local"
        })
      ])
    );

    const cssResponse = await app.inject({
      method: "GET",
      url: "/api/themes/local-test/css"
    });
    expect(cssResponse.statusCode).toBe(200);
    expect(cssResponse.body).not.toContain("@include-when-export");
    expect(cssResponse.body).toContain(
      "/api/themes/local-test/assets/partials/fonts/test.woff2"
    );
    expect(cssResponse.body.indexOf("base-layer")).toBeLessThan(
      cssResponse.body.indexOf("imported-layer")
    );
    expect(cssResponse.body.indexOf("imported-layer")).toBeLessThan(
      cssResponse.body.indexOf("font-family: LocalTest")
    );

    const assetResponse = await app.inject({
      method: "GET",
      url: "/api/themes/local-test/assets/partials/fonts/test.woff2"
    });
    expect(assetResponse.statusCode).toBe(200);
    expect(assetResponse.headers["content-type"]).toContain("font/woff2");
    expect(assetResponse.rawPayload).toEqual(Buffer.from([0, 1, 2, 3]));
  });

  it("拒绝主题 CSS 循环导入", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "morphdoc-theme-"));
    const bundledRoot = join(temporaryDirectory, "bundled");
    const localRoot = join(temporaryDirectory, "local");
    const themeDirectory = join(localRoot, "cycle-test");
    await mkdir(bundledRoot, { recursive: true });
    await mkdir(themeDirectory, { recursive: true });
    await writeFile(
      join(themeDirectory, "theme.json"),
      JSON.stringify(localThemeManifest("cycle-test")),
      "utf8"
    );
    await writeFile(
      join(themeDirectory, "theme.css"),
      '@import "nested.css";',
      "utf8"
    );
    await writeFile(
      join(themeDirectory, "nested.css"),
      '@import "theme.css";',
      "utf8"
    );

    const registry = createThemeRegistry({ bundledRoot, localRoot });
    await expect(registry.getCss("cycle-test")).rejects.toThrow(
      "主题 CSS 存在循环引用"
    );
  });

  it("忽略无效本地主题而不影响其他主题", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "morphdoc-theme-"));
    const bundledRoot = join(temporaryDirectory, "bundled");
    const localRoot = join(temporaryDirectory, "local");
    const validThemeRoot = join(localRoot, "valid-theme");
    const invalidThemeRoot = join(localRoot, "invalid-theme");
    await mkdir(bundledRoot, { recursive: true });
    await mkdir(validThemeRoot, { recursive: true });
    await mkdir(invalidThemeRoot, { recursive: true });
    await writeFile(
      join(validThemeRoot, "theme.json"),
      JSON.stringify(localThemeManifest("valid-theme")),
      "utf8"
    );
    await writeFile(
      join(validThemeRoot, "theme.css"),
      "#write { color: #333; }",
      "utf8"
    );
    const onWarning = vi.fn();
    const registry = createThemeRegistry({
      bundledRoot,
      localRoot,
      onWarning
    });

    await expect(registry.list()).resolves.toEqual([
      expect.objectContaining({
        manifest: expect.objectContaining({ id: "valid-theme" })
      })
    ]);
    expect(onWarning).toHaveBeenCalledWith(
      expect.stringContaining("invalid-theme")
    );
  });

  it("缓存主题目录扫描并支持主动失效", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "morphdoc-theme-"));
    const bundledRoot = join(temporaryDirectory, "bundled");
    const localRoot = join(temporaryDirectory, "local");
    const firstThemeRoot = join(localRoot, "first-theme");
    const secondThemeRoot = join(localRoot, "second-theme");
    await mkdir(bundledRoot, { recursive: true });
    await mkdir(firstThemeRoot, { recursive: true });
    await writeFile(
      join(firstThemeRoot, "theme.json"),
      JSON.stringify(localThemeManifest("first-theme")),
      "utf8"
    );
    await writeFile(
      join(firstThemeRoot, "theme.css"),
      "#write { color: #333; }",
      "utf8"
    );

    const registry = createThemeRegistry({
      bundledRoot,
      localRoot,
      cacheTtlMs: 60_000
    });
    await expect(registry.list()).resolves.toHaveLength(1);

    await mkdir(secondThemeRoot, { recursive: true });
    await writeFile(
      join(secondThemeRoot, "theme.json"),
      JSON.stringify(localThemeManifest("second-theme")),
      "utf8"
    );
    await writeFile(
      join(secondThemeRoot, "theme.css"),
      "#write { color: #666; }",
      "utf8"
    );
    await expect(registry.list()).resolves.toHaveLength(1);

    registry.invalidate();
    await expect(registry.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          manifest: expect.objectContaining({ id: "first-theme" })
        }),
        expect.objectContaining({
          manifest: expect.objectContaining({ id: "second-theme" })
        })
      ])
    );
  });

  it("拒绝主题 CSS 导入外部地址", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "morphdoc-theme-"));
    const bundledRoot = join(temporaryDirectory, "bundled");
    const localRoot = join(temporaryDirectory, "local");
    const themeDirectory = join(localRoot, "external-test");
    await mkdir(bundledRoot, { recursive: true });
    await mkdir(themeDirectory, { recursive: true });
    await writeFile(
      join(themeDirectory, "theme.json"),
      JSON.stringify(localThemeManifest("external-test")),
      "utf8"
    );
    await writeFile(
      join(themeDirectory, "theme.css"),
      '@import "https://example.com/theme.css";',
      "utf8"
    );

    const registry = createThemeRegistry({ bundledRoot, localRoot });
    await expect(registry.getCss("external-test")).rejects.toThrow(
      "主题 CSS 路径不安全"
    );
  });
});

describe("PDF API", () => {
  it("生成 PDF 并返回安全的 UTF-8 下载文件名", async () => {
    const generate = vi.fn(async () => ({
      pdf: Buffer.from("%PDF-test"),
      pageCount: 3,
      echartsErrors: ["图表 2"],
      mermaidErrors: ["图表 1"],
      timings: {
        queueMs: 0,
        browserMs: 1,
        contextMs: 2,
        navigationMs: 3,
        documentRenderMs: 4,
        runtimeSetupMs: 0.1,
        echartsMs: 0.15,
        echartsFitMs: 0.18,
        mermaidMs: 0.2,
        mermaidFitMs: 0.3,
        mermaidConversionMs: 0.35,
        resourceWaitMs: 0.4,
        paginationMs: 0.5,
        finalizeMs: 0.6,
        runtimeTotalMs: 2.1,
        pdfPrintMs: 5,
        totalMs: 15
      }
    }));
    app = buildApp({
      logger: false,
      pdfGenerator: {
        generate,
        close: vi.fn(async () => undefined)
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/pdf",
      payload: {
        markdown: "# 测试文档",
        fileName: "目录/测试文档.md",
        language: "zh-CN",
        exportConfig: defaultExportConfig
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain(
      "application/pdf"
    );
    expect(response.headers["content-disposition"]).toContain(
      "filename*=UTF-8''%E6%B5%8B%E8%AF%95%E6%96%87%E6%A1%A3.pdf"
    );
    expect(response.headers["x-pdf-page-count"]).toBe("3");
    expect(response.headers["x-echarts-error-count"]).toBe("1");
    expect(response.headers["x-mermaid-error-count"]).toBe("1");
    expect(response.headers["server-timing"]).toContain(
      "document-render;dur=4.0"
    );
    expect(response.headers["server-timing"]).toContain(
      "pdf-print;dur=5.0"
    );
    expect(response.headers["server-timing"]).toContain(
      "echarts;dur=0.1"
    );
    expect(response.headers["server-timing"]).toContain(
      "mermaid;dur=0.2"
    );
    expect(response.headers["server-timing"]).toContain(
      "mermaid-conversion;dur=0.3"
    );
    expect(response.headers["server-timing"]).toContain(
      "pagination;dur=0.5"
    );
    expect(response.rawPayload).toEqual(Buffer.from("%PDF-test"));
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        articleHtml: expect.stringContaining('id="write"'),
        themeCss: expect.stringContaining("#write"),
        exportConfig: defaultExportConfig
      })
    );
  });

  it("拒绝无效导出配置", async () => {
    app = buildApp({ logger: false });
    const response = await app.inject({
      method: "POST",
      url: "/api/pdf",
      payload: {
        markdown: "# 测试",
        exportConfig: {
          ...defaultExportConfig,
          version: 999
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("INVALID_EXPORT_CONFIG");
  });

  it("在 PDF 生成前拒绝无效 Front Matter", async () => {
    const generate = vi.fn();
    app = buildApp({
      logger: false,
      pdfGenerator: {
        generate,
        close: vi.fn(async () => undefined)
      }
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/pdf",
      payload: {
        markdown: "---\ntitle: [未闭合\n---\n",
        exportConfig: defaultExportConfig
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("INVALID_FRONT_MATTER");
    expect(generate).not.toHaveBeenCalled();
  });

  it("映射 PDF 队列已满错误", async () => {
    app = buildApp({
      logger: false,
      pdfGenerator: {
        generate: vi.fn(async () => {
          throw new PdfEngineOverloadedError();
        }),
        close: vi.fn(async () => undefined)
      }
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/pdf",
      payload: {
        markdown: "# 测试",
        exportConfig: defaultExportConfig
      }
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("5");
    expect(response.json().error).toBe("PDF_QUEUE_FULL");
  });

  it("规范化 PDF 文件名和下载响应头", () => {
    expect(createPdfFileName("../报告.markdown")).toBe("报告.pdf");
    expect(createPdfFileName("非法<>名称.md")).toBe(
      "非法__名称.pdf"
    );
    expect(createPdfFileName(undefined)).toBe("文档.pdf");
    expect(createPdfContentDisposition("报告.pdf")).toContain(
      "filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf"
    );
  });
});
