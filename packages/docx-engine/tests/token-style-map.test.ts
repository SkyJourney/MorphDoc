import { describe, expect, it } from "vitest";
import type { DocxThemeTokenSet } from "@morphdoc/docx-theme-engine";
import {
  DOCX_SLOT_WORD_STYLE_BINDINGS,
  collectDocxTokenFonts,
  createDocxTokenSlotMap,
  resolvePandocSyntaxStyleSlot,
  resolveTokenFonts
} from "../src/index.js";

const tokens: DocxThemeTokenSet = {
  schemaVersion: 1,
  themeId: "test-theme",
  themeFingerprint: "a".repeat(64),
  mode: "auto",
  basePreset: "general",
  slots: [
    {
      slot: "paragraph",
      source: "computed-css",
      confidence: "exact",
      style: {
        fontCandidates: [
          "Source Han Serif SC",
          "Times New Roman",
          "serif"
        ]
      }
    }
  ],
  diagnostics: []
};

describe("DOCX 令牌样式映射", () => {
  it("以稳定样式 ID 覆盖标准 Markdown 和结构槽位", () => {
    expect(
      DOCX_SLOT_WORD_STYLE_BINDINGS["heading-1"]
    ).toEqual([
      {
        styleId: "Heading1",
        type: "paragraph",
        basedOn: "Normal"
      },
      {
        styleId: "Heading1Char",
        type: "character",
        basedOn: "DefaultParagraphFont"
      }
    ]);
    expect(
      DOCX_SLOT_WORD_STYLE_BINDINGS["official-title"]?.[0]
        ?.styleId
    ).toBe("MdOfficialTitle");
    expect(
      DOCX_SLOT_WORD_STYLE_BINDINGS["tender-representative"]?.[0]
        ?.styleId
    ).toBe("MdTenderRepresentative");
  });

  it("按文字系统选择字体并过滤 CSS 通用族名", () => {
    const slot = createDocxTokenSlotMap(tokens).get("paragraph");
    expect(
      resolveTokenFonts(slot?.style, {
        latin: "Arial",
        eastAsia: "SimSun"
      })
    ).toEqual({
      latin: "Times New Roman",
      eastAsia: "Source Han Serif SC",
      complexScript: "Times New Roman"
    });
    expect([...collectDocxTokenFonts(tokens)]).toEqual([
      "Source Han Serif SC",
      "Times New Roman"
    ]);
    expect(
      resolveTokenFonts(
        { fontCandidates: ["MorphDoc Mono", "monospace"] },
        { latin: "Arial", eastAsia: "MorphDoc Sans SC" },
        { preserveFallbackEastAsia: true }
      )
    ).toEqual({
      latin: "MorphDoc Mono",
      eastAsia: "MorphDoc Sans SC",
      complexScript: "MorphDoc Mono"
    });
  });

  it("将 Pandoc 语法样式映射到引擎级代码语义槽位", () => {
    expect(resolvePandocSyntaxStyleSlot("DataTypeTok", '"key"'))
      .toBe("code-token-attribute");
    expect(resolvePandocSyntaxStyleSlot("DataTypeTok", "<"))
      .toBe("code-token-punctuation");
    expect(
      resolvePandocSyntaxStyleSlot(
        "KeywordTok",
        "section",
        { htmlTagName: true }
      )
    ).toBe("code-token-name");
    expect(resolvePandocSyntaxStyleSlot("StringTok", '"value"'))
      .toBe("code-token-string");
    expect(resolvePandocSyntaxStyleSlot("FunctionTok", ":"))
      .toBe("code-token-punctuation");
    expect(resolvePandocSyntaxStyleSlot("FunctionTok", "render"))
      .toBe("code-token-title");
    expect(resolvePandocSyntaxStyleSlot("NormalTok", " "))
      .toBe("code-block-text");
    expect(
      resolvePandocSyntaxStyleSlot(
        "NormalTok",
        "  method",
        { objectPropertyKey: true }
      )
    ).toBe("code-token-attribute");
    expect(resolvePandocSyntaxStyleSlot("UnknownTok", "x"))
      .toBeUndefined();
  });
});
