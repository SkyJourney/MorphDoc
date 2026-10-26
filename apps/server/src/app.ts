import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import Fastify from "fastify";
import {
  EXPORT_CONFIG_VERSION,
  DOCX_MIME_TYPE,
  createPagedDocumentPayload,
  defaultExportConfig,
  exportConfigSchema,
  supportedPaperFormats
} from "@morphdoc/core";
import {
  ApplicationRequestError,
  DocxExportService,
  DocxExportServiceError,
  DocxThemeTokenService,
  createApplicationService,
  readDocxExportRuntimeLimits,
  type ApplicationService,
  type ApplicationServiceOptions
} from "@morphdoc/application";
import {
  PandocDocxConverter,
  PandocRuntime
} from "@morphdoc/docx-engine";
import { RENDERER_VERSION } from "@morphdoc/renderer";
import {
  createDocxMediaEngine,
  type ServerDocxMediaCaptureAdapter
} from "./docx-media-engine.js";
import {
  createPdfGenerator,
  PdfEngineClosedError,
  PdfEngineOverloadedError,
  PdfRenderTimeoutError,
  type PdfGenerator
} from "./pdf-engine.js";

interface RenderRequestBody {
  markdown?: unknown;
  language?: unknown;
  resources?: unknown;
}

interface PdfRequestBody extends RenderRequestBody {
  fileName?: unknown;
  exportConfig?: unknown;
}

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
function encodeRfc5987(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

export function createPdfFileName(fileName: unknown) {
  const source =
    typeof fileName === "string"
      ? fileName.split(/[\\/]/).at(-1) ?? ""
      : "";
  const stem = source
    .replace(/\.(?:md|markdown)$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[.\s]+$/g, "")
    .trim();
  return `${stem || "文档"}.pdf`;
}

export function createPdfContentDisposition(fileName: string) {
  return (
    `attachment; filename="document.pdf"; ` +
    `filename*=UTF-8''${encodeRfc5987(fileName)}`
  );
}

export interface BuildAppOptions {
  localThemeRoot?: string;
  logger?: boolean;
  pdfGenerator?: PdfGenerator;
  prewarmPdfBrowser?: boolean;
  prewarmDocxRuntime?: boolean;
  applicationService?: ApplicationService;
  docxExportService?: Pick<
    DocxExportService,
    "getCapability" | "generate" | "close"
  >;
  docxMediaAdapter?: ServerDocxMediaCaptureAdapter;
  fontPacks?: NonNullable<ApplicationServiceOptions["fontPacks"]>;
}

function milliseconds(value: number) {
  return Math.max(0, value).toFixed(1);
}

function createPdfServerTiming(
  themeMs: number,
  markdownMs: number,
  generated: Awaited<ReturnType<PdfGenerator["generate"]>>,
  requestMs: number
) {
  const { timings } = generated;
  return [
    `theme;dur=${milliseconds(themeMs)}`,
    `markdown;dur=${milliseconds(markdownMs)}`,
    `queue;dur=${milliseconds(timings.queueMs)}`,
    `browser;dur=${milliseconds(timings.browserMs)}`,
    `context;dur=${milliseconds(timings.contextMs)}`,
    `navigation;dur=${milliseconds(timings.navigationMs)}`,
    `document-render;dur=${milliseconds(timings.documentRenderMs)}`,
    `runtime-setup;dur=${milliseconds(timings.runtimeSetupMs)}`,
    `echarts;dur=${milliseconds(timings.echartsMs)}`,
    `echarts-fit;dur=${milliseconds(timings.echartsFitMs)}`,
    `mermaid;dur=${milliseconds(timings.mermaidMs)}`,
    `mermaid-fit;dur=${milliseconds(timings.mermaidFitMs)}`,
    `mermaid-conversion;dur=${milliseconds(
      timings.mermaidConversionMs
    )}`,
    `resources;dur=${milliseconds(timings.resourceWaitMs)}`,
    `pagination;dur=${milliseconds(timings.paginationMs)}`,
    `pagination-finalize;dur=${milliseconds(timings.finalizeMs)}`,
    `pdf-print;dur=${milliseconds(timings.pdfPrintMs)}`,
    `total;dur=${milliseconds(requestMs)}`
  ].join(", ");
}

function createDocxServerTiming(
  timings: Awaited<
    ReturnType<DocxExportService["generate"]>
  >["timings"]
) {
  return [
    `queue;dur=${milliseconds(timings.queueMs)}`,
    `runtime-probe;dur=${milliseconds(timings.probeMs)}`,
    `prepare;dur=${milliseconds(timings.prepareMs)}`,
    `theme-style;dur=${milliseconds(timings.themeStyleMs)}`,
    `media;dur=${milliseconds(timings.mediaMs)}`,
    `reference;dur=${milliseconds(timings.referenceMs)}`,
    `pandoc;dur=${milliseconds(timings.pandocMs)}`,
    `validation;dur=${milliseconds(timings.validationMs)}`,
    `total;dur=${milliseconds(timings.totalMs)}`
  ].join(", ");
}

export function createDocxContentDisposition(fileName: string) {
  return (
    `attachment; filename="document.docx"; ` +
    `filename*=UTF-8''${encodeRfc5987(fileName)}`
  );
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 24 * 1024 * 1024
  });
  const applicationService =
    options.applicationService ??
    createApplicationService({
      bundledRoot: resolve(projectRoot, "themes"),
      localRoot:
        options.localThemeRoot ?? resolve(projectRoot, ".local", "themes"),
      onWarning: (message) => app.log.warn(message),
      ...(options.fontPacks ? { fontPacks: options.fontPacks } : {})
    });
  const pdfGenerator =
    options.pdfGenerator ?? createPdfGenerator();
  const pandocRuntime = options.docxExportService
    ? undefined
    : new PandocRuntime();
  const docxMediaAdapter =
    options.docxMediaAdapter ?? createDocxMediaEngine();
  const docxExportService =
    options.docxExportService ??
    new DocxExportService({
      application: applicationService,
      runtime: pandocRuntime!,
      converter: new PandocDocxConverter({
        runtime: pandocRuntime!
      }),
      themeTokens: new DocxThemeTokenService(
        docxMediaAdapter
      ),
      limits: readDocxExportRuntimeLimits()
    });

  if (options.prewarmPdfBrowser) {
    app.addHook("onReady", async () => {
      try {
        await pdfGenerator.warmup?.();
      } catch (error) {
        app.log.warn({ error }, "PDF browser warmup failed");
      }
    });
  }

  if (options.prewarmDocxRuntime) {
    app.addHook("onReady", async () => {
      try {
        const capability =
          await docxExportService.getCapability();
        if (capability.status !== "available") {
          app.log.warn(
            { capability },
            "DOCX runtime unavailable"
          );
        }
      } catch (error) {
        app.log.warn({ error }, "DOCX runtime probe failed");
      }
    });
  }

  app.addHook("onClose", async () => {
    await pdfGenerator.close();
    await docxExportService.close();
    await docxMediaAdapter.close();
  });

  app.get("/api/health", async () => ({
    status: "ok",
    service: "morphdoc",
    configVersion: EXPORT_CONFIG_VERSION,
    rendererVersion: RENDERER_VERSION
  }));

  app.get("/api/capabilities", async () => {
    const docx = await docxExportService.getCapability();
    return {
      defaultExportConfig,
      supportedPaperFormats,
      docx,
      implemented: [
        "project-skeleton",
        "export-config",
        "theme-manifest",
        "markdown-render",
        "html-preview",
        "pdf-export",
        "docx-export"
      ],
      planned: []
    };
  });

  app.get("/api/docx/capability", async () =>
    docxExportService.getCapability()
  );

  app.get("/api/themes", async () =>
    applicationService.listThemes()
  );

  app.get<{ Params: { themeId: string } }>(
    "/api/themes/:themeId/css",
    async (request, reply) => {
      const { themeId } = request.params;

      const css = await applicationService.getThemeCss(themeId);
      if (css === undefined) {
        return reply.code(404).send({
          error: "THEME_NOT_FOUND",
          message: "未找到指定主题"
        });
      }

      return reply
        .header("content-type", "text/css; charset=utf-8")
        .header("cache-control", "public, max-age=300")
        .send(css);
    }
  );

  app.get<{ Params: { themeId: string; "*": string } }>(
    "/api/themes/:themeId/assets/*",
    async (request, reply) => {
      try {
        const asset = await applicationService.getThemeAsset(
          request.params.themeId,
          request.params["*"]
        );
        if (!asset) {
          return reply.code(404).send({
            error: "THEME_NOT_FOUND",
            message: "未找到指定主题"
          });
        }

        return reply
          .header("content-type", asset.contentType)
          .header("cache-control", "public, max-age=300")
          .header("content-security-policy", "default-src 'none'; sandbox")
          .header("x-content-type-options", "nosniff")
          .send(asset.content);
      } catch {
        return reply.code(404).send({
          error: "THEME_ASSET_NOT_FOUND",
          message: "未找到指定主题资源"
        });
      }
    }
  );

  app.get<{
    Params: {
      packId: string;
      packVersion: string;
      faceId: string;
    };
  }>(
    "/api/font-packs/:packId/:packVersion/:faceId/web",
    async (request, reply) => {
      try {
        const asset = await applicationService.getFontPackAsset(
          request.params.packId,
          request.params.packVersion,
          request.params.faceId,
          "web"
        );
        if (!asset) {
          return reply.code(404).send({
            error: "FONT_PACK_ASSET_NOT_FOUND",
            message: "未找到指定字体包资源"
          });
        }
        return reply
          .header("content-type", asset.contentType)
          .header("cache-control", "public, max-age=31536000, immutable")
          .header("content-security-policy", "default-src 'none'; sandbox")
          .header("x-content-type-options", "nosniff")
          .header("etag", `\"${asset.sha256}\"`)
          .send(asset.content);
      } catch {
        return reply.code(404).send({
          error: "FONT_PACK_ASSET_NOT_FOUND",
          message: "未找到指定字体包资源"
        });
      }
    }
  );

  app.post<{ Body: RenderRequestBody }>(
    "/api/render",
    async (request, reply) => {
      try {
        return await applicationService.render(request.body ?? {});
      } catch (error) {
        if (error instanceof ApplicationRequestError) {
          return reply.code(error.statusCode).send({
            error: error.code,
            message: error.message
          });
        }
        throw error;
      }
    }
  );

  app.post<{ Body: PdfRequestBody }>(
    "/api/pdf",
    async (request, reply) => {
      const requestStartedAt = performance.now();
      const parsedConfig = exportConfigSchema.safeParse(
        request.body?.exportConfig
      );
      if (!parsedConfig.success) {
        return reply.code(400).send({
          error: "INVALID_EXPORT_CONFIG",
          message: "导出配置无效",
          issues: parsedConfig.error.issues
        });
      }
      if (
        request.body?.fileName !== undefined &&
        (typeof request.body.fileName !== "string" ||
          request.body.fileName.length > 500)
      ) {
        return reply.code(400).send({
          error: "INVALID_FILE_NAME",
          message: "fileName 必须是长度不超过 500 的字符串"
        });
      }

      const themeStartedAt = performance.now();
      const themeCss = await applicationService.getThemeCss(
        parsedConfig.data.themeId
      );
      const themeMs = performance.now() - themeStartedAt;
      if (themeCss === undefined) {
        return reply.code(404).send({
          error: "THEME_NOT_FOUND",
          message: "未找到指定主题"
        });
      }

      const markdownStartedAt = performance.now();
      let rendered;
      try {
        rendered = await applicationService.render(request.body ?? {});
      } catch (error) {
        if (error instanceof ApplicationRequestError) {
          return reply.code(error.statusCode).send({
            error: error.code,
            message: error.message
          });
        }
        throw error;
      }
      const markdownMs = performance.now() - markdownStartedAt;

      try {
        const generated = await pdfGenerator.generate(
          createPagedDocumentPayload({
            document: rendered,
            fileName:
              typeof request.body.fileName === "string"
                ? request.body.fileName
                : "文档.md",
            themeCss,
            exportConfig: parsedConfig.data
          })
        );
        const pdfFileName = createPdfFileName(request.body.fileName);
        const requestMs = performance.now() - requestStartedAt;
        const serverTiming = createPdfServerTiming(
          themeMs,
          markdownMs,
          generated,
          requestMs
        );

        request.log.info(
          {
            pageCount: generated.pageCount,
            timings: {
              themeMs,
              markdownMs,
              ...generated.timings,
              requestMs
            }
          },
          "PDF generated"
        );

        return reply
          .header("content-type", "application/pdf")
          .header(
            "content-disposition",
            createPdfContentDisposition(pdfFileName)
          )
          .header("cache-control", "no-store")
          .header("server-timing", serverTiming)
          .header("x-pdf-page-count", String(generated.pageCount))
          .header(
            "x-echarts-error-count",
            String(generated.echartsErrors.length)
          )
          .header(
            "x-mermaid-error-count",
            String(generated.mermaidErrors.length)
          )
          .send(generated.pdf);
      } catch (error) {
        if (error instanceof PdfEngineOverloadedError) {
          return reply
            .code(503)
            .header("retry-after", "5")
            .send({
              error: "PDF_QUEUE_FULL",
              message: error.message
            });
        }
        if (error instanceof PdfRenderTimeoutError) {
          return reply.code(504).send({
            error: "PDF_RENDER_TIMEOUT",
            message: "PDF 生成超时，请缩短文档或稍后重试"
          });
        }
        if (error instanceof PdfEngineClosedError) {
          return reply.code(503).send({
            error: "PDF_ENGINE_UNAVAILABLE",
            message: "PDF 生成服务暂不可用"
          });
        }

        request.log.error(
          {
            error,
            errorMessage:
              error instanceof Error ? error.message : String(error),
            errorStack:
              error instanceof Error ? error.stack : undefined
          },
          "PDF generation failed"
        );
        return reply.code(500).send({
          error: "PDF_GENERATION_FAILED",
          message: "PDF 生成失败"
        });
      }
    }
  );

  app.post<{ Body: unknown }>("/api/docx", async (request, reply) => {
    const abortController = new AbortController();
    const abortRequest = () =>
      abortController.abort(new Error("HTTP 请求已中断"));
    request.raw.once("aborted", abortRequest);

    try {
      const generated = await docxExportService.generate(
        request.body ?? {},
        {
          mediaAdapter: docxMediaAdapter,
          signal: abortController.signal
        }
      );
      request.log.info(
        {
          fileName: generated.fileName,
          bytes: generated.docx.byteLength,
          diagnostics: generated.diagnostics,
          timings: generated.timings
        },
        "DOCX generated"
      );
      return reply
        .header("content-type", DOCX_MIME_TYPE)
        .header(
          "content-disposition",
          createDocxContentDisposition(generated.fileName)
        )
        .header("cache-control", "no-store")
        .header(
          "server-timing",
          createDocxServerTiming(generated.timings)
        )
        .header(
          "x-docx-warning-count",
          String(generated.diagnostics.warnings.length)
        )
        .header(
          "x-echarts-error-count",
          String(generated.diagnostics.echartsErrors.length)
        )
        .header(
          "x-mermaid-error-count",
          String(generated.diagnostics.mermaidErrors.length)
        )
        .send(
          Buffer.from(
            generated.docx.buffer,
            generated.docx.byteOffset,
            generated.docx.byteLength
          )
        );
    } catch (error) {
      if (error instanceof ApplicationRequestError) {
        return reply.code(error.statusCode).send({
          error: error.code,
          message: error.message,
          retryable: false
        });
      }
      if (error instanceof DocxExportServiceError) {
        if (error.statusCode >= 500) {
          request.log.error(
            {
              error,
              cause: error.cause,
              causeMessage:
                error.cause instanceof Error
                  ? error.cause.message
                  : undefined,
              causeStack:
                error.cause instanceof Error
                  ? error.cause.stack
                  : undefined,
              causeDiagnostics:
                error.cause instanceof Error &&
                "diagnostics" in error.cause
                  ? error.cause.diagnostics
                  : undefined
            },
            "DOCX generation service failed"
          );
        }
        if (error.retryable) {
          reply.header("retry-after", "5");
        }
        return reply.code(error.statusCode).send({
          error: error.code,
          message: error.message,
          retryable: error.retryable
        });
      }
      request.log.error({ error }, "DOCX generation failed");
      return reply.code(500).send({
        error: "DOCX_GENERATION_FAILED",
        message: "DOCX 生成失败",
        retryable: false
      });
    } finally {
      request.raw.removeListener("aborted", abortRequest);
    }
  });

  return app;
}
