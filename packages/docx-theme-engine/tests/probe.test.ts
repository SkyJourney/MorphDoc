import { describe, expect, it } from "vitest";
import {
  DOCX_STYLE_SLOT_NAMES,
  collectDocxStyleSlotSnapshots,
  collectDocxThemeStyleSnapshot,
  createDocxStyleProbeMarkup,
  listDocxStyleProbeSlots,
  readDocxComputedStyle,
  validateDocxStyleProbeMarkup,
  type DocxComputedStyle,
  type DocxStyleProbeRoot
} from "../src/index.js";

const computedStyle: DocxComputedStyle = {
  fontFamily: '"Microsoft YaHei", sans-serif',
  fontSize: "16px",
  fontWeight: "400",
  fontStyle: "normal",
  color: "rgb(17, 17, 17)",
  backgroundColor: "rgba(0, 0, 0, 0)",
  lineHeight: "28px",
  letterSpacing: "normal",
  textAlign: "start",
  direction: "ltr",
  textIndent: "32px",
  textDecorationLine: "none",
  marginTop: "0px",
  marginRight: "0px",
  marginBottom: "12px",
  marginLeft: "0px",
  paddingTop: "0px",
  paddingRight: "0px",
  paddingBottom: "0px",
  paddingLeft: "0px",
  borderTop: "0px none rgb(17, 17, 17)",
  borderRight: "0px none rgb(17, 17, 17)",
  borderBottom: "0px none rgb(17, 17, 17)",
  borderLeft: "0px none rgb(17, 17, 17)",
  width: "640px",
  maxWidth: "none",
  minWidth: "0px",
  minHeight: "0px",
  height: "28px",
  breakBefore: "auto",
  breakAfter: "auto",
  breakInside: "auto",
  display: "block",
  flexDirection: "row",
  alignItems: "normal",
  justifyContent: "normal",
  outline: "0px none rgb(17, 17, 17)",
  outlineOffset: "0px"
};

function createRoot(matchedSlots: readonly string[]): DocxStyleProbeRoot {
  const selectors = new Set(
    matchedSlots.map(
      (slot) => `[data-docx-slot="${slot}"]`
    )
  );
  return {
    querySelector(selector) {
      return selectors.has(selector) ? { selector } : null;
    }
  };
}

describe("DOCX 标准样式探针", () => {
  it("每个标准槽位在探针中恰好出现一次", () => {
    const markup = createDocxStyleProbeMarkup();
    expect(() => validateDocxStyleProbeMarkup(markup)).not.toThrow();
    const slots = listDocxStyleProbeSlots(markup);
    expect(slots).toHaveLength(DOCX_STYLE_SLOT_NAMES.length);
    expect(new Set(slots)).toEqual(
      new Set(DOCX_STYLE_SLOT_NAMES)
    );
    expect(markup).toMatch(
      /^<article id="write"[^>]*>\s*<h1 data-docx-slot="heading-1">/u
    );
    expect(markup).toContain('<code class="language-javascript"');
    expect(markup).not.toContain('<code class="hljs ');
  });

  it("拒绝缺失和重复槽位的探针", () => {
    const markup = createDocxStyleProbeMarkup()
      .replace('data-docx-slot="paragraph"', "")
      .replace(
        "</article>",
        '<p data-docx-slot="strong">重复</p></article>'
      );
    expect(() => validateDocxStyleProbeMarkup(markup)).toThrow(
      /重复槽位：strong；缺少槽位：paragraph/u
    );
  });
});

describe("DOCX 计算样式采集", () => {
  it("按稳定槽位顺序采集并保留未命中状态", () => {
    const slots = collectDocxStyleSlotSnapshots(
      createRoot(["document", "paragraph"]),
      () => readDocxComputedStyle(computedStyle)
    );
    expect(slots).toHaveLength(DOCX_STYLE_SLOT_NAMES.length);
    expect(slots[0]).toMatchObject({
      slot: "document",
      matched: true,
      computed: { fontSize: "16px" }
    });
    expect(
      slots.find((entry) => entry.slot === "paragraph")
    ).toMatchObject({ matched: true });
    expect(
      slots.find((entry) => entry.slot === "heading-1")
    ).toEqual({ slot: "heading-1", matched: false });
  });

  it("生成可校验且与平台实现无关的主题快照", () => {
    const snapshot = collectDocxThemeStyleSnapshot({
      root: createRoot(DOCX_STYLE_SLOT_NAMES),
      readComputedStyle: () =>
        readDocxComputedStyle(computedStyle),
      themeId: "external-clean",
      themeFingerprint: "c".repeat(64),
      viewport: {
        widthPx: 794,
        heightPx: 1123,
        deviceScaleFactor: 1
      },
      rootFontSizePx: 16
    });
    expect(snapshot.slots).toHaveLength(
      DOCX_STYLE_SLOT_NAMES.length
    );
    expect(snapshot.slots.every((slot) => slot.matched)).toBe(true);
  });
});
