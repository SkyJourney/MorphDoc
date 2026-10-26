import { describe, expect, it } from "vitest";
import {
  DOCX_STYLE_SLOT_NAMES,
  millimetersToPoints,
  parseCssBorder,
  parseCssColor,
  parseCssLinearGradientFallbackColor,
  parseCssFontFamilies,
  parseCssLengthToPt,
  resolveDocxThemeTokens,
  type DocxComputedStyle,
  type DocxStyleSlotName,
  type DocxThemeStyleSnapshot
} from "../src/index.js";

const computed: DocxComputedStyle = {
  fontFamily:
    '"Noto Serif CJK SC", "Microsoft YaHei", serif',
  fontSize: "16px",
  fontWeight: "400",
  fontStyle: "normal",
  color: "rgb(17, 34, 51)",
  backgroundColor: "rgba(0, 0, 0, 0)",
  lineHeight: "24px",
  letterSpacing: "normal",
  textAlign: "start",
  direction: "ltr",
  textIndent: "32px",
  textDecorationLine: "none",
  marginTop: "8px",
  marginRight: "0px",
  marginBottom: "12px",
  marginLeft: "0px",
  paddingTop: "4px",
  paddingRight: "8px",
  paddingBottom: "4px",
  paddingLeft: "8px",
  borderTop: "0px none rgb(17, 34, 51)",
  borderRight: "0px none rgb(17, 34, 51)",
  borderBottom: "1px solid rgb(221, 221, 221)",
  borderLeft: "0px none rgb(17, 34, 51)",
  width: "640px",
  maxWidth: "none",
  minWidth: "0px",
  minHeight: "0px",
  height: "24px",
  breakBefore: "auto",
  breakAfter: "avoid-page",
  breakInside: "avoid",
  display: "block",
  flexDirection: "row",
  alignItems: "normal",
  justifyContent: "normal",
  outline: "0px none rgb(17, 34, 51)",
  outlineOffset: "0px"
};

function createSnapshot(
  changes: Partial<
    Record<DocxStyleSlotName, Partial<DocxComputedStyle> | null>
  > = {}
): DocxThemeStyleSnapshot {
  return {
    schemaVersion: 1,
    themeId: "external-clean",
    themeFingerprint: "e".repeat(64),
    viewport: {
      widthPx: 794,
      heightPx: 1123,
      deviceScaleFactor: 1
    },
    rootFontSizePx: 16,
    slots: DOCX_STYLE_SLOT_NAMES.map((slot) => {
      const change = changes[slot];
      if (change === null) {
        return { slot, matched: false };
      }
      return {
        slot,
        matched: true,
        computed: {
          ...computed,
          ...change
        }
      };
    })
  };
}

function findSlot(
  tokens: ReturnType<typeof resolveDocxThemeTokens>,
  name: DocxStyleSlotName
) {
  const slot = tokens.slots.find((entry) => entry.slot === name);
  if (!slot) {
    throw new Error(`缺少令牌槽位 ${name}`);
  }
  return slot;
}

describe("CSS 到 Word 基础值归一化", () => {
  it("换算浏览器长度、颜色、字体列表和边框", () => {
    expect(parseCssLengthToPt("16px")).toBe(12);
    expect(parseCssLengthToPt("25.4mm")).toBe(72);
    expect(millimetersToPoints(2)).toBeCloseTo(5.669, 3);
    expect(parseCssColor("rgb(17, 34, 51)")).toBe("#112233");
    expect(parseCssColor("rgba(0, 0, 0, 0)")).toBeUndefined();
    expect(parseCssColor("rgba(255, 0, 0, 0.5)")).toBe("#ff8080");
    expect(parseCssColor("#00000080")).toBe("#7f7f7f");
    expect(parseCssLinearGradientFallbackColor(
      "linear-gradient(90deg, rgb(239, 246, 255), rgba(0, 0, 0, 0))"
    )).toBe("#eff6ff");
    expect(parseCssLinearGradientFallbackColor(
      "radial-gradient(rgb(239, 246, 255), transparent)"
    )).toBeUndefined();
    expect(
      parseCssFontFamilies(
        '"Source Han Serif SC", "Microsoft YaHei", serif'
      )
    ).toEqual([
      "Source Han Serif SC",
      "Microsoft YaHei",
      "serif"
    ]);
    expect(parseCssBorder("1px dashed rgb(17, 34, 51)"))
      .toEqual({
        widthPt: 0.75,
        color: "#112233",
        style: "dashed",
        approximated: false
      });
    expect(parseCssBorder("rgb(119, 119, 119) solid 1px"))
      .toMatchObject({
        widthPt: 0.75,
        color: "#777777",
        style: "single"
      });
    expect(parseCssBorder("0px none rgba(0, 0, 0, 0)"))
      .toMatchObject({
        widthPt: 0,
        style: "none"
      });
  });
});

describe("DOCX 主题令牌归一化", () => {
  it("按槽位语义映射文本、段落、边框和分页", () => {
    const tokens = resolveDocxThemeTokens({
      snapshot: createSnapshot(),
      config: {
        mode: "auto",
        basePreset: "general",
        overrides: {},
        legacyPreset: false
      }
    });
    const paragraph = findSlot(tokens, "paragraph");
    expect(paragraph.source).toBe("computed-css");
    expect(paragraph.confidence).toBe("exact");
    expect(paragraph.style).toMatchObject({
      fontCandidates: [
        "Noto Serif CJK SC",
        "Microsoft YaHei",
        "serif"
      ],
      fontSizePt: 12,
      color: "#112233",
      lineSpacing: 1.5,
      alignment: "left",
      firstLineIndentPt: 24,
      spacingBeforePt: 6,
      spacingAfterPt: 9,
      keepLines: true,
      keepWithNext: true,
      borders: {
        bottom: {
          widthPt: 0.75,
          color: "#dddddd",
          style: "single"
        }
      }
    });
    expect(findSlot(tokens, "strong").style)
      .not.toHaveProperty("firstLineIndentPt");
    expect(findSlot(tokens, "inline-code").style.paddingPt).toEqual({
      top: 3,
      right: 6,
      bottom: 3,
      left: 6
    });
    expect(findSlot(tokens, "table").style.widthPercent).toBe(100);
    expect(tokens.slots).toHaveLength(DOCX_STYLE_SLOT_NAMES.length);
  });

  it("将线性渐变首个实色近似为 Word 段落底纹", () => {
    const tokens = resolveDocxThemeTokens({
      snapshot: createSnapshot({
        "heading-2": {
          backgroundColor: "rgba(0, 0, 0, 0)",
          backgroundImage:
            "linear-gradient(90deg, rgb(239, 246, 255), rgba(0, 0, 0, 0))"
        }
      }),
      config: {
        mode: "auto",
        basePreset: "general",
        overrides: {},
        legacyPreset: false
      }
    });

    expect(findSlot(tokens, "heading-2").style.backgroundColor)
      .toBe("#eff6ff");
    expect(tokens.diagnostics).toContainEqual(expect.objectContaining({
      slot: "heading-2",
      code: "layout-approximated",
      property: "background-image"
    }));
  });

  it("按 border-box 文档的内容区宽度归一化全宽表格", () => {
    const tokens = resolveDocxThemeTokens({
      snapshot: createSnapshot({
        document: {
          width: "790px",
          paddingLeft: "30px",
          paddingRight: "30px",
          borderLeft: "0px none rgb(17, 34, 51)",
          borderRight: "0px none rgb(17, 34, 51)"
        },
        table: {
          width: "730px"
        }
      }),
      config: {
        mode: "auto",
        basePreset: "general",
        overrides: {},
        legacyPreset: false
      }
    });

    expect(findSlot(tokens, "table").style.widthPercent).toBe(100);
  });

  it("引用块组合容器盒模型与内部段落文字样式", () => {
    const tokens = resolveDocxThemeTokens({
      snapshot: createSnapshot({
        "block-quote": {
          fontSize: "24px",
          paddingLeft: "20px",
          borderLeft: "4px solid rgb(122, 122, 122)"
        },
        "block-quote-text": {
          fontFamily: '"Merriweather", serif',
          fontSize: "16px",
          fontStyle: "italic",
          lineHeight: "24px",
          paddingLeft: "0px",
          borderLeft: "0px none rgb(17, 34, 51)"
        }
      }),
      config: {
        mode: "auto",
        basePreset: "general",
        overrides: {},
        legacyPreset: false
      }
    });

    expect(findSlot(tokens, "block-quote").style).toMatchObject({
      fontCandidates: ["Merriweather", "serif"],
      fontSizePt: 12,
      italic: true,
      lineSpacing: 1.5,
      paddingPt: { left: 15 },
      borders: {
        left: { widthPt: 3, color: "#7a7a7a", style: "single" }
      }
    });
  });

  it("按父级内容区归一化右置百分比结构容器", () => {
    const tokens = resolveDocxThemeTokens({
      snapshot: createSnapshot({
        "official-signature": {
          width: "332.8px",
          containingBlockWidth: "640px",
          marginLeft: "307.2px",
          marginRight: "0px",
          textAlign: "center"
        }
      }),
      config: {
        mode: "auto",
        basePreset: "official",
        overrides: {},
        legacyPreset: false
      }
    });

    expect(findSlot(tokens, "official-signature").style).toMatchObject({
      widthPercent: 52,
      leftIndentPt: 230.4,
      rightIndentPt: 0,
      alignment: "center"
    });
  });

  it("保留封面高度、垂直对齐、轮廓线和隐藏字段语义", () => {
    const tokens = resolveDocxThemeTokens({
      snapshot: createSnapshot({
        "tender-cover": {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "220mm",
          borderBottom: "0px none rgb(17, 34, 51)",
          outline: "1px solid rgb(119, 119, 119)",
          outlineOffset: "-16px"
        },
        "tender-bidder": {
          display: "none",
          alignSelf: "flex-end",
          contentPaddingLeft: "8px"
        }
      }),
      config: {
        mode: "auto",
        basePreset: "tender",
        overrides: {},
        legacyPreset: false
      }
    });
    const cover = findSlot(tokens, "tender-cover");
    expect(cover.confidence).toBe("approximate");
    expect(cover.style).toMatchObject({
      minimumHeightPt: 623.622,
      verticalAlignment: "center",
      childAlignment: "center",
      borders: {
        top: {
          widthPt: 0.75,
          color: "#777777",
          style: "single"
        }
      }
    });
    expect(findSlot(tokens, "tender-bidder").style).toMatchObject({
      hidden: true,
      selfAlignment: "right",
      contentPaddingLeftPt: 6
    });
    expect(
      tokens.diagnostics.some(
        (entry) =>
          entry.slot === "tender-cover" &&
          entry.code === "css-property-unsupported" &&
          entry.property === "outline-offset"
      )
    ).toBe(true);
  });

  it("保留结构槽位的实际宽度以映射 Flex 子项位置", () => {
    const tokens = resolveDocxThemeTokens({
      snapshot: createSnapshot({
        document: {
          width: "640px",
          paddingLeft: "8px",
          paddingRight: "8px"
        },
        "project-report-owner": {
          minWidth: "70%"
        }
      }),
      config: {
        mode: "auto",
        basePreset: "formal",
        overrides: {},
        legacyPreset: false
      }
    });

    expect(
      findSlot(tokens, "project-report-owner").style.minimumWidthPercent
    ).toBe(70);
  });

  it("将超出 Word 能力的装饰边收敛并生成诊断", () => {
    const tokens = resolveDocxThemeTokens({
      snapshot: createSnapshot({
        "tender-cover": {
          borderTop: "40px solid rgb(18, 85, 138)",
          outline: "1px solid rgb(119, 119, 119)",
          outlineOffset: "-16px"
        }
      }),
      config: {
        mode: "auto",
        basePreset: "tender",
        overrides: {},
        legacyPreset: false
      }
    });
    expect(
      findSlot(tokens, "tender-cover").style.borders?.top?.widthPt
    ).toBe(20);
    expect(findSlot(tokens, "tender-cover").style).toMatchObject({
      outline: {
        widthPt: 0.75,
        color: "#777777",
        style: "single"
      },
      outlineOffsetPt: -12
    });
    expect(
      tokens.diagnostics.some(
        (entry) =>
          entry.slot === "tender-cover" &&
          entry.property === "border-top" &&
          entry.code === "layout-approximated"
      )
    ).toBe(true);
    expect(
      tokens.diagnostics.some(
        (entry) =>
          entry.slot === "tender-cover" &&
          entry.property === "outline" &&
          entry.code === "layout-approximated"
      )
    ).toBe(true);
  });

  it("旧版清单仅补齐自动值，并在未命中时显式降级", () => {
    const tokens = resolveDocxThemeTokens({
      snapshot: createSnapshot({ caption: null }),
      config: {
        mode: "auto-with-overrides",
        basePreset: "formal",
        legacyPreset: true,
        overrides: {
          body: {
            sizePt: 11,
            firstLineIndentChars: 2
          },
          hyperlink: {
            color: "#aa0000",
            underline: false
          }
        }
      }
    });
    expect(findSlot(tokens, "paragraph")).toMatchObject({
      source: "computed-css",
      confidence: "exact",
      style: {
        fontSizePt: 12,
        firstLineIndentPt: 24
      }
    });
    expect(findSlot(tokens, "hyperlink").style).toMatchObject({
      color: "#112233",
      underline: false
    });
    expect(findSlot(tokens, "caption")).toMatchObject({
      source: "preset-fallback",
      confidence: "fallback",
      style: { fontCandidates: [] }
    });
    expect(
      tokens.diagnostics.some(
        (entry) =>
          entry.slot === "caption" &&
          entry.code === "slot-not-found"
      )
    ).toBe(true);
  });

  it("非旧版自动清单仍可显式覆盖 CSS 计算值", () => {
    const tokens = resolveDocxThemeTokens({
      snapshot: createSnapshot(),
      config: {
        mode: "auto-with-overrides",
        basePreset: "formal",
        legacyPreset: false,
        overrides: {
          headings: { color: "#aa0000" }
        }
      }
    });
    expect(findSlot(tokens, "heading-1")).toMatchObject({
      source: "manifest-override",
      style: { color: "#aa0000" }
    });
  });

  it("显式模式不读取 CSS，仅使用覆盖与预设降级", () => {
    const tokens = resolveDocxThemeTokens({
      snapshot: createSnapshot(),
      config: {
        mode: "explicit",
        basePreset: "technical",
        legacyPreset: false,
        overrides: {
          headings: {
            sizesPt: [24, 20, 18, 16, 14, 12]
          }
        }
      }
    });
    expect(findSlot(tokens, "paragraph").source)
      .toBe("preset-fallback");
    expect(findSlot(tokens, "heading-3")).toMatchObject({
      source: "manifest-override",
      style: { fontSizePt: 18 }
    });
  });
});
