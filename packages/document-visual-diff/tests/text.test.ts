import { describe, expect, it } from "vitest";

import {
  aggregatePdfTextLines,
  buildPageContentText,
  normalizePdfEditableText,
  normalizePdfText,
  type PdfTextItemSnapshot,
} from "../src/index.js";

function item(
  text: string,
  x: number,
  y: number,
  width = 20,
  height = 10,
): PdfTextItemSnapshot {
  return {
    text,
    normalizedText: normalizePdfText(text),
    bounds: { x, y, width, height },
    baselineY: y + height,
    hasEol: false,
  };
}

describe("PDF 文本行聚合", () => {
  it("按坐标聚合中文文本并规范化兼容字符", () => {
    const lines = aggregatePdfTextLines(
      [
        item("ＡＢＣ", 10, 100, 30),
        item("中文", 41, 100, 20),
        item("第二行", 10, 120, 40),
      ],
      842,
    );
    expect(lines.map((line) => line.normalizedText)).toEqual([
      "ABC中文",
      "第二行",
    ]);
  });

  it("合并 Office 同一视觉行内小于字体高度两成的基线漂移", () => {
    const left = item("源系统", 10, 100, 30, 10);
    const middle = item("nut_pickup_order.meal_type", 42, 101.8, 140, 10);
    const right = item("原值", 184, 100, 20, 10);
    const lines = aggregatePdfTextLines([left, middle, right], 842);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.normalizedText).toBe(
      "源系统nut_pickup_order.meal_type原值",
    );
  });

  it("将同行公式的上标片段按横坐标并回正文", () => {
    const lines = aggregatePdfTextLines(
      [
        item("减因子", 10, 100, 42, 12),
        item("e", 53, 97, 8, 15),
        item("−λΔt", 62, 96, 24, 10),
        item("的动态权重", 87, 100, 70, 12),
      ],
      842,
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]?.normalizedText).toBe("减因子e−λΔt的动态权重");
  });

  it("将超出正文右缘但紧邻行末的公式片段并回正文", () => {
    const lines = aggregatePdfTextLines(
      [
        item("性、记忆重要程度、时效性衰减权重（须支持基于时间衰减因子 e", 150, 469.5, 346, 12),
        item("−λΔt", 495.7, 466.1, 26, 10.2),
        item("下一视觉行", 150, 489.7, 60, 12),
      ],
      842,
    );

    expect(lines.map((line) => line.normalizedText)).toEqual([
      "性、记忆重要程度、时效性衰减权重(须支持基于时间衰减因子 e−λΔt",
      "下一视觉行",
    ]);
  });

  it("将字体 ToUnicode 中的传统户部件归一为简体字符", () => {
    expect(normalizePdfText("戶⼾")).toBe("户户");
    expect(normalizePdfText("⻅⻆⻓⻔⻚⻛⻝⻣⻋⻬")).toBe(
      "见角长门页风食骨车齐",
    );
  });

  it("统一 Chromium 与 Office PDF 文本层的中英文弯引号", () => {
    expect(normalizePdfText("“记录”与‘计算’")).toBe('"记录"与\'计算\'');
  });

  it("保留与全角括号重叠的窄引号文本流顺序", () => {
    const lines = aggregatePdfTextLines(
      [
        item("主观定性判断", 532.3, 151.5, 58.5),
        item("”", 590.8, 151.5, 3.4),
        item("（如", 589.3, 151.5, 19.5),
        item("“", 608.8, 151.5, 3.4),
        item("高心率占比", 612.2, 151.5, 48.8),
      ],
      595,
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]?.normalizedText).toBe('主观定性判断"(如"高心率占比');
  });

  it("忽略 Emoji 文本层可选的变体选择符", () => {
    expect(normalizePdfText("⚠️ 提示")).toBe("⚠ 提示");
  });

  it("统一 CJK 字体文本层的 em dash 与 horizontal bar", () => {
    expect(normalizePdfText("仓库―仓区")).toBe("仓库—仓区");
  });

  it("统一数字区间中被 Chromium 提取为双连字符的 en dash", () => {
    expect(normalizePdfText("10% -- 20%")).toBe("10%–20%");
    expect(normalizePdfText("10% --")).toBe("10%–");
    expect(normalizePdfText("命令 --flag")).toBe("命令 --flag");
  });

  it("从可编辑正文契约中移除 Word 自动列表装饰符", () => {
    expect(normalizePdfEditableText("• 项目一 ◦ 子项 ▪ 末项  WPS")).toBe(
      "项目一子项末项WPS"
    );
  });

  it("只在页眉页脚坐标带识别独立页码", () => {
    const lines = aggregatePdfTextLines(
      [
        item("章节 1", 72, 400, 50),
        item("— 1 —", 280, 731, 35, 14),
      ],
      842,
    );
    expect(lines.map((line) => line.role)).toEqual([
      "content",
      "page-number",
    ]);
    expect(buildPageContentText(lines)).toBe("章节 1");
  });

  it("不会把页脚中的普通说明误判为页码", () => {
    const lines = aggregatePdfTextLines(
      [item("内部资料 1", 72, 800, 70)],
      842,
    );
    expect(lines[0]?.role).toBe("content");
  });
});
