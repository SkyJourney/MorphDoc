import {
  exportConfigSchema,
  semanticDocumentModelSchema,
  themeFeatureSchema,
  type PagedDocumentPayload,
  type PagedDocumentRenderResult
} from "@morphdoc/core";

const MAX_ARTICLE_HTML_LENGTH = 20 * 1024 * 1024;
const MAX_THEME_CSS_LENGTH = 10 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(
  record: Record<string, unknown>,
  key: string,
  maximum: number
) {
  const value = record[key];
  if (typeof value !== "string" || value.length > maximum) {
    throw new Error(`${key} 无效`);
  }
  return value;
}

function readStringArray(value: unknown, key: string, maximum: number) {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new Error(`${key} 无效`);
  }
  return value as string[];
}

export function parsePagedDocumentPayload(
  value: unknown
): PagedDocumentPayload {
  if (!isRecord(value) || !isRecord(value.metadata)) {
    throw new Error("PDF 分页载荷无效");
  }

  const metadata = value.metadata;
  const features = readStringArray(value.features, "features", 20);
  const parsedFeatures = features.map((feature) =>
    themeFeatureSchema.parse(feature)
  );

  return {
    articleHtml: readString(
      value,
      "articleHtml",
      MAX_ARTICLE_HTML_LENGTH
    ),
    fileName: readString(value, "fileName", 500),
    metadata: {
      title: readString(metadata, "title", 500),
      author: readString(metadata, "author", 500),
      subject: readString(metadata, "subject", 1_000),
      keywords: readStringArray(
        metadata.keywords,
        "metadata.keywords",
        100
      ),
      language: readString(metadata, "language", 50)
    },
    semanticDocument: semanticDocumentModelSchema.parse(
      value.semanticDocument
    ),
    features: parsedFeatures,
    themeCss: readString(
      value,
      "themeCss",
      MAX_THEME_CSS_LENGTH
    ),
    exportConfig: exportConfigSchema.parse(value.exportConfig)
  };
}

export interface ElectronPdfPrintOptions {
  displayHeaderFooter: false;
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  pageRanges: string;
  preferCSSPageSize: true;
  printBackground: boolean;
  scale: number;
}

export function createElectronPdfPrintOptions(
  payload: PagedDocumentPayload,
  renderResult: PagedDocumentRenderResult
): ElectronPdfPrintOptions {
  return {
    displayHeaderFooter: false,
    margins: {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0
    },
    pageRanges: `1-${Math.max(renderResult.pageCount, 1)}`,
    preferCSSPageSize: true,
    printBackground: payload.exportConfig.print.background,
    scale: payload.exportConfig.print.scale
  };
}

export function isAllowedPdfRuntimeUrl(
  requestUrl: string,
  renderUrl: string
) {
  const requested = new URL(requestUrl);
  if (["about:", "blob:", "data:"].includes(requested.protocol)) {
    return true;
  }
  if (
    requested.protocol === "morphdoc:" &&
    ["theme", "font-pack"].includes(requested.host)
  ) {
    return true;
  }
  return requested.origin === new URL(renderUrl).origin;
}
