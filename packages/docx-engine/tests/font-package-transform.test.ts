import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { prepareDocxFont, xorDocxFont } from "../src/font-embedding.js";
import { embedFontsInGeneratedDocx } from "../src/font-package-transform.js";
import {
  readGeneratedDocxPackage,
  writeGeneratedDocxPackage
} from "../src/reference-package.js";
import { validateGeneratedDocx } from "../src/validator.js";
import { createTestBaselineReference } from "./reference-test-fixture.js";

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const wordNamespace =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const relationshipNamespace =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const fandolFangUrl = new URL(
  "../../../themes/_shared/official-fonts/FandolFang-Regular.woff2",
  import.meta.url
);

describe("DOCX 字体包写入", () => {
  it("写入 ODTTF、字体关系和内容类型并替换逻辑字体名", async () => {
    const source = readGeneratedDocxPackage(
      createTestBaselineReference()
    );
    const entries = new Map(source.entries);
    const originalStyles = decoder.decode(
      entries.get("word/styles.xml")
    );
    entries.set(
      "word/styles.xml",
      encoder.encode(
        originalStyles.replace(
          "<w:rPr/>",
          '<w:rPr><w:rFonts w:ascii="MorphDoc Fandol Fang" w:hAnsi="MorphDoc Fandol Fang" w:eastAsia="FangSong"/></w:rPr>'
        ).replace(
          "</w:styles>",
          '<w:style w:type="paragraph" w:styleId="SourceCode"><w:name w:val="Source Code"/></w:style></w:styles>'
        )
      )
    );
    entries.set(
      "word/document.xml",
      encoder.encode(
        decoder
          .decode(entries.get("word/document.xml"))
          .replace(
            "<w:footnotePr/>",
            '<w:footnotePr/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>'
          )
      )
    );
    const input = writeGeneratedDocxPackage(entries);
    const font = await prepareDocxFont({
      family: "MorphDoc Fandol Fang",
      aliases: ["FangSong", "STFangsong"],
      source:
        "theme-shared:official-fonts/FandolFang-Regular.woff2",
      weight: 400,
      style: "normal",
      license: "GPL-3.0-with-font-exception",
      content: await readFile(fandolFangUrl)
    });

    const result = embedFontsInGeneratedDocx(input, [font]);
    const output = readGeneratedDocxPackage(result.content);
    const fontParts = [...output.entries.keys()].filter((name) =>
      /^word\/fonts\/.+\.odttf$/u.test(name)
    );
    expect(result.report).toMatchObject({
      embeddedFaceCount: 1,
      embeddedFamilyCount: 1,
      replacedFontReferenceCount: 3,
      totalSfntBytes: font.sfnt.byteLength
    });
    expect(fontParts).toHaveLength(1);

    const contentTypes = decoder.decode(
      output.entries.get("[Content_Types].xml")
    );
    expect(contentTypes).toContain(
      'Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"'
    );
    const relationships = decoder.decode(
      output.entries.get("word/_rels/fontTable.xml.rels")
    );
    expect(relationships).toContain(
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font"'
    );
    expect(relationships).toContain(
      `Target="${fontParts[0]!.replace(/^word\//u, "")}"`
    );

    const fontTable = decoder.decode(
      output.entries.get("word/fontTable.xml")
    );
    expect(fontTable).toContain('w:name="FandolFang"');
    expect(fontTable).toContain(
      '<w:panose1 w:val="00000500000000000000"/>'
    );
    expect(fontTable).toContain('<w:charset w:val="86"/>');
    expect(fontTable).toContain('<w:family w:val="auto"/>');
    expect(fontTable).toContain('<w:pitch w:val="variable"/>');
    expect(fontTable).toContain(
      '<w:sig w:usb0="80000001" w:usb1="00002000" w:usb2="00000002" w:usb3="00000000" w:csb0="00060007" w:csb1="00000000"/>'
    );
    expect(fontTable).toContain("<w:embedRegular");
    expect(fontTable).toContain(
      `xmlns:r="${relationshipNamespace}"`
    );
    const fontKey = /w:fontKey="([^"]+)"/u.exec(fontTable)?.[1];
    expect(fontKey).toBeTruthy();
    expect(
      Buffer.compare(
        Buffer.from(
          xorDocxFont(
            output.entries.get(fontParts[0]!)!,
            fontKey!
          )
        ),
        Buffer.from(font.sfnt)
      )
    ).toBe(0);

    const styles = decoder.decode(
      output.entries.get("word/styles.xml")
    );
    expect(styles).not.toContain("MorphDoc Fandol Fang");
    expect(styles).not.toContain("FangSong");
    expect(styles.match(/FandolFang/gu)).toHaveLength(3);
    expect(validateGeneratedDocx(result.content)).toMatchObject({
      embeddedFontCount: 1
    });

    const invalidEntries = new Map(output.entries);
    invalidEntries.set(
      "word/fontTable.xml",
      encoder.encode(
        fontTable.replace(
          '<w:charset w:val="86"/>',
          '<w:charset w:val="00"/>'
        )
      )
    );
    expect(() =>
      validateGeneratedDocx(
        writeGeneratedDocxPackage(invalidEntries)
      )
    ).toThrow("字体元数据与嵌入字形不匹配");
  }, 15_000);

  it("没有字体时保持原始 DOCX 字节不变", () => {
    const input = createTestBaselineReference();
    const result = embedFontsInGeneratedDocx(input, []);
    expect(result.content).toBe(input);
    expect(result.report.embeddedFaceCount).toBe(0);
  });
});
