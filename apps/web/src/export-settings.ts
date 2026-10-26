import {
  defaultExportConfig,
  exportConfigSchema,
  type ExportConfig
} from "@morphdoc/core";

export const EXPORT_CONFIG_STORAGE_KEY = "morphdoc.export-config.v4";
export const LEGACY_EXPORT_CONFIG_V3_STORAGE_KEY =
  "morphdoc.export-config.v3";
export const LEGACY_EXPORT_CONFIG_V2_STORAGE_KEY =
  "morphdoc.export-config.v2";

type SettingsStorage = Pick<Storage, "getItem" | "setItem">;

function cloneDefaultExportConfig() {
  return structuredClone(defaultExportConfig);
}

function pickLegacyPageDecorations(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const source = value as Record<string, unknown>;
  if ("left" in source) {
    return {
      enabled: source.enabled,
      height: source.height,
      showDivider: source.showDivider,
      fontSize: source.fontSize,
      color: source.color,
      left: source.left,
      center: source.center,
      right: source.right
    };
  }
  return {
    enabled: source.enabled,
    height: source.height,
    showDivider: source.showDivider,
    fontSize: source.fontSize,
    color: source.color,
    alignment: source.alignment,
    format: source.format,
    template: source.template,
    startFrom: source.startFrom
  };
}

function usesLegacyPageDecorationDefaults(
  header: unknown,
  footer: unknown
) {
  return (
    JSON.stringify(pickLegacyPageDecorations(header)) ===
      JSON.stringify(
        pickLegacyPageDecorations(defaultExportConfig.header)
      ) &&
    JSON.stringify(pickLegacyPageDecorations(footer)) ===
      JSON.stringify(
        pickLegacyPageDecorations(defaultExportConfig.footer)
      )
  );
}

function migrateStoredExportConfig(value: unknown): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    !("paper" in value)
  ) {
    return value;
  }

  if (
    value.version !== 2 &&
    value.version !== 3 &&
    value.version !== defaultExportConfig.version
  ) {
    return value;
  }

  const source = value as Record<string, unknown>;
  const hasPageDecorationsMode =
    typeof source.pageDecorationsMode === "string";

  const paper =
    typeof value.paper === "object" && value.paper !== null
      ? value.paper
      : {};
  const margins =
    "margins" in paper &&
    typeof paper.margins === "object" &&
    paper.margins !== null
      ? paper.margins
      : {};
  const usesLegacyDefaults =
    JSON.stringify(margins) ===
    JSON.stringify(defaultExportConfig.paper.margins);
  const hasMarginMode =
    typeof (paper as Record<string, unknown>).marginMode === "string";

  return {
    ...value,
    ...(value.version === 2 || value.version === 3
      ? { version: defaultExportConfig.version }
      : {}),
    ...(value.version === 2
      ? { mermaid: structuredClone(defaultExportConfig.mermaid) }
      : {}),
    ...(!hasPageDecorationsMode
      ? {
          pageDecorationsMode: usesLegacyPageDecorationDefaults(
            source.header,
            source.footer
          )
            ? "theme"
            : "custom"
        }
      : {}),
    paper: {
      ...paper,
      ...(!hasMarginMode
        ? {
            marginMode: usesLegacyDefaults ? "theme" : "custom"
          }
        : {})
    }
  };
}

export function parseStoredExportConfig(rawValue: string | null): ExportConfig {
  if (!rawValue) {
    return cloneDefaultExportConfig();
  }

  try {
    const value: unknown = JSON.parse(rawValue);
    const migratedValue = migrateStoredExportConfig(value);
    const parsed = exportConfigSchema.safeParse(migratedValue);
    return parsed.success ? parsed.data : cloneDefaultExportConfig();
  } catch {
    return cloneDefaultExportConfig();
  }
}

export function loadExportConfig(
  storage: SettingsStorage = window.localStorage
) {
  const currentValue = storage.getItem(EXPORT_CONFIG_STORAGE_KEY);
  if (currentValue) {
    return parseStoredExportConfig(currentValue);
  }

  const legacyValue =
    storage.getItem(LEGACY_EXPORT_CONFIG_V3_STORAGE_KEY) ??
    storage.getItem(LEGACY_EXPORT_CONFIG_V2_STORAGE_KEY);
  const config = parseStoredExportConfig(legacyValue);
  if (legacyValue) {
    storage.setItem(EXPORT_CONFIG_STORAGE_KEY, JSON.stringify(config));
  }
  return config;
}

export function saveExportConfig(
  config: ExportConfig,
  storage: SettingsStorage = window.localStorage
) {
  const parsed = exportConfigSchema.parse(config);
  storage.setItem(EXPORT_CONFIG_STORAGE_KEY, JSON.stringify(parsed));
}

export function resetExportConfig() {
  return cloneDefaultExportConfig();
}
