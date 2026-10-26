import { zipSync } from "fflate";

const encoder = new TextEncoder();
const wordNamespace =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function xml(value: string) {
  return encoder.encode(value);
}

export function createTestBaselineReference() {
  const styleIds = [
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
  ];
  const styles = styleIds
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
  return zipSync({
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
  });
}
