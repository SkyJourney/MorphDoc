import { describe, expect, it } from "vitest";
import {
  defaultEChartsSecurityLimits,
  normalizeAndValidateEChartsOption
} from "../src/index.js";

describe("normalizeAndValidateEChartsOption", () => {
  it("接受首版系列和内置数据转换", () => {
    const normalized = normalizeAndValidateEChartsOption({
        dataset: {
          source: [
            ["name", "value"],
            ["A", 1]
          ],
          transform: {
            type: "sort",
            config: {
              dimension: "value",
              order: "desc"
            }
          }
        },
        series: [
          {
            type: "bar",
            encode: {
              x: "name",
              y: "value"
            }
          }
        ]
      });

    expect(normalized).toMatchObject({
      series: [{ type: "bar" }]
    });
    expect(Object.getPrototypeOf(normalized)).toBe(
      Object.prototype
    );
    expect(normalized.hasOwnProperty("series")).toBe(true);
  });

  it("拒绝不支持的系列", () => {
    expect(() =>
      normalizeAndValidateEChartsOption({
        series: [{ type: "custom" }]
      })
    ).toThrow(/暂不支持 custom/u);
  });

  it("接受第二阶段系列和安全的内嵌矢量路径", () => {
    const types = [
      "tree",
      "treemap",
      "sunburst",
      "graph",
      "sankey",
      "chord",
      "funnel",
      "gauge",
      "pictorialBar"
    ];
    expect(
      normalizeAndValidateEChartsOption({
        series: types.map((type) => ({
          type,
          ...(type === "pictorialBar"
            ? { symbol: "path://M0,0 L10,0 L10,10 Z" }
            : {})
        }))
      }).series
    ).toHaveLength(types.length);
  });

  it("限制层级节点和关系边数量", () => {
    const limits = {
      ...defaultEChartsSecurityLimits,
      maxHierarchyNodes: 2,
      maxGraphEdges: 1
    };
    expect(() =>
      normalizeAndValidateEChartsOption(
        {
          series: [
            {
              type: "tree",
              data: [
                {
                  children: [{ value: 1 }, { value: 2 }]
                }
              ]
            }
          ]
        },
        limits
      )
    ).toThrow(/层级节点数量不能超过 2/u);

    expect(() =>
      normalizeAndValidateEChartsOption(
        {
          series: [
            {
              type: "graph",
              data: [{ name: "A" }, { name: "B" }],
              links: [
                { source: "A", target: "B" },
                { source: "B", target: "A" }
              ]
            }
          ]
        },
        limits
      )
    ).toThrow(/边数量不能超过 1/u);
  });

  it("拒绝外部资源和危险链接", () => {
    expect(() =>
      normalizeAndValidateEChartsOption({
        title: {
          text: "示例",
          subtext: "https://example.com/chart"
        },
        series: [{ type: "line" }]
      })
    ).toThrow(/危险 URL/u);
  });

  it("拒绝 HTML formatter", () => {
    expect(() =>
      normalizeAndValidateEChartsOption({
        tooltip: {
          formatter: "<img src=x onerror=alert(1)>"
        },
        series: [{ type: "line" }]
      })
    ).toThrow(/不含 HTML/u);
  });

  it("拒绝原型污染属性", () => {
    const option = JSON.parse(
      '{"series":[{"type":"line"}],"__proto__":{"polluted":true}}'
    );
    expect(() => normalizeAndValidateEChartsOption(option)).toThrow(
      /禁止属性/u
    );
  });
});
