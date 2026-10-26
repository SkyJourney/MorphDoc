import path from "node:path";
import type { PreparedDocxMedia } from "@morphdoc/core";
import {
  DRAWING_NAMESPACE,
  OFFICE_RELATIONSHIP_NAMESPACE,
  PACKAGE_RELATIONSHIP_NAMESPACE,
  WORD_NAMESPACE,
  firstDirectChild,
  parseXmlPart,
  type XmlElement
} from "./ooxml.js";
import {
  preparePandocMedia,
  type PandocMediaLayoutItem
} from "./pandoc-media.js";
import { readGeneratedDocxPackage } from "./reference-package.js";

const WORDPROCESSING_DRAWING_NAMESPACE =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const IMAGE_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const EMUS_PER_TWIP = 635;
const EMU_TOLERANCE = 20;
const ASPECT_RATIO_TOLERANCE = 0.000_001;
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

export interface DocxMediaAcceptancePage {
  widthTwips: number;
  heightTwips: number;
  marginsTwips: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

export interface DocxMediaAcceptanceExpectation {
  items: readonly PandocMediaLayoutItem[];
  maximumWidthEmu: number;
  maximumHeightEmu: number;
}

export interface DocxMediaAcceptanceObservation {
  id: string;
  kind: PandocMediaLayoutItem["kind"];
  ordinal: number;
  altText: string;
  alignment: PandocMediaLayoutItem["alignment"];
  widthEmu: number;
  heightEmu: number;
  relationshipId: string;
  partName: string;
}

export interface DocxMediaAcceptanceReport {
  expectedCount: number;
  drawingCount: number;
  inlineCount: number;
  anchorCount: number;
  maximumWidthEmu: number;
  maximumHeightEmu: number;
  observations: DocxMediaAcceptanceObservation[];
  checks: {
    exactCount: true;
    inlineLayout: true;
    dimensions: true;
    aspectRatio: true;
    alignment: true;
    relationships: true;
    pngMedia: true;
    noCroppingOrTransform: true;
  };
}

interface Relationship {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

function fail(id: string, check: string, detail: string): never {
  throw new Error(
    `${id} 的 DOCX 媒体验收失败：${check}（${detail}）`
  );
}

function numericAttribute(
  element: XmlElement,
  name: string,
  id: string,
  check: string
) {
  const raw = element.getAttribute(name);
  const value = raw === null ? Number.NaN : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(id, check, `${name}=${JSON.stringify(raw)}`);
  }
  return value;
}

function withinTolerance(actual: number, expected: number) {
  return Math.abs(actual - expected) <= EMU_TOLERANCE;
}

function paragraphForDrawing(
  drawing: XmlElement,
  id: string
) {
  let current = drawing.parentNode;
  while (current) {
    const element = current as XmlElement;
    if (
      element.nodeType === 1 &&
      element.namespaceURI === WORD_NAMESPACE &&
      element.localName === "p"
    ) {
      return element;
    }
    current = current.parentNode;
  }
  fail(id, "paragraph", "Drawing 不在正文段落中");
}

function parseRelationships(content: Uint8Array, id: string) {
  const document = parseXmlPart(
    content,
    "word/_rels/document.xml.rels"
  );
  return Array.from(
    document.getElementsByTagNameNS(
      PACKAGE_RELATIONSHIP_NAMESPACE,
      "Relationship"
    )
  ).map(
    (element): Relationship => ({
      id: element.getAttribute("Id") ?? "",
      type: element.getAttribute("Type") ?? "",
      target: element.getAttribute("Target") ?? "",
      external: element.getAttribute("TargetMode") === "External"
    })
  ).map((relationship) => {
    if (!relationship.id || !relationship.target) {
      fail(id, "relationships", "图片关系缺少 ID 或 Target");
    }
    return relationship;
  });
}

function resolveImagePart(target: string, id: string) {
  const partName = path.posix.normalize(
    path.posix.join("word", target.replaceAll("\\", "/"))
  );
  if (!partName.startsWith("word/") || partName.includes("../")) {
    fail(id, "relationships", `图片关系越界：${target}`);
  }
  return partName;
}

function hasPngSignature(content: Uint8Array) {
  return (
    content.byteLength >= PNG_SIGNATURE.byteLength &&
    PNG_SIGNATURE.every((value, index) => content[index] === value)
  );
}

export function createDocxMediaAcceptanceExpectation(
  media: PreparedDocxMedia,
  page: DocxMediaAcceptancePage
): DocxMediaAcceptanceExpectation {
  const contentWidthTwips =
    page.widthTwips -
    page.marginsTwips.left -
    page.marginsTwips.right;
  const contentHeightTwips =
    page.heightTwips -
    page.marginsTwips.top -
    page.marginsTwips.bottom;
  if (contentWidthTwips <= 0 || contentHeightTwips <= 0) {
    throw new Error("DOCX 媒体验收页面内容区无效");
  }
  return {
    items: preparePandocMedia(media).layout,
    maximumWidthEmu: contentWidthTwips * EMUS_PER_TWIP,
    maximumHeightEmu: contentHeightTwips * EMUS_PER_TWIP
  };
}

export function inspectDocxMediaAcceptance(
  content: Uint8Array,
  expectation: DocxMediaAcceptanceExpectation,
  id = "document"
): DocxMediaAcceptanceReport {
  const package_ = readGeneratedDocxPackage(content);
  const entries = package_.entries;
  const document = parseXmlPart(
    entries.get("word/document.xml")!,
    "word/document.xml"
  );
  const relationshipContent = entries.get(
    "word/_rels/document.xml.rels"
  );
  if (!relationshipContent) {
    fail(id, "relationships", "缺少 document.xml.rels");
  }
  const relationships = parseRelationships(relationshipContent, id);
  const relationshipsById = new Map(
    relationships.map((relationship) => [relationship.id, relationship])
  );
  if (relationshipsById.size !== relationships.length) {
    fail(id, "relationships", "存在重复关系 ID");
  }

  const drawings = Array.from(
    document.getElementsByTagNameNS(WORD_NAMESPACE, "drawing")
  );
  const inlineCount = document.getElementsByTagNameNS(
    WORDPROCESSING_DRAWING_NAMESPACE,
    "inline"
  ).length;
  const anchorCount = document.getElementsByTagNameNS(
    WORDPROCESSING_DRAWING_NAMESPACE,
    "anchor"
  ).length;
  if (
    drawings.length !== expectation.items.length ||
    inlineCount !== expectation.items.length ||
    anchorCount !== 0
  ) {
    fail(
      id,
      "inline-layout",
      `expected=${expectation.items.length}, drawings=${drawings.length}, inline=${inlineCount}, anchor=${anchorCount}`
    );
  }

  const usedRelationshipIds = new Set<string>();
  const usedParts = new Set<string>();
  const observations: DocxMediaAcceptanceObservation[] = [];
  for (const [index, item] of expectation.items.entries()) {
    const drawing = drawings[index]!;
    const inline = drawing.getElementsByTagNameNS(
      WORDPROCESSING_DRAWING_NAMESPACE,
      "inline"
    )[0];
    if (!inline) {
      fail(id, "inline-layout", `${item.id} 缺少 wp:inline`);
    }
    for (const attribute of ["distT", "distB", "distL", "distR"]) {
      if (inline.getAttribute(attribute) !== "0") {
        fail(id, "inline-layout", `${item.id} 的 ${attribute} 非零`);
      }
    }
    const extent = firstDirectChild(
      inline,
      WORDPROCESSING_DRAWING_NAMESPACE,
      "extent"
    );
    const documentProperties = firstDirectChild(
      inline,
      WORDPROCESSING_DRAWING_NAMESPACE,
      "docPr"
    );
    if (!extent || !documentProperties) {
      fail(id, "drawing-properties", `${item.id} 的属性不完整`);
    }
    const widthEmu = numericAttribute(
      extent,
      "cx",
      id,
      "dimensions"
    );
    const heightEmu = numericAttribute(
      extent,
      "cy",
      id,
      "dimensions"
    );
    if (
      !withinTolerance(widthEmu, item.widthEmu) ||
      !withinTolerance(heightEmu, item.heightEmu) ||
      widthEmu > expectation.maximumWidthEmu + EMU_TOLERANCE ||
      heightEmu > expectation.maximumHeightEmu + EMU_TOLERANCE
    ) {
      fail(
        id,
        "dimensions",
        `${item.id}=${widthEmu}x${heightEmu}, expected=${item.widthEmu}x${item.heightEmu}`
      );
    }
    const ratioDelta = Math.abs(
      widthEmu / heightEmu - item.widthEmu / item.heightEmu
    ) / (item.widthEmu / item.heightEmu);
    if (ratioDelta > ASPECT_RATIO_TOLERANCE) {
      fail(id, "aspect-ratio", `${item.id} delta=${ratioDelta}`);
    }

    const transforms = Array.from(
      drawing.getElementsByTagNameNS(DRAWING_NAMESPACE, "xfrm")
    );
    const transformedExtent =
      transforms.length === 1
        ? firstDirectChild(
            transforms[0]!,
            DRAWING_NAMESPACE,
            "ext"
          )
        : undefined;
    if (!transformedExtent) {
      fail(id, "drawing-transform", `${item.id} 缺少唯一 a:xfrm/a:ext`);
    }
    if (
      numericAttribute(transformedExtent, "cx", id, "dimensions") !==
        widthEmu ||
      numericAttribute(transformedExtent, "cy", id, "dimensions") !==
        heightEmu
    ) {
      fail(id, "dimensions", `${item.id} 的双层尺寸不一致`);
    }
    const transform = transforms[0]!;
    if (
      transform.hasAttribute("rot") ||
      transform.hasAttribute("flipH") ||
      transform.hasAttribute("flipV") ||
      drawing.getElementsByTagNameNS(DRAWING_NAMESPACE, "srcRect")
        .length > 0
    ) {
      fail(id, "cropping-transform", `${item.id} 存在裁切、旋转或翻转`);
    }
    const locks = drawing.getElementsByTagNameNS(
      DRAWING_NAMESPACE,
      "graphicFrameLocks"
    );
    if (
      locks.length !== 1 ||
      locks[0]!.getAttribute("noChangeAspect") !== "1"
    ) {
      fail(id, "aspect-lock", `${item.id} 未锁定宽高比`);
    }
    if (
      documentProperties.getAttribute("descr") !== item.altText ||
      (documentProperties.getAttribute("title") ?? "").includes(
        "morphdoc-media:"
      )
    ) {
      fail(id, "alternative-text", `${item.id} 的替代文本或标题无效`);
    }

    const paragraph = paragraphForDrawing(drawing, id);
    const properties = firstDirectChild(
      paragraph,
      WORD_NAMESPACE,
      "pPr"
    );
    const justification = properties
      ? firstDirectChild(properties, WORD_NAMESPACE, "jc")
      : undefined;
    const alignment = justification?.getAttributeNS(
      WORD_NAMESPACE,
      "val"
    );
    if (alignment !== item.alignment) {
      fail(
        id,
        "alignment",
        `${item.id}=${alignment ?? "missing"}, expected=${item.alignment}`
      );
    }

    const blips = Array.from(
      drawing.getElementsByTagNameNS(DRAWING_NAMESPACE, "blip")
    );
    const relationshipId =
      blips.length === 1
        ? blips[0]!.getAttributeNS(
            OFFICE_RELATIONSHIP_NAMESPACE,
            "embed"
          )
        : null;
    if (!relationshipId || usedRelationshipIds.has(relationshipId)) {
      fail(id, "relationships", `${item.id} 的图片关系缺失或重复`);
    }
    const relationship = relationshipsById.get(relationshipId);
    if (
      !relationship ||
      relationship.type !== IMAGE_RELATIONSHIP_TYPE ||
      relationship.external
    ) {
      fail(id, "relationships", `${item.id} 的图片关系类型无效`);
    }
    const partName = resolveImagePart(relationship.target, id);
    const image = entries.get(partName);
    if (
      !partName.toLowerCase().endsWith(".png") ||
      !image ||
      !hasPngSignature(image) ||
      usedParts.has(partName)
    ) {
      fail(id, "png-media", `${item.id} 未绑定唯一有效 PNG`);
    }
    usedRelationshipIds.add(relationshipId);
    usedParts.add(partName);
    observations.push({
      id: item.id,
      kind: item.kind,
      ordinal: item.ordinal,
      altText: item.altText,
      alignment: item.alignment,
      widthEmu,
      heightEmu,
      relationshipId,
      partName
    });
  }

  const imageRelationships = relationships.filter(
    (relationship) => relationship.type === IMAGE_RELATIONSHIP_TYPE
  );
  if (imageRelationships.length !== usedRelationshipIds.size) {
    fail(id, "relationships", "存在未使用或额外的正文图片关系");
  }

  return {
    expectedCount: expectation.items.length,
    drawingCount: drawings.length,
    inlineCount,
    anchorCount,
    maximumWidthEmu: expectation.maximumWidthEmu,
    maximumHeightEmu: expectation.maximumHeightEmu,
    observations,
    checks: {
      exactCount: true,
      inlineLayout: true,
      dimensions: true,
      aspectRatio: true,
      alignment: true,
      relationships: true,
      pngMedia: true,
      noCroppingOrTransform: true
    }
  };
}
