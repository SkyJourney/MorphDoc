import { z } from "zod";

const colorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/iu, "DOCX 颜色必须使用六位十六进制格式");
const fontNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(
    /^[\p{L}\p{N}\s._-]+$/u,
    "DOCX 字体名称包含不支持的字符"
  );
const pointSizeSchema = z.number().min(6).max(72);
const spacingSchema = z.number().min(0).max(144);

export const docxStylePresetSchema = z.enum([
  "general",
  "technical",
  "official",
  "formal",
  "tender"
]);

export type DocxStylePreset = z.infer<
  typeof docxStylePresetSchema
>;

export const docxThemeStyleModeSchema = z.enum([
  "auto",
  "auto-with-overrides",
  "explicit"
]);

export type DocxThemeStyleMode = z.infer<
  typeof docxThemeStyleModeSchema
>;

export const docxFontFamilySchema = z.object({
  latin: fontNameSchema,
  eastAsia: fontNameSchema,
  complexScript: fontNameSchema.optional()
});

export type DocxFontFamily = z.infer<
  typeof docxFontFamilySchema
>;

export const docxBodyStyleSchema = z.object({
  fonts: docxFontFamilySchema.optional(),
  sizePt: pointSizeSchema.optional(),
  color: colorSchema.optional(),
  lineSpacing: z.number().min(1).max(3).optional(),
  firstLineIndentChars: z.number().min(0).max(10).optional(),
  spacingBeforePt: spacingSchema.optional(),
  spacingAfterPt: spacingSchema.optional()
});

export const docxHeadingStyleSchema = z.object({
  fonts: docxFontFamilySchema.optional(),
  sizesPt: z
    .tuple([
      pointSizeSchema,
      pointSizeSchema,
      pointSizeSchema,
      pointSizeSchema,
      pointSizeSchema,
      pointSizeSchema
    ])
    .optional(),
  color: colorSchema.optional(),
  bold: z.boolean().optional(),
  spacingBeforePt: spacingSchema.optional(),
  spacingAfterPt: spacingSchema.optional()
});

export const docxCodeStyleSchema = z.object({
  fonts: docxFontFamilySchema.optional(),
  sizePt: pointSizeSchema.optional(),
  color: colorSchema.optional(),
  backgroundColor: colorSchema.optional(),
  borderColor: colorSchema.optional(),
  lineSpacing: z.number().min(1).max(3).optional()
});

export const docxBlockStyleSchema = z.object({
  color: colorSchema.optional(),
  backgroundColor: colorSchema.optional(),
  borderColor: colorSchema.optional(),
  leftIndentChars: z.number().min(0).max(20).optional(),
  italic: z.boolean().optional()
});

export const docxTableStyleSchema = z.object({
  fonts: docxFontFamilySchema.optional(),
  sizePt: pointSizeSchema.optional(),
  color: colorSchema.optional(),
  headerColor: colorSchema.optional(),
  headerBackgroundColor: colorSchema.optional(),
  borderColor: colorSchema.optional(),
  cellMarginMm: z.number().min(0).max(20).optional()
});

export const docxCaptionStyleSchema = z.object({
  fonts: docxFontFamilySchema.optional(),
  sizePt: pointSizeSchema.optional(),
  color: colorSchema.optional(),
  italic: z.boolean().optional(),
  alignment: z.enum(["left", "center", "right"]).optional()
});

export const docxThemeStyleOverridesSchema = z.object({
  body: docxBodyStyleSchema.optional(),
  headings: docxHeadingStyleSchema.optional(),
  code: docxCodeStyleSchema.optional(),
  blockQuote: docxBlockStyleSchema.optional(),
  table: docxTableStyleSchema.optional(),
  caption: docxCaptionStyleSchema.optional(),
  hyperlink: z
    .object({
      color: colorSchema.optional(),
      underline: z.boolean().optional()
    })
    .optional()
});

export type DocxThemeStyleOverrides = z.infer<
  typeof docxThemeStyleOverridesSchema
>;

export const docxThemeStyleSchema =
  docxThemeStyleOverridesSchema.extend({
    mode: docxThemeStyleModeSchema.optional(),
    preset: docxStylePresetSchema.optional(),
    basePreset: docxStylePresetSchema.optional(),
    overrides: docxThemeStyleOverridesSchema.optional()
  });

export type DocxThemeStyle = z.infer<
  typeof docxThemeStyleSchema
>;
