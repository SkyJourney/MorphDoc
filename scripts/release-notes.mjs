import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * 变更记录生成：从上一个版本标签到 HEAD 的提交，生成 CHANGELOG 章节与发行说明骨架。
 *
 * 生成内容全部来自可追溯的原料：提交（类型前缀与 PR 编号）、deploy/ 的文件变化、
 * 各 package.json 的依赖版本变化、Pandoc 运行时版本。需要人写的部分统一用
 * 【待补充】标出，发布时 release 的 check 会拒绝仍含该标记的发行说明。
 *
 * 纯函数（解析、渲染）与 git 读取分开：渲染可以用构造的提交列表直接测试。
 */

/** 发行说明中尚未填写的部分必须带上的标记；发布前校验会拒绝残留它的文件。 */
export const placeholder = "【待补充】";

/** 变更类型到 CHANGELOG 小节的映射。未知类型归入“其他变更”并给出警告。 */
const groupByType = new Map([
  ["feat", "新增"],
  ["fix", "修复"],
  ["docs", "变更"],
  ["ci", "变更"],
  ["test", "变更"],
  ["chore", "变更"],
  ["refactor", "变更"],
  ["perf", "变更"],
  ["build", "变更"],
  ["style", "变更"]
]);

const groupOrder = ["新增", "修复", "变更", "其他变更"];
const subjectPattern = /^(?<type>[A-Za-z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?:\s*(?<summary>.+)$/u;
const prSuffixPattern = /\s*\(#(?<number>\d+)\)\s*$/u;

/**
 * 解析单个提交。
 *
 * @param {{ hash?: string, subject?: string, body?: string }} commit 提交的哈希、主题与正文
 * @returns {{ hash: string, type: string | undefined, group: string, summary: string,
 *   breaking: boolean, pr: string | undefined, body: string } | null}
 *   发布提交（type 为 release）返回 null，不进入变更记录
 */
export function parseCommit({ hash = "", subject = "", body = "" }) {
  const full = subject.trim();
  const prMatch = prSuffixPattern.exec(full);
  const text = prMatch ? full.slice(0, prMatch.index) : full;
  const pr = prMatch?.groups?.number;
  const match = subjectPattern.exec(text);
  if (!match) {
    return { hash, type: undefined, group: "其他变更", summary: text, breaking: false, pr, body: body.trim() };
  }
  const type = match.groups.type.toLowerCase();
  if (type === "release") {
    return null;
  }
  return {
    hash,
    type,
    group: groupByType.get(type) ?? "其他变更",
    summary: match.groups.summary.trim(),
    breaking: match.groups.breaking === "!",
    pr,
    body: body.trim()
  };
}

function renderItem(entry, repositoryUrl) {
  const breaking = entry.breaking ? "（破坏性变更）" : "";
  const link = entry.pr && repositoryUrl ? ` ([#${entry.pr}](${repositoryUrl}/pull/${entry.pr}))` : "";
  return `- ${entry.summary}${breaking}${link}`;
}

/** 正文只进入发行说明，CHANGELOG 保持简短；没有正文的提交不生成折叠块。 */
function renderDetails(entry) {
  if (!entry.body) {
    return [];
  }
  const label = entry.pr ? `#${entry.pr}` : entry.hash.slice(0, 7);
  return ["", `<details><summary>${label} 的完整说明</summary>`, "", entry.body, "", "</details>"];
}

/**
 * 按小节分组提交。
 *
 * @param {object[]} commits 提交列表（已排除发布提交）
 * @returns {{ grouped: Map<string, object[]>, warnings: string[] }}
 */
function groupEntries(commits) {
  const grouped = new Map(groupOrder.map((name) => [name, []]));
  const warnings = [];
  for (const commit of commits) {
    const entry = parseCommit(commit);
    if (!entry) {
      continue;
    }
    if (entry.group === "其他变更") {
      warnings.push(`无法识别类型，已归入“其他变更”：${commit.subject?.trim() ?? entry.hash}`);
    }
    grouped.get(entry.group).push(entry);
  }
  return { grouped, warnings };
}

/**
 * 渲染 CHANGELOG 的版本章节（不含前后空行）。
 *
 * @param {{ version: string, date: string, grouped: Map<string, object[]>, repositoryUrl?: string }} input
 * @returns {string} 以换行结尾的章节文本
 */
export function renderChangelogSection({ version, date, grouped, repositoryUrl }) {
  const lines = [`## [${version}] - ${date}`, ""];
  let any = false;
  for (const name of groupOrder) {
    const entries = grouped.get(name) ?? [];
    if (entries.length === 0) {
      continue;
    }
    any = true;
    lines.push(`### ${name}`, "");
    lines.push(...entries.map((entry) => renderItem(entry, repositoryUrl)), "");
  }
  if (!any) {
    lines.push("### 变更", "", "- 无用户可见的提交。", "");
  }
  return `${lines.join("\n")}\n`;
}

/**
 * 渲染发行说明骨架。自动生成的部分可直接发布；【待补充】部分必须人工补全。
 *
 * @param {object} input 渲染输入
 * @returns {string} Markdown 文本
 */
export function renderReleaseNotes({
  version,
  date,
  previousVersion,
  compareUrl,
  grouped,
  repositoryUrl,
  deployChanges,
  dependencyChanges,
  artifactNames
}) {
  const lines = [`# MorphDoc · 墨呈 v${version}`, ""];
  const range = compareUrl && previousVersion ? ` · 变更范围：[v${previousVersion}...v${version}](${compareUrl})` : "";
  lines.push(`> 发布日期：${date}${range}`, "");

  lines.push("## 概述", "", `${placeholder} 用一两段话说明本版本的主要目标与最重要的变化。`, "");

  lines.push("## 本版本变更", "");
  let any = false;
  for (const name of groupOrder) {
    const entries = grouped.get(name) ?? [];
    if (entries.length === 0) {
      continue;
    }
    any = true;
    lines.push(`### ${name}`, "");
    for (const entry of entries) {
      lines.push(renderItem(entry, repositoryUrl), ...renderDetails(entry), "");
    }
  }
  if (!any) {
    lines.push("- 无用户可见的提交。", "");
  }

  lines.push("## 验证结果", "", `${placeholder} 列出测试、类型检查、CI、E2E、发布演练与手动验证的结果。`, "");

  lines.push("## 升级与兼容性", "", "### 部署与配置变化（自动）", "");
  if (deployChanges.length === 0) {
    lines.push("- 无。", "");
  } else {
    lines.push(...deployChanges.map((path) => `- \`${path}\``), "");
  }

  lines.push("### 依赖版本变化（自动）", "");
  if (dependencyChanges.length === 0) {
    lines.push("- 无。", "");
  } else {
    lines.push(...dependencyChanges.map(renderDependencyChange), "");
  }

  lines.push(`${placeholder} 迁移步骤与兼容性说明；没有破坏性变化时写明“无”。`, "");

  lines.push("## 发行产物", "", ...artifactNames.map((name) => `- \`${name}\``), "");
  return `${lines.join("\n")}\n`;
}

function renderDependencyChange(change) {
  if (change.name === "Pandoc 运行时") {
    return `- Pandoc 运行时 ${change.from} → ${change.to}（${change.path}）`;
  }
  if (change.from === undefined) {
    return `- 新增 \`${change.name}\` ${change.to}（${change.path}）`;
  }
  if (change.to === undefined) {
    return `- 移除 \`${change.name}\`（${change.path}）`;
  }
  return `- \`${change.name}\` ${change.from} → ${change.to}（${change.path}）`;
}

/**
 * 生成 CHANGELOG 章节与发行说明骨架（纯函数，不读取 git）。
 *
 * @param {object} input 版本、日期、上一版本、仓库地址、提交与变化的原料
 * @returns {{ changelogSection: string, releaseNotes: string, warnings: string[] }}
 */
export function buildReleaseDocuments({
  version,
  date,
  previousVersion,
  repositoryUrl,
  commits,
  deployChanges = [],
  dependencyChanges = [],
  artifactNames = []
}) {
  const { grouped, warnings } = groupEntries(commits);
  const compareUrl = repositoryUrl && previousVersion ? `${repositoryUrl}/compare/v${previousVersion}...v${version}` : undefined;
  const changelogSection = renderChangelogSection({ version, date, grouped, repositoryUrl });
  const releaseNotes = renderReleaseNotes({
    version,
    date,
    previousVersion,
    compareUrl,
    grouped,
    repositoryUrl,
    deployChanges,
    dependencyChanges,
    artifactNames
  });
  return { changelogSection, releaseNotes, warnings };
}

/**
 * 把新章节插入 CHANGELOG：位于 [Unreleased] 之后、上一个版本章节之前。
 * 没有上一个版本章节时追加到末尾。
 *
 * @param {string} text CHANGELOG 全文
 * @param {string} section 已渲染的版本章节（以换行结尾）
 * @returns {string} 更新后的全文
 */
export function insertChangelogSection(text, section) {
  const lines = text.split("\n");
  const index = lines.findIndex((line) => /^## \[/u.test(line) && !/^## \[Unreleased\]/u.test(line));
  if (index < 0) {
    return `${text.replace(/\s*$/u, "")}\n\n${section}`;
  }
  return `${lines.slice(0, index).join("\n")}\n${section}\n${lines.slice(index).join("\n")}`;
}

/**
 * 判断 CHANGELOG 中是否已有某版本的章节。
 *
 * @param {string} text CHANGELOG 全文
 * @param {string} version 版本号
 */
export function hasChangelogSection(text, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^## \\[${escaped}\\]`, "mu").test(text);
}

/**
 * 去掉发行说明中折叠的提交正文（<details> 块），只保留需要人工撰写的部分用于占位检查。
 *
 * 提交正文是历史记录：即使某次提交的正文恰好提到了占位标记，也不应阻止本次发布。
 * 占位标记只在人工撰写的段落里才有效。
 *
 * @param {string} text 发行说明全文
 * @returns {string} 去掉折叠块后的文本
 */
export function stripFoldedDetails(text) {
  return text.replace(/<details>[\s\S]*?<\/details>/gu, "");
}

/**
 * 把 git 远端地址转换为 GitHub 仓库的网页地址。
 *
 * @param {string} remote 远端地址（ssh 或 https 形式）
 * @returns {string | undefined} 形如 https://github.com/owner/repo，无法识别时为 undefined
 */
export function parseRepositoryUrl(remote) {
  const match = /github\.com[:/](?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?$/u.exec(remote.trim());
  return match ? `https://github.com/${match.groups.owner}/${match.groups.repo}` : undefined;
}

/**
 * 本地日期（YYYY-MM-DD）。使用本地时间，与用户在本机发版的日期一致。
 *
 * @param {Date} date 时间
 */
export function formatLocalDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 与 scripts/stage-release.mjs 产出的发行物文件名一致。
 *
 * @param {string} version 版本号
 * @returns {string[]} 文件名列表
 */
export function releaseArtifactNames(version) {
  return [
    `MorphDoc-${version}-x86_64-Setup.exe`,
    `MorphDoc-${version}-x86_64.zip`,
    `MorphDoc-${version}-arm64.dmg`,
    `MorphDoc-${version}-x64.dmg`,
    `MorphDoc-Web-${version}-image.tar.gz`,
    `MorphDoc-Web-${version}-deploy.zip`
  ];
}

// ---------------------------------------------------------------------------
// git 读取：只在这一节出现，纯函数不依赖它
// ---------------------------------------------------------------------------

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function gitOrNull(root, args) {
  try {
    return git(root, args);
  } catch {
    return null;
  }
}

/**
 * 上一个版本标签（v* 中距离 HEAD 最近的一个）。
 *
 * @param {string} root 仓库根
 * @returns {{ tag: string, version: string } | null} 找不到时为 null
 */
export function detectPreviousRelease(root) {
  const tag = gitOrNull(root, ["describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD"]);
  return tag ? { tag, version: tag.replace(/^v/u, "") } : null;
}

/**
 * 读取基线之后到 HEAD 的非合并提交。基线为空时读取全部提交。
 *
 * @param {string} root 仓库根
 * @param {string | null} base 基线引用（标签名）
 * @returns {{ hash: string, subject: string, body: string }[]}
 */
export function readCommitsSince(root, base) {
  const range = base ? `${base}..HEAD` : "HEAD";
  const output = gitOrNull(root, ["log", "--no-merges", "--format=%H%x1f%s%x1f%b%x1e", range]) ?? "";
  return output
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = "", subject = "", body = ""] = record.split("\x1f");
      return { hash: hash.trim(), subject, body };
    });
}

/**
 * 基线到 HEAD 之间某路径下发生变化的文件。没有基线时列出当前跟踪的全部文件。
 *
 * @param {string} root 仓库根
 * @param {string | null} base 基线引用
 * @param {string} pathspec 路径（目录或文件）
 * @returns {string[]}
 */
export function changedPaths(root, base, pathspec) {
  const output = base
    ? gitOrNull(root, ["diff", "--name-only", base, "HEAD", "--", pathspec])
    : gitOrNull(root, ["ls-files", "--", pathspec]);
  return (output ?? "").split("\n").filter(Boolean).sort();
}

function readJsonAt(root, ref, path) {
  const text = gitOrNull(root, ["show", `${ref}:${path}`]);
  if (text === null) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 依赖表中的工作区内部链接（workspace:*、@morphdoc/*）不是外部依赖，不列入变更。 */
function externalDependencies(manifest) {
  const merged = { ...manifest?.dependencies, ...manifest?.devDependencies };
  return Object.fromEntries(
    Object.entries(merged).filter(([name, range]) => !name.startsWith("@morphdoc/") && !String(range).startsWith("workspace:"))
  );
}

/**
 * 基线与 HEAD 之间各 package.json 的外部依赖变化，以及 Pandoc 运行时版本变化。
 *
 * 只比较基线中已存在的清单：新增的工作区包不逐条列出依赖，避免噪声淹没真正的升级。
 *
 * @param {string} root 仓库根
 * @param {string | null} base 基线引用
 * @returns {{ path: string, name: string, from: string | undefined, to: string | undefined }[]}
 */
export function collectDependencyChanges(root, base) {
  if (!base) {
    return [];
  }
  const manifests = (gitOrNull(root, ["ls-files"]) ?? "")
    .split("\n")
    .filter((path) => /(^|\/)package\.json$/u.test(path));
  const changes = [];
  for (const path of manifests.sort()) {
    const before = readJsonAt(root, base, path);
    const after = readJsonAt(root, "HEAD", path);
    if (!before || !after) {
      continue;
    }
    const previous = externalDependencies(before);
    const current = externalDependencies(after);
    const names = [...new Set([...Object.keys(previous), ...Object.keys(current)])].sort();
    for (const name of names) {
      if (previous[name] === current[name]) {
        continue;
      }
      changes.push({ path, name, from: previous[name], to: current[name] });
    }
  }
  const pandocPath = "packages/docx-engine/src/pandoc-runtime.json";
  const pandocBefore = readJsonAt(root, base, pandocPath);
  const pandocAfter = readJsonAt(root, "HEAD", pandocPath);
  if (pandocBefore?.version && pandocAfter?.version && pandocBefore.version !== pandocAfter.version) {
    changes.push({
      path: pandocPath,
      name: "Pandoc 运行时",
      from: pandocBefore.version,
      to: pandocAfter.version
    });
  }
  return changes;
}

/**
 * 收集 git 原料并生成全部发行文档。
 *
 * @param {string} root 仓库根
 * @param {{ version: string, date: string }} input 目标版本与日期
 * @returns {{ changelogSection: string, releaseNotes: string, warnings: string[] }}
 */
export function prepareRelease(root, { version, date }) {
  const previous = detectPreviousRelease(root);
  const base = previous?.tag ?? null;
  const repositoryUrl = parseRepositoryUrl(gitOrNull(root, ["remote", "get-url", "origin"]) ?? "");
  const documents = buildReleaseDocuments({
    version,
    date,
    previousVersion: previous?.version,
    repositoryUrl,
    commits: readCommitsSince(root, base),
    deployChanges: changedPaths(root, base, "deploy"),
    dependencyChanges: collectDependencyChanges(root, base),
    artifactNames: releaseArtifactNames(version)
  });
  if (!previous) {
    documents.warnings.unshift("未找到上一个版本标签，变更记录包含仓库的全部提交");
  }
  if (!repositoryUrl) {
    documents.warnings.push("无法从 origin 识别 GitHub 仓库地址，提交链接与对比链接已省略");
  }
  return documents;
}

/** 供测试与校验使用：读取文本文件。 */
export function readText(path) {
  return readFileSync(path, "utf8");
}
