import { createHash } from "node:crypto";

import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { aggregatePdfTextLines, buildPageContentText, normalizePdfText } from "./text.js";
import type {
  CreatePdfSnapshotOptions,
  PdfDocumentSnapshot,
  PdfFontSnapshot,
  PdfPageSnapshot,
  PdfSnapshotLimits,
  PdfTextItemSnapshot,
} from "./types.js";

interface PdfJsTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}

interface PdfJsTextStyle {
  fontFamily?: string;
}

interface PdfJsResolvedFont {
  name?: string;
  fallbackName?: string;
  isType3Font?: boolean;
  missingFile?: boolean;
}

export const DEFAULT_PDF_SNAPSHOT_LIMITS: PdfSnapshotLimits = {
  maxPdfBytes: 100 * 1024 * 1024,
  maxPages: 500,
  maxPagePixels: 40_000_000,
  maxTotalPixels: 500_000_000,
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isTextItem(item: unknown): item is PdfJsTextItem {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    typeof item.str === "string" &&
    "transform" in item &&
    Array.isArray(item.transform) &&
    item.transform.every((value) => typeof value === "number") &&
    "width" in item &&
    typeof item.width === "number" &&
    "height" in item &&
    typeof item.height === "number" &&
    "fontName" in item &&
    typeof item.fontName === "string" &&
    "hasEOL" in item &&
    typeof item.hasEOL === "boolean"
  );
}

function createTextItemSnapshot(
  item: PdfJsTextItem,
  pageHeightPt: number,
  styles: Readonly<Record<string, PdfJsTextStyle>>,
  fonts: ReadonlyMap<string, PdfFontSnapshot>,
): PdfTextItemSnapshot | undefined {
  const normalizedText = normalizePdfText(item.str);
  if (!normalizedText) {
    return undefined;
  }
  const x = item.transform[4] ?? 0;
  const baselineFromBottom = item.transform[5] ?? 0;
  const height = Math.max(
    Number.isFinite(item.height) ? Math.abs(item.height) : 0,
    Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0),
    0.1,
  );
  const width = Math.max(
    Number.isFinite(item.width) ? Math.abs(item.width) : 0,
    0,
  );
  const baselineY = pageHeightPt - baselineFromBottom;
  const font = fonts.get(item.fontName);
  const fontFamily = font?.name ?? styles[item.fontName]?.fontFamily;
  return {
    text: item.str,
    normalizedText,
    bounds: {
      x,
      y: baselineY - height,
      width,
      height,
    },
    baselineY,
    fontName: item.fontName,
    ...(fontFamily ? { fontFamily } : {}),
    ...(font?.fallbackFamily
      ? { fallbackFontFamily: font.fallbackFamily }
      : {}),
    hasEol: item.hasEOL,
  };
}

function normalizePdfFontName(value: string) {
  return value.replace(/^[A-Z]{6}\+/u, "");
}

function resolvePageFonts(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof getDocument>["promise"]>["getPage"]>>,
  fontNames: readonly string[],
) {
  const fonts = new Map<string, PdfFontSnapshot>();
  for (const internalName of fontNames) {
    try {
      const resolved = page.commonObjs.get(internalName) as PdfJsResolvedFont;
      const name = resolved.name?.trim();
      if (!name) {
        continue;
      }
      fonts.set(internalName, {
        internalName,
        name: normalizePdfFontName(name),
        ...(resolved.fallbackName
          ? { fallbackFamily: resolved.fallbackName }
          : {}),
        isType3Font: resolved.isType3Font === true,
        missingFile: resolved.missingFile === true,
      });
    } catch {
      // PDF.js 可能不给未实际绘制的字体建立公共对象；保留文本但不伪造字体。
    }
  }
  return fonts;
}

function resolveLimits(
  input: Partial<PdfSnapshotLimits> | undefined,
): PdfSnapshotLimits {
  const limits = { ...DEFAULT_PDF_SNAPSHOT_LIMITS, ...input };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`PDF 快照限制 ${name} 必须是正数`);
    }
  }
  return limits;
}

export async function createPdfDocumentSnapshot(
  pdfBytes: Uint8Array,
  options: CreatePdfSnapshotOptions,
): Promise<PdfDocumentSnapshot> {
  const limits = resolveLimits(options.limits);
  if (pdfBytes.byteLength === 0) {
    throw new Error("PDF 快照输入不能为空");
  }
  if (pdfBytes.byteLength > limits.maxPdfBytes) {
    throw new Error(
      `PDF 快照输入超过限制：${pdfBytes.byteLength} > ${limits.maxPdfBytes}`,
    );
  }
  const dpi = options.dpi ?? 144;
  if (!Number.isFinite(dpi) || dpi < 72 || dpi > 600) {
    throw new Error("PDF 快照 DPI 必须位于 72 到 600 之间");
  }
  const includeRaster = options.includeRaster ?? true;
  const loadingTask = getDocument({
    data: Uint8Array.from(pdfBytes),
    useSystemFonts: false,
    verbosity: 0,
  });
  let totalPixels = 0;
  try {
    const document = await loadingTask.promise;
    if (document.numPages > limits.maxPages) {
      throw new Error(
        `PDF 页数超过限制：${document.numPages} > ${limits.maxPages}`,
      );
    }
    const pages: PdfPageSnapshot[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const pointViewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent({
        disableNormalization: false,
        includeMarkedContent: false,
      });
      await page.getOperatorList();
      const pageFonts = resolvePageFonts(
        page,
        [
          ...new Set(
            textContent.items.flatMap((item) =>
              isTextItem(item) ? [item.fontName] : [],
            ),
          ),
        ],
      );
      const styles = textContent.styles as Readonly<
        Record<string, PdfJsTextStyle>
      >;
      const items = textContent.items.flatMap((item) => {
        if (!isTextItem(item)) {
          return [];
        }
        const snapshot = createTextItemSnapshot(
          item,
          pointViewport.height,
          styles,
          pageFonts,
        );
        return snapshot ? [snapshot] : [];
      });
      const lines = aggregatePdfTextLines(items, pointViewport.height);
      const pageSnapshot: PdfPageSnapshot = {
        pageNumber,
        widthPt: pointViewport.width,
        heightPt: pointViewport.height,
        rotation: pointViewport.rotation,
        items,
        lines,
        contentText: buildPageContentText(lines),
        fonts: [...pageFonts.values()].sort((left, right) =>
          left.name.localeCompare(right.name, "en"),
        ),
      };
      const pageNumberLine = lines.find((line) => line.role === "page-number");
      if (pageNumberLine) {
        pageSnapshot.pageNumberText = pageNumberLine.normalizedText;
      }

      if (includeRaster) {
        const renderViewport = page.getViewport({ scale: dpi / 72 });
        const widthPx = Math.ceil(renderViewport.width);
        const heightPx = Math.ceil(renderViewport.height);
        const pagePixels = widthPx * heightPx;
        if (pagePixels > limits.maxPagePixels) {
          throw new Error(
            `第 ${pageNumber} 页像素数超过限制：${pagePixels} > ${limits.maxPagePixels}`,
          );
        }
        totalPixels += pagePixels;
        if (totalPixels > limits.maxTotalPixels) {
          throw new Error(
            `PDF 总像素数超过限制：${totalPixels} > ${limits.maxTotalPixels}`,
          );
        }
        const canvas = createCanvas(widthPx, heightPx);
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, widthPx, heightPx);
        await page.render({
          canvas: null,
          canvasContext:
            context as unknown as CanvasRenderingContext2D,
          viewport: renderViewport,
          background: "rgb(255,255,255)",
          intent: "print",
        }).promise;
        const png = canvas.toBuffer("image/png");
        pageSnapshot.raster = {
          widthPx,
          heightPx,
          dpi,
          sha256: sha256(png),
          png: Uint8Array.from(png),
        };
      }
      page.cleanup();
      pages.push(pageSnapshot);
    }
    const contentText = pages
      .map((page) => page.contentText)
      .filter(Boolean)
      .join("\n\f\n");
    const fonts = [
      ...new Map(
        pages
          .flatMap((page) => page.fonts)
          .map((font) => [font.name.toLocaleLowerCase("en-US"), font]),
      ).values(),
    ].sort((left, right) => left.name.localeCompare(right.name, "en"));
    return {
      schemaVersion: 1,
      source: options.source,
      sha256: sha256(pdfBytes),
      pageCount: pages.length,
      contentText,
      fonts,
      pages,
    };
  } finally {
    await loadingTask.destroy();
  }
}
