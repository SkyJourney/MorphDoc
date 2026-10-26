import fs from "node:fs";
import path from "node:path";

// 合成样例语料：只用于验证门禁框架本身，内容由本文件生成，不包含任何真实文档。
const FIXTURE_DOCUMENTS = [
  {
    id: "fixture-inline-table",
    label: "合成样例：行内代码与表格公式",
    requiredFeatures: ["inline-code", "table-math-alignment"],
    markdown: "# 合成样例\n\n行内 `code` 示例。\n\n| 指标 | 公式 |\n| --- | --- |\n| 面积 | $S=\\pi r^2$ |\n"
  },
  {
    id: "fixture-json-indent",
    label: "合成样例：带缩进的 JSON 代码块",
    requiredFeatures: ["json-code-indentation"],
    codeIndentationProbe: {
      rootLine: "{",
      nestedLineIncludes: '"heart_rate_daily"',
      minimumIndentPt: 4
    },
    markdown: "# 合成样例\n\n```json\n{\n  \"heart_rate_daily\": 72\n}\n```\n"
  },
  {
    id: "fixture-long-mermaid",
    label: "合成样例：长文档与 Mermaid",
    requiredFeatures: ["mermaid", "long-document"],
    markdown: "# 合成样例\n\n```mermaid\nflowchart LR\n  A --> B\n```\n"
  }
];

// 在指定目录写入合成样例 Markdown，并返回绝对路径形式的语料条目。
export function writeDocxCorpusFixture(directory) {
  const fixtureDirectory = path.join(directory, "fixtures");
  fs.mkdirSync(fixtureDirectory, { recursive: true });
  return FIXTURE_DOCUMENTS.map(({ markdown, ...entry }) => {
    const absoluteMarkdownPath = path.join(fixtureDirectory, `${entry.id}.md`);
    fs.writeFileSync(absoluteMarkdownPath, markdown, "utf8");
    return { ...entry, markdownPath: absoluteMarkdownPath };
  });
}
