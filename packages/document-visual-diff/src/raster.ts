import { createHash } from "node:crypto";

import { createCanvas, loadImage } from "@napi-rs/canvas";

import type {
  PdfPageRaster,
  ComparePageRasterOptions,
  PdfRasterDiffArtifacts,
  PdfRasterDiffMetrics,
  PdfRasterDiffResult,
} from "./types.js";

interface DecodedRaster {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

const RASTER_MASK_BORDER_PX = 2;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function decodeRaster(
  raster: PdfPageRaster,
  width: number,
  height: number,
): Promise<DecodedRaster> {
  if (
    raster.rgba?.length === raster.widthPx * raster.heightPx * 4 &&
    raster.widthPx === width &&
    raster.heightPx === height
  ) {
    return {
      width,
      height,
      rgba: raster.rgba,
    };
  }
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  if (raster.rgba?.length === raster.widthPx * raster.heightPx * 4) {
    const sourceCanvas = createCanvas(raster.widthPx, raster.heightPx);
    const sourceContext = sourceCanvas.getContext("2d");
    const sourceData = sourceContext.createImageData(
      raster.widthPx,
      raster.heightPx,
    );
    sourceData.data.set(raster.rgba);
    sourceContext.putImageData(sourceData, 0, 0);
    context.drawImage(sourceCanvas, 0, 0, width, height);
  } else {
    const image = await loadImage(Buffer.from(raster.png));
    context.drawImage(image, 0, 0, width, height);
  }
  return {
    width,
    height,
    rgba: context.getImageData(0, 0, width, height).data,
  };
}

function luminance(
  rgba: Uint8ClampedArray,
  offset: number,
): number {
  const red = rgba[offset] ?? 255;
  const green = rgba[offset + 1] ?? 255;
  const blue = rgba[offset + 2] ?? 255;
  return (77 * red + 150 * green + 29 * blue) >> 8;
}

function colorDistance(left: RgbColor, right: RgbColor): number {
  return Math.sqrt(
    ((left.red - right.red) ** 2 +
      (left.green - right.green) ** 2 +
      (left.blue - right.blue) ** 2) /
      3,
  );
}

function colorChroma(color: RgbColor): number {
  return Math.max(color.red, color.green, color.blue) -
    Math.min(color.red, color.green, color.blue);
}

function colorLuminance(color: RgbColor): number {
  return (77 * color.red + 150 * color.green + 29 * color.blue) / 256;
}

function rasterBackgroundColor(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): RgbColor {
  const red: number[] = [];
  const green: number[] = [];
  const blue: number[] = [];
  const append = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    red.push(rgba[offset] ?? 255);
    green.push(rgba[offset + 1] ?? 255);
    blue.push(rgba[offset + 2] ?? 255);
  };
  for (let x = 0; x < width; x += 1) {
    append(x, 0);
    if (height > 1) {
      append(x, height - 1);
    }
  }
  for (let y = 1; y < height - 1; y += 1) {
    append(0, y);
    if (width > 1) {
      append(width - 1, y);
    }
  }
  const median = (values: number[]) => {
    if (values.length === 0) {
      return 255;
    }
    values.sort((left, right) => left - right);
    return values[Math.floor(values.length / 2)] ?? 255;
  };
  // 局部语义块会紧贴文字裁剪；连续渐变会把同一背景拆散到许多颜色桶，
  // 使深色文字反而成为“众数背景”。边框中位色能稳定覆盖纯色和渐变，
  // 且不会被少量触边字形反转。
  const border = {
    red: median(red),
    green: median(green),
    blue: median(blue),
  };
  const robustRange = (values: readonly number[]) =>
    (values[Math.floor(values.length * 0.8)] ?? 255) -
    (values[Math.floor(values.length * 0.2)] ?? 255);
  const borderChannelRange = Math.max(
    robustRange(red),
    robustRange(green),
    robustRange(blue),
  );
  // 极紧的字形裁剪可能四边都落在抗锯齿像素上；实心表头等
  // 盒背景也可能在裁剪边界外露出白色。因此保留全图众数作为常规背景。
  const buckets = new Map<
    number,
    { count: number; red: number; green: number; blue: number }
  >();
  let dominant:
    | { count: number; red: number; green: number; blue: number }
    | undefined;
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const pixelRed = rgba[offset] ?? 255;
    const pixelGreen = rgba[offset + 1] ?? 255;
    const pixelBlue = rgba[offset + 2] ?? 255;
    const bucketKey = (pixelRed >> 3) << 10 |
      (pixelGreen >> 3) << 5 |
      (pixelBlue >> 3);
    const bucket = buckets.get(bucketKey) ?? {
      count: 0,
      red: 0,
      green: 0,
      blue: 0,
    };
    bucket.count += 1;
    bucket.red += pixelRed;
    bucket.green += pixelGreen;
    bucket.blue += pixelBlue;
    buckets.set(bucketKey, bucket);
    if (!dominant || bucket.count > dominant.count) {
      dominant = bucket;
    }
  }
  const dominantColor = dominant
    ? {
        red: dominant.red / dominant.count,
        green: dominant.green / dominant.count,
        blue: dominant.blue / dominant.count,
      }
    : border;
  // 只有浅色边界与全图众数出现极大亮度反转时，才判定连续渐变
  // 把深色文字拆分成了错误的“众数背景”。
  return borderChannelRange <= 64 &&
      colorLuminance(border) >= 220 &&
      colorLuminance(dominantColor) <= colorLuminance(border) - 80
    ? border
    : dominantColor;
}

function rasterForegroundColor(
  decoded: DecodedRaster,
): RgbColor {
  const background = rasterBackgroundColor(
    decoded.rgba,
    decoded.width,
    decoded.height,
  );
  const buckets = new Map<
    number,
    { count: number; red: number; green: number; blue: number }
  >();
  for (let offset = 0; offset < decoded.rgba.length; offset += 4) {
    const color = {
      red: decoded.rgba[offset] ?? 255,
      green: decoded.rgba[offset + 1] ?? 255,
      blue: decoded.rgba[offset + 2] ?? 255,
    };
    const distance = colorDistance(color, background);
    if (distance < 48) {
      continue;
    }
    const bucketKey = (color.red >> 3) << 10 |
      (color.green >> 3) << 5 |
      (color.blue >> 3);
    const bucket = buckets.get(bucketKey) ?? {
      count: 0,
      red: 0,
      green: 0,
      blue: 0,
    };
    bucket.count += 1;
    bucket.red += color.red;
    bucket.green += color.green;
    bucket.blue += color.blue;
    buckets.set(bucketKey, bucket);
  }
  let dominant:
    | { count: number; red: number; green: number; blue: number }
    | undefined;
  let dominantDistance = -1;
  for (const bucket of buckets.values()) {
    const averageColor = {
      red: bucket.red / bucket.count,
      green: bucket.green / bucket.count,
      blue: bucket.blue / bucket.count,
    };
    const distance = colorDistance(averageColor, background);
    if (
      distance > dominantDistance + 1 ||
      (Math.abs(distance - dominantDistance) <= 1 &&
        bucket.count > (dominant?.count ?? 0))
    ) {
      dominant = bucket;
      dominantDistance = distance;
    }
  }
  return !dominant
    ? background
    : {
        red: dominant.red / dominant.count,
        green: dominant.green / dominant.count,
        blue: dominant.blue / dominant.count,
      };
}

function rasterDominantForegroundColor(
  decoded: DecodedRaster,
): RgbColor {
  const background = rasterBackgroundColor(
    decoded.rgba,
    decoded.width,
    decoded.height,
  );
  const buckets = new Map<
    number,
    { count: number; red: number; green: number; blue: number }
  >();
  for (let offset = 0; offset < decoded.rgba.length; offset += 4) {
    const color = {
      red: decoded.rgba[offset] ?? 255,
      green: decoded.rgba[offset + 1] ?? 255,
      blue: decoded.rgba[offset + 2] ?? 255,
    };
    if (colorDistance(color, background) < 48) {
      continue;
    }
    const bucketKey = (color.red >> 3) << 10 |
      (color.green >> 3) << 5 |
      (color.blue >> 3);
    const bucket = buckets.get(bucketKey) ?? {
      count: 0,
      red: 0,
      green: 0,
      blue: 0,
    };
    bucket.count += 1;
    bucket.red += color.red;
    bucket.green += color.green;
    bucket.blue += color.blue;
    buckets.set(bucketKey, bucket);
  }
  const dominant = Array.from(buckets.values()).sort(
    (left, right) => right.count - left.count,
  )[0];
  return !dominant
    ? background
    : {
        red: dominant.red / dominant.count,
        green: dominant.green / dominant.count,
        blue: dominant.blue / dominant.count,
      };
}

function rasterDominantChromaticForegroundColor(
  decoded: DecodedRaster,
): RgbColor | undefined {
  const background = rasterBackgroundColor(
    decoded.rgba,
    decoded.width,
    decoded.height,
  );
  const buckets = new Map<
    number,
    { count: number; red: number; green: number; blue: number }
  >();
  for (let offset = 0; offset < decoded.rgba.length; offset += 4) {
    const color = {
      red: decoded.rgba[offset] ?? 255,
      green: decoded.rgba[offset + 1] ?? 255,
      blue: decoded.rgba[offset + 2] ?? 255,
    };
    if (
      colorDistance(color, background) < 48 ||
      colorChroma(color) < 32
    ) {
      continue;
    }
    const bucketKey = (color.red >> 3) << 10 |
      (color.green >> 3) << 5 |
      (color.blue >> 3);
    const bucket = buckets.get(bucketKey) ?? {
      count: 0,
      red: 0,
      green: 0,
      blue: 0,
    };
    bucket.count += 1;
    bucket.red += color.red;
    bucket.green += color.green;
    bucket.blue += color.blue;
    buckets.set(bucketKey, bucket);
  }
  const dominant = Array.from(buckets.values()).sort(
    (left, right) => right.count - left.count,
  )[0];
  return dominant
    ? {
        red: dominant.red / dominant.count,
        green: dominant.green / dominant.count,
        blue: dominant.blue / dominant.count,
      }
    : undefined;
}

function rasterChromaticPalette(decoded: DecodedRaster) {
  const background = rasterBackgroundColor(
    decoded.rgba,
    decoded.width,
    decoded.height,
  );
  const buckets = new Map<
    number,
    { count: number; red: number; green: number; blue: number }
  >();
  for (let offset = 0; offset < decoded.rgba.length; offset += 4) {
    const color = {
      red: decoded.rgba[offset] ?? 255,
      green: decoded.rgba[offset + 1] ?? 255,
      blue: decoded.rgba[offset + 2] ?? 255,
    };
    if (
      colorDistance(color, background) < 48 ||
      colorChroma(color) < 32
    ) {
      continue;
    }
    const bucketKey = (color.red >> 3) << 10 |
      (color.green >> 3) << 5 |
      (color.blue >> 3);
    const bucket = buckets.get(bucketKey) ?? {
      count: 0,
      red: 0,
      green: 0,
      blue: 0,
    };
    bucket.count += 1;
    bucket.red += color.red;
    bucket.green += color.green;
    bucket.blue += color.blue;
    buckets.set(bucketKey, bucket);
  }
  return Array.from(buckets.values()).map((bucket) => ({
    count: bucket.count,
    color: {
      red: bucket.red / bucket.count,
      green: bucket.green / bucket.count,
      blue: bucket.blue / bucket.count,
    },
  }));
}

function chromaticPaletteDistance(
  baseline: DecodedRaster,
  candidate: DecodedRaster,
) {
  const baselinePalette = rasterChromaticPalette(baseline);
  const candidatePalette = rasterChromaticPalette(candidate);
  if (baselinePalette.length === 0 || candidatePalette.length === 0) {
    return undefined;
  }
  const directionalDistance = (
    source: ReturnType<typeof rasterChromaticPalette>,
    target: ReturnType<typeof rasterChromaticPalette>,
  ) => {
    let weightedDistance = 0;
    let totalWeight = 0;
    for (const entry of source) {
      weightedDistance += entry.count * Math.min(
        ...target.map((candidateEntry) =>
          colorDistance(entry.color, candidateEntry.color)
        ),
      );
      totalWeight += entry.count;
    }
    return weightedDistance / totalWeight;
  };
  return Math.max(
    directionalDistance(baselinePalette, candidatePalette),
    directionalDistance(candidatePalette, baselinePalette),
  );
}

function clearMaskBorder(
  mask: Uint8Array,
  width: number,
  height: number,
  borderPx = RASTER_MASK_BORDER_PX,
) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (
        x < borderPx ||
        y < borderPx ||
        x >= width - borderPx ||
        y >= height - borderPx
      ) {
        mask[y * width + x] = 0;
      }
    }
  }
  return mask;
}

function calculateBinaryIou(
  left: Uint8Array,
  right: Uint8Array,
): number {
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] === 1;
    const rightValue = right[index] === 1;
    if (leftValue || rightValue) {
      union += 1;
      if (leftValue && rightValue) {
        intersection += 1;
      }
    }
  }
  return union === 0 ? 1 : intersection / union;
}

function dilateBinaryMask(
  input: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius === 0) {
    return input;
  }
  const horizontal = new Uint8Array(input.length);
  const output = new Uint8Array(input.length);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      const start = Math.max(0, x - radius);
      const end = Math.min(width - 1, x + radius);
      for (let sampleX = start; sampleX <= end; sampleX += 1) {
        if (input[rowOffset + sampleX] === 1) {
          horizontal[rowOffset + x] = 1;
          break;
        }
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = Math.max(0, y - radius);
      const end = Math.min(height - 1, y + radius);
      for (let sampleY = start; sampleY <= end; sampleY += 1) {
        if (horizontal[sampleY * width + x] === 1) {
          output[y * width + x] = 1;
          break;
        }
      }
    }
  }
  return output;
}

function calculateSpatiallyTolerantIou(
  left: Uint8Array,
  right: Uint8Array,
  width: number,
  height: number,
  radius: number,
): number {
  if (radius === 0) {
    return calculateBinaryIou(left, right);
  }
  const dilatedLeft = dilateBinaryMask(left, width, height, radius);
  const dilatedRight = dilateBinaryMask(right, width, height, radius);
  let leftCount = 0;
  let rightCount = 0;
  let matchedLeft = 0;
  let matchedRight = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === 1) {
      leftCount += 1;
      if (dilatedRight[index] === 1) {
        matchedLeft += 1;
      }
    }
    if (right[index] === 1) {
      rightCount += 1;
      if (dilatedLeft[index] === 1) {
        matchedRight += 1;
      }
    }
  }
  const matchedIntersection = (matchedLeft + matchedRight) / 2;
  const union = leftCount + rightCount - matchedIntersection;
  return union === 0 ? 1 : matchedIntersection / union;
}

function createEdgeMask(
  grayscale: Uint8Array,
  width: number,
  height: number,
  threshold: number,
): Uint8Array {
  const edges = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    const rowOffset = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const index = rowOffset + x;
      const horizontal = Math.abs(
        (grayscale[index + 1] ?? 255) -
          (grayscale[index - 1] ?? 255),
      );
      const vertical = Math.abs(
        (grayscale[index + width] ?? 255) -
          (grayscale[index - width] ?? 255),
      );
      if (horizontal + vertical >= threshold) {
        edges[index] = 1;
      }
    }
  }
  return edges;
}

function encodeRgbaPng(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  const imageData = context.createImageData(width, height);
  imageData.data.set(rgba);
  context.putImageData(imageData, 0, 0);
  return Uint8Array.from(canvas.toBuffer("image/png"));
}

function createArtifacts(
  baselineGray: Uint8Array,
  candidateGray: Uint8Array,
  pixelDifference: Uint8Array,
  width: number,
  height: number,
): PdfRasterDiffArtifacts {
  const overlay = new Uint8ClampedArray(width * height * 4);
  const heatmap = new Uint8ClampedArray(width * height * 4);
  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const outputOffset = pixelIndex * 4;
    const baselineValue = baselineGray[pixelIndex] ?? 255;
    const candidateValue = candidateGray[pixelIndex] ?? 255;
    const difference = pixelDifference[pixelIndex] ?? 0;

    overlay[outputOffset] = baselineValue;
    overlay[outputOffset + 1] = candidateValue;
    overlay[outputOffset + 2] = candidateValue;
    overlay[outputOffset + 3] = 255;

    if (difference === 0) {
      heatmap[outputOffset] = 255;
      heatmap[outputOffset + 1] = 255;
      heatmap[outputOffset + 2] = 255;
    } else {
      const intensity = Math.min(255, difference * 4);
      heatmap[outputOffset] = 255;
      heatmap[outputOffset + 1] = 255 - intensity;
      heatmap[outputOffset + 2] = Math.max(0, 160 - intensity);
    }
    heatmap[outputOffset + 3] = 255;
  }
  const overlayPng = encodeRgbaPng(overlay, width, height);
  const heatmapPng = encodeRgbaPng(heatmap, width, height);
  const baselinePng = encodeGrayscalePng(baselineGray, width, height);
  const candidatePng = encodeGrayscalePng(candidateGray, width, height);
  return {
    baselinePng,
    candidatePng,
    overlayPng,
    heatmapPng,
    baselineSha256: sha256(baselinePng),
    candidateSha256: sha256(candidatePng),
    overlaySha256: sha256(overlayPng),
    heatmapSha256: sha256(heatmapPng),
  };
}

function encodeGrayscalePng(
  grayscale: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < grayscale.length; index += 1) {
    const value = grayscale[index] ?? 255;
    const offset = index * 4;
    rgba[offset] = value;
    rgba[offset + 1] = value;
    rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }
  return encodeRgbaPng(rgba, width, height);
}

export async function comparePageRasters(
  baseline: PdfPageRaster,
  candidate: PdfPageRaster,
  options: number | ComparePageRasterOptions = {},
): Promise<PdfRasterDiffResult> {
  const resolvedOptions =
    typeof options === "number"
      ? { pixelDifferenceThreshold: options }
      : options;
  const pixelDifferenceThreshold =
    resolvedOptions.pixelDifferenceThreshold ?? 8;
  const spatialTolerancePx = resolvedOptions.spatialTolerancePx ?? 4;
  if (
    !Number.isInteger(pixelDifferenceThreshold) ||
    pixelDifferenceThreshold < 0 ||
    pixelDifferenceThreshold > 255
  ) {
    throw new Error("像素变化阈值必须是 0 到 255 之间的整数");
  }
  if (
    !Number.isInteger(spatialTolerancePx) ||
    spatialTolerancePx < 0 ||
    spatialTolerancePx > 8
  ) {
    throw new Error("空间容差必须是 0 到 8 之间的整数像素");
  }
  const width =
    resolvedOptions.targetWidthPx ??
    Math.max(baseline.widthPx, candidate.widthPx);
  const height =
    resolvedOptions.targetHeightPx ??
    Math.max(baseline.heightPx, candidate.heightPx);
  if (!Number.isSafeInteger(width) || width <= 0 ||
      !Number.isSafeInteger(height) || height <= 0) {
    throw new Error("栅格比较尺寸必须是正整数");
  }
  const baselineDecoded = await decodeRaster(baseline, width, height);
  const candidateDecoded = await decodeRaster(candidate, width, height);
  const pixelCount = width * height;
  const baselineGray = new Uint8Array(pixelCount);
  const candidateGray = new Uint8Array(pixelCount);
  const pixelDifference = new Uint8Array(pixelCount);
  const baselineInk = new Uint8Array(pixelCount);
  const candidateInk = new Uint8Array(pixelCount);
  const baselineForegroundInk = new Uint8Array(pixelCount);
  const candidateForegroundInk = new Uint8Array(pixelCount);
  const baselineBackground = rasterBackgroundColor(
    baselineDecoded.rgba,
    width,
    height,
  );
  const candidateBackground = rasterBackgroundColor(
    candidateDecoded.rgba,
    width,
    height,
  );
  const baselineForeground = rasterForegroundColor(baselineDecoded);
  const candidateForeground = rasterForegroundColor(candidateDecoded);
  let absoluteError = 0;
  let changedPixels = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    const redDifference = Math.abs(
      (baselineDecoded.rgba[offset] ?? 255) -
        (candidateDecoded.rgba[offset] ?? 255),
    );
    const greenDifference = Math.abs(
      (baselineDecoded.rgba[offset + 1] ?? 255) -
        (candidateDecoded.rgba[offset + 1] ?? 255),
    );
    const blueDifference = Math.abs(
      (baselineDecoded.rgba[offset + 2] ?? 255) -
        (candidateDecoded.rgba[offset + 2] ?? 255),
    );
    absoluteError += redDifference + greenDifference + blueDifference;
    const maximumDifference = Math.max(
      redDifference,
      greenDifference,
      blueDifference,
    );
    pixelDifference[pixelIndex] = maximumDifference;
    if (maximumDifference > pixelDifferenceThreshold) {
      changedPixels += 1;
    }
    const baselineValue = luminance(baselineDecoded.rgba, offset);
    const candidateValue = luminance(candidateDecoded.rgba, offset);
    baselineGray[pixelIndex] = baselineValue;
    candidateGray[pixelIndex] = candidateValue;
    const baselineColor = {
      red: baselineDecoded.rgba[offset] ?? 255,
      green: baselineDecoded.rgba[offset + 1] ?? 255,
      blue: baselineDecoded.rgba[offset + 2] ?? 255,
    };
    const candidateColor = {
      red: candidateDecoded.rgba[offset] ?? 255,
      green: candidateDecoded.rgba[offset + 1] ?? 255,
      blue: candidateDecoded.rgba[offset + 2] ?? 255,
    };
    if (colorDistance(baselineColor, baselineBackground) >= 16) {
      baselineInk[pixelIndex] = 1;
    }
    if (colorDistance(candidateColor, candidateBackground) >= 16) {
      candidateInk[pixelIndex] = 1;
    }
    const baselineBackgroundDistance = colorDistance(
      baselineColor,
      baselineBackground,
    );
    if (
      baselineBackgroundDistance >= 32 &&
      colorDistance(baselineColor, baselineForeground) <
        baselineBackgroundDistance
    ) {
      baselineForegroundInk[pixelIndex] = 1;
    }
    const candidateBackgroundDistance = colorDistance(
      candidateColor,
      candidateBackground,
    );
    if (
      candidateBackgroundDistance >= 32 &&
      colorDistance(candidateColor, candidateForeground) <
        candidateBackgroundDistance
    ) {
      candidateForegroundInk[pixelIndex] = 1;
    }
  }

  clearMaskBorder(baselineInk, width, height);
  clearMaskBorder(candidateInk, width, height);
  clearMaskBorder(baselineForegroundInk, width, height);
  clearMaskBorder(candidateForegroundInk, width, height);
  const baselineEdges = clearMaskBorder(
    createEdgeMask(baselineGray, width, height, 40),
    width,
    height,
  );
  const candidateEdges = clearMaskBorder(
    createEdgeMask(candidateGray, width, height, 40),
    width,
    height,
  );
  const foregroundColorDelta = colorDistance(
    baselineForeground,
    candidateForeground,
  );
  const dominantForegroundColorDelta = colorDistance(
    rasterDominantForegroundColor(baselineDecoded),
    rasterDominantForegroundColor(candidateDecoded),
  );
  const baselineChromaticForeground =
    rasterDominantChromaticForegroundColor(baselineDecoded);
  const candidateChromaticForeground =
    rasterDominantChromaticForegroundColor(candidateDecoded);
  const chromaticForegroundColorDelta =
    baselineChromaticForeground && candidateChromaticForeground
      ? colorDistance(
          baselineChromaticForeground,
          candidateChromaticForeground,
        )
      : undefined;
  const chromaticPaletteDelta = chromaticPaletteDistance(
    baselineDecoded,
    candidateDecoded,
  );
  const backgroundColorDelta = colorDistance(
    baselineBackground,
    candidateBackground,
  );
  const metrics: PdfRasterDiffMetrics = {
    baselineWidthPx: baseline.widthPx,
    baselineHeightPx: baseline.heightPx,
    candidateWidthPx: candidate.widthPx,
    candidateHeightPx: candidate.heightPx,
    comparedWidthPx: width,
    comparedHeightPx: height,
    dimensionsMatch:
      baseline.widthPx === candidate.widthPx &&
      baseline.heightPx === candidate.heightPx,
    geometryNormalized: resolvedOptions.geometryNormalized ?? false,
    spatialTolerancePx,
    meanAbsoluteError: absoluteError / (pixelCount * 3),
    changedPixelRatio: changedPixels / pixelCount,
    inkIou: calculateSpatiallyTolerantIou(
      baselineInk,
      candidateInk,
      width,
      height,
      spatialTolerancePx,
    ),
    foregroundInkIou: calculateSpatiallyTolerantIou(
      baselineForegroundInk,
      candidateForegroundInk,
      width,
      height,
      spatialTolerancePx,
    ),
    edgeIou: calculateSpatiallyTolerantIou(
      baselineEdges,
      candidateEdges,
      width,
      height,
      spatialTolerancePx,
    ),
    backgroundColorDelta,
    foregroundColorDelta,
    baselineForegroundChroma: colorChroma(baselineForeground),
    candidateForegroundChroma: colorChroma(candidateForeground),
    foregroundLuminanceDelta: Math.abs(
      colorLuminance(baselineForeground) -
        colorLuminance(candidateForeground),
    ),
    dominantForegroundColorDelta,
    ...(chromaticForegroundColorDelta !== undefined
      ? { chromaticForegroundColorDelta }
      : {}),
    ...(chromaticPaletteDelta !== undefined
      ? { chromaticPaletteDelta }
      : {}),
  };
  return {
    metrics,
    artifacts: createArtifacts(
      baselineGray,
      candidateGray,
      pixelDifference,
      width,
      height,
    ),
  };
}
