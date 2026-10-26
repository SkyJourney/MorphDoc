import {
  defaultExportConfig,
  resolvePageMargins,
  type ExportConfig
} from "@morphdoc/core";
import type { ThemeSummary } from "./application-backend";

function marginsEqual(
  first: ExportConfig["paper"]["margins"],
  second: ExportConfig["paper"]["margins"]
) {
  return (
    first.top === second.top &&
    first.right === second.right &&
    first.bottom === second.bottom &&
    first.left === second.left
  );
}

function applyThemePageDecorations(
  config: ExportConfig,
  theme?: ThemeSummary
): ExportConfig {
  if (config.pageDecorationsMode !== "theme") {
    return config;
  }

  const header =
    theme?.pageDefaults?.header ?? defaultExportConfig.header;
  const footer =
    theme?.pageDefaults?.footer ?? defaultExportConfig.footer;
  if (
    JSON.stringify(config.header) === JSON.stringify(header) &&
    JSON.stringify(config.footer) === JSON.stringify(footer)
  ) {
    return config;
  }

  return {
    ...config,
    header: structuredClone(header),
    footer: structuredClone(footer)
  };
}

export function applyThemeMargins(
  config: ExportConfig,
  theme?: ThemeSummary
): ExportConfig {
  if (config.paper.marginMode !== "theme") {
    return config;
  }

  const margins = resolvePageMargins(
    config.paper,
    theme?.pageDefaults?.margins
  );
  if (marginsEqual(config.paper.margins, margins)) {
    return config;
  }

  return {
    ...config,
    paper: {
      ...config.paper,
      margins
    }
  };
}

export function applyThemeDefaults(
  config: ExportConfig,
  theme?: ThemeSummary
): ExportConfig {
  return applyThemePageDecorations(
    applyThemeMargins(config, theme),
    theme
  );
}

export function selectTheme(
  config: ExportConfig,
  theme: ThemeSummary
): ExportConfig {
  return applyThemeDefaults(
    {
      ...config,
      themeId: theme.id
    },
    theme
  );
}
