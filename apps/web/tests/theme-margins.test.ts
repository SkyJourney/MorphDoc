import { describe, expect, it } from "vitest";
import { defaultExportConfig } from "@morphdoc/core";
import type { ThemeSummary } from "../src/application-backend";
import {
  applyThemeDefaults,
  applyThemeMargins,
  selectTheme
} from "../src/theme-margins";

function createTheme(
  id: string,
  margins?: ThemeSummary["pageDefaults"]
): ThemeSummary {
  return {
    id,
    name: id,
    version: "1.0.0",
    description: "",
    category: "formal",
    compatibleProfiles: [],
    pageDefaults: margins,
    bundled: true,
    source: "bundled"
  };
}

const formalTheme = createTheme("formal", {
  margins: {
    top: "37mm",
    right: "26mm",
    bottom: "35mm",
    left: "28mm"
  }
});

const officialTheme = createTheme("official", {
  ...formalTheme.pageDefaults,
  header: {
    ...defaultExportConfig.header,
    fontFamily: '"MorphDoc Fandol Song", SimSun, serif',
    showOnFirstPage: false
  },
  footer: {
    ...defaultExportConfig.footer,
    height: "7mm",
    fontSize: "4.94mm",
    fontFamily: '"MorphDoc Fandol Song", SimSun, serif',
    color: "#000000",
    alignment: "outer",
    format: "official-page",
    showOnFirstPage: false
  }
});

describe("主题推荐页边距", () => {
  it("跟随模式切换主题时同步推荐值", () => {
    const selected = selectTheme(defaultExportConfig, formalTheme);

    expect(selected.themeId).toBe("formal");
    expect(selected.paper.marginMode).toBe("theme");
    expect(selected.paper.margins).toEqual(
      formalTheme.pageDefaults?.margins
    );
  });

  it("主题未声明推荐值时恢复全局 16mm", () => {
    const config = selectTheme(defaultExportConfig, formalTheme);
    const selected = selectTheme(config, createTheme("general"));

    expect(selected.paper.margins).toEqual({
      top: "16mm",
      right: "16mm",
      bottom: "16mm",
      left: "16mm"
    });
  });

  it("自定义模式切换主题时保留用户值", () => {
    const config = {
      ...defaultExportConfig,
      paper: {
        ...defaultExportConfig.paper,
        marginMode: "custom" as const,
        margins: {
          top: "20mm",
          right: "18mm",
          bottom: "20mm",
          left: "18mm"
        }
      }
    };
    const selected = selectTheme(config, formalTheme);

    expect(selected.themeId).toBe("formal");
    expect(selected.paper.margins).toEqual(config.paper.margins);
  });

  it("主题清单加载后补齐当前主题推荐值", () => {
    expect(
      applyThemeMargins(defaultExportConfig, formalTheme).paper.margins
    ).toEqual(formalTheme.pageDefaults?.margins);
  });

  it("跟随主题时同步推荐的页眉和页码", () => {
    const selected = selectTheme(defaultExportConfig, officialTheme);

    expect(selected.pageDecorationsMode).toBe("theme");
    expect(selected.header.fontFamily).toContain("Fandol Song");
    expect(selected.header.showOnFirstPage).toBe(false);
    expect(selected.footer).toMatchObject({
      alignment: "outer",
      format: "official-page",
      showOnFirstPage: false
    });
  });

  it("页面装饰自定义模式切换主题时保留用户配置", () => {
    const config = {
      ...defaultExportConfig,
      pageDecorationsMode: "custom" as const,
      footer: {
        ...defaultExportConfig.footer,
        alignment: "left" as const,
        format: "page" as const
      }
    };
    const selected = selectTheme(config, officialTheme);

    expect(selected.header).toEqual(config.header);
    expect(selected.footer).toEqual(config.footer);
  });

  it("主题清单加载后补齐当前主题页面装饰", () => {
    const applied = applyThemeDefaults(
      defaultExportConfig,
      officialTheme
    );

    expect(applied.footer.format).toBe("official-page");
    expect(applied.footer.alignment).toBe("outer");
  });
});
