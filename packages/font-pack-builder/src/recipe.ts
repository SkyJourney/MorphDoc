import { z } from "zod";
import {
  FONT_PACK_MANIFEST_VERSION,
  MAXIMUM_FONT_PACK_DOCX_FONT_BYTES,
  MAXIMUM_FONT_PACK_FACE_COUNT,
  MAXIMUM_FONT_PACK_LICENSE_BYTES,
  MAXIMUM_FONT_PACK_TOTAL_BYTES,
  MAXIMUM_FONT_PACK_WEB_FONT_BYTES,
  semanticVersionSchema
} from "@morphdoc/font-pack-registry";

export const FONT_PACK_RECIPE_VERSION = 1;

const identifierSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const fontNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\p{L}\p{N}\s._-]+$/u);
const safeRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (value) =>
      !value.includes("\\") &&
      !value.includes("\0") &&
      !value.startsWith("/") &&
      !value.split("/").some((segment) => segment === ".." || segment === ""),
    "路径必须是安全的 POSIX 相对路径"
  );

const sourceAssetSchema = z
  .object({
    source: safeRelativePathSchema,
    path: safeRelativePathSchema,
    bytes: z.number().int().positive(),
    sha256: sha256Schema
  })
  .strict();

const faceSchema = z
  .object({
    id: identifierSchema,
    targets: z.array(fontNameSchema).min(1).max(32),
    weight: z.number().int().min(100).max(900).multipleOf(100),
    style: z.enum(["normal", "italic"]),
    web: sourceAssetSchema.extend({
      bytes: z.number().int().positive().max(MAXIMUM_FONT_PACK_WEB_FONT_BYTES)
    }),
    docx: sourceAssetSchema.extend({
      bytes: z.number().int().positive().max(MAXIMUM_FONT_PACK_DOCX_FONT_BYTES)
    })
  })
  .strict();

export const fontPackRecipeSchema = z
  .object({
    recipeVersion: z.literal(FONT_PACK_RECIPE_VERSION),
    manifestVersion: z.literal(FONT_PACK_MANIFEST_VERSION),
    id: identifierSchema,
    version: semanticVersionSchema,
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500),
    internalFamily: fontNameSchema,
    license: z.string().trim().min(1).max(100),
    licenseSource: safeRelativePathSchema,
    licensePath: safeRelativePathSchema,
    licenseBytes: z.number().int().positive().max(MAXIMUM_FONT_PACK_LICENSE_BYTES),
    licenseSha256: sha256Schema,
    noticeSource: safeRelativePathSchema,
    noticePath: safeRelativePathSchema,
    compatibility: z
      .object({
        minimumAppVersion: semanticVersionSchema,
        maximumAppVersionExclusive: semanticVersionSchema.optional()
      })
      .strict(),
    faces: z.array(faceSchema).min(1).max(MAXIMUM_FONT_PACK_FACE_COUNT)
  })
  .strict()
  .superRefine((recipe, context) => {
    const paths = new Set([
      recipe.licensePath.toLowerCase(),
      recipe.noticePath.toLowerCase()
    ]);
    const sourcePaths = new Set<string>();
    const ids = new Set<string>();
    for (const [index, face] of recipe.faces.entries()) {
      if (ids.has(face.id)) {
        context.addIssue({
          code: "custom",
          message: "字体面 ID 重复",
          path: ["faces", index, "id"]
        });
      }
      ids.add(face.id);
      for (const [kind, asset, extension] of [
        ["web", face.web, ".woff2"],
        ["docx", face.docx, ".ttf"]
      ] as const) {
        if (!asset.source.toLowerCase().endsWith(extension)) {
          context.addIssue({
            code: "custom",
            message: `源资源必须使用 ${extension} 扩展名`,
            path: ["faces", index, kind, "source"]
          });
        }
        if (!asset.path.toLowerCase().endsWith(extension)) {
          context.addIssue({
            code: "custom",
            message: `目标资源必须使用 ${extension} 扩展名`,
            path: ["faces", index, kind, "path"]
          });
        }
        const outputPath = asset.path.toLowerCase();
        if (paths.has(outputPath)) {
          context.addIssue({
            code: "custom",
            message: "字体包输出路径重复",
            path: ["faces", index, kind, "path"]
          });
        }
        paths.add(outputPath);
        const sourcePath = asset.source.toLowerCase();
        if (sourcePaths.has(sourcePath)) {
          context.addIssue({
            code: "custom",
            message: "字体源路径重复",
            path: ["faces", index, kind, "source"]
          });
        }
        sourcePaths.add(sourcePath);
      }
    }
    const totalBytes = recipe.faces.reduce(
      (total, face) => total + face.web.bytes + face.docx.bytes,
      0
    );
    if (totalBytes > MAXIMUM_FONT_PACK_TOTAL_BYTES) {
      context.addIssue({
        code: "custom",
        message: "字体包资源总大小超过限制",
        path: ["faces"]
      });
    }
  });

export type FontPackRecipe = z.infer<typeof fontPackRecipeSchema>;
