import fs from "node:fs";
import { serialize } from "node:v8";
import { createCanvas, loadImage } from "@napi-rs/canvas";

import { createPdfDocumentSnapshot } from "../packages/document-visual-diff/dist/index.js";

const [pdfPath, outputPath, sourceJson, dpiText, markersJson] =
  process.argv.slice(2);
if (!pdfPath || !outputPath || !sourceJson) {
  throw new Error("缺少 PDF 快照 worker 参数");
}

const source = JSON.parse(sourceJson);
const snapshot = await createPdfDocumentSnapshot(fs.readFileSync(pdfPath), {
  source,
  dpi: Number(dpiText || 144)
});
const markerDefinitions = JSON.parse(markersJson || "[]");
const markers = [];
for (const definition of markerDefinitions) {
  const target = {
    r: Number.parseInt(definition.color.slice(1, 3), 16),
    g: Number.parseInt(definition.color.slice(3, 5), 16),
    b: Number.parseInt(definition.color.slice(5, 7), 16)
  };
  let best;
  for (const page of snapshot.pages) {
    if (!page.raster) {
      continue;
    }
    const image = await loadImage(Buffer.from(page.raster.png));
    const canvas = createCanvas(page.raster.widthPx, page.raster.heightPx);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(
      0,
      0,
      page.raster.widthPx,
      page.raster.heightPx
    ).data;
    let count = 0;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = -1;
    let maxY = -1;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (
        Math.abs(pixels[offset] - target.r) <= 12 &&
        Math.abs(pixels[offset + 1] - target.g) <= 12 &&
        Math.abs(pixels[offset + 2] - target.b) <= 12 &&
        pixels[offset + 3] >= 200
      ) {
        const pixelIndex = offset / 4;
        const x = pixelIndex % page.raster.widthPx;
        const y = Math.floor(pixelIndex / page.raster.widthPx);
        count += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (!best || count > best.count) {
      best = {
        pageNumber: page.pageNumber,
        pageWidthPt: page.widthPt,
        dpi: page.raster.dpi,
        count,
        minX,
        minY,
        maxX,
        maxY
      };
    }
  }
  if (!best || best.count < 100) {
    throw new Error(`${source.label} 未定位 ${definition.label}`);
  }
  const scale = 72 / best.dpi;
  markers.push({
    id: definition.id,
    label: definition.label,
    pageNumber: best.pageNumber,
    pixelCount: best.count,
    xPt: best.minX * scale,
    yPt: best.minY * scale,
    widthPt: (best.maxX - best.minX + 1) * scale,
    heightPt: (best.maxY - best.minY + 1) * scale,
    centerXPt: ((best.minX + best.maxX + 1) / 2) * scale,
    pageWidthPt: best.pageWidthPt
  });
}
fs.writeFileSync(outputPath, serialize({ snapshot, markers }));
