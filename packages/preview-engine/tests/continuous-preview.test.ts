// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  findCommonPrefixLength,
  mountContinuousRenderStage
} from "../src/continuous-preview.js";

describe("连续预览增量边界", () => {
  it("从首个变化块开始替换后缀", () => {
    expect(
      findCommonPrefixLength(
        ["标题", "段落 A", "图表", "结尾"],
        ["标题", "段落 A", "新图表", "新结尾"]
      )
    ).toBe(2);
  });

  it("处理新增、删除和完全相同的文档", () => {
    expect(findCommonPrefixLength(["A"], ["A", "B"])).toBe(1);
    expect(findCommonPrefixLength(["A", "B"], ["A"])).toBe(1);
    expect(findCommonPrefixLength(["A", "B"], ["A", "B"])).toBe(2);
    expect(findCommonPrefixLength(["A"], ["B"])).toBe(0);
  });

  it("将变化后缀挂载到真实 DOM 测量且提交时不保留包装层", () => {
    const root = document.createElement("div");
    const article = document.createElement("article");
    article.id = "write";
    article.className = "theme-document";
    const suffix = document.createDocumentFragment();
    const heading = document.createElement("h2");
    heading.textContent = "图表";
    const chart = document.createElement("figure");
    chart.className = "md-echarts";
    suffix.append(heading, chart);
    document.body.append(root);

    const stage = mountContinuousRenderStage(
      root,
      article,
      suffix
    );

    expect(stage.article.isConnected).toBe(true);
    expect(stage.article.parentElement).toBe(root);
    expect(stage.article.id).toBe("write");
    expect(stage.article.className).toBe("theme-document");
    expect(stage.article.dataset.continuousRenderStage).toBe("true");
    expect(Array.from(stage.article.children)).toEqual([
      heading,
      chart
    ]);

    const rendered = stage.takeContent();
    expect(Array.from(rendered.children)).toEqual([heading, chart]);
    expect(stage.article.childNodes).toHaveLength(0);

    stage.dispose();
    expect(stage.article.isConnected).toBe(false);
    expect(root.childNodes).toHaveLength(0);
  });
});
