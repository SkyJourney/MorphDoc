import { createHash } from "node:crypto";
import {
  DOCX_PANDOC_VERSION,
  lengthToMillimeters
} from "@morphdoc/core";
import {
  createHeaderFooterParts
} from "./header-footer-transform.js";
import {
  readReferenceDocxPackage,
  writeReferenceDocxPackage
} from "./reference-package.js";
import {
  resolveReferencePageOptions,
  type DynamicReferenceDocxOptions
} from "./reference-options.js";
import {
  transformDocumentSectionXml,
  transformSettingsXml
} from "./section-transform.js";
import {
  transformFontTableXml,
  transformStylesXml,
  transformThemeFontsXml
} from "./styles-transform.js";
import {
  createDocxTokenSlotMap,
  resolveTokenFonts
} from "./token-style-map.js";
import { resolveDocxThemeStyle } from "./style-presets.js";
import { validateDynamicReferenceDocx } from "./validator.js";

export interface DynamicReferenceDocxResult {
  content: Uint8Array;
  baselineFingerprint: string;
  templateFingerprint: string;
  cacheKey: string;
  stylePreset: string;
  partCount: number;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${stableJson(item)}`
      )
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function createDynamicReferenceCacheKey(
  baselineFingerprint: string,
  options: DynamicReferenceDocxOptions
) {
  return createHash("sha256")
    .update(
      stableJson({
        pandocVersion: DOCX_PANDOC_VERSION,
        baselineFingerprint,
        theme: {
          id: options.theme.id,
          version: options.theme.version,
          category: options.theme.category,
          docxStyle: options.theme.docxStyle,
          pageDefaults: options.theme.pageDefaults
        },
        themeTokens: options.themeTokens,
        semanticDocument: options.semanticDocument,
        paper: options.exportConfig.paper,
        pageDecorationsMode:
          options.exportConfig.pageDecorationsMode,
        header: options.exportConfig.header,
        footer: options.exportConfig.footer,
        fileName: options.fileName,
        metadata: options.metadata
      })
    )
    .digest("hex");
}

export function createDynamicReferenceDocx(
  baseline: Uint8Array,
  options: DynamicReferenceDocxOptions
): DynamicReferenceDocxResult {
  const reference = readReferenceDocxPackage(baseline);
  const style = resolveDocxThemeStyle(options.theme);
  const tokenSlots = options.themeTokens
    ? createDocxTokenSlotMap(options.themeTokens)
    : undefined;
  const bodyFonts = resolveTokenFonts(
    tokenSlots?.get("paragraph")?.style ??
      tokenSlots?.get("document")?.style,
    style.body.fonts
  );
  const page = resolveReferencePageOptions(options);
  const withDecorations = createHeaderFooterParts(
    reference.entries,
    options,
    page.header,
    page.footer,
    bodyFonts.eastAsia,
    page.dimensions.width - page.margins.left - page.margins.right
  );
  const entries = withDecorations.entries;
  entries.set(
    "word/styles.xml",
    transformStylesXml(
      entries.get("word/styles.xml")!,
      style,
      options.themeTokens
    )
  );
  entries.set(
    "word/fontTable.xml",
    transformFontTableXml(
      entries.get("word/fontTable.xml")!,
      style,
      options.themeTokens
    )
  );
  entries.set(
    "word/theme/theme1.xml",
    transformThemeFontsXml(
      entries.get("word/theme/theme1.xml")!,
      style,
      options.themeTokens
    )
  );
  entries.set(
    "word/document.xml",
    transformDocumentSectionXml(
      entries.get("word/document.xml")!,
      {
        dimensions: page.dimensions,
        margins: page.margins,
        orientation: page.orientation,
        headerHeightMm: page.header.enabled
          ? lengthToMillimeters(page.header.height)
          : 0,
        headerFontSizeMm: page.header.enabled
          ? lengthToMillimeters(page.header.fontSize)
          : 0,
        footerHeightMm: page.footer.enabled
          ? lengthToMillimeters(page.footer.height)
          : 0,
        footerFontSizeMm: page.footer.enabled
          ? lengthToMillimeters(page.footer.fontSize)
          : 0,
        pageNumberStart: page.footer.startFrom,
        references: withDecorations.references,
        usesDifferentFirstPage:
          withDecorations.usesDifferentFirstPage
      }
    )
  );
  entries.set(
    "word/settings.xml",
    transformSettingsXml(
      entries.get("word/settings.xml")!,
      withDecorations.usesEvenAndOddPages
    )
  );
  const content = writeReferenceDocxPackage(entries);
  const validation = validateDynamicReferenceDocx(content);
  return {
    content,
    baselineFingerprint: reference.fingerprint,
    templateFingerprint: createHash("sha256")
      .update(content)
      .digest("hex"),
    cacheKey: createDynamicReferenceCacheKey(
      reference.fingerprint,
      options
    ),
    stylePreset: style.preset,
    partCount: validation.partCount
  };
}
