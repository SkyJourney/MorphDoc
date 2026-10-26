import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { deserialize } from "node:v8";
import { createCanvas } from "@napi-rs/canvas";
import { DOMParser } from "@xmldom/xmldom";
import { unzipSync } from "fflate";

import { defaultExportConfig } from "../packages/core/dist/index.js";
import {
  createPdfVisualDiffReport,
  createWordDocxRoundTripAdapter,
  createWordPdfAdapter,
  createWpsDocxRoundTripAdapter,
  createWpsPdfAdapter,
  renderPdfVisualDiffHtml,
  serializePdfVisualDiffJson
} from "../packages/document-visual-diff/dist/index.js";
import { buildApp } from "../apps/server/dist/app.js";
import { createDocxMediaEngine } from "../apps/server/dist/docx-media-engine.js";
import { createPdfGenerator } from "../apps/server/dist/pdf-engine.js";

const repositoryDirectory = path.resolve(import.meta.dirname, "..");
const fixturePath = path.join(
  repositoryDirectory,
  "packages",
  "docx-engine",
  "fixtures",
  "docx-media-visual.md"
);
const webDirectory = path.join(
  repositoryDirectory,
  "apps",
  "web",
  "dist"
);
const outputDirectory = path.join(
  repositoryDirectory,
  "output",
  "docx-media-gate"
);
const snapshotWorkerPath = path.join(
  repositoryDirectory,
  "scripts",
  "create-pdf-snapshot-artifact.mjs"
);
const rasterDirectory = path.join(outputDirectory, "raster-pages");
const decoder = new TextDecoder();
const WORD_NAMESPACE =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MATH_NAMESPACE =
  "http://schemas.openxmlformats.org/officeDocument/2006/math";
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"]
]);
const markerDefinitions = [
  { id: "normal", label: "普通图片", color: "#7DD3FC" },
  { id: "wide", label: "宽图", color: "#FDBA74" },
  {
    id: "tall",
    label: "高图",
    color: "#86EFAC",
    paginationScaleFlexible: true
  },
  {
    id: "mermaid",
    label: "Mermaid",
    color: "#C4B5FD",
    markerRatioTolerance: 0.08
  },
  { id: "echarts", label: "ECharts", color: "#F9A8D4" }
];
const captionDefinitions = [
  { id: "normal", text: "普通图片:蓝色4:3" },
  { id: "wide", text: "宽图:橙色8:3" },
  { id: "tall", text: "高图:绿色3:8" },
  { id: "echarts", text: "ECharts紫色柱状图" }
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createIsolatedPdfSnapshot(pdfPath, source) {
  const snapshotPath = path.join(
    outputDirectory,
    `.snapshot-${randomUUID()}.bin`
  );
  try {
    execFileSync(
      process.execPath,
      [
        snapshotWorkerPath,
        pdfPath,
        snapshotPath,
        JSON.stringify(source),
        "144",
        JSON.stringify(markerDefinitions)
      ],
      { cwd: repositoryDirectory, stdio: "inherit", timeout: 180_000 }
    );
    return deserialize(fs.readFileSync(snapshotPath));
  } finally {
    fs.rmSync(snapshotPath, { force: true });
  }
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address ? address.port : undefined;
      server.close((error) =>
        error || !port
          ? reject(error ?? new Error("无法分配媒体验收端口"))
          : resolve(port)
      );
    });
  });
}

function resolveWebFile(relativePath) {
  const resolved = path.resolve(webDirectory, relativePath);
  const relative = path.relative(webDirectory, resolved);
  assert(
    relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
    `Web 资源路径越界：${relativePath}`
  );
  return resolved;
}

function registerWebRuntime(app) {
  app.get("/preview-frame.html", async (_request, reply) =>
    reply
      .type("text/html; charset=utf-8")
      .send(fs.readFileSync(resolveWebFile("preview-frame.html")))
  );
  app.get("/assets/*", async (request, reply) => {
    const relativePath = String(request.params["*"] ?? "");
    const filePath = resolveWebFile(path.join("assets", relativePath));
    assert(fs.statSync(filePath).isFile(), `Web 资源无效：${relativePath}`);
    return reply
      .type(
        contentTypes.get(path.extname(filePath).toLowerCase()) ||
          "application/octet-stream"
      )
      .send(fs.readFileSync(filePath));
  });
}

function createMarkerPng(width, height, background, accent, label) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = accent;
  context.lineWidth = Math.max(8, Math.round(Math.min(width, height) / 35));
  context.strokeRect(
    context.lineWidth / 2,
    context.lineWidth / 2,
    width - context.lineWidth,
    height - context.lineWidth
  );
  context.globalAlpha = 0.22;
  context.lineWidth = 2;
  for (let index = 1; index < 8; index += 1) {
    context.beginPath();
    context.moveTo((width * index) / 8, 0);
    context.lineTo((width * index) / 8, height);
    context.stroke();
  }
  for (let index = 1; index < 6; index += 1) {
    context.beginPath();
    context.moveTo(0, (height * index) / 6);
    context.lineTo(width, (height * index) / 6);
    context.stroke();
  }
  context.globalAlpha = 1;
  context.fillStyle = accent;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `bold ${Math.max(28, Math.round(Math.min(width, height) / 7))}px sans-serif`;
  context.fillText(label, width / 2, height / 2);
  return canvas.toBuffer("image/png");
}

function createResources() {
  return [
    {
      path: "media/normal.png",
      contentType: "image/png",
      data: createMarkerPng(
        640,
        480,
        "#7DD3FC",
        "#1D4ED8",
        "NORMAL 4:3"
      ).toString("base64")
    },
    {
      path: "media/wide.png",
      contentType: "image/png",
      data: createMarkerPng(
        1600,
        600,
        "#FDBA74",
        "#C2410C",
        "WIDE 8:3"
      ).toString("base64")
    },
    {
      path: "media/tall.png",
      contentType: "image/png",
      data: createMarkerPng(
        600,
        1600,
        "#86EFAC",
        "#15803D",
        "TALL 3:8"
      ).toString("base64")
    }
  ];
}

async function requestArtifact(origin, route, payload, contentType) {
  const response = await fetch(`${origin}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const content = new Uint8Array(await response.arrayBuffer());
  assert(
    response.ok,
    `${route} 返回 ${response.status}：${decoder.decode(content)}`
  );
  assert(
    response.headers.get("content-type")?.includes(contentType),
    `${route} MIME 无效`
  );
  assert(
    Number(response.headers.get("x-echarts-error-count")) === 0 &&
      Number(response.headers.get("x-mermaid-error-count")) === 0,
    `${route} 图表渲染存在错误`
  );
  return content;
}

function extractEditableContract(docx) {
  const entries = unzipSync(docx);
  const documentXml = entries["word/document.xml"];
  assert(documentXml, "DOCX 缺少 document.xml");
  const document = new DOMParser().parseFromString(
    decoder.decode(documentXml),
    "application/xml"
  );
  const text = Array.from(document.getElementsByTagName("*")).flatMap(
    (node) =>
      node.localName === "t" &&
      (node.namespaceURI === WORD_NAMESPACE ||
        node.namespaceURI === MATH_NAMESPACE)
        ? [node.textContent ?? ""]
        : []
  ).join("");
  const paragraphs = Array.from(document.getElementsByTagName("*"))
    .filter(
      (node) =>
        node.localName === "p" && node.namespaceURI === WORD_NAMESPACE
    )
    .flatMap((paragraph) => {
      const descendants = Array.from(paragraph.getElementsByTagName("*"));
      const paragraphText = descendants.flatMap((node) =>
        node.localName === "t" &&
        (node.namespaceURI === WORD_NAMESPACE ||
          node.namespaceURI === MATH_NAMESPACE)
          ? [node.textContent ?? ""]
          : []
      ).join("");
      if (!paragraphText) {
        return [];
      }
      const style = descendants.find(
        (node) =>
          node.localName === "pStyle" &&
          node.namespaceURI === WORD_NAMESPACE
      );
      const styleId =
        style?.getAttribute("w:val") || style?.getAttribute("val") || undefined;
      return [
        {
          index: 0,
          text: paragraphText,
          ...(styleId ? { styleId } : {}),
          role:
            styleId === "Title" || /Heading/u.test(styleId ?? "")
              ? "heading"
              : /Caption/u.test(styleId ?? "")
                ? "caption"
                : "body",
          section: "body"
        }
      ];
    })
    .map((paragraph, index) => ({ ...paragraph, index }));
  return { text, paragraphs };
}

function readDrawingExtents(documentXml) {
  return [...documentXml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/gu)].map(
    (match) => ({ cx: Number(match[1]), cy: Number(match[2]) })
  );
}

function inspectRoundTripDocx(docx, sourceDocx, label) {
  const entries = unzipSync(docx);
  const sourceEntries = unzipSync(sourceDocx);
  const documentXml = decoder.decode(entries["word/document.xml"]);
  const sourceDocumentXml = decoder.decode(
    sourceEntries["word/document.xml"]
  );
  const relationshipsXml = decoder.decode(
    entries["word/_rels/document.xml.rels"]
  );
  const drawingCount = documentXml.match(/<w:drawing(?:\s|>)/gu)?.length ?? 0;
  const inlineCount = documentXml.match(/<wp:inline(?:\s|>)/gu)?.length ?? 0;
  const anchorCount = documentXml.match(/<wp:anchor(?:\s|>)/gu)?.length ?? 0;
  const pngRelationships = [
    ...relationshipsXml.matchAll(
      /Type="[^"]*\/image"[^>]*Target="([^"]+)"/gu
    )
  ].filter((match) => match[1]?.toLowerCase().endsWith(".png"));
  assert(drawingCount === 5, `${label} Drawing 数量为 ${drawingCount}`);
  assert(inlineCount === 5 && anchorCount === 0, `${label} 出现浮动图片`);
  assert(pngRelationships.length === 5, `${label} 未保留五个 PNG 关系`);
  assert(!documentXml.includes("morphdoc-media:"), `${label} 残留内部标记`);
  assert(!documentXml.includes("<a:srcRect"), `${label} 出现图片裁切`);
  const sourceExtents = readDrawingExtents(sourceDocumentXml);
  const savedExtents = readDrawingExtents(documentXml);
  assert(
    sourceExtents.length === 5 && savedExtents.length === 5,
    `${label} 图片尺寸记录数量无效`
  );
  let maxUntargetedDriftPt = 0;
  for (let index = 0; index < sourceExtents.length; index += 1) {
    const expectedScale = index === 0 ? 0.9 : 1;
    const expectedCx = sourceExtents[index].cx * expectedScale;
    const expectedCy = sourceExtents[index].cy * expectedScale;
    const driftPt = Math.max(
      Math.abs(savedExtents[index].cx - expectedCx) / 12700,
      Math.abs(savedExtents[index].cy - expectedCy) / 12700
    );
    assert(
      driftPt <= 1,
      `${label} 图片 ${index + 1} OOXML 尺寸漂移 ${driftPt.toFixed(3)} pt`
    );
    if (index > 0) {
      maxUntargetedDriftPt = Math.max(maxUntargetedDriftPt, driftPt);
    }
  }
  return {
    drawingCount,
    inlineCount,
    anchorCount,
    pngRelationshipCount: 5,
    maxUntargetedDriftPt
  };
}

function assertRoundTrip(result, label) {
  assert(result.before.length === 5, `${label} 打开时图片数量无效`);
  assert(result.saved.length === 5, `${label} 保存后图片数量无效`);
  const before = result.before[0];
  const saved = result.saved[0];
  assert(before && saved, `${label} 缺少第一张图片尺寸`);
  const widthScale = saved.widthPt / before.widthPt;
  const heightScale = saved.heightPt / before.heightPt;
  assert(
    Math.abs(widthScale - 0.9) <= 0.02 &&
      Math.abs(heightScale - 0.9) <= 0.02,
    `${label} 未按比例保存缩放：${widthScale}/${heightScale}`
  );
  return { widthScale, heightScale };
}

function compareMarkers(baseline, candidate, label, options = {}) {
  return baseline.map((expected) => {
    const actual = candidate.find((entry) => entry.id === expected.id);
    const definition = markerDefinitions.find(
      (entry) => entry.id === expected.id
    );
    assert(actual, `${label} 缺少 ${expected.label}`);
    const widthDelta = Math.abs(actual.widthPt / expected.widthPt - 1);
    const heightDelta = Math.abs(actual.heightPt / expected.heightPt - 1);
    const expectedRatio = expected.widthPt / expected.heightPt;
    const actualRatio = actual.widthPt / actual.heightPt;
    const ratioDelta = Math.abs(actualRatio / expectedRatio - 1);
    const expectedCenterOffset =
      expected.centerXPt - expected.pageWidthPt / 2;
    const actualCenterOffset = actual.centerXPt - actual.pageWidthPt / 2;
    const centerDeltaPt = Math.abs(actualCenterOffset - expectedCenterOffset);
    const physicalSizeRequired =
      options.requirePhysicalSize === true ||
      !definition?.paginationScaleFlexible;
    const sizeTolerance = options.sizeTolerance ?? 0.08;
    if (physicalSizeRequired) {
      assert(
        widthDelta <= sizeTolerance,
        `${label} ${expected.label} 宽度偏差过大：` +
          `${expected.widthPt}/${actual.widthPt} pt, ` +
          `${(widthDelta * 100).toFixed(2)}%`
      );
      assert(
        heightDelta <= sizeTolerance,
        `${label} ${expected.label} 高度偏差过大：` +
          `${expected.heightPt}/${actual.heightPt} pt, ` +
          `${(heightDelta * 100).toFixed(2)}%`
      );
    }
    const ratioTolerance = definition?.markerRatioTolerance ?? 0.04;
    assert(
      ratioDelta <= ratioTolerance,
      `${label} ${expected.label} 比例偏差过大：` +
        `${expectedRatio.toFixed(4)}/${actualRatio.toFixed(4)}, ` +
        `${(ratioDelta * 100).toFixed(2)}%`
    );
    assert(centerDeltaPt <= 8, `${label} ${expected.label} 水平对齐偏差过大`);
    return {
      id: expected.id,
      widthDelta,
      heightDelta,
      ratioDelta,
      centerDeltaPt,
      physicalSizeRequired,
      baselinePage: expected.pageNumber,
      candidatePage: actual.pageNumber
    };
  });
}

function inspectCaptionCenters(snapshot, label) {
  return captionDefinitions.map((definition) => {
    let observation;
    for (const page of snapshot.pages) {
      const line = page.lines.find(
        (entry) => entry.normalizedText.replace(/\s+/gu, "") === definition.text
      );
      if (line) {
        const centerXPt = line.bounds.x + line.bounds.width / 2;
        observation = {
          id: definition.id,
          text: definition.text,
          pageNumber: page.pageNumber,
          centerXPt,
          pageWidthPt: page.widthPt,
          centerDeltaPt: Math.abs(centerXPt - page.widthPt / 2)
        };
        break;
      }
    }
    assert(observation, `${label} 缺少题注：${definition.text}`);
    assert(
      observation.centerDeltaPt <= 8,
      `${label} 题注未居中：${definition.text}，` +
        `${observation.centerDeltaPt.toFixed(2)} pt`
    );
    return observation;
  });
}

function writeReportArtifacts(prefix, report, snapshot) {
  fs.writeFileSync(
    path.join(outputDirectory, `${prefix}-report.json`),
    `${serializePdfVisualDiffJson(report)}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(outputDirectory, `${prefix}-report.html`),
    renderPdfVisualDiffHtml(report),
    "utf8"
  );
  for (const page of snapshot.pages) {
    if (page.raster) {
      fs.writeFileSync(
        path.join(rasterDirectory, `${prefix}-${page.pageNumber}.png`),
        page.raster.png
      );
    }
  }
  for (const page of report.pages) {
    const pageNumber =
      page.pair.baselinePageNumber ?? page.pair.candidatePageNumber;
    if (!pageNumber || !page.artifacts) {
      continue;
    }
    fs.writeFileSync(
      path.join(rasterDirectory, `${prefix}-overlay-${pageNumber}.png`),
      page.artifacts.overlayPng
    );
    fs.writeFileSync(
      path.join(rasterDirectory, `${prefix}-heatmap-${pageNumber}.png`),
      page.artifacts.heatmapPng
    );
  }
}

fs.mkdirSync(outputDirectory, { recursive: true });
fs.mkdirSync(rasterDirectory, { recursive: true });
const markdown = fs.readFileSync(fixturePath, "utf8");
const exportConfig = {
  ...defaultExportConfig,
  name: "DOCX 媒体视觉专项验收",
  themeId: "typora-github",
  pageDecorationsMode: "custom",
  header: { ...defaultExportConfig.header, enabled: false },
  footer: { ...defaultExportConfig.footer, enabled: false },
  paper: {
    ...defaultExportConfig.paper,
    format: "A4",
    orientation: "portrait",
    marginMode: "custom",
    margins: {
      top: "20mm",
      right: "20mm",
      bottom: "20mm",
      left: "20mm"
    }
  }
};
const payload = {
  markdown,
  fileName: "docx-media-visual.md",
  language: "zh-CN",
  resources: createResources(),
  exportConfig
};
const port = await reservePort();
const origin = `http://127.0.0.1:${port}`;
const pdfGenerator = createPdfGenerator({ renderOrigin: origin });
const docxMediaAdapter = createDocxMediaEngine({ renderOrigin: origin });
const app = buildApp({
  logger: { level: "error" },
  pdfGenerator,
  docxMediaAdapter
});
registerWebRuntime(app);

let chromiumPdf;
let docx;
try {
  await app.listen({ port, host: "127.0.0.1" });
  chromiumPdf = await requestArtifact(
    origin,
    "/api/pdf",
    payload,
    "application/pdf"
  );
  docx = await requestArtifact(
    origin,
    "/api/docx",
    payload,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
} finally {
  await app.close();
}

const chromiumPdfPath = path.join(outputDirectory, "chromium.pdf");
const docxPath = path.join(outputDirectory, "source.docx");
fs.writeFileSync(chromiumPdfPath, chromiumPdf);
fs.writeFileSync(docxPath, docx);
const editableContract = extractEditableContract(docx);

const wordAdapter = createWordPdfAdapter({ timeoutMs: 240_000 });
const wpsAdapter = createWpsPdfAdapter({ timeoutMs: 240_000 });
const wordRoundTripAdapter = createWordDocxRoundTripAdapter({
  timeoutMs: 240_000
});
const wpsRoundTripAdapter = createWpsDocxRoundTripAdapter({
  timeoutMs: 240_000
});
const capabilities = {
  word: await wordAdapter.probe(),
  wps: await wpsAdapter.probe(),
  wordRoundTrip: await wordRoundTripAdapter.probe(),
  wpsRoundTrip: await wpsRoundTripAdapter.probe()
};
for (const [name, capability] of Object.entries(capabilities)) {
  assert(capability.available, `${name} 不可用：${capability.detail}`);
}

const wordGeneration = await wordAdapter.generate({ docxPath });
const wpsGeneration = await wpsAdapter.generate({ docxPath });
const wordPdfPath = path.join(outputDirectory, "word.pdf");
const wpsPdfPath = path.join(outputDirectory, "wps.pdf");
fs.writeFileSync(wordPdfPath, wordGeneration.pdf);
fs.writeFileSync(wpsPdfPath, wpsGeneration.pdf);
assert(
  Buffer.from(fs.readFileSync(wordPdfPath)).equals(
    Buffer.from(wordGeneration.pdf)
  ),
  "Word PDF 落盘字节与生成结果不一致"
);
assert(
  Buffer.from(fs.readFileSync(wpsPdfPath)).equals(
    Buffer.from(wpsGeneration.pdf)
  ),
  "WPS PDF 落盘字节与生成结果不一致"
);

const wordRoundTrip = await wordRoundTripAdapter.generate({ docxPath });
const wpsRoundTrip = await wpsRoundTripAdapter.generate({ docxPath });
const wordRoundTripPath = path.join(outputDirectory, "word-round-trip.docx");
const wpsRoundTripPath = path.join(outputDirectory, "wps-round-trip.docx");
fs.writeFileSync(wordRoundTripPath, wordRoundTrip.docx);
fs.writeFileSync(wpsRoundTripPath, wpsRoundTrip.docx);
const roundTripScale = {
  word: assertRoundTrip(wordRoundTrip, "Microsoft Word"),
  wps: assertRoundTrip(wpsRoundTrip, "WPS Writer")
};
const roundTripStructure = {
  word: inspectRoundTripDocx(wordRoundTrip.docx, docx, "Microsoft Word"),
  wps: inspectRoundTripDocx(wpsRoundTrip.docx, docx, "WPS Writer")
};
const wordRoundTripPdf = await wordAdapter.generate({
  docxPath: wordRoundTripPath
});
const wpsRoundTripPdf = await wpsAdapter.generate({
  docxPath: wpsRoundTripPath
});
fs.writeFileSync(
  path.join(outputDirectory, "word-round-trip.pdf"),
  wordRoundTripPdf.pdf
);
fs.writeFileSync(
  path.join(outputDirectory, "wps-round-trip.pdf"),
  wpsRoundTripPdf.pdf
);

const baselineArtifact = createIsolatedPdfSnapshot(chromiumPdfPath, {
  kind: "chromium",
  label: "Chromium 媒体基线"
});
const wordArtifact = createIsolatedPdfSnapshot(wordPdfPath, {
  kind: "word",
  label: "Microsoft Word"
});
const wpsArtifact = createIsolatedPdfSnapshot(wpsPdfPath, {
  kind: "wps",
  label: "WPS Writer"
});
const baseline = baselineArtifact.snapshot;
const wordSnapshot = wordArtifact.snapshot;
const wpsSnapshot = wpsArtifact.snapshot;
const chromiumMarkers = baselineArtifact.markers;
const wordMarkers = wordArtifact.markers;
const wpsMarkers = wpsArtifact.markers;
const captionCenters = {
  chromium: inspectCaptionCenters(baseline, "Chromium"),
  word: inspectCaptionCenters(wordSnapshot, "Microsoft Word"),
  wps: inspectCaptionCenters(wpsSnapshot, "WPS Writer")
};
const reportOptions = {
  expectedEditableText: editableContract.text,
  expectedEditableParagraphs: editableContract.paragraphs
};
const wordReport = await createPdfVisualDiffReport(
  baseline,
  wordSnapshot,
  reportOptions
);
const wpsReport = await createPdfVisualDiffReport(
  baseline,
  wpsSnapshot,
  reportOptions
);
assert(
  wordReport.basic.candidateEditableExact,
  "Word 导出 PDF 的可编辑文本不完整"
);
assert(
  wpsReport.basic.candidateEditableExact,
  "WPS 导出 PDF 的可编辑文本不完整"
);
const markerComparisons = {
  word: compareMarkers(chromiumMarkers, wordMarkers, "Microsoft Word"),
  wps: compareMarkers(chromiumMarkers, wpsMarkers, "WPS Writer"),
  officeParity: compareMarkers(wordMarkers, wpsMarkers, "Word/WPS", {
    requirePhysicalSize: true,
    sizeTolerance: 0.04
  })
};

writeReportArtifacts("chromium", wordReport, baseline);
writeReportArtifacts("word", wordReport, wordSnapshot);
writeReportArtifacts("wps", wpsReport, wpsSnapshot);
const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  fixture: path.relative(repositoryDirectory, fixturePath),
  exportConfig,
  capabilities,
  pages: {
    chromium: baseline.pageCount,
    word: wordSnapshot.pageCount,
    wps: wpsSnapshot.pageCount
  },
  reports: {
    word: {
      status: wordReport.status,
      issueCodes: [...new Set(wordReport.issues.map((issue) => issue.code))],
      editableExact: wordReport.basic.candidateEditableExact
    },
    wps: {
      status: wpsReport.status,
      issueCodes: [...new Set(wpsReport.issues.map((issue) => issue.code))],
      editableExact: wpsReport.basic.candidateEditableExact
    }
  },
  markers: {
    chromium: chromiumMarkers,
    word: wordMarkers,
    wps: wpsMarkers,
    comparisons: markerComparisons
  },
  captionCenters,
  roundTrip: {
    scale: roundTripScale,
    structure: roundTripStructure,
    word: {
      bytes: wordRoundTrip.docx.byteLength,
      before: wordRoundTrip.before,
      saved: wordRoundTrip.saved
    },
    wps: {
      bytes: wpsRoundTrip.docx.byteLength,
      before: wpsRoundTrip.before,
      saved: wpsRoundTrip.saved
    }
  }
};
fs.writeFileSync(
  path.join(outputDirectory, "summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8"
);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
