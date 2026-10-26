import { z } from "zod";
import { exportConfigSchema } from "./export-config.js";

export const DOCX_PANDOC_VERSION = "3.9.0.2";
export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const DOCX_FILE_EXTENSION = ".docx";
export const MAXIMUM_DOCX_MARKDOWN_LENGTH = 1_500_000;
export const MAXIMUM_DOCX_FILE_NAME_LENGTH = 500;
export const MAXIMUM_DOCX_RESOURCE_COUNT = 50;
export const MAXIMUM_DOCX_MEDIA_COUNT = 100;
export const DOCX_MEDIA_RASTER_DPI = 300;
export const DOCX_MEDIA_CSS_DPI = 96;
export const DOCX_MEDIA_RASTER_SCALE =
  DOCX_MEDIA_RASTER_DPI / DOCX_MEDIA_CSS_DPI;
export const MAXIMUM_DOCX_MEDIA_EDGE_PIXELS = 4_096;
export const MAXIMUM_DOCX_MEDIA_PIXELS = 16_000_000;
export const MAXIMUM_DOCX_MEDIA_BYTES = 8 * 1024 * 1024;
export const MAXIMUM_DOCX_TOTAL_MEDIA_BYTES = 30 * 1024 * 1024;
export const MAXIMUM_DOCX_OUTPUT_BYTES = 64 * 1024 * 1024;

export const documentExportFormatSchema = z.enum(["pdf", "docx"]);
export type DocumentExportFormat = z.infer<
  typeof documentExportFormatSchema
>;

export const docxSourceResourceSchema = z.object({
  path: z.string().min(1).max(1_000),
  contentType: z.string().min(1).max(100).optional(),
  data: z.string().min(1)
});

export type DocxSourceResource = z.infer<
  typeof docxSourceResourceSchema
>;

export const docxExportRequestSchema = z.object({
  markdown: z.string().max(MAXIMUM_DOCX_MARKDOWN_LENGTH),
  fileName: z
    .string()
    .max(MAXIMUM_DOCX_FILE_NAME_LENGTH)
    .default("文档.md"),
  language: z.string().max(50).default("zh-CN"),
  resources: z
    .array(docxSourceResourceSchema)
    .max(MAXIMUM_DOCX_RESOURCE_COUNT)
    .default([]),
  exportConfig: exportConfigSchema
});

export type DocxExportRequest = z.infer<
  typeof docxExportRequestSchema
>;
export type DocxExportRequestInput = z.input<
  typeof docxExportRequestSchema
>;

export const docxRuntimeStatusSchema = z.enum([
  "available",
  "not-found",
  "version-mismatch",
  "not-executable",
  "probe-timeout"
]);

export type DocxRuntimeStatus = z.infer<
  typeof docxRuntimeStatusSchema
>;

const availableDocxCapabilitySchema = z.object({
  format: z.literal("docx"),
  status: z.literal("available"),
  expectedVersion: z.literal(DOCX_PANDOC_VERSION),
  detectedVersion: z.literal(DOCX_PANDOC_VERSION)
});

const unavailableDocxCapabilitySchema = z.object({
  format: z.literal("docx"),
  status: docxRuntimeStatusSchema.exclude(["available"]),
  expectedVersion: z.literal(DOCX_PANDOC_VERSION),
  detectedVersion: z.string().max(100).optional(),
  message: z.string().max(500)
});

export const docxCapabilitySchema = z.discriminatedUnion("status", [
  availableDocxCapabilitySchema,
  unavailableDocxCapabilitySchema
]);

export type DocxCapability = z.infer<typeof docxCapabilitySchema>;

export const docxMediaKindSchema = z.enum([
  "image",
  "mermaid",
  "echarts"
]);

export type DocxMediaKind = z.infer<typeof docxMediaKindSchema>;

export const docxMediaAlignmentSchema = z.enum([
  "left",
  "center",
  "right"
]);

export type DocxMediaAlignment = z.infer<
  typeof docxMediaAlignmentSchema
>;

export const docxTableLayoutSchema = z.object({
  ordinal: z.number().int().min(1).max(256),
  widthPercent: z.number().positive().max(300),
  leftOffsetPercent: z.number().min(0).max(100),
  columnWidthPercents: z
    .array(z.number().positive().max(100))
    .min(1)
    .max(64),
  rows: z
    .array(
      z.object({
        cells: z
          .array(
            z.object({
              columnSpan: z.number().int().min(1).max(64),
              backgroundColor: z
                .string()
                .regex(/^#[0-9a-f]{6}$/iu),
              color: z.string().regex(/^#[0-9a-f]{6}$/iu),
              bold: z.boolean(),
              italic: z.boolean(),
              alignment: z.enum(["left", "center", "right", "justify"])
            })
          )
          .min(1)
          .max(64)
      })
    )
    .max(2048)
});

export type DocxTableLayout = z.infer<
  typeof docxTableLayoutSchema
>;

export const docxTextBlockLayoutSchema = z.object({
  ordinal: z.number().int().min(1).max(100_000),
  text: z.string().min(1).max(100_000),
  letterSpacingPt: z.number().min(-20).max(100),
  alertRole: z.enum(["title", "body"]).optional(),
  fontSizePt: z.number().min(1).max(200).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/iu).optional(),
  leftIndentPt: z.number().min(0).max(2_000).optional(),
  rightIndentPt: z.number().min(0).max(2_000).optional(),
  alignment: z
    .enum(["left", "center", "right", "justify", "distribute"])
    .optional(),
  linePitchPt: z.number().min(1).max(500).optional(),
  lineBreakOffsets: z
    .array(z.number().int().min(1).max(100_000))
    .max(10_000)
});

export type DocxTextBlockLayout = z.infer<
  typeof docxTextBlockLayoutSchema
>;

export const docxListItemLayoutSchema = z.object({
  ordinal: z.number().int().min(1).max(100_000),
  text: z.string().min(1).max(100_000),
  depth: z.number().int().min(0).max(64),
  textStartPt: z.number().min(0).max(2_000),
  alignment: z
    .enum(["left", "center", "right", "justify", "distribute"])
    .optional()
});

export type DocxListItemLayout = z.infer<
  typeof docxListItemLayoutSchema
>;

export const docxInlineCodeLayoutSchema = z.object({
  ordinal: z.number().int().min(1).max(100_000),
  text: z.string().min(1).max(100_000),
  fontSizePt: z.number().min(1).max(200),
  letterSpacingPt: z.number().min(-20).max(100),
  color: z.string().regex(/^#[0-9a-f]{6}$/iu),
  backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/iu).optional(),
  paddingPt: z.object({
    top: z.number().min(0).max(1_000),
    right: z.number().min(0).max(1_000),
    bottom: z.number().min(0).max(1_000),
    left: z.number().min(0).max(1_000)
  }),
  borderPt: z.object({
    top: z.number().min(0).max(20),
    right: z.number().min(0).max(20),
    bottom: z.number().min(0).max(20),
    left: z.number().min(0).max(20)
  })
});

export type DocxInlineCodeLayout = z.infer<
  typeof docxInlineCodeLayoutSchema
>;

export const docxEmojiRunLayoutSchema = z.object({
  ordinal: z.number().int().min(1).max(100_000),
  text: z.string().min(1).max(1_000),
  color: z.string().regex(/^#[0-9a-f]{6}$/iu)
});

export type DocxEmojiRunLayout = z.infer<
  typeof docxEmojiRunLayoutSchema
>;

export const docxDocumentLayoutPlanSchema = z.object({
  tables: z.array(docxTableLayoutSchema).max(256),
  textBlocks: z.array(docxTextBlockLayoutSchema).max(100_000).optional(),
  listItems: z.array(docxListItemLayoutSchema).max(100_000).optional(),
  inlineCodes: z.array(docxInlineCodeLayoutSchema).max(100_000).optional(),
  emojiRuns: z.array(docxEmojiRunLayoutSchema).max(100_000).optional()
});

export type DocxDocumentLayoutPlan = z.infer<
  typeof docxDocumentLayoutPlanSchema
>;

export const docxMediaCaptureTargetSchema = z.object({
  id: z.string().regex(/^docx-media-\d+$/u),
  kind: docxMediaKindSchema,
  ordinal: z.number().int().min(1).max(MAXIMUM_DOCX_MEDIA_COUNT),
  kindOrdinal: z
    .number()
    .int()
    .min(1)
    .max(MAXIMUM_DOCX_MEDIA_COUNT),
  altText: z.string().max(1_000),
  caption: z.string().max(1_000).optional(),
  alignment: docxMediaAlignmentSchema,
  displayWidthPx: z.number().positive().max(10_000),
  displayHeightPx: z.number().positive().max(10_000),
  captureX: z.number().int().nonnegative().max(100_000),
  captureY: z.number().int().nonnegative().max(100_000),
  captureWidthPx: z.number().int().positive().max(10_000),
  captureHeightPx: z.number().int().positive().max(10_000),
  rasterScale: z.number().positive().max(DOCX_MEDIA_RASTER_SCALE)
});

export type DocxMediaCaptureTarget = z.infer<
  typeof docxMediaCaptureTargetSchema
>;

export const docxMediaCapturePlanSchema = z.object({
  targets: z
    .array(docxMediaCaptureTargetSchema)
    .max(MAXIMUM_DOCX_MEDIA_COUNT),
  echartsErrors: z.array(z.string().max(1_000)),
  mermaidErrors: z.array(z.string().max(1_000)),
  documentLayout: docxDocumentLayoutPlanSchema.optional()
});

export type DocxMediaCapturePlan = z.infer<
  typeof docxMediaCapturePlanSchema
>;

export interface DocxPngMediaResource
  extends DocxMediaCaptureTarget {
  fileName: string;
  contentType: "image/png";
  content: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
}

export interface PreparedDocxMedia {
  resources: DocxPngMediaResource[];
  echartsErrors: string[];
  mermaidErrors: string[];
  warnings: string[];
  totalBytes: number;
  documentLayout?: DocxDocumentLayoutPlan;
}

export const docxExportErrorCodeSchema = z.enum([
  "INVALID_DOCX_REQUEST",
  "INVALID_EXPORT_CONFIG",
  "INVALID_FILE_NAME",
  "INVALID_MARKDOWN",
  "INVALID_FRONT_MATTER",
  "MARKDOWN_TOO_LARGE",
  "INVALID_IMAGE_RESOURCES",
  "IMAGE_RESOURCES_TOO_LARGE",
  "THEME_NOT_FOUND",
  "DOCX_RUNTIME_NOT_FOUND",
  "DOCX_RUNTIME_VERSION_MISMATCH",
  "DOCX_RUNTIME_NOT_EXECUTABLE",
  "DOCX_RUNTIME_PROBE_TIMEOUT",
  "DOCX_QUEUE_FULL",
  "DOCX_RENDER_TIMEOUT",
  "DOCX_GENERATION_FAILED",
  "DOCX_OUTPUT_INVALID"
]);

export type DocxExportErrorCode = z.infer<
  typeof docxExportErrorCodeSchema
>;

export const docxExportErrorResponseSchema = z.object({
  error: docxExportErrorCodeSchema,
  message: z.string().min(1).max(1_000),
  retryable: z.boolean().default(false)
});

export type DocxExportErrorResponse = z.infer<
  typeof docxExportErrorResponseSchema
>;

export interface DocxGenerationTimings {
  queueMs: number;
  probeMs: number;
  prepareMs: number;
  themeStyleMs: number;
  mediaMs: number;
  referenceMs: number;
  pandocMs: number;
  validationMs: number;
  totalMs: number;
}

export interface DocxExportDiagnostics {
  warnings: string[];
  echartsErrors: string[];
  mermaidErrors: string[];
}

export interface DocxExportResult {
  docx: Uint8Array;
  fileName: string;
  diagnostics: DocxExportDiagnostics;
  timings: DocxGenerationTimings;
}

export function createDocxFileName(fileName: unknown) {
  const source =
    typeof fileName === "string"
      ? fileName.split(/[\\/]/).at(-1) ?? ""
      : "";
  const stem = source
    .replace(/\.(?:md|markdown|docx)$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[.\s]+$/g, "")
    .trim();
  return `${stem || "文档"}${DOCX_FILE_EXTENSION}`;
}
