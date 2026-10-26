import { describe, expect, it } from "vitest";
import type { SfntFontMetadata } from "../src/font-embedding.js";
import { createWordFontMetadata } from "../src/word-font-metadata.js";

function metadata(
  overrides: Partial<SfntFontMetadata> = {}
): SfntFontMetadata {
  return {
    family: "Test Font",
    subfamily: "Regular",
    weightClass: 400,
    panose: [2, 2, 5, 3, 5, 4, 5, 2, 3, 4],
    unicodeRanges: [
      0x20000083,
      0x2adf3c10,
      0x00000016,
      0
    ],
    codePageRanges: [0x60060107, 0],
    fixedPitch: false,
    fsType: 0,
    permission: "installable",
    noSubsetting: false,
    signature: "\u0000\u0001\u0000\u0000",
    ...overrides
  };
}

describe("Word 字体元数据映射", () => {
  it("将 CJK Serif 的 OS/2 范围映射为简体中文 Word 字体签名", () => {
    expect(createWordFontMetadata(metadata())).toEqual({
      panose1: "02020503050405020304",
      charset: "86",
      family: "roman",
      pitch: "variable",
      signature: {
        usb0: "20000083",
        usb1: "2ADF3C10",
        usb2: "00000016",
        usb3: "00000000",
        csb0: "60060107",
        csb1: "00000000"
      }
    });
  });

  it("根据 Panose 与固定字距通用推导 Word 字体族", () => {
    expect(
      createWordFontMetadata(
        metadata({
          panose: [2, 11, 5, 3, 5, 4, 5, 2, 3, 4]
        })
      ).family
    ).toBe("swiss");
    expect(
      createWordFontMetadata(
        metadata({
          panose: [3, 0, 5, 3, 5, 4, 5, 2, 3, 4]
        })
      ).family
    ).toBe("script");
    expect(
      createWordFontMetadata(
        metadata({
          fixedPitch: true
        })
      )
    ).toMatchObject({
      family: "modern",
      pitch: "fixed"
    });
  });

  it("在没有 CJK code-page 位时选择对应 charset 或默认 ANSI", () => {
    expect(
      createWordFontMetadata(
        metadata({ codePageRanges: [1 << 2, 0] })
      ).charset
    ).toBe("CC");
    expect(
      createWordFontMetadata(
        metadata({ codePageRanges: [0, 0] })
      ).charset
    ).toBe("00");
  });
});
