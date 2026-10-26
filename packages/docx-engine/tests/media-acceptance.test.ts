import { describe, expect, it } from "vitest";
import {
  inspectDocxMediaAcceptance,
  readReferenceDocxPackage,
  writeGeneratedDocxPackage,
  type DocxMediaAcceptanceExpectation
} from "../src/index.js";
import { createTestBaselineReference } from "./reference-test-fixture.js";

const encoder = new TextEncoder();
const word =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const officeRelationships =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const packageRelationships =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const wordprocessingDrawing =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const drawing =
  "http://schemas.openxmlformats.org/drawingml/2006/main";
const picture =
  "http://schemas.openxmlformats.org/drawingml/2006/picture";
const imageRelationship =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

const documentXml =
  `<w:document xmlns:w="${word}" xmlns:r="${officeRelationships}" xmlns:wp="${wordprocessingDrawing}" xmlns:a="${drawing}" xmlns:pic="${picture}"><w:body>` +
  `<w:p><w:pPr><w:pStyle w:val="Figure"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>` +
  `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="3048000" cy="1524000"/><wp:docPr id="1" name="Picture" descr="验收图片" title=""/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
  `<a:graphic><a:graphicData uri="${picture}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="image.png"/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3048000" cy="1524000"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
  `</wp:inline></w:drawing></w:r></w:p>` +
  `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000"/></w:sectPr>` +
  `</w:body></w:document>`;

const relationshipsXml =
  `<Relationships xmlns="${packageRelationships}">` +
  `<Relationship Id="rIdImage" Type="${imageRelationship}" Target="media/image1.png"/>` +
  `</Relationships>`;

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
  0,
  0x49,
  0x48,
  0x44,
  0x52,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  1
);

const expectation: DocxMediaAcceptanceExpectation = {
  items: [
    {
      id: "docx-media-1",
      binding: "morphdoc-media:docx-media-1",
      kind: "image",
      ordinal: 1,
      altText: "验收图片",
      alignment: "center",
      displayWidthPx: 320,
      displayHeightPx: 160,
      widthEmu: 3_048_000,
      heightEmu: 1_524_000
    }
  ],
  maximumWidthEmu: 6_000_000,
  maximumHeightEmu: 9_000_000
};

function fixture(options: {
  document?: (value: string) => string;
  relationships?: (value: string) => string;
  image?: Uint8Array;
} = {}) {
  const baseline = readReferenceDocxPackage(
    createTestBaselineReference()
  );
  const entries = new Map(baseline.entries);
  entries.set(
    "word/document.xml",
    encoder.encode(options.document?.(documentXml) ?? documentXml)
  );
  entries.set(
    "word/_rels/document.xml.rels",
    encoder.encode(
      options.relationships?.(relationshipsXml) ?? relationshipsXml
    )
  );
  entries.set("word/media/image1.png", options.image ?? png);
  return writeGeneratedDocxPackage(entries);
}

describe("DOCX 媒体 OOXML 门禁", () => {
  it("验收内联尺寸、比例、对齐和唯一 PNG 关系", () => {
    const report = inspectDocxMediaAcceptance(
      fixture(),
      expectation,
      "media-fixture"
    );

    expect(report).toMatchObject({
      expectedCount: 1,
      drawingCount: 1,
      inlineCount: 1,
      anchorCount: 0,
      observations: [
        {
          id: "docx-media-1",
          widthEmu: 3_048_000,
          heightEmu: 1_524_000,
          alignment: "center",
          relationshipId: "rIdImage",
          partName: "word/media/image1.png"
        }
      ]
    });
  });

  it.each([
    {
      name: "浮动锚点",
      check: "inline-layout",
      document: (value: string) =>
        value
          .replace("<wp:inline ", "<wp:anchor ")
          .replace("</wp:inline>", "</wp:anchor>")
    },
    {
      name: "双层尺寸不一致",
      check: "dimensions",
      document: (value: string) =>
        value.replace(
          '<a:ext cx="3048000" cy="1524000"/>',
          '<a:ext cx="3047000" cy="1524000"/>'
        )
    },
    {
      name: "比例漂移",
      check: "aspect-ratio",
      document: (value: string) =>
        value.replaceAll('cx="3048000"', 'cx="3048010"')
    },
    {
      name: "错误对齐",
      check: "alignment",
      document: (value: string) =>
        value.replace(
          '<w:jc w:val="center"/>',
          '<w:jc w:val="left"/>'
        )
    },
    {
      name: "缺少比例锁",
      check: "aspect-lock",
      document: (value: string) =>
        value.replace('noChangeAspect="1"', 'noChangeAspect="0"')
    },
    {
      name: "图片裁切",
      check: "cropping-transform",
      document: (value: string) =>
        value.replace("<pic:blipFill>", "<pic:blipFill><a:srcRect/>")
    },
    {
      name: "旋转图片",
      check: "cropping-transform",
      document: (value: string) =>
        value.replace("<a:xfrm>", '<a:xfrm rot="60000">')
    },
    {
      name: "替代文本错位",
      check: "alternative-text",
      document: (value: string) =>
        value.replace('descr="验收图片"', 'descr="错误图片"')
    },
    {
      name: "内部绑定残留",
      check: "alternative-text",
      document: (value: string) =>
        value.replace('title=""', 'title="morphdoc-media:docx-media-1"')
    },
    {
      name: "图片关系缺失",
      check: "relationships",
      document: (value: string) =>
        value.replace('r:embed="rIdImage"', 'r:embed="missing"')
    }
  ])("拒绝$name", ({ check, document }) => {
    expect(() =>
      inspectDocxMediaAcceptance(
        fixture({ document }),
        expectation,
        "tampered"
      )
    ).toThrow(check);
  });

  it("拒绝外部、非 PNG、伪 PNG 和额外图片关系", () => {
    expect(() =>
      inspectDocxMediaAcceptance(
        fixture({
          relationships: (value) =>
            value.replace("/>", ' TargetMode="External"/>')
        }),
        expectation,
        "external"
      )
    ).toThrow("relationships");

    expect(() =>
      inspectDocxMediaAcceptance(
        fixture({
          relationships: (value) =>
            value.replace("image1.png", "image1.jpg")
        }),
        expectation,
        "jpeg"
      )
    ).toThrow("png-media");

    expect(() =>
      inspectDocxMediaAcceptance(
        fixture({ image: new Uint8Array(24) }),
        expectation,
        "fake-png"
      )
    ).toThrow("png-media");

    expect(() =>
      inspectDocxMediaAcceptance(
        fixture({
          relationships: (value) =>
            value.replace(
              "</Relationships>",
              `<Relationship Id="extra" Type="${imageRelationship}" Target="media/extra.png"/></Relationships>`
            )
        }),
        expectation,
        "extra"
      )
    ).toThrow("额外");
  });

  it("拒绝超过当前页面内容区的显示尺寸", () => {
    expect(() =>
      inspectDocxMediaAcceptance(
        fixture(),
        {
          ...expectation,
          maximumWidthEmu: 3_047_000
        },
        "oversized"
      )
    ).toThrow("dimensions");
  });
});
