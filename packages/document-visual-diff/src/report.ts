import { comparePdfSnapshotsBasic, DEFAULT_VISUAL_DIFF_THRESHOLDS } from "./compare.js";
import { comparePageRasters } from "./raster.js";
import { comparePdfPageSemantics } from "./page-semantics.js";
import { comparePdfSemanticBlockVisuals } from "./semantic-block.js";
import type {
  CreatePdfVisualDiffOptions,
  PdfDocumentSnapshot,
  PdfPageDecorationObservation,
  PdfPagePair,
  PdfVisualDiffReport,
  PdfVisualPageComparison,
  VisualDiffIssue,
  VisualDiffThresholds,
} from "./types.js";

function resolveStatus(
  issues: readonly VisualDiffIssue[],
): "passed" | "warning" | "failed" {
  if (issues.some((issue) => issue.severity === "failure")) {
    return "failed";
  }
  return issues.length > 0 ? "warning" : "passed";
}

export function getBlockingVisualDiffIssues(
  report: Pick<PdfVisualDiffReport, "issues">,
): VisualDiffIssue[] {
  return report.issues.filter((issue) => issue.severity === "failure");
}

function rasterIssues(
  pair: Extract<PdfPagePair, { status: "paired" }>,
  metrics: NonNullable<PdfVisualPageComparison["metrics"]>,
  thresholds: VisualDiffThresholds,
): VisualDiffIssue[] {
  const location = {
    baselinePageNumber: pair.baselinePageNumber,
    candidatePageNumber: pair.candidatePageNumber,
  };
  const issues: VisualDiffIssue[] = [];
  if (!metrics.dimensionsMatch && !metrics.geometryNormalized) {
    issues.push({
      code: "RASTER_SIZE_MISMATCH",
      severity: "failure",
      message: `第 ${pair.baselinePageNumber} 页栅格尺寸不一致`,
      ...location,
      details: {
        baselineWidthPx: metrics.baselineWidthPx,
        baselineHeightPx: metrics.baselineHeightPx,
        candidateWidthPx: metrics.candidateWidthPx,
        candidateHeightPx: metrics.candidateHeightPx,
        comparedWidthPx: metrics.comparedWidthPx,
        comparedHeightPx: metrics.comparedHeightPx,
      },
    });
  }
  if (metrics.meanAbsoluteError > thresholds.maxMeanAbsoluteError) {
    issues.push({
      code: "PIXEL_MAE_EXCEEDED",
      severity: "failure",
      message: `第 ${pair.baselinePageNumber} 页平均像素误差 ${metrics.meanAbsoluteError.toFixed(3)} 超过 ${thresholds.maxMeanAbsoluteError}`,
      ...location,
      details: { meanAbsoluteError: metrics.meanAbsoluteError },
    });
  }
  if (metrics.changedPixelRatio > thresholds.maxChangedPixelRatio) {
    issues.push({
      code: "CHANGED_PIXEL_RATIO_EXCEEDED",
      severity: "failure",
      message: `第 ${pair.baselinePageNumber} 页变化像素率 ${(metrics.changedPixelRatio * 100).toFixed(3)}% 超过 ${(thresholds.maxChangedPixelRatio * 100).toFixed(3)}%`,
      ...location,
      details: { changedPixelRatio: metrics.changedPixelRatio },
    });
  }
  if (metrics.inkIou < thresholds.minInkIou) {
    issues.push({
      code: "INK_IOU_BELOW_THRESHOLD",
      severity: "failure",
      message: `第 ${pair.baselinePageNumber} 页墨迹 IoU ${metrics.inkIou.toFixed(4)} 低于 ${thresholds.minInkIou}`,
      ...location,
      details: { inkIou: metrics.inkIou },
    });
  }
  if (metrics.edgeIou < thresholds.minEdgeIou) {
    issues.push({
      code: "EDGE_IOU_BELOW_THRESHOLD",
      severity: "failure",
      message: `第 ${pair.baselinePageNumber} 页边缘 IoU ${metrics.edgeIou.toFixed(4)} 低于 ${thresholds.minEdgeIou}`,
      ...location,
      details: { edgeIou: metrics.edgeIou },
    });
  }
  return issues;
}

async function compareVisualPage(
  pair: PdfPagePair,
  baseline: PdfDocumentSnapshot,
  candidate: PdfDocumentSnapshot,
  thresholds: VisualDiffThresholds,
  rasterComparisonMode: "strict" | "body-flow" | "body-block" = "strict",
): Promise<PdfVisualPageComparison> {
  if (pair.status !== "paired") {
    const page =
      pair.status === "baseline-only"
        ? baseline.pages[pair.baselinePageNumber - 1]
        : candidate.pages[pair.candidatePageNumber - 1];
    return {
      pair,
      rasterComparisonMode,
      status: rasterComparisonMode === "strict" ? "failed" : "warning",
      ...(page?.raster
        ? {
            unpairedPng: page.raster.png,
            unpairedSha256: page.raster.sha256,
          }
        : {}),
      issues:
        rasterComparisonMode !== "strict"
          ? [
              {
                code:
                  rasterComparisonMode === "body-flow"
                    ? "BODY_FLOW_RASTER_DIFFERENCE"
                    : "BODY_PAGE_RASTER_DIFFERENCE",
                severity: "warning",
                message:
                  rasterComparisonMode === "body-flow"
                    ? "正文自然分页产生未配对物理页，保留页面快照供审查"
                    : "正文物理页未配对，整页栅格仅作为诊断，最终由语义块门禁判定",
                ...(pair.status === "baseline-only"
                  ? { baselinePageNumber: pair.baselinePageNumber }
                  : { candidatePageNumber: pair.candidatePageNumber }),
              },
            ]
          : [],
    };
  }
  const baselinePage = baseline.pages[pair.baselinePageNumber - 1];
  const candidatePage = candidate.pages[pair.candidatePageNumber - 1];
  if (!baselinePage?.raster || !candidatePage?.raster) {
    const issue: VisualDiffIssue = {
      code: "RASTER_MISSING",
      severity: rasterComparisonMode === "strict" ? "failure" : "warning",
      message: `第 ${pair.baselinePageNumber} 页缺少栅格快照`,
      baselinePageNumber: pair.baselinePageNumber,
      candidatePageNumber: pair.candidatePageNumber,
    };
    return {
      pair,
      rasterComparisonMode,
      status: rasterComparisonMode === "strict" ? "failed" : "warning",
      issues: [issue],
    };
  }
  const result = await comparePageRasters(
    baselinePage.raster,
    candidatePage.raster,
    {
      pixelDifferenceThreshold: thresholds.pixelDifferenceThreshold,
      spatialTolerancePx: thresholds.spatialTolerancePx,
      ...(Math.abs(baselinePage.widthPt - candidatePage.widthPt) <=
        thresholds.pageSizeDeltaPt &&
      Math.abs(baselinePage.heightPt - candidatePage.heightPt) <=
        thresholds.pageSizeDeltaPt &&
      baselinePage.rotation === candidatePage.rotation
        ? {
            targetWidthPx: baselinePage.raster.widthPx,
            targetHeightPx: baselinePage.raster.heightPx,
            geometryNormalized:
              baselinePage.raster.widthPx !== candidatePage.raster.widthPx ||
              baselinePage.raster.heightPx !== candidatePage.raster.heightPx,
          }
        : {}),
    },
  );
  const strictIssues = rasterIssues(pair, result.metrics, thresholds);
  const issues =
    rasterComparisonMode !== "strict" && strictIssues.length > 0
      ? [
          {
            code:
              rasterComparisonMode === "body-flow"
                ? ("BODY_FLOW_RASTER_DIFFERENCE" as const)
                : ("BODY_PAGE_RASTER_DIFFERENCE" as const),
            severity: "warning" as const,
            message:
              rasterComparisonMode === "body-flow"
                ? `第 ${pair.baselinePageNumber} 页栅格差异来自已验证的正文自然分页流动`
                : `第 ${pair.baselinePageNumber} 页为正文页，整页栅格差异仅作诊断，最终由语义块门禁判定`,
            baselinePageNumber: pair.baselinePageNumber,
            candidatePageNumber: pair.candidatePageNumber,
            details: {
              strictIssueCodes: strictIssues
                .map((issue) => issue.code)
                .join(","),
              meanAbsoluteError: result.metrics.meanAbsoluteError,
              changedPixelRatio: result.metrics.changedPixelRatio,
              inkIou: result.metrics.inkIou,
              edgeIou: result.metrics.edgeIou,
            },
          },
        ]
      : strictIssues;
  return {
    pair,
    rasterComparisonMode,
    status: resolveStatus(issues),
    metrics: result.metrics,
    artifacts: result.artifacts,
    issues,
  };
}

export async function createPdfVisualDiffReport(
  baseline: PdfDocumentSnapshot,
  candidate: PdfDocumentSnapshot,
  options: CreatePdfVisualDiffOptions = {},
): Promise<PdfVisualDiffReport> {
  const thresholds = {
    ...DEFAULT_VISUAL_DIFF_THRESHOLDS,
    ...options.thresholds,
  };
  const baselinePageSemantics =
    options.baselinePageSemantics ?? options.pageSemantics ?? [];
  const candidatePageSemantics =
    options.candidatePageSemantics ?? options.pageSemantics ?? [];
  const basic = comparePdfSnapshotsBasic(baseline, candidate, thresholds, {
    ...(options.expectedEditableText === undefined
      ? {}
      : { expectedEditableText: options.expectedEditableText }),
    ...(baselinePageSemantics.length === 0
      ? {}
      : { baselinePageSemantics }),
    ...(candidatePageSemantics.length === 0
      ? {}
      : { candidatePageSemantics }),
    ...(options.expectedEditableParagraphs === undefined
      ? {}
      : { expectedEditableParagraphs: options.expectedEditableParagraphs }),
  });
  if (basic.paragraphLayouts) {
    const semanticBlockVisuals = await comparePdfSemanticBlockVisuals(
      baseline,
      candidate,
      basic.paragraphLayouts,
      thresholds,
    );
    basic.semanticBlockVisuals = semanticBlockVisuals;
    basic.issues.push(
      ...semanticBlockVisuals.flatMap((comparison) => comparison.issues),
    );
    basic.status = resolveStatus(basic.issues);
    if (basic.bodyFlow) {
      basic.bodyFlow.legal =
        basic.bodyFlow.legal &&
        semanticBlockVisuals.every(
          (comparison) => comparison.status !== "failed",
        );
    }
  }
  const pages: PdfVisualPageComparison[] = [];
  for (const pair of basic.pagePairs) {
    const baselineSemanticExpectation =
      pair.status === "candidate-only"
        ? undefined
        : baselinePageSemantics.find(
            (item) => item.physicalPageNumber === pair.baselinePageNumber,
          );
    const candidateSemanticExpectation =
      pair.status === "baseline-only"
        ? undefined
        : candidatePageSemantics.find(
            (item) => item.physicalPageNumber === pair.candidatePageNumber,
          );
    const bodyFlow = basic.bodyFlow;
    const flowAffected = Boolean(
      bodyFlow?.legal &&
      ((pair.status !== "candidate-only" &&
        bodyFlow.affectedBaselinePageNumbers.includes(
          pair.baselinePageNumber,
        )) ||
        (pair.status !== "baseline-only" &&
          bodyFlow.affectedCandidatePageNumbers.includes(
            pair.candidatePageNumber,
          ))),
    );
    const isSemanticBodyPage =
      baselineSemanticExpectation?.kind !== "cover" &&
      candidateSemanticExpectation?.kind !== "cover" &&
      Boolean(baselineSemanticExpectation || candidateSemanticExpectation) &&
      (basic.semanticBlockVisuals?.length ?? 0) > 0;
    const page = await compareVisualPage(
      pair,
      baseline,
      candidate,
      thresholds,
      flowAffected
        ? "body-flow"
        : isSemanticBodyPage
          ? "body-block"
          : "strict",
    );
    const primarySemanticExpectation =
      baselineSemanticExpectation ?? candidateSemanticExpectation;
    if (primarySemanticExpectation) {
      const semantics = comparePdfPageSemantics(
        baseline,
        candidate,
        primarySemanticExpectation,
        candidateSemanticExpectation ?? primarySemanticExpectation,
      );
      page.semantics = semantics;
      page.issues.push(...semantics.issues);
      page.status = resolveStatus(page.issues);
    }
    pages.push(page);
  }
  const issues = [
    ...basic.issues,
    ...pages.flatMap((page) => page.issues),
  ];
  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    status: resolveStatus(issues),
    basic,
    pages,
    issues,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pngDataUri(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(3)}%`;
}

function renderMetrics(page: PdfVisualPageComparison): string {
  if (!page.metrics) {
    return '<p class="muted">无可比较的成对栅格。</p>';
  }
  const metrics = page.metrics;
  return `<div class="metrics">
    <div><span>MAE</span><strong>${metrics.meanAbsoluteError.toFixed(3)}</strong></div>
    <div><span>变化像素</span><strong>${percentage(metrics.changedPixelRatio)}</strong></div>
    <div><span>墨迹 IoU</span><strong>${metrics.inkIou.toFixed(4)}</strong></div>
    <div><span>边缘 IoU</span><strong>${metrics.edgeIou.toFixed(4)}</strong></div>
  </div>`;
}

function renderArtifacts(page: PdfVisualPageComparison): string {
  if (page.unpairedPng) {
    return `<div class="unpaired">
      <figure><figcaption>未配对页面</figcaption><img src="${pngDataUri(page.unpairedPng)}" alt="未配对页面"></figure>
    </div>`;
  }
  const artifacts = page.artifacts;
  if (!artifacts) {
    return "";
  }
  return `<div class="side-by-side">
    <figure><figcaption>基线</figcaption><img src="${pngDataUri(artifacts.baselinePng)}" alt="基线页面"></figure>
    <figure><figcaption>候选</figcaption><img src="${pngDataUri(artifacts.candidatePng)}" alt="候选页面"></figure>
  </div>
  <div class="side-by-side">
    <figure><figcaption>红/青叠加</figcaption><img src="${pngDataUri(artifacts.overlayPng)}" alt="叠加差异"></figure>
    <figure><figcaption>差异热力图</figcaption><img src="${pngDataUri(artifacts.heatmapPng)}" alt="差异热力图"></figure>
  </div>`;
}

function renderSemanticObservation(
  label: string,
  observation: PdfPageDecorationObservation | undefined,
): string {
  if (!observation) {
    return `<td>${escapeHtml(label)}：无页面</td>`;
  }
  return `<td><strong>${escapeHtml(label)}</strong><br>页码：${escapeHtml(observation.pageNumberText ?? "无")}<br>位置：${escapeHtml(observation.pageNumberAlignment ?? "无")}<br>匹配页眉槽：${observation.matchedHeaderSlots.length}<br>缺失页眉槽：${observation.missingHeaderSlots.length}</td>`;
}

function renderSemantics(page: PdfVisualPageComparison): string {
  const semantics = page.semantics;
  if (!semantics) {
    return "";
  }
  const expected = semantics.expectation;
  const candidateExpected = semantics.candidateExpectation ?? expected;
  const kindLabels = {
    cover: "封面",
    "body-first": "正文首页",
    "body-rest": "正文后续页",
  } as const;
  return `<div class="semantics">
    <h3>页面语义 <span class="status ${semantics.status}">${semantics.status}</span></h3>
    <table><tbody>
      <tr><th>基线预期</th><td>物理第 ${expected.physicalPageNumber} 页；${kindLabels[expected.kind]}；逻辑页 ${expected.logicalPageNumber ?? "—"} / ${expected.logicalPageCount}；页眉 ${expected.headerVisible ? "显示" : "隐藏"}；页码 ${expected.footerVisible ? `${escapeHtml(expected.pageNumberText ?? "显示")}（${escapeHtml(expected.footerAlignment ?? "未指定位置")}）` : "隐藏"}</td></tr>
      <tr><th>候选预期</th><td>物理第 ${candidateExpected.physicalPageNumber} 页；${kindLabels[candidateExpected.kind]}；逻辑页 ${candidateExpected.logicalPageNumber ?? "—"} / ${candidateExpected.logicalPageCount}；页眉 ${candidateExpected.headerVisible ? "显示" : "隐藏"}；页码 ${candidateExpected.footerVisible ? `${escapeHtml(candidateExpected.pageNumberText ?? "显示")}（${escapeHtml(candidateExpected.footerAlignment ?? "未指定位置")}）` : "隐藏"}</td></tr>
      <tr><th>观测</th>${renderSemanticObservation("基线", semantics.baseline)}${renderSemanticObservation("候选", semantics.candidate)}</tr>
    </tbody></table>
  </div>`;
}

function pageTitle(page: PdfVisualPageComparison): string {
  const mode =
    page.rasterComparisonMode === "body-flow"
      ? "（正文流动比较）"
      : page.rasterComparisonMode === "body-block"
        ? "（正文整页诊断）"
      : "（严格比较）";
  if (page.pair.status === "paired") {
    return `基线第 ${page.pair.baselinePageNumber} 页 ↔ 候选第 ${page.pair.candidatePageNumber} 页${mode}`;
  }
  if (page.pair.status === "baseline-only") {
    return `基线第 ${page.pair.baselinePageNumber} 页无配对${mode}`;
  }
  return `候选第 ${page.pair.candidatePageNumber} 页为溢出页${mode}`;
}

function renderSemanticBlockVisuals(report: PdfVisualDiffReport): string {
  const comparisons = report.basic.semanticBlockVisuals;
  if (!comparisons) {
    return "";
  }
  const failures = comparisons.filter(
    (comparison) => comparison.status === "failed",
  );
  const rows = (failures.length > 0 ? failures : comparisons.slice(0, 8))
    .map((comparison) => {
      const expectation = comparison.expectation;
      return `<tr><td>${expectation.index + 1}</td><td>${escapeHtml(expectation.section)}</td><td>${escapeHtml(expectation.role)}</td><td>${escapeHtml(comparison.baselineFontFamilies.join(", ") || "未识别")}</td><td>${escapeHtml(comparison.candidateFontFamilies.join(", ") || "未识别")}</td><td>${comparison.lines.length}</td><td>${escapeHtml(comparison.issues.map((issue) => issue.code).join(", ") || "通过")}</td></tr>`;
    })
    .join("");
  return `<div class="semantic-block-visuals">
    <h2>正文语义块局部视觉 <span class="status ${failures.length > 0 ? "failed" : "passed"}">${failures.length > 0 ? "failed" : "passed"}</span></h2>
    <p>正文语义块 ${comparisons.length} 个，失败 ${failures.length} 个；块按内容顺序匹配，局部栅格参与硬门禁，物理页号不参与。PDF.js 字体分类仅作诊断，真实字体解析由独立字体门禁判定。</p>
    <table><thead><tr><th>块</th><th>分节</th><th>角色</th><th>基线字体分类</th><th>候选字体分类</th><th>局部行</th><th>结果</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}

function renderParagraphLayouts(report: PdfVisualDiffReport): string {
  const paragraphs = report.basic.paragraphLayouts;
  if (!paragraphs) {
    return "";
  }
  const failures = paragraphs.filter(
    (paragraph) => paragraph.status === "failed",
  );
  const rows = (failures.length > 0 ? failures : paragraphs.slice(0, 8))
    .map((paragraph) => {
      const expectation = paragraph.expectation;
      return `<tr><td>${expectation.index + 1}</td><td>${escapeHtml(expectation.section)}</td><td>${escapeHtml(expectation.blockKind ?? expectation.role)}</td><td>${escapeHtml(expectation.styleId ?? "—")}</td><td>${paragraph.baseline.lineCount}</td><td>${paragraph.candidate.lineCount}</td><td>${escapeHtml(paragraph.issues.map((issue) => issue.code).join(", ") || "通过")}</td></tr>`;
    })
    .join("");
  return `<div class="paragraph-layouts">
    <h2>内容感知行版式 <span class="status ${failures.length > 0 ? "failed" : "passed"}">${failures.length > 0 ? "failed" : "passed"}</span></h2>
    <p>段落 ${paragraphs.length} 个，失败 ${failures.length} 个；正文跨页移动不参与失败判定，封面页位置严格校验。</p>
    <table><thead><tr><th>段落</th><th>分节</th><th>角色</th><th>Word 样式</th><th>基线行数</th><th>候选行数</th><th>结果</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}

export function renderPdfVisualDiffHtml(
  report: PdfVisualDiffReport,
): string {
  const editableMetrics =
    report.basic.baselineEditableCoverage === undefined
      ? ""
      : `<p><strong>Chromium 可编辑正文覆盖：</strong>${percentage(report.basic.baselineEditableCoverage)}　<strong>候选可编辑正文相似度：</strong>${percentage(report.basic.candidateEditableSimilarity ?? 0)}　<strong>候选精确匹配：</strong>${report.basic.candidateEditableExact ? "是" : "否"}</p>`;
  const issueRows = report.issues.length
    ? report.issues
        .map(
          (issue) =>
            `<tr><td>${escapeHtml(issue.severity)}</td><td>${escapeHtml(issue.code)}</td><td>${escapeHtml(issue.message)}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="3">没有发现门禁问题。</td></tr>';
  const pages = report.pages
    .map(
      (page, index) => `<section class="page-card">
        <h2>${index + 1}. ${escapeHtml(pageTitle(page))} <span class="status ${page.status}">${page.status}</span></h2>
        ${renderSemantics(page)}
        ${renderMetrics(page)}
        ${renderArtifacts(page)}
      </section>`,
    )
    .join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>PDF 视觉差异报告</title>
  <style>
    :root{font-family:Inter,"Microsoft YaHei",sans-serif;color:#172033;background:#f3f5f8}
    *{box-sizing:border-box}body{margin:0}main{max-width:1500px;margin:auto;padding:28px}
    h1,h2{margin:0 0 16px}h2{font-size:18px}.summary,.page-card{background:#fff;border:1px solid #dfe4ec;border-radius:12px;padding:20px;margin-bottom:20px;box-shadow:0 3px 12px #1720330d}
    .status{display:inline-block;border-radius:999px;padding:4px 10px;font-size:12px;text-transform:uppercase}
    .passed{background:#dff7e8;color:#126636}.warning{background:#fff1c7;color:#805d00}.failed{background:#ffe0e0;color:#9a1b1b}
    .metrics{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:10px;margin-bottom:16px}
    .semantics{margin:0 0 16px;padding:14px;background:#f7f9fc;border-radius:8px}.semantics h3{margin:0 0 10px;font-size:15px}.semantics th{width:90px}
    .metrics div{padding:12px;background:#f7f9fc;border-radius:8px}.metrics span{display:block;color:#667085;font-size:12px}.metrics strong{font-size:20px}
    .side-by-side{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}.unpaired{max-width:720px;margin-top:16px}
    figure{margin:0;min-width:0}figcaption{margin-bottom:8px;color:#475467;font-weight:600}
    img{display:block;width:100%;height:auto;border:1px solid #d0d5dd;background:#fff}
    table{width:100%;border-collapse:collapse}th,td{padding:9px;border-bottom:1px solid #e4e7ec;text-align:left;vertical-align:top}
    .muted{color:#667085}@media(max-width:800px){main{padding:12px}.metrics,.side-by-side{grid-template-columns:1fr}}
  </style>
</head>
<body><main>
  <section class="summary">
    <h1>PDF 视觉差异报告 <span class="status ${report.status}">${report.status}</span></h1>
    <p><strong>基线：</strong>${escapeHtml(report.basic.baseline.label)}　<strong>候选：</strong>${escapeHtml(report.basic.candidate.label)}</p>
    <p><strong>生成时间：</strong>${escapeHtml(report.generatedAt)}　<strong>正文相似度：</strong>${percentage(report.basic.contentSimilarity)}</p>
    ${editableMetrics}
    ${renderParagraphLayouts(report)}
    ${renderSemanticBlockVisuals(report)}
    <table><thead><tr><th>级别</th><th>代码</th><th>说明</th></tr></thead><tbody>${issueRows}</tbody></table>
  </section>
  ${pages}
</main></body></html>`;
}

export function serializePdfVisualDiffJson(
  report: PdfVisualDiffReport,
  indentation = 2,
): string {
  return JSON.stringify(
    report,
    (key, value: unknown) => {
      if (
        key.endsWith("Png") &&
        value instanceof Uint8Array
      ) {
        return { byteLength: value.byteLength };
      }
      return value;
    },
    indentation,
  );
}
