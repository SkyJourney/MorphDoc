import type {
  DocxThemeTokenSet,
  DocxThemeStyleCaptureAdapter
} from "@morphdoc/docx-theme-engine";
import {
  DOCX_STYLE_SLOTS,
  DocxThemeStyleSnapshotCache,
  createDocxThemeStyleFingerprint,
  normalizeDocxThemeMappingConfig,
  resolveDocxThemeTokens,
  type DocxThemeStyleSnapshot
} from "@morphdoc/docx-theme-engine";
import type { PreparedDocxExport } from "./application-service.js";
import { SHARED_HIGHLIGHT_CSS } from "@morphdoc/preview-engine";

export interface PreparedDocxThemeTokens {
  tokens: DocxThemeTokenSet;
  warnings: string[];
}

export interface DocxThemeTokenProvider {
  prepare(
    prepared: PreparedDocxExport,
    signal?: AbortSignal
  ): Promise<PreparedDocxThemeTokens>;
}

function createExplicitSnapshot(
  themeId: string,
  themeFingerprint: string
): DocxThemeStyleSnapshot {
  return {
    schemaVersion: 1,
    themeId,
    themeFingerprint,
    viewport: {
      widthPx: 794,
      heightPx: 1123,
      deviceScaleFactor: 1
    },
    rootFontSizePx: 16,
    slots: DOCX_STYLE_SLOTS.map(({ name }) => ({
      slot: name,
      matched: false
    }))
  };
}

export class DocxThemeTokenService
  implements DocxThemeTokenProvider
{
  private readonly snapshots: DocxThemeStyleSnapshotCache;

  constructor(
    private readonly adapter: DocxThemeStyleCaptureAdapter
  ) {
    this.snapshots = new DocxThemeStyleSnapshotCache(adapter);
  }

  async prepare(
    prepared: PreparedDocxExport,
    signal?: AbortSignal
  ): Promise<PreparedDocxThemeTokens> {
    signal?.throwIfAborted();
    const config = normalizeDocxThemeMappingConfig(
      prepared.theme.manifest
    );
    const themeFingerprint =
      await createDocxThemeStyleFingerprint(
        prepared.theme.manifest.id,
        `${SHARED_HIGHLIGHT_CSS}\n${prepared.theme.css}`
      );
    signal?.throwIfAborted();
    const snapshot =
      config.mode === "explicit"
        ? createExplicitSnapshot(
            prepared.theme.manifest.id,
            themeFingerprint
          )
        : await this.snapshots.capture(
            {
              themeId: prepared.theme.manifest.id,
              themeFingerprint,
              themeCss: `${SHARED_HIGHLIGHT_CSS}\n${prepared.theme.css}`,
              baseUrl: this.adapter.themeStyleBaseUrl
            },
            signal
          );
    const tokens = resolveDocxThemeTokens({
      snapshot,
      config
    });
    return {
      tokens,
      warnings: tokens.diagnostics
        .filter(
          (diagnostic) => diagnostic.severity !== "info"
        )
        .map((diagnostic) => diagnostic.message)
    };
  }

  invalidate(themeId?: string) {
    this.snapshots.invalidate(themeId);
  }
}
