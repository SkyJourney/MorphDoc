import path from "node:path";
import { MAXIMUM_DOCX_OUTPUT_BYTES } from "@morphdoc/core";
import {
  OFFICE_RELATIONSHIP_NAMESPACE,
  PACKAGE_RELATIONSHIP_NAMESPACE,
  WORD_NAMESPACE,
  firstDirectChild,
  parseXmlPart,
  type XmlElement
} from "./ooxml.js";
import {
  MAXIMUM_GENERATED_DOCX_ENTRY_COUNT,
  MAXIMUM_GENERATED_DOCX_UNCOMPRESSED_BYTES,
  readDocxPackage
} from "./reference-package.js";
import {
  validateGeneratedDocx,
  type DynamicReferenceValidation
} from "./validator.js";
import {
  inspectDocxPageDecorations,
  type DocxPageDecorationAcceptanceReport,
  type DocxPageDecorationExpectation
} from "./page-decoration-acceptance.js";
import {
  inspectDocxMediaAcceptance,
  type DocxMediaAcceptanceExpectation,
  type DocxMediaAcceptanceReport
} from "./media-acceptance.js";

const OFFICE_MATH_NAMESPACE =
  "http://schemas.openxmlformats.org/officeDocument/2006/math";
const WORDPROCESSING_DRAWING_NAMESPACE =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const IMAGE_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const HYPERLINK_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const PNG_SIGNATURE = Uint8Array.of(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a
);

export interface DocxAcceptancePageExpectation {
  widthTwips: number;
  heightTwips: number;
  orientation: "portrait" | "landscape";
  marginsTwips: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

export interface DocxAcceptanceExpectation {
  id: string;
  page: DocxAcceptancePageExpectation;
  requiredText: readonly string[];
  requiredFootnoteText?: readonly string[];
  minimumParagraphs?: number;
  minimumTextRuns?: number;
  minimumTables?: number;
  minimumNumberedParagraphs?: number;
  minimumHyperlinks?: number;
  minimumFootnoteReferences?: number;
  minimumMathObjects?: number;
  minimumDrawings?: number;
  minimumPngImages?: number;
  requiredImageAltText?: readonly string[];
  requiredStyleIds?: readonly string[];
  requiredParagraphStyleIds?: readonly string[];
  requirePageField?: boolean;
  minimumSections?: number;
  requireFirstSectionWithoutHeaderFooter?: boolean;
  finalPageNumberStart?: number;
  requireSectionPagesField?: boolean;
  minimumFullWidthTables?: number;
  maximumTextOccurrences?: Readonly<Record<string, number>>;
  forbidInternalMarkers?: boolean;
  pageDecorations?: DocxPageDecorationExpectation;
  media?: DocxMediaAcceptanceExpectation;
}

export interface DocxAcceptanceReport {
  id: string;
  package: DynamicReferenceValidation;
  fingerprint: string;
  page: {
    widthTwips: number;
    heightTwips: number;
    orientation: "portrait" | "landscape";
    marginsTwips: {
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
  };
  structure: {
    paragraphCount: number;
    textRunCount: number;
    tableCount: number;
    numberedParagraphCount: number;
    hyperlinkCount: number;
    footnoteReferenceCount: number;
    mathObjectCount: number;
    drawingCount: number;
    pngImageCount: number;
    pageFieldCount: number;
    sectionPageFieldCount: number;
    sectionCount: number;
    fullWidthTableCount: number;
    internalMarkerCount: number;
    altChunkCount: number;
  };
  imageAltText: string[];
  styleIds: string[];
  appliedParagraphStyleIds: string[];
  pageDecorations?: DocxPageDecorationAcceptanceReport;
  media?: DocxMediaAcceptanceReport;
  checks: Record<string, true>;
}

interface Relationship {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

function fail(id: string, check: string, detail: string): never {
  throw new Error(`${id} 的 DOCX 自动验收失败：${check}（${detail}）`);
}

function numericAttribute(
  element: XmlElement,
  localName: string,
  id: string,
  check: string
) {
  const value = element.getAttributeNS(WORD_NAMESPACE, localName);
  if (!value || !/^\d+$/u.test(value)) {
    fail(id, check, `缺少有效的 w:${localName}`);
  }
  return Number(value);
}

function assertEqual(
  id: string,
  check: string,
  actual: unknown,
  expected: unknown
) {
  if (actual !== expected) {
    fail(
      id,
      check,
      `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`
    );
  }
}

function assertMinimum(
  id: string,
  check: string,
  actual: number,
  expected = 0
) {
  if (actual < expected) {
    fail(id, check, `期望至少 ${expected}，实际 ${actual}`);
  }
}

function parseRelationshipPart(
  content: Uint8Array,
  partName: string
) {
  const document = parseXmlPart(content, partName);
  const relationships: Relationship[] = [];
  for (const element of Array.from(
    document.getElementsByTagNameNS(
      PACKAGE_RELATIONSHIP_NAMESPACE,
      "Relationship"
    )
  )) {
    const id = element.getAttribute("Id");
    const type = element.getAttribute("Type");
    const target = element.getAttribute("Target");
    if (!id || !type || !target) {
      throw new Error(`${partName} 包含不完整的关系声明`);
    }
    relationships.push({
      id,
      type,
      target,
      external:
        (element.getAttribute("TargetMode") ?? "").toLowerCase() ===
        "external"
    });
  }
  return relationships;
}

function resolveDocumentTarget(target: string) {
  return path.posix.normalize(
    path.posix.join("word", target.replace(/^\/+/u, ""))
  );
}

function hasPngSignature(content: Uint8Array) {
  return (
    content.byteLength >= PNG_SIGNATURE.byteLength &&
    PNG_SIGNATURE.every((value, index) => content[index] === value)
  );
}

function collectPageFieldCount(
  entries: ReadonlyMap<string, Uint8Array>
) {
  let count = 0;
  for (const [partName, content] of entries) {
    if (!/^word\/(?:document|header\d+|footer\d+)\.xml$/u.test(partName)) {
      continue;
    }
    const document = parseXmlPart(content, partName);
    for (const element of Array.from(
      document.getElementsByTagNameNS(WORD_NAMESPACE, "instrText")
    )) {
      if (/\bPAGE\b/u.test(element.textContent ?? "")) {
        count += 1;
      }
    }
  }
  return count;
}

function collectFieldCount(
  entries: ReadonlyMap<string, Uint8Array>,
  field: "SECTIONPAGES"
) {
  let count = 0;
  for (const [partName, content] of entries) {
    if (!/^word\/(?:document|header\d+|footer\d+)\.xml$/u.test(partName)) {
      continue;
    }
    const document = parseXmlPart(content, partName);
    for (const element of Array.from(
      document.getElementsByTagNameNS(WORD_NAMESPACE, "instrText")
    )) {
      if (
        new RegExp(`\\b${field}\\b`, "u").test(
          element.textContent ?? ""
        )
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function countTextOccurrences(value: string, search: string) {
  if (!search) {
    return 0;
  }
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

export function inspectDocxAcceptance(
  content: Uint8Array,
  expectation: DocxAcceptanceExpectation
): DocxAcceptanceReport {
  const packageValidation = validateGeneratedDocx(content);
  const packageContent = readDocxPackage(content, {
    maximumBytes: MAXIMUM_DOCX_OUTPUT_BYTES,
    maximumEntryCount: MAXIMUM_GENERATED_DOCX_ENTRY_COUNT,
    maximumUncompressedBytes:
      MAXIMUM_GENERATED_DOCX_UNCOMPRESSED_BYTES
  });
  const entries = packageContent.entries;
  const documentPart = entries.get("word/document.xml")!;
  const document = parseXmlPart(documentPart, "word/document.xml");
  const sections = Array.from(
    document.getElementsByTagNameNS(WORD_NAMESPACE, "sectPr")
  );
  const section = sections.at(-1);
  if (!section) {
    fail(expectation.id, "page-section", "缺少最终节");
  }
  const pageDecorations = expectation.pageDecorations
    ? inspectDocxPageDecorations(
        entries,
        document,
        expectation.pageDecorations,
        expectation.id
      )
    : undefined;
  const media = expectation.media
    ? inspectDocxMediaAcceptance(
        content,
        expectation.media,
        expectation.id
      )
    : undefined;
  const pageSize = Array.from(
    section.getElementsByTagNameNS(WORD_NAMESPACE, "pgSz")
  )[0];
  const pageMargins = Array.from(
    section.getElementsByTagNameNS(WORD_NAMESPACE, "pgMar")
  )[0];
  if (!pageSize || !pageMargins) {
    fail(expectation.id, "page-layout", "缺少纸张或页边距设置");
  }
  const actualPage = {
    widthTwips: numericAttribute(
      pageSize,
      "w",
      expectation.id,
      "page-width"
    ),
    heightTwips: numericAttribute(
      pageSize,
      "h",
      expectation.id,
      "page-height"
    ),
    orientation:
      pageSize.getAttributeNS(WORD_NAMESPACE, "orient") === "landscape"
        ? ("landscape" as const)
        : ("portrait" as const),
    marginsTwips: {
      top: numericAttribute(
        pageMargins,
        "top",
        expectation.id,
        "margin-top"
      ),
      right: numericAttribute(
        pageMargins,
        "right",
        expectation.id,
        "margin-right"
      ),
      bottom: numericAttribute(
        pageMargins,
        "bottom",
        expectation.id,
        "margin-bottom"
      ),
      left: numericAttribute(
        pageMargins,
        "left",
        expectation.id,
        "margin-left"
      )
    }
  };
  assertEqual(
    expectation.id,
    "page-width",
    actualPage.widthTwips,
    expectation.page.widthTwips
  );
  assertEqual(
    expectation.id,
    "page-height",
    actualPage.heightTwips,
    expectation.page.heightTwips
  );
  assertEqual(
    expectation.id,
    "page-orientation",
    actualPage.orientation,
    expectation.page.orientation
  );
  for (const side of ["top", "right", "bottom", "left"] as const) {
    assertEqual(
      expectation.id,
      `margin-${side}`,
      actualPage.marginsTwips[side],
      expectation.page.marginsTwips[side]
    );
  }
  assertMinimum(
    expectation.id,
    "sections",
    sections.length,
    expectation.minimumSections
  );
  if (expectation.requireFirstSectionWithoutHeaderFooter) {
    const firstSection = sections[0]!;
    const headerReferences =
      firstSection.getElementsByTagNameNS(
        WORD_NAMESPACE,
        "headerReference"
      ).length;
    const footerReferences =
      firstSection.getElementsByTagNameNS(
        WORD_NAMESPACE,
        "footerReference"
      ).length;
    assertEqual(
      expectation.id,
      "first-section-header-references",
      headerReferences,
      0
    );
    assertEqual(
      expectation.id,
      "first-section-footer-references",
      footerReferences,
      0
    );
  }
  if (expectation.finalPageNumberStart !== undefined) {
    const parityOffset = expectation.pageDecorations
      ? expectation.pageDecorations.exportConfig.footer.enabled &&
        expectation.pageDecorations.exportConfig.footer.alignment ===
          "outer"
        ? expectation.pageDecorations.semanticDocument.regions.filter(
            (region) => region.kind === "cover" && region.section
          ).length
        : 0
      : 0;
    const expectedPageNumberStart =
      expectation.finalPageNumberStart + parityOffset;
    const pageNumber = firstDirectChild(
      section,
      WORD_NAMESPACE,
      "pgNumType"
    );
    if (!pageNumber) {
      fail(
        expectation.id,
        "final-page-number-start",
        "最终节缺少 w:pgNumType"
      );
    }
    assertEqual(
      expectation.id,
      "final-page-number-start",
      numericAttribute(
        pageNumber,
        "start",
        expectation.id,
        "final-page-number-start"
      ),
      expectedPageNumberStart
    );
  }

  const paragraphCount = document.getElementsByTagNameNS(
    WORD_NAMESPACE,
    "p"
  ).length;
  const textRunCount = document.getElementsByTagNameNS(
    WORD_NAMESPACE,
    "t"
  ).length;
  const tableCount = document.getElementsByTagNameNS(
    WORD_NAMESPACE,
    "tbl"
  ).length;
  const fullWidthTableCount = Array.from(
    document.getElementsByTagNameNS(WORD_NAMESPACE, "tbl")
  ).filter((table) => {
    const properties = firstDirectChild(
      table,
      WORD_NAMESPACE,
      "tblPr"
    );
    const width = properties
      ? firstDirectChild(properties, WORD_NAMESPACE, "tblW")
      : undefined;
    return (
      width?.getAttributeNS(WORD_NAMESPACE, "type") === "pct" &&
      width.getAttributeNS(WORD_NAMESPACE, "w") === "5000"
    );
  }).length;
  const numberedParagraphCount = document.getElementsByTagNameNS(
    WORD_NAMESPACE,
    "numPr"
  ).length;
  const hyperlinkCount = document.getElementsByTagNameNS(
    WORD_NAMESPACE,
    "hyperlink"
  ).length;
  const footnoteReferenceCount = document.getElementsByTagNameNS(
    WORD_NAMESPACE,
    "footnoteReference"
  ).length;
  const mathObjectCount = document.getElementsByTagNameNS(
    OFFICE_MATH_NAMESPACE,
    "oMath"
  ).length;
  const drawingCount = document.getElementsByTagNameNS(
    WORD_NAMESPACE,
    "drawing"
  ).length;
  const altChunkCount = document.getElementsByTagNameNS(
    WORD_NAMESPACE,
    "altChunk"
  ).length;
  assertMinimum(
    expectation.id,
    "paragraphs",
    paragraphCount,
    expectation.minimumParagraphs
  );
  assertMinimum(
    expectation.id,
    "text-runs",
    textRunCount,
    expectation.minimumTextRuns
  );
  assertMinimum(
    expectation.id,
    "tables",
    tableCount,
    expectation.minimumTables
  );
  assertMinimum(
    expectation.id,
    "full-width-tables",
    fullWidthTableCount,
    expectation.minimumFullWidthTables
  );
  assertMinimum(
    expectation.id,
    "numbering",
    numberedParagraphCount,
    expectation.minimumNumberedParagraphs
  );
  assertMinimum(
    expectation.id,
    "hyperlinks",
    hyperlinkCount,
    expectation.minimumHyperlinks
  );
  assertMinimum(
    expectation.id,
    "footnotes",
    footnoteReferenceCount,
    expectation.minimumFootnoteReferences
  );
  assertMinimum(
    expectation.id,
    "math",
    mathObjectCount,
    expectation.minimumMathObjects
  );
  assertMinimum(
    expectation.id,
    "drawings",
    drawingCount,
    expectation.minimumDrawings
  );
  assertEqual(expectation.id, "altChunk", altChunkCount, 0);

  const bodyText = document.documentElement?.textContent ?? "";
  for (const requiredText of expectation.requiredText) {
    if (!bodyText.includes(requiredText)) {
      fail(
        expectation.id,
        "editable-text",
        `缺少文本 ${JSON.stringify(requiredText)}`
      );
    }
  }
  for (const [text, maximum] of Object.entries(
    expectation.maximumTextOccurrences ?? {}
  )) {
    const actual = countTextOccurrences(bodyText, text);
    if (actual > maximum) {
      fail(
        expectation.id,
        "text-occurrences",
        `${JSON.stringify(text)} 最多允许 ${maximum} 次，实际 ${actual} 次`
      );
    }
  }
  const internalMarkerCount = countTextOccurrences(
    bodyText,
    "MORPHDOC_"
  );
  if (expectation.forbidInternalMarkers) {
    assertEqual(
      expectation.id,
      "internal-markers",
      internalMarkerCount,
      0
    );
  }
  if ((expectation.requiredFootnoteText?.length ?? 0) > 0) {
    const footnotesPart = entries.get("word/footnotes.xml");
    if (!footnotesPart) {
      fail(expectation.id, "footnote-text", "缺少 word/footnotes.xml");
    }
    const footnotes = parseXmlPart(
      footnotesPart,
      "word/footnotes.xml"
    );
    const footnoteText = footnotes.documentElement?.textContent ?? "";
    for (const requiredText of expectation.requiredFootnoteText ?? []) {
      if (!footnoteText.includes(requiredText)) {
        fail(
          expectation.id,
          "footnote-text",
          `缺少脚注文本 ${JSON.stringify(requiredText)}`
        );
      }
    }
  }

  const relationshipPart = entries.get(
    "word/_rels/document.xml.rels"
  )!;
  const relationships = parseRelationshipPart(
    relationshipPart,
    "word/_rels/document.xml.rels"
  );
  const hyperlinkRelationships = relationships.filter(
    (relationship) =>
      relationship.type === HYPERLINK_RELATIONSHIP_TYPE &&
      relationship.external
  ).length;
  assertMinimum(
    expectation.id,
    "hyperlink-relationships",
    hyperlinkRelationships,
    expectation.minimumHyperlinks
  );
  const imageRelationships = relationships.filter(
    (relationship) =>
      relationship.type === IMAGE_RELATIONSHIP_TYPE &&
      !relationship.external
  );
  const pngParts = new Set<string>();
  for (const relationship of imageRelationships) {
    const partName = resolveDocumentTarget(relationship.target);
    const image = entries.get(partName);
    if (!image) {
      fail(
        expectation.id,
        "image-relationship",
        `${relationship.id} 指向缺失部件 ${partName}`
      );
    }
    if (partName.toLowerCase().endsWith(".png") && hasPngSignature(image)) {
      pngParts.add(partName);
    }
  }
  assertMinimum(
    expectation.id,
    "png-images",
    pngParts.size,
    expectation.minimumPngImages
  );

  const imageAltText = Array.from(
    document.getElementsByTagNameNS(
      WORDPROCESSING_DRAWING_NAMESPACE,
      "docPr"
    )
  )
    .flatMap((element) => [
      element.getAttribute("descr"),
      element.getAttribute("title")
    ])
    .filter((value): value is string => Boolean(value));
  for (const requiredAltText of expectation.requiredImageAltText ?? []) {
    if (!imageAltText.includes(requiredAltText)) {
      fail(
        expectation.id,
        "image-alt-text",
        `缺少替代文本 ${JSON.stringify(requiredAltText)}`
      );
    }
  }

  const styles = parseXmlPart(
    entries.get("word/styles.xml")!,
    "word/styles.xml"
  );
  const styleIds = Array.from(
    styles.getElementsByTagNameNS(WORD_NAMESPACE, "style")
  )
    .map((element) =>
      element.getAttributeNS(WORD_NAMESPACE, "styleId")
    )
    .filter((value): value is string => Boolean(value));
  for (const requiredStyleId of expectation.requiredStyleIds ?? []) {
    if (!styleIds.includes(requiredStyleId)) {
      fail(
        expectation.id,
        "styles",
        `缺少样式 ${requiredStyleId}`
      );
    }
  }
  const appliedParagraphStyleIds = Array.from(
    document.getElementsByTagNameNS(WORD_NAMESPACE, "pStyle")
  )
    .map((element) =>
      element.getAttributeNS(WORD_NAMESPACE, "val")
    )
    .filter((value): value is string => Boolean(value));
  for (const requiredStyleId of
    expectation.requiredParagraphStyleIds ?? []) {
    if (!appliedParagraphStyleIds.includes(requiredStyleId)) {
      fail(
        expectation.id,
        "applied-paragraph-styles",
        `正文未使用样式 ${requiredStyleId}`
      );
    }
  }

  const pageFieldCount = collectPageFieldCount(entries);
  const sectionPageFieldCount = collectFieldCount(
    entries,
    "SECTIONPAGES"
  );
  if (expectation.requirePageField) {
    assertMinimum(expectation.id, "page-field", pageFieldCount, 1);
  }
  if (expectation.requireSectionPagesField) {
    assertMinimum(
      expectation.id,
      "section-pages-field",
      sectionPageFieldCount,
      1
    );
  }
  return {
    id: expectation.id,
    package: packageValidation,
    fingerprint: packageContent.fingerprint,
    page: actualPage,
    structure: {
      paragraphCount,
      textRunCount,
      tableCount,
      numberedParagraphCount,
      hyperlinkCount,
      footnoteReferenceCount,
      mathObjectCount,
      drawingCount,
      pngImageCount: pngParts.size,
      pageFieldCount,
      sectionPageFieldCount,
      sectionCount: sections.length,
      fullWidthTableCount,
      internalMarkerCount,
      altChunkCount
    },
    imageAltText,
    styleIds,
    appliedParagraphStyleIds,
    ...(pageDecorations ? { pageDecorations } : {}),
    ...(media ? { media } : {}),
    checks: {
      package: true,
      page: true,
      editableStructure: true,
      relationships: true,
      pngMedia: true,
      styles: true,
      sections: true,
      ...(pageDecorations ? { pageDecorations: true } : {}),
      ...(media ? { media: true } : {}),
      tables: true,
      textOccurrences: true,
      noAltChunk: true
    }
  };
}
