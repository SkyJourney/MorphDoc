import { describe, expect, it } from "vitest";
import type { DocxThemeTokenSet } from "@morphdoc/docx-theme-engine";
import {
  finalizeGeneratedDocxStructure,
  readGeneratedDocxPackage,
  readReferenceDocxPackage,
  writeGeneratedDocxPackage,
  type PandocMediaLayoutItem,
  type PandocStructurePlan
} from "../src/index.js";
import { createTestBaselineReference } from "./reference-test-fixture.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const word =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const relationships =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const wordprocessingDrawing =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const drawing =
  "http://schemas.openxmlformats.org/drawingml/2006/main";
const picture =
  "http://schemas.openxmlformats.org/drawingml/2006/picture";
const math =
  "http://schemas.openxmlformats.org/officeDocument/2006/math";

function generatedFixture() {
  const baseline = readReferenceDocxPackage(
    createTestBaselineReference()
  );
  const entries = new Map(baseline.entries);
  entries.set(
    "word/document.xml",
    encoder.encode(
      `<w:document xmlns:w="${word}" xmlns:r="${relationships}"><w:body>` +
        `<w:p><w:r><w:t>CONTAINER_START</w:t></w:r></w:p>` +
        `<w:p><w:pPr><w:pStyle w:val="MdOfficialIssueRow"/></w:pPr><w:r><w:t>期号</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>发布单位</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>签发人</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>日期</w:t></w:r></w:p>` +
        `<w:p><w:pPr><w:pStyle w:val="MdTenderTitle"/></w:pPr><w:r><w:t>可编辑封面</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>CONTAINER_END</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>SECTION_BREAK</w:t></w:r></w:p>` +
        `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>正文标题</w:t></w:r></w:p>` +
        `<w:p><w:pPr><w:pStyle w:val="SourceCode"/></w:pPr>` +
        `<w:r><w:rPr><w:rStyle w:val="DataTypeTok"/></w:rPr><w:t>&lt;</w:t></w:r>` +
        `<w:r><w:rPr><w:rStyle w:val="KeywordTok"/></w:rPr><w:t>br</w:t></w:r>` +
        `<w:r><w:rPr><w:rStyle w:val="DataTypeTok"/></w:rPr><w:t>&gt;</w:t></w:r></w:p>` +
        `<w:p><w:pPr><w:pStyle w:val="SourceCode"/></w:pPr>` +
        `<w:r><w:rPr><w:rStyle w:val="NormalTok"/></w:rPr><w:t xml:space="preserve">  method</w:t></w:r>` +
        `<w:r><w:rPr><w:rStyle w:val="OperatorTok"/></w:rPr><w:t>:</w:t></w:r>` +
        `<w:r><w:rPr><w:rStyle w:val="StringTok"/></w:rPr><w:t xml:space="preserve"> "POST"</w:t></w:r></w:p>` +
        `<w:p><w:pPr><w:pStyle w:val="FirstParagraph"/></w:pPr><w:r><w:drawing>` +
        `<wp:inline xmlns:wp="${wordprocessingDrawing}"><wp:extent cx="100" cy="200"/><wp:docPr id="1" name="Picture" descr="Mermaid 图表 1" title="morphdoc-media:docx-media-1"/>` +
        `<a:graphic xmlns:a="${drawing}"><a:graphicData uri="${picture}"><pic:pic xmlns:pic="${picture}"><pic:nvPicPr><pic:cNvPr id="0" name="image.png"/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm rot="60000" flipH="1"><a:off x="0" y="0"/><a:ext cx="100" cy="200"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
        `</wp:inline></w:drawing></w:r></w:p>` +
        `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr/><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:tcPr/><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc><w:tc><w:tcPr/><w:p><w:r><w:t>单元格前</w:t></w:r><w:r><w:rPr><w:rStyle w:val="VerbatimChar"/></w:rPr><w:t>morphdoc_ic_c</w:t></w:r><w:r><w:t>单元格后</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
        `<w:p><w:pPr><w:pStyle w:val="MdOfficialSignatureDate"/></w:pPr><w:r><w:t>2026年7月29日</w:t></w:r></w:p>` +
        `<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000"/><w:pgNumType w:start="5"/><w:titlePg/></w:sectPr>` +
        `</w:body></w:document>`
    )
  );
  entries.set(
    "word/footer1.xml",
    encoder.encode(
      `<w:ftr xmlns:w="${word}"><w:p><w:r><w:instrText xml:space="preserve"> NUMPAGES \\* MERGEFORMAT </w:instrText></w:r></w:p></w:ftr>`
    )
  );
  return writeGeneratedDocxPackage(entries);
}

const plan: PandocStructurePlan = {
  schemaVersion: 1,
  metadataPolicy: {
    author: "suppress"
  },
  titlePolicy: {
    metadataTitle: "suppress",
    firstBodyHeading: "keep"
  },
  prefix: [
    {
      kind: "container",
      styleId: "MdTenderCover",
      slot: "tender-cover",
      startMarker: "CONTAINER_START",
      endMarker: "CONTAINER_END",
      blocks: [
        {
          kind: "paragraph",
          styleId: "MdOfficialIssueRow",
          layout: "space-between",
          segments: ["期号", "发布单位", "签发人", "日期"],
          separator: "tab"
        }
      ]
    },
    {
      kind: "section-break",
      marker: "SECTION_BREAK",
      headerFooter: "none",
      pageNumber: "hidden",
      followingPageNumberStart: 1,
      verticalAlignment: "center"
    }
  ],
  suffix: []
};

const tokens: DocxThemeTokenSet = {
  schemaVersion: 1,
  themeId: "test-theme",
  themeFingerprint: "c".repeat(64),
  mode: "auto-with-overrides",
  basePreset: "tender",
  slots: [
    {
      slot: "tender-cover",
      source: "computed-css",
      confidence: "approximate",
      style: {
        fontCandidates: [],
        backgroundColor: "#f5f5f5",
        spacingBeforePt: 7,
        spacingAfterPt: 51,
        paddingPt: {
          top: 3,
          right: 5,
          bottom: 11,
          left: 4
        },
        widthPercent: 52,
        leftIndentPt: 230.4,
        rightIndentPt: 0,
        pageBreakAfter: true,
        keepLines: true,
        borders: {
          top: {
            widthPt: 1,
            style: "single",
            color: "#111111"
          },
          right: {
            widthPt: 1,
            style: "single",
            color: "#111111"
          },
          bottom: {
            widthPt: 1,
            style: "single",
            color: "#111111"
          },
          left: {
            widthPt: 1,
            style: "single",
            color: "#111111"
          }
        }
      }
    },
    {
      slot: "table",
      source: "computed-css",
      confidence: "exact",
      style: {
        fontCandidates: [],
        widthPercent: 100,
        keepLines: true
      }
    },
    {
      slot: "table-cell",
      source: "computed-css",
      confidence: "exact",
      style: {
        fontCandidates: ["Body Face"],
        fontSizePt: 10,
        lineSpacing: 1.8
      }
    },
    {
      slot: "inline-code",
      source: "computed-css",
      confidence: "exact",
      style: {
        fontCandidates: ["Code Face"],
        fontSizePt: 9,
        color: "#112233",
        backgroundColor: "#f5f5f5",
        paddingPt: {
          top: 3,
          right: 6,
          bottom: 3,
          left: 6
        }
      }
    },
    {
      slot: "code-block-text",
      source: "computed-css",
      confidence: "exact",
      style: {
        fontCandidates: ["Code Face"],
        fontSizePt: 9,
        color: "#24292e"
      }
    },
    {
      slot: "code-token-punctuation",
      source: "computed-css",
      confidence: "exact",
      style: {
        fontCandidates: ["Code Face"],
        fontSizePt: 9,
        color: "#7a7a7a"
      }
    },
    {
      slot: "code-token-name",
      source: "computed-css",
      confidence: "exact",
      style: {
        fontCandidates: ["Code Face"],
        fontSizePt: 9,
        color: "#22863a"
      }
    },
    {
      slot: "code-token-attribute",
      source: "computed-css",
      confidence: "exact",
      style: {
        fontCandidates: ["Code Face"],
        fontSizePt: 9,
        color: "#005cc5"
      }
    },
    {
      slot: "table-header",
      source: "computed-css",
      confidence: "exact",
      style: {
        fontCandidates: [],
        fontSizePt: 10,
        bold: true,
        lineSpacing: 1.5,
        alignment: "center",
        color: "#ffffff",
        backgroundColor: "#17324d"
      }
    },
    {
      slot: "heading-1",
      source: "computed-css",
      confidence: "exact",
      style: {
        fontCandidates: [],
        pageBreakAfter: true
      }
    }
  ],
  diagnostics: []
};

const mediaLayout: PandocMediaLayoutItem[] = [
  {
    id: "docx-media-1",
    binding: "morphdoc-media:docx-media-1",
    kind: "mermaid",
    ordinal: 1,
    altText: "处理流程",
    alignment: "right",
    displayWidthPx: 320,
    displayHeightPx: 180,
    widthEmu: 3_048_000,
    heightEmu: 1_714_500
  }
];

describe("生成 DOCX 结构收口", () => {
  it("生成真实分节、正文页码、节总页数和全宽自适应表格", () => {
    const result = finalizeGeneratedDocxStructure(
      generatedFixture(),
      plan,
      tokens,
      [],
      {
        tables: [],
        textBlocks: [{
          ordinal: 1,
          text: "期号发布单位签发人日期",
          letterSpacingPt: 0,
          linePitchPt: 17.25,
          lineBreakOffsets: [6]
        }]
      }
    );
    const entries = readGeneratedDocxPackage(
      result.content
    ).entries;
    const documentXml = decoder.decode(
      entries.get("word/document.xml")!
    );
    const footerXml = decoder.decode(
      entries.get("word/footer1.xml")!
    );

    expect(documentXml).not.toContain("CONTAINER_START");
    expect(documentXml).not.toContain("CONTAINER_END");
    expect(documentXml).not.toContain("SECTION_BREAK");
    expect(
      documentXml.match(/<w:sectPr(?:\s|>)/gu)
    ).toHaveLength(2);
    expect(documentXml).toContain(
      '<w:type w:val="nextPage"/>'
    );
    expect(documentXml).toContain(
      '<w:vAlign w:val="center"/>'
    );
    expect(documentXml).toContain(
      'w:line="345" w:lineRule="exact"'
    );
    expect(documentXml).toContain(
      '<w:pgNumType w:start="1"/>'
    );
    expect(documentXml).toContain(
      '<w:tblW w:w="5000" w:type="pct"/>'
    );
    expect(documentXml).toContain(
      '<w:tblLayout w:type="autofit"/>'
    );
    expect(documentXml).toMatch(
      /<w:pPr><w:pStyle w:val="Figure"\/>[\s\S]*?<w:autoSpaceDE w:val="0"\/><w:autoSpaceDN w:val="0"\/><w:spacing[^>]*w:line="240"[^>]*w:lineRule="auto"[^>]*w:before="300"[^>]*w:after="300"\/><w:jc w:val="center"\/>/u
    );
    expect(documentXml).toContain('<w:gridCol w:w="1000"/>');
    expect(documentXml).toContain('<w:gridCol w:w="2000"/>');
    expect(documentXml).toContain('<w:tcW w:w="0" w:type="auto"/>');
    expect(
      documentXml.match(
        /<w:spacing[^>]*w:before="0"[^>]*w:after="0"[^>]*w:line="300"[^>]*w:lineRule="exact"/gu
      )
    ).toHaveLength(2);
    expect(
      documentXml.match(
        /<w:spacing[^>]*w:before="0"[^>]*w:after="0"[^>]*w:line="360"[^>]*w:lineRule="exact"/gu
      )
    ).toHaveLength(1);
    expect(
      documentXml.match(
        /<w:spacing[^>]*w:before="0"[^>]*w:after="0"[^>]*w:line="360"[^>]*w:lineRule="atLeast"/gu
      )
    ).toHaveLength(1);
    expect(documentXml.match(/w:fill="17324D"/gu)).toHaveLength(2);
    expect(documentXml.match(/w:val="FFFFFF"/gu)).toHaveLength(2);
    expect(
      documentXml.match(/<w:jc w:val="center"\/>/gu)?.length ?? 0
    ).toBeGreaterThanOrEqual(2);
    const tableParagraph = documentXml.match(
      /<w:p>[\s\S]*?<w:t>A<\/w:t>[\s\S]*?<\/w:p>/u
    )?.[0];
    expect(tableParagraph).toContain('<w:autoSpaceDE w:val="0"/>');
    expect(tableParagraph).toContain('<w:autoSpaceDN w:val="0"/>');
    expect(documentXml).toContain("<w:cantSplit/>");
    expect(documentXml).toMatch(
      /<w:p><w:pPr><w:pStyle w:val="SourceCode"\/>[\s\S]*?<w:color w:val="7A7A7A"\/>[\s\S]*?<w:t>&lt;<\/w:t>[\s\S]*?<w:color w:val="22863A"\/>[\s\S]*?<w:t>br<\/w:t>[\s\S]*?<w:color w:val="7A7A7A"\/>[\s\S]*?<w:t>&gt;<\/w:t>[\s\S]*?<\/w:p>/u
    );
    expect(documentXml).toMatch(
      /<w:p><w:pPr><w:pStyle w:val="SourceCode"\/>[\s\S]*?<w:rStyle w:val="NormalTok"\/>[\s\S]*?<w:color w:val="005CC5"\/>[\s\S]*?<w:t xml:space="preserve">  method<\/w:t>[\s\S]*?<\/w:p>/u
    );
    expect(documentXml).toContain(
      '<w:tab w:val="right" w:pos="9806"/>'
    );
    expect(documentXml).not.toContain('<w:tab w:val="center"');
    expect(documentXml).toContain("<w:br/>");
    expect(documentXml).toContain('w:fill="F5F5F5"');
    expect(documentXml).toContain(
      'w:spacing w:before="140"'
    );
    expect(documentXml).toContain(
      '<w:spacing w:after="1020"/>'
    );
    expect(
      documentXml.match(
        /<w:ind w:left="4835" w:right="100"\/>/gu
      )
    ).toHaveLength(2);
    expect(documentXml).toContain(
      '<w:top w:val="single" w:sz="8" w:space="3" w:color="111111"/>'
    );
    expect(documentXml).toContain(
      '<w:bottom w:val="single" w:sz="8" w:space="11" w:color="111111"/>'
    );
    expect(
      documentXml.match(/<w:br w:type="page"\/>/gu)
    ).toHaveLength(1);
    const coverParagraph = documentXml.match(
      /<w:p(?:\s|>)[\s\S]*?可编辑封面[\s\S]*?<\/w:p>/u
    )?.[0];
    expect(coverParagraph).toContain("<w:sectPr>");
    expect(coverParagraph).not.toContain(
      '<w:br w:type="page"/>'
    );
    expect(footerXml).toContain("SECTIONPAGES");
    expect(footerXml).not.toContain(" NUMPAGES ");
    expect(result.report).toEqual({
      containerCount: 1,
      editableContainerTableCount: 0,
      sectionCount: 1,
      tableCount: 1,
      pageBreakAfterCount: 1,
      sectionPageFieldCount: 1,
      spaceBetweenParagraphCount: 1,
      mediaDrawingCount: 1
    });
  });

  it("将 Chromium 避头尾规则留下的单个汉字尾行翻译为显式换行", () => {
    const fixture = readGeneratedDocxPackage(generatedFixture());
    const documentXml = decoder.decode(
      fixture.entries.get("word/document.xml")!
    ).replace(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>正文标题</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>正文标题</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pStyle w:val="FirstParagraph"/><w:jc w:val="both"/></w:pPr><w:r><w:t>浏览器末行保留项目。</w:t></w:r></w:p>'
    );
    fixture.entries.set("word/document.xml", encoder.encode(documentXml));

    const result = finalizeGeneratedDocxStructure(
      writeGeneratedDocxPackage(fixture.entries),
      plan,
      tokens,
      [],
      {
        tables: [],
        textBlocks: [{
          ordinal: 1,
          text: "浏览器末行保留项目。",
          letterSpacingPt: 0,
          alignment: "justify",
          lineBreakOffsets: [8]
        }]
      }
    );
    const outputXml = decoder.decode(
      readGeneratedDocxPackage(result.content).entries.get(
        "word/document.xml"
      )!
    );

    expect(outputXml).toContain(
      '<w:t>浏览器末行保留项</w:t><w:br/><w:t>目。</w:t>'
    );
  });

  it("含行内代码的实测行距允许 Word 扩展行盒", () => {
    const fixture = readGeneratedDocxPackage(generatedFixture());
    const documentXml = decoder.decode(
      fixture.entries.get("word/document.xml")!
    ).replace(
      "<w:sectPr>",
      '<w:p><w:r><w:t>前缀</w:t></w:r><w:r><w:rPr><w:rStyle w:val="VerbatimChar"/></w:rPr><w:t>inline</w:t></w:r><w:r><w:t>后缀</w:t></w:r></w:p><w:sectPr>'
    );
    fixture.entries.set("word/document.xml", encoder.encode(documentXml));

    const result = finalizeGeneratedDocxStructure(
      writeGeneratedDocxPackage(fixture.entries),
      plan,
      tokens,
      [],
      {
        tables: [],
        textBlocks: [{
          ordinal: 1,
          text: "前缀inline后缀",
          letterSpacingPt: 0,
          linePitchPt: 11.15,
          lineBreakOffsets: []
        }]
      }
    );
    const outputXml = decoder.decode(
      readGeneratedDocxPackage(result.content).entries.get(
        "word/document.xml"
      )!
    );

    expect(outputXml).toMatch(
      /w:line="223" w:lineRule="atLeast"[\s\S]*?<w:t>前缀<\/w:t>[\s\S]*?<w:rStyle w:val="VerbatimChar"\/>/u
    );
  });

  it("未匹配实测布局的行内代码段落也不保留 exact 行盒", () => {
    const fixture = readGeneratedDocxPackage(generatedFixture());
    const documentXml = decoder.decode(
      fixture.entries.get("word/document.xml")!
    ).replace(
      "<w:sectPr>",
      '<w:p><w:pPr><w:spacing w:line="312" w:lineRule="exact"/></w:pPr><w:r><w:t>前缀</w:t></w:r><w:r><w:rPr><w:rStyle w:val="VerbatimChar"/></w:rPr><w:t>inline</w:t></w:r></w:p><w:sectPr>'
    );
    fixture.entries.set("word/document.xml", encoder.encode(documentXml));

    const result = finalizeGeneratedDocxStructure(
      writeGeneratedDocxPackage(fixture.entries),
      plan,
      tokens
    );
    const outputXml = decoder.decode(
      readGeneratedDocxPackage(result.content).entries.get(
        "word/document.xml"
      )!
    );

    expect(outputXml).toMatch(
      /w:line="312" w:lineRule="atLeast"[\s\S]*?<w:rStyle w:val="VerbatimChar"\/>/u
    );
  });

  it("表格纯公式段落加入零宽普通 Run 以服从段落对齐", () => {
    const fixture = readGeneratedDocxPackage(generatedFixture());
    const documentXml = decoder.decode(
      fixture.entries.get("word/document.xml")!
    ).replace(
      `xmlns:r="${relationships}"`,
      `xmlns:r="${relationships}" xmlns:m="${math}"`
    ).replace(
      "<w:p><w:r><w:t>B</w:t></w:r></w:p>",
      '<w:p><w:pPr><w:jc w:val="left"/></w:pPr><m:oMath><m:r><m:t>≥0.80</m:t></m:r></m:oMath></w:p>'
    );
    fixture.entries.set("word/document.xml", encoder.encode(documentXml));

    const result = finalizeGeneratedDocxStructure(
      writeGeneratedDocxPackage(fixture.entries),
      plan,
      tokens
    );
    const outputXml = decoder.decode(
      readGeneratedDocxPackage(result.content).entries.get(
        "word/document.xml"
      )!
    );

    expect(outputXml).toMatch(
      /<w:jc w:val="left"\/>[\s\S]*?<m:oMath>[\s\S]*?<m:t>≥0\.80<\/m:t>[\s\S]*?<\/m:oMath><w:r><w:rPr><w:noProof\/><\/w:rPr><w:t xml:space="preserve">\u200B<\/w:t><\/w:r>/u
    );
  });

  it("为右对齐盒模型保留 CSS 右侧内容内缩", () => {
    const fixture = readGeneratedDocxPackage(generatedFixture());
    const documentXml = decoder.decode(
      fixture.entries.get("word/document.xml")!
    ).replace(
      '<w:p><w:pPr><w:pStyle w:val="MdTenderTitle"/></w:pPr><w:r><w:t>可编辑封面</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:pStyle w:val="MdTenderCopyMark"/></w:pPr><w:r><w:t>正本</w:t></w:r></w:p>'
    );
    fixture.entries.set("word/document.xml", encoder.encode(documentXml));
    const copyMarkTokens: DocxThemeTokenSet = {
      ...tokens,
      slots: [
        ...tokens.slots.map((entry) =>
          entry.slot === "tender-cover"
            ? {
                ...entry,
                style: {
                  ...entry.style,
                  minimumHeightPt: 500,
                  verticalAlignment: "center" as const
                }
              }
            : entry
        ),
        {
          slot: "tender-copy-mark",
          source: "computed-css",
          confidence: "exact",
          style: {
            fontCandidates: [],
            fontSizePt: 13,
            selfAlignment: "right",
            paddingPt: { top: 3, right: 11.34, bottom: 3, left: 11.34 },
            borders: {
              right: { widthPt: 1.13, style: "single", color: "#222222" }
            }
          }
        }
      ]
    };

    const result = finalizeGeneratedDocxStructure(
      writeGeneratedDocxPackage(fixture.entries),
      plan,
      copyMarkTokens
    );
    const outputXml = decoder.decode(
      readGeneratedDocxPackage(result.content).entries.get(
        "word/document.xml"
      )!
    );

    expect(outputXml).toMatch(
      /<w:pStyle w:val="MdTenderCopyMark"\/>[\s\S]*?<w:t>正本<\/w:t>[\s\S]*?<w:sz w:val="25"\/>[\s\S]*?<w:t xml:space="preserve">\u00a0\u00a0<\/w:t>/u
    );
  });

  it("按 Chromium 实测比例写入固定 DXA 表格网格和单元格宽度", () => {
    const result = finalizeGeneratedDocxStructure(
      generatedFixture(),
      plan,
      tokens,
      [],
      {
        tables: [
          {
            ordinal: 1,
            widthPercent: 90,
            leftOffsetPercent: 5,
            columnWidthPercents: [30, 70],
            rows: []
          }
        ],
        textBlocks: [
          {
            ordinal: 1,
            text: "单元格前morphdoc_ic_c单元格后",
            letterSpacingPt: 0,
            alignment: "distribute",
            lineBreakOffsets: []
          }
        ],
        inlineCodes: [
          {
            ordinal: 1,
            text: "morphdoc_ic_c",
            fontSizePt: 8,
            letterSpacingPt: 0.2,
            color: "#334455",
            backgroundColor: "#abcdef",
            paddingPt: {
              top: 1,
              right: 2,
              bottom: 1,
              left: 2
            },
            borderPt: {
              top: 0.5,
              right: 0.5,
              bottom: 0.5,
              left: 0.5
            }
          }
        ]
      }
    );
    const documentXml = decoder.decode(
      readGeneratedDocxPackage(result.content).entries.get(
        "word/document.xml"
      )!
    );

    expect(documentXml).toContain(
      '<w:tblW w:w="8915" w:type="dxa"/>'
    );
    expect(documentXml).toContain(
      '<w:tblInd w:w="495" w:type="dxa"/>'
    );
    expect(documentXml).toContain('<w:tblLayout w:type="fixed"/>');
    expect(documentXml).toContain('<w:wordWrap w:val="1"/>');
    expect(documentXml).toContain('<w:gridCol w:w="2675"/>');
    expect(documentXml).toContain('<w:gridCol w:w="6240"/>');
    expect(
      documentXml.match(/<w:tcW w:w="2675" w:type="dxa"\/>/gu)
    ).toHaveLength(2);
    expect(
      documentXml.match(/<w:tcW w:w="6240" w:type="dxa"\/>/gu)
    ).toHaveLength(2);
    expect(documentXml).toMatch(
      /<w:r><w:rPr><w:rStyle w:val="VerbatimChar"\/><w:rFonts[^>]*w:ascii="Code Face"[^>]*\/>[\s\S]*?<w:color w:val="334455"\/>[\s\S]*?<w:sz w:val="16"\/>[\s\S]*?<w:bdr[^>]*w:sz="20"[^>]*w:space="0"[^>]*w:color="ABCDEF"[^>]*\/>[\s\S]*?<w:shd[^>]*w:fill="ABCDEF"[^>]*\/>[\s\S]*?<w:t>morphdoc_ic_c<\/w:t><\/w:r>/u
    );
    expect(documentXml).toMatch(
      /<w:r><w:rPr><w:rFonts[^>]*w:ascii="Body Face"[^>]*\/>[\s\S]*?<w:t>单元格前<\/w:t><\/w:r>/u
    );
    expect(documentXml).toContain('<w:jc w:val="distribute"/>');
  });

  it("将超出内容盒的实测表格等比收缩到 Word 可用宽度", () => {
    const result = finalizeGeneratedDocxStructure(
      generatedFixture(),
      plan,
      tokens,
      [],
      {
        tables: [
          {
            ordinal: 1,
            widthPercent: 300,
            leftOffsetPercent: 0,
            columnWidthPercents: [40, 10, 10, 10, 10, 20],
            rows: []
          }
        ]
      }
    );
    const documentXml = decoder.decode(
      readGeneratedDocxPackage(result.content).entries.get(
        "word/document.xml"
      )!
    );

    expect(documentXml).toContain(
      '<w:tblW w:w="9906" w:type="dxa"/>'
    );
    expect(documentXml).toContain('<w:gridCol w:w="3962"/>');
    expect(documentXml).toContain('<w:gridCol w:w="1980"/>');
  });

  it("按 Chromium 实测 emoji 调色保留可编辑 Unicode 文本", () => {
    const fixture = readGeneratedDocxPackage(generatedFixture());
    const documentXml = decoder.decode(
      fixture.entries.get("word/document.xml")!
    ).replace(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>正文标题</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>正文标题</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>⭐⭐⭐⭐</w:t></w:r></w:p>'
    );
    fixture.entries.set("word/document.xml", encoder.encode(documentXml));

    const result = finalizeGeneratedDocxStructure(
      writeGeneratedDocxPackage(fixture.entries),
      plan,
      tokens,
      [],
      {
        tables: [],
        emojiRuns: [
          { ordinal: 1, text: "⭐⭐⭐⭐", color: "#e7bf36" }
        ]
      }
    );
    const finalizedXml = decoder.decode(
      readGeneratedDocxPackage(result.content).entries.get(
        "word/document.xml"
      )!
    );

    expect(finalizedXml).toMatch(
      /<w:r><w:rPr><w:color w:val="E7BF36"\/><\/w:rPr><w:t>⭐⭐⭐⭐<\/w:t><\/w:r>/u
    );
  });

  it("实测表格缩进补偿 Word 以单元格内容而非外边框对齐的行为", () => {
    const paddedTokens = {
      ...tokens,
      slots: tokens.slots.map((slot) =>
        slot.slot === "table-cell"
          ? {
              ...slot,
              style: {
                ...slot.style,
                paddingPt: { top: 3, right: 6, bottom: 3, left: 6 }
              }
            }
          : slot
      )
    } satisfies DocxThemeTokenSet;
    const result = finalizeGeneratedDocxStructure(
      generatedFixture(),
      plan,
      paddedTokens,
      [],
      {
        tables: [{
          ordinal: 1,
          widthPercent: 90,
          leftOffsetPercent: 5,
          columnWidthPercents: [30, 70],
          rows: []
        }]
      }
    );
    const documentXml = decoder.decode(
      readGeneratedDocxPackage(result.content).entries.get(
        "word/document.xml"
      )!
    );

    expect(documentXml).toContain(
      '<w:tblInd w:w="615" w:type="dxa"/>'
    );
  });

  it("按稳定媒体计划规范化内联尺寸、比例锁和对齐", () => {
    const result = finalizeGeneratedDocxStructure(
      generatedFixture(),
      plan,
      tokens,
      mediaLayout
    );
    const documentXml = decoder.decode(
      readGeneratedDocxPackage(result.content).entries.get(
        "word/document.xml"
      )!
    );

    expect(result.report.mediaDrawingCount).toBe(1);
    expect(documentXml).toMatch(
      /<wp:inline\b[^>]*distT="0"[^>]*distB="0"[^>]*distL="0"[^>]*distR="0"[^>]*>/u
    );
    expect(documentXml).toContain(
      '<wp:extent cx="3048000" cy="1714500"/>'
    );
    expect(documentXml).toContain(
      '<a:ext cx="3048000" cy="1714500"/>'
    );
    expect(documentXml).toMatch(
      /<a:graphicFrameLocks\b[^>]*noChangeAspect="1"[^>]*\/>/u
    );
    expect(documentXml).toContain(
      'descr="处理流程" title=""'
    );
    expect(documentXml).toContain('<w:jc w:val="right"/>');
    expect(documentXml).not.toContain("morphdoc-media:");
    expect(documentXml).not.toContain('rot="60000"');
    expect(documentXml).not.toContain('flipH="1"');
  });

  it("拒绝缺失或重复的媒体布局绑定", () => {
    expect(() =>
      finalizeGeneratedDocxStructure(
        generatedFixture(),
        plan,
        tokens,
        [{ ...mediaLayout[0]!, binding: "morphdoc-media:missing" }]
      )
    ).toThrow("稳定绑定");

    expect(() =>
      finalizeGeneratedDocxStructure(
        generatedFixture(),
        plan,
        tokens,
        [mediaLayout[0]!, { ...mediaLayout[0]!, id: "duplicate" }]
      )
    ).toThrow("重复绑定");
  });

  it("将带最小高度的分节封面映射为可编辑单元格容器", () => {
    const tableTokens: DocxThemeTokenSet = {
      ...tokens,
      slots: tokens.slots.map((entry) =>
        entry.slot === "tender-cover"
          ? {
              ...entry,
              style: {
                ...entry.style,
                minimumHeightPt: 620,
                verticalAlignment: "center" as const,
                childAlignment: "center" as const
              }
            }
          : entry
      ).concat({
        slot: "official-issue-row" as const,
        source: "computed-css" as const,
        confidence: "exact" as const,
        style: {
          fontCandidates: [],
          spacingAfterPt: 4
        }
      }, {
        slot: "tender-title" as const,
        source: "computed-css" as const,
        confidence: "exact" as const,
        style: {
          fontCandidates: [],
          fontSizePt: 20,
          letterSpacingPt: 1,
          spacingBeforePt: 6,
          borders: {
            bottom: {
              widthPt: 1,
              style: "single" as const,
              color: "#111111"
            }
          }
        }
      })
    };
    const result = finalizeGeneratedDocxStructure(
      generatedFixture(),
      plan,
      tableTokens
    );
    const documentXml = decoder.decode(
      readGeneratedDocxPackage(result.content).entries.get(
        "word/document.xml"
      )!
    );

    expect(documentXml).toContain("<w:tbl>");
    expect(documentXml).toContain(
      '<w:trHeight w:val="12400" w:hRule="exact"/>'
    );
    expect(documentXml).toContain(
      '<w:tblInd w:w="4608" w:type="dxa"/>'
    );
    expect(documentXml).toContain('<w:vAlign w:val="top"/>');
    expect(documentXml).toContain("<w:tblBorders>");
    expect(documentXml).toContain('<w:insideH w:val="nil"/>');
    expect(documentXml).toContain('<w:insideV w:val="nil"/>');
    expect(documentXml).toMatch(
      /<w:pPr><w:pStyle w:val="MdTenderTitle"\/><w:autoSpaceDE w:val="0"\/><w:autoSpaceDN w:val="0"\/><w:spacing w:before="0" w:after="0"\/><w:ind w:left="1256" w:right="1275"\/><w:jc w:val="center"\/>/u
    );
    expect(documentXml).toMatch(
      /<w:pPr><w:pStyle w:val="MdTenderTitle"\/>[\s\S]*?<w:rPr><w:spacing w:val="20"\/><\/w:rPr><w:t>可编辑封面<\/w:t>/u
    );
    expect(documentXml).toContain('<w:tblLook w:val="0000"');
    expect(documentXml).toMatch(
      /<\/w:tbl><w:p><w:pPr>[\s\S]*?<w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"\/>[\s\S]*?<w:sectPr>/u
    );
    expect(
      documentXml.match(/<w:tbl(?:\s|>)/gu)
    ).toHaveLength(2);
    expect(result.report).toMatchObject({
      containerCount: 1,
      editableContainerTableCount: 1,
      sectionCount: 1,
      tableCount: 1
    });
  });

  it("将封面 border 与内缩 outline 映射为双层可编辑容器边框", () => {
    const outlinedTokens: DocxThemeTokenSet = {
      ...tokens,
      slots: tokens.slots.map((entry) =>
        entry.slot === "tender-cover"
          ? {
              ...entry,
              style: {
                ...entry.style,
                minimumHeightPt: 620,
                verticalAlignment: "center" as const,
                outline: {
                  widthPt: 0.75,
                  style: "single" as const,
                  color: "#777777"
                },
                outlineOffsetPt: -12
              }
            }
          : entry
      )
    };
    const result = finalizeGeneratedDocxStructure(
      generatedFixture(),
      plan,
      outlinedTokens
    );
    const documentXml = decoder.decode(
      readGeneratedDocxPackage(result.content).entries.get(
        "word/document.xml"
      )!
    );

    expect(documentXml).toContain(
      '<w:tblCellSpacing w:w="120" w:type="dxa"/>'
    );
    expect(documentXml).toMatch(
      /<w:tcBorders><w:top w:val="single" w:sz="6" w:space="0" w:color="777777"\/><w:left[\s\S]*?<w:bottom[\s\S]*?<w:right/u
    );
  });

  it("将封面最小高度封顶到当前节的页面内容区", () => {
    const oversizedTokens: DocxThemeTokenSet = {
      ...tokens,
      slots: tokens.slots.map((entry) =>
        entry.slot === "tender-cover"
          ? {
              ...entry,
              style: {
                ...entry.style,
                minimumHeightPt: 900,
                verticalAlignment: "center" as const,
                childAlignment: "left" as const,
                borders: {
                  ...entry.style.borders,
                  top: {
                    widthPt: 20,
                    style: "single" as const,
                    color: "#111111"
                  }
                }
              }
            }
          : entry
      ).concat(
        {
          slot: "official-issue-row" as const,
          source: "computed-css" as const,
          confidence: "exact" as const,
          style: {
            fontCandidates: [],
            fontSizePt: 12,
            lineSpacing: 1.5
          }
        },
        {
          slot: "tender-title" as const,
          source: "computed-css" as const,
          confidence: "exact" as const,
          style: {
            fontCandidates: [],
            fontSizePt: 20,
            lineSpacing: 1.2
          }
        }
      )
    };
    const result = finalizeGeneratedDocxStructure(
      generatedFixture(),
      plan,
      oversizedTokens
    );
    const documentXml = decoder.decode(
      readGeneratedDocxPackage(result.content).entries.get(
        "word/document.xml"
      )!
    );

    expect(documentXml).toContain(
      '<w:trHeight w:val="14718" w:hRule="exact"/>'
    );
    expect(documentXml).toContain(
      '<w:shd w:val="clear" w:color="auto" w:fill="111111"/>'
    );
    expect(documentXml).toContain(
      '<w:spacing w:before="0" w:after="0" w:line="500" w:lineRule="exact"/>'
    );
    expect(documentXml).toContain('<w:top w:w="0" w:type="dxa"/>');
    expect(documentXml).toContain('<w:bottom w:w="0" w:type="dxa"/>');
    expect(documentXml).toContain('<w:vAlign w:val="top"/>');
    expect(documentXml.match(/<w:cantSplit\/>/gu)).toHaveLength(3);
    expect(documentXml.match(/<w:t>\.<\/w:t>/gu)).toHaveLength(3);
    expect(documentXml.match(/<w:tbl(?:\s|>)/gu)).toHaveLength(2);
    expect(documentXml.match(/<w:trHeight\b/gu)).toHaveLength(1);
  });

  it("将主题列表文字起点映射为 Word 悬挂缩进", () => {
    const source = readGeneratedDocxPackage(generatedFixture());
    const entries = new Map(source.entries);
    entries.set(
      "word/numbering.xml",
      encoder.encode(
        `<w:numbering xmlns:w="${word}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum></w:numbering>`
      )
    );
    const listTokens: DocxThemeTokenSet = {
      ...tokens,
      slots: tokens.slots.concat({
        slot: "unordered-list" as const,
        source: "computed-css" as const,
        confidence: "exact" as const,
        style: {
          fontCandidates: [],
          paddingPt: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 30
          }
        }
      })
    };
    const result = finalizeGeneratedDocxStructure(
      writeGeneratedDocxPackage(entries),
      plan,
      listTokens
    );
    const numberingXml = decoder.decode(
      readGeneratedDocxPackage(result.content).entries.get(
        "word/numbering.xml"
      )!
    );

    expect(numberingXml).toContain(
      '<w:ind w:left="600" w:hanging="360"/>'
    );
    expect(numberingXml).toContain(
      '<w:ind w:left="1320" w:hanging="360"/>'
    );
  });

  it("将 Chromium 实测列表项文字起点映射为段落直接缩进", () => {
    const source = readGeneratedDocxPackage(generatedFixture());
    const entries = new Map(source.entries);
    const documentXml = decoder.decode(entries.get("word/document.xml")!);
    entries.set(
      "word/document.xml",
      encoder.encode(documentXml.replace(
        "<w:sectPr>",
        `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>一级列表</w:t></w:r></w:p>` +
        `<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>二级</w:t></w:r><w:r><w:rPr><w:rStyle w:val="VerbatimChar"/></w:rPr><w:t>代码</w:t></w:r></w:p>` +
        `<w:sectPr>`
      ))
    );
    entries.set(
      "word/numbering.xml",
      encoder.encode(
        `<w:numbering xmlns:w="${word}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl><w:lvl w:ilvl="1"><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
      )
    );
    const result = finalizeGeneratedDocxStructure(
      writeGeneratedDocxPackage(entries),
      plan,
      tokens,
      [],
      {
        tables: [],
        listItems: [
          {
            ordinal: 1,
            text: "一级列表",
            depth: 0,
            textStartPt: 10
          },
          {
            ordinal: 2,
            text: "二级代码",
            depth: 1,
            textStartPt: 25
          }
        ]
      }
    );
    const finalizedXml = decoder.decode(
      readGeneratedDocxPackage(result.content).entries.get(
        "word/document.xml"
      )!
    );

    expect(finalizedXml).toMatch(
      /<w:numPr>[\s\S]*?<w:ind w:left="200" w:hanging="200"\/>[\s\S]*?<w:t>一级列表<\/w:t>/u
    );
    expect(finalizedXml).toMatch(
      /<w:numPr>[\s\S]*?<w:ind w:left="500" w:hanging="360"\/>[\s\S]*?<w:t>二级<\/w:t>[\s\S]*?<w:t>代码<\/w:t>/u
    );
  });

  it("将 Pandoc 拆分的标准 Alert 正文恢复为引用块样式", () => {
    const source = readGeneratedDocxPackage(generatedFixture());
    const entries = new Map(source.entries);
    const documentXml = decoder.decode(entries.get("word/document.xml")!);
    entries.set(
      "word/document.xml",
      encoder.encode(documentXml.replace(
        "<w:sectPr>",
        `<w:p><w:pPr><w:pStyle w:val="FirstParagraph"/></w:pPr><w:r><w:t>Caution</w:t></w:r></w:p>` +
        `<w:p><w:pPr><w:pStyle w:val="BodyText"/></w:pPr><w:r><w:t>警告正文</w:t></w:r></w:p>` +
        `<w:sectPr>`
      ))
    );

    const result = finalizeGeneratedDocxStructure(
      writeGeneratedDocxPackage(entries),
      plan,
      tokens
    );
    const finalizedXml = decoder.decode(
      readGeneratedDocxPackage(result.content).entries.get(
        "word/document.xml"
      )!
    );

    expect(finalizedXml).toMatch(
      /<w:pPr><w:pStyle w:val="BlockText"\/>[\s\S]*?<w:t>警告正文<\/w:t>/u
    );
  });

  it("按最终页面内容区重算右置百分比容器缩进", () => {
    const relativeTokens: DocxThemeTokenSet = {
      ...tokens,
      slots: tokens.slots.map((entry) =>
        entry.slot === "tender-cover"
          ? {
              ...entry,
              confidence: "exact" as const,
              style: {
                fontCandidates: [],
                widthPercent: 52,
                leftIndentPt: 230.4,
                rightIndentPt: 0,
                keepLines: true
              }
            }
          : entry
      )
    };
    const result = finalizeGeneratedDocxStructure(
      generatedFixture(),
      plan,
      relativeTokens
    );
    const documentXml = decoder.decode(
      readGeneratedDocxPackage(result.content).entries.get(
        "word/document.xml"
      )!
    );

    // A4 内容区为 11906 - 1000 - 1000 = 9906 twips；
    // 52% 右置容器的左侧空余应为 9906 × 48% = 4755 twips。
    expect(documentXml).toMatch(
      /<w:pPr><w:pStyle w:val="MdOfficialIssueRow"\/>[\s\S]*?<w:ind w:left="4755" w:right="0"\/>/u
    );
    expect(documentXml).not.toContain('w:left="4608"');
    expect(documentXml).toMatch(
      /<w:pPr><w:pStyle w:val="MdOfficialSignatureDate"\/><w:autoSpaceDE w:val="0"\/><w:autoSpaceDN w:val="0"\/>/u
    );
  });

  it("拒绝缺失或重复的内部结构标记", () => {
    expect(() =>
      finalizeGeneratedDocxStructure(
        generatedFixture(),
        {
          ...plan,
          prefix: [
            {
              ...plan.prefix[0]!,
              startMarker: "MISSING"
            },
            plan.prefix[1]!
          ]
        },
        tokens
      )
    ).toThrow("结构标记数量无效");
  });

  it("清理 Pandoc 追加的重复和降级样式", () => {
    const source = readGeneratedDocxPackage(
      generatedFixture()
    );
    const entries = new Map(source.entries);
    const styles = decoder
      .decode(entries.get("word/styles.xml")!)
      .replace(
        "</w:styles>",
        '<w:style w:type="paragraph" w:styleId="MdTenderTitle">' +
          '<w:name w:val="重复降级样式"/></w:style>' +
          '<w:style w:type="paragraph" w:styleId="PandocFallback">' +
          '<w:pPr><w:jc w:val="justify"/></w:pPr></w:style>' +
          '<w:style w:type="table" w:styleId="PandocTableFallback">' +
          '<w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr>' +
          "</w:style></w:styles>"
      );
    entries.set("word/styles.xml", encoder.encode(styles));

    const result = finalizeGeneratedDocxStructure(
      writeGeneratedDocxPackage(entries),
      plan,
      tokens
    );
    const outputStyles = decoder.decode(
      readGeneratedDocxPackage(result.content).entries.get(
        "word/styles.xml"
      )!
    );

    expect(
      outputStyles.match(/w:styleId="MdTenderTitle"/gu)
    ).toHaveLength(1);
    expect(outputStyles).toContain(
      '<w:jc w:val="both"/>'
    );
    expect(outputStyles).not.toContain('w:val="justify"');
    expect(outputStyles).not.toContain("<w:tblW");
  });
});
