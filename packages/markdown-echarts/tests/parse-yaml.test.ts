import { describe, expect, it } from "vitest";
import {
  EChartsFenceError,
  parseEChartsFence
} from "../src/index.js";

const validSource = `
version: 1
height: 90mm
theme: document
caption: 年度趋势
option:
  dataset:
    source:
      - [year, sales]
      - [2023, 120]
      - [2024, 180]
  xAxis:
    type: category
  yAxis:
    type: value
  series:
    - type: line
      encode:
        x: year
        y: sales
`;

describe("parseEChartsFence", () => {
  it("解析并规范化有效协议", () => {
    expect(parseEChartsFence(validSource)).toEqual({
      version: 1,
      height: "90mm",
      theme: "document",
      caption: "年度趋势",
      option: {
        dataset: {
          source: [
            ["year", "sales"],
            [2023, 120],
            [2024, 180]
          ]
        },
        xAxis: {
          type: "category"
        },
        yAxis: {
          type: "value"
        },
        series: [
          {
            type: "line",
            encode: {
              x: "year",
              y: "sales"
            }
          }
        ]
      }
    });
  });

  it("补充协议版本、尺寸和直角坐标轴默认值", () => {
    expect(
      parseEChartsFence(`
option:
  series:
    - type: line
      data: [12, 18, 26]
`)
    ).toEqual({
      version: 1,
      height: "80mm",
      theme: "document",
      option: {
        xAxis: {},
        yAxis: {},
        series: [
          {
            type: "line",
            data: [12, 18, 26]
          }
        ]
      }
    });
  });

  it("拒绝 YAML 锚点和别名", () => {
    expect(() =>
      parseEChartsFence(`
version: 1
height: 80mm
option:
  series: &series
    - type: line
  color: *series
`)
    ).toThrow(EChartsFenceError);
  });

  it("拒绝显式 YAML 标签", () => {
    expect(() =>
      parseEChartsFence(`
version: 1
height: 80mm
option:
  series:
    - type: !!str line
`)
    ).toThrow(/不允许使用显式标签/u);
  });
});
