import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { DOMParser } from "@xmldom/xmldom";
import { unzipSync } from "fflate";

import {
  createPdfDocumentSnapshot,
  createPdfVisualDiffReport,
  createWordPdfAdapter,
  createWpsPdfAdapter,
  renderPdfVisualDiffHtml,
  serializePdfVisualDiffJson
} from "../packages/document-visual-diff/dist/index.js";
import {
  formatPageNumber,
  resolvePageNumberAlignment
} from "../packages/preview-engine/dist/index.js";

const execFileAsync = promisify(execFile);
const WORD_NAMESPACE =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MATH_NAMESPACE =
  "http://schemas.openxmlformats.org/officeDocument/2006/math";
const textDecoder = new TextDecoder();
const repositoryDirectory = path.resolve(import.meta.dirname, "..");
const outputDirectory = path.join(
  repositoryDirectory,
  "output",
  "docx-page-decoration-gate"
);
const matrixScript = path.join(
  repositoryDirectory,
  "apps",
  "server",
  "scripts",
  "verify-docx-r4-matrix.mjs"
);

const commonHeader = {
  enabled: true,
  height: "8mm",
  showDivider: true,
  fontSize: "3mm",
  fontFamily: '"Microsoft YaHei", sans-serif',
  color: "#44546a",
  left: { enabled: true, content: "页眉左栏" },
  center: { enabled: true, content: "页眉中栏" },
  right: { enabled: true, content: "页眉右栏" }
};

const cases = [
  {
    id: "no-cover",
    themeId: "typora-github",
    coverPageCount: 0,
    config: {
      pageDecorationsMode: "custom",
      header: { ...commonHeader, showOnFirstPage: false },
      footer: {
        enabled: true,
        height: "8mm",
        showDivider: true,
        fontSize: "3mm",
        fontFamily: '"Microsoft YaHei", sans-serif',
        color: "#44546a",
        alignment: "center",
        format: "page-total",
        startFrom: 1,
        showOnFirstPage: true
      }
    }
  },
  {
    id: "official",
    themeId: "gov-red-standard",
    coverPageCount: 0,
    config: {
      pageDecorationsMode: "custom",
      header: { ...commonHeader, showOnFirstPage: true },
      footer: {
        enabled: true,
        height: "7mm",
        showDivider: false,
        fontSize: "3mm",
        fontFamily: '"FangSong", "SimSun", serif',
        color: "#000000",
        alignment: "outer",
        format: "official-page",
        startFrom: 1,
        showOnFirstPage: false
      }
    }
  },
  {
    id: "project-cover",
    themeId: "formal-feasibility",
    coverPageCount: 1,
    config: {
      pageDecorationsMode: "custom",
      header: { ...commonHeader, showOnFirstPage: true },
      footer: {
        enabled: true,
        height: "8mm",
        showDivider: true,
        fontSize: "3mm",
        fontFamily: '"Microsoft YaHei", sans-serif',
        color: "#44546a",
        alignment: "outer",
        format: "page-total",
        startFrom: 1,
        showOnFirstPage: true
      }
    }
  }
];
const selectedCaseId =
  process.env.MORPHDOC_PAGE_DECORATION_CASE?.trim() || undefined;
const selectedCases = selectedCaseId
  ? cases.filter((caseDefinition) => caseDefinition.id === selectedCaseId)
  : cases;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractDocxEditableText(docxPath) {
  const entries = unzipSync(Uint8Array.from(fs.readFileSync(docxPath)));
  const documentXml = entries["word/document.xml"];
  assert(documentXml, `DOCX 缺少 word/document.xml：${docxPath}`);
  const document = new DOMParser().parseFromString(
    textDecoder.decode(documentXml),
    "application/xml"
  );
  return Array.from(document.getElementsByTagName("*")).flatMap((node) =>
    node.localName === "t" &&
    (node.namespaceURI === WORD_NAMESPACE || node.namespaceURI === MATH_NAMESPACE)
      ? [node.textContent ?? ""]
      : []
  ).join("");
}

function paragraphStyleId(paragraph) {
  const style = Array.from(paragraph.getElementsByTagName("*")).find(
    (node) => node.localName === "pStyle" && node.namespaceURI === WORD_NAMESPACE
  );
  return style?.getAttribute("w:val") || style?.getAttribute("val") || undefined;
}

function paragraphRole(styleId) {
  if (!styleId) {
    return "body";
  }
  if (/^Heading[1-6]$/u.test(styleId)) {
    return "heading";
  }
  if (
    styleId === "Title" ||
    /(?:Title|Masthead|ProjectName)$/u.test(styleId)
  ) {
    return "title";
  }
  if (/Caption/u.test(styleId)) {
    return "caption";
  }
  return "body";
}

function extractDocxEditableParagraphs(docxPath) {
  const entries = unzipSync(Uint8Array.from(fs.readFileSync(docxPath)));
  const documentXml = entries["word/document.xml"];
  assert(documentXml, `DOCX 缺少 word/document.xml：${docxPath}`);
  const document = new DOMParser().parseFromString(
    textDecoder.decode(documentXml),
    "application/xml"
  );
  let section = "cover";
  let hasCoverSection = false;
  const paragraphs = [];
  for (const paragraph of Array.from(document.getElementsByTagName("*")).filter(
    (node) => node.localName === "p" && node.namespaceURI === WORD_NAMESPACE
  )) {
    const descendants = Array.from(paragraph.getElementsByTagName("*"));
    const hasSectionBreak = descendants.some(
      (node) => node.localName === "sectPr" && node.namespaceURI === WORD_NAMESPACE
    );
    if (hasSectionBreak) {
      hasCoverSection = true;
      section = "body";
      continue;
    }
    const text = descendants.flatMap((node) =>
      node.localName === "t" &&
      (node.namespaceURI === WORD_NAMESPACE || node.namespaceURI === MATH_NAMESPACE)
        ? [node.textContent ?? ""]
        : []
    ).join("");
    if (!text) {
      continue;
    }
    const styleId = paragraphStyleId(paragraph);
    paragraphs.push({
      index: paragraphs.length,
      text,
      ...(styleId ? { styleId } : {}),
      role: paragraphRole(styleId),
      section
    });
  }
  if (!hasCoverSection) {
    for (const paragraph of paragraphs) {
      paragraph.section = "body";
    }
  }
  return paragraphs;
}

function buildPageSemantics(pageCount, coverPageCount, config) {
  assert(
    pageCount > coverPageCount,
    `物理页数 ${pageCount} 必须大于封面页数 ${coverPageCount}`
  );
  const logicalPageCount = pageCount - coverPageCount;
  const headerSlots = ["left", "center", "right"].flatMap((alignment) => {
    const slot = config.header[alignment];
    return config.header.enabled && slot.enabled && slot.content
      ? [{ alignment, text: slot.content }]
      : [];
  });
  return Array.from({ length: pageCount }, (_, index) => {
    const physicalPageNumber = index + 1;
    if (physicalPageNumber <= coverPageCount) {
      return {
        physicalPageNumber,
        kind: "cover",
        logicalPageCount,
        headerVisible: false,
        headerSlots,
        footerVisible: false
      };
    }
    const bodyPageIndex = index - coverPageCount;
    const isBodyFirst = bodyPageIndex === 0;
    const headerVisible =
      config.header.enabled &&
      (!isBodyFirst || config.header.showOnFirstPage);
    const footerVisible =
      config.footer.enabled &&
      (!isBodyFirst || config.footer.showOnFirstPage);
    return {
      physicalPageNumber,
      kind: isBodyFirst ? "body-first" : "body-rest",
      logicalPageNumber: config.footer.startFrom + bodyPageIndex,
      logicalPageCount,
      headerVisible,
      headerSlots,
      footerVisible,
      ...(footerVisible
        ? {
            footerAlignment: resolvePageNumberAlignment(
              config.footer,
              bodyPageIndex
            ),
            pageNumberText: formatPageNumber(
              config.footer,
              bodyPageIndex,
              logicalPageCount
            )
          }
        : {})
    };
  });
}

async function generateCase(caseDefinition) {
  const caseDirectory = path.join(outputDirectory, caseDefinition.id);
  fs.mkdirSync(caseDirectory, { recursive: true });
  const { stdout } = await execFileAsync(process.execPath, [matrixScript], {
    cwd: repositoryDirectory,
    windowsHide: true,
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      MORPHDOC_R4_THEME_ID: caseDefinition.themeId,
      MORPHDOC_R4_OUTPUT_DIR: caseDirectory,
      MORPHDOC_R4_EXPORT_CONFIG_JSON: JSON.stringify(caseDefinition.config)
    }
  });
  const matrix = JSON.parse(stdout);
  const result = matrix.results?.[0];
  assert(result, `代表用例 ${caseDefinition.id} 没有生成矩阵结果`);
  return { caseDirectory, result };
}

fs.mkdirSync(outputDirectory, { recursive: true });
assert(
  selectedCases.length > 0,
  `页装饰视觉门禁用例不存在：${selectedCaseId}`
);
const wordAdapter = createWordPdfAdapter({ timeoutMs: 240_000 });
const wordCapability = await wordAdapter.probe();
assert(wordCapability.available, `Microsoft Word 不可用：${wordCapability.detail}`);
const wpsAdapter = createWpsPdfAdapter({ timeoutMs: 240_000 });
const wpsCapability = await wpsAdapter.probe();
assert(wpsCapability.available, `WPS Writer 不可用：${wpsCapability.detail}`);

const summaries = [];
for (const caseDefinition of selectedCases) {
  process.stderr.write(
    `[page decoration gate] generating ${caseDefinition.id}\n`
  );
  const { caseDirectory, result } = await generateCase(caseDefinition);
  const chromiumPdfPath = path.resolve(
    repositoryDirectory,
    result.pdf.outputFile
  );
  const docxPath = path.resolve(repositoryDirectory, result.docx.outputFile);
  const expectedEditableText = extractDocxEditableText(docxPath);
  const expectedEditableParagraphs = extractDocxEditableParagraphs(docxPath);
  const chromiumPdf = Uint8Array.from(fs.readFileSync(chromiumPdfPath));
  const wordGeneration = await wordAdapter.generate({ docxPath });
  const wordPdfPath = path.join(caseDirectory, "word.pdf");
  fs.writeFileSync(wordPdfPath, wordGeneration.pdf);

  const baseline = await createPdfDocumentSnapshot(chromiumPdf, {
    source: { kind: "chromium", label: `${caseDefinition.id} Chromium` },
    dpi: 144
  });
  const candidate = await createPdfDocumentSnapshot(wordGeneration.pdf, {
    source: { kind: "word", label: `${caseDefinition.id} Microsoft Word` },
    dpi: 144
  });
  const baselinePageSemantics = buildPageSemantics(
    baseline.pageCount,
    caseDefinition.coverPageCount,
    result.exportConfig
  );
  const wordPageSemantics = buildPageSemantics(
    candidate.pageCount,
    caseDefinition.coverPageCount,
    result.exportConfig
  );
  const report = await createPdfVisualDiffReport(baseline, candidate, {
    baselinePageSemantics,
    candidatePageSemantics: wordPageSemantics,
    expectedEditableText,
    expectedEditableParagraphs
  });
  const wpsGeneration = await wpsAdapter.generate({ docxPath });
  const wpsPdfPath = path.join(caseDirectory, "wps.pdf");
  fs.writeFileSync(wpsPdfPath, wpsGeneration.pdf);
  const wpsCandidate = await createPdfDocumentSnapshot(wpsGeneration.pdf, {
    source: { kind: "wps", label: `${caseDefinition.id} WPS Writer` },
    dpi: 144
  });
  const wpsPageSemantics = buildPageSemantics(
    wpsCandidate.pageCount,
    caseDefinition.coverPageCount,
    result.exportConfig
  );
  const wpsReport = await createPdfVisualDiffReport(
    baseline,
    wpsCandidate,
    {
      baselinePageSemantics,
      candidatePageSemantics: wpsPageSemantics,
      expectedEditableText,
      expectedEditableParagraphs
    }
  );
  const rasterDirectory = path.join(caseDirectory, "raster-pages");
  fs.mkdirSync(rasterDirectory, { recursive: true });
  for (const page of baseline.pages) {
    if (page.raster) {
      fs.writeFileSync(
        path.join(rasterDirectory, `chromium-${page.pageNumber}.png`),
        page.raster.png
      );
    }
  }
  for (const page of candidate.pages) {
    if (page.raster) {
      fs.writeFileSync(
        path.join(rasterDirectory, `word-${page.pageNumber}.png`),
        page.raster.png
      );
    }
  }
  for (const page of wpsCandidate.pages) {
    if (page.raster) {
      fs.writeFileSync(
        path.join(rasterDirectory, `wps-${page.pageNumber}.png`),
        page.raster.png
      );
    }
  }
  for (const page of report.pages) {
    const pageNumber = page.pair.baselinePageNumber ??
      page.pair.candidatePageNumber;
    if (!pageNumber || !page.artifacts) {
      continue;
    }
    fs.writeFileSync(
      path.join(rasterDirectory, `overlay-${pageNumber}.png`),
      page.artifacts.overlayPng
    );
    fs.writeFileSync(
      path.join(rasterDirectory, `heatmap-${pageNumber}.png`),
      page.artifacts.heatmapPng
    );
  }
  for (const page of wpsReport.pages) {
    const pageNumber = page.pair.baselinePageNumber ??
      page.pair.candidatePageNumber;
    if (!pageNumber || !page.artifacts) {
      continue;
    }
    fs.writeFileSync(
      path.join(rasterDirectory, `wps-overlay-${pageNumber}.png`),
      page.artifacts.overlayPng
    );
    fs.writeFileSync(
      path.join(rasterDirectory, `wps-heatmap-${pageNumber}.png`),
      page.artifacts.heatmapPng
    );
  }
  const reportJsonPath = path.join(caseDirectory, "report.json");
  const reportHtmlPath = path.join(caseDirectory, "report.html");
  const wpsReportJsonPath = path.join(caseDirectory, "wps-report.json");
  const wpsReportHtmlPath = path.join(caseDirectory, "wps-report.html");
  fs.writeFileSync(
    reportJsonPath,
    `${serializePdfVisualDiffJson(report)}\n`,
    "utf8"
  );
  fs.writeFileSync(reportHtmlPath, renderPdfVisualDiffHtml(report), "utf8");
  fs.writeFileSync(
    wpsReportJsonPath,
    `${serializePdfVisualDiffJson(wpsReport)}\n`,
    "utf8"
  );
  fs.writeFileSync(
    wpsReportHtmlPath,
    renderPdfVisualDiffHtml(wpsReport),
    "utf8"
  );
  summaries.push({
    id: caseDefinition.id,
    themeId: caseDefinition.themeId,
    status: report.status,
    chromiumPages: baseline.pageCount,
    wordPages: candidate.pageCount,
    editableTextLength: expectedEditableText.length,
    editableParagraphCount: expectedEditableParagraphs.length,
    paragraphLayoutIssueCount: report.basic.paragraphLayouts
      ?.flatMap((paragraph) => paragraph.issues).length ?? 0,
    bodyFlow: report.basic.bodyFlow,
    baselineEditableCoverage: report.basic.baselineEditableCoverage,
    wordEditableSimilarity: report.basic.candidateEditableSimilarity,
    wordEditableExact: report.basic.candidateEditableExact,
    semanticIssueCount: report.issues.filter((issue) =>
      [
        "PAGE_NUMBER_VISIBILITY_MISMATCH",
        "PAGE_NUMBER_TEXT_MISMATCH",
        "PAGE_NUMBER_ALIGNMENT_MISMATCH",
        "PAGE_NUMBER_VERTICAL_POSITION_MISMATCH",
        "HEADER_VISIBILITY_MISMATCH",
        "HEADER_TEXT_MISSING",
        "HEADER_VERTICAL_POSITION_MISMATCH"
      ].includes(issue.code)
    ).length,
    issueCodes: [...new Set(report.issues.map((issue) => issue.code))],
    wpsStatus: wpsReport.status,
    wpsPages: wpsCandidate.pageCount,
    wpsEditableSimilarity: wpsReport.basic.candidateEditableSimilarity,
    wpsEditableExact: wpsReport.basic.candidateEditableExact,
    wpsParagraphLayoutIssueCount: wpsReport.basic.paragraphLayouts
      ?.flatMap((paragraph) => paragraph.issues).length ?? 0,
    wpsBodyFlow: wpsReport.basic.bodyFlow,
    wpsSemanticIssueCount: wpsReport.issues.filter((issue) =>
      [
        "PAGE_NUMBER_VISIBILITY_MISMATCH",
        "PAGE_NUMBER_TEXT_MISMATCH",
        "PAGE_NUMBER_ALIGNMENT_MISMATCH",
        "PAGE_NUMBER_VERTICAL_POSITION_MISMATCH",
        "HEADER_VISIBILITY_MISMATCH",
        "HEADER_TEXT_MISSING",
        "HEADER_VERTICAL_POSITION_MISMATCH"
      ].includes(issue.code)
    ).length,
    wpsIssueCodes: [
      ...new Set(wpsReport.issues.map((issue) => issue.code))
    ],
    reportHtml: path.relative(repositoryDirectory, reportHtmlPath),
    reportJson: path.relative(repositoryDirectory, reportJsonPath),
    wpsReportHtml: path.relative(repositoryDirectory, wpsReportHtmlPath),
    wpsReportJson: path.relative(repositoryDirectory, wpsReportJsonPath),
    chromiumPdf: path.relative(repositoryDirectory, chromiumPdfPath),
    wordPdf: path.relative(repositoryDirectory, wordPdfPath),
    wpsPdf: path.relative(repositoryDirectory, wpsPdfPath),
    docx: path.relative(repositoryDirectory, docxPath)
  });
}

const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  selectedCaseId,
  word: wordCapability,
  wps: wpsCapability,
  cases: summaries
};
const summaryPath = path.join(outputDirectory, "summary.json");
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
