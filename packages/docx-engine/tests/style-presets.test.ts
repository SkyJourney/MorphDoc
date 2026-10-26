import { describe, expect, it } from "vitest";
import type { ThemeManifest } from "@morphdoc/core";
import {
  inferDocxStylePreset,
  resolveDocxThemeStyle
} from "../src/index.js";

function manifest(
  overrides: Partial<ThemeManifest> = {}
): ThemeManifest {
  return {
    manifestVersion: 1,
    id: "test-theme",
    name: "测试主题",
    version: "1.0.0",
    description: "测试",
    author: "测试",
    license: "内部许可",
    entry: "theme.css",
    domPreset: "generic",
    defaultFontSize: "16px",
    supportedFeatures: [],
    category: "general",
    compatibleProfiles: [],
    bundled: true,
    ...overrides
  };
}

describe("DOCX 样式预设", () => {
  it("按主题分类提供兼容回退", () => {
    expect(inferDocxStylePreset(manifest())).toBe("general");
    expect(
      inferDocxStylePreset(manifest({ category: "red-letter" }))
    ).toBe("official");
    expect(
      resolveDocxThemeStyle(
        manifest({ category: "formal" })
      ).body.firstLineIndentChars
    ).toBe(2);
  });

  it("将主题覆盖合并到完整预设", () => {
    const resolved = resolveDocxThemeStyle(
      manifest({
        docxStyle: {
          preset: "tender",
          body: {
            sizePt: 13,
            color: "#112233"
          },
          headings: {
            color: "#334455"
          }
        }
      })
    );

    expect(resolved.body).toMatchObject({
      sizePt: 13,
      color: "#112233",
      lineSpacing: 1.5
    });
    expect(resolved.headings.color).toBe("#334455");
    expect(resolved.code.fonts.latin).toBe("Consolas");
  });
});
