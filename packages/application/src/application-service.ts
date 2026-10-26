import {
  MarkdownDocumentParseError,
  renderMarkdown,
  type RenderedMarkdown
} from "@morphdoc/renderer";
import {
  docxExportRequestSchema,
  type DocxExportRequest,
  type ThemeManifest
} from "@morphdoc/core";
import type { DocxFontSource } from "@morphdoc/docx-engine";
import {
  createThemeRegistry,
  type ThemeFontPackStatus,
  type ThemeRegistryOptions
} from "./theme-registry.js";
import {
  createImageResourceResolver,
  type ImageResolutionContext,
  type ImageResourceResolverOptions
} from "./image-resources.js";

export const MAXIMUM_MARKDOWN_LENGTH = 1_500_000;

export interface MarkdownRenderRequest {
  markdown?: unknown;
  language?: unknown;
  resources?: unknown;
}

export class ApplicationRequestError extends Error {
  constructor(
    readonly statusCode: 400 | 404 | 413,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApplicationRequestError";
  }
}

export interface ApplicationServiceOptions
  extends ThemeRegistryOptions,
    ImageResourceResolverOptions {}

export interface PreparedDocxExport {
  request: DocxExportRequest;
  document: RenderedMarkdown;
  theme: {
    manifest: ThemeManifest;
    source: "bundled" | "local";
    css: string;
    fonts: DocxFontSource[];
    fontPack?: ThemeFontPackStatus;
  };
}

export function createApplicationService(
  options: ApplicationServiceOptions
) {
  const themes = createThemeRegistry(options);
  const resolveImages = createImageResourceResolver(options);

  async function render(
    request: MarkdownRenderRequest,
    context: ImageResolutionContext = {}
  ) {
    const { markdown, language, resources } = request;
    if (typeof markdown !== "string") {
      throw new ApplicationRequestError(
        400,
        "INVALID_MARKDOWN",
        "markdown 必须是字符串"
      );
    }
    if (markdown.length > MAXIMUM_MARKDOWN_LENGTH) {
      throw new ApplicationRequestError(
        413,
        "MARKDOWN_TOO_LARGE",
        "Markdown 内容不能超过 1.5 MB"
      );
    }
    if (language !== undefined && typeof language !== "string") {
      throw new ApplicationRequestError(
        400,
        "INVALID_LANGUAGE",
        "language 必须是字符串"
      );
    }

    try {
      const images = await resolveImages(markdown, resources, context);
      return renderMarkdown(markdown, {
        ...(language ? { language } : {}),
        imageSourceMap: images.sources,
        warnings: images.warnings
      });
    } catch (error) {
      if (error instanceof MarkdownDocumentParseError) {
        throw new ApplicationRequestError(
          400,
          error.code,
          error.message
        );
      }
      if (error instanceof Error) {
        const tooLarge = /超过|大小/u.test(error.message);
        throw new ApplicationRequestError(
          tooLarge ? 413 : 400,
          tooLarge
            ? "IMAGE_RESOURCES_TOO_LARGE"
            : "INVALID_IMAGE_RESOURCES",
          error.message
        );
      }
      throw error;
    }
  }

  async function listThemes() {
    return {
      themes: (await themes.list()).map(({ manifest, source }) => ({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        category: manifest.category,
        compatibleProfiles: manifest.compatibleProfiles,
        pageDefaults: manifest.pageDefaults,
        bundled: manifest.bundled,
        source
      }))
    };
  }

  async function prepareDocxExport(
    request: unknown,
    context: ImageResolutionContext = {}
  ): Promise<PreparedDocxExport> {
    const parsed = docxExportRequestSchema.safeParse(request);
    if (!parsed.success) {
      const firstField = parsed.error.issues[0]?.path[0];
      if (firstField === "exportConfig") {
        throw new ApplicationRequestError(
          400,
          "INVALID_EXPORT_CONFIG",
          "导出配置无效"
        );
      }
      if (firstField === "fileName") {
        throw new ApplicationRequestError(
          400,
          "INVALID_FILE_NAME",
          "fileName 必须是长度不超过 500 的字符串"
        );
      }
      if (firstField === "markdown") {
        const markdownTooLarge = parsed.error.issues.some(
          (issue) =>
            issue.path[0] === "markdown" && issue.code === "too_big"
        );
        throw new ApplicationRequestError(
          markdownTooLarge ? 413 : 400,
          markdownTooLarge ? "MARKDOWN_TOO_LARGE" : "INVALID_MARKDOWN",
          markdownTooLarge
            ? "Markdown 内容不能超过 1.5 MB"
            : "markdown 必须是字符串"
        );
      }
      if (firstField === "resources") {
        throw new ApplicationRequestError(
          400,
          "INVALID_IMAGE_RESOURCES",
          "图片资源参数无效"
        );
      }
      throw new ApplicationRequestError(
        400,
        "INVALID_DOCX_REQUEST",
        "DOCX 导出请求无效"
      );
    }

    const theme = await themes.get(parsed.data.exportConfig.themeId);
    if (!theme) {
      throw new ApplicationRequestError(
        404,
        "THEME_NOT_FOUND",
        "未找到指定主题"
      );
    }

    const [document, themeCss, themeFonts, fontPack] = await Promise.all([
      render(parsed.data, context),
      themes.getCss(theme.manifest.id),
      themes.getDocxFonts(theme.manifest.id),
      themes.getFontPackStatus(theme.manifest.id)
    ]);
    if (themeCss === undefined || themeFonts === undefined) {
      throw new ApplicationRequestError(
        404,
        "THEME_NOT_FOUND",
        "未找到指定主题"
      );
    }

    return {
      request: parsed.data,
      document,
      theme: {
        manifest: theme.manifest,
        source: theme.source,
        css: themeCss,
        fonts: themeFonts,
        ...(fontPack ? { fontPack } : {})
      }
    };
  }

  return {
    getThemeAsset: themes.getAsset,
    getThemeCss: themes.getCss,
    getFontPackAsset: themes.getFontPackAsset,
    invalidateThemes: themes.invalidate,
    listThemes,
    prepareDocxExport,
    render
  };
}

export type ApplicationService = ReturnType<
  typeof createApplicationService
>;
