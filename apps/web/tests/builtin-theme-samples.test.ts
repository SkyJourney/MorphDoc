import { describe, expect, it } from "vitest";
import {
  builtinThemeSamples,
  getBuiltinThemeSample
} from "../src/builtin-theme-samples";

const expectedThemeIds = [
  "enterprise-red-simple",
  "formal-feasibility",
  "formal-regulation",
  "formal-report",
  "gov-red-letter",
  "gov-red-standard",
  "red-briefing",
  "tender-blind",
  "tender-business-blue",
  "tender-classic",
  "typora-github",
  "typora-like",
  "typora-pixyll",
  "typora-whitey"
];

describe("内置主题示例", () => {
  it("为全部内置主题注册同名 Markdown 文件", () => {
    expect(
      builtinThemeSamples.map((sample) => sample.themeId).sort()
    ).toEqual(expectedThemeIds);
    expect(
      builtinThemeSamples.every(
        (sample) => sample.fileName === `${sample.themeId}.md`
      )
    ).toBe(true);
  });

  it("提供可直接编辑的非空 Markdown 内容", () => {
    for (const sample of builtinThemeSamples) {
      expect(sample.markdown.startsWith("---")).toBe(true);
      expect(sample.markdown.length).toBeGreaterThan(300);
      expect(getBuiltinThemeSample(sample.themeId)).toBe(sample);
    }
    expect(getBuiltinThemeSample("unknown-theme")).toBeUndefined();
  });
});
