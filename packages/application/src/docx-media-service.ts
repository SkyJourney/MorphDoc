import {
  MAXIMUM_DOCX_MEDIA_BYTES,
  MAXIMUM_DOCX_MEDIA_EDGE_PIXELS,
  MAXIMUM_DOCX_MEDIA_PIXELS,
  MAXIMUM_DOCX_TOTAL_MEDIA_BYTES,
  createPagedDocumentPayload,
  docxMediaCapturePlanSchema,
  getPaperDimensionsMm,
  lengthToMillimeters,
  millimetersToCssPixels,
  resolvePageMargins,
  type DocxMediaCapturePlan,
  type DocxPngMediaResource,
  type PagedDocumentPayload,
  type PreparedDocxMedia
} from "@morphdoc/core";
import type { PreparedDocxExport } from "./application-service.js";

export interface DocxMediaRenderDimensions {
  contentWidthPx: number;
  contentHeightPx: number;
}

export interface DocxMediaCaptureRequest {
  payload: PagedDocumentPayload;
  dimensions: DocxMediaRenderDimensions;
}

export interface DocxMediaCapture {
  id: string;
  png: Uint8Array;
}

export interface DocxMediaCaptureOutput {
  plan: unknown;
  captures: DocxMediaCapture[];
}

export interface DocxMediaCaptureAdapter {
  capture(
    request: DocxMediaCaptureRequest,
    signal?: AbortSignal
  ): Promise<DocxMediaCaptureOutput>;
}

const pngSignature = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
] as const;

function readPngDimensions(content: Uint8Array) {
  if (
    content.byteLength < 24 ||
    pngSignature.some((value, index) => content[index] !== value) ||
    String.fromCharCode(...content.slice(12, 16)) !== "IHDR"
  ) {
    throw new Error("DOCX 媒体捕获结果不是有效 PNG");
  }
  const view = new DataView(
    content.buffer,
    content.byteOffset,
    content.byteLength
  );
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (
    width < 1 ||
    height < 1 ||
    width > MAXIMUM_DOCX_MEDIA_EDGE_PIXELS ||
    height > MAXIMUM_DOCX_MEDIA_EDGE_PIXELS ||
    width * height > MAXIMUM_DOCX_MEDIA_PIXELS
  ) {
    throw new Error("DOCX PNG 媒体像素尺寸超过限制");
  }
  return { width, height };
}

export function getDocxMediaRenderDimensions(
  prepared: PreparedDocxExport
) {
  const paper = prepared.request.exportConfig.paper;
  const dimensions = getPaperDimensionsMm(
    paper.format,
    paper.orientation
  );
  const margins = resolvePageMargins(
    paper,
    prepared.theme.manifest.pageDefaults?.margins
  );
  const contentWidthMm =
    dimensions.width -
    lengthToMillimeters(margins.left) -
    lengthToMillimeters(margins.right);
  const contentHeightMm =
    dimensions.height -
    lengthToMillimeters(margins.top) -
    lengthToMillimeters(margins.bottom);
  return {
    contentWidthPx: millimetersToCssPixels(contentWidthMm),
    contentHeightPx: millimetersToCssPixels(contentHeightMm)
  };
}

function validateCaptures(
  plan: DocxMediaCapturePlan,
  captures: DocxMediaCapture[]
) {
  const byId = new Map<string, Uint8Array>();
  let totalBytes = 0;
  for (const capture of captures) {
    if (byId.has(capture.id)) {
      throw new Error(`DOCX 媒体 ${capture.id} 重复`);
    }
    if (capture.png.byteLength > MAXIMUM_DOCX_MEDIA_BYTES) {
      throw new Error(`DOCX 媒体 ${capture.id} 超过单文件大小限制`);
    }
    totalBytes += capture.png.byteLength;
    if (totalBytes > MAXIMUM_DOCX_TOTAL_MEDIA_BYTES) {
      throw new Error("DOCX PNG 媒体总大小超过限制");
    }
    byId.set(capture.id, capture.png);
  }
  if (
    byId.size !== plan.targets.length ||
    plan.targets.some((target) => !byId.has(target.id))
  ) {
    throw new Error("DOCX 媒体捕获结果与渲染计划不匹配");
  }

  const resources = plan.targets.map(
    (target): DocxPngMediaResource => {
      const content = byId.get(target.id)!;
      const { width, height } = readPngDimensions(content);
      const expectedWidth = Math.round(
        target.captureWidthPx * target.rasterScale
      );
      const expectedHeight = Math.round(
        target.captureHeightPx * target.rasterScale
      );
      if (
        Math.abs(width - expectedWidth) > 2 ||
        Math.abs(height - expectedHeight) > 2
      ) {
        throw new Error(
          `DOCX 媒体 ${target.id} 的 PNG 尺寸与捕获计划不一致`
        );
      }
      return {
        ...target,
        fileName: `media-${String(target.ordinal).padStart(
          3,
          "0"
        )}.png`,
        contentType: "image/png",
        content,
        pixelWidth: width,
        pixelHeight: height
      };
    }
  );
  return { resources, totalBytes };
}

export async function prepareDocxMedia(
  prepared: PreparedDocxExport,
  adapter: DocxMediaCaptureAdapter,
  signal?: AbortSignal
): Promise<PreparedDocxMedia> {
  signal?.throwIfAborted();
  const dimensions = getDocxMediaRenderDimensions(prepared);
  const output = await adapter.capture(
    {
      payload: createPagedDocumentPayload({
        document: prepared.document,
        fileName: prepared.request.fileName,
        themeCss: prepared.theme.css,
        exportConfig: prepared.request.exportConfig
      }),
      dimensions
    },
    signal
  );
  signal?.throwIfAborted();
  const parsedPlan = docxMediaCapturePlanSchema.safeParse(output.plan);
  if (!parsedPlan.success) {
    throw new Error("DOCX 媒体捕获计划无效");
  }
  const { resources, totalBytes } = validateCaptures(
    parsedPlan.data,
    output.captures
  );
  return {
    resources,
    echartsErrors: parsedPlan.data.echartsErrors,
    mermaidErrors: parsedPlan.data.mermaidErrors,
    warnings: [
      ...prepared.document.warnings,
      ...parsedPlan.data.echartsErrors,
      ...parsedPlan.data.mermaidErrors
    ],
    totalBytes,
    documentLayout: parsedPlan.data.documentLayout ?? { tables: [] }
  };
}
