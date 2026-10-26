import { createHash } from "node:crypto";

import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";

import {
  createPdfVisualDiffReport,
  getBlockingVisualDiffIssues,
  isCrossEngineRasterEquivalent,
  renderPdfVisualDiffHtml,
  serializePdfVisualDiffJson,
  type PdfDocumentSnapshot,
  type PdfPageRaster,
  type PdfTextLineSnapshot,
  type VisualPageSemanticExpectation,
} from "../src/index.js";

function raster(color: string): PdfPageRaster {
  const canvas = createCanvas(40, 50);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 40, 50);
  context.fillStyle = color;
  context.fillRect(10, 10, 20, 20);
  const png = Uint8Array.from(canvas.toBuffer("image/png"));
  return {
    widthPx: 40,
    heightPx: 50,
    dpi: 144,
    sha256: createHash("sha256").update(png).digest("hex"),
    png,
  };
}

function flowRaster(color: string): PdfPageRaster {
  const canvas = createCanvas(40, 50);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 40, 50);
  context.fillStyle = color;
  context.fillRect(34, 5, 6, 40);
  const png = Uint8Array.from(canvas.toBuffer("image/png"));
  return {
    widthPx: 40,
    heightPx: 50,
    dpi: 144,
    sha256: createHash("sha256").update(png).digest("hex"),
    png,
  };
}

function blockRaster(color: string): PdfPageRaster {
  const canvas = createCanvas(40, 50);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 40, 50);
  context.fillStyle = color;
  context.fillRect(8, 12, 20, 10);
  const png = Uint8Array.from(canvas.toBuffer("image/png"));
  return {
    widthPx: 40,
    heightPx: 50,
    dpi: 144,
    sha256: createHash("sha256").update(png).digest("hex"),
    png,
  };
}

function antialiasBlockRaster(edgeColor: string): PdfPageRaster {
  const canvas = createCanvas(40, 50);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 40, 50);
  context.fillStyle = edgeColor;
  context.fillRect(8, 12, 20, 10);
  context.fillStyle = "#111111";
  context.fillRect(10, 14, 16, 6);
  const png = Uint8Array.from(canvas.toBuffer("image/png"));
  return {
    widthPx: 40,
    heightPx: 50,
    dpi: 144,
    sha256: createHash("sha256").update(png).digest("hex"),
    png,
  };
}

function adjacentLineRaster(includePreviousLine: boolean): PdfPageRaster {
  const canvas = createCanvas(40, 50);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 40, 50);
  if (includePreviousLine) {
    context.fillStyle = "#111111";
    context.fillRect(8, 12, 20, 3);
  }
  context.fillStyle = "#111111";
  context.fillRect(8, 20, 20, 4);
  const png = Uint8Array.from(canvas.toBuffer("image/png"));
  return {
    widthPx: 40,
    heightPx: 50,
    dpi: 144,
    sha256: createHash("sha256").update(png).digest("hex"),
    png,
  };
}

function snapshot(label: string, pageRaster: PdfPageRaster): PdfDocumentSnapshot {
  return {
    schemaVersion: 1,
    source: { kind: "custom", label },
    sha256: "a".repeat(64),
    pageCount: 1,
    contentText: "相同正文",
    pages: [
      {
        pageNumber: 1,
        widthPt: 20,
        heightPt: 25,
        rotation: 0,
        items: [],
        lines: [],
        contentText: "相同正文",
        raster: pageRaster,
      },
    ],
  };
}

function contentLine(text: string, y: number): PdfTextLineSnapshot {
  return {
    text,
    normalizedText: text,
    bounds: { x: 4, y, width: 8, height: 2 },
    baselineY: y + 2,
    role: "content",
    items: [],
  };
}

function flowSnapshot(
  label: string,
  pageLines: readonly (readonly PdfTextLineSnapshot[])[],
  color: string,
): PdfDocumentSnapshot {
  return {
    schemaVersion: 1,
    source: { kind: "custom", label },
    sha256: label.padEnd(64, "0").slice(0, 64),
    pageCount: pageLines.length,
    contentText: pageLines.flat().map((line) => line.normalizedText).join(""),
    pages: pageLines.map((lines, index) => ({
      pageNumber: index + 1,
      widthPt: 20,
      heightPt: 25,
      rotation: 0,
      items: [],
      lines: [...lines],
      contentText: lines.map((line) => line.normalizedText).join(""),
      raster: flowRaster(color),
    })),
  };
}

function bodySemantics(pageCount: number): VisualPageSemanticExpectation[] {
  return Array.from({ length: pageCount }, (_, index) => ({
    physicalPageNumber: index + 1,
    kind: index === 0 ? "body-first" : "body-rest",
    logicalPageNumber: index + 1,
    logicalPageCount: pageCount,
    headerVisible: false,
    footerVisible: false,
  }));
}

const flowParagraphs = [
  { index: 0, text: "甲", role: "body" as const, section: "body" as const },
  { index: 1, text: "乙丙", role: "body" as const, section: "body" as const },
];

describe("PDF 视觉差异报告", () => {
  it("汇总栅格门禁并生成内嵌图片的安全 HTML", async () => {
    const report = await createPdfVisualDiffReport(
      snapshot("<基线>", raster("#111111")),
      snapshot("候选", raster("#cc0000")),
      { generatedAt: "2026-07-31T00:00:00.000Z" },
    );
    const html = renderPdfVisualDiffHtml(report);
    expect(report.status).toBe("failed");
    expect(html).toContain("&lt;基线&gt;");
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain("差异热力图");
    expect(html).not.toContain("<基线>");
  });

  it("JSON 只保留图片字节数和稳定摘要", async () => {
    const page = raster("#111111");
    const report = await createPdfVisualDiffReport(
      snapshot("基线", page),
      snapshot("候选", page),
    );
    const json = serializePdfVisualDiffJson(report);
    expect(json).toContain('"overlaySha256"');
    expect(json).toContain('"byteLength"');
    expect(json).not.toContain('"0": 137');
  });

  it("在报告中展示未配对的溢出页面", async () => {
    const baseline = snapshot("基线", raster("#111111"));
    const candidatePage = snapshot("候选", raster("#111111"));
    const candidate: PdfDocumentSnapshot = {
      ...candidatePage,
      pageCount: 2,
      pages: [
        candidatePage.pages[0]!,
        {
          ...candidatePage.pages[0]!,
          pageNumber: 2,
        },
      ],
    };
    const report = await createPdfVisualDiffReport(baseline, candidate);
    const overflow = report.pages[1];
    expect(overflow?.pair.status).toBe("candidate-only");
    expect(overflow?.unpairedPng?.byteLength).toBeGreaterThan(0);
    expect(renderPdfVisualDiffHtml(report)).toContain("未配对页面");
  });

  it("纸张物理尺寸容差内不因一像素舍入差重复失败", async () => {
    const baseline = snapshot("基线", raster("#111111"));
    const candidate = snapshot("候选", {
      ...raster("#111111"),
      widthPx: 41,
    });
    candidate.pages[0]!.widthPt = baseline.pages[0]!.widthPt + 0.36;
    const report = await createPdfVisualDiffReport(baseline, candidate, {
      thresholds: {
        maxMeanAbsoluteError: 255,
        maxChangedPixelRatio: 1,
        minInkIou: 0,
        minEdgeIou: 0,
      },
    });
    expect(report.pages[0]?.metrics).toMatchObject({
      dimensionsMatch: false,
      geometryNormalized: true,
      comparedWidthPx: 40,
    });
    expect(report.issues.map((issue) => issue.code)).not.toContain(
      "RASTER_SIZE_MISMATCH",
    );
  });

  it("展示并校验逐页逻辑页码和位置", async () => {
    const baseline = snapshot("Chromium", raster("#111111"));
    const candidate = snapshot("Word", raster("#111111"));
    const pageNumberLine = (x: number) => ({
      text: "— 1 —",
      normalizedText: "— 1 —",
      bounds: { x, y: 22, width: 2, height: 1 },
      baselineY: 23,
      role: "page-number" as const,
      items: [],
    });
    baseline.pages[0]!.lines = [pageNumberLine(17)];
    baseline.pages[0]!.pageNumberText = "— 1 —";
    candidate.pages[0]!.lines = [pageNumberLine(9)];
    candidate.pages[0]!.pageNumberText = "— 1 —";

    const report = await createPdfVisualDiffReport(baseline, candidate, {
      pageSemantics: [
        {
          physicalPageNumber: 1,
          kind: "body-first",
          logicalPageNumber: 1,
          logicalPageCount: 1,
          headerVisible: false,
          footerVisible: true,
          footerAlignment: "right",
          pageNumberText: "— 1 —",
        },
      ],
    });
    const html = renderPdfVisualDiffHtml(report);

    expect(report.status).toBe("failed");
    expect(report.pages[0]?.semantics?.candidate).toMatchObject({
      pageNumberAlignment: "center",
    });
    expect(report.issues.map((issue) => issue.code)).toContain(
      "PAGE_NUMBER_ALIGNMENT_MISMATCH",
    );
    expect(html).toContain("页面语义");
    expect(html).toContain("正文首页");
    expect(html).toContain("逻辑页 1 / 1");
  });

  it("拒绝本应隐藏却仍然出现的页眉", async () => {
    const baseline = snapshot("Chromium", raster("#111111"));
    const candidate = snapshot("Word", raster("#111111"));
    const headerLine = {
      text: "左页眉",
      normalizedText: "左页眉",
      bounds: { x: 2, y: 1, width: 4, height: 1 },
      baselineY: 2,
      role: "content" as const,
      items: [],
    };
    baseline.pages[0]!.lines = [headerLine];
    candidate.pages[0]!.lines = [headerLine];

    const report = await createPdfVisualDiffReport(baseline, candidate, {
      pageSemantics: [
        {
          physicalPageNumber: 1,
          kind: "cover",
          logicalPageCount: 1,
          headerVisible: false,
          headerSlots: [{ alignment: "left", text: "左页眉" }],
          footerVisible: false,
        },
      ],
    });

    expect(report.status).toBe("failed");
    expect(report.issues.map((issue) => issue.code)).toContain(
      "HEADER_VISIBILITY_MISMATCH",
    );
  });

  it("拒绝页眉和页码纵向基线偏差超过 2pt", async () => {
    const baseline = snapshot("Chromium", raster("#111111"));
    const candidate = snapshot("Word", raster("#111111"));
    baseline.pages[0]!.heightPt = 100;
    candidate.pages[0]!.heightPt = 100;
    const lines = (headerY: number, footerY: number) => [
      {
        text: "左页眉",
        normalizedText: "左页眉",
        bounds: { x: 2, y: headerY - 1, width: 4, height: 1 },
        baselineY: headerY,
        role: "content" as const,
        items: [],
      },
      {
        text: "1 / 1",
        normalizedText: "1 / 1",
        bounds: { x: 9, y: footerY - 1, width: 2, height: 1 },
        baselineY: footerY,
        role: "page-number" as const,
        items: [],
      },
    ];
    baseline.pages[0]!.lines = lines(2, 95);
    candidate.pages[0]!.lines = lines(5, 92);

    const report = await createPdfVisualDiffReport(baseline, candidate, {
      pageSemantics: [
        {
          physicalPageNumber: 1,
          kind: "body-first",
          logicalPageNumber: 1,
          logicalPageCount: 1,
          headerVisible: true,
          headerSlots: [{ alignment: "left", text: "左页眉" }],
          footerVisible: true,
          footerAlignment: "center",
          pageNumberText: "1 / 1",
        },
      ],
    });

    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "HEADER_VERTICAL_POSITION_MISMATCH",
        "PAGE_NUMBER_VERTICAL_POSITION_MISMATCH",
      ]),
    );
  });

  it("按文档锚点与页内相对偏移校验页码并容纳 Chromium 自身逐页抖动", async () => {
    const createTwoPageSnapshot = (
      label: string,
      baselines: readonly [number, number],
    ): PdfDocumentSnapshot => {
      const base = snapshot(label, raster("#111111"));
      base.pageCount = 2;
      base.pages = baselines.map((baselineY, index) => ({
        ...base.pages[0]!,
        pageNumber: index + 1,
        heightPt: 100,
        lines: [
          {
            text: `${index + 1} / 2`,
            normalizedText: `${index + 1} / 2`,
            bounds: { x: 9, y: baselineY - 1, width: 2, height: 1 },
            baselineY,
            role: "page-number" as const,
            items: [],
          },
        ],
      }));
      return base;
    };
    const baseline = createTwoPageSnapshot("Chromium", [95, 93.5]);
    const candidate = createTwoPageSnapshot("Word", [95.8, 95.8]);
    const semantics: VisualPageSemanticExpectation[] = [1, 2].map(
      (pageNumber) => ({
        physicalPageNumber: pageNumber,
        kind: pageNumber === 1 ? "body-first" : "body-rest",
        logicalPageNumber: pageNumber,
        logicalPageCount: 2,
        headerVisible: false,
        footerVisible: true,
        footerAlignment: "center",
        pageNumberText: `${pageNumber} / 2`,
      }),
    );

    const report = await createPdfVisualDiffReport(baseline, candidate, {
      pageSemantics: semantics,
    });

    expect(report.issues.map((issue) => issue.code)).not.toContain(
      "PAGE_NUMBER_VERTICAL_POSITION_MISMATCH",
    );
  });

  it("将格式一致的整段跨页栅格差异标记为正文流动警告", async () => {
    const baseline = flowSnapshot(
      "baseline",
      [[contentLine("甲", 8)], [contentLine("乙丙", 8)]],
      "#111111",
    );
    const candidate = flowSnapshot(
      "candidate",
      [[contentLine("甲", 8), contentLine("乙丙", 12)], []],
      "#cc0000",
    );
    const report = await createPdfVisualDiffReport(baseline, candidate, {
      expectedEditableText: "甲乙丙",
      expectedEditableParagraphs: flowParagraphs,
      baselinePageSemantics: bodySemantics(2),
      candidatePageSemantics: bodySemantics(2),
    });

    expect(report.status).toBe("warning");
    expect(report.basic.bodyFlow).toMatchObject({
      detected: true,
      legal: true,
      movedParagraphIndexes: [1],
    });
    expect(report.pages.map((page) => page.rasterComparisonMode)).toEqual([
      "body-flow",
      "body-flow",
    ]);
    expect(report.issues.map((issue) => issue.code)).toContain(
      "BODY_FLOW_RASTER_DIFFERENCE",
    );
    expect(report.issues.map((issue) => issue.code)).not.toContain(
      "INK_IOU_BELOW_THRESHOLD",
    );
  });

  it("允许块内轻微换行警告伴随正文自然跨页", async () => {
    const baseline = flowSnapshot(
      "baseline",
      [
        [contentLine("甲乙丙丁", 8), contentLine("戊己庚辛", 12)],
        [contentLine("壬癸", 8)],
      ],
      "#111111",
    );
    const candidate = flowSnapshot(
      "candidate",
      [
        [
          contentLine("甲乙丙丁戊己", 8),
          contentLine("庚辛", 12),
          contentLine("壬癸", 16),
        ],
        [],
      ],
      "#cc0000",
    );
    const paragraphs = [
      {
        index: 0,
        text: "甲乙丙丁戊己庚辛",
        section: "body",
        blockKind: "paragraph",
      },
      {
        index: 1,
        text: "壬癸",
        section: "body",
        blockKind: "paragraph",
      },
    ] as const;
    const report = await createPdfVisualDiffReport(baseline, candidate, {
      expectedEditableText: "甲乙丙丁戊己庚辛壬癸",
      expectedEditableParagraphs: paragraphs,
      baselinePageSemantics: bodySemantics(2),
      candidatePageSemantics: bodySemantics(2),
    });

    expect(report.basic.paragraphLayouts?.[0]).toMatchObject({
      status: "warning",
    });
    expect(report.basic.bodyFlow).toMatchObject({
      detected: true,
      legal: true,
      movedParagraphIndexes: [1],
    });
    expect(report.pages.map((page) => page.rasterComparisonMode)).toEqual([
      "body-flow",
      "body-flow",
    ]);
  });

  it("整段跨页同时发生换行变化时由语义块门禁失败", async () => {
    const baseline = flowSnapshot(
      "baseline",
      [[contentLine("甲", 8)], [contentLine("乙丙", 8)]],
      "#111111",
    );
    const candidate = flowSnapshot(
      "candidate",
      [
        [contentLine("甲", 8), contentLine("乙", 12), contentLine("丙", 16)],
        [],
      ],
      "#cc0000",
    );
    const report = await createPdfVisualDiffReport(baseline, candidate, {
      expectedEditableText: "甲乙丙",
      expectedEditableParagraphs: flowParagraphs,
      baselinePageSemantics: bodySemantics(2),
      candidatePageSemantics: bodySemantics(2),
    });

    expect(report.status).toBe("failed");
    expect(report.basic.bodyFlow).toMatchObject({ detected: true, legal: false });
    expect(report.pages.every(
      (page) => page.rasterComparisonMode === "body-block",
    )).toBe(true);
    expect(report.issues.map((issue) => issue.code)).toContain(
      "TEXT_BLOCK_LINE_COUNT_MISMATCH",
    );
  });

  it("允许格式一致的正文自然分页产生物理页数差异", async () => {
    const baseline = flowSnapshot(
      "baseline",
      [[contentLine("甲", 8)], [contentLine("乙丙", 8)]],
      "#111111",
    );
    const candidate = flowSnapshot(
      "candidate",
      [[contentLine("甲", 8), contentLine("乙丙", 12)]],
      "#cc0000",
    );
    const report = await createPdfVisualDiffReport(baseline, candidate, {
      expectedEditableText: "甲乙丙",
      expectedEditableParagraphs: flowParagraphs,
      baselinePageSemantics: bodySemantics(2),
      candidatePageSemantics: bodySemantics(1),
    });

    expect(report.status).toBe("warning");
    expect(report.basic.bodyFlow).toMatchObject({
      legal: true,
      baselineBodyPageCount: 2,
      candidateBodyPageCount: 1,
    });
    expect(report.issues.map((issue) => issue.code)).toContain(
      "BODY_FLOW_PAGE_COUNT_DIFFERENCE",
    );
    expect(report.pages[1]).toMatchObject({
      rasterComparisonMode: "body-flow",
      status: "warning",
    });
  });

  it("正文页数不同时分别验证未配对页面自身的页码语义", async () => {
    const pageNumber = (text: string): PdfTextLineSnapshot => ({
      text,
      normalizedText: text,
      bounds: { x: 9, y: 22, width: 2, height: 1 },
      baselineY: 23,
      role: "page-number",
      items: [],
    });
    const baseline = flowSnapshot(
      "baseline",
      [
        [contentLine("甲", 8), pageNumber("1 / 2")],
        [contentLine("乙丙", 8), pageNumber("2 / 2")],
      ],
      "#111111",
    );
    const candidate = flowSnapshot(
      "candidate",
      [[
        contentLine("甲", 8),
        contentLine("乙丙", 12),
        pageNumber("1 / 1"),
      ]],
      "#cc0000",
    );
    const pageSemantics = (count: number) => bodySemantics(count).map(
      (item, index) => ({
        ...item,
        footerVisible: true,
        footerAlignment: "center" as const,
        pageNumberText: `${index + 1} / ${count}`,
      }),
    );
    const report = await createPdfVisualDiffReport(baseline, candidate, {
      expectedEditableText: "甲乙丙",
      expectedEditableParagraphs: flowParagraphs,
      baselinePageSemantics: pageSemantics(2),
      candidatePageSemantics: pageSemantics(1),
    });

    expect(report.status).toBe("warning");
    expect(report.basic.bodyFlow).toMatchObject({
      legal: true,
      baselineBodyPageCount: 2,
      candidateBodyPageCount: 1,
    });
    expect(report.issues.map((issue) => issue.code)).toContain(
      "BODY_FLOW_PAGE_COUNT_DIFFERENCE",
    );
  });

  it("新增正文页缺少预期页码时不得认定为合法分页流动", async () => {
    const pageNumber = (text: string): PdfTextLineSnapshot => ({
      text,
      normalizedText: text,
      bounds: { x: 9, y: 22, width: 2, height: 1 },
      baselineY: 23,
      role: "page-number",
      items: [],
    });
    const baseline = flowSnapshot(
      "baseline",
      [[contentLine("甲", 8), contentLine("乙丙", 12), pageNumber("1 / 1")]],
      "#111111",
    );
    const candidate = flowSnapshot(
      "candidate",
      [
        [contentLine("甲", 8), pageNumber("1 / 2")],
        [contentLine("乙丙", 8)],
      ],
      "#cc0000",
    );
    const baselineSemantics = bodySemantics(1).map((item) => ({
      ...item,
      footerVisible: true,
      footerAlignment: "center" as const,
      pageNumberText: "1 / 1",
    }));
    const candidateSemantics = bodySemantics(2).map((item, index) => ({
      ...item,
      footerVisible: true,
      footerAlignment: "center" as const,
      pageNumberText: `${index + 1} / 2`,
    }));
    const report = await createPdfVisualDiffReport(baseline, candidate, {
      expectedEditableText: "甲乙丙",
      expectedEditableParagraphs: flowParagraphs,
      baselinePageSemantics: baselineSemantics,
      candidatePageSemantics: candidateSemantics,
    });

    expect(report.status).toBe("failed");
    expect(report.basic.bodyFlow).toMatchObject({ detected: true, legal: false });
    expect(report.issues.map((issue) => issue.code)).toContain(
      "PAGE_NUMBER_VISIBILITY_MISMATCH",
    );
  });

  it("正文整页差异只作诊断，但语义块局部视觉变化必须失败", async () => {
    const baseline = flowSnapshot(
      "baseline",
      [[contentLine("甲", 8)]],
      "#111111",
    );
    const candidate = flowSnapshot(
      "candidate",
      [[contentLine("甲", 8)]],
      "#111111",
    );
    baseline.pages[0]!.raster = blockRaster("#111111");
    candidate.pages[0]!.raster = blockRaster("#cc0000");
    const report = await createPdfVisualDiffReport(baseline, candidate, {
      expectedEditableText: "甲",
      expectedEditableParagraphs: [flowParagraphs[0]!],
      pageSemantics: bodySemantics(1),
    });

    expect(report.status).toBe("failed");
    expect(report.pages[0]?.rasterComparisonMode).toBe("body-block");
    expect(report.issues.map((issue) => issue.code)).toContain(
      "BODY_PAGE_RASTER_DIFFERENCE",
    );
    expect(report.issues.map((issue) => issue.code)).toContain(
      "SEMANTIC_BLOCK_RASTER_MISMATCH",
    );
  });

  it("正文文字字形与前景色一致时忽略跨引擎抗锯齿灰度噪声", async () => {
    const baseline = flowSnapshot(
      "baseline",
      [[contentLine("甲", 8)]],
      "#111111",
    );
    const candidate = flowSnapshot(
      "candidate",
      [[contentLine("甲", 8)]],
      "#111111",
    );
    baseline.pages[0]!.raster = antialiasBlockRaster("#999999");
    candidate.pages[0]!.raster = antialiasBlockRaster("#aaaaaa");
    const report = await createPdfVisualDiffReport(baseline, candidate, {
      expectedEditableText: "甲",
      expectedEditableParagraphs: [flowParagraphs[0]!],
      pageSemantics: bodySemantics(1),
    });

    expect(report.issues.map((issue) => issue.code)).not.toContain(
      "SEMANTIC_BLOCK_RASTER_MISMATCH",
    );
    expect(report.basic.semanticBlockVisuals[0]?.lines[0]?.metrics)
      .toMatchObject({ inkIou: 1, edgeIou: 1 });
  });

  it("局部视觉裁剪不得把目标行上方的相邻行墨迹纳入比较", async () => {
    const targetLine = contentLine("乙", 10);
    targetLine.bounds = { x: 4, y: 10, width: 10, height: 2 };
    const baseline = flowSnapshot(
      "baseline",
      [[targetLine]],
      "#111111",
    );
    const candidate = flowSnapshot(
      "candidate",
      [[targetLine]],
      "#111111",
    );
    baseline.pages[0]!.raster = adjacentLineRaster(true);
    candidate.pages[0]!.raster = adjacentLineRaster(false);
    const report = await createPdfVisualDiffReport(baseline, candidate, {
      expectedEditableText: "乙",
      expectedEditableParagraphs: [{
        index: 0,
        text: "乙",
        role: "body",
        section: "body",
        blockKind: "table-cell",
      }],
      pageSemantics: bodySemantics(1),
    });

    expect(report.issues.map((issue) => issue.code)).not.toContain(
      "SEMANTIC_BLOCK_RASTER_MISMATCH",
    );
  });

  it("仅对带行内代码结构语义的混排允许 WPS 底纹栅格混合差异", () => {
    const metrics = {
      baselineWidthPx: 236,
      baselineHeightPx: 24,
      candidateWidthPx: 233,
      candidateHeightPx: 26,
      comparedWidthPx: 236,
      comparedHeightPx: 26,
      dimensionsMatch: false,
      geometryNormalized: true,
      spatialTolerancePx: 4,
      meanAbsoluteError: 22.1,
      changedPixelRatio: 0.449,
      inkIou: 0.908,
      edgeIou: 1,
      backgroundColorDelta: 11.38,
      foregroundColorDelta: 2.6,
    };

    expect(isCrossEngineRasterEquivalent(
      metrics,
      false,
      "paragraph",
      true,
    )).toBe(true);
    expect(isCrossEngineRasterEquivalent(
      metrics,
      false,
      "paragraph",
      false,
    )).toBe(false);
  });

  it("缺少语义块证据时不得把正文整页栅格自动降级", async () => {
    const report = await createPdfVisualDiffReport(
      snapshot("baseline", raster("#111111")),
      snapshot("candidate", raster("#cc0000")),
      { pageSemantics: bodySemantics(1) },
    );

    expect(report.status).toBe("failed");
    expect(report.pages[0]?.rasterComparisonMode).toBe("strict");
    expect(report.issues.map((issue) => issue.code)).toContain(
      "CHANGED_PIXEL_RATIO_EXCEEDED",
    );
  });

  it("所有 failure 级视觉问题都必须进入发布阻断集合", () => {
    const failure = {
      code: "INK_IOU_BELOW_THRESHOLD" as const,
      severity: "failure" as const,
      message: "墨迹 IoU 未达到门限",
    };
    const warning = {
      code: "BODY_FLOW_RASTER_DIFFERENCE" as const,
      severity: "warning" as const,
      message: "正文自然分页差异",
    };

    expect(getBlockingVisualDiffIssues({ issues: [failure, warning] })).toEqual([
      failure,
    ]);
  });

  it("正文自然分页 warning 不阻断发布", () => {
    expect(
      getBlockingVisualDiffIssues({
        issues: [
          {
            code: "BODY_FLOW_RASTER_DIFFERENCE",
            severity: "warning",
            message: "正文自然分页差异",
          },
        ],
      }),
    ).toEqual([]);
  });
});
