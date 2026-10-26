import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  obfuscateDocxFont,
  prepareDocxFont,
  prepareDocxFonts,
  readSfntFontMetadata,
  resolveFontEmbeddingPermission,
  xorDocxFont
} from "../src/font-embedding.js";

const fandolFangUrl = new URL(
  "../../../themes/_shared/official-fonts/FandolFang-Regular.woff2",
  import.meta.url
);
const fandolFaces = [
  ["FandolSong", "FandolSong-Regular.woff2", 400],
  ["FandolSong", "FandolSong-Bold.woff2", 700],
  ["FandolFang", "FandolFang-Regular.woff2", 400],
  ["FandolHei", "FandolHei-Regular.woff2", 400],
  ["FandolKai", "FandolKai-Regular.woff2", 400]
] as const;

describe("DOCX 字体嵌入", () => {
  it("在纯 Node.js 中将 WOFF2 转为可编辑嵌入的 OpenType SFNT", async () => {
    const content = await readFile(fandolFangUrl);
    const prepared = await prepareDocxFont({
      family: "MorphDoc Fandol Fang",
      aliases: ["FangSong", "STFangsong"],
      source:
        "theme-shared:official-fonts/FandolFang-Regular.woff2",
      weight: 400,
      style: "normal",
      license: "GPL-3.0-with-font-exception",
      content
    });

    expect(prepared.metadata).toMatchObject({
      family: "FandolFang",
      subfamily: "Regular",
      postscriptName: "FandolFang-Regular",
      panose: [0, 0, 5, 0, 0, 0, 0, 0, 0, 0],
      unicodeRanges: [0x80000001, 0x00002000, 0x00000002, 0],
      codePageRanges: [0x00060007, 0],
      fixedPitch: false,
      fsType: 0x0008,
      permission: "editable",
      noSubsetting: false,
      signature: "OTTO"
    });
    expect(prepared.sfnt.byteLength).toBeGreaterThan(
      content.byteLength
    );
    expect(
      readSfntFontMetadata(prepared.sfnt)
    ).toEqual(prepared.metadata);
  });

  it("使用稳定字体键混淆前 32 字节并可按同一算法还原", async () => {
    const prepared = await prepareDocxFont({
      family: "MorphDoc Fandol Fang",
      aliases: [],
      source:
        "theme-shared:official-fonts/FandolFang-Regular.woff2",
      weight: 400,
      style: "normal",
      license: "GPL-3.0-with-font-exception",
      content: await readFile(fandolFangUrl)
    });

    const first = obfuscateDocxFont(prepared);
    const second = obfuscateDocxFont(prepared);
    expect(first.fontKey).toBe(second.fontKey);
    expect(first.partName).toBe(second.partName);
    expect(
      Buffer.compare(
        Buffer.from(first.content),
        Buffer.from(second.content)
      )
    ).toBe(0);
    expect(first.fontKey).toMatch(
      /^\{[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}\}$/u
    );
    expect(first.partName).toMatch(/^word\/fonts\/.+\.odttf$/u);
    expect(first.content.subarray(0, 32)).not.toEqual(
      prepared.sfnt.subarray(0, 32)
    );
    expect(
      Buffer.compare(
        Buffer.from(
          xorDocxFont(first.content, first.fontKey)
        ),
        Buffer.from(prepared.sfnt)
      )
    ).toBe(0);
  });

  it("串行调度底层 WASM 并安全准备多个并发 WOFF2 字形", async () => {
    const prepared = await prepareDocxFonts(
      await Promise.all(
        fandolFaces.map(
          async ([family, fileName, weight]) => ({
            family,
            aliases: [],
            source: `theme-shared:official-fonts/${fileName}`,
            weight,
            style: "normal" as const,
            license: "GPL-3.0-with-font-exception",
            content: await readFile(
              new URL(
                `../../../themes/_shared/official-fonts/${fileName}`,
                import.meta.url
              )
            )
          })
        )
      )
    );

    expect(prepared).toHaveLength(5);
    expect(
      prepared.map((font) => font.metadata.family)
    ).toEqual([
      "FandolSong",
      "FandolSong",
      "FandolFang",
      "FandolHei",
      "FandolKai"
    ]);
    expect(
      prepared.map((font) => font.metadata.weightClass)
    ).toEqual([400, 700, 400, 400, 400]);
    expect(
      prepared.every((font) => font.metadata.signature === "OTTO")
    ).toBe(true);
  });

  it("只接受可安装或可编辑嵌入权限", () => {
    expect(resolveFontEmbeddingPermission(0)).toBe("installable");
    expect(resolveFontEmbeddingPermission(0x0008)).toBe("editable");
    expect(() => resolveFontEmbeddingPermission(0x0002)).toThrow(
      "禁止嵌入"
    );
    expect(() => resolveFontEmbeddingPermission(0x0004)).toThrow(
      "仅允许预览和打印"
    );
    expect(() => resolveFontEmbeddingPermission(0x0200)).toThrow(
      "位图"
    );
    expect(() => resolveFontEmbeddingPermission(0x000c)).toThrow(
      "组合无效"
    );
  });

  it("拒绝损坏或非 SFNT 字体", () => {
    expect(() =>
      readSfntFontMetadata(new Uint8Array(64))
    ).toThrow("TrueType 或 OpenType");
  });
});
