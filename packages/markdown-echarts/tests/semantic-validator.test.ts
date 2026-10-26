import { describe, expect, it } from "vitest";
import {
  normalizeAndValidateEChartsOption,
  validateAndApplyEChartsOptionDefaults
} from "../src/index.js";

function validate(option: Record<string, unknown>) {
  return validateAndApplyEChartsOptionDefaults(
    normalizeAndValidateEChartsOption(option)
  );
}

describe("ECharts 系列语义验证", () => {
  it("允许从 dataset.source 取数并补充坐标轴", () => {
    expect(
      validate({
        dataset: {
          source: [
            ["name", "value"],
            ["A", 12]
          ]
        },
        series: [{ type: "bar" }]
      })
    ).toMatchObject({
      xAxis: {},
      yAxis: {},
      series: [{ type: "bar" }]
    });
  });

  it("缺少所有数据来源时报告精确路径", () => {
    expect(() =>
      validate({
        series: [{ type: "line" }]
      })
    ).toThrow(
      /option\.series\.0\.data 必须是非空数组/u
    );
  });

  it("只有表头或空列的 dataset 不算有效数据", () => {
    expect(() =>
      validate({
        dataset: {
          source: [["name", "value"]]
        },
        series: [{ type: "bar" }]
      })
    ).toThrow(/必须是非空数组/u);

    expect(() =>
      validate({
        dataset: {
          source: {
            name: [],
            value: []
          }
        },
        series: [{ type: "bar" }]
      })
    ).toThrow(/必须是非空数组/u);
  });

  it("散点图要求二维坐标", () => {
    expect(() =>
      validate({
        series: [{ type: "scatter", data: [12] }]
      })
    ).toThrow(
      /option\.series\.0\.data\.0 必须是至少包含两个坐标值/u
    );
  });

  it("饼图要求有限数值", () => {
    expect(() =>
      validate({
        series: [
          {
            type: "pie",
            data: [{ name: "A", value: "12" }]
          }
        ]
      })
    ).toThrow(
      /option\.series\.0\.data\.0\.value 必须是有限数值/u
    );
  });

  it("雷达图要求指标并校验数据维数", () => {
    expect(() =>
      validate({
        series: [
          {
            type: "radar",
            data: [{ value: [12, 18] }]
          }
        ]
      })
    ).toThrow(/option\.radar\.indicator/u);

    expect(() =>
      validate({
        radar: {
          indicator: [
            { name: "质量" },
            { name: "速度" },
            { name: "成本" }
          ]
        },
        series: [
          {
            type: "radar",
            data: [{ value: [12, 18] }]
          }
        ]
      })
    ).toThrow(/至少包含 3 个指标值/u);
  });

  it("热力图区分直角坐标系与日历坐标系", () => {
    expect(
      validate({
        series: [
          {
            type: "heatmap",
            data: [[0, 1, 20]]
          }
        ]
      })
    ).toMatchObject({ xAxis: {}, yAxis: {} });

    expect(() =>
      validate({
        series: [
          {
            type: "heatmap",
            coordinateSystem: "calendar",
            data: [["2026-01-01", 20]]
          }
        ]
      })
    ).toThrow(/option\.calendar/u);
  });

  it("箱线图要求五数数据", () => {
    expect(() =>
      validate({
        series: [
          {
            type: "boxplot",
            data: [[1, 2, 3, 4]]
          }
        ]
      })
    ).toThrow(/五元数组/u);
  });

  it("K 线图要求 OHLC 四元数据", () => {
    expect(() =>
      validate({
        series: [
          {
            type: "candlestick",
            data: [[20, 18, 16]]
          }
        ]
      })
    ).toThrow(/四元数组/u);
  });

  it("极坐标折线图要求完整极坐标组件", () => {
    expect(() =>
      validate({
        series: [
          {
            type: "line",
            coordinateSystem: "polar",
            data: [[10, 20]]
          }
        ]
      })
    ).toThrow(/option\.polar/u);
  });

  it("支持树图并校验递归 children 结构", () => {
    expect(
      validate({
        series: [
          {
            type: "tree",
            data: [
              {
                name: "根节点",
                children: [{ name: "子节点" }]
              }
            ]
          }
        ]
      })
    ).toMatchObject({
      series: [{ type: "tree" }]
    });

    expect(() =>
      validate({
        series: [
          {
            type: "tree",
            data: [{ name: "根节点", children: "错误" }]
          }
        ]
      })
    ).toThrow(/data\.0\.children 必须是数组/u);
  });

  it("矩形树图和旭日图要求叶节点数值", () => {
    for (const type of ["treemap", "sunburst"]) {
      expect(
        validate({
          series: [
            {
              type,
              data: [
                {
                  name: "分类",
                  children: [{ name: "项目", value: 12 }]
                }
              ]
            }
          ]
        })
      ).toMatchObject({ series: [{ type }] });

      expect(() =>
        validate({
          series: [
            {
              type,
              data: [{ name: "无数值叶节点" }]
            }
          ]
        })
      ).toThrow(/data\.0\.value 必须是有限数值/u);
    }
  });

  it("关系图默认选择可渲染布局并校验边引用", () => {
    expect(
      validate({
        series: [
          {
            type: "graph",
            data: [{ name: "A" }, { name: "B" }],
            links: [{ source: "A", target: "B" }]
          }
        ]
      })
    ).toMatchObject({
      series: [{ type: "graph", layout: "force" }]
    });

    expect(
      validate({
        series: [
          {
            type: "graph",
            data: [
              { name: "A", x: 10, y: 20 },
              { name: "B", x: 30, y: 40 }
            ]
          }
        ]
      })
    ).toMatchObject({
      series: [{ type: "graph", layout: "none" }]
    });

    expect(() =>
      validate({
        series: [
          {
            type: "graph",
            nodes: [{ name: "A" }],
            edges: [{ source: "A", target: "B" }]
          }
        ]
      })
    ).toThrow(/edges\.0\.target 必须引用已存在的节点/u);
  });

  it("桑基图和和弦图要求有效节点、关系边和权重", () => {
    for (const type of ["sankey", "chord"]) {
      expect(
        validate({
          series: [
            {
              type,
              data: [{ name: "A" }, { name: "B" }],
              links: [
                { source: "A", target: "B", value: 12 }
              ]
            }
          ]
        })
      ).toMatchObject({ series: [{ type }] });

      expect(() =>
        validate({
          series: [
            {
              type,
              data: [{ name: "A" }, { name: "B" }],
              links: [{ source: "A", target: "B" }]
            }
          ]
        })
      ).toThrow(/links\.0\.value 必须是非负有限数值/u);
    }
  });

  it("漏斗图和仪表盘要求有限数值", () => {
    for (const type of ["funnel", "gauge"]) {
      expect(
        validate({
          series: [
            {
              type,
              data: [{ name: "完成率", value: 72 }]
            }
          ]
        })
      ).toMatchObject({ series: [{ type }] });

      expect(() =>
        validate({
          series: [
            {
              type,
              data: [{ name: "完成率", value: "72" }]
            }
          ]
        })
      ).toThrow(/data\.0\.value 必须是有限数值/u);
    }
  });

  it("象形柱图复用柱图数据和坐标轴默认值", () => {
    expect(
      validate({
        series: [
          {
            type: "pictorialBar",
            symbol: "path://M0,0 L10,0 L10,10 Z",
            data: [12, 18]
          }
        ]
      })
    ).toMatchObject({
      xAxis: {},
      yAxis: {},
      series: [{ type: "pictorialBar" }]
    });
  });
});
