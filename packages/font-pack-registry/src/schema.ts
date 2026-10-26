import { z } from "zod";

export const FONT_PACK_MANIFEST_VERSION = 1;
export const MAXIMUM_FONT_PACK_COUNT = 8;
export const MAXIMUM_FONT_PACK_FACE_COUNT = 16;
export const MAXIMUM_FONT_PACK_MANIFEST_BYTES = 128 * 1024;
export const MAXIMUM_FONT_PACK_LICENSE_BYTES = 256 * 1024;
export const MAXIMUM_FONT_PACK_WEB_FONT_BYTES = 8 * 1024 * 1024;
export const MAXIMUM_FONT_PACK_DOCX_FONT_BYTES = 16 * 1024 * 1024;
export const MAXIMUM_FONT_PACK_TOTAL_BYTES = 96 * 1024 * 1024;

const semanticVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const identifierPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const fontNamePattern = /^[\p{L}\p{N}\s._-]+$/u;

export const semanticVersionSchema = z
  .string()
  .max(100)
  .regex(semanticVersionPattern, "版本号必须是完整 SemVer")
  .refine(
    (value) => {
      const prerelease = semanticVersionPattern.exec(value)?.[4];
      return !prerelease
        ? true
        : prerelease
            .split(".")
            .every((part) => !/^\d+$/u.test(part) || part === "0" || !part.startsWith("0"));
    },
    "SemVer 预发布数字标识不能包含前导零"
  );

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
    "资源必须使用安全的 POSIX 相对路径"
  );

const fontAssetSchema = z
  .object({
    path: safeRelativePathSchema,
    sha256: z.string().regex(sha256Pattern),
    bytes: z.number().int().positive()
  })
  .strict();

const webFontAssetSchema = fontAssetSchema
  .extend({
    format: z.literal("woff2"),
    bytes: z.number().int().positive().max(MAXIMUM_FONT_PACK_WEB_FONT_BYTES)
  })
  .strict()
  .refine((asset) => asset.path.toLowerCase().endsWith(".woff2"), {
    message: "Web 字体资源必须使用 .woff2 扩展名",
    path: ["path"]
  });

const docxFontAssetSchema = fontAssetSchema
  .extend({
    format: z.literal("truetype"),
    bytes: z.number().int().positive().max(MAXIMUM_FONT_PACK_DOCX_FONT_BYTES)
  })
  .strict()
  .refine((asset) => asset.path.toLowerCase().endsWith(".ttf"), {
    message: "DOCX 字体资源必须使用静态 .ttf 文件",
    path: ["path"]
  });

const fontFamilySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(fontNamePattern, "字体家族名称包含不支持的字符");

export const fontPackFaceSchema = z
  .object({
    id: z.string().regex(identifierPattern),
    targets: z.array(fontFamilySchema).min(1).max(32),
    weight: z.number().int().min(100).max(900).multipleOf(100),
    style: z.enum(["normal", "italic"]),
    web: webFontAssetSchema,
    docx: docxFontAssetSchema
  })
  .strict();

export const fontPackManifestSchema = z
  .object({
    manifestVersion: z.literal(FONT_PACK_MANIFEST_VERSION),
    id: z.string().regex(identifierPattern),
    version: semanticVersionSchema,
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500),
    license: z.string().trim().min(1).max(100),
    licenseFile: safeRelativePathSchema,
    licenseSha256: z.string().regex(sha256Pattern),
    licenseBytes: z
      .number()
      .int()
      .positive()
      .max(MAXIMUM_FONT_PACK_LICENSE_BYTES),
    compatibility: z
      .object({
        minimumAppVersion: semanticVersionSchema,
        maximumAppVersionExclusive: semanticVersionSchema.optional()
      })
      .strict(),
    faces: z.array(fontPackFaceSchema).min(1).max(MAXIMUM_FONT_PACK_FACE_COUNT)
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      manifest.compatibility.maximumAppVersionExclusive !== undefined &&
      compareSemanticVersions(
        manifest.compatibility.maximumAppVersionExclusive,
        manifest.compatibility.minimumAppVersion
      ) <= 0
    ) {
      context.addIssue({
        code: "custom",
        message: "应用兼容上限必须大于最低版本",
        path: ["compatibility", "maximumAppVersionExclusive"]
      });
    }
    const ids = new Set<string>();
    const identities = new Set<string>();
    const paths = new Set<string>([manifest.licenseFile.toLowerCase()]);
    for (const [index, face] of manifest.faces.entries()) {
      if (
        new Set(face.targets.map((target) => target.toLowerCase())).size !==
        face.targets.length
      ) {
        context.addIssue({
          code: "custom",
          message: "字体面目标家族不能重复",
          path: ["faces", index, "targets"]
        });
      }
      if (ids.has(face.id)) {
        context.addIssue({
          code: "custom",
          message: `字体面 ID 重复：${face.id}`,
          path: ["faces", index, "id"]
        });
      }
      ids.add(face.id);
      const identity = `${face.targets.map((target) => target.toLowerCase()).sort().join("|")}:${face.weight}:${face.style}`;
      if (identities.has(identity)) {
        context.addIssue({
          code: "custom",
          message: "字体面目标、字重和样式重复",
          path: ["faces", index]
        });
      }
      identities.add(identity);
      for (const [kind, path] of [
        ["web", face.web.path],
        ["docx", face.docx.path]
      ] as const) {
        const normalized = path.toLowerCase();
        if (paths.has(normalized)) {
          context.addIssue({
            code: "custom",
            message: `字体包资源路径重复：${path}`,
            path: ["faces", index, kind, "path"]
          });
        }
        paths.add(normalized);
      }
    }
    const totalBytes = manifest.faces.reduce(
      (total, face) => total + face.web.bytes + face.docx.bytes,
      0
    );
    if (totalBytes > MAXIMUM_FONT_PACK_TOTAL_BYTES) {
      context.addIssue({
        code: "custom",
        message: "字体包声明资源总大小超过限制",
        path: ["faces"]
      });
    }
  });

export type FontPackManifest = z.infer<typeof fontPackManifestSchema>;
export type FontPackFace = z.infer<typeof fontPackFaceSchema>;
export type FontPackAsset = FontPackFace["web"] | FontPackFace["docx"];

export function parseSemanticVersion(value: string) {
  const match = semanticVersionPattern.exec(value);
  if (!match) {
    throw new Error(`无效的 SemVer：${value}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? []
  };
}

function comparePrerelease(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length ? 0 : left.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) {
      continue;
    }
    const leftNumber = /^\d+$/u.test(leftPart) ? Number(leftPart) : undefined;
    const rightNumber = /^\d+$/u.test(rightPart) ? Number(rightPart) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined) {
      return leftNumber < rightNumber ? -1 : 1;
    }
    if (leftNumber !== undefined || rightNumber !== undefined) {
      return leftNumber !== undefined ? -1 : 1;
    }
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function compareSemanticVersions(left: string, right: string) {
  const a = parseSemanticVersion(left);
  const b = parseSemanticVersion(right);
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) {
      return a[key] < b[key] ? -1 : 1;
    }
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

export function isAppVersionCompatible(
  appVersion: string,
  compatibility: FontPackManifest["compatibility"]
) {
  return (
    compareSemanticVersions(appVersion, compatibility.minimumAppVersion) >= 0 &&
    (compatibility.maximumAppVersionExclusive === undefined ||
      compareSemanticVersions(
        appVersion,
        compatibility.maximumAppVersionExclusive
      ) < 0)
  );
}
