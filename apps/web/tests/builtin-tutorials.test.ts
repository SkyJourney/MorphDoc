import { describe, expect, it } from "vitest";
import { builtinTutorials } from "../src/builtin-tutorials";

describe("内置教程", () => {
  it("注册 ECharts 与公文主题教程", () => {
    expect(
      builtinTutorials.map(({ id, name, themeId, fileName }) => ({
        id,
        name,
        themeId,
        fileName
      }))
    ).toEqual([
      {
        id: "echarts-tutorial",
        name: "ECharts 图表教程",
        themeId: "typora-github",
        fileName: "echarts-tutorial.md"
      },
      {
        id: "formal-document-tutorial",
        name: "公文主题使用教程",
        themeId: "typora-github",
        fileName: "formal-document-tutorial.md"
      }
    ]);
  });

  it("教程内容完整且能够直接作为 Markdown 打开", () => {
    for (const tutorial of builtinTutorials) {
      expect(tutorial.markdown.startsWith("---")).toBe(true);
      expect(tutorial.markdown.length).toBeGreaterThan(1_000);
    }
    expect(builtinTutorials[0].markdown).toContain("```echarts");
    expect(builtinTutorials[1].markdown).toContain(
      "document.profile: official"
    );
  });
});
