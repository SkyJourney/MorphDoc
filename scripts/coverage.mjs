#!/usr/bin/env node
/**
 * 覆盖率收集与阈值棘轮。
 *
 * 执行顺序直接取自根 package.json 的 test 脚本：按出现顺序遍历其中的
 * `--filter <包> run test|build` 步骤，`build` 原样执行，`test` 替换为带覆盖率的
 * vitest。这样包的构建顺序只有 test 脚本一处事实来源，不会与本脚本漂移。
 *
 * 用法：
 *   node scripts/coverage.mjs            运行覆盖率并与阈值比较，低于阈值则失败
 *   node scripts/coverage.mjs --update   运行后按"实测下浮 1 个百分点"抬高阈值（只升不降）
 *
 * 产物：coverage/<包名>/coverage-summary.json 与 coverage/summary.md（均被 Git 忽略）。
 * 阈值文件：coverage-thresholds.json（入库，由 --update 维护）。
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const thresholdsPath = join(repositoryRoot, "coverage-thresholds.json");
const metrics = ["lines", "statements", "functions", "branches"];

/**
 * 从 test 脚本中按顺序提取工作区包的 test/build 步骤。
 *
 * @param {string} testScript 根 package.json 的 scripts.test
 * @returns {{ pkg: string, command: "test" | "build" }[]} 有序步骤
 */
export function parseTestSteps(testScript) {
  return [...testScript.matchAll(/--filter (@morphdoc\/[a-z0-9-]+) run (test|build)/gu)].map(
    (match) => ({ pkg: match[1], command: match[2] })
  );
}

/**
 * 由实测值计算新阈值：下浮 1 个百分点并向下取整，且不低于已有阈值（棘轮）。
 *
 * @param {number} measured 实测百分比
 * @param {number | undefined} existing 已有阈值
 * @returns {number} 新阈值，范围 0～100
 */
export function nextThreshold(measured, existing) {
  const candidate = Math.max(0, Math.min(100, Math.floor(measured - 1)));
  return Math.max(candidate, existing ?? 0);
}

/**
 * 比较实测覆盖率与阈值。
 *
 * @param {Record<string, number>} measured 四项指标的实测百分比
 * @param {Record<string, number> | undefined} thresholds 对应阈值，缺失视为无要求
 * @returns {string[]} 未达标的指标描述，全部达标时为空数组
 */
export function findViolations(measured, thresholds) {
  const violations = [];
  for (const metric of metrics) {
    const required = thresholds?.[metric];
    if (required !== undefined && measured[metric] < required) {
      violations.push(`${metric} ${measured[metric].toFixed(2)}% < ${required}%`);
    }
  }
  return violations;
}

/** 包名去掉作用域，作为目录与阈值键。 */
export function shortName(pkg) {
  return pkg.replace(/^@morphdoc\//u, "");
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
      // Windows 下 pnpm 是 .cmd 包装脚本，需要经由 shell；参数均为本脚本生成的固定值
      shell: process.platform === "win32"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(
          new Error(
            `${command} ${args.join(" ")} 失败：${signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`}`
          )
        );
      }
    });
  });
}

function coverageArguments(pkg) {
  return [
    "--filter",
    pkg,
    "exec",
    "vitest",
    "run",
    "--coverage.enabled",
    "--coverage.provider=v8",
    `--coverage.reportsDirectory=${join(repositoryRoot, "coverage", shortName(pkg))}`,
    "--coverage.reporter=json-summary",
    "--coverage.reporter=text-summary",
    // vitest 4 不再默认统计未被测试加载的文件，必须显式声明纳入范围
    "--coverage.include=src/**/*.ts",
    "--coverage.include=src/**/*.tsx",
    "--coverage.exclude=**/*.test.*",
    "--coverage.exclude=**/*.d.ts",
    "--coverage.exclude=**/tests/**"
  ];
}

async function readSummary(pkg) {
  const path = join(repositoryRoot, "coverage", shortName(pkg), "coverage-summary.json");
  const total = JSON.parse(await readFile(path, "utf8")).total;
  return Object.fromEntries(metrics.map((metric) => [metric, total[metric].pct]));
}

function renderTable(rows) {
  const header = `| 包 | ${metrics.join(" | ")} |\n| --- | ${metrics.map(() => "---:").join(" | ")} |`;
  const body = rows.map(
    ({ name, measured }) =>
      `| ${name} | ${metrics.map((metric) => `${measured[metric].toFixed(2)}%`).join(" | ")} |`
  );
  return [header, ...body].join("\n");
}

async function main() {
  const update = process.argv.includes("--update");
  const manifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  const steps = parseTestSteps(manifest.scripts.test);
  if (steps.length === 0) {
    throw new Error("未能从 test 脚本中解析出任何包步骤");
  }

  const stored = existsSync(thresholdsPath)
    ? JSON.parse(await readFile(thresholdsPath, "utf8"))
    : { version: 1, packages: {} };
  const rows = [];
  const failures = [];

  for (const step of steps) {
    if (step.command === "build") {
      await run("pnpm", ["--filter", step.pkg, "run", "build"]);
      continue;
    }
    await run("pnpm", coverageArguments(step.pkg));
    const measured = await readSummary(step.pkg);
    rows.push({ name: shortName(step.pkg), measured });
    const violations = findViolations(measured, stored.packages[shortName(step.pkg)]);
    if (violations.length > 0) {
      failures.push(`${shortName(step.pkg)}：${violations.join("；")}`);
    }
  }

  const table = renderTable(rows);
  await mkdir(join(repositoryRoot, "coverage"), { recursive: true });
  await writeFile(join(repositoryRoot, "coverage", "summary.md"), `${table}\n`, "utf8");
  process.stdout.write(`\n${table}\n`);
  // 在 GitHub Actions 中同步写入作业摘要，便于在 PR 页面直接查看
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## 覆盖率\n\n${table}\n`);
  }

  if (update) {
    for (const { name, measured } of rows) {
      const previous = stored.packages[name] ?? {};
      stored.packages[name] = Object.fromEntries(
        metrics.map((metric) => [metric, nextThreshold(measured[metric], previous[metric])])
      );
    }
    await writeFile(thresholdsPath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
    process.stdout.write(`\n已更新 ${thresholdsPath}\n`);
    return;
  }

  if (failures.length > 0) {
    process.stderr.write(`\n覆盖率低于阈值：\n${failures.map((line) => `  - ${line}`).join("\n")}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
