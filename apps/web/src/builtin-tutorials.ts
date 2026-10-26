const tutorialModules = import.meta.glob<string>(
  "../../../samples/tutorials/*.md",
  {
    eager: true,
    query: "?raw",
    import: "default"
  }
);

export interface BuiltinTutorial {
  id: string;
  name: string;
  fileName: string;
  themeId: string;
  markdown: string;
}

const tutorialDefinitions = [
  {
    id: "echarts-tutorial",
    name: "ECharts 图表教程",
    themeId: "typora-github"
  },
  {
    id: "formal-document-tutorial",
    name: "公文主题使用教程",
    themeId: "typora-github"
  }
] as const;

const tutorialMarkdownById = new Map(
  Object.entries(tutorialModules).map(([modulePath, markdown]) => {
    const fileName = modulePath.split("/").at(-1) ?? "";
    return [fileName.replace(/\.md$/i, ""), markdown];
  })
);

export const builtinTutorials: BuiltinTutorial[] =
  tutorialDefinitions.map((definition) => {
    const markdown = tutorialMarkdownById.get(definition.id);
    if (!markdown) {
      throw new Error(`缺少内置教程：${definition.id}.md`);
    }
    return {
      ...definition,
      fileName: `${definition.id}.md`,
      markdown
    };
  });
