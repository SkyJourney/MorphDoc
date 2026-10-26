export type PdfSourceKind = "chromium" | "word" | "wps" | "custom";

export interface PdfSnapshotSource {
  kind: PdfSourceKind;
  label: string;
  fileName?: string;
}

export interface PdfPointBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfTextItemSnapshot {
  text: string;
  normalizedText: string;
  bounds: PdfPointBounds;
  baselineY: number;
  fontName?: string;
  fontFamily?: string;
  fallbackFontFamily?: string;
  hasEol: boolean;
}

export interface PdfFontSnapshot {
  internalName: string;
  name: string;
  fallbackFamily?: string;
  isType3Font: boolean;
  missingFile: boolean;
}

export type PdfTextLineRole = "content" | "page-number";

export interface PdfTextLineSnapshot {
  text: string;
  normalizedText: string;
  bounds: PdfPointBounds;
  baselineY: number;
  role: PdfTextLineRole;
  items: PdfTextItemSnapshot[];
}

export interface PdfEditableContentLine {
  pageNumber: number;
  line: PdfTextLineSnapshot;
  normalizedText: string;
}

export type EditableParagraphRole =
  | "body"
  | "heading"
  | "title"
  | "caption"
  | "other";

export type EditableParagraphBlockKind =
  | "paragraph"
  | "heading"
  | "list-item"
  | "table-header"
  | "table-cell"
  | "code-block"
  | "block-quote"
  | "caption"
  | "semantic-region"
  | "other";

export interface EditableParagraphExpectation {
  index: number;
  text: string;
  mathCharacterIndexes?: number[];
  hardBreakSegments?: string[];
  hasInlineCode?: boolean;
  tableGroupId?: string;
  tableRowIndex?: number;
  tableColumnIndex?: number;
  styleId?: string;
  role: EditableParagraphRole;
  blockKind?: EditableParagraphBlockKind;
  section: "cover" | "body";
}

export interface PdfParagraphLayoutObservation {
  matched: boolean;
  matchedCharacterCount: number;
  expectedCharacterCount: number;
  pageNumbers: number[];
  lineCount: number;
  lineTexts: string[];
  lineBreakOffsets: number[];
  firstLineXPt?: number;
  firstLineBaselineYPt?: number;
  maximumLineWidthPt?: number;
  averageLineHeightPt?: number;
  averageBaselineGapPt?: number;
  exclusiveGeometry: boolean;
  visualLines: PdfParagraphVisualLineObservation[];
}

export interface PdfParagraphVisualLineObservation {
  pageNumber: number;
  bounds: PdfPointBounds;
  fontFamilies: string[];
}

export interface PdfParagraphLayoutComparison {
  expectation: EditableParagraphExpectation;
  baseline: PdfParagraphLayoutObservation;
  candidate: PdfParagraphLayoutObservation;
  status: "passed" | "warning" | "failed";
  issues: VisualDiffIssue[];
}

export interface PdfSemanticBlockVisualLineComparison {
  lineIndex: number;
  baselinePageNumber: number;
  candidatePageNumber: number;
  metrics?: PdfRasterDiffMetrics;
  artifacts?: PdfRasterDiffArtifacts;
  issues: VisualDiffIssue[];
}

export interface PdfSemanticBlockVisualComparison {
  expectation: EditableParagraphExpectation;
  status: "passed" | "warning" | "failed";
  baselineFontFamilies: string[];
  candidateFontFamilies: string[];
  lines: PdfSemanticBlockVisualLineComparison[];
  issues: VisualDiffIssue[];
}

export interface PdfBodyFlowComparison {
  detected: boolean;
  legal: boolean;
  baselineCoverPageCount: number;
  candidateCoverPageCount: number;
  baselineBodyPageCount: number;
  candidateBodyPageCount: number;
  movedParagraphIndexes: number[];
  affectedBaselinePageNumbers: number[];
  affectedCandidatePageNumbers: number[];
}

export interface PdfPageRaster {
  widthPx: number;
  heightPx: number;
  dpi: number;
  sha256: string;
  png: Uint8Array;
  rgba?: Uint8ClampedArray;
}

export interface PdfPageSnapshot {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  rotation: number;
  items: PdfTextItemSnapshot[];
  lines: PdfTextLineSnapshot[];
  contentText: string;
  fonts: PdfFontSnapshot[];
  pageNumberText?: string;
  raster?: PdfPageRaster;
}

export interface PdfDocumentSnapshot {
  schemaVersion: 1;
  source: PdfSnapshotSource;
  sha256: string;
  pageCount: number;
  contentText: string;
  fonts: PdfFontSnapshot[];
  pages: PdfPageSnapshot[];
}

export interface PdfSnapshotLimits {
  maxPdfBytes: number;
  maxPages: number;
  maxPagePixels: number;
  maxTotalPixels: number;
}

export interface CreatePdfSnapshotOptions {
  source: PdfSnapshotSource;
  dpi?: number;
  includeRaster?: boolean;
  limits?: Partial<PdfSnapshotLimits>;
}

export interface VisualDiffThresholds {
  pageSizeDeltaPt: number;
  contentSimilarity: number;
  strictPageCount: boolean;
  pixelDifferenceThreshold: number;
  spatialTolerancePx: number;
  maxMeanAbsoluteError: number;
  maxChangedPixelRatio: number;
  minInkIou: number;
  minEdgeIou: number;
  maxBackgroundColorDelta: number;
  maxForegroundColorDelta: number;
  minAntialiasEquivalentInkIou: number;
  minAntialiasEquivalentEdgeIou: number;
}

export type VisualDiffIssueSeverity = "warning" | "failure";

export type VisualDiffIssueCode =
  | "PAGE_COUNT_MISMATCH"
  | "UNPAIRED_BASELINE_PAGE"
  | "UNPAIRED_CANDIDATE_PAGE"
  | "PAGE_SIZE_MISMATCH"
  | "PAGE_ORIENTATION_MISMATCH"
  | "CONTENT_MISMATCH"
  | "RASTER_MISSING"
  | "RASTER_SIZE_MISMATCH"
  | "PIXEL_MAE_EXCEEDED"
  | "CHANGED_PIXEL_RATIO_EXCEEDED"
  | "INK_IOU_BELOW_THRESHOLD"
  | "EDGE_IOU_BELOW_THRESHOLD"
  | "PAGE_NUMBER_VISIBILITY_MISMATCH"
  | "PAGE_NUMBER_TEXT_MISMATCH"
  | "PAGE_NUMBER_ALIGNMENT_MISMATCH"
  | "PAGE_NUMBER_VERTICAL_POSITION_MISMATCH"
  | "HEADER_VISIBILITY_MISMATCH"
  | "HEADER_TEXT_MISSING"
  | "HEADER_VERTICAL_POSITION_MISMATCH"
  | "EDITABLE_PARAGRAPH_MAPPING_MISMATCH"
  | "TEXT_BLOCK_LINE_COUNT_MISMATCH"
  | "BODY_LINE_COUNT_NEAR_BOUNDARY"
  | "PARAGRAPH_LINE_BREAK_MISMATCH"
  | "PARAGRAPH_LINE_GEOMETRY_MISMATCH"
  | "SEMANTIC_BLOCK_VISUAL_UNAVAILABLE"
  | "SEMANTIC_BLOCK_RASTER_MISMATCH"
  | "COVER_LAYOUT_MISMATCH"
  | "BODY_FLOW_PAGE_COUNT_DIFFERENCE"
  | "BODY_FLOW_RASTER_DIFFERENCE"
  | "BODY_PAGE_RASTER_DIFFERENCE";

export interface VisualDiffIssue {
  code: VisualDiffIssueCode;
  severity: VisualDiffIssueSeverity;
  message: string;
  baselinePageNumber?: number;
  candidatePageNumber?: number;
  details?: Record<string, number | string | boolean>;
}

export type PdfPagePair =
  | {
      baselinePageNumber: number;
      candidatePageNumber: number;
      status: "paired";
    }
  | {
      baselinePageNumber: number;
      status: "baseline-only";
    }
  | {
      candidatePageNumber: number;
      status: "candidate-only";
    };

export interface PdfBasicComparison {
  schemaVersion: 1;
  status: "passed" | "warning" | "failed";
  baseline: PdfSnapshotSource;
  candidate: PdfSnapshotSource;
  thresholds: VisualDiffThresholds;
  contentSimilarity: number;
  baselineEditableCoverage?: number;
  candidateEditableSimilarity?: number;
  candidateEditableExact?: boolean;
  paragraphLayouts?: PdfParagraphLayoutComparison[];
  semanticBlockVisuals?: PdfSemanticBlockVisualComparison[];
  bodyFlow?: PdfBodyFlowComparison;
  pagePairs: PdfPagePair[];
  issues: VisualDiffIssue[];
}

export interface PdfRasterDiffMetrics {
  baselineWidthPx: number;
  baselineHeightPx: number;
  candidateWidthPx: number;
  candidateHeightPx: number;
  comparedWidthPx: number;
  comparedHeightPx: number;
  dimensionsMatch: boolean;
  geometryNormalized: boolean;
  spatialTolerancePx: number;
  meanAbsoluteError: number;
  changedPixelRatio: number;
  inkIou: number;
  foregroundInkIou: number;
  edgeIou: number;
  backgroundColorDelta: number;
  foregroundColorDelta: number;
  baselineForegroundChroma?: number;
  candidateForegroundChroma?: number;
  foregroundLuminanceDelta?: number;
  dominantForegroundColorDelta?: number;
  chromaticForegroundColorDelta?: number;
  chromaticPaletteDelta?: number;
}

export interface ComparePageRasterOptions {
  pixelDifferenceThreshold?: number;
  spatialTolerancePx?: number;
  targetWidthPx?: number;
  targetHeightPx?: number;
  geometryNormalized?: boolean;
}

export interface PdfRasterDiffArtifacts {
  baselinePng: Uint8Array;
  candidatePng: Uint8Array;
  overlayPng: Uint8Array;
  heatmapPng: Uint8Array;
  baselineSha256: string;
  candidateSha256: string;
  overlaySha256: string;
  heatmapSha256: string;
}

export interface PdfRasterDiffResult {
  metrics: PdfRasterDiffMetrics;
  artifacts: PdfRasterDiffArtifacts;
}

export interface PdfVisualPageComparison {
  pair: PdfPagePair;
  rasterComparisonMode?: "strict" | "body-flow" | "body-block";
  status: "passed" | "warning" | "failed";
  metrics?: PdfRasterDiffMetrics;
  artifacts?: PdfRasterDiffArtifacts;
  unpairedPng?: Uint8Array;
  unpairedSha256?: string;
  semantics?: PdfPageSemanticComparison;
  issues: VisualDiffIssue[];
}

export type VisualPageKind = "cover" | "body-first" | "body-rest";
export type VisualPageAlignment = "left" | "center" | "right";

export interface VisualHeaderSlotExpectation {
  alignment: VisualPageAlignment;
  text: string;
}

export interface VisualPageSemanticExpectation {
  physicalPageNumber: number;
  kind: VisualPageKind;
  logicalPageNumber?: number;
  logicalPageCount: number;
  headerVisible: boolean;
  headerSlots?: VisualHeaderSlotExpectation[];
  footerVisible: boolean;
  footerAlignment?: VisualPageAlignment;
  pageNumberText?: string;
}

export interface PdfPageDecorationObservation {
  pageNumberText?: string;
  pageNumberAlignment?: VisualPageAlignment;
  pageNumberBaselineY?: number;
  headerText?: string;
  headerBaselineY?: number;
  matchedHeaderSlots: VisualHeaderSlotExpectation[];
  missingHeaderSlots: VisualHeaderSlotExpectation[];
}

export interface PdfPageSemanticComparison {
  expectation: VisualPageSemanticExpectation;
  candidateExpectation?: VisualPageSemanticExpectation;
  baseline?: PdfPageDecorationObservation;
  candidate?: PdfPageDecorationObservation;
  status: "passed" | "warning" | "failed";
  issues: VisualDiffIssue[];
}

export interface PdfVisualDiffReport {
  schemaVersion: 1;
  generatedAt: string;
  status: "passed" | "warning" | "failed";
  basic: PdfBasicComparison;
  pages: PdfVisualPageComparison[];
  issues: VisualDiffIssue[];
}

export interface CreatePdfVisualDiffOptions {
  thresholds?: Partial<VisualDiffThresholds>;
  generatedAt?: string;
  pageSemantics?: readonly VisualPageSemanticExpectation[];
  baselinePageSemantics?: readonly VisualPageSemanticExpectation[];
  candidatePageSemantics?: readonly VisualPageSemanticExpectation[];
  expectedEditableText?: string;
  expectedEditableParagraphs?: readonly EditableParagraphExpectation[];
}

export interface PdfEditableContentComparisonOptions {
  expectedEditableText?: string;
  pageSemantics?: readonly VisualPageSemanticExpectation[];
  baselinePageSemantics?: readonly VisualPageSemanticExpectation[];
  candidatePageSemantics?: readonly VisualPageSemanticExpectation[];
  expectedEditableParagraphs?: readonly EditableParagraphExpectation[];
}
