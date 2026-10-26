import { describe, expect, it } from "vitest";

import {
  comparePdfEditableParagraphLayouts,
  type EditableParagraphExpectation,
  type PdfDocumentSnapshot,
  type PdfTextLineSnapshot,
} from "../src/index.js";

function line(
  text: string,
  y: number,
  width = 120,
  x = 72,
): PdfTextLineSnapshot {
  return {
    text,
    normalizedText: text,
    bounds: { x, y: y - 10, width, height: 12 },
    baselineY: y,
    role: "content",
    items: [],
  };
}

function itemLine(
  text: string,
  y: number,
  width = 120,
  x = 72,
): PdfTextLineSnapshot {
  const result = line(text, y, width, x);
  result.items = [{
    text,
    normalizedText: text,
    bounds: { ...result.bounds },
    baselineY: y,
    hasEol: true,
  }];
  return result;
}

function snapshot(
  label: string,
  pages: PdfTextLineSnapshot[][],
): PdfDocumentSnapshot {
  return {
    schemaVersion: 1,
    source: { kind: "custom", label },
    sha256: label.padEnd(64, "0").slice(0, 64),
    pageCount: pages.length,
    contentText: pages.flat().map((item) => item.normalizedText).join(""),
    pages: pages.map((lines, index) => ({
      pageNumber: index + 1,
      widthPt: 595,
      heightPt: 842,
      rotation: 0,
      items: [],
      lines,
      contentText: lines.map((item) => item.normalizedText).join(""),
    })),
  };
}

function expectation(
  text: string,
  overrides: Partial<EditableParagraphExpectation> = {},
): EditableParagraphExpectation {
  return {
    index: 0,
    text,
    role: "body",
    section: "body",
    ...overrides,
  };
}

describe("PDF 内容感知段落版式门禁", () => {
  it("只在 OMML 数学字符位置容忍 WPS 文本层字母占位符", () => {
    const expected = "减因子e−λΔt的动态权重";
    const baseline = snapshot("baseline", [[line(expected, 100)]]);
    const candidate = snapshot(
      "candidate",
      [[line("减因子A−AΔA的动态权重", 100)]],
    );
    const result = comparePdfEditableParagraphLayouts(
      baseline,
      candidate,
      [expectation(expected, {
        mathCharacterIndexes: [3, 4, 5, 6, 7],
      })],
    )[0];

    expect(result?.baseline.matched).toBe(true);
    expect(result?.candidate.matched).toBe(true);
  });

  it("数学公式被 PDF 文本层提前抽取时仍能映射公式后的正文", () => {
    const expected = "衰减因子e−λΔt的动态权重调整";
    const baseline = snapshot("baseline", [[
      line("−λΔt", 96),
      line("衰减因子e", 100),
      line("的动态权重调整", 116),
    ]]);
    const candidate = snapshot("candidate", [[
      line("−λΔt", 96),
      line("衰减因子e", 100),
      line("的动态权重调整", 116),
    ]]);
    const result = comparePdfEditableParagraphLayouts(
      baseline,
      candidate,
      [expectation(expected, {
        mathCharacterIndexes: [4, 5, 6, 7, 8],
      })],
    )[0];

    expect(result?.baseline.matched).toBe(true);
    expect(result?.candidate.matched).toBe(true);
    expect(result?.baseline.matchedCharacterCount).toBe(
      Array.from(expected).length,
    );
  });

  it("表格硬换行跨视觉行时允许相邻单元格文本交错", () => {
    const visualLines = [
      line("标签第一行旁甲", 200),
      line("第二行旁乙", 220),
      line("第三行", 240),
      line("下一行", 260),
    ];
    const paragraphs = [
      expectation("标签", { index: 0, blockKind: "table-cell" }),
      expectation("第一行第二行第三行", {
        index: 1,
        blockKind: "table-cell",
        hardBreakSegments: ["第一行", "第二行", "第三行"],
      }),
      expectation("旁甲旁乙", {
        index: 2,
        blockKind: "table-cell",
        hardBreakSegments: ["旁甲", "旁乙"],
      }),
      expectation("下一行", { index: 3, blockKind: "table-cell" }),
    ];
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [visualLines]),
      snapshot("candidate", [visualLines]),
      paragraphs,
    );

    expect(results.every((result) => result.baseline.matched)).toBe(true);
    expect(results.every((result) => result.candidate.matched)).toBe(true);
    expect(results.every((result) => result.status === "passed")).toBe(true);
    expect(results[1]?.baseline.lineTexts).toEqual([
      "第一行",
      "第二行",
      "第三行",
    ]);
  });

  it("多行表格按单元格语义匹配而不依赖 PDF 的视觉行顺序", () => {
    const visualLines = [
      line("甲列丙列", 200),
      line("乙列丁列", 220),
      line("表格后正文", 260),
    ];
    const paragraphs = [
      expectation("甲列乙列", { index: 0, blockKind: "table-cell" }),
      expectation("丙列丁列", { index: 1, blockKind: "table-cell" }),
      expectation("表格后正文", { index: 2 }),
    ];
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [visualLines]),
      snapshot("candidate", [visualLines]),
      paragraphs,
    );

    expect(results.every((result) => result.baseline.matched)).toBe(true);
    expect(results.every((result) => result.candidate.matched)).toBe(true);
  });

  it("同一表格中的重复短文本只消费各自的字符范围", () => {
    const visualLines = [
      line("表名一DIM已实现", 200),
      line("表名二DIM已实现", 220),
      line("表格后正文", 260),
    ];
    const table = { blockKind: "table-cell" as const, tableGroupId: "table-0" };
    const paragraphs = [
      expectation("表名一", { index: 0, ...table }),
      expectation("DIM", { index: 1, ...table }),
      expectation("已实现", { index: 2, ...table }),
      expectation("表名二", { index: 3, ...table }),
      expectation("DIM", { index: 4, ...table }),
      expectation("已实现", { index: 5, ...table }),
      expectation("表格后正文", { index: 6 }),
    ];
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [visualLines]),
      snapshot("candidate", [visualLines]),
      paragraphs,
    );

    expect(results.every((result) => result.baseline.matched)).toBe(true);
    expect(results[1]?.baseline.firstLineBaselineYPt).toBe(200);
    expect(results[4]?.baseline.firstLineBaselineYPt).toBe(220);
    expect(results[6]?.baseline.firstLineBaselineYPt).toBe(260);
  });

  it("带稳定行列坐标的表格不会把重复短文本匹配到后续章节", () => {
    const tableLine = (
      cells: readonly string[],
      y: number,
      xPositions: readonly number[],
    ) => {
      const result = line(cells.join(""), y, 640, xPositions[0]);
      result.items = cells.map((text, index) => ({
        text,
        normalizedText: text,
        bounds: {
          x: xPositions[index]!,
          y: y - 10,
          width: Math.max(12, Array.from(text).length * 12),
          height: 12,
        },
        baselineY: y,
        hasEol: index === cells.length - 1,
      }));
      return result;
    };
    const columns = [72, 150, 420, 500];
    const visualLines = [
      line("按模块统计", 160),
      tableLine(["章节", "模块", "DIM", "合计"], 200, columns),
      tableLine(["一", "维度层", "13", "13"], 220, columns),
      tableLine(["二", "溯源总览", "0", "4"], 240, columns),
      line("后续章节包含DIM以及数字0和4", 600),
    ];
    const table = {
      blockKind: "table-cell" as const,
      tableGroupId: "table-0",
    };
    const paragraphs = [
      expectation("按模块统计", { index: 0, blockKind: "heading" }),
      ...[
        ["章节", 0, 0], ["模块", 0, 1], ["DIM", 0, 2], ["合计", 0, 3],
        ["一", 1, 0], ["维度层", 1, 1], ["13", 1, 2], ["13", 1, 3],
        ["二", 2, 0], ["溯源总览", 2, 1], ["0", 2, 2], ["4", 2, 3],
      ].map(([text, row, column], index) =>
        expectation(text as string, {
          index: index + 1,
          ...table,
          tableRowIndex: row as number,
          tableColumnIndex: column as number,
        })
      ),
      expectation("后续章节包含DIM以及数字0和4", {
        index: 13,
        blockKind: "paragraph",
      }),
    ];
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [visualLines]),
      snapshot("candidate", [visualLines]),
      paragraphs,
    );

    expect(results.every((result) => result.baseline.matched)).toBe(true);
    expect(results.slice(1, 13).map((result) =>
      result.baseline.firstLineBaselineYPt
    )).toEqual([
      200, 200, 200, 200,
      220, 220, 220, 220,
      240, 240, 240, 240,
    ]);
    expect(results[13]?.baseline.firstLineBaselineYPt).toBe(600);
  });

  it("前一表长单元格不完整时不会污染后一表的稳定行列定位", () => {
    const visualLines = [
      line("第一表标题", 100),
      line("层级说明", 140),
      line("ODS短说明", 160),
      line("第二表标题", 220),
      line("章节模块", 260),
      line("一溯源总览", 280),
      line("文档后部再次出现章节模块一溯源总览", 700),
    ];
    const paragraphs = [
      expectation("第一表标题", { index: 0, blockKind: "heading" }),
      expectation("层级", {
        index: 1,
        blockKind: "table-header",
        tableGroupId: "table-0",
        tableRowIndex: 0,
        tableColumnIndex: 0,
      }),
      expectation("说明", {
        index: 2,
        blockKind: "table-header",
        tableGroupId: "table-0",
        tableRowIndex: 0,
        tableColumnIndex: 1,
      }),
      expectation("ODS", {
        index: 3,
        blockKind: "table-cell",
        tableGroupId: "table-0",
        tableRowIndex: 1,
        tableColumnIndex: 0,
      }),
      expectation("这是一段在PDF中被截断的长说明", {
        index: 4,
        blockKind: "table-cell",
        tableGroupId: "table-0",
        tableRowIndex: 1,
        tableColumnIndex: 1,
      }),
      expectation("第二表标题", { index: 5, blockKind: "heading" }),
      expectation("章节", {
        index: 6,
        blockKind: "table-header",
        tableGroupId: "table-1",
        tableRowIndex: 0,
        tableColumnIndex: 0,
      }),
      expectation("模块", {
        index: 7,
        blockKind: "table-header",
        tableGroupId: "table-1",
        tableRowIndex: 0,
        tableColumnIndex: 1,
      }),
      expectation("一", {
        index: 8,
        blockKind: "table-cell",
        tableGroupId: "table-1",
        tableRowIndex: 1,
        tableColumnIndex: 0,
      }),
      expectation("溯源总览", {
        index: 9,
        blockKind: "table-cell",
        tableGroupId: "table-1",
        tableRowIndex: 1,
        tableColumnIndex: 1,
      }),
    ];
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [visualLines]),
      snapshot("candidate", [visualLines]),
      paragraphs,
    );

    expect(results[4]?.baseline.matched).toBe(false);
    expect(results[5]?.baseline.firstLineBaselineYPt).toBe(220);
    expect(results.slice(6).map((result) =>
      result.baseline.firstLineBaselineYPt
    )).toEqual([260, 260, 280, 280]);
  });

  it("表格结束后同名标题不会复用已消费的单元格文本", () => {
    const visualLines = [
      line("食安监控状态正常", 200),
      line("食安监控", 260),
    ];
    const paragraphs = [
      expectation("食安监控", {
        index: 0,
        blockKind: "table-cell",
        tableGroupId: "table-0",
      }),
      expectation("状态正常", {
        index: 1,
        blockKind: "table-cell",
        tableGroupId: "table-0",
      }),
      expectation("食安监控", { index: 2, blockKind: "heading" }),
    ];
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [visualLines]),
      snapshot("candidate", [visualLines]),
      paragraphs,
    );

    expect(results.every((result) => result.baseline.matched)).toBe(true);
    expect(results[0]?.baseline.firstLineBaselineYPt).toBe(200);
    expect(results[2]?.baseline.firstLineBaselineYPt).toBe(260);
  });

  it("同一物理行中的表格单元格分别保留自己的视觉边界", () => {
    const tableLine = line("建设内容 主要能力", 220, 320, 72);
    tableLine.items = [
      {
        text: "建设内容",
        normalizedText: "建设内容",
        bounds: { x: 72, y: 210, width: 48, height: 12 },
        baselineY: 220,
        fontFamily: "Test Serif",
        hasEol: false,
      },
      {
        text: "主要能力",
        normalizedText: "主要能力",
        bounds: { x: 240, y: 210, width: 48, height: 12 },
        baselineY: 220,
        fontFamily: "Test Serif",
        hasEol: true,
      },
    ];
    const paragraphs = [
      expectation("建设内容", { index: 0, blockKind: "table-header" }),
      expectation("主要能力", { index: 1, blockKind: "table-header" }),
    ];
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[tableLine]]),
      snapshot("candidate", [[tableLine]]),
      paragraphs,
    );

    expect(results[0]?.baseline.visualLines[0]?.bounds).toEqual(
      tableLine.items[0]?.bounds,
    );
    expect(results[1]?.baseline.visualLines[0]?.bounds).toEqual(
      tableLine.items[1]?.bounds,
    );
  });

  it("表格换行匹配优先保留目标单元格的最长连续前缀", () => {
    const firstLine = line(
      "B超报告原文描述 B超报告中是否有对应病灶 若B超无相关描述",
      220,
      480,
      72,
    );
    firstLine.items = [
      {
        text: "B超报告原文描述",
        normalizedText: "B超报告原文描述",
        bounds: { x: 120, y: 210, width: 96, height: 12 },
        baselineY: 220,
        hasEol: false,
      },
      {
        text: "B超报告中是否有对应病灶",
        normalizedText: "B超报告中是否有对应病灶",
        bounds: { x: 280, y: 210, width: 144, height: 12 },
        baselineY: 220,
        hasEol: false,
      },
      {
        text: "若B超无相关描述",
        normalizedText: "若B超无相关描述",
        bounds: { x: 450, y: 210, width: 96, height: 12 },
        baselineY: 220,
        hasEol: true,
      },
    ];
    const secondLine = line("描述", 238, 24, 120);
    secondLine.items = [{
      text: "描述",
      normalizedText: "描述",
      bounds: { x: 120, y: 228, width: 24, height: 12 },
      baselineY: 238,
      hasEol: true,
    }];
    const thirdLine = line("描述", 256, 24, 280);
    thirdLine.items = [{
      text: "描述",
      normalizedText: "描述",
      bounds: { x: 280, y: 246, width: 24, height: 12 },
      baselineY: 256,
      hasEol: true,
    }];
    const [result] = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[firstLine, secondLine, thirdLine]]),
      snapshot("candidate", [[firstLine, secondLine, thirdLine]]),
      [expectation("B超报告中是否有对应病灶描述", {
        blockKind: "table-cell",
      })],
    );

    expect(result?.baseline.visualLines.map((entry) => entry.bounds.x)).toEqual([
      280,
      280,
    ]);
    expect(result?.baseline.visualLines[0]?.bounds.width).toBe(144);
  });

  it("表格多列共享换行后缀时按首行列位置选择续行", () => {
    const firstLine = line(
      "高血压预测模型目 冠心病预测模型目",
      220,
      360,
      72,
    );
    firstLine.items = [
      {
        text: "高血压预测模型目",
        normalizedText: "高血压预测模型目",
        bounds: { x: 180, y: 210, width: 96, height: 12 },
        baselineY: 220,
        hasEol: false,
      },
      {
        text: "冠心病预测模型目",
        normalizedText: "冠心病预测模型目",
        bounds: { x: 300, y: 210, width: 96, height: 12 },
        baselineY: 220,
        hasEol: true,
      },
    ];
    const secondLine = line("标值 标值", 238, 144, 180);
    secondLine.items = [
      {
        text: "标值",
        normalizedText: "标值",
        bounds: { x: 180, y: 228, width: 24, height: 12 },
        baselineY: 238,
        hasEol: false,
      },
      {
        text: "标值",
        normalizedText: "标值",
        bounds: { x: 300, y: 228, width: 24, height: 12 },
        baselineY: 238,
        hasEol: true,
      },
    ];
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[firstLine, secondLine]]),
      snapshot("candidate", [[firstLine, secondLine]]),
      [
        expectation("高血压预测模型目标值", {
          index: 0,
          blockKind: "table-header",
        }),
        expectation("冠心病预测模型目标值", {
          index: 1,
          blockKind: "table-header",
        }),
      ],
    );

    expect(results[0]?.baseline.visualLines[1]?.bounds.x).toBe(180);
    expect(results[1]?.baseline.visualLines[1]?.bounds.x).toBe(300);
  });

  it("表格长首行与短续行使用左边界保持在同一单元格", () => {
    const firstLine = line("dim_snd_algo_st", 220, 160, 120);
    firstLine.items = [{
      text: "dim_snd_algo_st",
      normalizedText: "dim_snd_algo_st",
      bounds: { x: 120, y: 210, width: 160, height: 12 },
      baselineY: 220,
      hasEol: true,
    }];
    const continuationLine = line("andard andard", 238, 140, 120);
    continuationLine.items = [
      {
        text: "andard",
        normalizedText: "andard",
        bounds: { x: 120, y: 228, width: 60, height: 12 },
        baselineY: 238,
        hasEol: false,
      },
      {
        text: "andard",
        normalizedText: "andard",
        bounds: { x: 200, y: 228, width: 60, height: 12 },
        baselineY: 238,
        hasEol: true,
      },
    ];
    const [result] = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[firstLine, continuationLine]]),
      snapshot("candidate", [[firstLine, continuationLine]]),
      [expectation("dim_snd_algo_standard", { blockKind: "table-cell" })],
    );

    expect(result?.baseline.lineTexts).toEqual(["dim_snd_algo_st", "andard"]);
    expect(result?.baseline.visualLines[1]?.bounds.x).toBe(120);
  });

  it("同一物理行中被宽间隙拆开的单元格文本仍在目标列内续接", () => {
    const header = line("维度说明 目标列", 200, 240, 100);
    header.items = [
      {
        text: "维度说明",
        normalizedText: "维度说明",
        bounds: { x: 100, y: 190, width: 48, height: 12 },
        baselineY: 200,
        hasEol: false,
      },
      {
        text: "目标列",
        normalizedText: "目标列",
        bounds: { x: 260, y: 190, width: 36, height: 12 },
        baselineY: 200,
        hasEol: true,
      },
    ];
    const value = line("DIM 维度层 DIM 邻列", 220, 260, 100);
    value.items = [
      {
        text: "DIM",
        normalizedText: "DIM",
        bounds: { x: 100, y: 210, width: 24, height: 12 },
        baselineY: 220,
        hasEol: false,
      },
      {
        text: "维度层",
        normalizedText: "维度层",
        bounds: { x: 136, y: 210, width: 36, height: 12 },
        baselineY: 220,
        hasEol: false,
      },
      {
        text: "DIM",
        normalizedText: "DIM",
        bounds: { x: 260, y: 210, width: 24, height: 12 },
        baselineY: 220,
        hasEol: false,
      },
      {
        text: "邻列",
        normalizedText: "邻列",
        bounds: { x: 296, y: 210, width: 24, height: 12 },
        baselineY: 220,
        hasEol: true,
      },
    ];
    const table = { tableGroupId: "table-split-items" };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[header, value]]),
      snapshot("candidate", [[header, value]]),
      [
        expectation("维度说明", {
          index: 0,
          blockKind: "table-header",
          ...table,
          tableRowIndex: 0,
          tableColumnIndex: 0,
        }),
        expectation("目标列", {
          index: 1,
          blockKind: "table-header",
          ...table,
          tableRowIndex: 0,
          tableColumnIndex: 1,
        }),
        expectation("DIM维度层", {
          index: 2,
          blockKind: "table-cell",
          ...table,
          tableRowIndex: 1,
          tableColumnIndex: 0,
        }),
        expectation("DIM邻列", {
          index: 3,
          blockKind: "table-cell",
          ...table,
          tableRowIndex: 1,
          tableColumnIndex: 1,
        }),
      ],
    );

    expect(results.map((result) => result.baseline.matched)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(results[2]?.baseline.visualLines[0]?.bounds.x).toBe(100);
    expect(results[2]?.baseline.visualLines[0]?.bounds.width).toBe(72);
    expect(results[3]?.baseline.visualLines[0]?.bounds.x).toBe(260);
  });

  it("相邻列共享前缀时先按列锚点匹配而不是跨列选择更长文本", () => {
    const makeLine = (
      entries: readonly { text: string; x: number; width: number }[],
      baselineY: number,
    ) => {
      const value = line(
        entries.map((entry) => entry.text).join(" "),
        baselineY,
        360,
        120,
      );
      value.items = entries.map((entry, index) => ({
        text: entry.text,
        normalizedText: entry.text,
        bounds: {
          x: entry.x,
          y: baselineY - 10,
          width: entry.width,
          height: 12,
        },
        baselineY,
        hasEol: index === entries.length - 1,
      }));
      return value;
    };
    const lines = [
      makeLine([
        { text: "资产名", x: 190, width: 36 },
        { text: "设计目标", x: 300, width: 48 },
      ], 200),
      makeLine([
        { text: "算法标准", x: 180, width: 48 },
        { text: "算法标准统一维度", x: 300, width: 96 },
      ], 220),
      makeLine([{ text: "统一维度表", x: 180, width: 60 }], 238),
    ];
    const table = { tableGroupId: "table-shared-prefix" };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [lines]),
      snapshot("candidate", [lines]),
      [
        expectation("资产名", {
          index: 0,
          blockKind: "table-header",
          ...table,
          tableRowIndex: 0,
          tableColumnIndex: 0,
        }),
        expectation("设计目标", {
          index: 1,
          blockKind: "table-header",
          ...table,
          tableRowIndex: 0,
          tableColumnIndex: 1,
        }),
        expectation("算法标准统一维度表", {
          index: 2,
          blockKind: "table-cell",
          ...table,
          tableRowIndex: 1,
          tableColumnIndex: 0,
        }),
        expectation("算法标准统一维度", {
          index: 3,
          blockKind: "table-cell",
          ...table,
          tableRowIndex: 1,
          tableColumnIndex: 1,
        }),
      ],
    );

    expect(results[2]?.baseline.matched).toBe(true);
    expect(results[2]?.baseline.visualLines.map((entry) => entry.bounds.x)).toEqual([
      180,
      180,
    ]);
    expect(results[3]?.baseline.visualLines[0]?.bounds.x).toBe(300);
  });

  it("首列表头与相邻列共享更长前缀时按最左列开始匹配", () => {
    const first = line("meal meal_", 200, 140, 80);
    first.items = [
      {
        text: "meal",
        normalizedText: "meal",
        bounds: { x: 80, y: 190, width: 32, height: 12 },
        baselineY: 200,
        hasEol: false,
      },
      {
        text: "meal_",
        normalizedText: "meal_",
        bounds: { x: 160, y: 190, width: 40, height: 12 },
        baselineY: 200,
        hasEol: true,
      },
    ];
    const second = line("_typ name", 218, 120, 80);
    second.items = [
      {
        text: "_typ",
        normalizedText: "_typ",
        bounds: { x: 80, y: 208, width: 32, height: 12 },
        baselineY: 218,
        hasEol: false,
      },
      {
        text: "name",
        normalizedText: "name",
        bounds: { x: 160, y: 208, width: 32, height: 12 },
        baselineY: 218,
        hasEol: true,
      },
    ];
    const third = line("e _cn", 236, 80, 80);
    third.items = [
      {
        text: "e",
        normalizedText: "e",
        bounds: { x: 80, y: 226, width: 8, height: 12 },
        baselineY: 236,
        hasEol: false,
      },
      {
        text: "_cn",
        normalizedText: "_cn",
        bounds: { x: 160, y: 226, width: 24, height: 12 },
        baselineY: 236,
        hasEol: true,
      },
    ];
    const table = { tableGroupId: "table-header-prefix", tableRowIndex: 0 };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[first, second, third]]),
      snapshot("candidate", [[first, second, third]]),
      [
        expectation("meal_type", {
          index: 0,
          blockKind: "table-header",
          ...table,
          tableColumnIndex: 0,
        }),
        expectation("meal_name_cn", {
          index: 1,
          blockKind: "table-header",
          ...table,
          tableColumnIndex: 1,
        }),
      ],
    );

    expect(results.map((result) => result.baseline.matched)).toEqual([
      true,
      true,
    ]);
    expect(results[0]?.baseline.visualLines[0]?.bounds.x).toBe(80);
  });

  it("右对齐表头续行按文本中心保持在同一列", () => {
    const first = line("未实现(设计", 200, 80, 400);
    first.items = [{
      text: "未实现(设计",
      normalizedText: "未实现(设计",
      bounds: { x: 400, y: 190, width: 80, height: 12 },
      baselineY: 200,
      hasEol: true,
    }];
    const second = line("态)", 218, 20, 450);
    second.items = [{
      text: "态)",
      normalizedText: "态)",
      bounds: { x: 450, y: 208, width: 20, height: 12 },
      baselineY: 218,
      hasEol: true,
    }];
    const [result] = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[first, second]]),
      snapshot("candidate", [[first, second]]),
      [expectation("未实现(设计态)", {
        blockKind: "table-header",
        tableGroupId: "table-right-header",
        tableRowIndex: 0,
        tableColumnIndex: 0,
      })],
    );

    expect(result?.baseline.matched).toBe(true);
    expect(result?.baseline.lineTexts).toEqual(["未实现(设计", "态)"]);
  });

  it("纵向表头续字优先选择后续视觉行中更靠近本列中心的字符", () => {
    const first = line("DW D", 100, 48, 100);
    first.items = [
      {
        text: "DW",
        normalizedText: "DW",
        bounds: { x: 100, y: 90, width: 20, height: 12 },
        baselineY: 100,
        hasEol: false,
      },
      {
        text: "D",
        normalizedText: "D",
        bounds: { x: 134, y: 90, width: 10, height: 12 },
        baselineY: 100,
        hasEol: true,
      },
    ];
    const interleaved = line("邻列", 109, 20, 150);
    const continuation = line("D", 118, 10, 104);
    const [result] = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[first, interleaved, continuation]]),
      snapshot("candidate", [[first, interleaved, continuation]]),
      [expectation("DWD", {
        blockKind: "table-header",
        tableGroupId: "table-vertical-header",
        tableRowIndex: 0,
        tableColumnIndex: 0,
      })],
    );

    expect(result?.baseline.matched).toBe(true);
    expect(result?.baseline.lineTexts).toEqual(["DW", "D"]);
    expect(result?.baseline.visualLines[1]?.bounds.x).toBe(104);
  });

  it("跨页重复表头与续行同列时优先选择更长的连续匹配", () => {
    const firstLine = line("邻甲", 780, 24, 440);
    firstLine.items = [{
      text: "邻甲",
      normalizedText: "邻甲",
      bounds: { x: 440, y: 770, width: 24, height: 12 },
      baselineY: 780,
      hasEol: true,
    }];
    const repeatedHeader = line("邻接单元格", 54, 60, 440);
    repeatedHeader.items = [{
      text: "邻接单元格",
      normalizedText: "邻接单元格",
      bounds: { x: 440, y: 44, width: 60, height: 12 },
      baselineY: 54,
      hasEol: true,
    }];
    const continuation = line("邻乙", 86, 24, 440);
    continuation.items = [{
      text: "邻乙",
      normalizedText: "邻乙",
      bounds: { x: 440, y: 76, width: 24, height: 12 },
      baselineY: 86,
      hasEol: true,
    }];
    const [result] = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[firstLine], [repeatedHeader, continuation]]),
      snapshot("candidate", [[firstLine], [repeatedHeader, continuation]]),
      [expectation("邻甲邻乙", {
        blockKind: "table-cell",
        hardBreakSegments: ["邻甲", "邻乙"],
      })],
    );

    expect(result?.baseline.lineTexts).toEqual(["邻甲", "邻乙"]);
    expect(result?.baseline.visualLines).toHaveLength(2);
    expect(result?.baseline.visualLines[1]?.bounds).toEqual(
      continuation.items[0]?.bounds,
    );
  });

  it("稳定行列坐标下跨页硬换行避开重复表头的同首字前缀", () => {
    const header = line("门禁 内容 邻接单元格", 740, 420, 80);
    header.items = [
      { text: "门禁", normalizedText: "门禁", bounds: { x: 80, y: 730, width: 24, height: 12 }, baselineY: 740, hasEol: false },
      { text: "内容", normalizedText: "内容", bounds: { x: 240, y: 730, width: 24, height: 12 }, baselineY: 740, hasEol: false },
      { text: "邻接单元格", normalizedText: "邻接单元格", bounds: { x: 440, y: 730, width: 60, height: 12 }, baselineY: 740, hasEol: true },
    ];
    const row = line("行内代码 正文 邻甲", 780, 420, 80);
    row.items = [
      { text: "行内代码", normalizedText: "行内代码", bounds: { x: 80, y: 770, width: 48, height: 12 }, baselineY: 780, hasEol: false },
      { text: "正文", normalizedText: "正文", bounds: { x: 240, y: 770, width: 24, height: 12 }, baselineY: 780, hasEol: false },
      { text: "邻甲", normalizedText: "邻甲", bounds: { x: 440, y: 770, width: 24, height: 12 }, baselineY: 780, hasEol: true },
    ];
    const repeatedHeader = line("门禁 内容 邻接单元格", 54, 420, 80);
    repeatedHeader.items = [
      { text: "门禁", normalizedText: "门禁", bounds: { x: 80, y: 44, width: 24, height: 12 }, baselineY: 54, hasEol: false },
      { text: "内容", normalizedText: "内容", bounds: { x: 240, y: 44, width: 24, height: 12 }, baselineY: 54, hasEol: false },
      { text: "邻接单元格", normalizedText: "邻接单元格", bounds: { x: 440, y: 44, width: 60, height: 12 }, baselineY: 54, fontFamily: "EmbeddedSerif,Bold", hasEol: true },
    ];
    const continuation = line("续行 其他 邻乙", 87, 420, 80);
    continuation.items = [
      { text: "续行", normalizedText: "续行", bounds: { x: 80, y: 77, width: 24, height: 12 }, baselineY: 87, hasEol: false },
      { text: "其他", normalizedText: "其他", bounds: { x: 240, y: 77, width: 24, height: 12 }, baselineY: 87, hasEol: false },
      { text: "邻乙", normalizedText: "邻乙", bounds: { x: 440, y: 77, width: 24, height: 12 }, baselineY: 87, hasEol: true },
    ];
    const group = { tableGroupId: "table-stable-cross-page-hard-break" };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[header, row], [repeatedHeader, continuation]]),
      snapshot("candidate", [[header, row], [repeatedHeader, continuation]]),
      [
        expectation("门禁", { index: 0, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 0 }),
        expectation("内容", { index: 1, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 1 }),
        expectation("邻接单元格", { index: 2, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 2 }),
        expectation("行内代码", { index: 3, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 0 }),
        expectation("正文", { index: 4, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 1 }),
        expectation("邻甲邻乙", {
          index: 5,
          blockKind: "table-cell",
          ...group,
          tableRowIndex: 1,
          tableColumnIndex: 2,
          hardBreakSegments: ["邻甲", "邻乙"],
        }),
      ],
    );

    expect(results[5]?.baseline.matched).toBe(true);
    expect(results[5]?.candidate.matched).toBe(true);
    expect(results[5]?.baseline.lineTexts).toEqual(["邻甲", "邻乙"]);
    expect(results[5]?.candidate.lineTexts).toEqual(["邻甲", "邻乙"]);
    expect(results[5]?.candidate.visualLines[1]?.fontFamilies).not.toContain(
      "EmbeddedSerif,Bold",
    );
  });

  it("跨页重复表头与正文续行等长时选择更精确的原列坐标", () => {
    const firstLine = line("已实", 780, 22, 506);
    firstLine.items = [{
      text: "已实",
      normalizedText: "已实",
      bounds: { x: 506, y: 770, width: 22, height: 12 },
      baselineY: 780,
      hasEol: true,
    }];
    const repeatedHeader = line("实现", 54, 22, 508);
    repeatedHeader.items = [{
      text: "实现",
      normalizedText: "实现",
      bounds: { x: 508, y: 44, width: 22, height: 12 },
      baselineY: 54,
      fontFamily: "EmbeddedSerif,Bold",
      hasEol: true,
    }];
    const continuation = line("现", 86, 11, 506);
    continuation.items = [{
      text: "现",
      normalizedText: "现",
      bounds: { x: 506, y: 76, width: 11, height: 12 },
      baselineY: 86,
      fontFamily: "EmbeddedSerif",
      hasEol: true,
    }];
    const [result] = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[firstLine], [repeatedHeader, continuation]]),
      snapshot("candidate", [[firstLine], [repeatedHeader, continuation]]),
      [expectation("已实现", { blockKind: "table-cell" })],
    );

    expect(result?.baseline.matched).toBe(true);
    expect(result?.baseline.lineTexts).toEqual(["已实", "现"]);
    expect(result?.baseline.visualLines[1]?.bounds).toEqual(
      continuation.items[0]?.bounds,
    );
    expect(result?.baseline.visualLines[1]?.fontFamilies).toEqual([
      "EmbeddedSerif",
    ]);
  });

  it("跨页表格后续列复用前列建立的正文续行基线而避开重复表头", () => {
    const firstPage = line("终端 已实", 780, 180, 80);
    firstPage.items = [
      { text: "终端", normalizedText: "终端", bounds: { x: 80, y: 770, width: 24, height: 12 }, baselineY: 780, hasEol: false },
      { text: "已实", normalizedText: "已实", bounds: { x: 220, y: 770, width: 24, height: 12 }, baselineY: 780, hasEol: true },
    ];
    const repeatedHeader = line("表名 实现状态", 54, 190, 80);
    repeatedHeader.items = [
      { text: "表名", normalizedText: "表名", bounds: { x: 80, y: 44, width: 24, height: 12 }, baselineY: 54, hasEol: false },
      { text: "实现状态", normalizedText: "实现状态", bounds: { x: 222, y: 44, width: 48, height: 12 }, baselineY: 54, fontFamily: "EmbeddedSerif,Bold", hasEol: true },
    ];
    const continuation = line("设备维表 现", 104, 180, 80);
    continuation.items = [
      { text: "设备维表", normalizedText: "设备维表", bounds: { x: 80, y: 94, width: 48, height: 12 }, baselineY: 104, hasEol: false },
      { text: "现", normalizedText: "现", bounds: { x: 220, y: 94, width: 12, height: 12 }, baselineY: 104, fontFamily: "EmbeddedSerif", hasEol: true },
    ];
    const group = { tableGroupId: "table-cross-page-row-anchor", tableRowIndex: 1 };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[firstPage], [repeatedHeader, continuation]]),
      snapshot("candidate", [[firstPage], [repeatedHeader, continuation]]),
      [
        expectation("终端设备维表", { index: 0, blockKind: "table-cell", ...group, tableColumnIndex: 0 }),
        expectation("已实现", { index: 1, blockKind: "table-cell", ...group, tableColumnIndex: 1 }),
      ],
    );

    expect(results.map((result) => result.baseline.matched)).toEqual([true, true]);
    expect(results[1]?.baseline.lineTexts).toEqual(["已实", "现"]);
    expect(results[1]?.baseline.visualLines[1]?.bounds).toEqual(
      continuation.items[1]?.bounds,
    );
    expect(results[1]?.baseline.visualLines[1]?.fontFamilies).toEqual([
      "EmbeddedSerif",
    ]);
  });

  it("表格行跨页时后续列只从行锚点所在物理页开始匹配", () => {
    const previousPageValue = line("计算", 780, 24, 180);
    const rowLabel = line("DWS", 100, 30, 80);
    const currentPageValue = line("计算", 100, 24, 180);
    const table = {
      tableGroupId: "table-cross-page-row",
      tableRowIndex: 4,
    };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[previousPageValue], [rowLabel, currentPageValue]]),
      snapshot("candidate", [[previousPageValue], [rowLabel, currentPageValue]]),
      [
        expectation("DWS", {
          index: 0,
          blockKind: "table-cell",
          ...table,
          tableColumnIndex: 0,
        }),
        expectation("计算", {
          index: 1,
          blockKind: "table-cell",
          ...table,
          tableColumnIndex: 1,
        }),
      ],
    );

    expect(results[1]?.baseline.matched).toBe(true);
    expect(results[1]?.baseline.visualLines[0]?.pageNumber).toBe(2);
  });

  it("表格首列在当前行已命中有效前缀时不会被稍后更长同名正文抢占", () => {
    const header = line("层级", 740, 20, 80);
    header.items = [{
      text: "层级",
      normalizedText: "层级",
      bounds: { x: 80, y: 730, width: 20, height: 12 },
      baselineY: 740,
      hasEol: true,
    }];
    const firstPart = line("DW", 760, 20, 80);
    const interleaved = line("计算", 780, 24, 180);
    const secondPart = line("S", 800, 10, 80);
    const laterParagraph = line("DWS 后续正文", 820, 120, 80);
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[header, firstPart, interleaved, secondPart, laterParagraph]]),
      snapshot("candidate", [[header, firstPart, interleaved, secondPart, laterParagraph]]),
      [
        expectation("层级", {
          index: 0,
          blockKind: "table-header",
          tableGroupId: "table-current-page-prefix",
          tableRowIndex: 0,
          tableColumnIndex: 0,
        }),
        expectation("DWS", {
          index: 1,
          blockKind: "table-cell",
          tableGroupId: "table-current-page-prefix",
          tableRowIndex: 1,
          tableColumnIndex: 0,
        }),
      ],
    );
    const result = results[1];

    expect(result?.baseline.matched).toBe(true);
    expect(result?.baseline.visualLines.map((entry) => entry.pageNumber)).toEqual([1, 1]);
    expect(result?.baseline.lineTexts).toEqual(["DW", "S"]);
  });

  it("左对齐数据列可落在居中表头中心边界左侧但不得越过上一列右边界", () => {
    const makeLine = (
      entries: readonly { text: string; x: number; width: number }[],
      baselineY: number,
    ) => {
      const value = line(entries.map((entry) => entry.text).join(" "), baselineY, 340, 40);
      value.items = entries.map((entry, index) => ({
        text: entry.text,
        normalizedText: entry.text,
        bounds: { x: entry.x, y: baselineY - 10, width: entry.width, height: 12 },
        baselineY,
        hasEol: index === entries.length - 1,
      }));
      return value;
    };
    const header = makeLine([
      { text: "章节", x: 46, width: 24 },
      { text: "模块", x: 192, width: 24 },
      { text: "DIM", x: 339, width: 26 },
    ], 100);
    const body = makeLine([
      { text: "一", x: 45, width: 12 },
      { text: "DIM 维度层", x: 84, width: 64 },
      { text: "13", x: 353, width: 12 },
    ], 130);
    const group = { tableGroupId: "table-centered-header-left-data" };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[header, body]]),
      snapshot("candidate", [[header, body]]),
      [
        expectation("章节", { index: 0, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 0 }),
        expectation("模块", { index: 1, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 1 }),
        expectation("DIM", { index: 2, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 2 }),
        expectation("一", { index: 3, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 0 }),
        expectation("DIM 维度层", { index: 4, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 1 }),
        expectation("13", { index: 5, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 2 }),
      ],
    );

    expect(results.map((result) => result.baseline.matched)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(results[4]?.baseline.visualLines[0]?.bounds.x).toBe(84);
  });

  it("同一表格行的后续列可在行锚点所在物理页的较晚视觉行开始", () => {
    const visualLines = [
      line("字段名", 100, 24, 80),
      line("其他列一", 120, 36, 110),
      line("其他列二", 140, 36, 130),
      line("较晚列值", 160, 48, 220),
    ];
    const group = { tableGroupId: "table-late-column-start", tableRowIndex: 0 };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [visualLines]),
      snapshot("candidate", [visualLines]),
      [
        expectation("字段名", {
          index: 0,
          blockKind: "table-header",
          ...group,
          tableColumnIndex: 0,
        }),
        expectation("较晚列值", {
          index: 1,
          blockKind: "table-header",
          ...group,
          tableColumnIndex: 1,
        }),
      ],
    );

    expect(results[1]?.baseline.matched).toBe(true);
    expect(results[1]?.candidate.matched).toBe(true);
    expect(results[1]?.baseline.visualLines[0]?.pageNumber).toBe(1);
  });

  it("极窄右对齐表头允许末尾短行相对长前缀发生中心偏移", () => {
    const visualLines = [
      line("字段", 100, 24, 80),
      line("typical_start_ho", 120, 100, 180),
      line("ur", 140, 14, 266),
    ];
    const group = { tableGroupId: "table-narrow-header", tableRowIndex: 0 };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [visualLines]),
      snapshot("candidate", [visualLines]),
      [
        expectation("字段", {
          index: 0,
          blockKind: "table-header",
          ...group,
          tableColumnIndex: 0,
        }),
        expectation("typical_start_hour", {
          index: 1,
          blockKind: "table-header",
          ...group,
          tableColumnIndex: 1,
        }),
      ],
    );

    expect(results[1]?.baseline.matched).toBe(true);
    expect(results[1]?.candidate.matched).toBe(true);
    expect(results[1]?.baseline.lineTexts).toEqual(["typical_start_ho", "ur"]);
  });

  it("表格同一单元格的分散对齐字符可跨较大字间距完整匹配", () => {
    const header = line("字段 设计目标 状态", 100, 440, 80);
    header.items = [
      { text: "字段", normalizedText: "字段", bounds: { x: 80, y: 90, width: 24, height: 12 }, baselineY: 100, hasEol: false },
      { text: "设计目标", normalizedText: "设计目标", bounds: { x: 240, y: 90, width: 48, height: 12 }, baselineY: 100, hasEol: false },
      { text: "状态", normalizedText: "状态", bounds: { x: 500, y: 90, width: 24, height: 12 }, baselineY: 100, hasEol: true },
    ];
    const row = line("编号 用 户 营 养 档 案 已实现", 140, 440, 80);
    row.items = [
      { text: "编号", normalizedText: "编号", bounds: { x: 80, y: 130, width: 24, height: 12 }, baselineY: 140, hasEol: false },
      ...Array.from("用户营养档案").map((text, index) => ({
        text,
        normalizedText: text,
        bounds: { x: 240 + index * 34, y: 130, width: 12, height: 12 },
        baselineY: 140,
        hasEol: false,
      })),
      { text: "已实现", normalizedText: "已实现", bounds: { x: 500, y: 130, width: 36, height: 12 }, baselineY: 140, hasEol: true },
    ];
    const group = { tableGroupId: "table-distributed-cell" };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[header, row]]),
      snapshot("candidate", [[header, row]]),
      [
        expectation("字段", { index: 0, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 0 }),
        expectation("设计目标", { index: 1, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 1 }),
        expectation("状态", { index: 2, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 2 }),
        expectation("编号", { index: 3, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 0 }),
        expectation("用户营养档案", { index: 4, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 1 }),
        expectation("已实现", { index: 5, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 2 }),
      ],
    );

    expect(results.map((result) => result.baseline.matched)).toEqual([
      true, true, true, true, true, true,
    ]);
    expect(results[4]?.baseline.lineTexts).toEqual(["用户营养档案"]);
  });

  it("同列重复短文本按当前表格行的纵向锚点选择", () => {
    const header = line("字段 记录", 100, 220, 80);
    header.items = [
      { text: "字段", normalizedText: "字段", bounds: { x: 80, y: 90, width: 24, height: 12 }, baselineY: 100, hasEol: false },
      { text: "记录", normalizedText: "记录", bounds: { x: 240, y: 90, width: 24, height: 12 }, baselineY: 100, hasEol: true },
    ];
    const rowLabel = line("更新时间", 200, 48, 80);
    const rowValue = line("记录", 200, 24, 240);
    const group = { tableGroupId: "table-row-anchor" };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[header, rowLabel, rowValue]]),
      snapshot("candidate", [[header, rowLabel, rowValue]]),
      [
        expectation("字段", { index: 0, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 0 }),
        expectation("记录", { index: 1, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 1 }),
        expectation("更新时间", { index: 2, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 0 }),
        expectation("记录", { index: 3, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 1 }),
      ],
    );

    expect(results[3]?.baseline.matched).toBe(true);
    expect(results[3]?.baseline.firstLineBaselineYPt).toBe(200);
  });

  it("同一结构单元格内连续段落不应用横向相邻列边界", () => {
    const projectName = line("智慧园区一体化平台建设项目", 180, 180, 180);
    const reportTitle = line("可行性研究报告", 280, 120, 285);
    const reportVersion = line("送审稿V1.0", 360, 84, 330);
    const reportDate = line("2026年7月", 440, 72, 336);
    const group = {
      tableGroupId: "table-structural-cover",
      tableRowIndex: 0,
      tableColumnIndex: 0,
      blockKind: "table-cell" as const,
    };
    const expectations = [
      expectation("智慧园区一体化平台建设项目", { index: 0, ...group }),
      expectation("可行性研究报告", { index: 1, ...group }),
      expectation("送审稿 V1.0", { index: 2, ...group }),
      expectation("2026年7月", { index: 3, ...group }),
    ];
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[projectName, reportTitle, reportVersion, reportDate]]),
      snapshot("candidate", [[projectName, reportTitle, reportVersion, reportDate]]),
      expectations,
    );

    expect(results.map((result) => result.baseline.matched)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(results.map((result) => result.candidate.matched)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("同一表格行的后一列允许跨到下一 PDF 页继续匹配", () => {
    const rowLabel = itemLine("肆式", 780, 24, 80);
    const repeatedHeader = itemLine("字段说明", 72, 72, 80);
    const rowValue = itemLine("边界", 108, 24, 180);
    const group = {
      tableGroupId: "table-cross-page-row",
      tableRowIndex: 4,
      blockKind: "table-cell" as const,
    };
    const expectations = [
      expectation("肆式", { index: 0, ...group, tableColumnIndex: 0 }),
      expectation("边界", { index: 1, ...group, tableColumnIndex: 1 }),
    ];
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[rowLabel], [repeatedHeader, rowValue]]),
      snapshot("candidate", [[rowLabel], [repeatedHeader, rowValue]]),
      expectations,
    );

    expect(results.map((result) => result.baseline.matched)).toEqual([true, true]);
    expect(results.map((result) => result.candidate.matched)).toEqual([true, true]);
  });

  it("合并视觉行中的完整表头不会被下一数据行的较短左移前缀抢占", () => {
    const header = line("门禁内容邻接单元格", 100, 420, 80);
    header.items = [
      { text: "门禁", normalizedText: "门禁", bounds: { x: 80, y: 90, width: 24, height: 12 }, baselineY: 100, hasEol: false },
      { text: "内容", normalizedText: "内容", bounds: { x: 240, y: 90, width: 24, height: 12 }, baselineY: 100, hasEol: false },
      { text: "邻接单元格", normalizedText: "邻接单元格", bounds: { x: 420, y: 90, width: 60, height: 12 }, baselineY: 100, hasEol: true },
    ];
    const rowFirst = line("邻甲", 124, 24, 400);
    const rowLabel = line("行内代码", 132, 48, 80);
    const rowBody = line("单元格正文", 132, 60, 240);
    const rowSecond = line("邻乙", 148, 24, 400);
    const group = { tableGroupId: "table-merged-header-prefix" };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[header, rowFirst, rowLabel, rowBody, rowSecond]]),
      snapshot("candidate", [[header, rowFirst, rowLabel, rowBody, rowSecond]]),
      [
        expectation("门禁", { index: 0, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 0 }),
        expectation("内容", { index: 1, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 1 }),
        expectation("邻接单元格", { index: 2, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 2 }),
        expectation("行内代码", { index: 3, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 0 }),
        expectation("单元格正文", { index: 4, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 1 }),
        expectation("邻甲邻乙", {
          index: 5,
          blockKind: "table-cell",
          ...group,
          tableRowIndex: 1,
          tableColumnIndex: 2,
          hardBreakSegments: ["邻甲", "邻乙"],
        }),
      ],
    );

    expect(results.map((result) => result.baseline.matched)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(results[2]?.baseline.lineTexts).toEqual(["邻接单元格"]);
    expect(results[5]?.baseline.lineTexts).toEqual(["邻甲", "邻乙"]);
  });

  it("多段硬换行围绕行中心且首字重复时从当前单元格最早片段开始", () => {
    const header = line("场景 内容", 100, 220, 80);
    header.items = [
      { text: "场景", normalizedText: "场景", bounds: { x: 80, y: 90, width: 24, height: 12 }, baselineY: 100, hasEol: false },
      { text: "内容", normalizedText: "内容", bounds: { x: 240, y: 90, width: 24, height: 12 }, baselineY: 100, hasEol: true },
    ];
    const first = line("标甲", 180, 24, 240);
    const second = line("标乙", 200, 24, 240);
    const rowLabel = line("壹式", 210, 24, 80);
    const third = line("标丙", 220, 24, 240);
    const fourth = line("标丁", 240, 24, 240);
    const laterRow = line("大甲", 280, 24, 240);
    const group = { tableGroupId: "table-hard-break-row-center" };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[header, first, second, rowLabel, third, fourth, laterRow]]),
      snapshot("candidate", [[header, first, second, rowLabel, third, fourth, laterRow]]),
      [
        expectation("场景", { index: 0, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 0 }),
        expectation("内容", { index: 1, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 1 }),
        expectation("壹式", { index: 2, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 0 }),
        expectation("标甲标乙标丙标丁", {
          index: 3,
          blockKind: "table-cell",
          ...group,
          tableRowIndex: 1,
          tableColumnIndex: 1,
          hardBreakSegments: ["标甲", "标乙", "标丙", "标丁"],
        }),
      ],
    );

    expect(results[3]?.baseline.matched).toBe(true);
    expect(results[3]?.candidate.matched).toBe(true);
    expect(results[3]?.baseline.lineTexts).toEqual([
      "标甲",
      "标乙",
      "标丙",
      "标丁",
    ]);
  });

  it("两段硬换行优先已锚定数据行而不是上方表头的同首字前缀", () => {
    const header = line("字段 内容 邻", 100, 380, 80);
    header.items = [
      { text: "字段", normalizedText: "字段", bounds: { x: 80, y: 90, width: 24, height: 12 }, baselineY: 100, hasEol: false },
      { text: "内容", normalizedText: "内容", bounds: { x: 240, y: 90, width: 24, height: 12 }, baselineY: 100, hasEol: false },
      { text: "邻", normalizedText: "邻", bounds: { x: 400, y: 90, width: 12, height: 12 }, baselineY: 100, hasEol: true },
    ];
    const row = line("当前行 正文 邻甲", 140, 380, 80);
    row.items = [
      { text: "当前行", normalizedText: "当前行", bounds: { x: 80, y: 130, width: 36, height: 12 }, baselineY: 140, hasEol: false },
      { text: "正文", normalizedText: "正文", bounds: { x: 240, y: 130, width: 24, height: 12 }, baselineY: 140, hasEol: false },
      { text: "邻甲", normalizedText: "邻甲", bounds: { x: 400, y: 130, width: 24, height: 12 }, baselineY: 140, hasEol: true },
    ];
    const rowTail = line("邻乙", 160, 24, 400);
    const group = { tableGroupId: "table-two-hard-break-row-anchor" };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[header, row, rowTail]]),
      snapshot("candidate", [[header, row, rowTail]]),
      [
        expectation("字段", { index: 0, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 0 }),
        expectation("内容", { index: 1, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 1 }),
        expectation("邻", { index: 2, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 2 }),
        expectation("当前行", { index: 3, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 0 }),
        expectation("正文", { index: 4, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 1 }),
        expectation("邻甲邻乙", {
          index: 5,
          blockKind: "table-cell",
          ...group,
          tableRowIndex: 1,
          tableColumnIndex: 2,
          hardBreakSegments: ["邻甲", "邻乙"],
        }),
      ],
    );

    expect(results[5]?.baseline.matched).toBe(true);
    expect(results[5]?.candidate.matched).toBe(true);
    expect(results[5]?.baseline.lineTexts).toEqual(["邻甲", "邻乙"]);
    expect(results[5]?.candidate.lineTexts).toEqual(["邻甲", "邻乙"]);
  });

  it("表格后续列拆行时优先当前行而不是稍后完整同名文本", () => {
    const header = line("字段 状态", 100, 220, 80);
    header.items = [
      { text: "字段", normalizedText: "字段", bounds: { x: 80, y: 90, width: 24, height: 12 }, baselineY: 100, hasEol: false },
      { text: "状态", normalizedText: "状态", bounds: { x: 240, y: 90, width: 24, height: 12 }, baselineY: 100, hasEol: true },
    ];
    const rowFirst = line("当前行 已实", 200, 220, 80);
    rowFirst.items = [
      { text: "当前行", normalizedText: "当前行", bounds: { x: 80, y: 190, width: 36, height: 12 }, baselineY: 200, hasEol: false },
      { text: "已实", normalizedText: "已实", bounds: { x: 240, y: 190, width: 24, height: 12 }, baselineY: 200, hasEol: true },
    ];
    const rowTail = line("现", 213, 12, 240);
    const later = line("已实现", 280, 36, 240);
    const group = { tableGroupId: "table-split-later-column" };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[header, rowFirst, rowTail, later]]),
      snapshot("candidate", [[header, rowFirst, rowTail, later]]),
      [
        expectation("字段", { index: 0, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 0 }),
        expectation("状态", { index: 1, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 1 }),
        expectation("当前行", { index: 2, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 0 }),
        expectation("已实现", { index: 3, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 1 }),
      ],
    );

    expect(results[3]?.baseline.matched).toBe(true);
    expect(results[3]?.baseline.lineTexts).toEqual(["已实", "现"]);
    expect(results[3]?.baseline.firstLineBaselineYPt).toBe(200);
  });

  it("长行内代码跨多行时按列左边界聚合且不串入同行其他列", () => {
    const header = line("字段 说明", 100, 260, 80);
    header.items = [
      { text: "字段", normalizedText: "字段", bounds: { x: 100, y: 90, width: 24, height: 12 }, baselineY: 100, hasEol: false },
      { text: "说明", normalizedText: "说明", bounds: { x: 220, y: 90, width: 24, height: 12 }, baselineY: 100, hasEol: true },
    ];
    const first = line("nut_prod_sur", 200, 66, 100);
    first.items = [
      { text: "nut_prod_sur", normalizedText: "nut_prod_sur", bounds: { x: 100, y: 190, width: 66, height: 12 }, baselineY: 200, hasEol: true },
    ];
    const second = line("plus_disposal 余量处置明细表", 216, 220, 100);
    second.items = [
      { text: "plus_disposal", normalizedText: "plus_disposal", bounds: { x: 100, y: 206, width: 72, height: 12 }, baselineY: 216, hasEol: false },
      { text: "余量处置明细表", normalizedText: "余量处置明细表", bounds: { x: 220, y: 206, width: 84, height: 12 }, baselineY: 216, hasEol: true },
    ];
    const third = line("_item", 232, 30, 100);
    third.items = [
      { text: "_item", normalizedText: "_item", bounds: { x: 100, y: 222, width: 30, height: 12 }, baselineY: 232, hasEol: true },
    ];
    const group = { tableGroupId: "table-wrapped-inline-code" };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[header, first, second, third]]),
      snapshot("candidate", [[header, first, second, third]]),
      [
        expectation("字段", { index: 0, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 0 }),
        expectation("说明", { index: 1, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 1 }),
        expectation("nut_prod_surplus_disposal_item", { index: 2, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 0, hasInlineCode: true }),
        expectation("余量处置明细表", { index: 3, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 1 }),
      ],
    );

    expect(results[2]?.baseline.matched).toBe(true);
    expect(results[2]?.baseline.lineTexts).toEqual([
      "nut_prod_sur",
      "plus_disposal",
      "_item",
    ]);
    expect(results[2]?.baseline.visualLines).toHaveLength(3);
    expect(results[3]?.baseline.lineTexts).toEqual(["余量处置明细表"]);
  });

  it("表格短 ASCII 层级拆行时不会被后续行更长前缀抢占", () => {
    const header = line("资产名 分层", 100, 220, 80);
    header.items = [
      { text: "资产名", normalizedText: "资产名", bounds: { x: 80, y: 90, width: 36, height: 12 }, baselineY: 100, hasEol: false },
      { text: "分层", normalizedText: "分层", bounds: { x: 240, y: 90, width: 24, height: 12 }, baselineY: 100, hasEol: true },
    ];
    const currentRow = line("餐品营养排 D", 200, 220, 80);
    currentRow.items = [
      { text: "餐品营养排", normalizedText: "餐品营养排", bounds: { x: 80, y: 190, width: 72, height: 12 }, baselineY: 200, hasEol: false },
      { text: "D", normalizedText: "D", bounds: { x: 240, y: 190, width: 8, height: 12 }, baselineY: 200, hasEol: true },
    ];
    const currentRowTail = line("名日表 WS", 213, 220, 80);
    currentRowTail.items = [
      { text: "名日表", normalizedText: "名日表", bounds: { x: 80, y: 203, width: 36, height: 12 }, baselineY: 213, hasEol: false },
      { text: "WS", normalizedText: "WS", bounds: { x: 240, y: 203, width: 16, height: 12 }, baselineY: 213, hasEol: true },
    ];
    const laterRow = line("后续资产 DW", 360, 220, 80);
    laterRow.items = [
      { text: "后续资产", normalizedText: "后续资产", bounds: { x: 80, y: 350, width: 48, height: 12 }, baselineY: 360, hasEol: false },
      { text: "DW", normalizedText: "DW", bounds: { x: 240, y: 350, width: 16, height: 12 }, baselineY: 360, hasEol: true },
    ];
    const laterRowTail = line("S", 373, 8, 240);
    const group = { tableGroupId: "table-short-ascii-layer" };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[header, currentRow, currentRowTail, laterRow, laterRowTail]]),
      snapshot("candidate", [[header, currentRow, currentRowTail, laterRow, laterRowTail]]),
      [
        expectation("资产名", { index: 0, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 0 }),
        expectation("分层", { index: 1, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 1 }),
        expectation("餐品营养排名日表", { index: 2, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 0 }),
        expectation("DWS", { index: 3, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 1 }),
      ],
    );

    expect(results[3]?.baseline.matched).toBe(true);
    expect(results[3]?.candidate.matched).toBe(true);
    expect(results[3]?.baseline.lineTexts).toEqual(["D", "WS"]);
    expect(results[3]?.baseline.firstLineBaselineYPt).toBe(200);
  });

  it("纵版窄表头允许相邻列在同一逻辑行内上下错位", () => {
    const upper = line("DW DW AD 合", 100, 300, 360);
    upper.items = [
      { text: "DW", normalizedText: "DW", bounds: { x: 367, y: 90, width: 18, height: 12 }, baselineY: 100, hasEol: false },
      { text: "DW", normalizedText: "DW", bounds: { x: 409, y: 90, width: 18, height: 12 }, baselineY: 100, hasEol: false },
      { text: "AD", normalizedText: "AD", bounds: { x: 451, y: 90, width: 18, height: 12 }, baselineY: 100, hasEol: false },
      { text: "合", normalizedText: "合", bounds: { x: 496, y: 90, width: 12, height: 12 }, baselineY: 100, hasEol: true },
    ];
    const lower = line("子节 D S S 计", 121, 320, 204);
    lower.items = [
      { text: "子节", normalizedText: "子节", bounds: { x: 204, y: 111, width: 24, height: 12 }, baselineY: 121, hasEol: false },
      { text: "D", normalizedText: "D", bounds: { x: 380, y: 111, width: 9, height: 12 }, baselineY: 121, hasEol: false },
      { text: "S", normalizedText: "S", bounds: { x: 424, y: 111, width: 9, height: 12 }, baselineY: 121, hasEol: false },
      { text: "S", normalizedText: "S", bounds: { x: 462, y: 111, width: 9, height: 12 }, baselineY: 121, hasEol: false },
      { text: "计", normalizedText: "计", bounds: { x: 496, y: 111, width: 12, height: 12 }, baselineY: 121, hasEol: true },
    ];
    const group = { tableGroupId: "table-staggered-header", tableRowIndex: 0 };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[upper, lower]]),
      snapshot("candidate", [[upper, lower]]),
      [
        expectation("子节", { index: 0, blockKind: "table-header", ...group, tableColumnIndex: 0 }),
        expectation("DWD", { index: 1, blockKind: "table-header", ...group, tableColumnIndex: 1 }),
        expectation("DWS", { index: 2, blockKind: "table-header", ...group, tableColumnIndex: 2 }),
        expectation("ADS", { index: 3, blockKind: "table-header", ...group, tableColumnIndex: 3 }),
        expectation("合计", { index: 4, blockKind: "table-header", ...group, tableColumnIndex: 4 }),
      ],
    );

    expect(results.map((result) => result.baseline.matched)).toEqual([
      true, true, true, true, true,
    ]);
    expect(results[1]?.baseline.lineTexts).toEqual(["DW", "D"]);
  });

  it("首次学习窄 ASCII 表头列时按剩余列域从左到右建立锚点", () => {
    const upper = line("DWAD合未实现(设计", 100, 430, 258);
    upper.items = [
      { text: "DW", normalizedText: "DW", bounds: { x: 258, y: 90, width: 18, height: 12 }, baselineY: 100, hasEol: false },
      { text: "AD", normalizedText: "AD", bounds: { x: 349, y: 90, width: 18, height: 12 }, baselineY: 100, hasEol: false },
      { text: "合", normalizedText: "合", bounds: { x: 396, y: 90, width: 12, height: 12 }, baselineY: 100, hasEol: false },
      { text: "未实现(设计", normalizedText: "未实现(设计", bounds: { x: 442, y: 90, width: 70, height: 12 }, baselineY: 100, hasEol: true },
    ];
    const lower = line("承接菜单DDWSS计态)", 114, 440, 81);
    lower.items = [
      { text: "承接菜单", normalizedText: "承接菜单", bounds: { x: 81, y: 104, width: 72, height: 12 }, baselineY: 114, hasEol: false },
      { text: "D", normalizedText: "D", bounds: { x: 270, y: 104, width: 9, height: 12 }, baselineY: 114, hasEol: false },
      { text: "DWS", normalizedText: "DWS", bounds: { x: 297, y: 104, width: 27, height: 12 }, baselineY: 114, hasEol: false },
      { text: "S", normalizedText: "S", bounds: { x: 360, y: 104, width: 9, height: 12 }, baselineY: 114, hasEol: false },
      { text: "计", normalizedText: "计", bounds: { x: 396, y: 104, width: 12, height: 12 }, baselineY: 114, hasEol: false },
      { text: "态)", normalizedText: "态)", bounds: { x: 489, y: 104, width: 22, height: 12 }, baselineY: 114, hasEol: true },
    ];
    const group = { tableGroupId: "table-staggered-narrow-ascii", tableRowIndex: 0 };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[upper, lower]]),
      snapshot("candidate", [[upper, lower]]),
      [
        expectation("承接菜单", { index: 0, blockKind: "table-header", ...group, tableColumnIndex: 0 }),
        expectation("DWD", { index: 1, blockKind: "table-header", ...group, tableColumnIndex: 1 }),
        expectation("DWS", { index: 2, blockKind: "table-header", ...group, tableColumnIndex: 2 }),
        expectation("ADS", { index: 3, blockKind: "table-header", ...group, tableColumnIndex: 3 }),
        expectation("合计", { index: 4, blockKind: "table-header", ...group, tableColumnIndex: 4 }),
        expectation("未实现(设计态)", { index: 5, blockKind: "table-header", ...group, tableColumnIndex: 5 }),
      ],
    );

    expect(results.map((result) => result.baseline.matched)).toEqual([
      true, true, true, true, true, true,
    ]);
    expect(results[1]?.baseline.lineTexts).toEqual(["DW", "D"]);
    expect(results[2]?.baseline.lineTexts).toEqual(["DWS"]);
    expect(results[3]?.baseline.lineTexts).toEqual(["AD", "S"]);
  });

  it("纵向中文表头超过普通行域时不会消费首个数据行的同名字符", () => {
    const headerLines = [
      line("实", 100, 12, 463),
      line("现", 121, 12, 463),
      line("状", 142, 12, 463),
      line("表名态", 163, 390, 99),
    ];
    headerLines[3]!.items = [
      { text: "表名", normalizedText: "表名", bounds: { x: 99, y: 153, width: 24, height: 12 }, baselineY: 163, hasEol: false },
      { text: "态", normalizedText: "态", bounds: { x: 463, y: 153, width: 12, height: 12 }, baselineY: 163, hasEol: true },
    ];
    const dataFirst = line("首行数据已", 190, 390, 99);
    dataFirst.items = [
      { text: "首行数据", normalizedText: "首行数据", bounds: { x: 99, y: 180, width: 48, height: 12 }, baselineY: 190, hasEol: false },
      { text: "已", normalizedText: "已", bounds: { x: 463, y: 180, width: 12, height: 12 }, baselineY: 190, hasEol: true },
    ];
    const dataSecond = line("实", 211, 12, 463);
    const dataThird = line("现", 232, 12, 463);
    const group = { tableGroupId: "table-tall-vertical-header" };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[...headerLines, dataFirst, dataSecond, dataThird]]),
      snapshot("candidate", [[...headerLines, dataFirst, dataSecond, dataThird]]),
      [
        expectation("表名", { index: 0, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 0 }),
        expectation("实现状态", { index: 1, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 1 }),
        expectation("首行数据", { index: 2, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 0 }),
        expectation("已实现", { index: 3, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 1 }),
      ],
    );

    expect(results.map((result) => result.baseline.matched)).toEqual([
      true, true, true, true,
    ]);
    expect(results[1]?.baseline.lineTexts).toEqual(["实", "现", "状", "态"]);
    expect(results[3]?.baseline.lineTexts).toEqual(["已", "实", "现"]);
  });

  it("跨页单元格续行不会为更近列中心跳到下一数据行", () => {
    const pageOne = [
      line("类型 比例", 100, 260, 80),
      line("brea 0.3", 200, 260, 80),
    ];
    pageOne[0]!.items = [
      { text: "类型", normalizedText: "类型", bounds: { x: 80, y: 90, width: 24, height: 12 }, baselineY: 100, hasEol: false },
      { text: "比例", normalizedText: "比例", bounds: { x: 240, y: 90, width: 24, height: 12 }, baselineY: 100, hasEol: true },
    ];
    pageOne[1]!.items = [
      { text: "brea", normalizedText: "brea", bounds: { x: 80, y: 190, width: 32, height: 12 }, baselineY: 200, hasEol: false },
      { text: "0.3", normalizedText: "0.3", bounds: { x: 240, y: 190, width: 22, height: 12 }, baselineY: 200, hasEol: true },
    ];
    const pageTwo = [
      line("重复表头一", 80, 260, 80),
      line("重复表头二", 92, 260, 80),
      line("重复表头三", 104, 260, 80),
      line("重复表头四", 116, 260, 80),
      line("类型 比例", 128, 260, 80),
      line("kfast 0", 140, 260, 80),
      line("lunc 0.4", 180, 260, 80),
      line("h 0", 200, 260, 80),
    ];
    pageTwo.forEach((visualLine) => {
      const parts = visualLine.normalizedText.split(" ");
      visualLine.items = parts.length === 1
        ? [{ text: parts[0]!, normalizedText: parts[0]!, bounds: { x: 80, y: visualLine.baselineY - 10, width: 60, height: 12 }, baselineY: visualLine.baselineY, hasEol: true }]
        : [
        { text: parts[0]!, normalizedText: parts[0]!, bounds: { x: 80, y: visualLine.baselineY - 10, width: 40, height: 12 }, baselineY: visualLine.baselineY, hasEol: false },
        { text: parts[1]!, normalizedText: parts[1]!, bounds: { x: parts[1] === "0" && parts[0] === "lunc" ? 244 : 240, y: visualLine.baselineY - 10, width: 24, height: 12 }, baselineY: visualLine.baselineY, hasEol: true },
      ];
    });
    const group = { tableGroupId: "table-cross-page-continuation" };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [pageOne, pageTwo]),
      snapshot("candidate", [pageOne, pageTwo]),
      [
        expectation("类型", { index: 0, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 0 }),
        expectation("比例", { index: 1, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 1 }),
        expectation("breakfast", { index: 2, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 0 }),
        expectation("0.30", { index: 3, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 1 }),
        expectation("lunch", { index: 4, blockKind: "table-cell", ...group, tableRowIndex: 2, tableColumnIndex: 0 }),
        expectation("0.40", { index: 5, blockKind: "table-cell", ...group, tableRowIndex: 2, tableColumnIndex: 1 }),
      ],
    );

    expect(results.map((result) => result.baseline.matched)).toEqual([
      true, true, true, true, true, true,
    ]);
    expect(results[3]?.baseline.lineTexts).toEqual(["0.3", "0"]);
    expect(results[4]?.baseline.lineTexts).toEqual(["lunc", "h"]);
  });

  it("跨页表格行尾不会吸附后续数据行并跳过下一行长标识符", () => {
    const header = line("资产表注册分层说明状态", 700, 490, 47);
    header.items = [
      { text: "资产表", normalizedText: "资产表", bounds: { x: 47, y: 690, width: 36, height: 12 }, baselineY: 700, hasEol: false },
      { text: "注册", normalizedText: "注册", bounds: { x: 183, y: 690, width: 24, height: 12 }, baselineY: 700, hasEol: false },
      { text: "分层", normalizedText: "分层", bounds: { x: 292, y: 690, width: 24, height: 12 }, baselineY: 700, hasEol: false },
      { text: "说明", normalizedText: "说明", bounds: { x: 330, y: 690, width: 24, height: 12 }, baselineY: 700, hasEol: false },
      { text: "状态", normalizedText: "状态", bounds: { x: 499, y: 690, width: 24, height: 12 }, baselineY: 700, hasEol: true },
    ];
    const rowOneFirst = line(
      "dwd_snd_terminal_fau(未注册资产D终端故障+抄表明细未实现",
      764,
      490,
      47,
    );
    rowOneFirst.items = [
      { text: "dwd_snd_terminal_fau", normalizedText: "dwd_snd_terminal_fau", bounds: { x: 47, y: 754, width: 116, height: 12 }, baselineY: 764, hasEol: false },
      { text: "(未注册资产", normalizedText: "(未注册资产", bounds: { x: 183, y: 754, width: 72, height: 12 }, baselineY: 764, hasEol: false },
      { text: "D", normalizedText: "D", bounds: { x: 292, y: 754, width: 9, height: 12 }, baselineY: 764, hasEol: false },
      { text: "终端故障+抄表明细", normalizedText: "终端故障+抄表明细", bounds: { x: 330, y: 754, width: 102, height: 12 }, baselineY: 764, hasEol: false },
      { text: "未实现", normalizedText: "未实现", bounds: { x: 499, y: 754, width: 36, height: 12 }, baselineY: 764, hasEol: true },
    ];
    const rowOneSecond = line("lt_inc名)W(设计", 785, 490, 47);
    rowOneSecond.items = [
      { text: "lt_inc", normalizedText: "lt_inc", bounds: { x: 47, y: 775, width: 35, height: 12 }, baselineY: 785, hasEol: false },
      { text: "名)", normalizedText: "名)", bounds: { x: 183, y: 775, width: 24, height: 12 }, baselineY: 785, hasEol: false },
      { text: "W", normalizedText: "W", bounds: { x: 292, y: 775, width: 13, height: 12 }, baselineY: 785, hasEol: false },
      { text: "(设计", normalizedText: "(设计", bounds: { x: 499, y: 775, width: 28, height: 12 }, baselineY: 785, hasEol: true },
    ];

    const repeatedHeader = line("表名资产名层设计目标态", 81, 490, 47);
    repeatedHeader.items = [
      { text: "表名资产名层设计目标", normalizedText: "表名资产名层设计目标", bounds: { x: 47, y: 71, width: 430, height: 12 }, baselineY: 81, hasEol: false },
      { text: "态", normalizedText: "态", bounds: { x: 515, y: 71, width: 12, height: 12 }, baselineY: 81, hasEol: true },
    ];
    const rowOneTail = line("D态)", 115, 490, 292);
    rowOneTail.items = [
      { text: "D", normalizedText: "D", bounds: { x: 292, y: 105, width: 9, height: 12 }, baselineY: 115, hasEol: false },
      { text: "态)", normalizedText: "态)", bounds: { x: 499, y: 105, width: 16, height: 12 }, baselineY: 115, hasEol: true },
    ];
    const rowTwoFirst = line("dwd_snd_user_account(未注册资产D用户账户未实现", 149, 490, 47);
    rowTwoFirst.items = [
      { text: "dwd_snd_user_account", normalizedText: "dwd_snd_user_account", bounds: { x: 47, y: 139, width: 116, height: 12 }, baselineY: 149, hasEol: false },
      { text: "(未注册资产", normalizedText: "(未注册资产", bounds: { x: 183, y: 139, width: 72, height: 12 }, baselineY: 149, hasEol: false },
      { text: "D", normalizedText: "D", bounds: { x: 292, y: 139, width: 9, height: 12 }, baselineY: 149, hasEol: false },
      { text: "用户账户", normalizedText: "用户账户", bounds: { x: 330, y: 139, width: 48, height: 12 }, baselineY: 149, hasEol: false },
      { text: "未实现", normalizedText: "未实现", bounds: { x: 499, y: 139, width: 36, height: 12 }, baselineY: 149, hasEol: true },
    ];
    const rowTwoSecond = line("_detail名)W(设计", 171, 490, 47);
    rowTwoSecond.items = [
      { text: "_detail", normalizedText: "_detail", bounds: { x: 47, y: 161, width: 41, height: 12 }, baselineY: 171, hasEol: false },
      { text: "名)", normalizedText: "名)", bounds: { x: 183, y: 161, width: 24, height: 12 }, baselineY: 171, hasEol: false },
      { text: "W", normalizedText: "W", bounds: { x: 292, y: 161, width: 13, height: 12 }, baselineY: 171, hasEol: false },
      { text: "(设计", normalizedText: "(设计", bounds: { x: 499, y: 161, width: 28, height: 12 }, baselineY: 171, hasEol: true },
    ];
    const rowTwoTail = line("D态)", 192, 490, 292);
    rowTwoTail.items = [
      { text: "D", normalizedText: "D", bounds: { x: 292, y: 182, width: 9, height: 12 }, baselineY: 192, hasEol: false },
      { text: "态)", normalizedText: "态)", bounds: { x: 499, y: 182, width: 16, height: 12 }, baselineY: 192, hasEol: true },
    ];
    const group = { tableGroupId: "table-cross-page-row-tail" };
    const expectations = [
      expectation("资产表", { index: 0, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 0 }),
      expectation("注册", { index: 1, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 1 }),
      expectation("分层", { index: 2, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 2 }),
      expectation("说明", { index: 3, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 3 }),
      expectation("状态", { index: 4, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 4 }),
      expectation("dwd_snd_terminal_fault_inc", { index: 5, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 0 }),
      expectation("（未注册资产名）", { index: 6, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 1 }),
      expectation("DWD", { index: 7, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 2 }),
      expectation("终端故障+抄表明细", { index: 8, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 3 }),
      expectation("未实现(设计态)", { index: 9, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 4 }),
      expectation("dwd_snd_user_account_detail", { index: 10, blockKind: "table-cell", ...group, tableRowIndex: 2, tableColumnIndex: 0 }),
    ];
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[header, rowOneFirst, rowOneSecond], [repeatedHeader, rowOneTail, rowTwoFirst, rowTwoSecond, rowTwoTail]]),
      snapshot("candidate", [[header, rowOneFirst, rowOneSecond], [repeatedHeader, rowOneTail, rowTwoFirst, rowTwoSecond, rowTwoTail]]),
      expectations,
    );

    expect(results.map((result) => result.baseline.matched)).toEqual(
      expectations.map(() => true),
    );
    expect(results[9]?.baseline.visualLines.at(-1)?.bounds.y).toBe(105);
    expect(results[9]?.baseline.lineTexts).toEqual([
      "未实现",
      "(设计",
      "态)",
    ]);
    expect(results[10]?.baseline.lineTexts).toEqual([
      "dwd_snd_user_account",
      "_detail",
    ]);
  });

  it("表格首列被拆行时不会被稍后正文中的完整同名词夺走行锚点", () => {
    const header = line("层级 数据性质 具体做法", 100, 440, 78);
    header.items = [
      { text: "层级", normalizedText: "层级", bounds: { x: 78, y: 90, width: 20, height: 12 }, baselineY: 100, hasEol: false },
      { text: "数据性质", normalizedText: "数据性质", bounds: { x: 106, y: 90, width: 40, height: 12 }, baselineY: 100, hasEol: false },
      { text: "具体做法", normalizedText: "具体做法", bounds: { x: 164, y: 90, width: 220, height: 12 }, baselineY: 100, hasEol: true },
    ];
    const dwsFirst = line("D 计算 按维度日聚合", 200, 360, 78);
    dwsFirst.items = [
      { text: "D", normalizedText: "D", bounds: { x: 78, y: 190, width: 8, height: 12 }, baselineY: 200, hasEol: false },
      { text: "计算", normalizedText: "计算", bounds: { x: 106, y: 190, width: 20, height: 12 }, baselineY: 200, hasEol: false },
      { text: "按维度日聚合", normalizedText: "按维度日聚合", bounds: { x: 164, y: 190, width: 72, height: 12 }, baselineY: 200, hasEol: true },
    ];
    const dwsTail = line("WS", 213, 16, 78);
    const laterBody = line("加工；DWS、ADS 两层是计算", 280, 180, 72);
    const group = { tableGroupId: "table-split-row-anchor" };
    const expectations = [
      expectation("层级", { index: 0, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 0 }),
      expectation("数据性质", { index: 1, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 1 }),
      expectation("具体做法", { index: 2, blockKind: "table-header", ...group, tableRowIndex: 0, tableColumnIndex: 2 }),
      expectation("DWS", { index: 3, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 0 }),
      expectation("计算", { index: 4, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 1 }),
      expectation("按维度日聚合", { index: 5, blockKind: "table-cell", ...group, tableRowIndex: 1, tableColumnIndex: 2 }),
    ];
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[header, dwsFirst, dwsTail, laterBody]]),
      snapshot("candidate", [[header, dwsFirst, dwsTail, laterBody]]),
      expectations,
    );

    expect(results.map((result) => result.baseline.matched)).toEqual([
      true, true, true, true, true, true,
    ]);
    expect(results[3]?.baseline.lineTexts).toEqual(["D", "WS"]);
    expect(results[4]?.baseline.firstLineBaselineYPt).toBe(200);
  });

  it("长标识符在文本层仅缺失少量末尾字形时恢复表头观测", () => {
    const clipped = line("is_workday_requir", 100, 112, 680);
    const [result] = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[clipped]]),
      snapshot("candidate", [[clipped]]),
      [expectation("is_workday_required", {
        blockKind: "table-header",
        tableGroupId: "table-clipped-header",
        tableRowIndex: 0,
        tableColumnIndex: 7,
      })],
    );

    expect(result?.baseline.matched).toBe(true);
    expect(result?.baseline.matchedCharacterCount).toBe(17);
    expect(result?.baseline.lineTexts).toEqual(["is_workday_requir"]);
  });

  it("长标识符缺失超过十五个百分点时仍拒绝恢复表头观测", () => {
    const clipped = line("is_workday_req", 100, 96, 680);
    const [result] = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[clipped]]),
      snapshot("candidate", [[clipped]]),
      [expectation("is_workday_required", {
        blockKind: "table-header",
        tableGroupId: "table-over-clipped-header",
        tableRowIndex: 0,
        tableColumnIndex: 7,
      })],
    );

    expect(result?.baseline.matched).toBe(false);
  });

  it("双行表头续字不会为更近列坐标跨入下一数据行", () => {
    const headerFirst = line("meal_typ", 100, 64, 80);
    const headerTail = line("e", 118, 8, 92);
    const dataFirst = line("breakfas", 145, 64, 80);
    const dataTail = line("t", 163, 8, 80);
    headerFirst.items = [{ text: "meal_typ", normalizedText: "meal_typ", bounds: { x: 80, y: 90, width: 64, height: 12 }, baselineY: 100, hasEol: true }];
    headerTail.items = [{ text: "e", normalizedText: "e", bounds: { x: 92, y: 108, width: 8, height: 12 }, baselineY: 118, hasEol: true }];
    dataFirst.items = [{ text: "breakfas", normalizedText: "breakfas", bounds: { x: 80, y: 135, width: 64, height: 12 }, baselineY: 145, hasEol: true }];
    dataTail.items = [{ text: "t", normalizedText: "t", bounds: { x: 80, y: 153, width: 8, height: 12 }, baselineY: 163, hasEol: true }];
    const group = { tableGroupId: "table-header-near-next-row", tableColumnIndex: 0 };
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[headerFirst, headerTail, dataFirst, dataTail]]),
      snapshot("candidate", [[headerFirst, headerTail, dataFirst, dataTail]]),
      [
        expectation("meal_type", { index: 0, blockKind: "table-header", ...group, tableRowIndex: 0 }),
        expectation("breakfast", { index: 1, blockKind: "table-cell", ...group, tableRowIndex: 1 }),
      ],
    );

    expect(results.map((result) => result.baseline.matched)).toEqual([
      true, true,
    ]);
    expect(results[0]?.baseline.lineTexts).toEqual(["meal_typ", "e"]);
    expect(results[1]?.baseline.lineTexts).toEqual(["breakfas", "t"]);
  });

  it("新表首列保持最早视觉行的最左前缀而不被稍后更长前缀抢占", () => {
    const visualLines = [
      line("mea", 100, 30, 100),
      line("meal", 120, 40, 400),
      line("l_type", 140, 50, 100),
    ];
    const paragraphs = [
      expectation("meal_type", {
        index: 0,
        blockKind: "table-header",
        tableGroupId: "table-leftmost-prefix",
        tableRowIndex: 0,
        tableColumnIndex: 0,
      }),
    ];
    const results = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [visualLines]),
      snapshot("candidate", [visualLines]),
      paragraphs,
    );

    expect(results[0]?.baseline.matched).toBe(true);
    expect(results[0]?.candidate.matched).toBe(true);
    expect(results[0]?.baseline.lineTexts).toEqual(["mea", "l_type"]);
  });

  it("按字符类别估算合并文本项中的有序列表正文边界", () => {
    const listLine = line("3.系统联调", 220, 100, 100);
    listLine.items = [
      {
        text: "3. 系统联调",
        normalizedText: "3. 系统联调",
        bounds: { x: 100, y: 210, width: 100, height: 12 },
        baselineY: 220,
        fontFamily: "Test Serif",
        hasEol: true,
      },
    ];
    const [result] = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[listLine]]),
      snapshot("candidate", [[listLine]]),
      [expectation("系统联调", { blockKind: "list-item" })],
    );

    expect(result?.baseline.visualLines[0]?.bounds.x).toBeCloseTo(123.48, 1);
    expect(result?.baseline.visualLines[0]?.bounds.width).toBeCloseTo(76.52, 1);
  });

  it("从被归一化行剥离的项目符号后开始裁剪正文", () => {
    const listLine = line("系统联调", 220, 100, 100);
    listLine.items = [
      {
        text: "• 系统联调",
        normalizedText: "• 系统联调",
        bounds: { x: 100, y: 210, width: 100, height: 12 },
        baselineY: 220,
        fontFamily: "Test Serif",
        hasEol: true,
      },
    ];
    const [result] = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[listLine]]),
      snapshot("candidate", [[listLine]]),
      [expectation("系统联调", { blockKind: "list-item" })],
    );

    expect(result?.baseline.visualLines[0]?.bounds.x).toBeGreaterThan(100);
    expect(result?.baseline.visualLines[0]?.bounds.width).toBeLessThan(100);
    expect(result?.baseline.lineTexts).toEqual(["系统联调"]);
  });

  it("跳过被无关字符打断的相似文本并匹配后续完整段落", () => {
    const [result] = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[
        line("甲X乙", 180),
        line("甲乙", 220),
      ]]),
      snapshot("candidate", [[
        line("甲X乙", 180),
        line("甲乙", 220),
      ]]),
      [expectation("甲乙")],
    );

    expect(result?.status).toBe("passed");
    expect(result?.baseline.firstLineBaselineYPt).toBe(220);
    expect(result?.candidate.firstLineBaselineYPt).toBe(220);
  });

  it("连续段落可以自然跨越多个 PDF 视觉行", () => {
    const [result] = comparePdfEditableParagraphLayouts(
      snapshot("baseline", [[line("甲乙", 180), line("丙丁", 204)]]),
      snapshot("candidate", [[line("甲乙", 180), line("丙丁", 204)]]),
      [expectation("甲乙丙丁")],
    );

    expect(result?.status).toBe("passed");
    expect(result?.baseline.lineTexts).toEqual(["甲乙", "丙丁"]);
  });

  it("允许正文段落整体移动到下一物理页", () => {
    const baseline = snapshot("baseline", [
      [line("建立月度调度机制及时协调", 700), line("解决项目中的问题", 728)],
      [],
    ]);
    const candidate = snapshot("candidate", [
      [],
      [line("建立月度调度机制及时协调", 100), line("解决项目中的问题", 128)],
    ]);
    const [result] = comparePdfEditableParagraphLayouts(
      baseline,
      candidate,
      [expectation("建立月度调度机制及时协调解决项目中的问题")],
    );
    expect(result?.status).toBe("passed");
    expect(result?.baseline.pageNumbers).toEqual([1]);
    expect(result?.candidate.pageNumbers).toEqual([2]);
  });

  it("拒绝标题从一行变成两行", () => {
    const baseline = snapshot("baseline", [
      [line("智慧园区一体化平台建设项目", 220, 250)],
    ]);
    const candidate = snapshot("candidate", [
      [line("智慧园区一体化平台", 220, 190), line("建设项目", 250, 60)],
    ]);
    const [result] = comparePdfEditableParagraphLayouts(
      baseline,
      candidate,
      [
        expectation("智慧园区一体化平台建设项目", {
          role: "title",
          section: "cover",
          styleId: "MdProjectReportProjectName",
        }),
      ],
    );
    expect(result?.status).toBe("failed");
    expect(result?.issues.map((issue) => issue.code)).toContain(
      "TEXT_BLOCK_LINE_COUNT_MISMATCH",
    );
  });

  it("允许长正文仅有极短末行的跨引擎换行差异", () => {
    const text =
      "数字化管理部门负责项目统筹技术审查过程监督和验收管理需求单位负责业务需求确认试运行和应用推广";
    const baseline = snapshot("baseline", [
      [line(text.slice(0, -2), 220, 680), line(text.slice(-2), 244, 28)],
    ]);
    const candidate = snapshot("candidate", [[line(text, 220, 695)]]);
    const [result] = comparePdfEditableParagraphLayouts(
      baseline,
      candidate,
      [expectation(text)],
    );
    expect(result?.status).toBe("warning");
    expect(result?.issues).toEqual([
      expect.objectContaining({
        code: "BODY_LINE_COUNT_NEAR_BOUNDARY",
        severity: "warning",
      }),
    ]);
  });

  it("正文块行数不变时允许三个字符以内的流式行内重排", () => {
    const baseline = snapshot("baseline", [[
      line("甲乙丙丁", 220),
      line("戊己庚辛", 244),
    ]]);
    const candidate = snapshot("candidate", [[
      line("甲乙丙丁戊己", 220),
      line("庚辛", 244),
    ]]);
    const [result] = comparePdfEditableParagraphLayouts(
      baseline,
      candidate,
      [expectation("甲乙丙丁戊己庚辛", { blockKind: "paragraph" })],
    );

    expect(result?.status).toBe("warning");
    expect(result?.issues).toContainEqual(
      expect.objectContaining({
        code: "PARAGRAPH_LINE_BREAK_MISMATCH",
        severity: "warning",
      }),
    );
  });

  it("拒绝短正文或非极短末行的行数差异", () => {
    const text = "项目建设内容需要严格控制质量进度投资安全风险";
    const baseline = snapshot("baseline", [
      [line(text.slice(0, -5), 220), line(text.slice(-5), 244)],
    ]);
    const candidate = snapshot("candidate", [[line(text, 220)]]);
    const [result] = comparePdfEditableParagraphLayouts(
      baseline,
      candidate,
      [expectation(text)],
    );
    expect(result?.status).toBe("failed");
    expect(result?.issues.map((issue) => issue.code)).toContain(
      "TEXT_BLOCK_LINE_COUNT_MISMATCH",
    );
  });

  it("拒绝封面内容漂移到正文页", () => {
    const baseline = snapshot("baseline", [
      [line("可行性研究报告", 300, 180)],
      [],
    ]);
    const candidate = snapshot("candidate", [
      [],
      [line("可行性研究报告", 100, 180)],
    ]);
    const [result] = comparePdfEditableParagraphLayouts(
      baseline,
      candidate,
      [
        expectation("可行性研究报告", {
          role: "title",
          section: "cover",
          styleId: "MdProjectReportTitle",
        }),
      ],
    );
    expect(result?.status).toBe("failed");
    expect(result?.issues.map((issue) => issue.code)).toContain(
      "COVER_LAYOUT_MISMATCH",
    );
  });

  it("拒绝正文内容回流到独立封面页", () => {
    const baseline = snapshot("baseline", [
      [line("独立封面", 200)],
      [line("第一章项目概述", 100)],
    ]);
    const candidate = snapshot("candidate", [
      [line("独立封面", 200), line("第一章项目概述", 700)],
      [],
    ]);
    const pageSemantics = [
      { physicalPageNumber: 1, kind: "cover" as const },
      { physicalPageNumber: 2, kind: "body-first" as const },
    ];
    const [result] = comparePdfEditableParagraphLayouts(
      baseline,
      candidate,
      [expectation("第一章项目概述")],
      pageSemantics,
      pageSemantics,
    );
    expect(result?.status).toBe("failed");
    expect(result?.issues).toContainEqual(
      expect.objectContaining({
        code: "COVER_LAYOUT_MISMATCH",
        severity: "failure",
      }),
    );
  });

  it("忽略 PDF 文本提取器失真的单行宽度但保留诊断值", () => {
    const baseline = snapshot("baseline", [
      [line("数据治理平台建设项目", 300, 224)],
    ]);
    const candidate = snapshot("candidate", [
      [line("数据治理平台建设项目", 300, 210)],
    ]);
    const [result] = comparePdfEditableParagraphLayouts(
      baseline,
      candidate,
      [
        expectation("数据治理平台建设项目", {
          role: "title",
          section: "cover",
          styleId: "MdProjectReportTitle",
        }),
      ],
    );
    expect(result?.status).toBe("passed");
    expect(result?.baseline.maximumLineWidthPt).toBe(224);
    expect(result?.candidate.maximumLineWidthPt).toBe(210);
  });

  it("允许封面字形基线在 3pt 内波动", () => {
    const baseline = snapshot("baseline", [
      [line("数据治理平台建设项目", 300, 224)],
    ]);
    const candidate = snapshot("candidate", [
      [line("数据治理平台建设项目", 302.5, 224)],
    ]);
    const [result] = comparePdfEditableParagraphLayouts(
      baseline,
      candidate,
      [
        expectation("数据治理平台建设项目", {
          role: "title",
          section: "cover",
          styleId: "MdProjectReportTitle",
        }),
      ],
    );
    expect(result?.status).toBe("passed");
  });

  it("拒绝封面字形基线偏移超过 6pt", () => {
    const baseline = snapshot("baseline", [
      [line("数据治理平台建设项目", 300, 224)],
    ]);
    const candidate = snapshot("candidate", [
      [line("数据治理平台建设项目", 306.1, 224)],
    ]);
    const [result] = comparePdfEditableParagraphLayouts(
      baseline,
      candidate,
      [
        expectation("数据治理平台建设项目", {
          role: "title",
          section: "cover",
          styleId: "MdProjectReportTitle",
        }),
      ],
    );
    expect(result?.status).toBe("failed");
    expect(result?.issues.map((issue) => issue.code)).toContain(
      "COVER_LAYOUT_MISMATCH",
    );
  });

  it("允许封面文本提取框横向偏差在 3pt 内波动", () => {
    const baseline = snapshot("baseline", [
      [line("数据治理平台建设项目", 300, 224, 198)],
    ]);
    const candidate = snapshot("candidate", [
      [line("数据治理平台建设项目", 300, 224, 200.5)],
    ]);
    const [result] = comparePdfEditableParagraphLayouts(
      baseline,
      candidate,
      [
        expectation("数据治理平台建设项目", {
          role: "title",
          section: "cover",
          styleId: "MdProjectReportTitle",
        }),
      ],
    );
    expect(result?.status).toBe("passed");
  });

  it("正文文本横向偏差仍严格限制为 2pt", () => {
    const baseline = snapshot("baseline", [
      [line("项目建设内容", 300, 120, 72)],
    ]);
    const candidate = snapshot("candidate", [
      [line("项目建设内容", 300, 120, 74.5)],
    ]);
    const [result] = comparePdfEditableParagraphLayouts(
      baseline,
      candidate,
      [expectation("项目建设内容")],
    );
    expect(result?.status).toBe("failed");
    expect(result?.issues.map((issue) => issue.code)).toContain(
      "PARAGRAPH_LINE_GEOMETRY_MISMATCH",
    );
  });

  it("表格段落按各自列左锚点归一化横向几何", () => {
    const group = {
      tableGroupId: "table-column-relative-geometry",
      blockKind: "table-cell" as const,
    };
    const baseline = snapshot("baseline", [[
      itemLine("甲项", 120, 24, 80),
      itemLine("甲值", 120, 24, 180),
      itemLine("乙项", 150, 24, 80),
      itemLine("乙值", 150, 24, 180),
    ]]);
    const candidate = snapshot("candidate", [[
      itemLine("甲项", 120, 24, 79),
      itemLine("甲值", 120, 24, 177.5),
      itemLine("乙项", 150, 24, 79),
      itemLine("乙值", 150, 24, 177.5),
    ]]);
    const results = comparePdfEditableParagraphLayouts(
      baseline,
      candidate,
      [
        expectation("甲项", { index: 0, ...group, tableRowIndex: 0, tableColumnIndex: 0 }),
        expectation("甲值", { index: 1, ...group, tableRowIndex: 0, tableColumnIndex: 1 }),
        expectation("乙项", { index: 2, ...group, tableRowIndex: 1, tableColumnIndex: 0 }),
        expectation("乙值", { index: 3, ...group, tableRowIndex: 1, tableColumnIndex: 1 }),
      ],
    );

    expect(results.map((result) => result.status)).toEqual([
      "passed",
      "passed",
      "passed",
      "passed",
    ]);
  });
});
