import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sampleMarkdown } from "../src/sample-markdown";

function readPngDimensions(base64: string) {
  const png = Buffer.from(base64, "base64");
  expect(png.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  );
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const bitDepth = png[24] ?? 0;
  const colorType = png[25] ?? 0;
  const samplesPerPixel =
    colorType === 0 || colorType === 3
      ? 1
      : colorType === 2
        ? 3
        : colorType === 4
          ? 2
          : 4;
  const idatParts: Buffer[] = [];
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") {
      idatParts.push(
        png.subarray(offset + 8, offset + 8 + length)
      );
    }
    offset += 12 + length;
  }
  const decoded = inflateSync(Buffer.concat(idatParts));
  const rowBytes = Math.ceil(
    (width * bitDepth * samplesPerPixel) / 8
  );
  expect(decoded.length).toBe((rowBytes + 1) * height);
  return { width, height };
}

describe("默认示例 Markdown", () => {
  it("仅保留一张网络图片并提供三种 Base64 图片尺寸", () => {
    expect(
      sampleMarkdown.match(/https?:\/\/[^\s)]+/gu)
    ).toHaveLength(1);
    expect(
      sampleMarkdown.match(/data:image\/png;base64,/gu)
    ).toHaveLength(3);
    expect(sampleMarkdown).toContain("1600×900");
    expect(sampleMarkdown).toContain("900×1800");
    expect(sampleMarkdown).toContain("1200×880");
  });

  it("所有内嵌 PNG 均可完整解压且尺寸符合描述", () => {
    const images = Array.from(
      sampleMarkdown.matchAll(
        /data:image\/png;base64,([A-Za-z0-9+/=]+)/gu
      ),
      (match) => readPngDimensions(match[1] ?? "")
    );
    expect(images).toEqual([
      { width: 1600, height: 900 },
      { width: 900, height: 1800 },
      { width: 1200, height: 880 }
    ]);
  });

  it("覆盖 Mermaid、ECharts 分档和串行媒体场景", () => {
    expect(
      sampleMarkdown.match(/```mermaid/gu)
    ).toHaveLength(3);
    expect(
      sampleMarkdown.match(/```echarts/gu)
    ).toHaveLength(4);
    expect(sampleMarkdown).toContain("height: 40mm");
    expect(sampleMarkdown).toContain("height: 58mm");
    expect(sampleMarkdown).toContain("height: 85mm");
    expect(sampleMarkdown).toContain("## 串行媒体块");
  });
});
