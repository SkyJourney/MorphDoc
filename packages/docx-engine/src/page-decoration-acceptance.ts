import path from "node:path";
import type {
  ExportConfig,
  SemanticDocumentModel
} from "@morphdoc/core";
import {
  OFFICE_RELATIONSHIP_NAMESPACE,
  PACKAGE_RELATIONSHIP_NAMESPACE,
  WORD_NAMESPACE,
  directChildren,
  firstDirectChild,
  parseXmlPart,
  type XmlDocument,
  type XmlElement
} from "./ooxml.js";

const HEADER_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header";
const FOOTER_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer";

type ReferenceType = "default" | "even" | "first";

export interface DocxPageDecorationExpectation {
  exportConfig: Pick<ExportConfig, "header" | "footer">;
  semanticDocument: SemanticDocumentModel;
}

export interface DocxPageDecorationAcceptanceReport {
  hasCover: boolean;
  usesDifferentFirstPage: boolean;
  usesEvenAndOddPages: boolean;
  bodyPageNumberStart: number;
  headerReferenceTypes: ReferenceType[];
  footerReferenceTypes: ReferenceType[];
  totalPageField: "NUMPAGES" | "SECTIONPAGES" | "none";
}

interface Relationship {
  type: string;
  targetPart: string;
}

function fail(id: string, check: string, detail: string): never {
  throw new Error(
    `${id} 的 DOCX 页面装饰验收失败：${check}（${detail}）`
  );
}

function parseRelationships(
  entries: ReadonlyMap<string, Uint8Array>,
  id: string
) {
  const partName = "word/_rels/document.xml.rels";
  const content = entries.get(partName);
  if (!content) {
    fail(id, "relationships", `缺少 ${partName}`);
  }
  const document = parseXmlPart(content, partName);
  const relationships = new Map<string, Relationship>();
  for (const element of Array.from(
    document.getElementsByTagNameNS(
      PACKAGE_RELATIONSHIP_NAMESPACE,
      "Relationship"
    )
  )) {
    const relationshipId = element.getAttribute("Id");
    const type = element.getAttribute("Type");
    const target = element.getAttribute("Target");
    if (!relationshipId || !type || !target) {
      fail(id, "relationships", "包含不完整的关系声明");
    }
    relationships.set(relationshipId, {
      type,
      targetPart: path.posix.normalize(
        path.posix.join("word", target.replace(/^\/+/u, ""))
      )
    });
  }
  return relationships;
}

function referenceMap(
  section: XmlElement,
  kind: "header" | "footer",
  relationships: ReadonlyMap<string, Relationship>,
  entries: ReadonlyMap<string, Uint8Array>,
  id: string
) {
  const result = new Map<ReferenceType, string>();
  const relationshipType =
    kind === "header"
      ? HEADER_RELATIONSHIP_TYPE
      : FOOTER_RELATIONSHIP_TYPE;
  for (const reference of directChildren(
    section,
    WORD_NAMESPACE,
    `${kind}Reference`
  )) {
    const type = reference.getAttributeNS(
      WORD_NAMESPACE,
      "type"
    ) as ReferenceType | null;
    const relationshipId = reference.getAttributeNS(
      OFFICE_RELATIONSHIP_NAMESPACE,
      "id"
    );
    if (!type || !["default", "even", "first"].includes(type)) {
      fail(id, `${kind}-reference-type`, type ?? "缺失");
    }
    if (!relationshipId || result.has(type)) {
      fail(id, `${kind}-reference`, relationshipId ?? "缺失关系 ID");
    }
    const relationship = relationships.get(relationshipId);
    const part = relationship
      ? entries.get(relationship.targetPart)
      : undefined;
    if (
      !relationship ||
      relationship.type !== relationshipType ||
      !part
    ) {
      fail(id, `${kind}-reference`, `无效关系 ${relationshipId}`);
    }
    result.set(type, relationship.targetPart);
  }
  return result;
}

function assertReferenceTypes(
  id: string,
  kind: "header" | "footer",
  actual: ReadonlyMap<ReferenceType, string>,
  expected: readonly ReferenceType[]
) {
  const actualTypes = [...actual.keys()].sort();
  const expectedTypes = [...expected].sort();
  if (JSON.stringify(actualTypes) !== JSON.stringify(expectedTypes)) {
    fail(
      id,
      `${kind}-reference-types`,
      `期望 ${expectedTypes.join(",") || "无"}，实际 ${actualTypes.join(",") || "无"}`
    );
  }
}

function partContent(
  entries: ReadonlyMap<string, Uint8Array>,
  partName: string
) {
  return new TextDecoder().decode(entries.get(partName)!);
}

function fieldCount(content: string, field: "PAGE" | "NUMPAGES" | "SECTIONPAGES") {
  return [...content.matchAll(/<w:instrText[^>]*>([\s\S]*?)<\/w:instrText>/gu)]
    .filter((match) =>
      new RegExp(`\\b${field}\\b`, "u").test(match[1] ?? "")
    ).length;
}

function assertEmptyFirstPart(
  entries: ReadonlyMap<string, Uint8Array>,
  partName: string,
  id: string,
  kind: "header" | "footer"
) {
  const document = parseXmlPart(entries.get(partName)!, partName);
  const hasText = Array.from(
    document.getElementsByTagNameNS(WORD_NAMESPACE, "t")
  ).some((element) => Boolean(element.textContent?.trim()));
  const hasField =
    document.getElementsByTagNameNS(WORD_NAMESPACE, "instrText").length > 0;
  const hasBorder =
    document.getElementsByTagNameNS(WORD_NAMESPACE, "pBdr").length > 0;
  if (hasText || hasField || hasBorder) {
    fail(
      id,
      `${kind}-first-empty`,
      `${partName} 仍包含可见内容、字段或分隔线`
    );
  }
}

function assertFirstPartMatchesDefault(
  entries: ReadonlyMap<string, Uint8Array>,
  references: ReadonlyMap<ReferenceType, string>,
  id: string,
  kind: "header" | "footer"
) {
  const defaultPart = references.get("default");
  const firstPart = references.get("first");
  if (
    !defaultPart ||
    !firstPart ||
    partContent(entries, defaultPart) !== partContent(entries, firstPart)
  ) {
    fail(id, `${kind}-first-content`, "首页部件未继承默认内容");
  }
}

function footerAlignment(
  entries: ReadonlyMap<string, Uint8Array>,
  partName: string
) {
  const document = parseXmlPart(entries.get(partName)!, partName);
  return document
    .getElementsByTagNameNS(WORD_NAMESPACE, "jc")[0]
    ?.getAttributeNS(WORD_NAMESPACE, "val");
}

function expectedTotalPageField(
  footer: ExportConfig["footer"]
): "NUMPAGES" | "none" {
  if (!footer.enabled) {
    return "none";
  }
  const usesTotal =
    footer.format === "page-total" ||
    footer.format === "chinese-page-total" ||
    (footer.format === "custom" &&
      (footer.template ?? "${page} / ${pages}").includes("${pages}"));
  return usesTotal ? "NUMPAGES" : "none";
}

export function inspectDocxPageDecorations(
  entries: ReadonlyMap<string, Uint8Array>,
  document: XmlDocument,
  expectation: DocxPageDecorationExpectation,
  id: string
): DocxPageDecorationAcceptanceReport {
  const sections = Array.from(
    document.getElementsByTagNameNS(WORD_NAMESPACE, "sectPr")
  );
  const bodySection = sections.at(-1);
  if (!bodySection) {
    fail(id, "body-section", "缺少正文节");
  }
  const coverIntent = expectation.semanticDocument.regions.find(
    (region) => region.kind === "cover" && region.section
  )?.section;
  const hasCover = Boolean(coverIntent);
  const { header, footer } = expectation.exportConfig;
  const usesEvenAndOddPages =
    footer.enabled &&
    footer.alignment === "outer";
  const usesDifferentFirstPage =
    (header.enabled && !header.showOnFirstPage) ||
    (footer.enabled && !footer.showOnFirstPage);
  const coverPageOffset = expectation.semanticDocument.regions.filter(
    (region) => region.kind === "cover" && region.section
  ).length;
  const bodyPageNumberStart =
    (coverIntent?.followingPageNumberStart ?? footer.startFrom) +
    (usesEvenAndOddPages ? coverPageOffset : 0);

  if (hasCover) {
    if (sections.length < 2) {
      fail(id, "cover-section", "封面未形成独立节");
    }
    const coverSection = sections[0]!;
    for (const localName of [
      "headerReference",
      "footerReference",
      "pgNumType",
      "titlePg"
    ]) {
      if (firstDirectChild(coverSection, WORD_NAMESPACE, localName)) {
        fail(id, "cover-section", `封面节不得包含 w:${localName}`);
      }
    }
    const sectionType = firstDirectChild(
      coverSection,
      WORD_NAMESPACE,
      "type"
    )?.getAttributeNS(WORD_NAMESPACE, "val");
    if (sectionType !== "nextPage") {
      fail(id, "cover-section-break", `期望 nextPage，实际 ${sectionType}`);
    }
  }

  const pageNumberStart = firstDirectChild(
    bodySection,
    WORD_NAMESPACE,
    "pgNumType"
  )?.getAttributeNS(WORD_NAMESPACE, "start");
  if (pageNumberStart !== String(bodyPageNumberStart)) {
    fail(
      id,
      "body-page-number-start",
      `期望 ${bodyPageNumberStart}，实际 ${pageNumberStart ?? "缺失"}`
    );
  }
  const hasTitlePage = Boolean(
    firstDirectChild(bodySection, WORD_NAMESPACE, "titlePg")
  );
  if (hasTitlePage !== usesDifferentFirstPage) {
    fail(
      id,
      "body-title-page",
      `期望 ${usesDifferentFirstPage}，实际 ${hasTitlePage}`
    );
  }

  const relationships = parseRelationships(entries, id);
  const headerReferences = referenceMap(
    bodySection,
    "header",
    relationships,
    entries,
    id
  );
  const footerReferences = referenceMap(
    bodySection,
    "footer",
    relationships,
    entries,
    id
  );
  const expectedHeaderTypes: ReferenceType[] = header.enabled
    ? [
        "default",
        ...(usesEvenAndOddPages ? (["even"] as const) : []),
        ...(usesDifferentFirstPage ? (["first"] as const) : [])
      ]
    : [];
  const expectedFooterTypes: ReferenceType[] = footer.enabled
    ? [
        "default",
        ...(usesEvenAndOddPages ? (["even"] as const) : []),
        ...(usesDifferentFirstPage ? (["first"] as const) : [])
      ]
    : [];
  assertReferenceTypes(id, "header", headerReferences, expectedHeaderTypes);
  assertReferenceTypes(id, "footer", footerReferences, expectedFooterTypes);

  if (usesDifferentFirstPage && header.enabled) {
    if (header.showOnFirstPage) {
      assertFirstPartMatchesDefault(entries, headerReferences, id, "header");
    } else {
      assertEmptyFirstPart(entries, headerReferences.get("first")!, id, "header");
    }
  }
  if (usesDifferentFirstPage && footer.enabled) {
    if (footer.showOnFirstPage) {
      assertFirstPartMatchesDefault(entries, footerReferences, id, "footer");
    } else {
      assertEmptyFirstPart(entries, footerReferences.get("first")!, id, "footer");
    }
  }

  const defaultFooterAlignment =
    footer.alignment === "outer"
      ? coverPageOffset % 2 === 0
        ? "right"
        : "left"
      : footer.alignment;
  if (footer.enabled) {
    const defaultPart = footerReferences.get("default")!;
    if (
      footerAlignment(entries, defaultPart) !== defaultFooterAlignment
    ) {
      fail(id, "footer-default-alignment", defaultFooterAlignment);
    }
    const evenPart = footerReferences.get("even");
    const evenFooterAlignment =
      coverPageOffset % 2 === 0 ? "left" : "right";
    if (
      evenPart &&
      footerAlignment(entries, evenPart) !== evenFooterAlignment
    ) {
      fail(id, "footer-even-alignment", `期望 ${evenFooterAlignment}`);
    }
    const firstPart = footerReferences.get("first");
    if (
      firstPart &&
      footer.showOnFirstPage &&
      footerAlignment(entries, firstPart) !== defaultFooterAlignment
    ) {
      fail(id, "footer-first-alignment", defaultFooterAlignment);
    }
  }

  const settings = parseXmlPart(
    entries.get("word/settings.xml")!,
    "word/settings.xml"
  );
  const hasEvenAndOddSetting = Boolean(
    settings.getElementsByTagNameNS(WORD_NAMESPACE, "evenAndOddHeaders")[0]
  );
  if (hasEvenAndOddSetting !== usesEvenAndOddPages) {
    fail(
      id,
      "even-and-odd-setting",
      `期望 ${usesEvenAndOddPages}，实际 ${hasEvenAndOddSetting}`
    );
  }

  const baseTotalField = expectedTotalPageField(footer);
  const totalPageField =
    baseTotalField === "none"
      ? "none"
      : hasCover
        ? "SECTIONPAGES"
        : "NUMPAGES";
  for (const partName of footerReferences.values()) {
    const content = partContent(entries, partName);
    const numberFields = fieldCount(content, "PAGE");
    if (partName !== footerReferences.get("first") || footer.showOnFirstPage) {
      if (numberFields < 1) {
        fail(id, "footer-page-field", `${partName} 缺少 PAGE 字段`);
      }
    }
    if (fieldCount(content, "NUMPAGES") > 0 && totalPageField !== "NUMPAGES") {
      fail(id, "footer-total-field", `${partName} 不应包含 NUMPAGES`);
    }
    if (
      fieldCount(content, "SECTIONPAGES") > 0 &&
      totalPageField !== "SECTIONPAGES"
    ) {
      fail(id, "footer-total-field", `${partName} 不应包含 SECTIONPAGES`);
    }
    if (
      totalPageField !== "none" &&
      (partName !== footerReferences.get("first") || footer.showOnFirstPage) &&
      fieldCount(content, totalPageField) < 1
    ) {
      fail(id, "footer-total-field", `${partName} 缺少 ${totalPageField}`);
    }
  }

  return {
    hasCover,
    usesDifferentFirstPage,
    usesEvenAndOddPages,
    bodyPageNumberStart,
    headerReferenceTypes: [...headerReferences.keys()].sort(),
    footerReferenceTypes: [...footerReferences.keys()].sort(),
    totalPageField
  };
}
