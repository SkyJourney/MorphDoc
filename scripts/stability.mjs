#!/usr/bin/env node
/**
 * 测试稳定性检测：重复执行完整测试套件，找出"有时失败有时通过"的不稳定用例。
 *
 * 每次运行都保存完整日志，并从输出中提取失败项：
 *   - 每次都失败：确定性失败，通常是真实缺陷或环境问题；
 *   - 只在部分运行中失败：不稳定（flaky）用例，需要定位根因，禁止用重试掩盖。
 *
 * 用法：
 *   node scripts/stability.mjs              重复 5 次
 *   node scripts/stability.mjs --runs 10    重复 10 次（1～20）
 *
 * 日志写入 stability/run-<序号>.log（被 Git 忽略）。只要任意一次运行出现失败，
 * 脚本就以非零状态退出。
 */
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultRuns = 5;
const maximumRuns = 20;

/** 去除终端颜色控制序列，便于按行匹配。 */
function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/gu, "");
}

/**
 * 从一次完整测试输出中提取失败项名称。
 *
 * 同时识别 vitest 的 `FAIL <文件> > <用例>` 与 node:test 的 `not ok N - <名称>`；
 * 返回集合，同一失败在摘要中重复出现不会被重复计数。
 *
 * @param {string} output 一次运行的标准输出与标准错误
 * @returns {Set<string>} 失败项名称集合
 */
export function parseFailures(output) {
  const failures = new Set();
  for (const rawLine of stripAnsi(output).split(/\r?\n/u)) {
    const line = rawLine.trim();
    const vitest = /^FAIL\s+(.+?)(?:\s+\d+ms)?$/u.exec(line);
    if (vitest) {
      failures.add(vitest[1]);
      continue;
    }
    const nodeTest = /^not ok \d+ - (.+?)(?:\s+#.*)?$/u.exec(line);
    if (nodeTest) {
      failures.add(nodeTest[1]);
    }
  }
  return failures;
}

/**
 * 对多次运行的失败集合分类。
 *
 * @param {Set<string>[]} perRun 每次运行的失败项集合
 * @returns {{ flaky: Map<string, number>, consistent: Map<string, number> }}
 *   flaky 为只在部分运行失败的用例及失败次数；consistent 为每次都失败的用例
 */
export function classifyFailures(perRun) {
  const counts = new Map();
  for (const failures of perRun) {
    for (const name of failures) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const flaky = new Map();
  const consistent = new Map();
  for (const [name, count] of counts) {
    (count === perRun.length ? consistent : flaky).set(name, count);
  }
  return { flaky, consistent };
}

/**
 * 解析并校验 --runs 参数。
 *
 * @param {string[]} values 命令行参数
 * @returns {number} 重复次数
 * @throws {Error} 参数未知、缺少取值或超出 1～20 范围时抛出
 */
export function parseRuns(values) {
  let runs = defaultRuns;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== "--runs") {
      throw new Error(`未知参数：${values[index]}`);
    }
    const raw = values[index + 1];
    // 严格整数校验：该值可能来自 CI 的手动触发输入，不能容忍任何额外字符
    if (!/^\d+$/u.test(raw ?? "")) {
      throw new Error(`--runs 需要正整数，收到：${raw ?? "(缺失)"}`);
    }
    runs = Number(raw);
    index += 1;
  }
  if (runs < 1 || runs > maximumRuns) {
    throw new Error(`--runs 必须在 1～${maximumRuns} 之间，收到：${runs}`);
  }
  return runs;
}

function runTests() {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("pnpm", ["test"], {
      cwd: repositoryRoot,
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32"
    });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        output += chunk;
      });
    }
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise({ code: code ?? 1, output }));
  });
}

async function main() {
  const runs = parseRuns(process.argv.slice(2));
  const logDirectory = join(repositoryRoot, "stability");
  await mkdir(logDirectory, { recursive: true });

  const perRun = [];
  let nonZeroExits = 0;
  for (let index = 1; index <= runs; index += 1) {
    const startedAt = Date.now();
    const { code, output } = await runTests();
    await writeFile(join(logDirectory, `run-${index}.log`), output, "utf8");
    const failures = parseFailures(output);
    perRun.push(failures);
    if (code !== 0) {
      nonZeroExits += 1;
    }
    process.stdout.write(
      `第 ${index}/${runs} 次：${code === 0 ? "通过" : `失败（${failures.size} 项）`}，` +
        `${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`
    );
  }

  const { flaky, consistent } = classifyFailures(perRun);
  const lines = [
    `重复运行 ${runs} 次，${nonZeroExits} 次整体失败。`,
    `不稳定用例（部分运行失败）：${flaky.size}`,
    ...[...flaky].map(([name, count]) => `  - ${name}（${count}/${runs} 次失败）`),
    `确定性失败（每次都失败）：${consistent.size}`,
    ...[...consistent].map(([name]) => `  - ${name}`)
  ];
  process.stdout.write(`\n${lines.join("\n")}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## 测试稳定性\n\n\`\`\`text\n${lines.join("\n")}\n\`\`\`\n`);
  }
  if (nonZeroExits > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
