import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { defaultExportConfig } from "@morphdoc/core";
import { inspectDocxAcceptance } from "../src/index.js";

const encoder = new TextEncoder();
const word =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const relationships =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const packageRelationships =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const math =
  "http://schemas.openxmlformats.org/officeDocument/2006/math";
const drawing =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const png = Uint8Array.of(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0,
  0,
  0,
  0
);

function xml(value: string) {
  return encoder.encode(value);
}

function createAcceptanceDocx(
  overrides: {
    altChunk?: boolean;
    duplicateText?: boolean;
    internalMarker?: boolean;
    invalidPropertyOrder?: boolean;
    coverPageNumber?: boolean;
    bodyTitlePage?: boolean;
    footerAlignment?: "left" | "center" | "right";
    evenAndOddHeaders?: boolean;
    logicalOuterFooter?: boolean;
    nativeOuterFooter?: boolean;
  } = {}
) {
  return zipSync({
    "[Content_Types].xml": xml(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>${overrides.nativeOuterFooter ? '<Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : ""}</Types>`
    ),
    "_rels/.rels": xml(
      `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    "word/document.xml": xml(
      `<w:document xmlns:w="${word}" xmlns:r="${relationships}" xmlns:m="${math}" xmlns:wp="${drawing}"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:hyperlink r:id="rIdLink"><w:r><w:t>可编辑正文</w:t></w:r></w:hyperlink><w:r><w:footnoteReference w:id="1"/></w:r><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p>${overrides.invalidPropertyOrder ? '<w:p><w:pPr><w:jc w:val="left"/><w:spacing w:after="0"/></w:pPr></w:p>' : ""}${overrides.duplicateText ? "<w:p><w:r><w:t>可编辑正文</w:t></w:r></w:p>" : ""}${overrides.internalMarker ? "<w:p><w:r><w:t>MORPHDOC_INTERNAL</w:t></w:r></w:p>" : ""}<w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="907" w:right="907" w:bottom="907" w:left="907"/>${overrides.coverPageNumber ? '<w:pgNumType w:start="1"/>' : ""}</w:sectPr></w:pPr></w:p><w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tr><w:tc><w:p><w:r><w:t>原生表格</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="图片 1" descr="普通图片"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></wp:inline></w:drawing></w:r></w:p>${overrides.altChunk ? '<w:altChunk r:id="rIdChunk"/>' : ""}<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/>${overrides.nativeOuterFooter ? '<w:footerReference w:type="even" r:id="rIdEvenFooter"/>' : ""}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="907" w:right="907" w:bottom="907" w:left="907"/><w:pgNumType w:start="${overrides.nativeOuterFooter ? "2" : "1"}"/>${overrides.bodyTitlePage ? "<w:titlePg/>" : ""}</w:sectPr></w:body></w:document>`
    ),
    "word/styles.xml": xml(
      `<w:styles xmlns:w="${word}">${["Normal", "Heading1", "SourceCode", "Table", "Caption"].map((id) => `<w:style w:type="paragraph" w:styleId="${id}"/>`).join("")}</w:styles>`
    ),
    "word/settings.xml": xml(
      `<w:settings xmlns:w="${word}">${overrides.evenAndOddHeaders ? "<w:evenAndOddHeaders/>" : ""}</w:settings>`
    ),
    "word/fontTable.xml": xml(`<w:fonts xmlns:w="${word}"/>`),
    "word/numbering.xml": xml(`<w:numbering xmlns:w="${word}"/>`),
    "word/theme/theme1.xml": xml(
      '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>'
    ),
    "word/footer1.xml": xml(
      overrides.logicalOuterFooter
        ? `<w:ftr xmlns:w="${word}"><w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9000"/></w:tabs></w:pPr><w:r><w:instrText> IF </w:instrText></w:r><w:r><w:instrText> MOD( </w:instrText></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:instrText> SECTIONPAGES </w:instrText></w:r></w:p></w:ftr>`
        : `<w:ftr xmlns:w="${word}"><w:p><w:pPr><w:jc w:val="${overrides.nativeOuterFooter ? "left" : (overrides.footerAlignment ?? "center")}"/></w:pPr><w:r><w:instrText> PAGE \\* MERGEFORMAT </w:instrText></w:r><w:r><w:instrText> SECTIONPAGES \\* MERGEFORMAT </w:instrText></w:r></w:p></w:ftr>`
    ),
    ...(overrides.nativeOuterFooter
      ? {
          "word/footer2.xml": xml(
            `<w:ftr xmlns:w="${word}"><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:instrText> PAGE \\* MERGEFORMAT </w:instrText></w:r><w:r><w:instrText> SECTIONPAGES \\* MERGEFORMAT </w:instrText></w:r></w:p></w:ftr>`
          )
        }
      : {}),
    "word/footnotes.xml": xml(
      `<w:footnotes xmlns:w="${word}"><w:footnote w:id="1"><w:p><w:r><w:t>脚注</w:t></w:r></w:p></w:footnote></w:footnotes>`
    ),
    "word/media/image1.png": png,
    "word/_rels/document.xml.rels": xml(
      `<Relationships xmlns="${packageRelationships}"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${overrides.nativeOuterFooter ? '<Relationship Id="rIdEvenFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/>' : ""}<Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/><Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/" TargetMode="External"/>${overrides.altChunk ? '<Relationship Id="rIdChunk" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="chunk.html"/>' : ""}</Relationships>`
    ),
    ...(overrides.altChunk
      ? { "word/chunk.html": encoder.encode("<p>整体 HTML</p>") }
      : {})
  });
}

const expectation = {
  id: "unit-fixture",
  page: {
    widthTwips: 11906,
    heightTwips: 16838,
    orientation: "portrait" as const,
    marginsTwips: {
      top: 907,
      right: 907,
      bottom: 907,
      left: 907
    }
  },
  requiredText: ["可编辑正文", "原生表格"],
  requiredFootnoteText: ["脚注"],
  minimumParagraphs: 3,
  minimumTextRuns: 2,
  minimumTables: 1,
  minimumNumberedParagraphs: 1,
  minimumHyperlinks: 1,
  minimumFootnoteReferences: 1,
  minimumMathObjects: 1,
  minimumPngImages: 1,
  requiredImageAltText: ["普通图片"],
  requiredStyleIds: ["Normal", "Heading1", "SourceCode", "Table"],
  requiredParagraphStyleIds: ["Heading1"],
  requirePageField: true,
  minimumSections: 2,
  requireFirstSectionWithoutHeaderFooter: true,
  finalPageNumberStart: 1,
  requireSectionPagesField: true,
  minimumFullWidthTables: 1,
  maximumTextOccurrences: {
    可编辑正文: 1
  },
  forbidInternalMarkers: true,
  pageDecorations: {
    exportConfig: {
      header: defaultExportConfig.header,
      footer: defaultExportConfig.footer
    },
    semanticDocument: {
      schemaVersion: 1 as const,
      titlePolicy: {
        metadataTitle: "suppress" as const,
        firstBodyHeading: "keep" as const
      },
      regions: [
        {
          kind: "cover" as const,
          nodes: [
            {
              kind: "text" as const,
              role: "project-report-title" as const,
              text: "封面"
            }
          ],
          section: {
            headerFooter: "none" as const,
            pageNumber: "hidden" as const,
            breakAfter: "next-page" as const,
            followingPageNumberStart: 1
          }
        }
      ]
    }
  }
};

describe("DOCX 自动验收器", () => {
  it("验证纸张、可编辑结构、关系、PNG 和字段", () => {
    const report = inspectDocxAcceptance(
      createAcceptanceDocx(),
      expectation
    );

    expect(report.page.orientation).toBe("portrait");
    expect(report.structure).toMatchObject({
      tableCount: 1,
      numberedParagraphCount: 1,
      hyperlinkCount: 1,
      footnoteReferenceCount: 1,
      mathObjectCount: 1,
      pngImageCount: 1,
      pageFieldCount: 1,
      sectionPageFieldCount: 1,
      sectionCount: 2,
      fullWidthTableCount: 1,
      internalMarkerCount: 0,
      altChunkCount: 0
    });
    expect(report.checks).toEqual(
      expect.objectContaining({
        editableStructure: true,
        pngMedia: true,
        noAltChunk: true
      })
    );
    expect(report.pageDecorations).toEqual({
      hasCover: true,
      usesDifferentFirstPage: false,
      usesEvenAndOddPages: false,
      bodyPageNumberStart: 1,
      headerReferenceTypes: [],
      footerReferenceTypes: ["default"],
      totalPageField: "SECTIONPAGES"
    });
  });

  it("拒绝通过 altChunk 嵌入的正文 HTML", () => {
    expect(() =>
      inspectDocxAcceptance(
        createAcceptanceDocx({ altChunk: true }),
        expectation
      )
    ).toThrow("altChunk");
  });

  it("拒绝重复文本和未清理的内部标记", () => {
    expect(() =>
      inspectDocxAcceptance(
        createAcceptanceDocx({ duplicateText: true }),
        expectation
      )
    ).toThrow("最多允许 1 次");
    expect(() =>
      inspectDocxAcceptance(
        createAcceptanceDocx({ internalMarker: true }),
        expectation
      )
    ).toThrow("internal-markers");
  });

  it("拒绝 WordprocessingML 属性子节点乱序", () => {
    expect(() =>
      inspectDocxAcceptance(
        createAcceptanceDocx({ invalidPropertyOrder: true }),
        expectation
      )
    ).toThrow("w:pPr 子节点顺序无效");
  });

  it("拒绝封面节残留页码和正文节错误首页设置", () => {
    expect(() =>
      inspectDocxAcceptance(
        createAcceptanceDocx({ coverPageNumber: true }),
        expectation
      )
    ).toThrow("封面节不得包含 w:pgNumType");
    expect(() =>
      inspectDocxAcceptance(
        createAcceptanceDocx({ bodyTitlePage: true }),
        expectation
      )
    ).toThrow("body-title-page");
  });

  it("拒绝页码位置和奇偶页设置偏离导出配置", () => {
    expect(() =>
      inspectDocxAcceptance(
        createAcceptanceDocx({ footerAlignment: "right" }),
        expectation
      )
    ).toThrow("footer-default-alignment");
    expect(() =>
      inspectDocxAcceptance(
        createAcceptanceDocx({ evenAndOddHeaders: true }),
        expectation
      )
    ).toThrow("even-and-odd-setting");
  });

  it("封面重启页码时要求原生奇偶页脚表达外侧页码", () => {
    const outerExpectation = {
      ...expectation,
      pageDecorations: {
        ...expectation.pageDecorations,
        exportConfig: {
          ...expectation.pageDecorations.exportConfig,
          footer: {
            ...expectation.pageDecorations.exportConfig.footer,
            alignment: "outer" as const
          }
        }
      }
    };
    const report = inspectDocxAcceptance(
      createAcceptanceDocx({
        evenAndOddHeaders: true,
        nativeOuterFooter: true,
        footerAlignment: "left"
      }),
      outerExpectation
    );

    expect(report.pageDecorations).toMatchObject({
      hasCover: true,
      usesEvenAndOddPages: true,
      footerReferenceTypes: ["default", "even"]
    });
    expect(() =>
      inspectDocxAcceptance(createAcceptanceDocx(), outerExpectation)
    ).toThrow("body-page-number-start");
  });
});
