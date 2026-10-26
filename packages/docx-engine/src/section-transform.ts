import {
  WORD_NAMESPACE,
  appendElement,
  firstDirectChild,
  millimetersToTwips,
  parseXmlPart,
  removeDirectChildren,
  serializeXmlPart,
  type XmlElement
} from "./ooxml.js";
import type { HeaderFooterReference } from "./header-footer-transform.js";

export interface ReferenceSectionOptions {
  dimensions: {
    width: number;
    height: number;
  };
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  orientation: "portrait" | "landscape";
  headerHeightMm: number;
  headerFontSizeMm: number;
  footerHeightMm: number;
  footerFontSizeMm: number;
  pageNumberStart: number;
  references: HeaderFooterReference[];
  usesDifferentFirstPage: boolean;
}

function insertReference(
  section: XmlElement,
  reference: HeaderFooterReference
) {
  const element = section.ownerDocument!.createElementNS(
    WORD_NAMESPACE,
    `w:${reference.kind}Reference`
  );
  element.setAttributeNS(
    WORD_NAMESPACE,
    "w:type",
    reference.type
  );
  element.setAttributeNS(
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "r:id",
    reference.relationshipId
  );
  section.insertBefore(element, section.firstChild);
}

export function transformDocumentSectionXml(
  content: Uint8Array,
  options: ReferenceSectionOptions
) {
  const document = parseXmlPart(content, "word/document.xml");
  const body = document.getElementsByTagNameNS(
    WORD_NAMESPACE,
    "body"
  )[0];
  const section = body
    ? firstDirectChild(body, WORD_NAMESPACE, "sectPr")
    : undefined;
  if (!section) {
    throw new Error("word/document.xml 缺少 w:body/w:sectPr");
  }
  removeDirectChildren(
    section,
    WORD_NAMESPACE,
    "headerReference",
    "footerReference",
    "pgSz",
    "pgMar",
    "pgNumType",
    "titlePg"
  );
  for (const reference of [...options.references].reverse()) {
    insertReference(section, reference);
  }

  const pageSize = appendElement(
    section,
    WORD_NAMESPACE,
    "w:pgSz",
    {
      "w:w": String(millimetersToTwips(options.dimensions.width)),
      "w:h": String(millimetersToTwips(options.dimensions.height))
    }
  );
  if (options.orientation === "landscape") {
    pageSize.setAttributeNS(
      WORD_NAMESPACE,
      "w:orient",
      "landscape"
    );
  }
  appendElement(section, WORD_NAMESPACE, "w:pgMar", {
    "w:top": String(millimetersToTwips(options.margins.top)),
    "w:right": String(millimetersToTwips(options.margins.right)),
    "w:bottom": String(millimetersToTwips(options.margins.bottom)),
    "w:left": String(millimetersToTwips(options.margins.left)),
    "w:header": String(
      millimetersToTwips(
        Math.max(
          0,
          options.margins.top -
            options.headerHeightMm +
            options.headerFontSizeMm * 0.25
        )
      )
    ),
    "w:footer": String(
      millimetersToTwips(
        Math.max(
          0,
          options.margins.bottom -
            options.footerHeightMm -
            options.footerFontSizeMm * 0.25
        )
      )
    ),
    "w:gutter": "0"
  });
  appendElement(section, WORD_NAMESPACE, "w:pgNumType", {
    "w:start": String(options.pageNumberStart)
  });
  if (options.usesDifferentFirstPage) {
    appendElement(section, WORD_NAMESPACE, "w:titlePg");
  }
  return serializeXmlPart(document);
}

export function transformSettingsXml(
  content: Uint8Array,
  usesEvenAndOddPages: boolean
) {
  const document = parseXmlPart(content, "word/settings.xml");
  const settings = document.documentElement!;
  const compatibility =
    firstDirectChild(settings, WORD_NAMESPACE, "compat") ??
    appendElement(settings, WORD_NAMESPACE, "w:compat");
  removeDirectChildren(
    compatibility,
    WORD_NAMESPACE,
    "doNotExpandShiftReturn"
  );
  appendElement(
    compatibility,
    WORD_NAMESPACE,
    "w:doNotExpandShiftReturn"
  );
  removeDirectChildren(
    settings,
    WORD_NAMESPACE,
    "evenAndOddHeaders"
  );
  if (usesEvenAndOddPages) {
    appendElement(
      settings,
      WORD_NAMESPACE,
      "w:evenAndOddHeaders"
    );
  }
  return serializeXmlPart(document);
}
