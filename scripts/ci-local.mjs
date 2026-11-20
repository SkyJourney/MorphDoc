#!/usr/bin/env node
/**
 * 本地 CI 套件：在提交或推送前，按与 GitHub Actions 一致的顺序执行核心检查。
 *
 * 步骤依次为：空白检查、依赖安装、类型检查、单元测试、生产构建。
 * 任一步骤失败立即终止并以非零状态退出，便于接入 Git hook。
 *
 * 用法：
 *   node scripts/ci-local.mjs                 执行全部步骤
 *   node scripts/ci-local.mjs --skip=build    跳过指定步骤，多个以逗号分隔
 *   node scripts/ci-local.mjs --list          仅列出可用步骤
 *
 * 步骤标识：whitespace、install、typecheck、test、build。
 *
 * 脚本不假设固定 Shell：Windows 下 pnpm 是 .cmd 包装脚本，需要经由 shell 启动，
 * 其余平台直接启动；传给子进程的参数均为固定常量，不拼接外部输入。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 启动子进程并等待结束。
 *
 * @param {string} command 可执行文件名
 * @param {string[]} args 固定参数列表
 * @param {{ capture?: boolean }} [options] capture 为真时返回标准输出
 * @returns {Promise<string>} 去除首尾空白的标准输出（仅 capture 时有内容）
 * @throws {Error} 子进程以非零状态退出或无法启动时抛出
 */
function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
      windowsHide: true,
      shell: process.platform === "win32" && command === "pnpm"
    });
    let stdout = "";
    if (options.capture) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise(stdout.trim());
      } else {
        reject(
          new Error(
            `${command} ${args.join(" ")} 执行失败：${signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`}`
          )
        );
      }
    });
  });
}

/**
 * 空白检查：与 CI 一致，以与 origin/main 的共同祖先为基线，
 * 覆盖已提交和尚未提交的已跟踪文件改动。
 * 本地没有 origin/main 时退化为只检查工作区相对 HEAD 的改动。
 */
async function checkWhitespace() {
  let base = "HEAD";
  try {
    base = await run("git", ["merge-base", "origin/main", "HEAD"], { capture: true });
  } catch {
    process.stdout.write("未找到 origin/main，仅检查工作区相对 HEAD 的改动。\n");
  }
  await run("git", ["diff", "--check", base]);
}

/** 仅在尚未安装依赖时按锁文件安装，避免每次都触发完整安装。 */
async function installDependencies() {
  if (existsSync(join(repositoryRoot, "node_modules"))) {
    process.stdout.write("依赖已安装，跳过。\n");
    return;
  }
  await run("pnpm", ["install", "--frozen-lockfile"]);
}

const steps = [
  { id: "whitespace", title: "空白检查", execute: checkWhitespace },
  { id: "install", title: "依赖安装检查", execute: installDependencies },
  { id: "typecheck", title: "类型检查", execute: () => run("pnpm", ["run", "typecheck"]) },
  { id: "test", title: "单元测试", execute: () => run("pnpm", ["test"]) },
  { id: "build", title: "生产构建", execute: () => run("pnpm", ["run", "build"]) }
];

/**
 * 解析命令行参数。
 *
 * @param {string[]} values process.argv 中脚本名之后的部分
 * @returns {{ skip: Set<string>, list: boolean }} 解析结果
 * @throws {Error} 出现未知参数或未知步骤标识时抛出
 */
export function parseCliArguments(values) {
  const known = new Set(steps.map((step) => step.id));
  const skip = new Set();
  let list = false;
  for (const value of values) {
    if (value === "--list") {
      list = true;
    } else if (value.startsWith("--skip=")) {
      for (const id of value.slice("--skip=".length).split(",").filter(Boolean)) {
        if (!known.has(id)) {
          throw new Error(`未知步骤：${id}（可用：${[...known].join("、")}）`);
        }
        skip.add(id);
      }
    } else {
      throw new Error(`未知参数：${value}`);
    }
  }
  return { skip, list };
}

async function main() {
  const { skip, list } = parseCliArguments(process.argv.slice(2));
  if (list) {
    for (const step of steps) {
      process.stdout.write(`${step.id}\t${step.title}\n`);
    }
    return;
  }

  const selected = steps.filter((step) => !skip.has(step.id));
  const results = [];
  process.stdout.write("======== MorphDoc 本地 CI ========\n");
  for (const [index, step] of selected.entries()) {
    process.stdout.write(`\n[${index + 1}/${selected.length}] ${step.title}\n`);
    const startedAt = Date.now();
    try {
      await step.execute();
    } catch (error) {
      process.stderr.write(
        `\n✗ ${step.title}失败：${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
      break;
    }
    results.push({ title: step.title, seconds: (Date.now() - startedAt) / 1000 });
    process.stdout.write(`✓ ${step.title}通过\n`);
  }

  process.stdout.write("\n======== 汇总 ========\n");
  for (const result of results) {
    process.stdout.write(`✓ ${result.title}  ${result.seconds.toFixed(1)}s\n`);
  }
  if (process.exitCode === 1) {
    process.stdout.write("存在失败步骤，请修复后重试。\n");
  } else if (skip.size > 0) {
    process.stdout.write(`全部通过（已跳过：${[...skip].join("、")}）。\n`);
  } else {
    process.stdout.write("全部通过，可以提交并创建 Pull Request。\n");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
