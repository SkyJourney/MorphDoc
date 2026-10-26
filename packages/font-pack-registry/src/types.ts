import type { FontPackAsset, FontPackFace, FontPackManifest } from "./schema.js";

export type FontPackDiagnosticSeverity = "info" | "warning" | "error";

export type FontPackDiagnosticCode =
  | "ROOT_NOT_FOUND"
  | "ROOT_INVALID"
  | "PACK_LIMIT_EXCEEDED"
  | "PACK_LAYOUT_INVALID"
  | "MANIFEST_INVALID"
  | "PACK_INCOMPATIBLE"
  | "PACK_SHADOWED"
  | "RESOURCE_INVALID"
  | "FONT_FACE_NOT_PROVIDED";

export interface FontPackDiagnostic {
  code: FontPackDiagnosticCode;
  severity: FontPackDiagnosticSeverity;
  message: string;
  root?: string;
  packId?: string;
  packVersion?: string;
  faceId?: string;
}

export type InstalledFontPackAsset = FontPackAsset & {
  absolutePath: string;
  packDirectory: string;
};

export interface InstalledFontPackFace
  extends Omit<FontPackFace, "web" | "docx"> {
  web: InstalledFontPackAsset & { format: "woff2" };
  docx: InstalledFontPackAsset & { format: "truetype" };
}

export interface InstalledFontPack
  extends Omit<FontPackManifest, "faces"> {
  root: string;
  directory: string;
  rootIndex: number;
  fingerprint: string;
  faces: InstalledFontPackFace[];
}

export interface FontPackRegistryResult {
  packs: InstalledFontPack[];
  diagnostics: FontPackDiagnostic[];
  fingerprint: string;
}

export interface FontPackFaceRequest {
  family: string;
  aliases?: readonly string[];
  weight: number;
  style: "normal" | "italic";
}

export interface ResolvedFontPackFace {
  request: FontPackFaceRequest;
  pack: InstalledFontPack;
  face: InstalledFontPackFace;
  matchedFamily: string;
}

export interface FontPackFaceResolution {
  resolved: ResolvedFontPackFace[];
  unmatched: FontPackFaceRequest[];
  diagnostics: FontPackDiagnostic[];
}

export interface DiscoverFontPacksOptions {
  roots: readonly string[];
  appVersion: string;
}

export interface ResolveFontPackFacesOptions {
  preferredPackIds?: readonly string[];
  reportMissing?: boolean;
}
