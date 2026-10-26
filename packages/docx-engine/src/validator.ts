import path from "node:path";
import { MAXIMUM_DOCX_OUTPUT_BYTES } from "@morphdoc/core";
import {
  CONTENT_TYPES_NAMESPACE,
  OFFICE_RELATIONSHIP_NAMESPACE,
  PACKAGE_RELATIONSHIP_NAMESPACE,
  WORD_NAMESPACE,
  directChildren,
  parseXmlPart,
  validateWordprocessingElementOrder,
  type XmlElement
} from "./ooxml.js";
import {
  readSfntFontMetadata,
  xorDocxFont
} from "./font-embedding.js";
import { createWordFontMetadata } from "./word-font-metadata.js";
import {
  MAXIMUM_GENERATED_DOCX_ENTRY_COUNT,
  MAXIMUM_GENERATED_DOCX_UNCOMPRESSED_BYTES,
  readDocxPackage,
  readReferenceDocxPackage
} from "./reference-package.js";

const HEADER_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header";
const FOOTER_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer";
const HEADER_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml";
const FOOTER_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml";
const FONT_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font";
const OBFUSCATED_FONT_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.obfuscatedFont";

const requiredStyleIds = [
  "Normal",
  "Heading1",
  "SourceCode",
  "Table",
  "Caption"
] as const;

interface Relationship {
  id: string;
  type: string;
  targetPart: string | undefined;
}

export interface DynamicReferenceValidation {
  partCount: number;
  xmlPartCount: number;
  relationshipCount: number;
  headerCount: number;
  footerCount: number;
  embeddedFontCount: number;
}

function relationshipSourcePart(relationshipsPart: string) {
  if (relationshipsPart === "_rels/.rels") {
    return "";
  }
  const match = /^(.*)\/_rels\/([^/]+)\.rels$/u.exec(
    relationshipsPart
  );
  if (!match) {
    throw new Error(`OOXML 关系部件路径无效：${relationshipsPart}`);
  }
  return path.posix.join(match[1]!, match[2]!);
}

function resolveRelationshipTarget(
  relationshipsPart: string,
  target: string
) {
  if (
    !target ||
    target.includes("\\") ||
    target.includes("\0") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(target)
  ) {
    throw new Error(
      `${relationshipsPart} 包含不安全的内部关系目标：${target}`
    );
  }
  const sourcePart = relationshipSourcePart(relationshipsPart);
  const targetPart = target.startsWith("/")
    ? path.posix.normalize(target.slice(1))
    : path.posix.normalize(
        path.posix.join(path.posix.dirname(sourcePart), target)
      );
  if (
    !targetPart ||
    targetPart === "." ||
    targetPart === ".." ||
    targetPart.startsWith("../") ||
    targetPart.startsWith("/")
  ) {
    throw new Error(
      `${relationshipsPart} 的内部关系目标越出 DOCX 包：${target}`
    );
  }
  return targetPart;
}

function parseRelationships(
  partName: string,
  content: Uint8Array,
  entries: ReadonlyMap<string, Uint8Array>
) {
  const document = parseXmlPart(content, partName);
  const root = document.documentElement;
  if (
    !root ||
    root.namespaceURI !== PACKAGE_RELATIONSHIP_NAMESPACE ||
    root.localName !== "Relationships"
  ) {
    throw new Error(`${partName} 的关系根元素无效`);
  }

  const relationships = new Map<string, Relationship>();
  for (const element of directChildren(
    root,
    PACKAGE_RELATIONSHIP_NAMESPACE,
    "Relationship"
  )) {
    const id = element.getAttribute("Id");
    const type = element.getAttribute("Type");
    const target = element.getAttribute("Target");
    if (!id || !type || !target) {
      throw new Error(`${partName} 包含不完整的关系声明`);
    }
    if (relationships.has(id)) {
      throw new Error(`${partName} 包含重复关系 ID：${id}`);
    }
    const external =
      (element.getAttribute("TargetMode") ?? "").toLowerCase() ===
      "external";
    const targetPart = external
      ? undefined
      : resolveRelationshipTarget(partName, target);
    if (targetPart && !entries.has(targetPart)) {
      throw new Error(
        `${partName} 的关系 ${id} 指向缺失部件：${targetPart}`
      );
    }
    relationships.set(id, { id, type, targetPart });
  }
  return relationships;
}

function validateReferencedParts(
  section: XmlElement,
  localName: "headerReference" | "footerReference",
  expectedType: string,
  expectedRootName: "hdr" | "ftr",
  relationships: ReadonlyMap<string, Relationship>,
  entries: ReadonlyMap<string, Uint8Array>
) {
  const references = directChildren(
    section,
    WORD_NAMESPACE,
    localName
  );
  const pageTypes = new Set<string>();
  for (const reference of references) {
    const pageType =
      reference.getAttributeNS(WORD_NAMESPACE, "type") ?? "";
    const relationshipId =
      reference.getAttributeNS(
        OFFICE_RELATIONSHIP_NAMESPACE,
        "id"
      ) ?? "";
    if (!["default", "even", "first"].includes(pageType)) {
      throw new Error(`${localName} 包含无效页面类型：${pageType}`);
    }
    if (pageTypes.has(pageType)) {
      throw new Error(`${localName} 重复声明页面类型：${pageType}`);
    }
    pageTypes.add(pageType);
    const relationship = relationships.get(relationshipId);
    if (
      !relationship ||
      relationship.type !== expectedType ||
      !relationship.targetPart
    ) {
      throw new Error(
        `${localName} 引用了无效关系：${relationshipId || "(空)"}`
      );
    }
    const part = entries.get(relationship.targetPart)!;
    const document = parseXmlPart(part, relationship.targetPart);
    const root = document.documentElement;
    if (
      !root ||
      root.namespaceURI !== WORD_NAMESPACE ||
      root.localName !== expectedRootName
    ) {
      throw new Error(
        `${relationship.targetPart} 的页眉页脚根元素无效`
      );
    }
    if (
      root.getElementsByTagNameNS(WORD_NAMESPACE, "tbl").length > 0
    ) {
      throw new Error(
        `${relationship.targetPart} 不得使用表格模拟页眉页脚布局`
      );
    }
  }
  return references.length;
}

function validateContentTypes(
  entries: ReadonlyMap<string, Uint8Array>,
  relationships: ReadonlyMap<string, Relationship>
) {
  const partName = "[Content_Types].xml";
  const document = parseXmlPart(entries.get(partName)!, partName);
  const root = document.documentElement;
  if (
    !root ||
    root.namespaceURI !== CONTENT_TYPES_NAMESPACE ||
    root.localName !== "Types"
  ) {
    throw new Error("[Content_Types].xml 的根元素无效");
  }
  const overrides = new Map<string, string>();
  for (const element of directChildren(
    root,
    CONTENT_TYPES_NAMESPACE,
    "Override"
  )) {
    const part = element.getAttribute("PartName");
    const contentType = element.getAttribute("ContentType");
    if (!part || !contentType || overrides.has(part)) {
      throw new Error("[Content_Types].xml 包含无效或重复的 Override");
    }
    overrides.set(part, contentType);
  }
  for (const relationship of relationships.values()) {
    if (
      relationship.type !== HEADER_RELATIONSHIP_TYPE &&
      relationship.type !== FOOTER_RELATIONSHIP_TYPE
    ) {
      continue;
    }
    const expected =
      relationship.type === HEADER_RELATIONSHIP_TYPE
        ? HEADER_CONTENT_TYPE
        : FOOTER_CONTENT_TYPE;
    if (
      !relationship.targetPart ||
      overrides.get(`/${relationship.targetPart}`) !== expected
    ) {
      throw new Error(
        `${relationship.targetPart ?? "(空)"} 缺少正确的 Content Type`
      );
    }
  }
}

function validateStyles(entries: ReadonlyMap<string, Uint8Array>) {
  const partName = "word/styles.xml";
  const document = parseXmlPart(entries.get(partName)!, partName);
  const root = document.documentElement;
  if (
    !root ||
    root.namespaceURI !== WORD_NAMESPACE ||
    root.localName !== "styles"
  ) {
    throw new Error("word/styles.xml 的根元素无效");
  }
  const styleIds = new Set<string>();
  for (const style of directChildren(
    root,
    WORD_NAMESPACE,
    "style"
  )) {
    const styleId =
      style.getAttributeNS(WORD_NAMESPACE, "styleId") ?? "";
    if (styleIds.has(styleId)) {
      throw new Error(
        `word/styles.xml 包含重复样式 ID：${styleId}`
      );
    }
    styleIds.add(styleId);
    if (
      style.getAttributeNS(WORD_NAMESPACE, "type") === "table"
    ) {
      for (const properties of directChildren(
        style,
        WORD_NAMESPACE,
        "tblPr"
      )) {
        if (
          directChildren(
            properties,
            WORD_NAMESPACE,
            "tblW"
          ).length > 0
        ) {
          throw new Error(
            `word/styles.xml 的表格样式不得声明 w:tblW：${styleId}`
          );
        }
      }
    }
  }
  for (const alignment of Array.from(
    root.getElementsByTagNameNS(WORD_NAMESPACE, "jc")
  )) {
    if (
      alignment.getAttributeNS(WORD_NAMESPACE, "val") ===
      "justify"
    ) {
      throw new Error(
        "word/styles.xml 的两端对齐必须使用 w:jc=\"both\""
      );
    }
  }
  for (const styleId of requiredStyleIds) {
    if (!styleIds.has(styleId)) {
      throw new Error(`word/styles.xml 缺少关键样式：${styleId}`);
    }
  }
}

function validateEmbeddedFonts(
  entries: ReadonlyMap<string, Uint8Array>,
  relationshipParts: ReadonlyMap<
    string,
    ReadonlyMap<string, Relationship>
  >
) {
  const partName = "word/fontTable.xml";
  const document = parseXmlPart(entries.get(partName)!, partName);
  const root = document.documentElement;
  if (
    !root ||
    root.namespaceURI !== WORD_NAMESPACE ||
    root.localName !== "fonts"
  ) {
    throw new Error("word/fontTable.xml 的根元素无效");
  }
  const relationships =
    relationshipParts.get("word/_rels/fontTable.xml.rels") ??
    new Map<string, Relationship>();
  const referencedParts = new Set<string>();
  const usedRelationships = new Set<string>();
  const faceKeys = new Set<string>();
  let embeddedFontCount = 0;

  for (const font of directChildren(root, WORD_NAMESPACE, "font")) {
    const family =
      font.getAttributeNS(WORD_NAMESPACE, "name") ?? "";
    let validatedMetadata = false;
    for (const role of [
      "embedRegular",
      "embedBold",
      "embedItalic",
      "embedBoldItalic"
    ]) {
      for (const embedded of directChildren(
        font,
        WORD_NAMESPACE,
        role
      )) {
        const relationshipId =
          embedded.getAttributeNS(
            OFFICE_RELATIONSHIP_NAMESPACE,
            "id"
          ) ?? "";
        const fontKey =
          embedded.getAttributeNS(WORD_NAMESPACE, "fontKey") ??
          "";
        if (
          !relationshipId ||
          !/^\{[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\}$/iu.test(
            fontKey
          )
        ) {
          throw new Error(
            `word/fontTable.xml 的 ${family} ${role} 嵌入声明无效`
          );
        }
        const faceKey = `${family.toLocaleLowerCase(
          "en-US"
        )}\0${role}`;
        if (faceKeys.has(faceKey)) {
          throw new Error(
            `word/fontTable.xml 重复声明字体字形面：${family} ${role}`
          );
        }
        faceKeys.add(faceKey);
        const relationship = relationships.get(relationshipId);
        if (
          !relationship ||
          relationship.type !== FONT_RELATIONSHIP_TYPE ||
          !relationship.targetPart ||
          !/^word\/fonts\/[^/]+\.odttf$/u.test(
            relationship.targetPart
          )
        ) {
          throw new Error(
            `word/fontTable.xml 引用了无效字体关系：${relationshipId}`
          );
        }
        const obfuscated = entries.get(relationship.targetPart);
        if (!obfuscated) {
          throw new Error(
            `DOCX 缺少嵌入字体部件：${relationship.targetPart}`
          );
        }
        const metadata = readSfntFontMetadata(
          xorDocxFont(obfuscated, fontKey)
        );
        if (metadata.family !== family) {
          throw new Error(
            `嵌入字体家族名不匹配：${family} != ${metadata.family}`
          );
        }
        if (!validatedMetadata) {
          const expected = createWordFontMetadata(metadata);
          const panose1 = directChildren(
            font,
            WORD_NAMESPACE,
            "panose1"
          )[0];
          const charset = directChildren(
            font,
            WORD_NAMESPACE,
            "charset"
          )[0];
          const wordFamily = directChildren(
            font,
            WORD_NAMESPACE,
            "family"
          )[0];
          const pitch = directChildren(
            font,
            WORD_NAMESPACE,
            "pitch"
          )[0];
          const signature = directChildren(
            font,
            WORD_NAMESPACE,
            "sig"
          )[0];
          const wordValue = (
            element: XmlElement | undefined,
            name: string
          ) =>
            element?.getAttributeNS(WORD_NAMESPACE, name) ?? "";
          if (
            wordValue(panose1, "val") !== expected.panose1 ||
            wordValue(charset, "val") !== expected.charset ||
            wordValue(wordFamily, "val") !== expected.family ||
            wordValue(pitch, "val") !== expected.pitch ||
            wordValue(signature, "usb0") !==
              expected.signature.usb0 ||
            wordValue(signature, "usb1") !==
              expected.signature.usb1 ||
            wordValue(signature, "usb2") !==
              expected.signature.usb2 ||
            wordValue(signature, "usb3") !==
              expected.signature.usb3 ||
            wordValue(signature, "csb0") !==
              expected.signature.csb0 ||
            wordValue(signature, "csb1") !==
              expected.signature.csb1
          ) {
            throw new Error(
              `word/fontTable.xml 的 ${family} 字体元数据与嵌入字形不匹配`
            );
          }
          validatedMetadata = true;
        }
        usedRelationships.add(relationshipId);
        referencedParts.add(relationship.targetPart);
        embeddedFontCount += 1;
      }
    }
  }

  for (const relationship of relationships.values()) {
    if (
      relationship.type === FONT_RELATIONSHIP_TYPE &&
      !usedRelationships.has(relationship.id)
    ) {
      throw new Error(
        `fontTable.xml.rels 包含未使用的字体关系：${relationship.id}`
      );
    }
  }
  for (const entry of entries.keys()) {
    if (
      /^word\/fonts\//u.test(entry) &&
      !referencedParts.has(entry)
    ) {
      throw new Error(`DOCX 包含未引用字体部件：${entry}`);
    }
  }

  if (embeddedFontCount > 0) {
    const contentTypes = parseXmlPart(
      entries.get("[Content_Types].xml")!,
      "[Content_Types].xml"
    );
    const validContentType = directChildren(
      contentTypes.documentElement!,
      CONTENT_TYPES_NAMESPACE,
      "Default"
    ).some(
      (entry) =>
        (entry.getAttribute("Extension") ?? "").toLowerCase() ===
          "odttf" &&
        entry.getAttribute("ContentType") ===
          OBFUSCATED_FONT_CONTENT_TYPE
    );
    if (!validContentType) {
      throw new Error(
        "嵌入字体缺少正确的 ODTTF Content Type"
      );
    }
  }
  return embeddedFontCount;
}

function validateDocx(
  content: Uint8Array,
  generatedOutput: boolean
): DynamicReferenceValidation {
  const reference = generatedOutput
    ? readDocxPackage(content, {
        maximumBytes: MAXIMUM_DOCX_OUTPUT_BYTES,
        maximumEntryCount: MAXIMUM_GENERATED_DOCX_ENTRY_COUNT,
        maximumUncompressedBytes:
          MAXIMUM_GENERATED_DOCX_UNCOMPRESSED_BYTES
      })
    : readReferenceDocxPackage(content);
  let xmlPartCount = 0;
  let relationshipCount = 0;
  const relationshipParts = new Map<
    string,
    ReadonlyMap<string, Relationship>
  >();

  for (const [partName, part] of reference.entries) {
    if (partName.endsWith(".xml") || partName.endsWith(".rels")) {
      const document = parseXmlPart(part, partName);
      validateWordprocessingElementOrder(document, partName);
      xmlPartCount += 1;
    }
    if (partName.endsWith(".rels")) {
      const relationships = parseRelationships(
        partName,
        part,
        reference.entries
      );
      relationshipParts.set(partName, relationships);
      relationshipCount += relationships.size;
    }
  }

  const documentPart = "word/document.xml";
  const document = parseXmlPart(
    reference.entries.get(documentPart)!,
    documentPart
  );
  const root = document.documentElement;
  if (
    !root ||
    root.namespaceURI !== WORD_NAMESPACE ||
    root.localName !== "document"
  ) {
    throw new Error("word/document.xml 的根元素无效");
  }
  const sections = Array.from(
    root.getElementsByTagNameNS(WORD_NAMESPACE, "sectPr")
  );
  const finalSection = sections.at(-1);
  if (
    !finalSection ||
    directChildren(finalSection, WORD_NAMESPACE, "pgSz").length !== 1 ||
    directChildren(finalSection, WORD_NAMESPACE, "pgMar").length !== 1
  ) {
    throw new Error("word/document.xml 缺少完整的最终节页面设置");
  }

  const documentRelationships = relationshipParts.get(
    "word/_rels/document.xml.rels"
  )!;
  const headerCount = validateReferencedParts(
    finalSection,
    "headerReference",
    HEADER_RELATIONSHIP_TYPE,
    "hdr",
    documentRelationships,
    reference.entries
  );
  const footerCount = validateReferencedParts(
    finalSection,
    "footerReference",
    FOOTER_RELATIONSHIP_TYPE,
    "ftr",
    documentRelationships,
    reference.entries
  );
  validateContentTypes(reference.entries, documentRelationships);
  validateStyles(reference.entries);
  const embeddedFontCount = validateEmbeddedFonts(
    reference.entries,
    relationshipParts
  );

  return {
    partCount: reference.entries.size,
    xmlPartCount,
    relationshipCount,
    headerCount,
    footerCount,
    embeddedFontCount
  };
}

export function validateDynamicReferenceDocx(
  content: Uint8Array
): DynamicReferenceValidation {
  return validateDocx(content, false);
}

export function validateGeneratedDocx(
  content: Uint8Array
): DynamicReferenceValidation {
  return validateDocx(content, true);
}
