import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import {
  createDocxReleaseGateFingerprint,
  createDocxReleaseGateSuites,
  DOCX_RELEASE_GATE_SCHEMA_VERSION,
  readJsonIfExists,
  resolveDocxReleaseGateSuite,
  summarizeSuiteProgress,
  writeJsonAtomic
} from "./docx-release-gate-suites.mjs";

const execFileAsync = promisify(execFile);
const repositoryDirectory = path.resolve(import.meta.dirname, "..");
const matrixScript = path.join(repositoryDirectory, "scripts", "verify-docx-layout-visual-matrix.mjs");
const repositoryVersion = JSON.parse(
  fs.readFileSync(path.join(repositoryDirectory, "package.json"), "utf8")
).version;
const outputRoot = path.resolve(
  repositoryDirectory,
  process.env.MORPHDOC_RELEASE_GATE_OUTPUT_DIR?.trim() ||
    path.join("output", "docx-release-gate", `v${repositoryVersion}`)
);
const requestedSuiteId = process.env.MORPHDOC_RELEASE_GATE_SUITE?.trim() || "next";
const selectedCaseId = process.env.MORPHDOC_RELEASE_GATE_CASE?.trim() || undefined;
const allowOutOfOrder =
  process.env.MORPHDOC_RELEASE_GATE_ALLOW_OUT_OF_ORDER?.trim() === "1";
const requestedCaseLimitText =
  process.env.MORPHDOC_RELEASE_GATE_CASE_LIMIT?.trim() || undefined;
const requestedCaseLimit = requestedCaseLimitText
  ? Number.parseInt(requestedCaseLimitText, 10)
  : undefined;
if (
  requestedCaseLimitText &&
  (!Number.isInteger(requestedCaseLimit) || requestedCaseLimit <= 0)
) {
  throw new Error("MORPHDOC_RELEASE_GATE_CASE_LIMIT 必须是正整数");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function readAggregates(suites) {
  return new Map(suites.map((suite) => {
    const aggregate = readJsonIfExists(
      path.join(outputRoot, suite.outputDirectoryName, "aggregate.json")
    );
    const currentFingerprint = createDocxReleaseGateFingerprint(
      repositoryDirectory,
      suite
    );
    return [
      suite.id,
      aggregate?.fingerprint === currentFingerprint ? aggregate : undefined
    ];
  }));
}

function renderSuiteHtml(aggregate) {
  const rows = aggregate.cases.map((entry) =>
    `<tr><td>${escapeHtml(entry.caseId)}</td><td class="${escapeHtml(entry.status)}">${escapeHtml(entry.status)}</td><td>${escapeHtml(entry.finishedAt || "")}</td><td>${entry.summaryPath ? `<a href="${escapeHtml(entry.summaryPath)}">JSON</a>` : "-"}</td><td>${escapeHtml(entry.error || entry.gateFailures?.join("；") || "")}</td></tr>`
  ).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(aggregate.suite.label)}</title><style>body{font-family:Inter,"Microsoft YaHei",sans-serif;margin:32px;color:#172033}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d0d5dd;padding:8px;text-align:left;vertical-align:top}.passed{background:#e6f7ec}.gate-failed,.error{background:#ffe4e4}</style></head><body><h1>${escapeHtml(aggregate.suite.label)}</h1><p>${aggregate.execution.completedCaseCount}/${aggregate.execution.expectedCaseCount}；通过 ${aggregate.execution.passedCaseCount}；门禁失败 ${aggregate.execution.gateFailedCaseCount}；基础设施错误 ${aggregate.execution.errorCaseCount}。</p><table><thead><tr><th>场景</th><th>状态</th><th>完成时间</th><th>报告</th><th>问题</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function buildAggregate({ suite, fingerprint, records }) {
  const execution = summarizeSuiteProgress({ suite, fingerprint, records });
  return {
    schemaVersion: DOCX_RELEASE_GATE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    fingerprint,
    suite: {
      id: suite.id,
      label: suite.label,
      kind: suite.kind,
      order: suite.order,
      markdownPath: suite.markdownPath,
      markdownByteLength: suite.markdownByteLength
    },
    execution,
    gatePassed: execution.gatePassed,
    cases: suite.caseIds.map((caseId) => records[caseId])
      .filter((record) => record?.fingerprint === fingerprint)
  };
}

function writeSuiteReports({ suiteDirectory, suite, fingerprint, records }) {
  const aggregate = buildAggregate({ suite, fingerprint, records });
  writeJsonAtomic(path.join(suiteDirectory, "progress.json"), {
    schemaVersion: DOCX_RELEASE_GATE_SCHEMA_VERSION,
    updatedAt: aggregate.generatedAt,
    fingerprint,
    records
  });
  writeJsonAtomic(path.join(suiteDirectory, "aggregate.json"), aggregate);
  fs.writeFileSync(path.join(suiteDirectory, "aggregate.html"), renderSuiteHtml(aggregate), "utf8");
  return aggregate;
}

function writeTopLevelIndex(suites) {
  const entries = suites.map((suite) => ({
    suite: {
      id: suite.id,
      label: suite.label,
      kind: suite.kind,
      order: suite.order,
      outputDirectoryName: suite.outputDirectoryName,
      markdownByteLength: suite.markdownByteLength
    },
    aggregate: readJsonIfExists(path.join(outputRoot, suite.outputDirectoryName, "aggregate.json"))
  }));
  const index = {
    schemaVersion: DOCX_RELEASE_GATE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    strategy: "four-independent-140-suites",
    totalExpectedCaseCount: 560,
    entries
  };
  writeJsonAtomic(path.join(outputRoot, "index.json"), index);
  const rows = entries.map(({ suite, aggregate }) =>
    `<tr><td>${suite.order + 1}</td><td>${escapeHtml(suite.label)}</td><td>${aggregate?.execution?.completedCaseCount ?? 0}/140</td><td class="${aggregate?.gatePassed ? "passed" : "pending"}">${aggregate?.gatePassed ? "通过" : aggregate ? "未通过/未完成" : "未开始"}</td><td><a href="${escapeHtml(suite.outputDirectoryName)}/aggregate.html">报告</a></td></tr>`
  ).join("");
  fs.writeFileSync(path.join(outputRoot, "index.html"), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>DOCX 4×140 发布门禁</title><style>body{font-family:Inter,"Microsoft YaHei",sans-serif;margin:32px;color:#172033}table{border-collapse:collapse;min-width:900px}th,td{border:1px solid #d0d5dd;padding:10px;text-align:left}.passed{background:#e6f7ec}.pending{background:#fff4cc}</style></head><body><h1>DOCX 4×140 独立发布门禁</h1><p>先通过标准合成基线，再按 Markdown 字节数从小到大逐套执行。</p><table><thead><tr><th>顺序</th><th>套件</th><th>进度</th><th>状态</th><th>独立报告</th></tr></thead><tbody>${rows}</tbody></table></body></html>`, "utf8");
}

function parseChildSummary(stdout) {
  const text = Buffer.isBuffer(stdout) ? stdout.toString("utf8") : String(stdout || "");
  return JSON.parse(text.trim());
}

fs.mkdirSync(outputRoot, { recursive: true });
const suites = createDocxReleaseGateSuites(repositoryDirectory);
const suite = resolveDocxReleaseGateSuite({
  suites,
  requestedId: requestedSuiteId,
  aggregates: readAggregates(suites),
  allowOutOfOrder
});
if (!suite) {
  writeTopLevelIndex(suites);
  process.stdout.write("四套独立 140 门禁均已通过，无需重复执行。\n");
  process.exit(0);
}
if (selectedCaseId && !suite.caseIds.includes(selectedCaseId)) {
  throw new Error(`套件 ${suite.id} 不包含场景 ${selectedCaseId}`);
}

const suiteDirectory = path.join(outputRoot, suite.outputDirectoryName);
const logsDirectory = path.join(suiteDirectory, "logs");
fs.mkdirSync(logsDirectory, { recursive: true });
fs.writeFileSync(
  path.join(suiteDirectory, "night-run.pid"),
  `${process.pid}\n`,
  "utf8"
);
const fingerprint = createDocxReleaseGateFingerprint(repositoryDirectory, suite);
const previousProgress = readJsonIfExists(path.join(suiteDirectory, "progress.json"));
const records = previousProgress?.records && typeof previousProgress.records === "object"
  ? previousProgress.records
  : {};
const runStartedAt = new Date().toISOString();
const runPath = path.join(suiteDirectory, "run.json");
writeJsonAtomic(runPath, {
  schemaVersion: DOCX_RELEASE_GATE_SCHEMA_VERSION,
  pid: process.pid,
  processStartedAt: runStartedAt,
  command: process.argv,
  suiteId: suite.id,
  suiteFingerprint: fingerprint,
  allowOutOfOrder,
  ...(requestedCaseLimit ? { requestedCaseLimit } : {}),
  status: "running"
});

const requestedCaseIds = selectedCaseId
  ? [selectedCaseId]
  : requestedCaseLimit
    ? suite.caseIds.slice(0, requestedCaseLimit)
    : suite.caseIds;
for (const caseId of requestedCaseIds) {
  if (records[caseId]?.fingerprint === fingerprint && records[caseId]?.status === "passed") {
    process.stderr.write(`[DOCX gate ${suite.id}] ${caseId} 已通过，跳过\n`);
    continue;
  }
  process.stderr.write(`[DOCX gate ${suite.id}] 执行 ${caseId}\n`);
  const environment = {
    ...process.env,
    MORPHDOC_LAYOUT_VISUAL_CASE: caseId,
    MORPHDOC_LAYOUT_VISUAL_OUTPUT_DIR: suiteDirectory,
    MORPHDOC_LAYOUT_VISUAL_SCOPE: suite.kind === "synthetic" ? "full" : "corpus",
    MORPHDOC_R4_APPEND_INLINE_CODE_PROBES: suite.kind === "synthetic" ? "1" : "0"
  };
  if (suite.kind === "corpus") {
    environment.MORPHDOC_CORPUS_ID = suite.id;
    environment.MORPHDOC_R4_MARKDOWN_PATH = suite.markdownPath;
  } else {
    delete environment.MORPHDOC_CORPUS_ID;
    delete environment.MORPHDOC_R4_MARKDOWN_PATH;
  }
  const startedAt = new Date().toISOString();
  let record;
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [matrixScript], {
      cwd: repositoryDirectory,
      windowsHide: true,
      timeout: 24 * 60 * 60 * 1000,
      maxBuffer: 256 * 1024 * 1024,
      env: environment
    });
    fs.writeFileSync(path.join(logsDirectory, `${caseId}.stdout.log`), stdout, "utf8");
    fs.writeFileSync(path.join(logsDirectory, `${caseId}.stderr.log`), stderr, "utf8");
    const summary = parseChildSummary(stdout);
    record = {
      caseId,
      fingerprint,
      status: summary.gatePassed ? "passed" : "gate-failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      gateFailures: summary.gateFailures ?? [],
      summaryPath: `summary-${caseId}.json`,
      matrixPath: `matrix-${caseId}.html`
    };
  } catch (error) {
    const stdout = Buffer.isBuffer(error?.stdout) ? error.stdout.toString("utf8") : String(error?.stdout || "");
    const stderr = Buffer.isBuffer(error?.stderr) ? error.stderr.toString("utf8") : String(error?.stderr || "");
    fs.writeFileSync(path.join(logsDirectory, `${caseId}.stdout.log`), stdout, "utf8");
    fs.writeFileSync(path.join(logsDirectory, `${caseId}.stderr.log`), stderr || String(error?.stack || error), "utf8");
    try {
      const summary = parseChildSummary(stdout);
      record = {
        caseId,
        fingerprint,
        status: "gate-failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        gateFailures: summary.gateFailures ?? [String(error?.message || error)],
        summaryPath: `summary-${caseId}.json`,
        matrixPath: `matrix-${caseId}.html`
      };
    } catch {
      record = {
        caseId,
        fingerprint,
        status: "error",
        startedAt,
        finishedAt: new Date().toISOString(),
        error: String(error?.message || error)
      };
    }
  }
  records[caseId] = record;
  writeSuiteReports({ suiteDirectory, suite, fingerprint, records });
  writeTopLevelIndex(suites);
}

const aggregate = writeSuiteReports({ suiteDirectory, suite, fingerprint, records });
writeTopLevelIndex(suites);
writeJsonAtomic(runPath, {
  schemaVersion: DOCX_RELEASE_GATE_SCHEMA_VERSION,
  pid: process.pid,
  processStartedAt: runStartedAt,
  completedAt: new Date().toISOString(),
  command: process.argv,
  suiteId: suite.id,
  suiteFingerprint: fingerprint,
  status: aggregate.gatePassed ? "passed" : "completed-with-failures",
  execution: aggregate.execution
});
process.stdout.write(`${JSON.stringify(aggregate, null, 2)}\n`);
if (!selectedCaseId && !aggregate.gatePassed) {
  process.exitCode = 1;
}
