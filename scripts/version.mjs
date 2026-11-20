#!/usr/bin/env node
/**
 * 版本号管理：让版本号只在一处维护，其余位置全部派生或被校验。
 *
 * 版本号手写的位置只有两个，都是生态硬性要求：
 *   - 根 package.json：npm/pnpm、Vite、归集脚本、CI 都以它为准；
 *   - apps/desktop/package.json：electron-builder 与 app.getVersion() 读取它自己的 package.json。
 * 其余位置（运行时默认值、测试断言、文档示例）一律不得写死版本号。
 *
 * 用法：
 *   node scripts/version.mjs set <版本>        同步写入两个 package.json
 *   node scripts/version.mjs check             校验版本一致，并扫描是否有写死的当前版本号
 *   node scripts/version.mjs check --tag <tag> 同时校验标签等于 v<版本>（发布时使用）
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 手写版本号的两个位置（相对仓库根）。 */
export const manifestPaths = ["package.json", "apps/desktop/package.json"];

const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

/**
 * 允许出现当前版本号的文件：版本号的真正出处，以及按版本留存的历史记录。
 * package.json 还会写依赖版本，pnpm-lock.yaml 记录全部依赖版本，二者都可能恰好等于当前版本。
 */
const allowedPatterns = [
  /(^|\/)package\.json$/u,
  /^pnpm-lock\.yaml$/u,
  /^CHANGELOG\.md$/u,
  /^docs\/PROGRESS\.md$/u,
  /^docs\/releases\//u
];

/** 已知的二进制扩展名，扫描时直接跳过。 */
const binaryExtensions = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".icns",
  ".woff", ".woff2", ".ttf", ".otf", ".pdf", ".zip", ".gz", ".docx", ".xlsx"
]);

/** 超过此大小的文件不扫描（版本字面量不会出现在大文件里）。 */
const maximumScanBytes = 1024 * 1024;

/**
 * 规范化并校验版本号：去掉前缀 v，要求符合语义版本。
 *
 * @param {unknown} value 用户输入
 * @returns {string} 规范化后的版本号
 * @throws {Error} 不是合法的语义版本时抛出
 */
export function normalizeVersion(value) {
  const normalized = String(value ?? "").trim().replace(/^v/u, "");
  if (!semverPattern.test(normalized)) {
    throw new Error(`无效版本号：${value ?? ""}（需要形如 1.2.3 或 1.2.3-rc.1）`);
  }
  return normalized;
}

/**
 * 读取 package.json 文本中的顶层 version。
 *
 * @param {string} text package.json 的文本
 * @returns {string | undefined} 版本号，缺失或不是字符串时为 undefined
 */
export function readVersion(text) {
  const version = JSON.parse(text).version;
  return typeof version === "string" ? version : undefined;
}

/**
 * 替换 package.json 文本中的顶层 version，保留文件原有的缩进与字段顺序。
 *
 * 只替换第一处 "version" 键（顶层字段位于依赖之前），并在替换后再次解析，确认除 version
 * 以外的内容完全没有变化，避免误改嵌套字段。
 *
 * @param {string} text package.json 的文本
 * @param {string} version 新版本号
 * @returns {string} 替换后的文本
 * @throws {Error} 没有顶层 version，或替换影响了其他字段时抛出
 */
export function replaceVersion(text, version) {
  const before = JSON.parse(text);
  if (typeof before.version !== "string") {
    throw new Error("package.json 缺少顶层 version 字段");
  }
  const pattern = /^(\s*"version"\s*:\s*")[^"]*(")/mu;
  if (!pattern.test(text)) {
    throw new Error("无法在 package.json 中定位 version 行");
  }
  const updated = text.replace(pattern, `$1${version}$2`);
  const after = JSON.parse(updated);
  if (after.version !== version || JSON.stringify({ ...after, version: 0 }) !== JSON.stringify({ ...before, version: 0 })) {
    throw new Error("替换 version 时意外改动了其他内容，已中止");
  }
  return updated;
}

/**
 * 在文本中查找作为完整词元出现的版本号（可带前缀 v）。
 *
 * 不会把更长版本号的片段当作命中：11.2.3、1.2.3.1、1.2.3-rc.1 都不是 1.2.3，
 * 而句末的 "1.2.3。" 或 "1.2.3." 仍然算命中。
 *
 * @param {string} text 待扫描文本
 * @param {string} version 要查找的版本号
 * @returns {number[]} 命中所在的行号（从 1 开始）
 */
export function findVersionLiterals(text, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`(?<![\\d.])v?${escaped}(?!\\d|\\.\\d|-[0-9A-Za-z])`, "u");
  const lines = [];
  text.split(/\r?\n/u).forEach((line, index) => {
    if (pattern.test(line)) {
      lines.push(index + 1);
    }
  });
  return lines;
}

/**
 * 判断文件是否允许出现当前版本号。
 *
 * @param {string} path 相对仓库根、使用 / 分隔的路径
 */
export function isAllowlisted(path) {
  return allowedPatterns.some((pattern) => pattern.test(path));
}

function listTrackedFiles(root) {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  return output.split("\0").filter(Boolean);
}

/**
 * 校验版本号并收集问题。
 *
 * @param {object} options 选项
 * @param {string} [options.root] 仓库根，默认取本脚本所在仓库
 * @param {string[]} [options.files] 要扫描的文件清单，默认取 git ls-files；测试时可注入
 * @param {string} [options.tag] 若提供，要求等于 v<版本>
 * @returns {{ version: string | undefined, problems: string[] }} 版本与问题列表
 */
export function collectProblems(options = {}) {
  const root = options.root ?? repositoryRoot;
  const problems = [];
  const versions = new Map();
  for (const path of manifestPaths) {
    let version;
    try {
      version = readVersion(readFileSync(join(root, path), "utf8"));
    } catch (error) {
      problems.push(`无法读取 ${path}：${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (version === undefined) {
      problems.push(`${path} 缺少 version 字段`);
    } else {
      versions.set(path, version);
    }
  }

  const rootVersion = versions.get("package.json");
  if (rootVersion === undefined) {
    return { version: undefined, problems };
  }
  if (!semverPattern.test(rootVersion)) {
    problems.push(`根 package.json 的版本 ${rootVersion} 不是合法的语义版本`);
  }
  for (const [path, version] of versions) {
    if (version !== rootVersion) {
      problems.push(`${path} 的版本 ${version} 与根 package.json 的 ${rootVersion} 不一致`);
    }
  }
  if (options.tag !== undefined && options.tag !== `v${rootVersion}`) {
    problems.push(`标签 ${options.tag} 与 package.json 版本 v${rootVersion} 不一致`);
  }

  // 守卫：当前版本号不得被写死在允许范围之外，否则下次发版它会悄悄过期
  const files = options.files ?? listTrackedFiles(root);
  for (const path of files) {
    if (isAllowlisted(path) || binaryExtensions.has(extname(path).toLowerCase())) {
      continue;
    }
    let content;
    try {
      const absolute = join(root, path);
      if (statSync(absolute).size > maximumScanBytes) {
        continue;
      }
      content = readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    if (content.includes("\u0000")) {
      continue;
    }
    for (const line of findVersionLiterals(content, rootVersion)) {
      problems.push(
        `${path}:${line} 写死了当前版本 ${rootVersion}；版本号只应在 package.json 中维护，` +
          "请改为读取 package.json 或使用占位符"
      );
    }
  }
  return { version: rootVersion, problems };
}

/**
 * 把版本号同步写入两个 package.json。
 *
 * @param {string} root 仓库根
 * @param {string} version 已规范化的新版本号
 * @returns {{ path: string, from: string | undefined, to: string }[]} 每个文件的变化
 */
export function setVersion(root, version) {
  const changes = [];
  const updates = manifestPaths.map((path) => {
    const text = readFileSync(join(root, path), "utf8");
    return { path, from: readVersion(text), text: replaceVersion(text, version) };
  });
  // 全部替换成功后再统一写入，避免只写了一半
  for (const { path, from, text } of updates) {
    writeFileSync(join(root, path), text, "utf8");
    changes.push({ path, from, to: version });
  }
  return changes;
}

function main(argv) {
  const [command, ...rest] = argv;
  if (command === "set") {
    const version = normalizeVersion(rest[0]);
    for (const { path, from, to } of setVersion(repositoryRoot, version)) {
      process.stdout.write(`${path}: ${from ?? "(无)"} -> ${to}\n`);
    }
    return 0;
  }
  if (command === "check") {
    let tag;
    for (let index = 0; index < rest.length; index += 1) {
      if (rest[index] === "--tag" && rest[index + 1]) {
        tag = rest[index + 1];
        index += 1;
      } else {
        throw new Error(`未知参数：${rest[index]}`);
      }
    }
    const { version, problems } = collectProblems(tag === undefined ? {} : { tag });
    if (problems.length > 0) {
      process.stderr.write(`版本校验失败：\n${problems.map((line) => `  - ${line}`).join("\n")}\n`);
      return 1;
    }
    process.stdout.write(`版本校验通过：${version}\n`);
    return 0;
  }
  throw new Error("用法：node scripts/version.mjs set <版本> | check [--tag <标签>]");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
