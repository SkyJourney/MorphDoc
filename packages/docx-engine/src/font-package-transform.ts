import {
  CONTENT_TYPES_NAMESPACE,
  DRAWING_NAMESPACE,
  OFFICE_RELATIONSHIP_NAMESPACE,
  PACKAGE_RELATIONSHIP_NAMESPACE,
  WORD_NAMESPACE,
  appendElement,
  directChildren,
  parseXmlPart,
  removeDirectChildren,
  serializeXmlPart,
  type XmlElement
} from "./ooxml.js";
import {
  obfuscateDocxFont,
  type PreparedDocxFont
} from "./font-embedding.js";
import {
  readGeneratedDocxPackage,
  writeGeneratedDocxPackage
} from "./reference-package.js";
import { createWordFontMetadata } from "./word-font-metadata.js";

const FONT_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font";
const OBFUSCATED_FONT_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.obfuscatedFont";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

export interface DocxFontEmbeddingReport {
  embeddedFaceCount: number;
  embeddedFamilyCount: number;
  replacedFontReferenceCount: number;
  totalSfntBytes: number;
}

export interface DocxFontEmbeddingResult {
  content: Uint8Array;
  report: DocxFontEmbeddingReport;
}

type EmbeddedFontRole =
  | "embedRegular"
  | "embedBold"
  | "embedItalic"
  | "embedBoldItalic";

interface EmbeddedFace {
  font: PreparedDocxFont;
  role: EmbeddedFontRole;
  relationshipId: string;
  fontKey: string;
  partName: string;
  content: Uint8Array;
}

function normalizeFontName(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

function fontRole(font: PreparedDocxFont): EmbeddedFontRole {
  const bold = font.source.weight >= 600;
  const italic = font.source.style === "italic";
  if (bold && italic) {
    return "embedBoldItalic";
  }
  if (bold) {
    return "embedBold";
  }
  if (italic) {
    return "embedItalic";
  }
  return "embedRegular";
}

function createFontLookup(fonts: readonly PreparedDocxFont[]) {
  const lookup = new Map<string, PreparedDocxFont>();
  for (const font of fonts) {
    for (const name of [
      font.metadata.family,
      font.source.family,
      ...font.source.aliases
    ]) {
      const normalized = normalizeFontName(name);
      if (!lookup.has(normalized)) {
        lookup.set(normalized, font);
      }
    }
  }
  return lookup;
}

function replaceFontName(
  value: string,
  lookup: ReadonlyMap<string, PreparedDocxFont>
) {
  return lookup.get(normalizeFontName(value))?.metadata.family;
}

function rewriteWordFontReferences(
  entries: Map<string, Uint8Array>,
  lookup: ReadonlyMap<string, PreparedDocxFont>
) {
  let count = 0;
  for (const [partName, content] of entries) {
    if (
      !/^word\/.+\.xml$/u.test(partName) ||
      partName === "word/fontTable.xml"
    ) {
      continue;
    }
    const document = parseXmlPart(content, partName);
    let changed = false;
    for (const fonts of Array.from(
      document.getElementsByTagNameNS(WORD_NAMESPACE, "rFonts")
    )) {
      for (const attribute of [
        "ascii",
        "hAnsi",
        "eastAsia",
        "cs"
      ]) {
        const value = fonts.getAttributeNS(
          WORD_NAMESPACE,
          attribute
        );
        if (!value) {
          continue;
        }
        const replacement = replaceFontName(value, lookup);
        if (!replacement || replacement === value) {
          continue;
        }
        fonts.setAttributeNS(
          WORD_NAMESPACE,
          `w:${attribute}`,
          replacement
        );
        count += 1;
        changed = true;
      }
    }
    for (const element of Array.from(
      document.getElementsByTagNameNS("*", "*")
    )) {
      if (
        element.namespaceURI !== DRAWING_NAMESPACE ||
        !element.hasAttribute("typeface")
      ) {
        continue;
      }
      const value = element.getAttribute("typeface");
      if (!value) {
        continue;
      }
      const replacement = replaceFontName(value, lookup);
      if (!replacement || replacement === value) {
        continue;
      }
      element.setAttribute("typeface", replacement);
      count += 1;
      changed = true;
    }
    if (changed) {
      entries.set(partName, serializeXmlPart(document));
    }
  }
  return count;
}

function nextRelationshipId(root: XmlElement) {
  const used = new Set(
    Array.from(
      root.getElementsByTagNameNS(
        PACKAGE_RELATIONSHIP_NAMESPACE,
        "Relationship"
      )
    ).map((relationship) => relationship.getAttribute("Id") ?? "")
  );
  let next = 1;
  return () => {
    while (used.has(`rId${next}`)) {
      next += 1;
    }
    const value = `rId${next}`;
    used.add(value);
    next += 1;
    return value;
  };
}

function prepareEmbeddedFaces(
  fonts: readonly PreparedDocxFont[],
  relationships: XmlElement
) {
  const allocateId = nextRelationshipId(relationships);
  const roles = new Map<string, string>();
  const faces: EmbeddedFace[] = [];
  for (const font of [...fonts].sort((left, right) => {
    const family = left.metadata.family.localeCompare(
      right.metadata.family
    );
    return (
      family ||
      left.source.weight - right.source.weight ||
      left.source.style.localeCompare(right.source.style)
    );
  })) {
    const role = fontRole(font);
    const roleKey = `${normalizeFontName(
      font.metadata.family
    )}\0${role}`;
    const existingFingerprint = roles.get(roleKey);
    if (existingFingerprint) {
      if (existingFingerprint !== font.fingerprint) {
        throw new Error(
          `字体 ${font.metadata.family} 的 ${role} 字形面重复`
        );
      }
      continue;
    }
    roles.set(roleKey, font.fingerprint);
    const obfuscated = obfuscateDocxFont(font);
    faces.push({
      font,
      role,
      relationshipId: allocateId(),
      ...obfuscated
    });
  }
  return faces;
}

function createRelationshipsDocument() {
  return parseXmlPart(
    new TextEncoder().encode(
      `<Relationships xmlns="${PACKAGE_RELATIONSHIP_NAMESPACE}"/>`
    ),
    "word/_rels/fontTable.xml.rels"
  );
}

function updateFontRelationships(
  entries: Map<string, Uint8Array>,
  fonts: readonly PreparedDocxFont[]
) {
  const partName = "word/_rels/fontTable.xml.rels";
  const document = entries.has(partName)
    ? parseXmlPart(entries.get(partName)!, partName)
    : createRelationshipsDocument();
  const root = document.documentElement!;
  if (
    root.namespaceURI !== PACKAGE_RELATIONSHIP_NAMESPACE ||
    root.localName !== "Relationships"
  ) {
    throw new Error("fontTable.xml.rels 根元素无效");
  }
  for (const relationship of Array.from(
    root.getElementsByTagNameNS(
      PACKAGE_RELATIONSHIP_NAMESPACE,
      "Relationship"
    )
  )) {
    if (relationship.getAttribute("Type") === FONT_RELATIONSHIP_TYPE) {
      root.removeChild(relationship);
    }
  }
  const faces = prepareEmbeddedFaces(fonts, root);
  for (const face of faces) {
    appendElement(
      root,
      PACKAGE_RELATIONSHIP_NAMESPACE,
      "Relationship",
      {
        Id: face.relationshipId,
        Type: FONT_RELATIONSHIP_TYPE,
        Target: face.partName.replace(/^word\//u, "")
      }
    );
  }
  entries.set(partName, serializeXmlPart(document));
  return faces;
}

function updateFontTable(
  entries: Map<string, Uint8Array>,
  faces: readonly EmbeddedFace[]
) {
  const partName = "word/fontTable.xml";
  const document = parseXmlPart(entries.get(partName)!, partName);
  const root = document.documentElement!;
  if (
    root.namespaceURI !== WORD_NAMESPACE ||
    root.localName !== "fonts"
  ) {
    throw new Error("word/fontTable.xml 根元素无效");
  }
  root.setAttributeNS(
    XMLNS_NAMESPACE,
    "xmlns:r",
    OFFICE_RELATIONSHIP_NAMESPACE
  );
  for (const font of directChildren(root, WORD_NAMESPACE, "font")) {
    removeDirectChildren(
      font,
      WORD_NAMESPACE,
      "embedRegular",
      "embedBold",
      "embedItalic",
      "embedBoldItalic"
    );
  }

  const byName = new Map(
    directChildren(root, WORD_NAMESPACE, "font").map((font) => [
      normalizeFontName(
        font.getAttributeNS(WORD_NAMESPACE, "name") ?? ""
      ),
      font
    ])
  );
  const metadataFamilies = new Set<string>();
  for (const face of faces) {
    const family = face.font.metadata.family;
    const normalizedFamily = normalizeFontName(family);
    let font = byName.get(normalizedFamily);
    if (!font) {
      font = appendElement(root, WORD_NAMESPACE, "w:font", {
        "w:name": family
      });
      byName.set(normalizedFamily, font);
    }
    if (!metadataFamilies.has(normalizedFamily)) {
      const metadata = createWordFontMetadata(face.font.metadata);
      removeDirectChildren(
        font,
        WORD_NAMESPACE,
        "panose1",
        "charset",
        "family",
        "pitch",
        "sig"
      );
      appendElement(font, WORD_NAMESPACE, "w:panose1", {
        "w:val": metadata.panose1
      });
      appendElement(font, WORD_NAMESPACE, "w:charset", {
        "w:val": metadata.charset
      });
      appendElement(font, WORD_NAMESPACE, "w:family", {
        "w:val": metadata.family
      });
      appendElement(font, WORD_NAMESPACE, "w:pitch", {
        "w:val": metadata.pitch
      });
      appendElement(font, WORD_NAMESPACE, "w:sig", {
        "w:usb0": metadata.signature.usb0,
        "w:usb1": metadata.signature.usb1,
        "w:usb2": metadata.signature.usb2,
        "w:usb3": metadata.signature.usb3,
        "w:csb0": metadata.signature.csb0,
        "w:csb1": metadata.signature.csb1
      });
      metadataFamilies.add(normalizedFamily);
    }
    appendElement(font, WORD_NAMESPACE, `w:${face.role}`, {
      "r:id": face.relationshipId,
      "w:fontKey": face.fontKey
    });
  }
  entries.set(partName, serializeXmlPart(document));
}

function updateContentTypes(entries: Map<string, Uint8Array>) {
  const partName = "[Content_Types].xml";
  const document = parseXmlPart(entries.get(partName)!, partName);
  const root = document.documentElement!;
  if (
    root.namespaceURI !== CONTENT_TYPES_NAMESPACE ||
    root.localName !== "Types"
  ) {
    throw new Error("[Content_Types].xml 根元素无效");
  }
  for (const entry of Array.from(
    root.getElementsByTagNameNS(CONTENT_TYPES_NAMESPACE, "Default")
  )) {
    if (
      (entry.getAttribute("Extension") ?? "").toLowerCase() ===
      "odttf"
    ) {
      root.removeChild(entry);
    }
  }
  appendElement(root, CONTENT_TYPES_NAMESPACE, "Default", {
    Extension: "odttf",
    ContentType: OBFUSCATED_FONT_CONTENT_TYPE
  });
  entries.set(partName, serializeXmlPart(document));
}

function removeExistingFontParts(entries: Map<string, Uint8Array>) {
  for (const partName of [...entries.keys()]) {
    if (/^word\/fonts\//u.test(partName)) {
      entries.delete(partName);
    }
  }
}

export function embedFontsInGeneratedDocx(
  content: Uint8Array,
  fonts: readonly PreparedDocxFont[]
): DocxFontEmbeddingResult {
  if (fonts.length === 0) {
    return {
      content,
      report: {
        embeddedFaceCount: 0,
        embeddedFamilyCount: 0,
        replacedFontReferenceCount: 0,
        totalSfntBytes: 0
      }
    };
  }
  const source = readGeneratedDocxPackage(content);
  const entries = new Map(source.entries);
  removeExistingFontParts(entries);
  const lookup = createFontLookup(fonts);
  const replacedFontReferenceCount =
    rewriteWordFontReferences(entries, lookup);
  const faces = updateFontRelationships(entries, fonts);
  updateFontTable(entries, faces);
  updateContentTypes(entries);
  for (const face of faces) {
    entries.set(face.partName, face.content);
  }
  return {
    content: writeGeneratedDocxPackage(entries),
    report: {
      embeddedFaceCount: faces.length,
      embeddedFamilyCount: new Set(
        faces.map((face) => face.font.metadata.family)
      ).size,
      replacedFontReferenceCount,
      totalSfntBytes: faces.reduce(
        (total, face) => total + face.font.sfnt.byteLength,
        0
      )
    }
  };
}
