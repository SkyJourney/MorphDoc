import { z } from "zod";
import { documentProfileNameSchema } from "./document-profile.js";
import { docxThemeStyleSchema } from "./docx-style.js";
import {
  footerSchema,
  headerSchema,
  pageMarginsSchema
} from "./export-config.js";

export const THEME_MANIFEST_VERSION = 1;
export const MAXIMUM_DOCX_FONT_FACE_COUNT = 16;
export const MAXIMUM_DOCX_FONT_SOURCE_BYTES = 16 * 1024 * 1024;
export const MAXIMUM_DOCX_FONT_TOTAL_SOURCE_BYTES =
  48 * 1024 * 1024;

const docxFontNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(
    /^[\p{L}\p{N}\s._-]+$/u,
    "DOCX 字体名称包含不支持的字符"
  );

const docxFontSourceSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      !value.includes("\0") &&
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[a-z]:[\\/]/iu.test(value) &&
      !/^(?:https?:)?\/\//iu.test(value) &&
      !value
        .replace(/^theme-shared:/u, "")
        .split(/[\\/]/u)
        .includes(".."),
    "DOCX 字体资源路径不安全"
  )
  .refine(
    (value) => /\.(?:otf|ttf|woff2?)$/iu.test(value),
    "DOCX 字体资源格式必须为 OTF、TTF、WOFF 或 WOFF2"
  );

export const docxFontFaceSchema = z.object({
  family: docxFontNameSchema,
  aliases: z
    .array(docxFontNameSchema)
    .max(16)
    .default([]),
  source: docxFontSourceSchema,
  weight: z
    .number()
    .int()
    .min(100)
    .max(900)
    .multipleOf(100)
    .default(400),
  style: z.enum(["normal", "italic"]).default("normal"),
  license: z.string().trim().min(1).max(200)
});

export const docxFontManifestSchema = z.object({
  faces: z
    .array(docxFontFaceSchema)
    .min(1)
    .max(MAXIMUM_DOCX_FONT_FACE_COUNT)
});

export type DocxFontFace = z.infer<typeof docxFontFaceSchema>;
export type DocxFontManifest = z.infer<
  typeof docxFontManifestSchema
>;

export const themeFeatureSchema = z.enum([
  "code",
  "table",
  "task-list",
  "footnote",
  "katex",
  "mermaid",
  "echarts"
]);

export const themeCategorySchema = z.enum([
  "general",
  "red-letter",
  "formal",
  "tender"
]);

export const themeManifestSchema = z.object({
  manifestVersion: z.literal(THEME_MANIFEST_VERSION),
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1).max(100),
  version: z.string().min(1).max(30),
  description: z.string().max(500),
  author: z.string().max(100),
  license: z.string().max(100),
  base: z.string().endsWith(".css").optional(),
  entry: z.string().endsWith(".css"),
  print: z.string().endsWith(".css").optional(),
  domPreset: z.enum(["typora", "github", "generic"]),
  defaultFontSize: z.string(),
  supportedFeatures: z.array(themeFeatureSchema),
  category: themeCategorySchema.default("general"),
  compatibleProfiles: z
    .array(documentProfileNameSchema)
    .default([]),
  pageDefaults: z
    .object({
      margins: pageMarginsSchema,
      header: headerSchema.optional(),
      footer: footerSchema.optional()
    })
    .optional(),
  docxFonts: docxFontManifestSchema.optional(),
  docxStyle: docxThemeStyleSchema.optional(),
  bundled: z.boolean()
});

export type ThemeManifest = z.infer<typeof themeManifestSchema>;
export type ThemeFeature = z.infer<typeof themeFeatureSchema>;
export type ThemeCategory = z.infer<typeof themeCategorySchema>;
