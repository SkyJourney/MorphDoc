import {
  docxStylePresetSchema,
  docxThemeStyleModeSchema
} from "@morphdoc/core";
import { z } from "zod";
import { docxStyleSlotNameSchema } from "./slots.js";

const colorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/iu, "颜色必须使用六位十六进制格式");

export const docxStyleValueSourceSchema = z.enum([
  "computed-css",
  "manifest-override",
  "preset-fallback",
  "engine-default"
]);

export type DocxStyleValueSource = z.infer<
  typeof docxStyleValueSourceSchema
>;

export const docxStyleConfidenceSchema = z.enum([
  "exact",
  "approximate",
  "fallback"
]);

export type DocxStyleConfidence = z.infer<
  typeof docxStyleConfidenceSchema
>;

export const docxThemeDiagnosticSeveritySchema = z.enum([
  "info",
  "warning",
  "error"
]);

export const docxThemeDiagnosticCodeSchema = z.enum([
  "slot-not-found",
  "css-value-invalid",
  "css-property-unsupported",
  "font-fallback-required",
  "layout-approximated",
  "preset-fallback-used",
  "manifest-override-applied"
]);

export const docxThemeDiagnosticSchema = z.object({
  severity: docxThemeDiagnosticSeveritySchema,
  code: docxThemeDiagnosticCodeSchema,
  message: z.string().min(1).max(500),
  slot: docxStyleSlotNameSchema.optional(),
  property: z.string().min(1).max(100).optional()
});

export type DocxThemeDiagnostic = z.infer<
  typeof docxThemeDiagnosticSchema
>;

const docxBorderTokenSchema = z.object({
  widthPt: z.number().min(0).max(20),
  color: colorSchema,
  style: z.enum([
    "none",
    "single",
    "double",
    "dotted",
    "dashed"
  ])
});

export const docxSlotStyleTokenSchema = z.object({
  fontCandidates: z.array(z.string().trim().min(1).max(100)).max(20),
  fontSizePt: z.number().min(1).max(200).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  color: colorSchema.optional(),
  backgroundColor: colorSchema.optional(),
  lineSpacing: z.number().min(0.5).max(10).optional(),
  letterSpacingPt: z.number().min(-20).max(100).optional(),
  alignment: z
    .enum(["left", "center", "right", "justify"])
    .optional(),
  firstLineIndentPt: z.number().min(-1000).max(1000).optional(),
  leftIndentPt: z.number().min(-1000).max(1000).optional(),
  rightIndentPt: z.number().min(-1000).max(1000).optional(),
  spacingBeforePt: z.number().min(0).max(2000).optional(),
  spacingAfterPt: z.number().min(0).max(2000).optional(),
  paddingPt: z
    .object({
      top: z.number().min(0).max(1000),
      right: z.number().min(0).max(1000),
      bottom: z.number().min(0).max(1000),
      left: z.number().min(0).max(1000)
    })
    .optional(),
  borders: z
    .object({
      top: docxBorderTokenSchema.optional(),
      right: docxBorderTokenSchema.optional(),
      bottom: docxBorderTokenSchema.optional(),
      left: docxBorderTokenSchema.optional()
    })
    .optional(),
  outline: docxBorderTokenSchema.optional(),
  outlineOffsetPt: z.number().min(-1000).max(1000).optional(),
  widthPercent: z.number().min(0).max(100).optional(),
  minimumWidthPercent: z.number().min(0).max(100).optional(),
  minimumHeightPt: z.number().min(0).max(10000).optional(),
  contentPaddingLeftPt: z.number().min(0).max(1000).optional(),
  verticalAlignment: z
    .enum(["top", "center", "bottom"])
    .optional(),
  childAlignment: z
    .enum(["left", "center", "right", "stretch"])
    .optional(),
  selfAlignment: z
    .enum(["left", "center", "right", "stretch"])
    .optional(),
  hidden: z.boolean().optional(),
  pageBreakBefore: z.boolean().optional(),
  pageBreakAfter: z.boolean().optional(),
  keepLines: z.boolean().optional(),
  keepWithNext: z.boolean().optional()
});

export type DocxSlotStyleToken = z.infer<
  typeof docxSlotStyleTokenSchema
>;

export const docxResolvedStyleSlotSchema = z.object({
  slot: docxStyleSlotNameSchema,
  source: docxStyleValueSourceSchema,
  confidence: docxStyleConfidenceSchema,
  style: docxSlotStyleTokenSchema
});

export type DocxResolvedStyleSlot = z.infer<
  typeof docxResolvedStyleSlotSchema
>;

export const docxThemeTokenSetSchema = z
  .object({
    schemaVersion: z.literal(1),
    themeId: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    themeFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    mode: docxThemeStyleModeSchema,
    basePreset: docxStylePresetSchema,
    slots: z.array(docxResolvedStyleSlotSchema),
    diagnostics: z.array(docxThemeDiagnosticSchema)
  })
  .superRefine((tokens, context) => {
    const names = new Set<string>();
    for (const entry of tokens.slots) {
      if (names.has(entry.slot)) {
        context.addIssue({
          code: "custom",
          message: `DOCX 样式令牌包含重复槽位：${entry.slot}`,
          path: ["slots"]
        });
      }
      names.add(entry.slot);
    }
  });

export type DocxThemeTokenSet = z.infer<
  typeof docxThemeTokenSetSchema
>;
