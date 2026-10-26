import { normalizePdfContentText, normalizePdfText } from "./text.js";
import type {
  PdfDocumentSnapshot,
  PdfPageDecorationObservation,
  PdfPageSemanticComparison,
  PdfPageSnapshot,
  VisualDiffIssue,
  VisualHeaderSlotExpectation,
  VisualPageAlignment,
  VisualPageSemanticExpectation,
} from "./types.js";

const DECORATION_VERTICAL_TOLERANCE_PT = 2;

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle];
}

function pageNumberBaselineMedian(
  document: PdfDocumentSnapshot,
): number | undefined {
  return median(
    document.pages.flatMap((page) =>
      page.lines
        .filter((line) => {
          const middle = line.bounds.y + line.bounds.height / 2;
          return (
            line.role === "page-number" && middle >= page.heightPt * 0.85
          );
        })
        .map((line) => line.baselineY),
    ),
  );
}

function lineAlignment(
  page: PdfPageSnapshot,
  x: number,
  width: number,
): VisualPageAlignment {
  const middle = x + width / 2;
  if (middle < page.widthPt * 0.4) {
    return "left";
  }
  if (middle > page.widthPt * 0.6) {
    return "right";
  }
  return "center";
}

function observePageDecorations(
  page: PdfPageSnapshot,
  expectation: VisualPageSemanticExpectation,
): PdfPageDecorationObservation {
  const bottomPageNumber = page.lines.find((line) => {
    const middle = line.bounds.y + line.bounds.height / 2;
    return line.role === "page-number" && middle >= page.heightPt * 0.85;
  });
  const topLines = page.lines.filter(
    (line) =>
      line.bounds.y + line.bounds.height / 2 <= page.heightPt * 0.12
  );
  const topText = topLines
    .map((line) => normalizePdfContentText(line.normalizedText))
    .join("");
  const headerSlots = expectation.headerSlots ?? [];
  const headerLines = topLines.filter((line) => {
    const text = normalizePdfContentText(line.normalizedText);
    return headerSlots.some((slot) =>
      text.includes(normalizePdfContentText(slot.text))
    );
  });
  const matchedHeaderSlots = headerSlots.filter((slot) =>
    topText.includes(normalizePdfContentText(slot.text)),
  );
  const missingHeaderSlots = headerSlots.filter(
    (slot) => !matchedHeaderSlots.includes(slot),
  );
  return {
    ...(bottomPageNumber
      ? {
          pageNumberText: bottomPageNumber.normalizedText,
          pageNumberAlignment: lineAlignment(
            page,
            bottomPageNumber.bounds.x,
            bottomPageNumber.bounds.width,
          ),
          pageNumberBaselineY: bottomPageNumber.baselineY,
        }
      : {}),
    ...(topText ? { headerText: topText } : {}),
    ...(headerLines.length > 0
      ? {
          headerBaselineY:
            headerLines.reduce(
              (sum, line) => sum + line.baselineY,
              0
            ) / headerLines.length,
        }
      : {}),
    matchedHeaderSlots,
    missingHeaderSlots,
  };
}

function compareObservation(
  source: "baseline" | "candidate",
  pageNumber: number,
  expectation: VisualPageSemanticExpectation,
  observation: PdfPageDecorationObservation,
): VisualDiffIssue[] {
  const issues: VisualDiffIssue[] = [];
  const location =
    source === "baseline"
      ? { baselinePageNumber: pageNumber }
      : { candidatePageNumber: pageNumber };
  const sourceLabel = source === "baseline" ? "基线" : "候选";
  const hasHeader = observation.matchedHeaderSlots.length > 0;
  if (hasHeader !== expectation.headerVisible) {
    issues.push({
      code: "HEADER_VISIBILITY_MISMATCH",
      severity: "failure",
      message: `${sourceLabel}物理第 ${pageNumber} 页页眉可见性错误`,
      ...location,
      details: {
        source,
        expectedVisible: expectation.headerVisible,
        actualVisible: hasHeader,
        matchedSlots: observation.matchedHeaderSlots
          .map((slot) => slot.alignment)
          .join(","),
      },
    });
  }
  const hasPageNumber = Boolean(observation.pageNumberText);
  if (hasPageNumber !== expectation.footerVisible) {
    issues.push({
      code: "PAGE_NUMBER_VISIBILITY_MISMATCH",
      severity: "failure",
      message: `${sourceLabel}物理第 ${pageNumber} 页页码可见性错误`,
      ...location,
      details: {
        source,
        expectedVisible: expectation.footerVisible,
        actualVisible: hasPageNumber,
      },
    });
  }
  if (
    expectation.footerVisible &&
    expectation.pageNumberText &&
    observation.pageNumberText &&
    normalizePdfText(observation.pageNumberText) !==
      normalizePdfText(expectation.pageNumberText)
  ) {
    issues.push({
      code: "PAGE_NUMBER_TEXT_MISMATCH",
      severity: "failure",
      message: `${sourceLabel}物理第 ${pageNumber} 页页码文本错误`,
      ...location,
      details: {
        source,
        expected: expectation.pageNumberText,
        actual: observation.pageNumberText,
      },
    });
  }
  if (
    expectation.footerVisible &&
    expectation.footerAlignment &&
    observation.pageNumberAlignment &&
    observation.pageNumberAlignment !== expectation.footerAlignment
  ) {
    issues.push({
      code: "PAGE_NUMBER_ALIGNMENT_MISMATCH",
      severity: "failure",
      message: `${sourceLabel}物理第 ${pageNumber} 页页码位置错误`,
      ...location,
      details: {
        source,
        expected: expectation.footerAlignment,
        actual: observation.pageNumberAlignment,
      },
    });
  }
  for (const slot of expectation.headerVisible
    ? observation.missingHeaderSlots
    : []) {
    issues.push({
      code: "HEADER_TEXT_MISSING",
      severity: "failure",
      message: `${sourceLabel}物理第 ${pageNumber} 页缺少${slot.alignment}页眉文本`,
      ...location,
      details: {
        source,
        alignment: slot.alignment,
        expected: slot.text,
      },
    });
  }
  return issues;
}

function status(issues: readonly VisualDiffIssue[]) {
  return issues.some((issue) => issue.severity === "failure")
    ? ("failed" as const)
    : issues.length > 0
      ? ("warning" as const)
      : ("passed" as const);
}

export function comparePdfPageSemantics(
  baseline: PdfDocumentSnapshot,
  candidate: PdfDocumentSnapshot,
  expectation: VisualPageSemanticExpectation,
  candidateExpectation: VisualPageSemanticExpectation = expectation,
): PdfPageSemanticComparison {
  const baselinePage = baseline.pages[expectation.physicalPageNumber - 1];
  const candidatePage =
    candidate.pages[candidateExpectation.physicalPageNumber - 1];
  const baselineObservation = baselinePage
    ? observePageDecorations(baselinePage, expectation)
    : undefined;
  const candidateObservation = candidatePage
    ? observePageDecorations(candidatePage, candidateExpectation)
    : undefined;
  const issues = [
    ...(baselineObservation
      ? compareObservation(
          "baseline",
          expectation.physicalPageNumber,
          expectation,
          baselineObservation,
        )
      : []),
    ...(candidateObservation
      ? compareObservation(
          "candidate",
          candidateExpectation.physicalPageNumber,
          candidateExpectation,
          candidateObservation,
        )
      : []),
  ];
  if (
    expectation.headerVisible &&
    candidateExpectation.headerVisible &&
    baselineObservation?.headerBaselineY !== undefined &&
    candidateObservation?.headerBaselineY !== undefined
  ) {
    const deltaPt = Math.abs(
      baselineObservation.headerBaselineY -
        candidateObservation.headerBaselineY
    );
    if (deltaPt > DECORATION_VERTICAL_TOLERANCE_PT) {
      issues.push({
        code: "HEADER_VERTICAL_POSITION_MISMATCH",
        severity: "failure",
        message: `物理第 ${expectation.physicalPageNumber} 页页眉纵向位置偏差 ${deltaPt.toFixed(2)}pt 超过 ${DECORATION_VERTICAL_TOLERANCE_PT}pt`,
        baselinePageNumber: expectation.physicalPageNumber,
        candidatePageNumber: expectation.physicalPageNumber,
        details: {
          deltaPt,
          tolerancePt: DECORATION_VERTICAL_TOLERANCE_PT,
          baselineY: baselineObservation.headerBaselineY,
          candidateY: candidateObservation.headerBaselineY,
        },
      });
    }
  }
  if (
    expectation.footerVisible &&
    candidateExpectation.footerVisible &&
    baselineObservation?.pageNumberBaselineY !== undefined &&
    candidateObservation?.pageNumberBaselineY !== undefined
  ) {
    const baselineMedianY = pageNumberBaselineMedian(baseline);
    const candidateMedianY = pageNumberBaselineMedian(candidate);
    const documentAnchorDeltaPt =
      baselineMedianY === undefined || candidateMedianY === undefined
        ? Math.abs(
            baselineObservation.pageNumberBaselineY -
              candidateObservation.pageNumberBaselineY,
          )
        : Math.abs(baselineMedianY - candidateMedianY);
    const pageRelativeDeltaPt =
      baselineMedianY === undefined || candidateMedianY === undefined
        ? 0
        : Math.abs(
            baselineObservation.pageNumberBaselineY - baselineMedianY -
              (candidateObservation.pageNumberBaselineY - candidateMedianY),
          );
    const deltaPt = Math.max(documentAnchorDeltaPt, pageRelativeDeltaPt);
    if (deltaPt > DECORATION_VERTICAL_TOLERANCE_PT) {
      issues.push({
        code: "PAGE_NUMBER_VERTICAL_POSITION_MISMATCH",
        severity: "failure",
        message: `物理第 ${expectation.physicalPageNumber} 页页码纵向位置偏差 ${deltaPt.toFixed(2)}pt 超过 ${DECORATION_VERTICAL_TOLERANCE_PT}pt`,
        baselinePageNumber: expectation.physicalPageNumber,
        candidatePageNumber: expectation.physicalPageNumber,
        details: {
          deltaPt,
          tolerancePt: DECORATION_VERTICAL_TOLERANCE_PT,
          baselineY: baselineObservation.pageNumberBaselineY,
          candidateY: candidateObservation.pageNumberBaselineY,
          baselineMedianY: baselineMedianY ?? -1,
          candidateMedianY: candidateMedianY ?? -1,
          documentAnchorDeltaPt,
          pageRelativeDeltaPt,
        },
      });
    }
  }
  return {
    expectation,
    ...(candidateExpectation === expectation
      ? {}
      : { candidateExpectation }),
    ...(baselineObservation ? { baseline: baselineObservation } : {}),
    ...(candidateObservation ? { candidate: candidateObservation } : {}),
    status: status(issues),
    issues,
  };
}
