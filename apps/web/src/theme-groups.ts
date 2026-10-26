import type { ThemeCategory } from "@morphdoc/core";
import type { ThemeSummary } from "./application-backend";

const themeCategoryOrder: readonly ThemeCategory[] = [
  "general",
  "red-letter",
  "formal",
  "tender"
];

const themeCategoryLabels: Record<ThemeCategory, string> = {
  general: "通用主题",
  "red-letter": "政企红头",
  formal: "政企正式",
  tender: "标书正式"
};

export interface ThemeGroup {
  category: ThemeCategory;
  label: string;
  themes: ThemeSummary[];
}

export function groupThemesByCategory(
  themes: readonly ThemeSummary[]
): ThemeGroup[] {
  return themeCategoryOrder
    .map((category) => ({
      category,
      label: themeCategoryLabels[category],
      themes: themes.filter((theme) => theme.category === category)
    }))
    .filter((group) => group.themes.length > 0);
}
