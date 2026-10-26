import {
  DOCX_MEDIA_CSS_DPI,
  MAXIMUM_DOCX_MEDIA_BYTES,
  MAXIMUM_DOCX_MEDIA_EDGE_PIXELS,
  MAXIMUM_DOCX_MEDIA_COUNT,
  MAXIMUM_DOCX_MEDIA_PIXELS,
  MAXIMUM_DOCX_TOTAL_MEDIA_BYTES,
  type DocxMediaKind,
  type DocxDocumentLayoutPlan,
  type PreparedDocxMedia
} from "@morphdoc/core";

export interface PandocMediaMapItem {
  id: string;
  binding: string;
  path: string;
  alt_text: string;
  caption?: string;
  width: string;
  height: string;
}

export interface PandocMediaLayoutItem {
  id: string;
  binding: string;
  kind: DocxMediaKind;
  ordinal: number;
  altText: string;
  alignment: PreparedDocxMedia["resources"][number]["alignment"];
  displayWidthPx: number;
  displayHeightPx: number;
  widthEmu: number;
  heightEmu: number;
}

export interface PandocMediaMap {
  image: PandocMediaMapItem[];
  mermaid: PandocMediaMapItem[];
  echarts: PandocMediaMapItem[];
}

export interface PandocMediaFile {
  relativePath: string;
  content: Uint8Array;
}

export interface PreparedPandocMedia {
  map: PandocMediaMap;
  files: PandocMediaFile[];
  layout: PandocMediaLayoutItem[];
  documentLayout: DocxDocumentLayoutPlan;
}

export const DOCX_MEDIA_BINDING_PREFIX = "morphdoc-media:";
const EMUS_PER_CSS_PIXEL = 9_525;

function pixelsToMillimeters(value: number) {
  return (value * 25.4) / DOCX_MEDIA_CSS_DPI;
}

function physicalLength(value: number) {
  if (!Number.isFinite(value) || value <= 0 || value > 10_000) {
    throw new Error("DOCX 媒体显示尺寸无效");
  }
  return `${pixelsToMillimeters(value).toFixed(3)}mm`;
}

function assertPng(content: Uint8Array) {
  const signature = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
  ];
  if (
    content.byteLength < 24 ||
    signature.some((value, index) => content[index] !== value) ||
    String.fromCharCode(...content.slice(12, 16)) !== "IHDR"
  ) {
    throw new Error("DOCX 媒体不是有效 PNG");
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

export function preparePandocMedia(
  media: PreparedDocxMedia
): PreparedPandocMedia {
  if (media.echartsErrors.length || media.mermaidErrors.length) {
    throw new Error("DOCX 图表渲染存在错误，已中止转换");
  }
  if (media.resources.length > MAXIMUM_DOCX_MEDIA_COUNT) {
    throw new Error("DOCX 媒体数量超过限制");
  }

  const map: PandocMediaMap = {
    image: [],
    mermaid: [],
    echarts: []
  };
  const files: PandocMediaFile[] = [];
  const layout: PandocMediaLayoutItem[] = [];
  const ids = new Set<string>();
  let totalBytes = 0;
  const kindCounts: Record<DocxMediaKind, number> = {
    image: 0,
    mermaid: 0,
    echarts: 0
  };
  for (const [index, resource] of media.resources.entries()) {
    if (ids.has(resource.id)) {
      throw new Error(`DOCX 媒体 ID 重复：${resource.id}`);
    }
    ids.add(resource.id);
    kindCounts[resource.kind] += 1;
    if (
      resource.ordinal !== index + 1 ||
      resource.kindOrdinal !== kindCounts[resource.kind]
    ) {
      throw new Error("DOCX 媒体顺序与捕获计划不一致");
    }
    if (resource.content.byteLength > MAXIMUM_DOCX_MEDIA_BYTES) {
      throw new Error(`DOCX 媒体 ${resource.id} 超过单文件大小限制`);
    }
    totalBytes += resource.content.byteLength;
    if (totalBytes > MAXIMUM_DOCX_TOTAL_MEDIA_BYTES) {
      throw new Error("DOCX PNG 媒体总大小超过限制");
    }
    const dimensions = assertPng(resource.content);
    if (
      dimensions.width !== resource.pixelWidth ||
      dimensions.height !== resource.pixelHeight
    ) {
      throw new Error(
        `DOCX 媒体 ${resource.id} 的 PNG 像素声明不一致`
      );
    }
    const relativePath = `media/media-${String(
      resource.ordinal
    ).padStart(3, "0")}.png`;
    const binding = `${DOCX_MEDIA_BINDING_PREFIX}${resource.id}`;
    map[resource.kind].push({
      id: resource.id,
      binding,
      path: relativePath,
      alt_text: resource.altText || `${resource.kind} 图片`,
      ...(resource.caption
        ? { caption: resource.caption }
        : {}),
      width: physicalLength(resource.displayWidthPx),
      height: physicalLength(resource.displayHeightPx)
    });
    layout.push({
      id: resource.id,
      binding,
      kind: resource.kind,
      ordinal: resource.ordinal,
      altText: resource.altText || `${resource.kind} 图片`,
      alignment: resource.alignment,
      displayWidthPx: resource.displayWidthPx,
      displayHeightPx: resource.displayHeightPx,
      widthEmu: Math.round(
        resource.displayWidthPx * EMUS_PER_CSS_PIXEL
      ),
      heightEmu: Math.round(
        resource.displayHeightPx * EMUS_PER_CSS_PIXEL
      )
    });
    files.push({
      relativePath,
      content: resource.content
    });
  }
  if (media.totalBytes !== totalBytes) {
    throw new Error("DOCX 媒体总大小声明不一致");
  }
  return {
    map,
    files,
    layout,
    documentLayout: media.documentLayout ?? { tables: [] }
  };
}
