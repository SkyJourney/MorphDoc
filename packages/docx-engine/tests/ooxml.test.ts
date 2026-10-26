import { describe, expect, it } from "vitest";
import {
  WORD_NAMESPACE,
  appendElement,
  parseXmlPart,
  serializeXmlPart,
  validateWordprocessingElementOrder
} from "../src/ooxml.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function paragraphPropertiesDocument(children = "") {
  return parseXmlPart(
    encoder.encode(
      `<w:document xmlns:w="${WORD_NAMESPACE}">` +
        `<w:body><w:p><w:pPr>${children}</w:pPr></w:p></w:body>` +
        "</w:document>"
    ),
    "word/document.xml"
  );
}

describe("OOXML 子节点顺序", () => {
  it("按 WordprocessingML 顺序插入新增属性", () => {
    const document = paragraphPropertiesDocument(
      "<w:pStyle w:val=\"Normal\"/><w:jc w:val=\"left\"/>"
    );
    const properties = document.getElementsByTagNameNS(
      WORD_NAMESPACE,
      "pPr"
    )[0]!;

    appendElement(properties, WORD_NAMESPACE, "w:pBdr");
    appendElement(properties, WORD_NAMESPACE, "w:keepNext");
    appendElement(properties, WORD_NAMESPACE, "w:spacing");

    const xml = decoder.decode(serializeXmlPart(document));
    expect(xml.indexOf("<w:keepNext")).toBeLessThan(
      xml.indexOf("<w:pBdr")
    );
    expect(xml.indexOf("<w:pBdr")).toBeLessThan(
      xml.indexOf("<w:spacing")
    );
    expect(xml.indexOf("<w:spacing")).toBeLessThan(
      xml.indexOf("<w:jc")
    );
    expect(() =>
      validateWordprocessingElementOrder(
        document,
        "word/document.xml"
      )
    ).not.toThrow();
  });

  it("在序列化时规范化已有乱序属性", () => {
    const document = paragraphPropertiesDocument(
      "<w:pStyle w:val=\"Normal\"/>" +
        "<w:pBdr/><w:keepLines/><w:keepNext/>"
    );

    const serialized = serializeXmlPart(document);
    const reparsed = parseXmlPart(
      serialized,
      "word/document.xml"
    );
    expect(() =>
      validateWordprocessingElementOrder(
        reparsed,
        "word/document.xml"
      )
    ).not.toThrow();

    const xml = decoder.decode(serialized);
    expect(xml.indexOf("<w:keepNext")).toBeLessThan(
      xml.indexOf("<w:keepLines")
    );
    expect(xml.indexOf("<w:keepLines")).toBeLessThan(
      xml.indexOf("<w:pBdr")
    );
  });

  it("拒绝未经规范化的乱序属性", () => {
    const document = paragraphPropertiesDocument(
      "<w:pStyle w:val=\"Normal\"/>" +
        "<w:jc w:val=\"left\"/><w:spacing/>"
    );

    expect(() =>
      validateWordprocessingElementOrder(
        document,
        "word/document.xml"
      )
    ).toThrow(
      "word/document.xml 的 w:pPr 子节点顺序无效"
    );
  });

  it("规范化表格、单元格和边框顺序", () => {
    const document = parseXmlPart(
      encoder.encode(
        `<w:document xmlns:w="${WORD_NAMESPACE}"><w:body>` +
          "<w:tbl><w:tblPr>" +
          "<w:tblLook/><w:tblW/><w:tblLayout/>" +
          "</w:tblPr><w:tblGrid/><w:tr><w:tc><w:tcPr>" +
          "<w:gridSpan/><w:shd/><w:tcW/>" +
          "</w:tcPr><w:p/></w:tc></w:tr></w:tbl>" +
          "<w:sectPr><w:docGrid/><w:vAlign/></w:sectPr>" +
          "</w:body></w:document>"
      ),
      "word/document.xml"
    );

    const serialized = serializeXmlPart(document);
    const reparsed = parseXmlPart(
      serialized,
      "word/document.xml"
    );
    expect(() =>
      validateWordprocessingElementOrder(
        reparsed,
        "word/document.xml"
      )
    ).not.toThrow();
  });

  it("规范化表格条件样式的属性顺序", () => {
    const document = parseXmlPart(
      encoder.encode(
        `<w:styles xmlns:w="${WORD_NAMESPACE}">` +
          '<w:style w:type="table" w:styleId="Table">' +
          '<w:tblStylePr w:type="firstRow">' +
          "<w:tcPr/><w:rPr/><w:pPr/>" +
          "</w:tblStylePr></w:style></w:styles>"
      ),
      "word/styles.xml"
    );

    const xml = decoder.decode(serializeXmlPart(document));
    expect(xml.indexOf("<w:pPr")).toBeLessThan(
      xml.indexOf("<w:rPr")
    );
    expect(xml.indexOf("<w:rPr")).toBeLessThan(
      xml.indexOf("<w:tcPr")
    );
  });
});
