import { describe, expect, it } from "vitest";
import type {
  DocxMediaKind,
  DocxPngMediaResource,
  PreparedDocxMedia
} from "@morphdoc/core";
import { preparePandocMedia } from "../src/index.js";

const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01
]);

function resource(
  kind: DocxMediaKind,
  ordinal: number,
  kindOrdinal: number
): DocxPngMediaResource {
  return {
    id: `docx-media-${ordinal}`,
    kind,
    ordinal,
    kindOrdinal,
    altText: `${kind} ${kindOrdinal}`,
    caption: `${kind} 图注`,
    alignment: "center",
    displayWidthPx: 384,
    displayHeightPx: 192,
    captureX: 0,
    captureY: 0,
    captureWidthPx: 384,
    captureHeightPx: 192,
    rasterScale: 1,
    fileName: `media-${ordinal}.png`,
    contentType: "image/png",
    content: png,
    pixelWidth: 1,
    pixelHeight: 1
  };
}

function prepared(
  resources: DocxPngMediaResource[]
): PreparedDocxMedia {
  return {
    resources,
    echartsErrors: [],
    mermaidErrors: [],
    warnings: [],
    totalBytes: resources.reduce(
      (total, item) => total + item.content.byteLength,
      0
    )
  };
}

describe("Pandoc DOCX 媒体映射", () => {
  it("按媒体类型和捕获顺序生成受控路径与物理尺寸", () => {
    const result = preparePandocMedia(
      prepared([
        resource("image", 1, 1),
        resource("mermaid", 2, 1),
        resource("echarts", 3, 1)
      ])
    );

    expect(result.files.map((item) => item.relativePath)).toEqual([
      "media/media-001.png",
      "media/media-002.png",
      "media/media-003.png"
    ]);
    expect(result.map.image[0]).toMatchObject({
      binding: "morphdoc-media:docx-media-1",
      path: "media/media-001.png",
      width: "101.600mm",
      height: "50.800mm"
    });
    expect(result.map.mermaid).toHaveLength(1);
    expect(result.map.echarts).toHaveLength(1);
    expect(result.layout[0]).toMatchObject({
      id: "docx-media-1",
      binding: "morphdoc-media:docx-media-1",
      alignment: "center",
      widthEmu: 3_657_600,
      heightEmu: 1_828_800
    });
  });

  it("拒绝顺序错位、无效 PNG 和图表错误", () => {
    expect(() =>
      preparePandocMedia(
        prepared([resource("image", 2, 1)])
      )
    ).toThrow("顺序");

    expect(() =>
      preparePandocMedia(
        prepared([
          {
            ...resource("image", 1, 1),
            content: new Uint8Array([1, 2, 3])
          }
        ])
      )
    ).toThrow("有效 PNG");

    expect(() =>
      preparePandocMedia({
        ...prepared([]),
        mermaidErrors: ["图表错误"]
      })
    ).toThrow("已中止转换");
  });
});
