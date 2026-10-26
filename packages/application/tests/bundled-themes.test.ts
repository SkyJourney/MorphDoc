import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { docxThemeStyleSchema } from "@morphdoc/core";

const bundledThemeNames = {
  "typora-github": "GitHub",
  "typora-pixyll": "Pixyll",
  "typora-whitey": "Whitey",
  "typora-like": "Clean",
  "gov-red-standard": "政企红头·标准文件",
  "gov-red-letter": "政企红头·标准信函",
  "enterprise-red-simple": "政企红头·企业简版",
  "red-briefing": "政企红头·纪要简报",
  "formal-report": "政企正式·工作报告",
  "formal-regulation": "政企正式·规章制度",
  "formal-feasibility": "政企正式·可研报告",
  "tender-classic": "标书正式·经典黑白",
  "tender-business-blue": "标书正式·商务蓝",
  "tender-blind": "标书正式·技术暗标"
} as const;

describe("内置主题清单", () => {
  it("每个内置主题都有同名 Markdown 示例", async () => {
    const samplesRoot = fileURLToPath(
      new URL("../../../samples/themes/", import.meta.url)
    );
    const sampleFiles = (await readdir(samplesRoot))
      .filter((fileName) => fileName.endsWith(".md"))
      .sort();
    const expectedFiles = Object.keys(bundledThemeNames)
      .map((id) => `${id}.md`)
      .sort();

    expect(sampleFiles).toEqual(expectedFiles);
    expect(sampleFiles).not.toContain("_shared.md");
    for (const fileName of sampleFiles) {
      const markdown = await readFile(
        `${samplesRoot}${fileName}`,
        "utf8"
      );
      expect(markdown.length).toBeGreaterThan(300);
      expect(markdown).toMatch(/^---[\s\S]+---/u);
    }
  });

  it("提供可随桌面发行包分发的内置教程", async () => {
    const tutorialsRoot = fileURLToPath(
      new URL("../../../samples/tutorials/", import.meta.url)
    );
    const tutorialFiles = (await readdir(tutorialsRoot))
      .filter((fileName) => fileName.endsWith(".md"))
      .sort();

    expect(tutorialFiles).toEqual([
      "echarts-tutorial.md",
      "formal-document-tutorial.md"
    ]);
    for (const fileName of tutorialFiles) {
      const markdown = await readFile(
        `${tutorialsRoot}${fileName}`,
        "utf8"
      );
      expect(markdown.startsWith("---")).toBe(true);
      expect(markdown.length).toBeGreaterThan(1_000);
    }
  });

  it("使用稳定主题 ID 和面向用户的显示名称", async () => {
    const themesRoot = fileURLToPath(
      new URL("../../../themes/", import.meta.url)
    );

    for (const [id, name] of Object.entries(bundledThemeNames)) {
      const manifest = JSON.parse(
        await readFile(
          `${themesRoot}${id}/theme.json`,
          "utf8"
        )
      ) as { id?: unknown; name?: unknown };

      expect(manifest.id).toBe(id);
      expect(manifest.name).toBe(name);
    }
  });

  it("每个内置主题声明可校验的 DOCX 样式预设", async () => {
    const themesRoot = fileURLToPath(
      new URL("../../../themes/", import.meta.url)
    );

    for (const id of Object.keys(bundledThemeNames)) {
      const manifest = JSON.parse(
        await readFile(`${themesRoot}${id}/theme.json`, "utf8")
      ) as { docxStyle?: unknown };

      expect(
        docxThemeStyleSchema.safeParse(manifest.docxStyle).success
      ).toBe(true);
    }
  });

  it("为红头主题声明分类与兼容的结构化文档", async () => {
    const themesRoot = fileURLToPath(
      new URL("../../../themes/", import.meta.url)
    );
    const expectedProfiles = {
      "gov-red-standard": "official",
      "gov-red-letter": "official",
      "enterprise-red-simple": "official",
      "red-briefing": "briefing"
    } as const;

    for (const [id, profile] of Object.entries(expectedProfiles)) {
      const manifest = JSON.parse(
        await readFile(`${themesRoot}${id}/theme.json`, "utf8")
      ) as {
        category?: unknown;
        compatibleProfiles?: unknown;
      };

      expect(manifest.category).toBe("red-letter");
      expect(manifest.compatibleProfiles).toContain(profile);
    }
  });

  it("标准信函主题提供首页版头和末页底部红色双线", async () => {
    const [themeCss, printCss] = await Promise.all([
      readFile(
        new URL(
          "../../../themes/gov-red-letter/theme.css",
          import.meta.url
        ),
        "utf8"
      ),
      readFile(
        new URL(
          "../../../themes/gov-red-letter/print.css",
          import.meta.url
        ),
        "utf8"
      )
    ]);

    expect(themeCss).toContain(".doc-masthead-official::after");
    expect(printCss).toContain(
      ".pagedjs_pages > .pagedjs_page:last-child .pagedjs_pagebox::after"
    );
    expect(printCss).toContain("bottom: 20mm");
  });

  it("为正式文档与标书主题声明正确分类", async () => {
    const themesRoot = fileURLToPath(
      new URL("../../../themes/", import.meta.url)
    );
    const expectedThemes = {
      "formal-report": {
        category: "formal",
        profile: undefined
      },
      "formal-regulation": {
        category: "formal",
        profile: undefined
      },
      "formal-feasibility": {
        category: "formal",
        profile: "project-report"
      },
      "tender-classic": {
        category: "tender",
        profile: "tender"
      },
      "tender-business-blue": {
        category: "tender",
        profile: "tender"
      },
      "tender-blind": {
        category: "tender",
        profile: "tender"
      }
    } as const;

    for (const [id, expected] of Object.entries(expectedThemes)) {
      const manifest = JSON.parse(
        await readFile(`${themesRoot}${id}/theme.json`, "utf8")
      ) as {
        category?: unknown;
        compatibleProfiles?: unknown[];
      };

      expect(manifest.category).toBe(expected.category);
      if (expected.profile) {
        expect(manifest.compatibleProfiles).toContain(
          expected.profile
        );
      } else {
        expect(manifest.compatibleProfiles).toEqual([]);
      }
    }
  });

  it("可研封面使用跨 Chromium 与 Word 一致的原生字体面", async () => {
    const [css, manifestSource] = await Promise.all([
      readFile(
        new URL(
          "../../../themes/formal-feasibility/theme.css",
          import.meta.url
        ),
        "utf8"
      ),
      readFile(
        new URL(
          "../../../themes/formal-feasibility/theme.json",
          import.meta.url
        ),
        "utf8"
      )
    ]);
    const manifest = JSON.parse(manifestSource) as {
      docxFonts?: {
        faces?: Array<{ family: string; weight?: number }>;
      };
    };

    expect(css).toContain('"FandolSong", "Noto Serif CJK SC"');
    expect(css).toContain('"FandolHei", "Noto Sans CJK SC"');
    expect(manifest.docxFonts?.faces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ family: "FandolSong", weight: 400 }),
        expect.objectContaining({ family: "FandolSong", weight: 700 }),
        expect.objectContaining({ family: "FandolHei", weight: 400 })
      ])
    );
  });

  it("技术暗标主题隐藏结构化身份字段", async () => {
    const css = await readFile(
      new URL(
        "../../../themes/tender-blind/theme.css",
        import.meta.url
      ),
      "utf8"
    );

    expect(css).toMatch(
      /\.doc-cover-bidder,[\s\S]*\.doc-cover-representative\s*\{[\s\S]*display:\s*none\s*!important;/u
    );
  });

  it("正式主题声明符合用途的推荐页边距", async () => {
    const themesRoot = fileURLToPath(
      new URL("../../../themes/", import.meta.url)
    );
    const expectedMargins = {
      "gov-red-standard": ["37mm", "26mm", "35mm", "28mm"],
      "gov-red-letter": ["37mm", "26mm", "35mm", "28mm"],
      "enterprise-red-simple": ["25mm", "25mm", "25mm", "28mm"],
      "red-briefing": ["25mm", "25mm", "25mm", "25mm"],
      "formal-report": ["37mm", "26mm", "35mm", "28mm"],
      "formal-regulation": ["37mm", "26mm", "35mm", "28mm"],
      "formal-feasibility": ["25mm", "20mm", "25mm", "30mm"],
      "tender-classic": ["25mm", "25mm", "25mm", "30mm"],
      "tender-business-blue": ["25mm", "25mm", "25mm", "30mm"],
      "tender-blind": ["25.4mm", "25.4mm", "25.4mm", "31.7mm"]
    } as const;

    for (const [id, expected] of Object.entries(expectedMargins)) {
      const manifest = JSON.parse(
        await readFile(`${themesRoot}${id}/theme.json`, "utf8")
      ) as {
        pageDefaults?: {
          margins?: Record<"top" | "right" | "bottom" | "left", string>;
        };
      };
      const margins = manifest.pageDefaults?.margins;

      expect([
        margins?.top,
        margins?.right,
        margins?.bottom,
        margins?.left
      ]).toEqual(expected);
    }
  });

  it("红头机关名称不继承正文首行缩进", async () => {
    const themesRoot = fileURLToPath(
      new URL("../../../themes/", import.meta.url)
    );

    for (const id of [
      "gov-red-standard",
      "gov-red-letter",
      "enterprise-red-simple"
    ]) {
      const css = await readFile(
        `${themesRoot}${id}/theme.css`,
        "utf8"
      );

      expect(css).toMatch(
        /#write \.doc-issuer\s*\{[^}]*text-align:\s*center;[^}]*text-indent:\s*0;/su
      );
    }
  });

});
