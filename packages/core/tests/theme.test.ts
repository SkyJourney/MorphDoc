import { describe, expect, it } from "vitest";
import { themeManifestSchema } from "../src/theme.js";

describe("主题清单", () => {
  it("允许主题推荐页边距、页眉和页码配置", () => {
    const parsed = themeManifestSchema.parse({
      manifestVersion: 1,
      id: "official-test",
      name: "公文测试主题",
      version: "0.5.1",
      description: "测试主题推荐页面配置。",
      author: "morphdoc contributors",
      license: "项目自有",
      entry: "theme.css",
      domPreset: "generic",
      defaultFontSize: "21.333px",
      supportedFeatures: ["table"],
      category: "red-letter",
      compatibleProfiles: ["official"],
      pageDefaults: {
        margins: {
          top: "37mm",
          right: "26mm",
          bottom: "35mm",
          left: "28mm"
        },
        header: {
          enabled: false,
          height: "8mm",
          showOnFirstPage: false,
          showDivider: false,
          fontSize: "4.94mm",
          fontFamily: '"MorphDoc Fandol Song", SimSun, serif',
          color: "#000000",
          left: { enabled: false, content: "" },
          center: { enabled: false, content: "" },
          right: { enabled: false, content: "" }
        },
        footer: {
          enabled: true,
          height: "7mm",
          showDivider: false,
          fontSize: "4.94mm",
          fontFamily: '"MorphDoc Fandol Song", SimSun, serif',
          color: "#000000",
          alignment: "outer",
          format: "official-page",
          startFrom: 1,
          showOnFirstPage: false
        }
      },
      bundled: true
    });

    expect(parsed.pageDefaults?.footer).toMatchObject({
      alignment: "outer",
      format: "official-page",
      showOnFirstPage: false
    });
    expect(parsed.pageDefaults?.header.showOnFirstPage).toBe(false);
  });

  it("为旧主题的页眉首页策略补齐兼容默认值", () => {
    const parsed = themeManifestSchema.parse({
      manifestVersion: 1,
      id: "legacy-header-test",
      name: "旧主题页眉测试",
      version: "0.5.1",
      description: "验证未声明首页策略的旧主题。",
      author: "morphdoc contributors",
      license: "项目自有",
      entry: "theme.css",
      domPreset: "generic",
      defaultFontSize: "16px",
      supportedFeatures: [],
      pageDefaults: {
        margins: {
          top: "16mm",
          right: "16mm",
          bottom: "16mm",
          left: "16mm"
        },
        header: {
          enabled: true,
          height: "8mm",
          showDivider: false,
          fontSize: "3mm",
          color: "#000000",
          left: { enabled: false, content: "" },
          center: { enabled: true, content: "${title}" },
          right: { enabled: false, content: "" }
        }
      },
      bundled: true
    });

    expect(parsed.pageDefaults?.header?.showOnFirstPage).toBe(true);
  });

  it("允许声明可嵌入的本地 DOCX 字体字形面", () => {
    const parsed = themeManifestSchema.parse({
      manifestVersion: 1,
      id: "font-test",
      name: "字体测试主题",
      version: "0.6.0",
      description: "测试可移植 DOCX 字体声明。",
      author: "morphdoc contributors",
      license: "项目自有",
      entry: "theme.css",
      domPreset: "generic",
      defaultFontSize: "16px",
      supportedFeatures: [],
      docxFonts: {
        faces: [
          {
            family: "MorphDoc Fandol Fang",
            aliases: ["FangSong", "STFangsong"],
            source:
              "theme-shared:official-fonts/FandolFang-Regular.woff2",
            weight: 400,
            style: "normal",
            license: "GPL-3.0-with-font-exception"
          }
        ]
      },
      bundled: true
    });

    expect(parsed.docxFonts?.faces[0]).toMatchObject({
      family: "MorphDoc Fandol Fang",
      weight: 400,
      style: "normal"
    });
  });

  it("拒绝远程或越界的 DOCX 字体资源", () => {
    const base = {
      manifestVersion: 1,
      id: "font-test",
      name: "字体测试主题",
      version: "0.6.0",
      description: "测试字体路径门禁。",
      author: "morphdoc contributors",
      license: "项目自有",
      entry: "theme.css",
      domPreset: "generic",
      defaultFontSize: "16px",
      supportedFeatures: [],
      bundled: true
    };

    for (const source of [
      "https://example.com/font.woff2",
      "../font.woff2",
      "C:\\fonts\\font.ttf"
    ]) {
      expect(() =>
        themeManifestSchema.parse({
          ...base,
          docxFonts: {
            faces: [
              {
                family: "Unsafe Font",
                source,
                license: "unknown"
              }
            ]
          }
        })
      ).toThrow();
    }
  });
});
