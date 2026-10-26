import { describe, expect, it } from "vitest";
import type {
  SemanticDocumentModel,
  SemanticDocumentNode
} from "@morphdoc/core";
import type {
  DocxResolvedStyleSlot,
  DocxStyleSlotName,
  DocxThemeTokenSet
} from "@morphdoc/docx-theme-engine";
import {
  createPandocStructurePlan,
  type PandocStructureBlock
} from "../src/index.js";

function slot(
  name: DocxStyleSlotName,
  hidden = false
): DocxResolvedStyleSlot {
  return {
    slot: name,
    source: "computed-css",
    confidence: "exact",
    style: {
      fontCandidates: [],
      ...(hidden ? { hidden: true } : {})
    }
  };
}

function tokens(
  slots: DocxResolvedStyleSlot[] = []
): DocxThemeTokenSet {
  return {
    schemaVersion: 1,
    themeId: "test-theme",
    themeFingerprint: "c".repeat(64),
    mode: "auto-with-overrides",
    basePreset: "technical",
    slots,
    diagnostics: []
  };
}

function text(
  role: Extract<SemanticDocumentNode, { kind: "text" }>["role"],
  value: string,
  label?: string
): SemanticDocumentNode {
  return {
    kind: "text",
    role,
    text: value,
    ...(label ? { label } : {})
  };
}

function paragraphSegments(block: PandocStructureBlock): string[] {
  if (block.kind === "paragraph") {
    return block.segments;
  }
  if (block.kind === "container") {
    return block.blocks.flatMap(paragraphSegments);
  }
  return [];
}

describe("Pandoc 语义结构投影", () => {
  it("将简报抬头文字映射到父级抬头样式", () => {
    const model: SemanticDocumentModel = {
      schemaVersion: 1,
      profile: "briefing",
      titlePolicy: {
        metadataTitle: "suppress",
        firstBodyHeading: "keep"
      },
      regions: [{
        kind: "prefix",
        nodes: [{
          kind: "group",
          role: "briefing-masthead",
          children: [text("briefing-masthead-text", "工作简报")]
        }]
      }]
    };
    const plan = createPandocStructurePlan(model, tokens(), {
      markerSeed: "briefing"
    });
    expect(plan.prefix[0]).toMatchObject({
      kind: "container",
      blocks: [{
        kind: "paragraph",
        styleId: "MdBriefingMastheadText",
        segments: ["工作简报"]
      }]
    });
  });

  it("将公文分组投影为固定 Word 样式和可编辑段落", () => {
    const model: SemanticDocumentModel = {
      schemaVersion: 1,
      profile: "official",
      titlePolicy: {
        metadataTitle: "suppress",
        firstBodyHeading: "suppress"
      },
      regions: [
        {
          kind: "prefix",
          nodes: [
            {
              kind: "group",
              role: "official-masthead",
              children: [
                {
                  kind: "group",
                  role: "official-classification",
                  layout: "space-between",
                  children: [
                    text("official-secrecy", "秘密"),
                    text("official-urgency", "特急")
                  ]
                },
                text("official-issuer", "示例单位"),
                {
                  kind: "group",
                  role: "official-issue-row",
                  layout: "space-between",
                  children: [
                    text("official-number", "示例〔2026〕1号"),
                    text(
                      "official-signatory",
                      "张三",
                      "签发人："
                    )
                  ]
                }
              ]
            },
            text("official-title", "关于开展工作的通知")
          ]
        }
      ]
    };

    const plan = createPandocStructurePlan(model, tokens(), {
      markerSeed: "official"
    });

    expect(plan.metadataPolicy.author).toBe("suppress");
    expect(plan.titlePolicy.firstBodyHeading).toBe("suppress");
    expect(plan.prefix[0]).toMatchObject({
      kind: "container",
      styleId: "MdOfficialMasthead",
      slot: "official-masthead",
      startMarker:
        "MORPHDOC_CONTAINER_START_official_1",
      endMarker: "MORPHDOC_CONTAINER_END_official_2",
      blocks: [
        {
          kind: "paragraph",
          styleId: "MdOfficialClassification",
          layout: "space-between",
          segments: ["秘密", "特急"],
          separator: "tab"
        },
        {
          kind: "paragraph",
          styleId: "MdOfficialIssuer",
          segments: ["示例单位"]
        },
        {
          kind: "paragraph",
          styleId: "MdOfficialIssueRow",
          layout: "space-between",
          segments: ["示例〔2026〕1号", "签发人：张三"],
          separator: "tab"
        }
      ]
    });
    expect(plan.prefix[1]).toMatchObject({
      kind: "paragraph",
      styleId: "MdOfficialTitle",
      segments: ["关于开展工作的通知"]
    });
  });

  it("按主题隐藏令牌过滤标书字段并保留封面分页", () => {
    const model: SemanticDocumentModel = {
      schemaVersion: 1,
      profile: "tender",
      titlePolicy: {
        metadataTitle: "suppress",
        firstBodyHeading: "suppress"
      },
      regions: [
        {
          kind: "cover",
          section: {
            headerFooter: "none",
            pageNumber: "hidden",
            breakAfter: "next-page",
            followingPageNumberStart: 1
          },
          nodes: [
            {
              kind: "group",
              role: "tender-cover",
              children: [
                text("tender-title", "投标文件"),
                text("tender-bidder", "投标单位"),
                text(
                  "tender-representative",
                  "授权代表"
                ),
                text("tender-date", "2026年7月")
              ]
            }
          ]
        }
      ]
    };

    const plan = createPandocStructurePlan(
      model,
      tokens([
        slot("tender-bidder", true),
        slot("tender-representative", true)
      ]),
      { markerSeed: "tender" }
    );

    expect(plan.prefix.at(-1)).toEqual({
      kind: "section-break",
      marker: "MORPHDOC_SECTION_BREAK_tender_3",
      headerFooter: "none",
      pageNumber: "hidden",
      followingPageNumberStart: 1
    });
    expect(plan.prefix[0]).toMatchObject({
      kind: "container",
      styleId: "MdTenderCover"
    });
    expect(paragraphSegments(plan.prefix[0]!)).toEqual([
      "投标文件",
      "2026年7月"
    ]);
  });

  it("没有结构区域时只传递标题策略", () => {
    const plan = createPandocStructurePlan(
      {
        schemaVersion: 1,
        titlePolicy: {
          metadataTitle: "emit",
          firstBodyHeading: "keep"
        },
        regions: []
      },
      tokens(),
      { markerSeed: "empty" }
    );

    expect(plan).toEqual({
      schemaVersion: 1,
      metadataPolicy: {
        author: "suppress"
      },
      titlePolicy: {
        metadataTitle: "emit",
        firstBodyHeading: "keep"
      },
      prefix: [],
      suffix: []
    });
  });
});
