import { themeManifestSchema } from "@morphdoc/core";
import { describe, expect, it } from "vitest";
import {
  DOCX_STYLE_SLOTS,
  docxThemeStyleSnapshotSchema,
  docxThemeTokenSetSchema,
  normalizeDocxThemeMappingConfig
} from "../src/index.js";

function createManifest(docxStyle?: unknown) {
  return themeManifestSchema.parse({
    manifestVersion: 1,
    id: "external-clean",
    name: "External Clean",
    version: "1.0.0",
    description: "外部主题",
    author: "Tester",
    license: "MIT",
    entry: "theme.css",
    domPreset: "generic",
    defaultFontSize: "16px",
    supportedFeatures: ["table"],
    category: "general",
    compatibleProfiles: [],
    ...(docxStyle ? { docxStyle } : {}),
    bundled: false
  });
}

describe("DOCX 主题映射配置", () => {
  it("没有 DOCX 声明的外部主题默认使用自动映射", () => {
    expect(
      normalizeDocxThemeMappingConfig(createManifest())
    ).toEqual({
      mode: "auto",
      basePreset: "general",
      overrides: {},
      legacyPreset: false
    });
  });

  it("兼容现有 preset 与扁平覆盖", () => {
    const result = normalizeDocxThemeMappingConfig(
      createManifest({
        preset: "technical",
        body: { sizePt: 11 }
      })
    );
    expect(result).toMatchObject({
      mode: "auto-with-overrides",
      basePreset: "technical",
      overrides: { body: { sizePt: 11 } },
      legacyPreset: true
    });
  });

  it("新式 overrides 优先于旧式扁平覆盖", () => {
    const result = normalizeDocxThemeMappingConfig(
      createManifest({
        mode: "auto-with-overrides",
        basePreset: "formal",
        body: { sizePt: 11, color: "#111111" },
        overrides: { body: { sizePt: 12 } }
      })
    );
    expect(result.overrides.body?.sizePt).toBe(12);
    expect(result.overrides.body?.color).toBe("#111111");
  });
});

describe("DOCX 主题引擎契约", () => {
  it("样式槽位名称与选择器保持唯一", () => {
    expect(new Set(DOCX_STYLE_SLOTS.map((slot) => slot.name)).size)
      .toBe(DOCX_STYLE_SLOTS.length);
    expect(
      new Set(DOCX_STYLE_SLOTS.map((slot) => slot.selector)).size
    ).toBe(DOCX_STYLE_SLOTS.length);
  });

  it("拒绝重复或状态不一致的样式快照", () => {
    const computed = {
      fontFamily: "Arial",
      fontSize: "16px",
      fontWeight: "400",
      fontStyle: "normal",
      color: "rgb(0, 0, 0)",
      backgroundColor: "rgba(0, 0, 0, 0)",
      lineHeight: "24px",
      letterSpacing: "normal",
      textAlign: "start",
      direction: "ltr",
      textIndent: "0px",
      textDecorationLine: "none",
      marginTop: "0px",
      marginRight: "0px",
      marginBottom: "0px",
      marginLeft: "0px",
      paddingTop: "0px",
      paddingRight: "0px",
      paddingBottom: "0px",
      paddingLeft: "0px",
      borderTop: "0px none rgb(0, 0, 0)",
      borderRight: "0px none rgb(0, 0, 0)",
      borderBottom: "0px none rgb(0, 0, 0)",
      borderLeft: "0px none rgb(0, 0, 0)",
      width: "100px",
      maxWidth: "none",
      minWidth: "0px",
      minHeight: "0px",
      height: "24px",
      breakBefore: "auto",
      breakAfter: "auto",
      breakInside: "auto",
      display: "block",
      flexDirection: "row",
      alignItems: "normal",
      justifyContent: "normal",
      outline: "0px none rgb(0, 0, 0)",
      outlineOffset: "0px"
    };
    const result = docxThemeStyleSnapshotSchema.safeParse({
      schemaVersion: 1,
      themeId: "external-clean",
      themeFingerprint: "a".repeat(64),
      viewport: {
        widthPx: 794,
        heightPx: 1123,
        deviceScaleFactor: 1
      },
      rootFontSizePx: 16,
      slots: [
        { slot: "paragraph", matched: true, computed },
        { slot: "paragraph", matched: false }
      ]
    });
    expect(result.success).toBe(false);
  });

  it("接受带来源、置信度和诊断的样式令牌", () => {
    expect(
      docxThemeTokenSetSchema.parse({
        schemaVersion: 1,
        themeId: "external-clean",
        themeFingerprint: "b".repeat(64),
        mode: "auto",
        basePreset: "general",
        slots: [
          {
            slot: "paragraph",
            source: "computed-css",
            confidence: "exact",
            style: {
              fontCandidates: ["Arial", "sans-serif"],
              fontSizePt: 12,
              color: "#111111"
            }
          }
        ],
        diagnostics: [
          {
            severity: "warning",
            code: "font-fallback-required",
            message: "首选字体不可用",
            slot: "paragraph",
            property: "font-family"
          }
        ]
      }).slots
    ).toHaveLength(1);
  });
});
