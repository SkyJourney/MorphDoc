import {
  defaultExportConfig,
  getPaperDimensionsMm,
  lengthToMillimeters,
  resolvePageMargins,
  type ExportConfig,
  type MarkdownDocumentMetadata,
  type SemanticDocumentModel,
  type ThemeManifest
} from "@morphdoc/core";
import type { DocxThemeTokenSet } from "@morphdoc/docx-theme-engine";

export interface DynamicReferenceDocxOptions {
  exportConfig: ExportConfig;
  theme: ThemeManifest;
  fileName: string;
  metadata: Pick<MarkdownDocumentMetadata, "title" | "author">;
  themeTokens?: DocxThemeTokenSet;
  semanticDocument?: SemanticDocumentModel;
}

export function resolveReferencePageOptions(
  options: DynamicReferenceDocxOptions
) {
  const { exportConfig, theme } = options;
  const themeDefaults = theme.pageDefaults;
  const dimensions = getPaperDimensionsMm(
    exportConfig.paper.format,
    exportConfig.paper.orientation
  );
  const margins = resolvePageMargins(
    exportConfig.paper,
    themeDefaults?.margins
  );
  const useThemeDecorations =
    exportConfig.pageDecorationsMode === "theme";
  return {
    dimensions,
    margins: {
      top: lengthToMillimeters(margins.top),
      right: lengthToMillimeters(margins.right),
      bottom: lengthToMillimeters(margins.bottom),
      left: lengthToMillimeters(margins.left)
    },
    orientation: exportConfig.paper.orientation,
    header: useThemeDecorations
      ? themeDefaults?.header ?? defaultExportConfig.header
      : exportConfig.header,
    footer: useThemeDecorations
      ? themeDefaults?.footer ?? defaultExportConfig.footer
      : exportConfig.footer
  };
}

export function resolveHeaderTemplate(
  value: string,
  options: DynamicReferenceDocxOptions
) {
  const replacements: Record<string, string> = {
    title: options.metadata.title,
    author: options.metadata.author,
    filename: options.fileName
  };
  return value.replace(
    /\$\{(title|author|filename)\}/gu,
    (_match, name: string) => replacements[name] ?? ""
  );
}
