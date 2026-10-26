import {
  semanticDocumentModelSchema,
  type SemanticDocumentGroupNode,
  type SemanticDocumentModel,
  type SemanticDocumentNode,
  type SemanticDocumentRole,
  type SemanticDocumentTextNode
} from "@morphdoc/core";
import {
  type DocxStyleSlotName,
  type DocxThemeTokenSet
} from "@morphdoc/docx-theme-engine";
import {
  createDocxTokenSlotMap,
  DOCX_SLOT_WORD_STYLE_BINDINGS
} from "./token-style-map.js";

export interface PandocStructureParagraph {
  kind: "paragraph";
  styleId?: string | undefined;
  layout?: "space-between" | undefined;
  segments: string[];
  separator: "space" | "tab";
}

export interface PandocStructureContainer {
  kind: "container";
  styleId?: string | undefined;
  slot?: DocxStyleSlotName | undefined;
  startMarker: string;
  endMarker: string;
  blocks: PandocStructureBlock[];
}

export interface PandocStructureSectionBreak {
  kind: "section-break";
  marker: string;
  headerFooter: "none";
  pageNumber: "hidden";
  followingPageNumberStart: number;
  verticalAlignment?: "top" | "center" | "bottom" | undefined;
}

export type PandocStructureBlock =
  | PandocStructureParagraph
  | PandocStructureContainer
  | PandocStructureSectionBreak;

export interface PandocStructurePlan {
  schemaVersion: 1;
  metadataPolicy: {
    author: "emit" | "suppress";
  };
  titlePolicy: SemanticDocumentModel["titlePolicy"];
  prefix: PandocStructureBlock[];
  suffix: PandocStructureBlock[];
}

export interface CreatePandocStructurePlanOptions {
  markerSeed?: string | undefined;
}

const containerRoles = new Set<SemanticDocumentRole>([
  "official-masthead",
  "official-signature",
  "official-edition",
  "briefing-masthead",
  "project-report-cover",
  "tender-cover"
]);

const semanticRoleSlotAliases: Readonly<
  Partial<Record<SemanticDocumentRole, DocxStyleSlotName>>
> = {};

function slotName(
  role: SemanticDocumentRole
): DocxStyleSlotName | undefined {
  const alias = semanticRoleSlotAliases[role];
  if (alias) {
    return alias;
  }
  return Object.prototype.hasOwnProperty.call(
    DOCX_SLOT_WORD_STYLE_BINDINGS,
    role
  )
    ? (role as DocxStyleSlotName)
    : undefined;
}

function paragraphStyleId(
  role: SemanticDocumentRole
): string | undefined {
  const slot = slotName(role);
  return slot
    ? DOCX_SLOT_WORD_STYLE_BINDINGS[slot]?.find(
        (binding) => binding.type === "paragraph"
      )?.styleId
    : undefined;
}

function textValue(node: SemanticDocumentTextNode): string {
  return `${node.label ?? ""}${node.text}`;
}

function isHidden(
  role: SemanticDocumentRole,
  slots: ReturnType<typeof createDocxTokenSlotMap>
): boolean {
  const slot = slotName(role);
  return slot ? slots.get(slot)?.style.hidden === true : false;
}

function inlineSegments(
  node: SemanticDocumentNode,
  slots: ReturnType<typeof createDocxTokenSlotMap>
): string[] {
  if (isHidden(node.role, slots)) {
    return [];
  }
  return node.kind === "text"
    ? [textValue(node)]
    : node.children.flatMap((child) =>
        inlineSegments(child, slots)
      );
}

function projectTextNode(
  node: SemanticDocumentTextNode
): PandocStructureParagraph {
  const styleId = paragraphStyleId(node.role);
  return {
    kind: "paragraph",
    ...(styleId ? { styleId } : {}),
    segments: [textValue(node)],
    separator: "space"
  };
}

function projectGroupNode(
  node: SemanticDocumentGroupNode,
  slots: ReturnType<typeof createDocxTokenSlotMap>,
  nextMarker: (kind: string) => string
): PandocStructureBlock | undefined {
  const styleId = paragraphStyleId(node.role);
  if (containerRoles.has(node.role)) {
    const blocks = node.children
      .map((child) => projectNode(child, slots, nextMarker))
      .filter(
        (block): block is PandocStructureBlock =>
          block !== undefined
      );
    return blocks.length
      ? {
          kind: "container",
          ...(styleId ? { styleId } : {}),
          ...(slotName(node.role)
            ? { slot: slotName(node.role) }
            : {}),
          startMarker: nextMarker("container-start"),
          endMarker: nextMarker("container-end"),
          blocks
        }
      : undefined;
  }
  const segments = node.children.flatMap((child) =>
    inlineSegments(child, slots)
  );
  return segments.length
    ? {
        kind: "paragraph",
        ...(styleId ? { styleId } : {}),
        ...(node.layout ? { layout: node.layout } : {}),
        segments,
        separator: segments.length > 1 ? "tab" : "space"
      }
    : undefined;
}

function projectNode(
  node: SemanticDocumentNode,
  slots: ReturnType<typeof createDocxTokenSlotMap>,
  nextMarker: (kind: string) => string
): PandocStructureBlock | undefined {
  if (isHidden(node.role, slots)) {
    return undefined;
  }
  return node.kind === "text"
    ? projectTextNode(node)
    : projectGroupNode(node, slots, nextMarker);
}

export function createPandocStructurePlan(
  modelInput: SemanticDocumentModel,
  tokensInput: DocxThemeTokenSet,
  options: CreatePandocStructurePlanOptions = {}
): PandocStructurePlan {
  const model = semanticDocumentModelSchema.parse(modelInput);
  const slots = createDocxTokenSlotMap(tokensInput);
  const markerSeed = (options.markerSeed ?? "structure")
    .replace(/[^a-z0-9]/giu, "")
    .slice(0, 64);
  if (!markerSeed) {
    throw new Error("DOCX 结构标记种子无效");
  }
  let markerIndex = 0;
  const nextMarker = (kind: string) =>
    `MORPHDOC_${kind.toUpperCase().replace(/-/gu, "_")}_${markerSeed}_${++markerIndex}`;
  const prefix: PandocStructureBlock[] = [];
  const suffix: PandocStructureBlock[] = [];
  for (const region of model.regions) {
    const blocks = region.nodes
      .map((node) => projectNode(node, slots, nextMarker))
      .filter(
        (block): block is PandocStructureBlock =>
          block !== undefined
      );
    if (region.kind === "suffix") {
      suffix.push(...blocks);
      continue;
    }
    prefix.push(...blocks);
    if (
      blocks.length > 0 &&
      region.section?.breakAfter === "next-page"
    ) {
      const firstContainer = blocks.find(
        (
          block
        ): block is PandocStructureContainer =>
          block.kind === "container"
      );
      const verticalAlignment = firstContainer?.slot
        ? slots.get(firstContainer.slot)?.style.verticalAlignment
        : undefined;
      prefix.push({
        kind: "section-break",
        marker: nextMarker("section-break"),
        headerFooter: region.section.headerFooter,
        pageNumber: region.section.pageNumber,
        followingPageNumberStart:
          region.section.followingPageNumberStart,
        ...(verticalAlignment ? { verticalAlignment } : {})
      });
    }
  }
  return {
    schemaVersion: 1,
    metadataPolicy: {
      author: "suppress"
    },
    titlePolicy: model.titlePolicy,
    prefix,
    suffix
  };
}
