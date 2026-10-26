import {
  buildPdfEditableContentText,
  normalizePdfContentText,
  normalizePdfEditableText,
} from "./text.js";
import { comparePdfEditableParagraphLayouts } from "./paragraph-layout.js";
import { comparePdfPageSemantics } from "./page-semantics.js";
import type {
  PdfEditableContentComparisonOptions,
  PdfBasicComparison,
  PdfDocumentSnapshot,
  PdfPagePair,
  VisualDiffIssue,
  VisualDiffThresholds,
} from "./types.js";

export const DEFAULT_VISUAL_DIFF_THRESHOLDS: VisualDiffThresholds = {
  pageSizeDeltaPt: 0.6,
  contentSimilarity: 0.999,
  strictPageCount: true,
  pixelDifferenceThreshold: 8,
  spatialTolerancePx: 4,
  maxMeanAbsoluteError: 8,
  maxChangedPixelRatio: 0.06,
    minInkIou: 0.64,
    minEdgeIou: 0.6,
    maxBackgroundColorDelta: 12,
    maxForegroundColorDelta: 12,
  minAntialiasEquivalentInkIou: 0.98,
  minAntialiasEquivalentEdgeIou: 0.98,
};

function cappedLevenshteinDistance(
  left: string,
  right: string,
  cap: number,
): number {
  if (left === right) {
    return 0;
  }
  if (Math.abs(left.length - right.length) > cap) {
    return cap + 1;
  }
  let previous = new Int32Array(right.length + 1);
  let current = new Int32Array(right.length + 1);
  for (let column = 0; column <= right.length; column += 1) {
    previous[column] = column;
  }
  for (let row = 1; row <= left.length; row += 1) {
    current.fill(cap + 1);
    current[0] = row;
    const start = Math.max(1, row - cap);
    const end = Math.min(right.length, row + cap);
    let rowMinimum = cap + 1;
    for (let column = start; column <= end; column += 1) {
      const substitutionCost =
        left.charCodeAt(row - 1) === right.charCodeAt(column - 1) ? 0 : 1;
      const value = Math.min(
        (previous[column] ?? cap + 1) + 1,
        (current[column - 1] ?? cap + 1) + 1,
        (previous[column - 1] ?? cap + 1) + substitutionCost,
      );
      current[column] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > cap) {
      return cap + 1;
    }
    [previous, current] = [current, previous];
  }
  return Math.min(previous[right.length] ?? cap + 1, cap + 1);
}

export function calculateContentSimilarity(
  leftInput: string,
  rightInput: string,
  requiredSimilarity = DEFAULT_VISUAL_DIFF_THRESHOLDS.contentSimilarity,
): number {
  const left = normalizePdfContentText(leftInput);
  const right = normalizePdfContentText(rightInput);
  const maximumLength = Math.max(left.length, right.length);
  if (maximumLength === 0) {
    return 1;
  }
  const cap = Math.max(
    1,
    Math.ceil(maximumLength * (1 - requiredSimilarity)),
  );
  const distance = cappedLevenshteinDistance(left, right, cap);
  return Math.max(0, 1 - distance / maximumLength);
}

export function calculateOrderedContentCoverage(
  expectedInput: string,
  actualInput: string,
): number {
  const expected = normalizePdfEditableText(expectedInput);
  const actual = normalizePdfEditableText(actualInput);
  if (expected.length === 0) {
    return 1;
  }
  let matched = 0;
  for (const character of actual) {
    if (character === expected[matched]) {
      matched += 1;
      if (matched === expected.length) {
        break;
      }
    }
  }
  return matched / expected.length;
}

function createPagePairs(
  baseline: PdfDocumentSnapshot,
  candidate: PdfDocumentSnapshot,
): PdfPagePair[] {
  const pairCount = Math.max(baseline.pageCount, candidate.pageCount);
  return Array.from({ length: pairCount }, (_, index) => {
    const baselinePageNumber =
      index < baseline.pageCount ? index + 1 : undefined;
    const candidatePageNumber =
      index < candidate.pageCount ? index + 1 : undefined;
    if (baselinePageNumber === undefined) {
      if (candidatePageNumber === undefined) {
        throw new Error("页面配对状态无效");
      }
      return {
        candidatePageNumber,
        status: "candidate-only" as const,
      };
    }
    if (candidatePageNumber === undefined) {
      return {
        baselinePageNumber,
        status: "baseline-only" as const,
      };
    }
    return {
      baselinePageNumber,
      candidatePageNumber,
      status: "paired" as const,
    };
  });
}

function pageNumbersEqual(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function coverPageCount(
  semantics: readonly { kind: string }[],
): number {
  return semantics.filter((page) => page.kind === "cover").length;
}

function bodyPageNumbers(pageCount: number, coverCount: number): number[] {
  return Array.from(
    { length: Math.max(0, pageCount - coverCount) },
    (_, index) => coverCount + index + 1,
  );
}

export function comparePdfSnapshotsBasic(
  baseline: PdfDocumentSnapshot,
  candidate: PdfDocumentSnapshot,
  thresholdOverrides: Partial<VisualDiffThresholds> = {},
  contentOptions: PdfEditableContentComparisonOptions = {},
): PdfBasicComparison {
  const thresholds = {
    ...DEFAULT_VISUAL_DIFF_THRESHOLDS,
    ...thresholdOverrides,
  };
  const issues: VisualDiffIssue[] = [];
  const pagePairs = createPagePairs(baseline, candidate);
  const baselinePageSemantics =
    contentOptions.baselinePageSemantics ?? contentOptions.pageSemantics ?? [];
  const candidatePageSemantics =
    contentOptions.candidatePageSemantics ?? contentOptions.pageSemantics ?? [];

  if (baseline.pageCount !== candidate.pageCount) {
    issues.push({
      code: "PAGE_COUNT_MISMATCH",
      severity: thresholds.strictPageCount ? "failure" : "warning",
      message: `页数不一致：基线 ${baseline.pageCount} 页，候选 ${candidate.pageCount} 页`,
      details: {
        baselinePageCount: baseline.pageCount,
        candidatePageCount: candidate.pageCount,
      },
    });
  }

  for (const pair of pagePairs) {
    if (pair.status === "baseline-only") {
      issues.push({
        code: "UNPAIRED_BASELINE_PAGE",
        severity: "failure",
        message: `基线第 ${pair.baselinePageNumber} 页没有候选配对页`,
        baselinePageNumber: pair.baselinePageNumber,
      });
      continue;
    }
    if (pair.status === "candidate-only") {
      issues.push({
        code: "UNPAIRED_CANDIDATE_PAGE",
        severity: "failure",
        message: `候选第 ${pair.candidatePageNumber} 页为溢出页`,
        candidatePageNumber: pair.candidatePageNumber,
      });
      continue;
    }
    const baselinePage = baseline.pages[pair.baselinePageNumber - 1];
    const candidatePage = candidate.pages[pair.candidatePageNumber - 1];
    if (!baselinePage || !candidatePage) {
      continue;
    }
    const widthDelta = Math.abs(
      baselinePage.widthPt - candidatePage.widthPt,
    );
    const heightDelta = Math.abs(
      baselinePage.heightPt - candidatePage.heightPt,
    );
    if (
      widthDelta > thresholds.pageSizeDeltaPt ||
      heightDelta > thresholds.pageSizeDeltaPt
    ) {
      issues.push({
        code: "PAGE_SIZE_MISMATCH",
        severity: "failure",
        message: `第 ${pair.baselinePageNumber} 页纸张尺寸偏差超限`,
        baselinePageNumber: pair.baselinePageNumber,
        candidatePageNumber: pair.candidatePageNumber,
        details: { widthDeltaPt: widthDelta, heightDeltaPt: heightDelta },
      });
    }
    const baselineLandscape =
      baselinePage.widthPt > baselinePage.heightPt;
    const candidateLandscape =
      candidatePage.widthPt > candidatePage.heightPt;
    if (baselineLandscape !== candidateLandscape) {
      issues.push({
        code: "PAGE_ORIENTATION_MISMATCH",
        severity: "failure",
        message: `第 ${pair.baselinePageNumber} 页方向不一致`,
        baselinePageNumber: pair.baselinePageNumber,
        candidatePageNumber: pair.candidatePageNumber,
      });
    }
  }

  const hasEditableExpectation =
    contentOptions.expectedEditableText !== undefined;
  const expectedEditableText = normalizePdfEditableText(
    contentOptions.expectedEditableText ?? "",
  );
  const baselineEditableText = hasEditableExpectation
    ? buildPdfEditableContentText(baseline, baselinePageSemantics)
    : "";
  const candidateEditableText = hasEditableExpectation
    ? buildPdfEditableContentText(candidate, candidatePageSemantics)
    : "";
  const paragraphLayouts = contentOptions.expectedEditableParagraphs
    ? comparePdfEditableParagraphLayouts(
        baseline,
        candidate,
        contentOptions.expectedEditableParagraphs,
        baselinePageSemantics,
        candidatePageSemantics,
      )
    : undefined;
  const paragraphContentExact =
    paragraphLayouts !== undefined &&
    paragraphLayouts.length === contentOptions.expectedEditableParagraphs?.length &&
    paragraphLayouts.every(
      (paragraph) => paragraph.baseline.matched && paragraph.candidate.matched,
    );
  const baselineParagraphContentExact =
    paragraphLayouts !== undefined &&
    paragraphLayouts.length === contentOptions.expectedEditableParagraphs?.length &&
    paragraphLayouts.every((paragraph) => paragraph.baseline.matched);
  const baselineEditableCoverage = hasEditableExpectation
    ? baselineParagraphContentExact
      ? 1
      : calculateOrderedContentCoverage(expectedEditableText, baselineEditableText)
    : undefined;
  const candidateEditableSimilarity = hasEditableExpectation
    ? calculateContentSimilarity(
        expectedEditableText,
        candidateEditableText,
        thresholds.contentSimilarity,
      )
    : undefined;
  const candidateEditableExact = hasEditableExpectation
    ? candidateEditableText === expectedEditableText || paragraphContentExact
    : undefined;
  const contentSimilarity = hasEditableExpectation
    ? Math.min(
        baselineEditableCoverage ?? 0,
        candidateEditableSimilarity ?? 0,
      )
    : calculateContentSimilarity(
        baseline.contentText,
        candidate.contentText,
        thresholds.contentSimilarity,
      );
  const contentMismatch = hasEditableExpectation
    ? baselineEditableCoverage !== 1 || candidateEditableExact !== true
    : contentSimilarity < thresholds.contentSimilarity;
  if (contentMismatch) {
    issues.push({
      code: "CONTENT_MISMATCH",
      severity: "failure",
      message: hasEditableExpectation
        ? `可编辑正文门禁失败：Chromium 有序覆盖 ${((baselineEditableCoverage ?? 0) * 100).toFixed(3)}%，候选相似度 ${((candidateEditableSimilarity ?? 0) * 100).toFixed(3)}%，候选精确匹配 ${candidateEditableExact ? "是" : "否"}`
        : `正文文本相似度 ${(contentSimilarity * 100).toFixed(3)}% 低于门限 ${(thresholds.contentSimilarity * 100).toFixed(3)}%`,
      details: hasEditableExpectation
        ? {
            baselineEditableCoverage: baselineEditableCoverage ?? 0,
            candidateEditableSimilarity: candidateEditableSimilarity ?? 0,
            candidateEditableExact: candidateEditableExact ?? false,
          }
        : { contentSimilarity },
    });
  }

  if (paragraphLayouts) {
    issues.push(...paragraphLayouts.flatMap((paragraph) => paragraph.issues));
  }

  const baselineCoverPageCount = coverPageCount(baselinePageSemantics);
  const candidateCoverPageCount = coverPageCount(candidatePageSemantics);
  const baselineBodyPageCount = baseline.pageCount - baselineCoverPageCount;
  const candidateBodyPageCount = candidate.pageCount - candidateCoverPageCount;
  const movedParagraphs = (paragraphLayouts ?? []).filter(
    (paragraph) =>
      paragraph.expectation.section === "body" &&
      !pageNumbersEqual(
        paragraph.baseline.pageNumbers,
        paragraph.candidate.pageNumbers,
      ),
  );
  const bodyPageCountChanged = baselineBodyPageCount !== candidateBodyPageCount;
  const bodyFlowDetected = movedParagraphs.length > 0 || bodyPageCountChanged;
  const affectedBaselinePageNumbers = bodyPageCountChanged
    ? bodyPageNumbers(baseline.pageCount, baselineCoverPageCount)
    : [...new Set(movedParagraphs.flatMap((item) => item.baseline.pageNumbers))]
        .sort((left, right) => left - right);
  const affectedCandidatePageNumbers = bodyPageCountChanged
    ? bodyPageNumbers(candidate.pageCount, candidateCoverPageCount)
    : [...new Set(movedParagraphs.flatMap((item) => item.candidate.pageNumbers))]
        .sort((left, right) => left - right);
  const hasStructuralPageFailure = issues.some((issue) =>
    issue.code === "PAGE_SIZE_MISMATCH" ||
    issue.code === "PAGE_ORIENTATION_MISMATCH"
  );
  const hasCompletePageSemantics =
    baselinePageSemantics.length === baseline.pageCount &&
    candidatePageSemantics.length === candidate.pageCount;
  const pageSemanticsPassed =
    hasCompletePageSemantics &&
    pagePairs.every((pair) => {
      const baselineExpectation =
        pair.status === "candidate-only"
          ? undefined
          : baselinePageSemantics.find(
              (item) =>
                item.physicalPageNumber === pair.baselinePageNumber,
            );
      const candidateExpectation =
        pair.status === "baseline-only"
          ? undefined
          : candidatePageSemantics.find(
              (item) =>
                item.physicalPageNumber === pair.candidatePageNumber,
            );
      const primaryExpectation =
        baselineExpectation ?? candidateExpectation;
      if (!primaryExpectation) {
        return false;
      }
      if (pair.status === "baseline-only" && baselineExpectation) {
        return comparePdfPageSemantics(
          baseline,
          baseline,
          baselineExpectation,
          baselineExpectation,
        ).status === "passed";
      }
      if (pair.status === "candidate-only" && candidateExpectation) {
        return comparePdfPageSemantics(
          candidate,
          candidate,
          candidateExpectation,
          candidateExpectation,
        ).status === "passed";
      }
      return comparePdfPageSemantics(
        baseline,
        candidate,
        primaryExpectation,
        candidateExpectation ?? primaryExpectation,
      ).status === "passed";
    });
  const bodyFlowLegal =
    bodyFlowDetected &&
    paragraphLayouts !== undefined &&
    paragraphLayouts.every((paragraph) => paragraph.status !== "failed") &&
    baselineEditableCoverage === 1 &&
    candidateEditableExact === true &&
    baselineCoverPageCount === candidateCoverPageCount &&
    !hasStructuralPageFailure &&
    pageSemanticsPassed;
  const bodyFlow = paragraphLayouts
    ? {
        detected: bodyFlowDetected,
        legal: bodyFlowLegal,
        baselineCoverPageCount,
        candidateCoverPageCount,
        baselineBodyPageCount,
        candidateBodyPageCount,
        movedParagraphIndexes: movedParagraphs.map(
          (paragraph) => paragraph.expectation.index,
        ),
        affectedBaselinePageNumbers,
        affectedCandidatePageNumbers,
      }
    : undefined;

  if (bodyFlowLegal && bodyPageCountChanged) {
    for (let index = issues.length - 1; index >= 0; index -= 1) {
      const issue = issues[index];
      if (
        issue?.code === "PAGE_COUNT_MISMATCH" ||
        issue?.code === "UNPAIRED_BASELINE_PAGE" ||
        issue?.code === "UNPAIRED_CANDIDATE_PAGE"
      ) {
        issues.splice(index, 1);
      }
    }
    issues.push({
      code: "BODY_FLOW_PAGE_COUNT_DIFFERENCE",
      severity: "warning",
      message: `正文自然分页导致页数不同：基线 ${baselineBodyPageCount} 页，候选 ${candidateBodyPageCount} 页`,
      details: {
        baselineBodyPageCount,
        candidateBodyPageCount,
      },
    });
  }

  const status = issues.some((issue) => issue.severity === "failure")
    ? "failed"
    : issues.length > 0
      ? "warning"
      : "passed";
  return {
    schemaVersion: 1,
    status,
    baseline: baseline.source,
    candidate: candidate.source,
    thresholds,
    contentSimilarity,
    ...(baselineEditableCoverage === undefined
      ? {}
      : { baselineEditableCoverage }),
    ...(candidateEditableSimilarity === undefined
      ? {}
      : { candidateEditableSimilarity }),
    ...(candidateEditableExact === undefined
      ? {}
      : { candidateEditableExact }),
    ...(paragraphLayouts === undefined ? {} : { paragraphLayouts }),
    ...(bodyFlow === undefined ? {} : { bodyFlow }),
    pagePairs,
    issues,
  };
}
