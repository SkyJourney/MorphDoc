import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// 真实语料清单只属于本机私有数据，公开仓库不包含任何真实文档的名称、路径或内容。
// 需要运行真实语料门禁时，在 scripts 目录放置未追踪的 docx-real-world-corpus.local.mjs，
// 并导出 DOCX_REAL_WORLD_CORPUS_ENTRIES 数组；该文件不存在时语料清单为空。
const localCorpusPath = fileURLToPath(
  new URL("./docx-real-world-corpus.local.mjs", import.meta.url)
);
const localCorpusEntries = fs.existsSync(localCorpusPath)
  ? (await import(pathToFileURL(localCorpusPath).href)).DOCX_REAL_WORLD_CORPUS_ENTRIES ?? []
  : [];

export const DOCX_REAL_WORLD_CORPUS = Object.freeze([...localCorpusEntries]);

export function resolveDocxRealWorldCorpus(
  repositoryDirectory,
  corpus = DOCX_REAL_WORLD_CORPUS
) {
  return corpus.map((entry) => ({
    ...entry,
    absoluteMarkdownPath: path.resolve(
      repositoryDirectory,
      entry.markdownPath
    ),
    byteLength: fs.existsSync(path.resolve(repositoryDirectory, entry.markdownPath))
      ? fs.statSync(path.resolve(repositoryDirectory, entry.markdownPath)).size
      : 0
  }));
}

export function sortDocxRealWorldCorpusBySize(
  repositoryDirectory,
  corpus = DOCX_REAL_WORLD_CORPUS
) {
  return resolveDocxRealWorldCorpus(repositoryDirectory, corpus).sort(
    (first, second) =>
      first.byteLength - second.byteLength ||
      first.id.localeCompare(second.id, "en")
  );
}

export function validateDocxRealWorldCorpus(
  repositoryDirectory,
  corpus = DOCX_REAL_WORLD_CORPUS
) {
  const sortedCorpus = sortDocxRealWorldCorpusBySize(repositoryDirectory, corpus);
  const failures = [];
  for (const entry of sortedCorpus) {
    if (!fs.existsSync(entry.absoluteMarkdownPath)) {
      failures.push(`${entry.id} 缺少 Markdown：${entry.markdownPath}`);
      continue;
    }
    const source = fs.readFileSync(entry.absoluteMarkdownPath, "utf8");
    if (!source.trim()) {
      failures.push(`${entry.id} Markdown 为空`);
    }
    if (
      entry.requiredFeatures.includes("json-code-indentation") &&
      !/```json\s*[\s\S]*?\n[\t ]+\S/gu.test(source)
    ) {
      failures.push(`${entry.id} 缺少带缩进的 JSON 围栏探针`);
    }
    if (
      entry.requiredFeatures.includes("inline-code") &&
      !/(^|[^`])`[^`\n]+`([^`]|$)/mu.test(source)
    ) {
      failures.push(`${entry.id} 缺少行内代码探针`);
    }
    if (
      entry.requiredFeatures.includes("table-math-alignment") &&
      !/^\|.*\$[^$]+\$.*\|/mu.test(source)
    ) {
      failures.push(`${entry.id} 缺少表格公式对齐探针`);
    }
  }
  return { corpus: sortedCorpus, failures };
}

export function summarizeDocxReleaseGateMatrix({
  baselineCaseCount,
  corpusCaseCounts
}) {
  const corpusCaseCount = Object.values(corpusCaseCounts).reduce(
    (sum, value) => sum + value,
    0
  );
  return {
    baselineCaseCount,
    corpusDocumentCount: Object.keys(corpusCaseCounts).length,
    corpusCaseCounts,
    corpusCaseCount,
    totalCaseCount: baselineCaseCount + corpusCaseCount
  };
}
