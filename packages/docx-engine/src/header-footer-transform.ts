import {
  lengthToMillimeters,
  type FooterConfig,
  type HeaderConfig
} from "@morphdoc/core";
import {
  CONTENT_TYPES_NAMESPACE,
  OFFICE_RELATIONSHIP_NAMESPACE,
  PACKAGE_RELATIONSHIP_NAMESPACE,
  WORD_NAMESPACE,
  appendElement,
  colorValue,
  millimetersToTwips,
  parseXmlPart,
  pointsToHalfPoints,
  serializeXmlPart,
  type XmlElement
} from "./ooxml.js";
import {
  resolveHeaderTemplate,
  type DynamicReferenceDocxOptions
} from "./reference-options.js";

const HEADER_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header";
const FOOTER_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer";
const HEADER_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml";
const FOOTER_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml";
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";

type HeaderFooterReferenceType = "default" | "even" | "first";

export interface HeaderFooterReference {
  kind: "header" | "footer";
  type: HeaderFooterReferenceType;
  relationshipId: string;
}

export interface HeaderFooterTransformResult {
  entries: Map<string, Uint8Array>;
  references: HeaderFooterReference[];
  usesEvenAndOddPages: boolean;
  usesDifferentFirstPage: boolean;
}

interface RunStyle {
  font: string;
  sizePt: number;
  color: string;
}

function firstFontName(fontFamily: string, fallback: string) {
  const first = fontFamily.split(",")[0]?.trim() ?? "";
  return first.replace(/^["']|["']$/gu, "") || fallback;
}

function createWordPart(rootName: "hdr" | "ftr") {
  return parseXmlPart(
    new TextEncoder().encode(
      `<w:${rootName} xmlns:w="${WORD_NAMESPACE}" xmlns:r="${OFFICE_RELATIONSHIP_NAMESPACE}"/>`
    ),
    `word/${rootName}.xml`
  );
}

function appendRunProperties(run: XmlElement, style: RunStyle) {
  const rPr = appendElement(run, WORD_NAMESPACE, "w:rPr");
  appendElement(rPr, WORD_NAMESPACE, "w:rFonts", {
    "w:ascii": style.font,
    "w:hAnsi": style.font,
    "w:eastAsia": style.font,
    "w:cs": style.font
  });
  appendElement(rPr, WORD_NAMESPACE, "w:color", {
    "w:val": colorValue(style.color)
  });
  const size = pointsToHalfPoints(style.sizePt);
  appendElement(rPr, WORD_NAMESPACE, "w:sz", {
    "w:val": size
  });
  appendElement(rPr, WORD_NAMESPACE, "w:szCs", {
    "w:val": size
  });
}

function appendText(
  paragraph: XmlElement,
  value: string,
  style: RunStyle
) {
  if (!value) {
    return;
  }
  const run = appendElement(paragraph, WORD_NAMESPACE, "w:r");
  appendRunProperties(run, style);
  const text = appendElement(run, WORD_NAMESPACE, "w:t");
  text.setAttributeNS(XML_NAMESPACE, "xml:space", "preserve");
  text.appendChild(text.ownerDocument!.createTextNode(value));
}

function appendField(
  paragraph: XmlElement,
  instruction: "PAGE" | "NUMPAGES",
  style: RunStyle
) {
  const begin = appendElement(paragraph, WORD_NAMESPACE, "w:r");
  appendRunProperties(begin, style);
  appendElement(begin, WORD_NAMESPACE, "w:fldChar", {
    "w:fldCharType": "begin",
    "w:dirty": "true"
  });

  const command = appendElement(paragraph, WORD_NAMESPACE, "w:r");
  appendRunProperties(command, style);
  const instructionText = appendElement(
    command,
    WORD_NAMESPACE,
    "w:instrText"
  );
  instructionText.setAttributeNS(
    XML_NAMESPACE,
    "xml:space",
    "preserve"
  );
  instructionText.appendChild(
    instructionText.ownerDocument!.createTextNode(
      ` ${instruction} \\* MERGEFORMAT `
    )
  );

  const separate = appendElement(paragraph, WORD_NAMESPACE, "w:r");
  appendRunProperties(separate, style);
  appendElement(separate, WORD_NAMESPACE, "w:fldChar", {
    "w:fldCharType": "separate"
  });
  appendText(paragraph, "1", style);

  const end = appendElement(paragraph, WORD_NAMESPACE, "w:r");
  appendRunProperties(end, style);
  appendElement(end, WORD_NAMESPACE, "w:fldChar", {
    "w:fldCharType": "end"
  });
}

function footerTemplate(footer: FooterConfig) {
  return footer.format === "page"
    ? "${page}"
    : footer.format === "page-total"
      ? "${page} / ${pages}"
      : footer.format === "chinese-page-total"
        ? "第 ${page} 页 / 共 ${pages} 页"
        : footer.format === "dash-page"
          ? "- ${page} -"
          : footer.format === "official-page"
            ? "— ${page} —"
            : footer.template || "${page} / ${pages}";
}

function appendInstruction(
  paragraph: XmlElement,
  value: string,
  style: RunStyle
) {
  const run = appendElement(paragraph, WORD_NAMESPACE, "w:r");
  appendRunProperties(run, style);
  const instruction = appendElement(
    run,
    WORD_NAMESPACE,
    "w:instrText"
  );
  instruction.setAttributeNS(
    XML_NAMESPACE,
    "xml:space",
    "preserve"
  );
  instruction.appendChild(
    instruction.ownerDocument!.createTextNode(value)
  );
}

function appendFieldCharacter(
  paragraph: XmlElement,
  type: "begin" | "separate" | "end",
  style: RunStyle
) {
  const run = appendElement(paragraph, WORD_NAMESPACE, "w:r");
  appendRunProperties(run, style);
  appendElement(run, WORD_NAMESPACE, "w:fldChar", {
    "w:fldCharType": type,
    ...(type === "begin" ? { "w:dirty": "true" } : {})
  });
}

function appendOffsetPageField(
  paragraph: XmlElement,
  offset: number,
  style: RunStyle
) {
  if (offset <= 0) {
    appendField(paragraph, "PAGE", style);
    return;
  }
  appendFieldCharacter(paragraph, "begin", style);
  appendInstruction(paragraph, " = ", style);
  appendFieldCharacter(paragraph, "begin", style);
  appendInstruction(paragraph, " PAGE \\* MERGEFORMAT ", style);
  appendFieldCharacter(paragraph, "separate", style);
  appendText(paragraph, String(offset + 1), style);
  appendFieldCharacter(paragraph, "end", style);
  appendInstruction(paragraph, ` - ${offset} `, style);
  appendFieldCharacter(paragraph, "separate", style);
  appendText(paragraph, "1", style);
  appendFieldCharacter(paragraph, "end", style);
}

function appendFooterContent(
  paragraph: XmlElement,
  footer: FooterConfig,
  style: RunStyle,
  pageNumberOffset = 0
) {
  const tokens = footerTemplate(footer).split(
    /(\$\{page\}|\$\{pages\})/gu
  );
  for (const token of tokens) {
    if (token === "${page}") {
      appendOffsetPageField(paragraph, pageNumberOffset, style);
    } else if (token === "${pages}") {
      appendField(paragraph, "NUMPAGES", style);
    } else {
      appendText(paragraph, token, style);
    }
  }
}

function appendParagraphProperties(
  paragraph: XmlElement,
  options: {
    alignment?: "left" | "center" | "right";
    position: "header" | "footer";
    lineHeightTwips: number;
    divider: boolean;
    dividerColor: string;
    centerTabTwips?: number;
    rightTabTwips?: number;
  }
) {
  const properties = appendElement(
    paragraph,
    WORD_NAMESPACE,
    "w:pPr"
  );
  appendElement(properties, WORD_NAMESPACE, "w:spacing", {
    "w:before": "0",
    "w:after": "0",
    "w:line": String(options.lineHeightTwips),
    "w:lineRule": "exact"
  });
  if (options.alignment) {
    appendElement(properties, WORD_NAMESPACE, "w:jc", {
      "w:val": options.alignment
    });
  }
  if (
    options.centerTabTwips !== undefined ||
    options.rightTabTwips !== undefined
  ) {
    const tabs = appendElement(properties, WORD_NAMESPACE, "w:tabs");
    if (options.centerTabTwips !== undefined) {
      appendElement(tabs, WORD_NAMESPACE, "w:tab", {
        "w:val": "center",
        "w:pos": String(options.centerTabTwips)
      });
    }
    if (options.rightTabTwips !== undefined) {
      appendElement(tabs, WORD_NAMESPACE, "w:tab", {
        "w:val": "right",
        "w:pos": String(options.rightTabTwips)
      });
    }
  }
  if (options.divider) {
    const borders = appendElement(
      properties,
      WORD_NAMESPACE,
      "w:pBdr"
    );
    appendElement(
      borders,
      WORD_NAMESPACE,
      options.position === "header" ? "w:bottom" : "w:top",
      {
        "w:val": "single",
        "w:sz": "4",
        "w:space": "2",
        "w:color": colorValue(options.dividerColor)
      }
    );
  }
}

function appendTab(paragraph: XmlElement) {
  const run = appendElement(paragraph, WORD_NAMESPACE, "w:r");
  appendElement(run, WORD_NAMESPACE, "w:tab");
}

function appendHeaderParagraph(
  root: XmlElement,
  options: {
    divider: boolean;
    dividerColor: string;
    contentWidthMm: number;
    lineHeightTwips: number;
    render: (
      paragraph: XmlElement,
      alignment: "left" | "center" | "right"
    ) => void;
  }
) {
  const paragraph = appendElement(root, WORD_NAMESPACE, "w:p");
  const contentWidthTwips = millimetersToTwips(options.contentWidthMm);
  appendParagraphProperties(paragraph, {
    position: "header",
    lineHeightTwips: options.lineHeightTwips,
    divider: options.divider,
    dividerColor: options.dividerColor,
    centerTabTwips: Math.round(contentWidthTwips / 2),
    rightTabTwips: contentWidthTwips
  });
  options.render(paragraph, "left");
  appendTab(paragraph);
  options.render(paragraph, "center");
  appendTab(paragraph);
  options.render(paragraph, "right");
}

function createHeaderPart(
  header: HeaderConfig,
  options: DynamicReferenceDocxOptions,
  fallbackFont: string,
  contentWidthMm: number,
  empty = false
) {
  const document = createWordPart("hdr");
  const style: RunStyle = {
    font: firstFontName(header.fontFamily, fallbackFont),
    sizePt: (lengthToMillimeters(header.fontSize) * 72) / 25.4,
    color: header.color
  };
  appendHeaderParagraph(document.documentElement!, {
    divider: !empty && header.showDivider,
    dividerColor: header.color,
    contentWidthMm,
    lineHeightTwips: Math.round(style.sizePt * 1.25 * 20),
    render: (paragraph, alignment) => {
      const slot = header[alignment];
      if (!empty && slot.enabled) {
        appendText(
          paragraph,
          resolveHeaderTemplate(slot.content, options),
          style
        );
      }
    }
  });
  return serializeXmlPart(document);
}

function createFooterPart(
  footer: FooterConfig,
  alignment: "left" | "center" | "right",
  fallbackFont: string,
  empty = false,
  pageNumberOffset = 0
) {
  const document = createWordPart("ftr");
  const style: RunStyle = {
    font: firstFontName(footer.fontFamily, fallbackFont),
    sizePt: (lengthToMillimeters(footer.fontSize) * 72) / 25.4,
    color: footer.color
  };
  const paragraph = appendElement(
    document.documentElement!,
    WORD_NAMESPACE,
    "w:p"
  );
  appendParagraphProperties(paragraph, {
    position: "footer",
    lineHeightTwips: Math.round(style.sizePt * 1.25 * 20),
    divider: !empty && footer.showDivider,
    dividerColor: footer.color,
    alignment
  });
  if (!empty) {
    appendFooterContent(paragraph, footer, style, pageNumberOffset);
  }
  return serializeXmlPart(document);
}

function removeExistingHeaderFooterParts(
  entries: Map<string, Uint8Array>
) {
  for (const name of [...entries.keys()]) {
    if (/^word\/(?:header|footer)\d+\.xml$/u.test(name)) {
      entries.delete(name);
    }
  }
}

function nextRelationshipId(relationships: XmlElement) {
  const maximum = Array.from(
    relationships.getElementsByTagNameNS(
      PACKAGE_RELATIONSHIP_NAMESPACE,
      "Relationship"
    )
  ).reduce((current, relationship) => {
    const match = /^rId(\d+)$/u.exec(
      relationship.getAttribute("Id") ?? ""
    );
    return Math.max(current, Number(match?.[1] ?? 0));
  }, 0);
  let next = maximum + 1;
  return () => `rId${next++}`;
}

function updateRelationships(
  entries: Map<string, Uint8Array>,
  parts: Array<{
    kind: "header" | "footer";
    type: HeaderFooterReferenceType;
    partName: string;
  }>
) {
  const document = parseXmlPart(
    entries.get("word/_rels/document.xml.rels")!,
    "word/_rels/document.xml.rels"
  );
  const root = document.documentElement!;
  for (const relationship of Array.from(
    root.getElementsByTagNameNS(
      PACKAGE_RELATIONSHIP_NAMESPACE,
      "Relationship"
    )
  )) {
    const type = relationship.getAttribute("Type");
    if (
      type === HEADER_RELATIONSHIP_TYPE ||
      type === FOOTER_RELATIONSHIP_TYPE
    ) {
      root.removeChild(relationship);
    }
  }
  const allocateId = nextRelationshipId(root);
  const references: HeaderFooterReference[] = [];
  for (const part of parts) {
    const relationshipId = allocateId();
    appendElement(
      root,
      PACKAGE_RELATIONSHIP_NAMESPACE,
      "Relationship",
      {
        Id: relationshipId,
        Type:
          part.kind === "header"
            ? HEADER_RELATIONSHIP_TYPE
            : FOOTER_RELATIONSHIP_TYPE,
        Target: part.partName.replace(/^word\//u, "")
      }
    );
    references.push({
      kind: part.kind,
      type: part.type,
      relationshipId
    });
  }
  entries.set(
    "word/_rels/document.xml.rels",
    serializeXmlPart(document)
  );
  return references;
}

function updateContentTypes(
  entries: Map<string, Uint8Array>,
  parts: Array<{
    kind: "header" | "footer";
    partName: string;
  }>
) {
  const document = parseXmlPart(
    entries.get("[Content_Types].xml")!,
    "[Content_Types].xml"
  );
  const root = document.documentElement!;
  for (const override of Array.from(
    root.getElementsByTagNameNS(CONTENT_TYPES_NAMESPACE, "Override")
  )) {
    if (
      /^\/word\/(?:header|footer)\d+\.xml$/u.test(
        override.getAttribute("PartName") ?? ""
      )
    ) {
      root.removeChild(override);
    }
  }
  for (const part of parts) {
    appendElement(root, CONTENT_TYPES_NAMESPACE, "Override", {
      PartName: `/${part.partName}`,
      ContentType:
        part.kind === "header"
          ? HEADER_CONTENT_TYPE
          : FOOTER_CONTENT_TYPE
    });
  }
  entries.set("[Content_Types].xml", serializeXmlPart(document));
}

export function createHeaderFooterParts(
  sourceEntries: ReadonlyMap<string, Uint8Array>,
  options: DynamicReferenceDocxOptions,
  header: HeaderConfig,
  footer: FooterConfig,
  fallbackFont: string,
  contentWidthMm: number
): HeaderFooterTransformResult {
  const entries = new Map(sourceEntries);
  removeExistingHeaderFooterParts(entries);
  const parts: Array<{
    kind: "header" | "footer";
    type: HeaderFooterReferenceType;
    partName: string;
  }> = [];
  let headerIndex = 1;
  let footerIndex = 1;
  const coverPageOffset = options.semanticDocument?.regions.filter(
    (region) => region.kind === "cover" && region.section
  ).length ?? 0;
  const usesEvenAndOddPages =
    footer.enabled &&
    footer.alignment === "outer";
  const usesDifferentFirstPage =
    (header.enabled && !header.showOnFirstPage) ||
    (footer.enabled && !footer.showOnFirstPage);

  if (header.enabled) {
    const headerContent = createHeaderPart(
      header,
      options,
      fallbackFont,
      contentWidthMm
    );
    for (const type of [
      "default",
      ...(usesEvenAndOddPages ? ["even"] : [])
    ] as HeaderFooterReferenceType[]) {
      const partName = `word/header${headerIndex++}.xml`;
      entries.set(partName, headerContent);
      parts.push({ kind: "header", type, partName });
    }
    if (usesDifferentFirstPage) {
      const firstPartName = `word/header${headerIndex++}.xml`;
      entries.set(
        firstPartName,
        createHeaderPart(
          header,
          options,
          fallbackFont,
          contentWidthMm,
          !header.showOnFirstPage
        )
      );
      parts.push({
        kind: "header",
        type: "first",
        partName: firstPartName
      });
    }
  }

  if (footer.enabled) {
    const defaultAlignment =
      footer.alignment === "outer"
        ? coverPageOffset % 2 === 0
          ? "right"
          : "left"
        : footer.alignment;
    const evenAlignment =
      coverPageOffset % 2 === 0 ? "left" : "right";
    const defaultPartName = `word/footer${footerIndex++}.xml`;
    entries.set(
      defaultPartName,
      createFooterPart(
        footer,
        defaultAlignment,
        fallbackFont,
        false,
        usesEvenAndOddPages ? coverPageOffset : 0
      )
    );
    parts.push({
      kind: "footer",
      type: "default",
      partName: defaultPartName
    });
    if (usesEvenAndOddPages) {
      const evenPartName = `word/footer${footerIndex++}.xml`;
      entries.set(
        evenPartName,
        createFooterPart(
          footer,
          evenAlignment,
          fallbackFont,
          false,
          coverPageOffset
        )
      );
      parts.push({
        kind: "footer",
        type: "even",
        partName: evenPartName
      });
    }
    if (usesDifferentFirstPage) {
      const firstPartName = `word/footer${footerIndex++}.xml`;
      entries.set(
        firstPartName,
        createFooterPart(
          footer,
          defaultAlignment,
          fallbackFont,
          !footer.showOnFirstPage,
          usesEvenAndOddPages ? coverPageOffset : 0
        )
      );
      parts.push({
        kind: "footer",
        type: "first",
        partName: firstPartName
      });
    }
  }

  const references = updateRelationships(entries, parts);
  updateContentTypes(entries, parts);
  return {
    entries,
    references,
    usesEvenAndOddPages,
    usesDifferentFirstPage
  };
}
