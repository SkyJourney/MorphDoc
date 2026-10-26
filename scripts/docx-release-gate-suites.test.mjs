import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { writeDocxCorpusFixture } from "./docx-corpus-fixture.mjs";
import {
  createDocxReleaseGateSuites,
  isSuiteAggregatePassed,
  resolveDocxReleaseGateSuite,
  summarizeSuiteProgress,
  writeJsonAtomic
} from "./docx-release-gate-suites.mjs";

const repositoryDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "morphdoc-gate-"));
after(() => {
  fs.rmSync(fixtureDirectory, { recursive: true, force: true });
});
const fixtureCorpus = writeDocxCorpusFixture(fixtureDirectory);

function passedAggregate(suite) {
  return {
    suite: { id: suite.id },
    execution: {
      expectedCaseCount: 140,
      completedCaseCount: 140,
      passedCaseCount: 140
    },
    gatePassed: true
  };
}

test("发布门禁拆分为四套独立 140 且真实文档按字节升序", () => {
  const suites = createDocxReleaseGateSuites(repositoryDirectory, fixtureCorpus);
  assert.equal(suites.length, 4);
  assert.equal(suites[0].id, "synthetic-baseline-140");
  assert.ok(suites.every((suite) => suite.expectedCaseCount === 140));
  assert.deepEqual(
    suites.slice(1).map((suite) => suite.markdownByteLength),
    suites.slice(1).map((suite) => suite.markdownByteLength).toSorted((a, b) => a - b)
  );
  assert.ok(suites.slice(1).every((suite) => suite.outputDirectoryName.includes(String(suite.markdownByteLength))));
});

test("next 严格遵守合成基线和真实文档大小顺序", () => {
  const suites = createDocxReleaseGateSuites(repositoryDirectory, fixtureCorpus);
  const aggregates = new Map();
  assert.equal(resolveDocxReleaseGateSuite({ suites, requestedId: "next", aggregates }).id, suites[0].id);
  aggregates.set(suites[0].id, passedAggregate(suites[0]));
  assert.equal(resolveDocxReleaseGateSuite({ suites, requestedId: "next", aggregates }).id, suites[1].id);
  assert.throws(
    () => resolveDocxReleaseGateSuite({ suites, requestedId: suites[2].id, aggregates }),
    /必须先通过前置套件/u
  );
  for (const suite of suites) {
    aggregates.set(suite.id, passedAggregate(suite));
  }
  assert.equal(resolveDocxReleaseGateSuite({ suites, requestedId: "next", aggregates }), undefined);
});

test("只有显式指定套件时才允许受控越过前置门禁", () => {
  const suites = createDocxReleaseGateSuites(repositoryDirectory, fixtureCorpus);
  const aggregates = new Map();
  assert.equal(
    resolveDocxReleaseGateSuite({
      suites,
      requestedId: suites[3].id,
      aggregates,
      allowOutOfOrder: true
    }).id,
    suites[3].id
  );
  assert.equal(
    resolveDocxReleaseGateSuite({
      suites,
      requestedId: "next",
      aggregates,
      allowOutOfOrder: true
    }).id,
    suites[0].id
  );
});

test("套件进度独立统计通过、门禁失败和基础设施错误", () => {
  const suite = createDocxReleaseGateSuites(repositoryDirectory, fixtureCorpus)[0];
  const records = {
    [suite.caseIds[0]]: { fingerprint: "same", status: "passed" },
    [suite.caseIds[1]]: { fingerprint: "same", status: "gate-failed" },
    [suite.caseIds[2]]: { fingerprint: "same", status: "error" },
    [suite.caseIds[3]]: { fingerprint: "old", status: "passed" }
  };
  const progress = summarizeSuiteProgress({ suite, fingerprint: "same", records });
  assert.deepEqual(progress, {
    expectedCaseCount: 140,
    completedCaseCount: 3,
    pendingCaseCount: 137,
    passedCaseCount: 1,
    gateFailedCaseCount: 1,
    errorCaseCount: 1,
    complete: false,
    gatePassed: false
  });
  assert.equal(isSuiteAggregatePassed({ suite: { id: suite.id }, execution: progress, gatePassed: false }, suite), false);
});

test("Windows 瞬时文件锁不会中断原子进度写入", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "morphdoc-gate-atomic-"));
  const filePath = path.join(directory, "progress.json");
  let attempts = 0;
  try {
    writeJsonAtomic(filePath, { completed: 9 }, {
      rename(source, destination) {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error("temporary Windows lock");
          error.code = "EPERM";
          throw error;
        }
        fs.renameSync(source, destination);
      },
      sleep() {}
    });
    assert.equal(attempts, 3);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(filePath, "utf8")),
      { completed: 9 }
    );
    assert.deepEqual(
      fs.readdirSync(directory).filter((name) => name.endsWith(".tmp")),
      []
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
