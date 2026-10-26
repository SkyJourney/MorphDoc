import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { unzipSync, zipSync } from "fflate";
import {
  defaultExportConfig,
  type ExportConfig,
  type ThemeManifest
} from "@morphdoc/core";
import type {
  DocxResolvedStyleSlot,
  DocxThemeTokenSet
} from "@morphdoc/docx-theme-engine";
import {
  createDynamicReferenceDocx,
  validateGeneratedDocx,
  validateDynamicReferenceDocx,
  writeReferenceDocxPackage
} from "../src/index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const wordNamespace =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function xml(value: string) {
  return encoder.encode(value);
}

function createBaselineReference() {
  const styles = [
    "Normal",
    "BodyText",
    "FirstParagraph",
    "Compact",
    "Title",
    "TitleChar",
    "Subtitle",
    "SubtitleChar",
    "Heading1",
    "Heading1Char",
    "Heading2",
    "Heading2Char",
    "Heading3",
    "Heading3Char",
    "Heading4",
    "Heading4Char",
    "Heading5",
    "Heading5Char",
    "Heading6",
    "Heading6Char",
    "BlockText",
    "FootnoteText",
    "DefaultParagraphFont",
    "Table",
    "Definition",
    "Caption",
    "TableCaption",
    "ImageCaption",
    "Figure",
    "BodyTextChar",
    "VerbatimChar",
    "Hyperlink"
  ]
    .map((styleId) => {
      const type =
        styleId === "Table"
          ? "table"
          : styleId.endsWith("Char") ||
              styleId === "DefaultParagraphFont" ||
              styleId === "VerbatimChar" ||
              styleId === "Hyperlink"
            ? "character"
            : "paragraph";
      return `<w:style w:type="${type}" w:styleId="${styleId}"><w:name w:val="${styleId}"/></w:style>`;
    })
    .join("");

  return zipSync(
    {
      "[Content_Types].xml": xml(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      "_rels/.rels": xml(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
      ),
      "word/document.xml": xml(
        `<w:document xmlns:w="${wordNamespace}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p/><w:sectPr><w:footnotePr/></w:sectPr></w:body></w:document>`
      ),
      "word/fontTable.xml": xml(
        `<w:fonts xmlns:w="${wordNamespace}"><w:font w:name="Arial"/></w:fonts>`
      ),
      "word/numbering.xml": xml(
        `<w:numbering xmlns:w="${wordNamespace}"/>`
      ),
      "word/settings.xml": xml(
        `<w:settings xmlns:w="${wordNamespace}"/>`
      ),
      "word/styles.xml": xml(
        `<w:styles xmlns:w="${wordNamespace}"><w:docDefaults><w:rPrDefault><w:rPr/></w:rPrDefault><w:pPrDefault><w:pPr/></w:pPrDefault></w:docDefaults>${styles}</w:styles>`
      ),
      "word/_rels/document.xml.rels": xml(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
      ),
      "word/theme/theme1.xml": xml(
        '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/></a:minorFont></a:fontScheme></a:themeElements></a:theme>'
      )
    },
    { mtime: new Date("2020-01-01T00:00:00.000Z") }
  );
}

function theme(
  overrides: Partial<ThemeManifest> = {}
): ThemeManifest {
  return {
    manifestVersion: 1,
    id: "test-theme",
    name: "测试主题",
    version: "1.0.0",
    description: "测试",
    author: "测试",
    license: "内部许可",
    entry: "theme.css",
    domPreset: "generic",
    defaultFontSize: "16px",
    supportedFeatures: [],
    category: "general",
    compatibleProfiles: [],
    docxStyle: { preset: "technical" },
    bundled: true,
    ...overrides
  };
}

function themeTokens(
  fingerprint = "c".repeat(64),
  slots: DocxResolvedStyleSlot[] = []
): DocxThemeTokenSet {
  return {
    schemaVersion: 1,
    themeId: "test-theme",
    themeFingerprint: fingerprint,
    mode: "auto-with-overrides",
    basePreset: "technical",
    slots,
    diagnostics: []
  };
}

function createOptions(exportConfig: ExportConfig) {
  return {
    exportConfig,
    theme: theme(),
    fileName: "报告 & 计划.md",
    metadata: {
      title: "年度 <报告>",
      author: "测试人"
    },
    themeTokens: themeTokens()
  };
}

describe("动态 reference.docx", () => {
  it("生成稳定的纸张、正文样式和页码模板", () => {
    const baseline = createBaselineReference();
    const first = createDynamicReferenceDocx(
      baseline,
      createOptions(defaultExportConfig)
    );
    const second = createDynamicReferenceDocx(
      baseline,
      createOptions(defaultExportConfig)
    );
    const changedMetadata = createDynamicReferenceDocx(baseline, {
      ...createOptions(defaultExportConfig),
      metadata: {
        title: "另一份报告",
        author: "测试人"
      }
    });
    const changedTokens = createDynamicReferenceDocx(baseline, {
      ...createOptions(defaultExportConfig),
      themeTokens: themeTokens("d".repeat(64))
    });
    const entries = unzipSync(first.content);
    const documentXml = decoder.decode(entries["word/document.xml"]);
    const stylesXml = decoder.decode(entries["word/styles.xml"]);
    const footerXml = decoder.decode(entries["word/footer1.xml"]);

    expect(first.templateFingerprint).toBe(
      second.templateFingerprint
    );
    expect(first.cacheKey).toBe(second.cacheKey);
    expect(first.cacheKey).not.toBe(changedMetadata.cacheKey);
    expect(first.cacheKey).not.toBe(changedTokens.cacheKey);
    expect(documentXml).toContain('w:w="11906"');
    expect(documentXml).toContain('w:h="16838"');
    expect(documentXml).toContain('w:top="907"');
    expect(stylesXml).toContain('w:styleId="SourceCode"');
    expect(stylesXml).toContain('w:eastAsia="Microsoft YaHei"');
    const imageCaptionStyle = stylesXml.match(
      /<w:style\b[^>]*w:styleId="ImageCaption"[\s\S]*?<\/w:style>/u
    )?.[0];
    expect(imageCaptionStyle).toContain('<w:jc w:val="center"/>');
    expect(footerXml).toContain(" PAGE \\* MERGEFORMAT ");
    expect(footerXml).toContain(" NUMPAGES \\* MERGEFORMAT ");
    expect(footerXml).toContain('w:jc w:val="center"');
    expect(footerXml).toContain('w:before="0"');
    expect(footerXml).not.toContain("<w:tbl");
    expect(validateDynamicReferenceDocx(first.content)).toMatchObject({
      partCount: first.partCount,
      headerCount: 0,
      footerCount: 1
    });
  });

  it("将通用主题令牌写入标准样式、结构样式和字体部件", () => {
    const result = createDynamicReferenceDocx(
      createBaselineReference(),
      {
        ...createOptions(defaultExportConfig),
        themeTokens: themeTokens("e".repeat(64), [
          {
            slot: "paragraph",
            source: "computed-css",
            confidence: "exact",
            style: {
              fontCandidates: [
                "Source Han Serif SC",
                "Times New Roman"
              ],
              fontSizePt: 12.75,
              color: "#112233",
              lineSpacing: 1.8,
              firstLineIndentPt: 28,
              alignment: "justify"
            }
          },
          {
            slot: "heading-1",
            source: "computed-css",
            confidence: "exact",
            style: {
              fontCandidates: ["SimHei", "Arial"],
              fontSizePt: 22,
              bold: true,
              color: "#aa0000",
              alignment: "center",
              keepWithNext: true
            }
          },
          {
            slot: "code-block",
            source: "computed-css",
            confidence: "exact",
            style: {
              fontCandidates: ["Lucida Console"],
              fontSizePt: 9,
              paddingPt: {
                top: 6,
                right: 3,
                bottom: 5,
                left: 3
              },
              contentPaddingLeftPt: 6,
              borders: {
                top: { widthPt: 0.75, color: "#e7eaed", style: "single" },
                right: { widthPt: 0.75, color: "#e7eaed", style: "single" },
                bottom: { widthPt: 0.75, color: "#e7eaed", style: "single" },
                left: { widthPt: 0.75, color: "#e7eaed", style: "single" }
              }
            }
          },
          {
            slot: "code-block-text",
            source: "computed-css",
            confidence: "exact",
            style: {
              fontCandidates: ["Code Text Face"],
              fontSizePt: 10,
              color: "#223344"
            }
          },
          {
            slot: "code-token-attribute",
            source: "computed-css",
            confidence: "exact",
            style: {
              fontCandidates: ["Code Text Face"],
              fontSizePt: 10,
              color: "#166534"
            }
          },
          {
            slot: "table",
            source: "computed-css",
            confidence: "exact",
            style: {
              fontCandidates: [],
              widthPercent: 100,
              paddingPt: {
                top: 3,
                right: 4,
                bottom: 3,
                left: 4
              },
              borders: {
                top: {
                  widthPt: 1,
                  color: "#445566",
                  style: "single"
                }
              }
            }
          },
          {
            slot: "table-cell",
            source: "computed-css",
            confidence: "exact",
            style: {
              fontCandidates: ["SimSun"],
              borders: {
                top: {
                  widthPt: 0.85,
                  color: "#556677",
                  style: "single"
                },
                right: {
                  widthPt: 0.85,
                  color: "#556677",
                  style: "single"
                },
                bottom: {
                  widthPt: 0.85,
                  color: "#556677",
                  style: "single"
                },
                left: {
                  widthPt: 0.85,
                  color: "#556677",
                  style: "single"
                }
              }
            }
          },
          {
            slot: "official-title",
            source: "computed-css",
            confidence: "exact",
            style: {
              fontCandidates: ["SimSun"],
              fontSizePt: 22,
              color: "#ff0000",
              alignment: "center",
              keepWithNext: true
            }
          },
          {
            slot: "official-edition",
            source: "computed-css",
            confidence: "exact",
            style: {
              fontCandidates: [],
              lineSpacing: 1.5
            }
          },
          {
            slot: "official-printing-row",
            source: "computed-css",
            confidence: "exact",
            style: {
              fontCandidates: [],
              paddingPt: {
                top: 3,
                right: 28,
                bottom: 3,
                left: 28
              }
            }
          }
        ])
      }
    );
    const entries = unzipSync(result.content);
    const stylesXml = decoder.decode(entries["word/styles.xml"]);
    const fontTableXml = decoder.decode(
      entries["word/fontTable.xml"]
    );
    const themeXml = decoder.decode(
      entries["word/theme/theme1.xml"]
    );

    expect(stylesXml).toContain('w:styleId="MdOfficialTitle"');
    expect(stylesXml).toMatch(
      /w:style[^>]*w:styleId="MdOfficialTitle"[\s\S]*?<w:autoSpaceDE w:val="0"\/><w:autoSpaceDN w:val="0"\/>/u
    );
    expect(stylesXml).toContain('w:eastAsia="Source Han Serif SC"');
    expect(stylesXml).toContain('w:ascii="Times New Roman"');
    expect(stylesXml).toContain('w:val="112233"');
    expect(stylesXml).toContain('w:styleId="Heading1"');
    expect(stylesXml).toContain('w:val="AA0000"');
    expect(stylesXml).toContain('<w:jc w:val="both"/>');
    const sourceCodeStyle = stylesXml.match(
      /<w:style\b[^>]*w:styleId="SourceCode"[\s\S]*?<\/w:style>/u
    )?.[0];
    expect(sourceCodeStyle).not.toContain("<w:shd");
    expect(sourceCodeStyle).toContain(
      '<w:left w:val="single" w:sz="6" w:space="7" w:color="E7EAED"/>'
    );
    expect(sourceCodeStyle).toMatch(
      /<w:ind\b[^>]*w:left="195"[^>]*w:right="0"[^>]*\/>/u
    );
    expect(sourceCodeStyle).toContain('w:ascii="Code Text Face"');
    expect(stylesXml).toMatch(
      /w:style[^>]*w:styleId="MdSourceCodeChar"[\s\S]*?<w:sz w:val="20"\/>/u
    );
    expect(stylesXml).toMatch(
      /w:style[^>]*w:styleId="DataTypeTok"[\s\S]*?<w:basedOn w:val="MdSourceCodeChar"\/>[\s\S]*?<w:color w:val="166534"\/>/u
    );
    expect(stylesXml).not.toContain('w:val="justify"');
    expect(stylesXml).toContain(
      'w:line="459" w:lineRule="exact"'
    );
    expect(stylesXml).toMatch(
      /w:style[^>]*w:styleId="Normal"[\s\S]*?<w:rPr>[\s\S]*?<w:sz w:val="26"\/>[\s\S]*?<w:spacing w:val="-5"\/>/u
    );
    expect(stylesXml).toMatch(
      /w:style[^>]*w:styleId="MdOfficialEdition"[\s\S]*?<w:spacing[^>]*w:line="315"[^>]*w:lineRule="exact"/u
    );
    expect(stylesXml).toMatch(
      /w:style[^>]*w:styleId="MdOfficialPrintingRow"[\s\S]*?<w:spacing[^>]*w:before="60"[^>]*w:after="60"/u
    );
    expect(stylesXml).toMatch(
      /w:style[^>]*w:styleId="MdOfficialPrintingRow"[\s\S]*?<w:ind[^>]*w:left="560"[^>]*w:right="560"/u
    );
    expect(stylesXml).not.toContain('w:lineRule="auto"');
    expect(stylesXml).not.toContain("<w:tblW");
    expect(stylesXml).toContain('w:color="445566"');
    expect(stylesXml).toMatch(
      /<w:tblBorders>[\s\S]*?<w:insideH[^>]*w:sz="7"[^>]*w:color="556677"\/>[\s\S]*?<w:insideV[^>]*w:sz="7"[^>]*w:color="556677"\/>/u
    );
    expect(fontTableXml).toContain(
      'w:name="Source Han Serif SC"'
    );
    expect(fontTableXml).toContain('w:name="SimHei"');
    expect(themeXml).toContain(
      '<a:latin typeface="Arial"'
    );
    expect(themeXml).toContain(
      '<a:ea typeface="SimHei"'
    );
  });

  it("按代码容器令牌清除或写入 SourceCode 段落底纹", () => {
    const createWithBackground = (backgroundColor?: string) => {
      const result = createDynamicReferenceDocx(
        createBaselineReference(),
        {
          ...createOptions(defaultExportConfig),
          themeTokens: themeTokens("f".repeat(64), [
            {
              slot: "code-block",
              source: "computed-css",
              confidence: "exact",
              style: {
                fontCandidates: ["Consolas"],
                fontSizePt: 10,
                ...(backgroundColor ? { backgroundColor } : {})
              }
            },
            {
              slot: "code-block-text",
              source: "computed-css",
              confidence: "exact",
              style: {
                fontCandidates: ["Consolas"],
                fontSizePt: 10
              }
            }
          ])
        }
      );
      const stylesXml = decoder.decode(
        unzipSync(result.content)["word/styles.xml"]
      );
      return stylesXml.match(
        /<w:style\b[^>]*w:styleId="SourceCode"[\s\S]*?<\/w:style>/u
      )?.[0];
    };

    expect(createWithBackground()).not.toContain("<w:shd");
    expect(createWithBackground("#eef2f6")).toContain(
      '<w:shd w:val="clear" w:color="auto" w:fill="EEF2F6"/>'
    );
  });

  it("生成横向、自定义页边距和奇偶首页页眉页脚", () => {
    const exportConfig: ExportConfig = {
      ...defaultExportConfig,
      pageDecorationsMode: "custom",
      paper: {
        ...defaultExportConfig.paper,
        orientation: "landscape",
        marginMode: "custom",
        margins: {
          top: "20mm",
          right: "25mm",
          bottom: "22mm",
          left: "30mm"
        }
      },
      header: {
        ...defaultExportConfig.header,
        enabled: true,
        showDivider: true,
        left: {
          enabled: true,
          content: "${title} / ${filename}"
        }
      },
      footer: {
        ...defaultExportConfig.footer,
        alignment: "outer",
        format: "official-page",
        startFrom: 5,
        showOnFirstPage: false
      }
    };
    const result = createDynamicReferenceDocx(
      createBaselineReference(),
      createOptions(exportConfig)
    );
    const entries = unzipSync(result.content);
    const documentXml = decoder.decode(entries["word/document.xml"]);
    const settingsXml = decoder.decode(entries["word/settings.xml"]);
    const stylesXml = decoder.decode(entries["word/styles.xml"]);
    const headerXml = decoder.decode(entries["word/header1.xml"]);
    const relationships = decoder.decode(
      entries["word/_rels/document.xml.rels"]
    );

    expect(documentXml).toContain('w:orient="landscape"');
    expect(documentXml).toContain('w:w="16838"');
    expect(documentXml).toContain('w:left="1701"');
    expect(documentXml).toContain('w:header="723"');
    expect(documentXml).toContain('w:footer="751"');
    expect(documentXml).toContain('w:start="5"');
    expect(documentXml).toContain("<w:titlePg");
    expect(documentXml.match(/w:headerReference/gu)).toHaveLength(3);
    expect(documentXml.match(/w:footerReference/gu)).toHaveLength(3);
    expect(settingsXml).toContain("<w:evenAndOddHeaders");
    expect(settingsXml).toContain("<w:doNotExpandShiftReturn");
    expect(stylesXml).toContain('<w:kern w:val="2"');
    expect(headerXml).toContain("年度 &lt;报告&gt;");
    expect(headerXml).toContain("报告 &amp; 计划.md");
    expect(headerXml).toContain('w:tab w:val="center"');
    expect(headerXml).toContain('w:tab w:val="right"');
    expect(headerXml).toContain('w:pos="6860"');
    expect(headerXml).toContain('w:pos="13720"');
    expect(headerXml).toContain("<w:pBdr>");
    expect(headerXml).toContain("<w:bottom");
    expect(headerXml).toMatch(
      /<w:spacing[^>]*w:line="213"[^>]*w:lineRule="exact"/u
    );
    expect(headerXml).not.toContain("<w:tbl");
    const footerXml = decoder.decode(entries["word/footer1.xml"]);
    expect(footerXml).toMatch(
      /<w:spacing[^>]*w:line="213"[^>]*w:lineRule="exact"/u
    );
    expect(footerXml).not.toContain("<w:tbl");
    expect(relationships.match(/relationships\/header/gu)).toHaveLength(
      3
    );
    expect(relationships.match(/relationships\/footer/gu)).toHaveLength(
      3
    );
    expect(entries["word/footer3.xml"]).toBeDefined();
    expect(validateDynamicReferenceDocx(result.content)).toMatchObject({
      headerCount: 3,
      footerCount: 3
    });
  });

  it("封面页码重启时仍使用原生奇偶页脚保持跨客户端外侧位置", () => {
    const exportConfig: ExportConfig = {
      ...defaultExportConfig,
      pageDecorationsMode: "custom",
      footer: {
        ...defaultExportConfig.footer,
        alignment: "outer",
        format: "page-total",
        startFrom: 1
      }
    };
    const result = createDynamicReferenceDocx(
      createBaselineReference(),
      {
        ...createOptions(exportConfig),
        semanticDocument: {
          schemaVersion: 1,
          profile: "project-report",
          titlePolicy: {
            metadataTitle: "suppress",
            firstBodyHeading: "keep"
          },
          regions: [
            {
              kind: "cover",
              nodes: [
                {
                  kind: "text",
                  role: "project-report-title",
                  text: "可研报告"
                }
              ],
              section: {
                headerFooter: "none",
                pageNumber: "hidden",
                breakAfter: "next-page",
                followingPageNumberStart: 1
              }
            }
          ]
        }
      }
    );
    const entries = unzipSync(result.content);
    const documentXml = decoder.decode(entries["word/document.xml"]);
    const settingsXml = decoder.decode(entries["word/settings.xml"]);
    const defaultFooterXml = decoder.decode(entries["word/footer1.xml"]);
    const evenFooterXml = decoder.decode(entries["word/footer2.xml"]);

    expect(documentXml.match(/w:footerReference/gu)).toHaveLength(2);
    expect(settingsXml).toContain("<w:evenAndOddHeaders");
    expect(defaultFooterXml).toContain('w:jc w:val="left"');
    expect(evenFooterXml).toContain('w:jc w:val="right"');
    expect(defaultFooterXml).toContain(" = ");
    expect(defaultFooterXml).toContain(" - 1 ");
    expect(defaultFooterXml).toContain(" PAGE \\* MERGEFORMAT ");
    expect(defaultFooterXml).toContain(" NUMPAGES \\* MERGEFORMAT ");
    expect(defaultFooterXml).not.toContain(" IF ");
    expect(defaultFooterXml).not.toContain("<w:tbl");
    expect(validateDynamicReferenceDocx(result.content)).toMatchObject({
      footerCount: 2
    });
  });

  it("独立控制正文首页页眉和页码", () => {
    const exportConfig: ExportConfig = {
      ...defaultExportConfig,
      pageDecorationsMode: "custom",
      header: {
        ...defaultExportConfig.header,
        enabled: true,
        showOnFirstPage: false,
        showDivider: true,
        center: {
          enabled: true,
          content: "${title}"
        }
      },
      footer: {
        ...defaultExportConfig.footer,
        alignment: "center",
        showOnFirstPage: true
      }
    };
    const result = createDynamicReferenceDocx(
      createBaselineReference(),
      createOptions(exportConfig)
    );
    const entries = unzipSync(result.content);
    const documentXml = decoder.decode(entries["word/document.xml"]);
    const regularHeader = decoder.decode(entries["word/header1.xml"]);
    const firstHeader = decoder.decode(entries["word/header2.xml"]);
    const regularFooter = decoder.decode(entries["word/footer1.xml"]);
    const firstFooter = decoder.decode(entries["word/footer2.xml"]);

    expect(documentXml).toContain("<w:titlePg");
    expect(documentXml.match(/w:headerReference/gu)).toHaveLength(2);
    expect(documentXml.match(/w:footerReference/gu)).toHaveLength(2);
    expect(regularHeader).toContain("年度 &lt;报告&gt;");
    expect(regularHeader).toContain("<w:bottom");
    expect(firstHeader).not.toContain("年度 &lt;报告&gt;");
    expect(firstHeader).not.toContain("<w:bottom");
    expect(regularFooter).toContain("PAGE");
    expect(firstFooter).toContain("PAGE");
  });

  it("隐藏正文首页页码时生成无内容且无分隔线的首页页脚", () => {
    const exportConfig: ExportConfig = {
      ...defaultExportConfig,
      pageDecorationsMode: "custom",
      footer: {
        ...defaultExportConfig.footer,
        showDivider: true,
        showOnFirstPage: false
      }
    };
    const result = createDynamicReferenceDocx(
      createBaselineReference(),
      createOptions(exportConfig)
    );
    const entries = unzipSync(result.content);
    const firstFooter = decoder.decode(entries["word/footer2.xml"]);

    expect(firstFooter).not.toContain("PAGE");
    expect(firstFooter).not.toContain("<w:top");
  });

  it("拒绝正文中断裂或类型错误的页眉页脚关系", () => {
    const result = createDynamicReferenceDocx(
      createBaselineReference(),
      createOptions(defaultExportConfig)
    );
    const entries = new Map(
      Object.entries(unzipSync(result.content))
    );
    const relationships = decoder
      .decode(entries.get("word/_rels/document.xml.rels")!)
      .replace(
        "relationships/footer",
        "relationships/header"
      );
    entries.set(
      "word/_rels/document.xml.rels",
      encoder.encode(relationships)
    );
    const damaged = writeReferenceDocxPackage(entries);

    expect(() => validateDynamicReferenceDocx(damaged)).toThrow(
      /footerReference 引用了无效关系/u
    );
  });

  it("拒绝使用表格模拟页眉页脚布局", () => {
    const result = createDynamicReferenceDocx(
      createBaselineReference(),
      createOptions(defaultExportConfig)
    );
    const entries = new Map(
      Object.entries(unzipSync(result.content))
    );
    const footer = decoder
      .decode(entries.get("word/footer1.xml")!)
      .replace(
        "</w:ftr>",
        "<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl></w:ftr>"
      );
    entries.set("word/footer1.xml", encoder.encode(footer));
    const damaged = writeReferenceDocxPackage(entries);

    expect(() => validateDynamicReferenceDocx(damaged)).toThrow(
      /不得使用表格模拟页眉页脚布局/u
    );
  });

  it("拒绝重复样式 ID 和非法两端对齐枚举", () => {
    const result = createDynamicReferenceDocx(
      createBaselineReference(),
      createOptions(defaultExportConfig)
    );
    const entries = new Map(
      Object.entries(unzipSync(result.content))
    );
    const styles = decoder.decode(entries.get("word/styles.xml")!);

    entries.set(
      "word/styles.xml",
      encoder.encode(
        styles.replace(
          "</w:styles>",
          '<w:style w:type="paragraph" w:styleId="Normal"/>' +
            "</w:styles>"
        )
      )
    );
    expect(() =>
      validateDynamicReferenceDocx(
        writeReferenceDocxPackage(entries)
      )
    ).toThrow(/重复样式 ID：Normal/u);

    entries.set(
      "word/styles.xml",
      encoder.encode(
        styles.replace(
          /<w:jc w:val="[^"]+"\/>/u,
          '<w:jc w:val="justify"/>'
        )
      )
    );
    expect(() =>
      validateDynamicReferenceDocx(
        writeReferenceDocxPackage(entries)
      )
    ).toThrow(/两端对齐必须使用/u);
  });

  it("最终 DOCX 使用媒体输出上限而非模板的 2 MiB 上限", () => {
    const result = createDynamicReferenceDocx(
      createBaselineReference(),
      createOptions(defaultExportConfig)
    );
    const entries = unzipSync(result.content);
    const generated = zipSync(
      {
        ...entries,
        "word/media/large-test.bin": randomBytes(3 * 1024 * 1024)
      },
      { level: 0 }
    );

    expect(generated.byteLength).toBeGreaterThan(2 * 1024 * 1024);
    expect(validateGeneratedDocx(generated).partCount).toBe(
      result.partCount + 1
    );
    expect(() => validateDynamicReferenceDocx(generated)).toThrow(
      /大小超过限制/u
    );
  });
});
