import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  createDocxLayoutVisualMatrixCases,
  readBundledThemeMatrixDefinitions
} from "./docx-layout-visual-matrix-cases.mjs";
import {
  DOCX_REAL_WORLD_CORPUS,
  validateDocxRealWorldCorpus
} from "./docx-real-world-corpus.mjs";

export const DOCX_RELEASE_GATE_CASE_COUNT = 140;
export const DOCX_RELEASE_GATE_SCHEMA_VERSION = 2;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function createDocxReleaseGateSuites(
  repositoryDirectory,
  corpus = DOCX_REAL_WORLD_CORPUS
) {
  const validation = validateDocxRealWorldCorpus(repositoryDirectory, corpus);
  assert(
    validation.failures.length === 0,
    `真实语料无效：${validation.failures.join("；")}`
  );
  const themes = readBundledThemeMatrixDefinitions(
    path.join(repositoryDirectory, "themes")
  );
  const cases = createDocxLayoutVisualMatrixCases(themes);
  assert(
    cases.length === DOCX_RELEASE_GATE_CASE_COUNT,
    `单套矩阵应为 ${DOCX_RELEASE_GATE_CASE_COUNT}，实际 ${cases.length}`
  );
  const caseIds = cases.map((entry) => entry.id);
  return [
    {
      id: "synthetic-baseline-140",
      label: "标准合成基线 140",
      kind: "synthetic",
      order: 0,
      outputDirectoryName: "synthetic-baseline-140",
      expectedCaseCount: caseIds.length,
      caseIds
    },
    ...validation.corpus.map((entry, index) => ({
      id: entry.id,
      label: `${entry.label}（${entry.byteLength} bytes）`,
      kind: "corpus",
      order: index + 1,
      outputDirectoryName:
        `corpus-${String(index + 1).padStart(2, "0")}-${entry.byteLength}-${entry.id}`,
      expectedCaseCount: caseIds.length,
      caseIds,
      markdownPath: entry.markdownPath,
      absoluteMarkdownPath: entry.absoluteMarkdownPath,
      markdownByteLength: entry.byteLength,
      requiredFeatures: entry.requiredFeatures
    }))
  ];
}

export function isSuiteAggregatePassed(aggregate, suite) {
  return Boolean(
    aggregate &&
    aggregate.suite?.id === suite.id &&
    aggregate.execution?.expectedCaseCount === suite.expectedCaseCount &&
    aggregate.execution?.completedCaseCount === suite.expectedCaseCount &&
    aggregate.execution?.passedCaseCount === suite.expectedCaseCount &&
    aggregate.gatePassed === true
  );
}

export function resolveDocxReleaseGateSuite({
  suites,
  requestedId,
  aggregates,
  allowOutOfOrder = false
}) {
  assert(Array.isArray(suites) && suites.length === 4, "发布门禁必须包含四套独立矩阵");
  const target = !requestedId || requestedId === "next"
    ? suites.find((suite) => !isSuiteAggregatePassed(aggregates.get(suite.id), suite))
    : suites.find((suite) => suite.id === requestedId);
  if (!target) {
    if (!requestedId || requestedId === "next") {
      return undefined;
    }
    throw new Error(`未知发布门禁套件：${requestedId}`);
  }
  if (!allowOutOfOrder || !requestedId || requestedId === "next") {
    const unmetPrerequisite = suites
      .slice(0, target.order)
      .find((suite) => !isSuiteAggregatePassed(aggregates.get(suite.id), suite));
    assert(
      !unmetPrerequisite,
      `必须先通过前置套件 ${unmetPrerequisite?.id}`
    );
  }
  return target;
}

function collectFingerprintFiles(repositoryDirectory, suite) {
  const roots = [
    "themes",
    "apps/server/scripts",
    "apps/server/src",
    "packages/application/src",
    "packages/core/src",
    "packages/document-visual-diff/src",
    "packages/docx-engine/assets",
    "packages/docx-engine/src",
    "packages/preview-engine/src",
    "packages/renderer/src"
  ];
  const files = [
    "pnpm-lock.yaml",
    "scripts/docx-layout-visual-matrix-cases.mjs",
    "scripts/docx-real-world-corpus.mjs",
    "scripts/docx-release-gate-suites.mjs",
    "scripts/verify-docx-layout-visual-matrix.mjs",
    "scripts/verify-docx-release-gate-suite.mjs"
  ];
  const allowedExtension = /\.(?:css|js|json|lua|mjs|ts)$/iu;
  const visit = (relativeDirectory) => {
    const absoluteDirectory = path.join(repositoryDirectory, relativeDirectory);
    if (!fs.existsSync(absoluteDirectory)) {
      return;
    }
    for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(relativePath);
      } else if (allowedExtension.test(entry.name)) {
        files.push(relativePath);
      }
    }
  };
  for (const root of roots) {
    visit(root);
  }
  if (suite.markdownPath) {
    files.push(suite.markdownPath);
  }
  return [...new Set(files)].sort((left, right) => left.localeCompare(right, "en"));
}

export function createDocxReleaseGateFingerprint(repositoryDirectory, suite) {
  const hash = crypto.createHash("sha256");
  hash.update(`schema:${DOCX_RELEASE_GATE_SCHEMA_VERSION}\n`);
  hash.update(`suite:${suite.id}\n`);
  for (const relativePath of collectFingerprintFiles(repositoryDirectory, suite)) {
    const absolutePath = path.join(repositoryDirectory, relativePath);
    if (!fs.existsSync(absolutePath)) {
      hash.update(`${relativePath}:missing\n`);
      continue;
    }
    hash.update(`${relativePath}\0`);
    hash.update(fs.readFileSync(absolutePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

const WINDOWS_RENAME_RETRY_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);

function sleepSync(milliseconds) {
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
    0,
    0,
    milliseconds
  );
}

export function writeJsonAtomic(filePath, value, options = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  const rename = options.rename ?? fs.renameSync;
  const sleep = options.sleep ?? sleepSync;
  const retryDeadline = Date.now() + (options.retryWindowMs ?? 3_000);
  let attempt = 0;
  while (true) {
    try {
      rename(temporaryPath, filePath);
      return;
    } catch (error) {
      if (
        !WINDOWS_RENAME_RETRY_CODES.has(error?.code) ||
        Date.now() >= retryDeadline
      ) {
        fs.rmSync(temporaryPath, { force: true });
        throw error;
      }
      attempt += 1;
      sleep(Math.min(100, 10 * attempt));
    }
  }
}

export function summarizeSuiteProgress({ suite, fingerprint, records }) {
  const currentRecords = suite.caseIds
    .map((caseId) => records[caseId])
    .filter((record) => record?.fingerprint === fingerprint);
  const passedCaseCount = currentRecords.filter((record) => record.status === "passed").length;
  const gateFailedCaseCount = currentRecords.filter((record) => record.status === "gate-failed").length;
  const errorCaseCount = currentRecords.filter((record) => record.status === "error").length;
  const completedCaseCount = currentRecords.length;
  return {
    expectedCaseCount: suite.expectedCaseCount,
    completedCaseCount,
    pendingCaseCount: suite.expectedCaseCount - completedCaseCount,
    passedCaseCount,
    gateFailedCaseCount,
    errorCaseCount,
    complete: completedCaseCount === suite.expectedCaseCount,
    gatePassed:
      passedCaseCount === suite.expectedCaseCount &&
      gateFailedCaseCount === 0 &&
      errorCaseCount === 0
  };
}
