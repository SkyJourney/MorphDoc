import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import { writeDocxCorpusFixture } from "./docx-corpus-fixture.mjs";
import {
  sortDocxRealWorldCorpusBySize,
  summarizeDocxReleaseGateMatrix,
  validateDocxRealWorldCorpus
} from "./docx-real-world-corpus.mjs";

const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "morphdoc-corpus-"));
after(() => {
  fs.rmSync(fixtureDirectory, { recursive: true, force: true });
});

const fixtureCorpus = writeDocxCorpusFixture(fixtureDirectory);

test("合成语料满足必需特征探针", () => {
  const validation = validateDocxRealWorldCorpus(fixtureDirectory, fixtureCorpus);
  assert.deepEqual(validation.failures, []);
  assert.equal(validation.corpus.length, 3);
  assert.equal(new Set(fixtureCorpus.map((entry) => entry.id)).size, 3);
});

test("缺少探针或文件时报告具体失败项", () => {
  const brokenCorpus = [
    {
      id: "missing-file",
      label: "不存在的文件",
      markdownPath: path.join(fixtureDirectory, "fixtures", "does-not-exist.md"),
      requiredFeatures: ["mermaid"]
    }
  ];
  const validation = validateDocxRealWorldCorpus(fixtureDirectory, brokenCorpus);
  assert.equal(validation.failures.length, 1);
  assert.match(validation.failures[0], /missing-file 缺少 Markdown/u);
  const emptyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "morphdoc-corpus-empty-"));
  try {
    const invalidJson = path.join(emptyDirectory, "inline.md");
    fs.writeFileSync(invalidJson, "```json\n{\n\"a\": 1\n}\n```\n", "utf8");
    const result = validateDocxRealWorldCorpus(emptyDirectory, [
      {
        id: "flat-json",
        label: "无缩进 JSON",
        markdownPath: invalidJson,
        requiredFeatures: ["json-code-indentation"]
      }
    ]);
    assert.deepEqual(result.failures, ["flat-json 缺少带缩进的 JSON 围栏探针"]);
  } finally {
    fs.rmSync(emptyDirectory, { recursive: true, force: true });
  }
});

test("语料按文件字节数稳定升序执行", () => {
  const corpus = sortDocxRealWorldCorpusBySize(fixtureDirectory, fixtureCorpus);
  assert.deepEqual(
    corpus.map((entry) => entry.byteLength),
    corpus.map((entry) => entry.byteLength).toSorted((a, b) => a - b)
  );
  assert.ok(corpus.every((entry) => entry.byteLength > 0));
});

test("发布门禁矩阵按语料数量聚合", () => {
  assert.deepEqual(
    summarizeDocxReleaseGateMatrix({
      baselineCaseCount: 140,
      corpusCaseCounts: Object.fromEntries(
        fixtureCorpus.map((entry) => [entry.id, 140])
      )
    }),
    {
      baselineCaseCount: 140,
      corpusDocumentCount: 3,
      corpusCaseCounts: {
        "fixture-inline-table": 140,
        "fixture-json-indent": 140,
        "fixture-long-mermaid": 140
      },
      corpusCaseCount: 420,
      totalCaseCount: 560
    }
  );
});
