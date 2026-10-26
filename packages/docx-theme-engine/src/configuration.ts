import {
  docxThemeStyleOverridesSchema,
  type DocxStylePreset,
  type DocxThemeStyleMode,
  type DocxThemeStyleOverrides,
  type ThemeManifest
} from "@morphdoc/core";

export interface NormalizedDocxThemeMappingConfig {
  mode: DocxThemeStyleMode;
  basePreset: DocxStylePreset;
  overrides: DocxThemeStyleOverrides;
  legacyPreset: boolean;
}

function inferBasePreset(
  manifest: Pick<ThemeManifest, "category">
): DocxStylePreset {
  if (manifest.category === "red-letter") {
    return "official";
  }
  if (manifest.category === "formal") {
    return "formal";
  }
  if (manifest.category === "tender") {
    return "tender";
  }
  return "general";
}

function mergeSection<T extends object>(
  legacy: T | undefined,
  current: T | undefined
): T | undefined {
  if (!legacy && !current) {
    return undefined;
  }
  return {
    ...legacy,
    ...current
  } as T;
}

export function normalizeDocxThemeMappingConfig(
  manifest: ThemeManifest
): NormalizedDocxThemeMappingConfig {
  const style = manifest.docxStyle;
  const legacyPreset =
    style?.preset !== undefined &&
    style.mode === undefined &&
    style.basePreset === undefined;
  const mode =
    style?.mode ??
    (legacyPreset ? "auto-with-overrides" : "auto");
  const basePreset =
    style?.basePreset ??
    style?.preset ??
    inferBasePreset(manifest);
  const legacyOverrides = docxThemeStyleOverridesSchema.parse({
    body: style?.body,
    headings: style?.headings,
    code: style?.code,
    blockQuote: style?.blockQuote,
    table: style?.table,
    caption: style?.caption,
    hyperlink: style?.hyperlink
  });
  const overrides = docxThemeStyleOverridesSchema.parse({
    body: mergeSection(
      legacyOverrides.body,
      style?.overrides?.body
    ),
    headings: mergeSection(
      legacyOverrides.headings,
      style?.overrides?.headings
    ),
    code: mergeSection(
      legacyOverrides.code,
      style?.overrides?.code
    ),
    blockQuote: mergeSection(
      legacyOverrides.blockQuote,
      style?.overrides?.blockQuote
    ),
    table: mergeSection(
      legacyOverrides.table,
      style?.overrides?.table
    ),
    caption: mergeSection(
      legacyOverrides.caption,
      style?.overrides?.caption
    ),
    hyperlink: mergeSection(
      legacyOverrides.hyperlink,
      style?.overrides?.hyperlink
    )
  });
  return {
    mode,
    basePreset,
    overrides,
    legacyPreset
  };
}
