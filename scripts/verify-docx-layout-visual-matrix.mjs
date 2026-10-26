import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { DOMParser } from "@xmldom/xmldom";
import { unzipSync } from "fflate";
import matter from "gray-matter";

import {
  createPdfDocumentSnapshot,
  createPdfVisualDiffReport,
  createWordPdfAdapter,
  createWpsPdfAdapter,
  getBlockingVisualDiffIssues,
  isCrossEngineRasterEquivalent,
  normalizePdfEditableText,
  renderPdfVisualDiffHtml,
  serializePdfVisualDiffJson
} from "../packages/document-visual-diff/dist/index.js";
import {
  formatPageNumber,
  resolvePageNumberAlignment
} from "../packages/preview-engine/dist/index.js";
import {
  createDocxLayoutVisualMatrixCases,
  getDocxFontGateFailures,
  isCorpusTextColorEquivalent,
  readBundledThemeMatrixDefinitions,
  resolveEffectiveCoverPageCount,
  summarizeDocxLayoutVisualMatrix
} from "./docx-layout-visual-matrix-cases.mjs";
import {
  DOCX_REAL_WORLD_CORPUS
} from "./docx-real-world-corpus.mjs";

const execFileAsync = promisify(execFile);
const WORD_NAMESPACE =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MATH_NAMESPACE =
  "http://schemas.openxmlformats.org/officeDocument/2006/math";
const decoder = new TextDecoder();
const repositoryDirectory = path.resolve(import.meta.dirname, "..");
const outputDirectory = path.resolve(
  repositoryDirectory,
  process.env.MORPHDOC_LAYOUT_VISUAL_OUTPUT_DIR?.trim() ||
    path.join("output", "docx-layout-visual-matrix")
);
const matrixScript = path.join(
  repositoryDirectory,
  "apps",
  "server",
  "scripts",
  "verify-docx-r4-matrix.mjs"
);
const pageSizes = {
  A4: { portrait: [595.276, 841.89], landscape: [841.89, 595.276] }
};
const themeDefinitions = readBundledThemeMatrixDefinitions(
  path.join(repositoryDirectory, "themes")
);
const cases = createDocxLayoutVisualMatrixCases(themeDefinitions);
const matrixDefinition = summarizeDocxLayoutVisualMatrix(
  themeDefinitions,
  cases
);

const selectedCaseId =
  process.env.MORPHDOC_LAYOUT_VISUAL_CASE?.trim() || undefined;
const selectedScope =
  process.env.MORPHDOC_LAYOUT_VISUAL_SCOPE?.trim() || "full";
const selectedOrientation =
  process.env.MORPHDOC_LAYOUT_VISUAL_ORIENTATION?.trim() || undefined;
const selectedMarginScenarioId =
  process.env.MORPHDOC_LAYOUT_VISUAL_MARGIN?.trim() || undefined;
const expectInlineCodeProbes =
  process.env.MORPHDOC_R4_APPEND_INLINE_CODE_PROBES?.trim() !== "0";
const selectedCorpusId =
  process.env.MORPHDOC_CORPUS_ID?.trim() || undefined;
const corpusDefinition = selectedCorpusId
  ? DOCX_REAL_WORLD_CORPUS.find((entry) => entry.id === selectedCorpusId)
  : undefined;
const corpusSourceMetadata = selectedScope === "corpus" &&
  process.env.MORPHDOC_R4_MARKDOWN_PATH?.trim()
  ? matter(fs.readFileSync(
      path.resolve(
        repositoryDirectory,
        process.env.MORPHDOC_R4_MARKDOWN_PATH.trim()
      ),
      "utf8"
    )).data
  : undefined;
const scopedCases = selectedCaseId
  ? cases.filter((entry) => entry.id === selectedCaseId)
  : selectedScope === "cover"
    ? cases.filter((entry) => entry.coverPageCount > 0)
    : cases;
const selectedCases = scopedCases.filter(
  (entry) =>
    (!selectedOrientation || entry.orientation === selectedOrientation) &&
    (!selectedMarginScenarioId ||
      entry.marginScenarioId === selectedMarginScenarioId)
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function paragraphStyleId(paragraph) {
  const style = Array.from(paragraph.getElementsByTagName("*")).find(
    (node) =>
      node.localName === "pStyle" && node.namespaceURI === WORD_NAMESPACE
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

function isInternalLayoutSpacerParagraph(descendants, text) {
  if (text !== ".") {
    return false;
  }
  const attributeValue = (node, name) =>
    node.getAttribute(`w:${name}`) || node.getAttribute(name) || undefined;
  return (
    descendants.some(
      (node) =>
        node.localName === "sz" &&
        node.namespaceURI === WORD_NAMESPACE &&
        attributeValue(node, "val") === "2"
    ) &&
    descendants.some(
      (node) =>
        node.localName === "spacing" &&
        node.namespaceURI === WORD_NAMESPACE &&
        attributeValue(node, "lineRule") === "exact"
    )
  );
}

function hasAncestor(paragraph, localName) {
  let current = paragraph.parentNode;
  while (current) {
    if (
      current.localName === localName &&
      current.namespaceURI === WORD_NAMESPACE
    ) {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

function isTableHeaderParagraph(paragraph) {
  let current = paragraph.parentNode;
  while (current) {
    if (current.localName === "tr" && current.namespaceURI === WORD_NAMESPACE) {
      return Array.from(current.getElementsByTagName("*")).some(
        (node) =>
          node.localName === "tblHeader" &&
          node.namespaceURI === WORD_NAMESPACE
      );
    }
    current = current.parentNode;
  }
  return false;
}

function paragraphBlockKind(paragraph, styleId) {
  if (hasAncestor(paragraph, "tc")) {
    return isTableHeaderParagraph(paragraph) ? "table-header" : "table-cell";
  }
  if (styleId === "SourceCode") {
    return "code-block";
  }
  if (styleId === "BlockText") {
    return "block-quote";
  }
  if (/(?:Caption)$/u.test(styleId)) {
    return "caption";
  }
  if (/^Heading[1-6]$/u.test(styleId)) {
    return "heading";
  }
  if (styleId === "Compact" || styleId === "ListParagraph") {
    return "list-item";
  }
  if (/^Md(?:Official|Briefing|ProjectReport|Tender)/u.test(styleId)) {
    return "semantic-region";
  }
  return "paragraph";
}

function directWordChildren(node, localName) {
  return Array.from(node?.childNodes ?? []).filter(
    (child) =>
      child.nodeType === 1 &&
      child.localName === localName &&
      child.namespaceURI === WORD_NAMESPACE
  );
}

function nearestWordAncestor(node, localName) {
  let current = node?.parentNode;
  while (current) {
    if (
      current.localName === localName &&
      current.namespaceURI === WORD_NAMESPACE
    ) {
      return current;
    }
    current = current.parentNode;
  }
  return undefined;
}

function paragraphTableCoordinates(paragraph, tableIndexes) {
  const cell = nearestWordAncestor(paragraph, "tc");
  const row = nearestWordAncestor(paragraph, "tr");
  const table = nearestWordAncestor(paragraph, "tbl");
  if (!cell || !row || !table) {
    return undefined;
  }
  return {
    tableGroupId: `table-${tableIndexes.get(table)}`,
    tableRowIndex: directWordChildren(table, "tr").indexOf(row),
    tableColumnIndex: directWordChildren(row, "tc").indexOf(cell)
  };
}

function extractEditableContract(docxPath) {
  const entries = unzipSync(Uint8Array.from(fs.readFileSync(docxPath)));
  const documentXml = entries["word/document.xml"];
  assert(documentXml, `DOCX 缺少 word/document.xml：${docxPath}`);
  const document = new DOMParser().parseFromString(
    decoder.decode(documentXml),
    "application/xml"
  );
  const tableIndexes = new Map(
    Array.from(document.getElementsByTagName("*")).filter(
      (node) => node.localName === "tbl" && node.namespaceURI === WORD_NAMESPACE
    ).map((table, index) => [table, index])
  );
  let section = "cover";
  let hasCoverSection = false;
  const paragraphs = [];
  let inlineCodeParagraphCount = 0;
  let inlineCodeExactLineRuleCount = 0;
  let pureMathTableParagraphCount = 0;
  let stabilizedPureMathTableParagraphCount = 0;
  for (const paragraph of Array.from(document.getElementsByTagName("*")).filter(
    (node) => node.localName === "p" && node.namespaceURI === WORD_NAMESPACE
  )) {
    const descendants = Array.from(paragraph.getElementsByTagName("*"));
    const inlineCode = descendants.some(
      (node) =>
        node.localName === "rStyle" &&
        node.namespaceURI === WORD_NAMESPACE &&
        (node.getAttribute("w:val") || node.getAttribute("val")) ===
          "VerbatimChar"
    );
    if (inlineCode) {
      inlineCodeParagraphCount += 1;
      if (
        descendants.some(
          (node) =>
            node.localName === "spacing" &&
            node.namespaceURI === WORD_NAMESPACE &&
            (node.getAttribute("w:lineRule") ||
              node.getAttribute("lineRule")) === "exact"
        )
      ) {
        inlineCodeExactLineRuleCount += 1;
      }
    }
    if (hasAncestor(paragraph, "tc")) {
      const directContent = Array.from(paragraph.childNodes).filter(
        (node) =>
          node.nodeType === 1 &&
          !(
            node.localName === "pPr" &&
            node.namespaceURI === WORD_NAMESPACE
          )
      );
      const directMath = directContent.filter(
        (node) =>
          node.localName === "oMath" &&
          node.namespaceURI === MATH_NAMESPACE
      );
      const stabilizers = directContent.filter(
        (node) =>
          node.localName === "r" &&
          node.namespaceURI === WORD_NAMESPACE &&
          Array.from(node.getElementsByTagName("*")).some(
            (descendant) =>
              descendant.localName === "noProof" &&
              descendant.namespaceURI === WORD_NAMESPACE
          ) &&
          Array.from(node.getElementsByTagName("*")).some(
            (descendant) =>
              descendant.localName === "t" &&
              descendant.namespaceURI === WORD_NAMESPACE &&
              descendant.textContent === "\u200B"
          )
      );
      if (
        directMath.length > 0 &&
        directContent.length === directMath.length + stabilizers.length
      ) {
        pureMathTableParagraphCount += 1;
        if (stabilizers.length > 0) {
          stabilizedPureMathTableParagraphCount += 1;
        }
      }
    }
    const hasSectionBreak = descendants.some(
      (node) =>
        node.localName === "sectPr" && node.namespaceURI === WORD_NAMESPACE
    );
    if (hasSectionBreak) {
      hasCoverSection = true;
      section = "body";
      continue;
    }
    const hardBreakSegments = [""];
    const mathCharacterIndexes = [];
    let normalizedCharacterOffset = 0;
    for (const node of descendants) {
      if (
        node.localName === "t" &&
        (node.namespaceURI === WORD_NAMESPACE ||
          node.namespaceURI === MATH_NAMESPACE)
      ) {
        const nodeText = (node.textContent ?? "").replace(
          /[\u200B\u2060\uFEFF]/gu,
          ""
        );
        hardBreakSegments[hardBreakSegments.length - 1] += nodeText;
        const normalizedNodeLength = Array.from(
          normalizePdfEditableText(nodeText)
        ).length;
        if (node.namespaceURI === MATH_NAMESPACE) {
          for (let index = 0; index < normalizedNodeLength; index += 1) {
            mathCharacterIndexes.push(normalizedCharacterOffset + index);
          }
        }
        normalizedCharacterOffset += normalizedNodeLength;
      } else if (
        node.localName === "br" &&
        node.namespaceURI === WORD_NAMESPACE
      ) {
        hardBreakSegments.push("");
      }
    }
    const text = hardBreakSegments.join("");
    if (!text || isInternalLayoutSpacerParagraph(descendants, text)) {
      continue;
    }
    const styleId = paragraphStyleId(paragraph);
    const tableCoordinates = paragraphTableCoordinates(paragraph, tableIndexes);
    paragraphs.push({
      index: paragraphs.length,
      text,
      ...(mathCharacterIndexes.length > 0
        ? { mathCharacterIndexes }
        : {}),
      ...(hardBreakSegments.length > 1
        ? { hardBreakSegments }
        : {}),
      ...(inlineCode ? { hasInlineCode: true } : {}),
      ...(tableCoordinates ?? {}),
      ...(styleId ? { styleId } : {}),
      role: paragraphRole(styleId),
      blockKind: paragraphBlockKind(paragraph, styleId),
      section
    });
  }
  if (!hasCoverSection) {
    for (const paragraph of paragraphs) {
      paragraph.section = "body";
    }
  }
  return {
    text: paragraphs.map((paragraph) => paragraph.text).join(""),
    paragraphs,
    translationInvariants: {
      inlineCodeParagraphCount,
      inlineCodeExactLineRuleCount,
      pureMathTableParagraphCount,
      stabilizedPureMathTableParagraphCount
    }
  };
}

async function generateCase(caseDefinition) {
  const caseDirectory = path.join(outputDirectory, caseDefinition.id);
  fs.mkdirSync(caseDirectory, { recursive: true });
  const { stdout } = await execFileAsync(process.execPath, [matrixScript], {
    cwd: repositoryDirectory,
    windowsHide: true,
    timeout: 360_000,
    maxBuffer: 24 * 1024 * 1024,
    env: {
      ...process.env,
      MORPHDOC_R4_THEME_ID: caseDefinition.themeId,
      MORPHDOC_R4_OUTPUT_DIR: caseDirectory,
      MORPHDOC_R4_EXPORT_CONFIG_JSON: JSON.stringify(caseDefinition.config)
    }
  });
  const result = JSON.parse(stdout).results?.[0];
  assert(result, `视觉矩阵用例 ${caseDefinition.id} 没有生成产物`);
  return { caseDirectory, result };
}

function expectedPageSize(caseDefinition) {
  const dimensions =
    pageSizes[caseDefinition.paper.format]?.[caseDefinition.paper.orientation];
  assert(dimensions, `未知纸张配置：${JSON.stringify(caseDefinition.paper)}`);
  return dimensions;
}

function pageGeometryFailures(snapshot, caseDefinition, label) {
  const [expectedWidth, expectedHeight] = expectedPageSize(caseDefinition);
  return snapshot.pages.flatMap((page) => {
    const widthDelta = Math.abs(page.widthPt - expectedWidth);
    const heightDelta = Math.abs(page.heightPt - expectedHeight);
    return widthDelta <= 0.5 && heightDelta <= 0.5
      ? []
      : [
          `${label} 第 ${page.pageNumber} 页纸张尺寸为 ` +
            `${page.widthPt.toFixed(3)}×${page.heightPt.toFixed(3)} pt，` +
            `期望 ${expectedWidth.toFixed(3)}×${expectedHeight.toFixed(3)} pt`
        ];
  });
}

const inlineCodeContinuityProbes = [
  {
    id: "paragraph",
    code: "morphdoc_ic_p",
    continuousText: "段落前morphdoc_ic_p段落后"
  },
  {
    id: "list-item",
    code: "morphdoc_ic_l",
    continuousText: "列表前morphdoc_ic_l列表后"
  },
  {
    id: "table-cell",
    code: "morphdoc_ic_c",
    continuousText: "单元格前morphdoc_ic_c单元格后"
  }
];

function inspectInlineCodeContinuity(snapshot, label) {
  const normalizedLines = snapshot.pages.flatMap((page) =>
    page.lines.map((line) => ({
      pageNumber: page.pageNumber,
      text: line.text,
      normalizedText: line.text.normalize("NFKC").replace(/\s+/gu, "")
    }))
  );
  const probes = inlineCodeContinuityProbes.map((probe) => {
    const matchingLines = normalizedLines.filter((line) =>
      line.normalizedText.includes(probe.code)
    );
    const passed =
      matchingLines.length === 1 &&
      matchingLines[0].normalizedText.includes(probe.continuousText);
    return {
      ...probe,
      passed,
      matchingLines: matchingLines.map(({ pageNumber, text }) => ({
        pageNumber,
        text
      }))
    };
  });
  return {
    label,
    passed: probes.every((probe) => probe.passed),
    probes,
    failures: probes.flatMap((probe) =>
      probe.passed
        ? []
        : [
            `${label}: INLINE_CODE_CONTINUITY_MISMATCH - ${probe.id} 行内代码未与前后文本保持同一视觉行`
          ]
    )
  };
}

function inspectCodeIndentation(snapshot, label, probe) {
  if (!probe) {
    return {
      label,
      applicable: false,
      passed: true,
      failures: []
    };
  }
  for (const page of snapshot.pages) {
    const nestedIndex = page.lines.findIndex((line) =>
      line.text.includes(probe.nestedLineIncludes)
    );
    if (nestedIndex < 0) {
      continue;
    }
    const nested = page.lines[nestedIndex];
    const root = page.lines
      .slice(0, nestedIndex)
      .reverse()
      .find(
        (line) =>
          line.text.trim() === probe.rootLine &&
          nested.baselineY - line.baselineY <= 30
      );
    if (!root) {
      continue;
    }
    const indentPt = nested.bounds.x - root.bounds.x;
    const passed = indentPt >= probe.minimumIndentPt;
    return {
      label,
      applicable: true,
      passed,
      pageNumber: page.pageNumber,
      rootText: root.text,
      nestedText: nested.text,
      rootXPt: root.bounds.x,
      nestedXPt: nested.bounds.x,
      indentPt,
      failures: passed
        ? []
        : [
            `${label}: CODE_INDENTATION_MISMATCH - JSON 嵌套行缩进 ${indentPt.toFixed(2)}pt，小于 ${probe.minimumIndentPt}pt`
          ]
    };
  }
  return {
    label,
    applicable: true,
    passed: false,
    failures: [
      `${label}: CODE_INDENTATION_PROBE_UNAVAILABLE - 未定位 JSON 根行与嵌套行`
    ]
  };
}

function docxTranslationInvariantFailures(invariants) {
  const failures = [];
  if (invariants.inlineCodeExactLineRuleCount > 0) {
    failures.push(
      `DOCX: INLINE_CODE_EXACT_LINE_BOX - ${invariants.inlineCodeExactLineRuleCount} 个行内代码段落仍使用 exact 行盒`
    );
  }
  if (
    invariants.pureMathTableParagraphCount !==
    invariants.stabilizedPureMathTableParagraphCount
  ) {
    failures.push(
      "DOCX: TABLE_MATH_ALIGNMENT_UNSTABLE - " +
        `${invariants.pureMathTableParagraphCount - invariants.stabilizedPureMathTableParagraphCount} 个纯公式表格段落缺少对齐稳定结构`
    );
  }
  return failures;
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

function reportGateFailures(report, label) {
  const failures = getBlockingVisualDiffIssues(report)
    .map((issue) => `${label}: ${issue.code} - ${issue.message}`);
  if (report.basic.baselineEditableCoverage !== 1) {
    failures.push(
      `${label}: Chromium 可编辑正文有序覆盖率不是 100%`
    );
  }
  if (report.basic.candidateEditableExact !== true) {
    failures.push(`${label}: Office 可编辑正文未精确匹配`);
  }
  if (report.basic.bodyFlow?.detected && !report.basic.bodyFlow.legal) {
    failures.push(`${label}: 分页差异未满足合法正文流条件`);
  }
  return failures;
}

function reportCoverGateFailures(report, label) {
  return getBlockingVisualDiffIssues(report)
    .filter(
      (issue) =>
        issue.code === "COVER_LAYOUT_MISMATCH" ||
        issue.baselinePageNumber === 1 ||
        issue.candidatePageNumber === 1
    )
    .map((issue) => `${label}: ${issue.code} - ${issue.message}`);
}

function metricRatio(first, second) {
  const maximum = Math.max(first, second);
  return maximum > 0 ? Math.min(first, second) / maximum : 1;
}

const MAXIMUM_CORPUS_ELEMENT_COLOR_DELTA = 55;

function reportCorpusGateFailures(
  report,
  label,
  coverPageCount
) {
  const failures = [];
  if ((report.basic.candidateEditableSimilarity ?? 0) < 0.995) {
    failures.push(
      `${label}: EDITABLE_CONTENT_SIMILARITY - Office 可编辑正文相似度 ` +
        `${((report.basic.candidateEditableSimilarity ?? 0) * 100).toFixed(3)}% 低于 99.5%`
    );
  }
  const strictKinds = new Set([
    "heading",
    "title",
    "caption",
    "table-header",
    "code-block"
  ]);
  for (const comparison of report.basic.semanticBlockVisuals ?? []) {
    const index = comparison.expectation.index + 1;
    const visualUnavailable =
      comparison.status === "unavailable" ||
      comparison.lines.length === 0 ||
      comparison.issues?.some(
        (issue) => issue.code === "SEMANTIC_BLOCK_VISUAL_UNAVAILABLE"
      );
    if (visualUnavailable) {
      failures.push(
        `${label}: SEMANTIC_BLOCK_VISUAL_UNAVAILABLE - 第 ${index} 个元素块无法建立视觉观测`
      );
      continue;
    }
    for (const line of comparison.lines) {
      const metrics = line.metrics;
      if (!metrics) {
        continue;
      }
      const heightRatio = metricRatio(
        metrics.baselineHeightPx,
        metrics.candidateHeightPx
      );
      if (heightRatio < 0.78) {
        failures.push(
          `${label}: ELEMENT_LINE_BOX_MISMATCH - 第 ${index} 个元素块第 ${line.lineIndex + 1} 行高度比例 ${heightRatio.toFixed(3)} 低于 0.78`
        );
      }
      const widthRatio = metricRatio(
        metrics.baselineWidthPx,
        metrics.candidateWidthPx
      );
      if (comparison.lines.length === 1 && widthRatio < 0.85) {
        failures.push(
          `${label}: ELEMENT_WIDTH_MISMATCH - 第 ${index} 个单行元素块宽度比例 ${widthRatio.toFixed(3)} 低于 0.85`
        );
      }
      const minimumIou = strictKinds.has(
        comparison.expectation.blockKind
      ) ? 0.45 : 0.3;
      if (
        comparison.lines.length === 1 &&
        metrics.inkIou < minimumIou &&
        metrics.edgeIou < minimumIou
      ) {
        failures.push(
          `${label}: ELEMENT_RASTER_MISMATCH - 第 ${index} 个元素块第 ${line.lineIndex + 1} 行墨迹与边缘 IoU 均低于 ${minimumIou}`
        );
      }
      const textReflow = line.issues?.some(
        (issue) => issue.details?.textReflow === true
      );
      const crossEngineRasterEquivalent = isCrossEngineRasterEquivalent(
        metrics,
        textReflow,
        comparison.expectation.blockKind,
        comparison.expectation.hasInlineCode === true
      );
      if (!textReflow &&
        !crossEngineRasterEquivalent &&
        !isCorpusTextColorEquivalent(metrics) && (
        metrics.backgroundColorDelta > MAXIMUM_CORPUS_ELEMENT_COLOR_DELTA ||
        metrics.foregroundColorDelta > MAXIMUM_CORPUS_ELEMENT_COLOR_DELTA
      )) {
        failures.push(
          `${label}: ELEMENT_COLOR_MISMATCH - 第 ${index} 个元素块第 ${line.lineIndex + 1} 行颜色差异超限`
        );
      }
    }
  }
  if (coverPageCount > 0) {
    failures.push(...reportCoverGateFailures(report, label));
  }
  return [...new Set(failures)];
}

function reportSummary(report) {
  const paragraphIssues = report.basic.paragraphLayouts?.flatMap(
    (paragraph) => paragraph.issues
  ) ?? [];
  const semanticBlocks = report.basic.semanticBlockVisuals ?? [];
  const blockingIssueCodes = [
    ...new Set(getBlockingVisualDiffIssues(report).map((issue) => issue.code))
  ];
  return {
    status: report.status,
    issueCodes: [...new Set(report.issues.map((issue) => issue.code))],
    blockingIssueCodes,
    strictIssueCodes: blockingIssueCodes,
    editableExact: report.basic.candidateEditableExact,
    paragraphIssueCount: paragraphIssues.length,
    semanticBlockCount: semanticBlocks.length,
    failedSemanticBlockCount: semanticBlocks.filter(
      (comparison) => comparison.status === "failed"
    ).length,
    bodyFlow: report.basic.bodyFlow
  };
}

function summarizeDimension(entries, key) {
  return Object.fromEntries(
    [...new Set(entries.map((entry) => entry[key]))]
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((value) => {
        const dimensionCases = entries.filter((entry) => entry[key] === value);
        const failedCases = dimensionCases.filter(
          (entry) => entry.gateFailures.length > 0
        );
        return [value, {
          caseCount: dimensionCases.length,
          passedCaseCount: dimensionCases.length - failedCases.length,
          failedCaseCount: failedCases.length,
          gatePassed: failedCases.length === 0
        }];
      })
  );
}

function summarizeExecution(entries) {
  return {
    byTheme: summarizeDimension(entries, "themeId"),
    byOrientation: summarizeDimension(entries, "orientation"),
    byMarginScenario: summarizeDimension(entries, "marginScenarioId")
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderMatrixSummaryHtml(summary) {
  const caseByDimension = new Map(
    summary.cases.map((entry) => [
      `${entry.themeId}|${entry.orientation}|${entry.marginScenarioId}`,
      entry
    ])
  );
  const columns = summary.matrixDefinition.orientations.flatMap(
    (orientation) =>
      summary.matrixDefinition.marginScenarios.map((marginScenario) => ({
        orientation,
        marginScenario
      }))
  );
  const header = columns.map(({ orientation, marginScenario }) =>
    `<th><span>${orientation === "portrait" ? "纵向" : "横向"}</span><small>${escapeHtml(marginScenario.label)}</small></th>`
  ).join("");
  const rows = summary.matrixDefinition.themeIds.map((themeId) => {
    const cells = columns.map(({ orientation, marginScenario }) => {
      const entry = caseByDimension.get(
        `${themeId}|${orientation}|${marginScenario.id}`
      );
      if (!entry) {
        return '<td class="not-run">未执行</td>';
      }
      const failed = entry.gateFailures.length > 0;
      const base = `./${entry.id}/raster-pages`;
      return `<td class="${failed ? "failed" : "passed"}"><strong>${failed ? `失败 ${entry.gateFailures.length}` : "通过"}</strong><nav><a href="${base}/word-report.html">Word</a><a href="${base}/wps-report.html">WPS</a><a href="${base}/office-report.html">Office</a></nav></td>`;
    }).join("");
    const themeName = summary.cases.find(
      (entry) => entry.themeId === themeId
    )?.themeName;
    return `<tr><th class="theme"><strong>${escapeHtml(themeId)}</strong><small>${escapeHtml(themeName ?? "")}</small></th>${cells}</tr>`;
  }).join("");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DOCX 视觉门禁矩阵</title>
<style>
:root{font-family:Inter,"Microsoft YaHei",sans-serif;color:#172033;background:#f3f5f8}body{margin:0;padding:24px}main{max-width:1800px;margin:auto}h1{margin:0 0 8px}.summary{margin:0 0 20px;color:#475467}.table-wrap{overflow:auto;background:#fff;border:1px solid #d0d5dd;border-radius:10px}table{border-collapse:collapse;min-width:1500px;width:100%}th,td{border:1px solid #e4e7ec;padding:9px;text-align:center;vertical-align:top}thead th{position:sticky;top:0;background:#f8fafc;z-index:1}.theme{position:sticky;left:0;background:#fff;text-align:left;min-width:190px;z-index:2}th span,th small,.theme strong,.theme small{display:block}.passed{background:#e6f7ec}.failed{background:#ffe4e4}.not-run{background:#f2f4f7;color:#667085}nav{display:flex;justify-content:center;gap:6px;margin-top:6px}a{font-size:12px;color:#175cd3}small{margin-top:3px;color:#667085;font-weight:400}
</style></head><body><main><h1>DOCX 视觉门禁矩阵</h1><p class="summary">定义：${summary.matrixDefinition.themeCount} 套主题 × ${summary.matrixDefinition.orientationCount} 个方向 × ${summary.matrixDefinition.marginScenarioCount} 组页边距 = ${summary.matrixDefinition.expectedCaseCount} 个场景；本次执行 ${summary.execution.executedCaseCount} 个，整体 ${summary.gatePassed ? "通过" : "失败"}。</p><div class="table-wrap"><table><thead><tr><th class="theme">主题</th>${header}</tr></thead><tbody>${rows}</tbody></table></div></main></body></html>`;
}

function writeSnapshotPages(directory, prefix, snapshot) {
  for (const page of snapshot.pages) {
    if (page.raster) {
      fs.writeFileSync(
        path.join(directory, `${prefix}-${page.pageNumber}.png`),
        page.raster.png
      );
    }
  }
}

function writeReportArtifacts(directory, prefix, report) {
  fs.writeFileSync(
    path.join(directory, `${prefix}-report.json`),
    `${serializePdfVisualDiffJson(report)}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(directory, `${prefix}-report.html`),
    renderPdfVisualDiffHtml(report),
    "utf8"
  );
  for (const page of report.pages) {
    const pageNumber =
      page.pair.baselinePageNumber ?? page.pair.candidatePageNumber;
    if (!pageNumber || !page.artifacts) {
      continue;
    }
    fs.writeFileSync(
      path.join(directory, `${prefix}-overlay-${pageNumber}.png`),
      page.artifacts.overlayPng
    );
    fs.writeFileSync(
      path.join(directory, `${prefix}-heatmap-${pageNumber}.png`),
      page.artifacts.heatmapPng
    );
  }
  for (const comparison of report.basic.semanticBlockVisuals ?? []) {
    for (const line of comparison.lines) {
      if (!line.artifacts) {
        continue;
      }
      const stem = `${prefix}-block-${comparison.expectation.index + 1}-line-${line.lineIndex + 1}`;
      fs.writeFileSync(
        path.join(directory, `${stem}-baseline.png`),
        line.artifacts.baselinePng
      );
      fs.writeFileSync(
        path.join(directory, `${stem}-candidate.png`),
        line.artifacts.candidatePng
      );
      fs.writeFileSync(
        path.join(directory, `${stem}-overlay.png`),
        line.artifacts.overlayPng
      );
      fs.writeFileSync(
        path.join(directory, `${stem}-heatmap.png`),
        line.artifacts.heatmapPng
      );
    }
  }
}

fs.mkdirSync(outputDirectory, { recursive: true });
assert(
  matrixDefinition.themeCount === 14 &&
    matrixDefinition.orientationCount === 2 &&
    matrixDefinition.marginScenarioCount === 5 &&
    matrixDefinition.expectedCaseCount === 140,
  `布局视觉矩阵定义必须为 14×2×5=140，实际为 ${JSON.stringify(matrixDefinition)}`
);
assert(
  selectedCases.length > 0,
  `视觉矩阵用例不存在：${selectedCaseId}`
);
assert(
  ["full", "cover", "corpus"].includes(selectedScope),
  `不支持的视觉矩阵作用域：${selectedScope}`
);
assert(
  selectedScope !== "corpus" || corpusDefinition,
  `真实语料门禁缺少有效 MORPHDOC_CORPUS_ID：${selectedCorpusId}`
);
assert(
  selectedScope !== "corpus" ||
    Boolean(process.env.MORPHDOC_R4_MARKDOWN_PATH?.trim()),
  "真实语料门禁必须显式提供 MORPHDOC_R4_MARKDOWN_PATH"
);
assert(
  !selectedOrientation || ["portrait", "landscape"].includes(selectedOrientation),
  `不支持的视觉矩阵方向：${selectedOrientation}`
);
assert(
  !selectedMarginScenarioId ||
    matrixDefinition.marginScenarios.some(
      (entry) => entry.id === selectedMarginScenarioId
    ),
  `不支持的视觉矩阵边距场景：${selectedMarginScenarioId}`
);
const wordAdapter = createWordPdfAdapter({ timeoutMs: 240_000 });
const wpsAdapter = createWpsPdfAdapter({ timeoutMs: 240_000 });
const wordCapability = await wordAdapter.probe();
const wpsCapability = await wpsAdapter.probe();
assert(wordCapability.available, `Microsoft Word 不可用：${wordCapability.detail}`);
assert(wpsCapability.available, `WPS Writer 不可用：${wpsCapability.detail}`);

const summaries = [];
const gateFailures = [];
const diagnosticFailures = [];
for (const caseDefinition of selectedCases) {
  process.stderr.write(`[layout visual matrix] ${caseDefinition.id}\n`);
  const { caseDirectory, result } = await generateCase(caseDefinition);
  const chromiumPdfPath = path.resolve(
    repositoryDirectory,
    result.pdf.outputFile
  );
  const docxPath = path.resolve(repositoryDirectory, result.docx.outputFile);
  const editable = extractEditableContract(docxPath);
  const effectiveCoverPageCount = resolveEffectiveCoverPageCount({
    caseDefinition,
    scope: selectedScope,
    sourceMetadata: corpusSourceMetadata
  });
  const wordGeneration = await wordAdapter.generate({ docxPath });
  const wpsGeneration = await wpsAdapter.generate({ docxPath });
  const wordPdfPath = path.join(caseDirectory, "word.pdf");
  const wpsPdfPath = path.join(caseDirectory, "wps.pdf");
  fs.writeFileSync(wordPdfPath, wordGeneration.pdf);
  fs.writeFileSync(wpsPdfPath, wpsGeneration.pdf);

  const chromium = await createPdfDocumentSnapshot(
    fs.readFileSync(chromiumPdfPath),
    {
      source: {
        kind: "chromium",
        label: `${caseDefinition.id} Chromium`,
        fileName: path.basename(chromiumPdfPath)
      },
      dpi: 144
    }
  );
  const word = await createPdfDocumentSnapshot(wordGeneration.pdf, {
    source: {
      kind: "word",
      label: `${caseDefinition.id} Microsoft Word`,
      fileName: path.basename(wordPdfPath)
    },
    dpi: 144
  });
  const wps = await createPdfDocumentSnapshot(wpsGeneration.pdf, {
    source: {
      kind: "wps",
      label: `${caseDefinition.id} WPS Writer`,
      fileName: path.basename(wpsPdfPath)
    },
      dpi: 144
  });
  const chromiumPageSemantics = buildPageSemantics(
    chromium.pageCount,
    effectiveCoverPageCount,
    result.exportConfig
  );
  const wordPageSemantics = buildPageSemantics(
    word.pageCount,
    effectiveCoverPageCount,
    result.exportConfig
  );
  const wpsPageSemantics = buildPageSemantics(
    wps.pageCount,
    effectiveCoverPageCount,
    result.exportConfig
  );
  const reportOptions = {
    thresholds: { strictPageCount: false },
    expectedEditableText: editable.text,
    expectedEditableParagraphs: editable.paragraphs
  };
  const wordReport = await createPdfVisualDiffReport(
    chromium,
    word,
    {
      ...reportOptions,
      baselinePageSemantics: chromiumPageSemantics,
      candidatePageSemantics: wordPageSemantics
    }
  );
  const wpsReport = await createPdfVisualDiffReport(
    chromium,
    wps,
    {
      ...reportOptions,
      baselinePageSemantics: chromiumPageSemantics,
      candidatePageSemantics: wpsPageSemantics
    }
  );
  const officeReport = await createPdfVisualDiffReport(word, wps, {
    ...reportOptions,
    expectedEditableText: editable.text,
    baselinePageSemantics: wordPageSemantics,
    candidatePageSemantics: wpsPageSemantics
  });
  const inlineCodeContinuity = {
    chromium: inspectInlineCodeContinuity(chromium, "Chromium"),
    word: inspectInlineCodeContinuity(word, "Microsoft Word"),
    wps: inspectInlineCodeContinuity(wps, "WPS Writer")
  };
  const codeIndentation = {
    chromium: inspectCodeIndentation(
      chromium,
      "Chromium",
      corpusDefinition?.codeIndentationProbe
    ),
    word: inspectCodeIndentation(
      word,
      "Microsoft Word",
      corpusDefinition?.codeIndentationProbe
    ),
    wps: inspectCodeIndentation(
      wps,
      "WPS Writer",
      corpusDefinition?.codeIndentationProbe
    )
  };

  const rasterDirectory = path.join(caseDirectory, "raster-pages");
  fs.rmSync(rasterDirectory, { recursive: true, force: true });
  fs.mkdirSync(rasterDirectory, { recursive: true });
  writeSnapshotPages(rasterDirectory, "chromium", chromium);
  writeSnapshotPages(rasterDirectory, "word", word);
  writeSnapshotPages(rasterDirectory, "wps", wps);
  writeReportArtifacts(rasterDirectory, "word", wordReport);
  writeReportArtifacts(rasterDirectory, "wps", wpsReport);
  writeReportArtifacts(rasterDirectory, "office", officeReport);

  const allCurrentFailures = [...new Set([
    ...pageGeometryFailures(chromium, caseDefinition, "Chromium"),
    ...pageGeometryFailures(word, caseDefinition, "Microsoft Word"),
    ...pageGeometryFailures(wps, caseDefinition, "WPS Writer"),
    ...getDocxFontGateFailures({
      theme: themeDefinitions.find((theme) => theme.id === caseDefinition.themeId),
      inspection: result.docx.inspection,
      renderedFonts: word.fonts,
      engine: "word"
    }),
    ...getDocxFontGateFailures({
      theme: themeDefinitions.find((theme) => theme.id === caseDefinition.themeId),
      inspection: result.docx.inspection,
      renderedFonts: wps.fonts,
      engine: "wps"
    }),
    ...(expectInlineCodeProbes
      ? [
          ...inlineCodeContinuity.chromium.failures,
          ...inlineCodeContinuity.word.failures,
          ...inlineCodeContinuity.wps.failures
        ]
      : []),
    ...reportGateFailures(wordReport, "Chromium/Word"),
    ...reportGateFailures(wpsReport, "Chromium/WPS"),
    ...reportGateFailures(officeReport, "Word/WPS")
  ])];
  const currentFailures = selectedScope === "cover"
    ? [...new Set([
        ...reportCoverGateFailures(wordReport, "Chromium/Word"),
        ...reportCoverGateFailures(wpsReport, "Chromium/WPS"),
        ...reportCoverGateFailures(officeReport, "Word/WPS")
      ])]
    : selectedScope === "corpus"
      ? [...new Set([
          ...pageGeometryFailures(chromium, caseDefinition, "Chromium"),
          ...pageGeometryFailures(word, caseDefinition, "Microsoft Word"),
          ...pageGeometryFailures(wps, caseDefinition, "WPS Writer"),
          ...getDocxFontGateFailures({
            theme: themeDefinitions.find((theme) => theme.id === caseDefinition.themeId),
            inspection: result.docx.inspection,
            renderedFonts: word.fonts,
            engine: "word"
          }),
          ...getDocxFontGateFailures({
            theme: themeDefinitions.find((theme) => theme.id === caseDefinition.themeId),
            inspection: result.docx.inspection,
            renderedFonts: wps.fonts,
            engine: "wps"
          }),
          ...docxTranslationInvariantFailures(
            editable.translationInvariants
          ),
          ...codeIndentation.chromium.failures,
          ...codeIndentation.word.failures,
          ...codeIndentation.wps.failures,
          ...reportCorpusGateFailures(
            wordReport,
            "Chromium/Word",
            effectiveCoverPageCount
          ),
          ...reportCorpusGateFailures(
            wpsReport,
            "Chromium/WPS",
            effectiveCoverPageCount
          ),
          ...reportCorpusGateFailures(
            officeReport,
            "Word/WPS",
            effectiveCoverPageCount
          )
        ])]
      : allCurrentFailures;
  gateFailures.push(
    ...currentFailures.map((failure) => `${caseDefinition.id}: ${failure}`)
  );
  diagnosticFailures.push(
    ...allCurrentFailures.map((failure) => `${caseDefinition.id}: ${failure}`)
  );
  summaries.push({
    id: caseDefinition.id,
    themeId: caseDefinition.themeId,
    themeName: caseDefinition.themeName,
    orientation: caseDefinition.orientation,
    marginScenarioId: caseDefinition.marginScenarioId,
    marginScenarioLabel: caseDefinition.marginScenarioLabel,
    themeDefaultMargins: caseDefinition.themeDefaultMargins,
    paper: caseDefinition.paper,
    exportConfig: result.exportConfig,
    coverPageCount: effectiveCoverPageCount,
    pages: {
      chromium: chromium.pageCount,
      word: word.pageCount,
      wps: wps.pageCount
    },
    fonts: {
      declared: themeDefinitions.find((theme) => theme.id === caseDefinition.themeId)?.docxFontFaces ?? [],
      embeddedNames: result.docx.inspection.embeddedFontNames,
      embeddedPartCount: result.docx.inspection.embeddedFontPartCount,
      chromium: chromium.fonts,
      word: word.fonts,
      wps: wps.fonts
    },
    editableParagraphCount: editable.paragraphs.length,
    translationInvariants: editable.translationInvariants,
    inlineCodeContinuity,
    codeIndentation,
    reports: {
      word: reportSummary(wordReport),
      wps: reportSummary(wpsReport),
      office: reportSummary(officeReport)
    },
    gateFailures: currentFailures,
    diagnosticFailures: allCurrentFailures,
    files: {
      chromiumPdf: path.relative(repositoryDirectory, chromiumPdfPath),
      docx: path.relative(repositoryDirectory, docxPath),
      wordPdf: path.relative(repositoryDirectory, wordPdfPath),
      wpsPdf: path.relative(repositoryDirectory, wpsPdfPath),
      rasterDirectory: path.relative(repositoryDirectory, rasterDirectory)
    }
  });
}

const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  matrixDefinition,
  selectedCaseId,
  selectedScope,
  corpus: corpusDefinition
    ? {
        id: corpusDefinition.id,
        label: corpusDefinition.label,
        markdownPath: corpusDefinition.markdownPath,
        requiredFeatures: corpusDefinition.requiredFeatures
      }
    : undefined,
  selectedOrientation,
  selectedMarginScenarioId,
  execution: {
    mode: selectedCaseId
      ? "single-case"
      : selectedOrientation || selectedMarginScenarioId
        ? "filtered-matrix"
      : selectedScope === "cover"
        ? "cover-matrix"
        : "full-matrix",
    executedCaseCount: summaries.length,
    expectedFullMatrixCaseCount: matrixDefinition.expectedCaseCount,
    complete: !selectedCaseId && summaries.length === matrixDefinition.expectedCaseCount
  },
  executionSummary: summarizeExecution(summaries),
  word: wordCapability,
  wps: wpsCapability,
  caseCount: summaries.length,
  gatePassed: gateFailures.length === 0,
  gateFailures,
  diagnosticFailures,
  cases: summaries
};
const summaryPath = path.join(
  outputDirectory,
  selectedCaseId
    ? `summary-${selectedCaseId}.json`
    : selectedOrientation || selectedMarginScenarioId
      ? `summary-${selectedOrientation ?? "all"}-${selectedMarginScenarioId ?? "all"}.json`
    : selectedScope === "cover"
      ? "summary-cover.json"
      : "summary.json"
);
const matrixHtmlPath = path.join(
  outputDirectory,
  selectedCaseId
    ? `matrix-${selectedCaseId}.html`
    : selectedOrientation || selectedMarginScenarioId
      ? `matrix-${selectedOrientation ?? "all"}-${selectedMarginScenarioId ?? "all"}.html`
    : selectedScope === "cover"
      ? "matrix-cover.html"
      : "matrix.html"
);
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
fs.writeFileSync(matrixHtmlPath, renderMatrixSummaryHtml(summary), "utf8");
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
assert(
  gateFailures.length === 0,
  `布局视觉矩阵存在 ${gateFailures.length} 个严格门禁问题，详见 ${path.relative(
    repositoryDirectory,
    summaryPath
  )}`
);
