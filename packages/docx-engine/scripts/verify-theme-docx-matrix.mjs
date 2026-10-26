import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOCX_PANDOC_VERSION,
  defaultExportConfig,
  themeManifestSchema
} from "@morphdoc/core";
import {
  PandocDocxConverter,
  PandocRuntime,
  resolveReferencePageOptions
} from "@morphdoc/docx-engine";
import { DOCX_STYLE_SLOT_NAMES } from "@morphdoc/docx-theme-engine";
import { renderMarkdown } from "@morphdoc/renderer";
import { unzipSync } from "fflate";

const directory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(directory, "..");
const repositoryDirectory = path.resolve(packageDirectory, "../..");
const themesDirectory = path.join(repositoryDirectory, "themes");
const samplesDirectory = path.join(repositoryDirectory, "samples", "themes");
const outputDirectory = path.join(
  repositoryDirectory,
  "output",
  "docx-theme-matrix"
);
const themeTokenReportPath = path.join(
  repositoryDirectory,
  "output",
  "docx-theme-styles",
  "snapshots.json"
);
const decoder = new TextDecoder();
const sharedFontSourcePrefix = "theme-shared:";
const placeholderPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function decodeXmlText(value) {
  return value
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
}

function extractWordText(xml) {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu)]
    .map((match) => decodeXmlText(match[1] ?? ""))
    .join("");
}

function countMatches(value, pattern) {
  return value.match(pattern)?.length ?? 0;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function countOccurrences(value, search) {
  let count = 0;
  let offset = 0;
  while (offset <= value.length - search.length) {
    const index = value.indexOf(search, offset);
    if (index < 0) {
      break;
    }
    count += 1;
    offset = index + search.length;
  }
  return count;
}

function readThemeManifests() {
  return fs
    .readdirSync(themesDirectory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(
          path.join(themesDirectory, entry.name, "theme.json")
        )
    )
    .map((entry) =>
      themeManifestSchema.parse(
        JSON.parse(
          fs.readFileSync(
            path.join(
              themesDirectory,
              entry.name,
              "theme.json"
            ),
            "utf8"
          )
        )
      )
    )
    .sort((first, second) =>
      first.id.localeCompare(second.id, "en")
    );
}

function readThemeFonts(theme) {
  return (theme.docxFonts?.faces ?? []).map((face) => {
    const shared = face.source.startsWith(sharedFontSourcePrefix);
    const relativePath = shared
      ? path.join(
          "_shared",
          face.source.slice(sharedFontSourcePrefix.length)
        )
      : path.join(theme.id, face.source);
    const sourcePath = path.resolve(themesDirectory, relativePath);
    const relativeSourcePath = path.relative(
      themesDirectory,
      sourcePath
    );
    assert(
      relativeSourcePath !== ".." &&
        !relativeSourcePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativeSourcePath),
      `字体资源路径越界：${face.source}`
    );
    return {
      ...face,
      content: fs.readFileSync(sourcePath)
    };
  });
}

function structuralValues(document) {
  if (!document) {
    return [];
  }
  return Object.entries(document)
    .filter(([name]) => name !== "profile")
    .flatMap(([, value]) =>
      Array.isArray(value) ? value : value ? [value] : []
    )
    .map(String);
}

function inspectDocument(
  content,
  theme,
  metadata,
  semanticDocument,
  exportConfig
) {
  const entries = unzipSync(content);
  const documentXml = decoder.decode(entries["word/document.xml"]);
  const stylesXml = decoder.decode(entries["word/styles.xml"]);
  const bodyText = extractWordText(documentXml);
  const headerXml = Object.entries(entries)
    .filter(([name]) => /^word\/header\d+\.xml$/u.test(name))
    .map(([, value]) => decoder.decode(value))
    .join("\n");
  const footerXml = Object.entries(entries)
    .filter(([name]) => /^word\/footer\d+\.xml$/u.test(name))
    .map(([, value]) => decoder.decode(value))
    .join("\n");
  const expectedStructureValues = structuralValues(metadata.document);
  const missingStructureValues = expectedStructureValues.filter(
    (value) => !bodyText.includes(value)
  );
  const pageOptions = resolveReferencePageOptions({
    exportConfig,
    theme,
    fileName: `${theme.id}.md`,
    metadata
  });
  const expectsStandaloneCover =
    metadata.document?.profile === "project-report" ||
    metadata.document?.profile === "tender";
  const explicitPageBreaks = countMatches(
    documentXml,
    /<w:br[^>]*w:type="page"/gu
  );
  const sections = [
    ...documentXml.matchAll(
      /<w:sectPr(?:\s[^>]*)?>[\s\S]*?<\/w:sectPr>/gu
    )
  ].map((match) => match[0]);
  const tables = [
    ...documentXml.matchAll(
      /<w:tbl(?:\s|>)[\s\S]*?<\/w:tbl>/gu
    )
  ].map((match) => match[0]);
  const contentTables = tables.filter((table) =>
    /<w:tblStyle\s+w:val="Table"\s*\/>/u.test(table)
  );
  const fullWidthTableCount = contentTables.filter((table) =>
    /<w:tblW\s+w:w="5000"\s+w:type="pct"\s*\/>/u.test(table)
  ).length;
  const internalMarkerCount = countMatches(
    documentXml,
    /MORPHDOC_(?:CONTAINER|SECTION)_/gu
  );
  const pandocTitleParagraphCount = countMatches(
    documentXml,
    /<w:pStyle\s+w:val="Title"\s*\/>/gu
  );
  const visibleMetadataTitleCount = countOccurrences(
    bodyText,
    metadata.title
  );
  const titlePolicyPassed =
    semanticDocument.titlePolicy.metadataTitle === "suppress"
      ? pandocTitleParagraphCount === 0
      : pandocTitleParagraphCount === 1;
  const titleDeduplicationPassed =
    semanticDocument.titlePolicy.metadataTitle === "suppress" &&
    semanticDocument.titlePolicy.firstBodyHeading === "keep" &&
    !metadata.document?.profile
      ? visibleMetadataTitleCount === 1
      : titlePolicyPassed;

  return {
    bytes: content.byteLength,
    page: pageOptions,
    paragraphCount: countMatches(documentXml, /<w:p(?:\s|>)/gu),
    tableCount: tables.length,
    contentTableCount: contentTables.length,
    structuralTableCount: tables.length - contentTables.length,
    drawingCount: countMatches(documentXml, /<w:drawing(?:\s|>)/gu),
    explicitPageBreaks,
    sectionCount: sections.length,
    fullWidthTableCount,
    internalMarkerCount,
    pandocTitleParagraphCount,
    visibleMetadataTitleCount,
    titlePolicy: semanticDocument.titlePolicy,
    titlePolicyPassed,
    titleDeduplicationPassed,
    headerPartCount: Object.keys(entries).filter((name) =>
      /^word\/header\d+\.xml$/u.test(name)
    ).length,
    footerPartCount: Object.keys(entries).filter((name) =>
      /^word\/footer\d+\.xml$/u.test(name)
    ).length,
    nativeHeaderFooter:
      !headerXml.includes("<w:tbl") && !footerXml.includes("<w:tbl"),
    pageField: footerXml.includes(" PAGE "),
    totalPagesField: footerXml.includes(" NUMPAGES "),
    sectionPagesField: footerXml.includes(" SECTIONPAGES "),
    altChunkCount: countMatches(documentXml, /<w:altChunk(?:\s|>)/gu),
    styles: {
      normal: stylesXml.includes('w:styleId="Normal"'),
      heading1: stylesXml.includes('w:styleId="Heading1"'),
      sourceCode: stylesXml.includes('w:styleId="SourceCode"'),
      table: stylesXml.includes('w:styleId="Table"')
    },
    profile: metadata.document?.profile ?? null,
    expectedStructureValues,
    missingStructureValues,
    structureCoverage:
      expectedStructureValues.length === 0
        ? 1
        : (expectedStructureValues.length -
            missingStructureValues.length) /
          expectedStructureValues.length,
    expectsStandaloneCover,
    standaloneCoverDetected:
      expectsStandaloneCover &&
      sections.length >= 2 &&
      !sections[0]?.includes("headerReference") &&
      !sections[0]?.includes("footerReference") &&
      sections.at(-1)?.includes('w:pgNumType w:start="1"') ===
        true &&
      missingStructureValues.length === 0
  };
}

function createMediaResource(kind, ordinal, kindOrdinal) {
  const dimensions =
    kind === "image"
      ? { width: 480, height: 270 }
      : { width: 640, height: 360 };
  return {
    id: `docx-media-${ordinal}`,
    kind,
    ordinal,
    kindOrdinal,
    altText: `${kind} 主题验收图 ${kindOrdinal}`,
    ...(kind === "image"
      ? {}
      : { caption: `${kind} 主题验收图 ${kindOrdinal}` }),
    alignment: "center",
    displayWidthPx: dimensions.width,
    displayHeightPx: dimensions.height,
    captureX: 0,
    captureY: 0,
    captureWidthPx: dimensions.width,
    captureHeightPx: dimensions.height,
    rasterScale: 1,
    fileName: `${kind}-${kindOrdinal}.png`,
    contentType: "image/png",
    content: placeholderPng,
    pixelWidth: 1,
    pixelHeight: 1
  };
}

function countMarkdownMedia(markdown, kind) {
  const patterns = {
    image: /!\[[^\]]*\]\([^)]*\)/gu,
    mermaid: /^```mermaid(?:\s.*)?$/gimu,
    echarts: /^```echarts(?:\s.*)?$/gimu
  };
  return countMatches(markdown, patterns[kind]);
}

function createMedia(markdown) {
  const resources = [];
  let ordinal = 0;
  for (const kind of ["image", "mermaid", "echarts"]) {
    const count = countMarkdownMedia(markdown, kind);
    for (let kindOrdinal = 1; kindOrdinal <= count; kindOrdinal += 1) {
      ordinal += 1;
      resources.push(
        createMediaResource(kind, ordinal, kindOrdinal)
      );
    }
  }
  return {
    resources,
    echartsErrors: [],
    mermaidErrors: [],
    warnings: [],
    totalBytes: placeholderPng.byteLength * resources.length
  };
}

function readThemeTokenReport(themes) {
  if (!fs.existsSync(themeTokenReportPath)) {
    throw new Error(
      `缺少本轮 Playwright 主题令牌报告：${path.relative(repositoryDirectory, themeTokenReportPath)}`
    );
  }
  const report = JSON.parse(
    fs.readFileSync(themeTokenReportPath, "utf8")
  );
  assert(
    Array.isArray(report.tokenSets),
    "Playwright 主题令牌报告缺少 tokenSets"
  );
  assert(
    report.tokenSets.length === themes.length,
    `真实主题令牌数量应为 ${themes.length}，实际为 ${report.tokenSets.length}`
  );
  const tokensByTheme = new Map(
    report.tokenSets.map((tokens) => {
      assert(
        tokens.slots?.length === DOCX_STYLE_SLOT_NAMES.length,
        `主题 ${tokens.themeId} 的真实令牌槽位不是 ${DOCX_STYLE_SLOT_NAMES.length}`
      );
      assert(
        /^[a-f0-9]{64}$/u.test(tokens.themeFingerprint ?? ""),
        `主题 ${tokens.themeId} 的 CSS 指纹无效`
      );
      return [tokens.themeId, tokens];
    })
  );
  for (const theme of themes) {
    assert(
      tokensByTheme.has(theme.id),
      `真实主题令牌缺少 ${theme.id}`
    );
  }
  return {
    generatedAt: report.generatedAt,
    chromiumVersion: report.chromiumVersion,
    tokensByTheme
  };
}
const runtime = new PandocRuntime(
  process.env.DOCX_PANDOC_PATH?.trim()
    ? { configuredPath: process.env.DOCX_PANDOC_PATH.trim() }
    : {}
);
const capability = await runtime.probe();
if (capability.capability.status !== "available") {
  throw new Error(capability.capability.message);
}
if (capability.capability.detectedVersion !== DOCX_PANDOC_VERSION) {
  throw new Error(
    `Pandoc 版本不匹配：期望 ${DOCX_PANDOC_VERSION}，实际 ${capability.capability.detectedVersion}`
  );
}

fs.mkdirSync(outputDirectory, { recursive: true });
const converter = new PandocDocxConverter({ runtime });
const themes = readThemeManifests();
assert(themes.length === 14, `内置主题数量应为 14，实际为 ${themes.length}`);
const themeTokenReport = readThemeTokenReport(themes);
const results = [];

for (const theme of themes) {
  console.error(`[DOCX theme matrix] generating ${theme.id}`);
  const samplePath = path.join(samplesDirectory, `${theme.id}.md`);
  if (!fs.existsSync(samplePath)) {
    throw new Error(`主题缺少验收示例：${theme.id}`);
  }
  const markdown = fs.readFileSync(samplePath, "utf8");
  const rendered = renderMarkdown(markdown, { language: "zh-CN" });
  const themeTokens = themeTokenReport.tokensByTheme.get(theme.id);
  const exportConfig = {
    ...defaultExportConfig,
    name: `${theme.name} DOCX 主题验收`,
    themeId: theme.id,
    pageDecorationsMode: "theme",
    paper: {
      ...defaultExportConfig.paper,
      format: "A4",
      orientation: "portrait",
      marginMode: "theme"
    }
  };
  let conversion;
  try {
    conversion = await converter.convert({
      markdown: rendered.markdownBody,
      fileName: `${theme.id}.md`,
      language: rendered.metadata.language,
      exportConfig,
      theme,
      themeTokens,
      metadata: rendered.metadata,
      semanticDocument: rendered.semanticDocument,
      fonts: readThemeFonts(theme),
      media: createMedia(rendered.markdownBody)
    });
  } catch (error) {
    throw new Error(`主题 ${theme.id} 的 DOCX 转换失败`, {
      cause: error
    });
  }
  const outputPath = path.join(outputDirectory, `${theme.id}.docx`);
  fs.writeFileSync(outputPath, conversion.docx);
  results.push({
    id: theme.id,
    name: theme.name,
    category: theme.category,
    compatibleProfiles: theme.compatibleProfiles,
    docxPreset: theme.docxStyle?.preset ?? null,
    sample: path.relative(repositoryDirectory, samplePath),
    outputFile: path.relative(repositoryDirectory, outputPath),
    metadata: rendered.metadata,
    conversion: {
      templateFingerprint: conversion.templateFingerprint,
      templateCacheKey: conversion.templateCacheKey,
      timings: conversion.timings,
      validation: conversion.validation
    },
    inspection: inspectDocument(
      conversion.docx,
      theme,
      rendered.metadata,
      rendered.semanticDocument,
      exportConfig
    )
  });
}

for (const result of results) {
  const { inspection } = result;
  assert(
    Object.values(inspection.styles).every(Boolean),
    `主题 ${result.id} 缺少标准 Word 样式`
  );
  assert(
    inspection.nativeHeaderFooter,
    `主题 ${result.id} 的页眉页脚包含表格模拟`
  );
  assert(
    inspection.altChunkCount === 0,
    `主题 ${result.id} 包含 altChunk`
  );
  assert(
    inspection.internalMarkerCount === 0,
    `主题 ${result.id} 残留内部结构标记`
  );
  assert(
    inspection.titlePolicyPassed,
    `主题 ${result.id} 的标题策略未生效`
  );
  assert(
    inspection.titleDeduplicationPassed,
    `主题 ${result.id} 存在重复标题`
  );
  assert(
    inspection.fullWidthTableCount === inspection.contentTableCount,
    `主题 ${result.id} 存在非内容区全宽表格`
  );
  if (inspection.profile) {
    assert(
      inspection.structureCoverage === 1,
      `主题 ${result.id} 的结构字段覆盖率不是 100%`
    );
  }
  if (inspection.expectsStandaloneCover) {
    assert(
      inspection.standaloneCoverDetected,
      `主题 ${result.id} 未生成合格的独立封面分节`
    );
    assert(
      inspection.sectionPagesField,
      `主题 ${result.id} 未使用 SECTIONPAGES`
    );
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  pandocVersion: capability.capability.detectedVersion,
  themeTokens: {
    source: path.relative(
      repositoryDirectory,
      themeTokenReportPath
    ),
    generatedAt: themeTokenReport.generatedAt,
    chromiumVersion: themeTokenReport.chromiumVersion,
    tokenSetCount: themeTokenReport.tokensByTheme.size
  },
  themeCount: themes.length,
  outputDirectory: path.relative(
    repositoryDirectory,
    outputDirectory
  ),
  results
};
const reportPath = path.join(outputDirectory, "theme-matrix-report.json");
fs.writeFileSync(
  reportPath,
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);
console.log(JSON.stringify(report, null, 2));
