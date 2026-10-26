import { describe, expect, it } from "vitest";

import {
  calculateContentSimilarity,
  comparePdfSnapshotsBasic,
  createPdfDocumentSnapshot,
  type PdfDocumentSnapshot,
  type PdfTextLineSnapshot,
  type VisualPageSemanticExpectation,
} from "../src/index.js";
import { createMinimalPdf } from "./pdf-fixture.js";

async function snapshot(
  label: string,
  text = "Visual diff fixture",
  width = 595,
  height = 842,
): Promise<PdfDocumentSnapshot> {
  return createPdfDocumentSnapshot(createMinimalPdf(text, width, height), {
    source: { kind: "custom", label },
    includeRaster: false,
  });
}

function textLine(
  text: string,
  y: number,
  role: PdfTextLineSnapshot["role"] = "content",
): PdfTextLineSnapshot {
  return {
    text,
    normalizedText: text,
    bounds: { x: 72, y, width: 200, height: 12 },
    baselineY: y + 10,
    role,
    items: [],
  };
}

function withLines(
  source: PdfDocumentSnapshot,
  lines: PdfTextLineSnapshot[],
): PdfDocumentSnapshot {
  const page = source.pages[0];
  if (!page) {
    throw new Error("测试快照缺少页面");
  }
  return {
    ...source,
    contentText: lines.map((line) => line.normalizedText).join("\n"),
    pages: [{ ...page, lines }],
  };
}

const pageSemantics: VisualPageSemanticExpectation[] = [
  {
    physicalPageNumber: 1,
    kind: "body-first",
    logicalPageNumber: 1,
    logicalPageCount: 1,
    headerVisible: true,
    headerSlots: [{ alignment: "left", text: "页眉左栏" }],
    footerVisible: true,
    footerAlignment: "center",
    pageNumberText: "1 / 1",
  },
];

describe("PDF 基础视觉门禁", () => {
  it("将 PDF 字体映射产生的等价部首字形规范为正文汉字", () => {
    expect(
      calculateContentSimilarity(
        "示例市人⺠政府办公室",
        "示例市人民政府办公室",
      ),
    ).toBe(1);
    expect(calculateContentSimilarity("项目⻔户", "项目门户")).toBe(1);
  });

  it("以 DOCX 可编辑正文为语义基准并容许 Chromium 媒体内部文本", async () => {
    const baseline = withLines(await snapshot("baseline"), [
      textLine("页眉左栏", 10),
      textLine("正文甲", 100),
      textLine("媒体内部标签", 150),
      textLine("正文乙", 200),
      textLine("1 / 1", 820, "page-number"),
    ]);
    const candidate = withLines(await snapshot("candidate"), [
      textLine("页眉左栏", 10),
      textLine("正文甲☒", 100),
      textLine("正文乙", 200),
      textLine("1 / 1", 820, "page-number"),
    ]);
    const result = comparePdfSnapshotsBasic(baseline, candidate, {}, {
      expectedEditableText: "正文甲正文乙",
      pageSemantics,
    });
    expect(result.status).toBe("passed");
    expect(result.baselineEditableCoverage).toBe(1);
    expect(result.candidateEditableSimilarity).toBe(1);
    expect(result.candidateEditableExact).toBe(true);
  });

  it("候选缺少任一可编辑正文字符时严格失败", async () => {
    const baseline = withLines(await snapshot("baseline"), [
      textLine("正文甲正文乙", 100),
    ]);
    const candidate = withLines(await snapshot("candidate"), [
      textLine("正文甲正文", 100),
    ]);
    const result = comparePdfSnapshotsBasic(baseline, candidate, {}, {
      expectedEditableText: "正文甲正文乙",
    });
    expect(result.status).toBe("failed");
    expect(result.baselineEditableCoverage).toBe(1);
    expect(result.candidateEditableExact).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "CONTENT_MISMATCH" }),
      ]),
    );
  });

  it("逐段完整映射时忽略 PDF 页码与表格行聚合造成的串联顺序污染", async () => {
    const baseline = withLines(await snapshot("baseline"), [
      textLine("门禁 内容", 100),
    ]);
    const candidate = withLines(await snapshot("candidate"), [
      textLine("门禁 2 / 2 内容", 100),
    ]);
    const result = comparePdfSnapshotsBasic(baseline, candidate, {}, {
      expectedEditableText: "门禁内容",
      expectedEditableParagraphs: [
        {
          index: 0,
          text: "门禁",
          role: "body",
          blockKind: "table-header",
          section: "body",
        },
        {
          index: 1,
          text: "内容",
          role: "body",
          blockKind: "table-header",
          section: "body",
        },
      ],
    });
    expect(result.candidateEditableExact).toBe(true);
    expect(result.issues.map((issue) => issue.code)).not.toContain(
      "CONTENT_MISMATCH",
    );
  });

  it("通过纸张和正文一致的文档", async () => {
    const baseline = await snapshot("baseline");
    const candidate = await snapshot("candidate");
    const result = comparePdfSnapshotsBasic(baseline, candidate);
    expect(result.status).toBe("passed");
    expect(result.contentSimilarity).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it("拒绝纸张尺寸和正文内容偏差", async () => {
    const baseline = await snapshot("baseline");
    const candidate = await snapshot("candidate", "Different content", 612);
    const result = comparePdfSnapshotsBasic(baseline, candidate);
    expect(result.status).toBe("failed");
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["PAGE_SIZE_MISMATCH", "CONTENT_MISMATCH"]),
    );
  });

  it("内容完整性比较不受重新换行影响", async () => {
    const baseline = await snapshot("baseline", "same content");
    const candidate = await snapshot("candidate", "samecontent");
    const result = comparePdfSnapshotsBasic(baseline, candidate);
    expect(result.contentSimilarity).toBe(1);
    expect(result.status).toBe("passed");
  });

  it("页数不一致时仍保留溢出页配对记录", async () => {
    const baseline = await snapshot("baseline");
    const candidatePage = (await snapshot("candidate")).pages[0];
    if (!candidatePage) {
      throw new Error("测试快照缺少页面");
    }
    const candidate: PdfDocumentSnapshot = {
      ...(await snapshot("candidate")),
      pageCount: 2,
      pages: [
        candidatePage,
        {
          ...candidatePage,
          pageNumber: 2,
          contentText: "",
          items: [],
          lines: [],
        },
      ],
    };
    const result = comparePdfSnapshotsBasic(baseline, candidate);
    expect(result.pagePairs[1]).toEqual({
      candidatePageNumber: 2,
      status: "candidate-only",
    });
    expect(result.issues.map((issue) => issue.code)).toContain(
      "UNPAIRED_CANDIDATE_PAGE",
    );
  });
});
