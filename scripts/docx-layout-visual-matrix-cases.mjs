import fs from "node:fs";
import path from "node:path";

export const DOCX_LAYOUT_MATRIX_ORIENTATIONS = Object.freeze([
  "portrait",
  "landscape"
]);

export const DOCX_LAYOUT_MATRIX_MARGIN_SCENARIOS = Object.freeze([
  Object.freeze({
    id: "theme-default",
    label: "主题默认边距",
    marginMode: "theme"
  }),
  Object.freeze({
    id: "standard",
    label: "标准边距",
    marginMode: "custom",
    margins: Object.freeze({
      top: "25.4mm",
      right: "25.4mm",
      bottom: "25.4mm",
      left: "25.4mm"
    })
  }),
  Object.freeze({
    id: "compact",
    label: "紧凑边距",
    marginMode: "custom",
    margins: Object.freeze({
      top: "12.7mm",
      right: "12.7mm",
      bottom: "12.7mm",
      left: "12.7mm"
    })
  }),
  Object.freeze({
    id: "wide",
    label: "宽松边距",
    marginMode: "custom",
    margins: Object.freeze({
      top: "31.8mm",
      right: "31.8mm",
      bottom: "31.8mm",
      left: "31.8mm"
    })
  }),
  Object.freeze({
    id: "binding",
    label: "非对称装订边距",
    marginMode: "custom",
    margins: Object.freeze({
      top: "25.4mm",
      right: "19.1mm",
      bottom: "25.4mm",
      left: "31.8mm"
    })
  })
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasIndependentCover(manifest) {
  const profiles = Array.isArray(manifest.compatibleProfiles)
    ? manifest.compatibleProfiles
    : [];
  return profiles.includes("project-report") || profiles.includes("tender");
}

export function resolveEffectiveCoverPageCount({
  caseDefinition,
  scope,
  sourceMetadata
}) {
  assert(caseDefinition && Number.isInteger(caseDefinition.coverPageCount),
    "矩阵场景缺少有效封面页数");
  if (scope !== "corpus") {
    return caseDefinition.coverPageCount;
  }
  const profile = sourceMetadata?.document?.profile;
  return profile === "project-report" || profile === "tender" ? 1 : 0;
}

export function isCorpusTextColorEquivalent(metrics) {
  return Boolean(
    metrics &&
    metrics.inkIou >= 0.98 &&
    metrics.edgeIou >= 0.98 &&
    metrics.meanAbsoluteError <= 8
  );
}

export function readBundledThemeMatrixDefinitions(themesDirectory) {
  assert(
    typeof themesDirectory === "string" && themesDirectory.length > 0,
    "主题目录不能为空"
  );
  return fs.readdirSync(themesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const manifestPath = path.join(themesDirectory, entry.name, "theme.json");
      if (!fs.existsSync(manifestPath)) {
        return [];
      }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest.bundled !== true) {
        return [];
      }
      assert(
        typeof manifest.id === "string" && manifest.id.length > 0,
        `内置主题清单缺少 id：${manifestPath}`
      );
      return [{
        id: manifest.id,
        name:
          typeof manifest.name === "string" && manifest.name.length > 0
            ? manifest.name
            : manifest.id,
        coverPageCount: hasIndependentCover(manifest) ? 1 : 0,
        compatibleProfiles: Array.isArray(manifest.compatibleProfiles)
          ? [...manifest.compatibleProfiles]
          : [],
        docxFontFaces: Array.isArray(manifest.docxFonts?.faces)
          ? manifest.docxFonts.faces.map((face) => ({
              family: face.family,
              aliases: Array.isArray(face.aliases) ? [...face.aliases] : [],
              weight: face.weight ?? 400,
              style: face.style ?? "normal"
            }))
          : [],
        themeDefaultMargins: manifest.pageDefaults?.margins
          ? structuredClone(manifest.pageDefaults.margins)
          : undefined
      }];
    })
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
}

function normalizeFontName(value) {
  return value
    .replace(/^[A-Z]{6}\+/u, "")
    .replace(/(?:[-, ](?:regular|bold|italic|bolditalic|roman|medium|light|black))+$/iu, "")
    .replace(/[\s_-]+/gu, "")
    .toLocaleLowerCase("en-US");
}

function isOfficeEmbeddedAlias(value, engine) {
  return engine === "word"
    ? /^___WRD_EMBED_SUB_/iu.test(value)
    : engine === "wps"
      ? /^WPSEMBED\d+$/iu.test(value)
      : false;
}

export function getDocxFontGateFailures({
  theme,
  inspection,
  renderedFonts,
  engine
}) {
  assert(theme && typeof theme.id === "string", "字体门禁缺少主题定义");
  assert(inspection && typeof inspection === "object", "字体门禁缺少 DOCX 检查结果");
  assert(Array.isArray(renderedFonts), "字体门禁缺少实际渲染字体");
  assert(engine === "word" || engine === "wps", "字体门禁引擎必须为 word 或 wps");
  const failures = [];
  const declaredFaces = Array.isArray(theme.docxFontFaces)
    ? theme.docxFontFaces
    : [];
  const embeddedNames = Array.isArray(inspection.embeddedFontNames)
    ? inspection.embeddedFontNames
    : [];
  const embeddedPartCount = Number(inspection.embeddedFontPartCount ?? 0);
  if (declaredFaces.length === 0) {
    failures.push(`主题 ${theme.id} 未声明任何 DOCX 字体`);
  }
  if (embeddedPartCount === 0) {
    failures.push(`主题 ${theme.id} 的 DOCX 没有嵌入字体部件`);
  }
  if (declaredFaces.length > 0 && embeddedPartCount < declaredFaces.length) {
    failures.push(
      `主题 ${theme.id} 声明 ${declaredFaces.length} 个字体面，但 DOCX 仅嵌入 ${embeddedPartCount} 个部件`
    );
  }
  if (embeddedPartCount > 0) {
    const expected = new Set(embeddedNames.map(normalizeFontName));
    const actuallyUsed = renderedFonts.some((font) => {
      const name = typeof font === "string" ? font : font?.name;
      return typeof name === "string" && (
        isOfficeEmbeddedAlias(name, engine) || expected.has(normalizeFontName(name))
      );
    });
    if (!actuallyUsed) {
      failures.push(
        `${engine === "word" ? "Microsoft Word" : "WPS Writer"} 输出未实际使用 DOCX 嵌入字体`
      );
    }
  }
  return failures;
}

function createPaperConfig(orientation, marginScenario) {
  return {
    format: "A4",
    orientation,
    marginMode: marginScenario.marginMode,
    ...(marginScenario.marginMode === "custom"
      ? { margins: structuredClone(marginScenario.margins) }
      : {})
  };
}

export function createDocxLayoutVisualMatrixCases(themeDefinitions) {
  assert(Array.isArray(themeDefinitions), "主题定义必须是数组");
  const ids = new Set();
  const cases = [];
  for (const theme of themeDefinitions) {
    assert(
      theme && typeof theme.id === "string" && theme.id.length > 0,
      "矩阵主题必须包含非空 id"
    );
    assert(!ids.has(theme.id), `矩阵主题 ID 重复：${theme.id}`);
    ids.add(theme.id);
    for (const orientation of DOCX_LAYOUT_MATRIX_ORIENTATIONS) {
      for (const marginScenario of DOCX_LAYOUT_MATRIX_MARGIN_SCENARIOS) {
        const paper = createPaperConfig(orientation, marginScenario);
        cases.push({
          id: `${theme.id}--${orientation}--${marginScenario.id}`,
          themeId: theme.id,
          themeName: theme.name,
          orientation,
          marginScenarioId: marginScenario.id,
          marginScenarioLabel: marginScenario.label,
          coverPageCount: theme.coverPageCount,
          themeDefaultMargins: theme.themeDefaultMargins
            ? structuredClone(theme.themeDefaultMargins)
            : undefined,
          paper: { format: "A4", orientation },
          config: { paper }
        });
      }
    }
  }
  return cases;
}

export function summarizeDocxLayoutVisualMatrix(themeDefinitions, cases) {
  const themeIds = themeDefinitions.map((theme) => theme.id);
  const caseIds = cases.map((entry) => entry.id);
  const expectedCaseCount =
    themeIds.length *
    DOCX_LAYOUT_MATRIX_ORIENTATIONS.length *
    DOCX_LAYOUT_MATRIX_MARGIN_SCENARIOS.length;
  assert(
    new Set(caseIds).size === caseIds.length,
    "DOCX 布局视觉矩阵存在重复场景 ID"
  );
  assert(
    cases.length === expectedCaseCount,
    `DOCX 布局视觉矩阵场景数错误：${cases.length}，期望 ${expectedCaseCount}`
  );
  for (const themeId of themeIds) {
    const themeCaseCount = cases.filter(
      (entry) => entry.themeId === themeId
    ).length;
    assert(
      themeCaseCount ===
        DOCX_LAYOUT_MATRIX_ORIENTATIONS.length *
          DOCX_LAYOUT_MATRIX_MARGIN_SCENARIOS.length,
      `主题 ${themeId} 的矩阵场景数错误：${themeCaseCount}`
    );
  }
  return {
    themeCount: themeIds.length,
    themeIds,
    orientationCount: DOCX_LAYOUT_MATRIX_ORIENTATIONS.length,
    orientations: [...DOCX_LAYOUT_MATRIX_ORIENTATIONS],
    marginScenarioCount: DOCX_LAYOUT_MATRIX_MARGIN_SCENARIOS.length,
    marginScenarios: DOCX_LAYOUT_MATRIX_MARGIN_SCENARIOS.map((scenario) => ({
      id: scenario.id,
      label: scenario.label,
      marginMode: scenario.marginMode,
      ...(scenario.margins
        ? { margins: structuredClone(scenario.margins) }
        : {})
    })),
    expectedCaseCount,
    coverThemeCount: themeDefinitions.filter(
      (theme) => theme.coverPageCount === 1
    ).length,
    coverCaseCount: cases.filter((entry) => entry.coverPageCount === 1).length
  };
}
