import { describe, expect, it } from "vitest";
import type { ThemeSummary } from "../src/application-backend";
import { groupThemesByCategory } from "../src/theme-groups";

function createTheme(
  id: string,
  name: string,
  category: ThemeSummary["category"]
): ThemeSummary {
  return {
    id,
    name,
    category,
    version: "1.0.0",
    description: "",
    compatibleProfiles: [],
    bundled: true,
    source: "bundled"
  };
}

describe("groupThemesByCategory", () => {
  it("按稳定顺序输出非空主题分组", () => {
    const groups = groupThemesByCategory([
      createTheme("tender", "标书", "tender"),
      createTheme("general", "通用", "general"),
      createTheme("red", "红头", "red-letter")
    ]);

    expect(groups.map(({ category, label }) => ({ category, label })))
      .toEqual([
        { category: "general", label: "通用主题" },
        { category: "red-letter", label: "政企红头" },
        { category: "tender", label: "标书正式" }
      ]);
    expect(groups[0]?.themes[0]?.id).toBe("general");
  });
});
