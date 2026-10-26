import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createDocxLayoutVisualMatrixCases,
  DOCX_LAYOUT_MATRIX_MARGIN_SCENARIOS,
  DOCX_LAYOUT_MATRIX_ORIENTATIONS,
  getDocxFontGateFailures,
  isCorpusTextColorEquivalent,
  readBundledThemeMatrixDefinitions,
  resolveEffectiveCoverPageCount,
  summarizeDocxLayoutVisualMatrix
} from "./docx-layout-visual-matrix-cases.mjs";

const repositoryDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const themesDirectory = path.join(repositoryDirectory, "themes");

function matrix() {
  const themes = readBundledThemeMatrixDefinitions(themesDirectory);
  const cases = createDocxLayoutVisualMatrixCases(themes);
  return { themes, cases, summary: summarizeDocxLayoutVisualMatrix(themes, cases) };
}

test("生成 14×2×5 的完整 DOCX 布局视觉矩阵", () => {
  const { cases, summary } = matrix();
  assert.equal(summary.themeCount, 14);
  assert.equal(summary.orientationCount, 2);
  assert.equal(summary.marginScenarioCount, 5);
  assert.equal(summary.expectedCaseCount, 140);
  assert.equal(cases.length, 140);
  assert.equal(new Set(cases.map((entry) => entry.id)).size, 140);
  assert.deepEqual(summary.orientations, ["portrait", "landscape"]);
});

test("字体门禁区分缺少声明、缺少嵌入和 Office 未实际采用", () => {
  const missing = getDocxFontGateFailures({
    theme: { id: "missing", docxFontFaces: [] },
    inspection: { embeddedFontPartCount: 0, embeddedFontNames: [] },
    renderedFonts: [],
    engine: "word"
  });
  assert.equal(missing.length, 2);

  const fallback = getDocxFontGateFailures({
    theme: {
      id: "declared",
      docxFontFaces: [{ family: "FandolSong", aliases: [], weight: 400, style: "normal" }]
    },
    inspection: { embeddedFontPartCount: 1, embeddedFontNames: ["MorphDoc Serif SC"] },
    renderedFonts: [{ name: "SimSun" }],
    engine: "word"
  });
  assert.deepEqual(fallback, ["Microsoft Word 输出未实际使用 DOCX 嵌入字体"]);

  const embedded = getDocxFontGateFailures({
    theme: {
      id: "declared",
      docxFontFaces: [{ family: "FandolSong", aliases: [], weight: 400, style: "normal" }]
    },
    inspection: { embeddedFontPartCount: 1, embeddedFontNames: ["MorphDoc Serif SC"] },
    renderedFonts: [{ name: "___WRD_EMBED_SUB_65" }],
    engine: "word"
  });
  assert.deepEqual(embedded, []);

  const embeddedWithEngineFaces = getDocxFontGateFailures({
    theme: {
      id: "engine-faces",
      docxFontFaces: [{ family: "FandolSong", aliases: [], weight: 400, style: "normal" }]
    },
    inspection: {
      embeddedFontPartCount: 3,
      embeddedFontNames: ["MorphDoc Serif SC", "MorphDoc Mono"]
    },
    renderedFonts: [{ name: "WPSEMBED1" }],
    engine: "wps"
  });
  assert.deepEqual(embeddedWithEngineFaces, []);
});

test("14 套内置主题都声明字体且中文字体面不超过三个", () => {
  const { themes } = matrix();
  const cjkFamilies = /(?:Fandol|MorphDoc|Song|Hei|Kai|Fang|Sim|YaHei|CJK|Han)/iu;
  for (const theme of themes) {
    assert.ok(theme.docxFontFaces.length > 0, `${theme.id} 缺少 DOCX 字体声明`);
    assert.ok(theme.docxFontFaces.length <= 16, `${theme.id} 字体面超过协议上限`);
    const cjkFaces = theme.docxFontFaces.filter((face) =>
      [face.family, ...face.aliases].some((family) => cjkFamilies.test(family))
    );
    assert.ok(cjkFaces.length <= 3, `${theme.id} 中文字体面超过三个`);
  }
});

test("每套主题都覆盖两个方向和五组边距", () => {
  const { themes, cases } = matrix();
  for (const theme of themes) {
    const themeCases = cases.filter((entry) => entry.themeId === theme.id);
    assert.equal(themeCases.length, 10, theme.id);
    assert.deepEqual(
      [...new Set(themeCases.map((entry) => entry.orientation))],
      DOCX_LAYOUT_MATRIX_ORIENTATIONS
    );
    assert.deepEqual(
      [...new Set(themeCases.map((entry) => entry.marginScenarioId))],
      DOCX_LAYOUT_MATRIX_MARGIN_SCENARIOS.map((scenario) => scenario.id)
    );
  }
});

test("主题默认边距始终保留 theme 模式且不写 custom 数值", () => {
  const { themes, cases } = matrix();
  const themeDefaultCases = cases.filter(
    (entry) => entry.marginScenarioId === "theme-default"
  );
  assert.equal(themeDefaultCases.length, 28);
  for (const entry of themeDefaultCases) {
    assert.equal(entry.config.paper.marginMode, "theme");
    assert.equal("margins" in entry.config.paper, false);
    const theme = themes.find((candidate) => candidate.id === entry.themeId);
    assert.deepEqual(entry.themeDefaultMargins, theme?.themeDefaultMargins);
  }
});

test("显式边距场景全部使用 custom 模式并保留稳定数值", () => {
  const { cases } = matrix();
  for (const scenario of DOCX_LAYOUT_MATRIX_MARGIN_SCENARIOS.slice(1)) {
    const scenarioCases = cases.filter(
      (entry) => entry.marginScenarioId === scenario.id
    );
    assert.equal(scenarioCases.length, 28, scenario.id);
    for (const entry of scenarioCases) {
      assert.equal(entry.config.paper.marginMode, "custom");
      assert.deepEqual(entry.config.paper.margins, scenario.margins);
    }
  }
});

test("四套独立封面主题扩展为 40 个严格封面场景", () => {
  const { cases, summary } = matrix();
  assert.equal(summary.coverThemeCount, 4);
  assert.equal(summary.coverCaseCount, 40);
  assert.deepEqual(
    [...new Set(
      cases
        .filter((entry) => entry.coverPageCount === 1)
        .map((entry) => entry.themeId)
    )],
    [
      "formal-feasibility",
      "tender-blind",
      "tender-business-blue",
      "tender-classic"
    ]
  );
});

test("真实语料按文档语义而不是主题能力判定独立封面", () => {
  const caseDefinition = { coverPageCount: 1 };
  assert.equal(resolveEffectiveCoverPageCount({
    caseDefinition,
    scope: "full",
    sourceMetadata: {}
  }), 1);
  assert.equal(resolveEffectiveCoverPageCount({
    caseDefinition,
    scope: "corpus",
    sourceMetadata: {}
  }), 0);
  assert.equal(resolveEffectiveCoverPageCount({
    caseDefinition,
    scope: "corpus",
    sourceMetadata: { document: { profile: "tender" } }
  }), 1);
});

test("短文本仅在墨迹边缘等价且像素误差低时忽略抗锯齿色差", () => {
  assert.equal(isCorpusTextColorEquivalent({
    inkIou: 1,
    edgeIou: 1,
    meanAbsoluteError: 6.9
  }), true);
  assert.equal(isCorpusTextColorEquivalent({
    inkIou: 1,
    edgeIou: 0.999,
    meanAbsoluteError: 23
  }), false);
  assert.equal(isCorpusTextColorEquivalent({
    inkIou: 0.8,
    edgeIou: 1,
    meanAbsoluteError: 4
  }), false);
});
