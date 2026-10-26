import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type {
  Document as XmlDocument,
  Element as XmlElement,
  Node as XmlNode
} from "@xmldom/xmldom";

export type { XmlDocument, XmlElement, XmlNode };

export const WORD_NAMESPACE =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const OFFICE_RELATIONSHIP_NAMESPACE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const PACKAGE_RELATIONSHIP_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/relationships";
export const CONTENT_TYPES_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/content-types";
export const DRAWING_NAMESPACE =
  "http://schemas.openxmlformats.org/drawingml/2006/main";

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

const wordprocessingChildOrders = new Map<
  string,
  readonly string[]
>([
  [
    "style",
    [
      "name",
      "aliases",
      "basedOn",
      "next",
      "link",
      "autoRedefine",
      "hidden",
      "uiPriority",
      "semiHidden",
      "unhideWhenUsed",
      "qFormat",
      "locked",
      "personal",
      "personalCompose",
      "personalReply",
      "rsid",
      "pPr",
      "rPr",
      "tblPr",
      "trPr",
      "tcPr"
    ]
  ],
  [
    "pPr",
    [
      "pStyle",
      "keepNext",
      "keepLines",
      "pageBreakBefore",
      "framePr",
      "widowControl",
      "numPr",
      "suppressLineNumbers",
      "pBdr",
      "shd",
      "tabs",
      "suppressAutoHyphens",
      "kinsoku",
      "wordWrap",
      "overflowPunct",
      "topLinePunct",
      "autoSpaceDE",
      "autoSpaceDN",
      "bidi",
      "adjustRightInd",
      "snapToGrid",
      "spacing",
      "ind",
      "contextualSpacing",
      "mirrorIndents",
      "suppressOverlap",
      "jc",
      "textDirection",
      "textAlignment",
      "textboxTightWrap",
      "outlineLvl",
      "divId",
      "cnfStyle",
      "rPr",
      "sectPr",
      "pPrChange"
    ]
  ],
  [
    "rPr",
    [
      "rStyle",
      "rFonts",
      "b",
      "bCs",
      "i",
      "iCs",
      "caps",
      "smallCaps",
      "strike",
      "dstrike",
      "outline",
      "shadow",
      "emboss",
      "imprint",
      "noProof",
      "snapToGrid",
      "vanish",
      "webHidden",
      "color",
      "spacing",
      "w",
      "kern",
      "position",
      "sz",
      "szCs",
      "highlight",
      "u",
      "effect",
      "bdr",
      "shd",
      "fitText",
      "vertAlign",
      "rtl",
      "cs",
      "em",
      "lang",
      "eastAsianLayout",
      "specVanish",
      "oMath",
      "rPrChange"
    ]
  ],
  [
    "numPr",
    ["ilvl", "numId", "numberingChange", "ins"]
  ],
  [
    "pBdr",
    ["top", "left", "bottom", "right", "between", "bar"]
  ],
  [
    "tblPr",
    [
      "tblStyle",
      "tblpPr",
      "tblOverlap",
      "bidiVisual",
      "tblStyleRowBandSize",
      "tblStyleColBandSize",
      "tblW",
      "jc",
      "tblCellSpacing",
      "tblInd",
      "tblBorders",
      "shd",
      "tblLayout",
      "tblCellMar",
      "tblLook",
      "tblCaption",
      "tblDescription",
      "tblPrChange"
    ]
  ],
  [
    "trPr",
    [
      "cnfStyle",
      "divId",
      "gridBefore",
      "gridAfter",
      "wBefore",
      "wAfter",
      "cantSplit",
      "trHeight",
      "tblHeader",
      "tblCellSpacing",
      "jc",
      "hidden",
      "ins",
      "del",
      "trPrChange",
      "conflictIns",
      "conflictDel"
    ]
  ],
  [
    "tcPr",
    [
      "cnfStyle",
      "tcW",
      "gridSpan",
      "hMerge",
      "vMerge",
      "tcBorders",
      "shd",
      "noWrap",
      "tcMar",
      "textDirection",
      "tcFitText",
      "vAlign",
      "hideMark",
      "headers",
      "cellIns",
      "cellDel",
      "cellMerge",
      "tcPrChange"
    ]
  ],
  [
    "tblStylePr",
    ["pPr", "rPr", "tblPr", "trPr", "tcPr"]
  ],
  [
    "sectPr",
    [
      "headerReference",
      "footerReference",
      "footnotePr",
      "endnotePr",
      "type",
      "pgSz",
      "pgMar",
      "paperSrc",
      "pgBorders",
      "lnNumType",
      "pgNumType",
      "cols",
      "formProt",
      "vAlign",
      "noEndnote",
      "titlePg",
      "textDirection",
      "bidi",
      "rtlGutter",
      "docGrid",
      "printerSettings",
      "sectPrChange"
    ]
  ],
  [
    "tblBorders",
    ["top", "left", "bottom", "right", "insideH", "insideV"]
  ],
  [
    "tcBorders",
    [
      "top",
      "left",
      "bottom",
      "right",
      "insideH",
      "insideV",
      "tl2br",
      "tr2bl"
    ]
  ],
  [
    "tblCellMar",
    ["top", "left", "start", "bottom", "right", "end"]
  ],
  [
    "tcMar",
    ["top", "left", "start", "bottom", "right", "end"]
  ],
  [
    "font",
    [
      "altName",
      "panose1",
      "charset",
      "family",
      "notTrueType",
      "pitch",
      "sig",
      "embedRegular",
      "embedBold",
      "embedItalic",
      "embedBoldItalic"
    ]
  ]
]);

function directWordChildren(parent: XmlElement) {
  return Array.from(parent.childNodes).filter(
    (node): node is XmlElement =>
      node.nodeType === 1 &&
      (node as XmlElement).namespaceURI === WORD_NAMESPACE
  );
}

function wordChildOrder(parent: XmlElement) {
  if (parent.namespaceURI !== WORD_NAMESPACE) {
    return undefined;
  }
  return wordprocessingChildOrders.get(parent.localName ?? "");
}

function orderedWordChildren(parent: XmlElement) {
  const order = wordChildOrder(parent);
  if (!order) {
    return undefined;
  }
  const ranks = new Map(order.map((name, index) => [name, index]));
  return {
    order,
    ranks,
    children: directWordChildren(parent).filter((child) =>
      ranks.has(child.localName ?? "")
    )
  };
}

function insertWordElementInOrder(
  parent: XmlElement,
  element: XmlElement
) {
  const ordered = orderedWordChildren(parent);
  const rank = ordered?.ranks.get(element.localName ?? "");
  if (!ordered || rank === undefined) {
    parent.appendChild(element);
    return;
  }
  const insertionPoint = ordered.children.find((child) => {
    const childRank = ordered.ranks.get(child.localName ?? "");
    return childRank !== undefined && childRank > rank;
  });
  parent.insertBefore(element, insertionPoint ?? null);
}

export function normalizeWordprocessingElementOrder(
  document: XmlDocument
) {
  const elements = Array.from(document.getElementsByTagName("*"));
  for (const parent of elements) {
    const ordered = orderedWordChildren(parent);
    if (!ordered || ordered.children.length < 2) {
      continue;
    }
    const sorted = ordered.children
      .map((child, index) => ({ child, index }))
      .sort((left, right) => {
        const leftRank = ordered.ranks.get(
          left.child.localName ?? ""
        )!;
        const rightRank = ordered.ranks.get(
          right.child.localName ?? ""
        )!;
        return leftRank - rightRank || left.index - right.index;
      })
      .map(({ child }) => child);
    if (
      sorted.every(
        (child, index) => child === ordered.children[index]
      )
    ) {
      continue;
    }
    const anchor: XmlNode | null =
      ordered.children.at(-1)?.nextSibling ?? null;
    for (const child of ordered.children) {
      parent.removeChild(child);
    }
    for (const child of sorted) {
      parent.insertBefore(child, anchor);
    }
  }
}

export function validateWordprocessingElementOrder(
  document: XmlDocument,
  partName: string
) {
  const elements = Array.from(document.getElementsByTagName("*"));
  for (const parent of elements) {
    const ordered = orderedWordChildren(parent);
    if (!ordered) {
      continue;
    }
    let previousRank = -1;
    let previousName = "";
    for (const child of ordered.children) {
      const name = child.localName ?? "";
      const rank = ordered.ranks.get(name)!;
      if (rank < previousRank) {
        throw new Error(
          `${partName} 的 w:${parent.localName} 子节点顺序无效：` +
            `w:${name} 不得位于 w:${previousName} 之后`
        );
      }
      previousRank = rank;
      previousName = name;
    }
  }
}

export function parseXmlPart(
  content: Uint8Array,
  partName: string
) {
  try {
    return new DOMParser({
      onError: (level, message) => {
        if (level !== "warning") {
          throw new Error(message);
        }
      }
    }).parseFromString(decoder.decode(content), "application/xml");
  } catch (error) {
    throw new Error(
      `${partName} 不是有效 OOXML：${
        error instanceof Error ? error.message : "XML 解析失败"
      }`
    );
  }
}

export function serializeXmlPart(document: XmlDocument) {
  normalizeWordprocessingElementOrder(document);
  return encoder.encode(
    `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(
      document.documentElement!
    )}`
  );
}

export function directChildren(
  parent: XmlElement,
  namespace: string,
  localName: string
) {
  const children: XmlElement[] = [];
  for (const node of Array.from(parent.childNodes)) {
    const element = node as XmlElement;
    if (
      node.nodeType === 1 &&
      element.namespaceURI === namespace &&
      element.localName === localName
    ) {
      children.push(element);
    }
  }
  return children;
}

export function firstDirectChild(
  parent: XmlElement,
  namespace: string,
  localName: string
) {
  return directChildren(parent, namespace, localName)[0];
}

export function removeDirectChildren(
  parent: XmlElement,
  namespace: string,
  ...localNames: string[]
) {
  for (const node of Array.from(parent.childNodes)) {
    const element = node as XmlElement;
    if (
      node.nodeType === 1 &&
      element.namespaceURI === namespace &&
      localNames.includes(element.localName ?? "")
    ) {
      parent.removeChild(node);
    }
  }
}

export function appendElement(
  parent: XmlElement,
  namespace: string,
  qualifiedName: string,
  attributes: Record<string, string> = {}
) {
  const element = parent.ownerDocument!.createElementNS(
    namespace,
    qualifiedName
  );
  for (const [name, value] of Object.entries(attributes)) {
    const prefix = name.includes(":") ? name.split(":")[0] : "";
    const attributeNamespace =
      prefix === "w"
        ? WORD_NAMESPACE
        : prefix === "r"
          ? OFFICE_RELATIONSHIP_NAMESPACE
          : null;
    element.setAttributeNS(attributeNamespace, name, value);
  }
  if (namespace === WORD_NAMESPACE) {
    insertWordElementInOrder(parent, element);
  } else {
    parent.appendChild(element);
  }
  return element;
}

export function ensureDirectElement(
  parent: XmlElement,
  namespace: string,
  qualifiedName: string
) {
  const localName = qualifiedName.split(":").at(-1)!;
  return (
    firstDirectChild(parent, namespace, localName) ??
    appendElement(parent, namespace, qualifiedName)
  );
}

export function colorValue(value: string) {
  if (!/^#[0-9a-f]{6}$/iu.test(value)) {
    throw new Error(`DOCX 颜色值无效：${value}`);
  }
  return value.replace(/^#/u, "").toUpperCase();
}

export function pointsToHalfPoints(value: number) {
  return String(Math.round(value * 2));
}

export function wordCharacterSpacingTwips(
  fontSizePt: number | undefined,
  letterSpacingPt = 0
) {
  const quantizationCompensation =
    fontSizePt === undefined
      ? 0
      : fontSizePt - Math.round(fontSizePt * 2) / 2;
  return String(
    Math.round(
      (letterSpacingPt + quantizationCompensation) * 20
    )
  );
}

export function pointsToTwips(value: number) {
  return String(Math.round(value * 20));
}

export function millimetersToTwips(value: number) {
  return Math.round((value * 1440) / 25.4);
}
