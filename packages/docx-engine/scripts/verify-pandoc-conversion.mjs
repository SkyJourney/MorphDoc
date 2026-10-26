import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultExportConfig,
  themeManifestSchema
} from "@morphdoc/core";
import {
  PandocDocxConverter,
  PandocRuntime
} from "@morphdoc/docx-engine";
import { DOCX_STYLE_SLOT_NAMES } from "@morphdoc/docx-theme-engine";
import { unzipSync } from "fflate";

const directory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(directory, "..");
const repositoryDirectory = path.resolve(packageDirectory, "../..");
const markdown = fs.readFileSync(
  path.join(packageDirectory, "fixtures", "pandoc-conversion.md"),
  "utf8"
);
const theme = themeManifestSchema.parse(
  JSON.parse(
    fs.readFileSync(
      path.join(
        repositoryDirectory,
        "themes",
        "gov-red-standard",
        "theme.json"
      ),
      "utf8"
    )
  )
);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function resource(kind, ordinal, dimensions, caption) {
  return {
    id: `docx-media-${ordinal}`,
    kind,
    ordinal,
    kindOrdinal: 1,
    altText:
      kind === "image"
        ? "普通图片"
        : kind === "mermaid"
          ? "Mermaid 流程图"
          : "ECharts 柱状图",
    ...(caption ? { caption } : {}),
    alignment: "center",
    displayWidthPx: dimensions.width,
    displayHeightPx: dimensions.height,
    captureX: 0,
    captureY: 0,
    captureWidthPx: dimensions.width,
    captureHeightPx: dimensions.height,
    rasterScale: 1,
    fileName: `media-${ordinal}.png`,
    contentType: "image/png",
    content: png,
    pixelWidth: 1,
    pixelHeight: 1
  };
}

const runtime = new PandocRuntime(
  process.env.DOCX_PANDOC_PATH?.trim()
    ? { configuredPath: process.env.DOCX_PANDOC_PATH.trim() }
    : {}
);
const converter = new PandocDocxConverter({ runtime });
const themeTokens = {
  schemaVersion: 1,
  themeId: theme.id,
  themeFingerprint: "c".repeat(64),
  mode: "auto-with-overrides",
  basePreset: theme.docxStyle?.preset ?? "general",
  slots: DOCX_STYLE_SLOT_NAMES.map((slot) => ({
    slot,
    source: "preset-fallback",
    confidence: "fallback",
    style: { fontCandidates: [] }
  })),
  diagnostics: []
};
const conversionInput = {
  markdown,
  fileName: "Pandoc 媒体转换验收.md",
  language: "zh-CN",
  exportConfig: {
    ...defaultExportConfig,
    themeId: theme.id
  },
  theme,
  themeTokens,
  metadata: {
    title: "Pandoc 媒体转换验收",
    author: "墨呈研发组",
    subject: "",
    keywords: [],
    language: "zh-CN"
  },
  semanticDocument: {
    schemaVersion: 1,
    titlePolicy: {
      metadataTitle: "emit",
      firstBodyHeading: "keep"
    },
    regions: []
  },
  media: {
    resources: [
      resource("image", 1, { width: 384, height: 192 }),
      resource(
        "mermaid",
        2,
        { width: 480, height: 240 },
        "Mermaid 流程图"
      ),
      resource(
        "echarts",
        3,
        { width: 576, height: 288 },
        "ECharts 柱状图"
      )
    ],
    echartsErrors: [],
    mermaidErrors: [],
    warnings: [],
    totalBytes: png.byteLength * 3
  }
};
const result = await converter.convert(conversionInput);

const entries = unzipSync(result.docx);
const documentXml = new TextDecoder().decode(
  entries["word/document.xml"]
);
const mediaParts = Object.keys(entries).filter((name) =>
  /^word\/media\/.+\.png$/u.test(name)
);
const physicalExtents = Array.from(
  documentXml.matchAll(
    /<wp:extent\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/gu
  ),
  (match) => ({
    width: Number(match[1]),
    height: Number(match[2])
  })
);
const checks = {
  editableText: documentXml.includes("标准文本编辑"),
  editableTable: documentXml.includes("<w:tbl"),
  editableCode: documentXml.includes("editable"),
  imageAlt: documentXml.includes("普通图片"),
  mermaidAlt: documentXml.includes("Mermaid 流程图"),
  echartsAlt: documentXml.includes("ECharts 柱状图"),
  threeImageExtents:
    physicalExtents.length === 3,
  physicalDimensions: physicalExtents.every(
    (extent, index) =>
      Math.abs(
        extent.width - [3657600, 4572000, 5486400][index]
      ) <= 360 &&
      Math.abs(
        extent.height - [1828800, 2286000, 2743200][index]
      ) <= 360
  ),
  embeddedPng: mediaParts.length >= 1
};
for (const [name, passed] of Object.entries(checks)) {
  assert(
    passed,
    `真实 DOCX 媒体转换检查失败：${name}，实际尺寸 ${JSON.stringify(physicalExtents)}`
  );
}

let mismatchedMediaRejected = false;
try {
  await converter.convert({
    ...conversionInput,
    media: {
      ...conversionInput.media,
      resources: conversionInput.media.resources.slice(0, 2),
      totalBytes: png.byteLength * 2
    }
  });
} catch (error) {
  mismatchedMediaRejected =
    error?.code === "DOCX_GENERATION_FAILED";
}
assert(
  mismatchedMediaRejected,
  "Lua Filter 未拒绝缺失的 ECharts PNG 映射"
);

console.log(
  JSON.stringify(
    {
      bytes: result.docx.byteLength,
      templateFingerprint: result.templateFingerprint,
      templateCacheKey: result.templateCacheKey,
      validation: result.validation,
      mediaParts,
      physicalExtents,
      mismatchedMediaRejected,
      checks,
      timings: result.timings
    },
    null,
    2
  )
);
