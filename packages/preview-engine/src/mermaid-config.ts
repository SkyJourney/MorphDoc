import type { MermaidExportConfig } from "@morphdoc/core";
import type { MermaidConfig } from "mermaid";

export const MERMAID_SECURE_CONFIG_KEYS = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "maxEdges",
  "suppressErrorRendering",
  "themeCSS"
];

export function createMermaidSiteConfig(
  config: MermaidExportConfig
): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    layout: config.layout,
    theme: config.theme,
    look: config.look,
    fontFamily: config.fontFamily,
    flowchart: {
      wrappingWidth: 320
    },
    maxTextSize: 50_000,
    maxEdges: 500,
    suppressErrorRendering: true,
    secure: [...MERMAID_SECURE_CONFIG_KEYS]
  };
}
