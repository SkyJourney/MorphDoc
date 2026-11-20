import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  buildReleaseDocuments,
  collectDependencyChanges,
  formatLocalDate,
  hasChangelogSection,
  insertChangelogSection,
  parseCommit,
  parseRepositoryUrl,
  placeholder,
  prepareRelease,
  releaseArtifactNames
} from "./release-notes.mjs";
import { collectReleaseProblems, setRelease } from "./version.mjs";

const repositoryUrl = "https://github.com/owner/repo";

test("parseCommit 识别类型、范围、破坏性标记与 PR 编号", () => {
  assert.deepEqual(
    parseCommit({ hash: "h1", subject: "fix(renderer): 修复 Y (#2)", body: " 正文 " }),
    { hash: "h1", type: "fix", group: "修复", summary: "修复 Y", breaking: false, pr: "2", body: "正文" }
  );
  assert.equal(parseCommit({ subject: "feat!: 删除旧接口" }).breaking, true);
  assert.equal(parseCommit({ subject: "feat!: 删除旧接口" }).group, "新增");
});

test("parseCommit 跳过发布提交，并把无法识别的提交归入其他变更", () => {
  assert.equal(parseCommit({ subject: "release: 发布 v0.1.0" }), null);
  assert.equal(parseCommit({ subject: 'Revert "x"' }).group, "其他变更");
  assert.equal(parseCommit({ subject: "wip: 临时" }).group, "其他变更");
});

test("buildReleaseDocuments 按小节分组、排序，并生成可追溯的 PR 链接", () => {
  const { changelogSection, warnings } = buildReleaseDocuments({
    version: "0.2.0",
    date: "2026-02-01",
    previousVersion: "0.1.0",
    repositoryUrl,
    commits: [
      { hash: "a1", subject: "ci: 增加 X (#4)", body: "" },
      { hash: "b2", subject: "fix(renderer): 修复 Y (#2)", body: "正文第一行" },
      { hash: "c3", subject: "feat: 新增 Z", body: "" },
      { hash: "d4", subject: "release: 发布 v0.1.0", body: "" },
      { hash: "e5", subject: 'Revert "x"', body: "" }
    ]
  });

  assert.equal(
    changelogSection,
    [
      "## [0.2.0] - 2026-02-01",
      "",
      "### 新增",
      "",
      "- 新增 Z",
      "",
      "### 修复",
      "",
      "- 修复 Y ([#2](https://github.com/owner/repo/pull/2))",
      "",
      "### 变更",
      "",
      "- 增加 X ([#4](https://github.com/owner/repo/pull/4))",
      "",
      "### 其他变更",
      "",
      '- Revert "x"',
      "",
      ""
    ].join("\n")
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /无法识别类型/u);
});

test("发行说明：正文只进入发行说明的折叠块，CHANGELOG 保持简短", () => {
  const { changelogSection, releaseNotes } = buildReleaseDocuments({
    version: "0.2.0",
    date: "2026-02-01",
    previousVersion: "0.1.0",
    repositoryUrl,
    commits: [{ hash: "b2", subject: "fix: 修复 Y (#2)", body: "正文第一行" }],
    artifactNames: releaseArtifactNames("0.2.0")
  });

  assert.doesNotMatch(changelogSection, /正文第一行/u);
  assert.match(releaseNotes, /<details><summary>#2 的完整说明<\/summary>/u);
  assert.match(releaseNotes, /正文第一行/u);
  assert.match(releaseNotes, /变更范围：\[v0\.1\.0\.\.\.v0\.2\.0\]\(https:\/\/github\.com\/owner\/repo\/compare\/v0\.1\.0\.\.\.v0\.2\.0\)/u);
});

test("发行说明的需人工填写部分全部带有标记，自动部分不带", () => {
  const { releaseNotes } = buildReleaseDocuments({
    version: "0.2.0",
    date: "2026-02-01",
    commits: [],
    artifactNames: releaseArtifactNames("0.2.0")
  });

  const marked = releaseNotes.split("\n").filter((line) => line.includes(placeholder));
  assert.equal(marked.length, 3, "概述、验证结果、迁移说明三处");
  assert.match(releaseNotes, /## 发行产物/u);
  assert.match(releaseNotes, /MorphDoc-0\.2\.0-x86_64-Setup\.exe/u);
});

test("insertChangelogSection 插入到 [Unreleased] 之后、上一个版本之前", () => {
  const text = "# 变更日志\n\n## [Unreleased]\n\n### 变更\n\n- 暂无。\n\n## [0.1.0] - 2026-01-01\n\n### 新增\n\n- 初始\n";
  const section = "## [0.2.0] - 2026-02-01\n\n### 新增\n\n- 新功能\n";
  const updated = insertChangelogSection(text, section);

  assert.equal(
    updated,
    "# 变更日志\n\n## [Unreleased]\n\n### 变更\n\n- 暂无。\n\n## [0.2.0] - 2026-02-01\n\n### 新增\n\n- 新功能\n\n## [0.1.0] - 2026-01-01\n\n### 新增\n\n- 初始\n"
  );
});

test("insertChangelogSection 在没有上一个版本时追加到末尾", () => {
  const updated = insertChangelogSection("# 变更日志\n\n## [Unreleased]\n\n- 暂无。\n", "## [0.1.0] - 2026-01-01\n\n- 初始\n");
  assert.match(updated, /## \[Unreleased\][\s\S]*## \[0\.1\.0\]/u);
});

test("hasChangelogSection 只匹配完整的版本标题", () => {
  const text = "## [0.1.0] - 2026-01-01\n";
  assert.equal(hasChangelogSection(text, "0.1.0"), true);
  assert.equal(hasChangelogSection(text, "0.1.00"), false);
  assert.equal(hasChangelogSection(text, "0.1"), false);
  assert.equal(hasChangelogSection("## [Unreleased]\n", "0.1.0"), false);
});

test("parseRepositoryUrl 识别 ssh 与 https 形式的 GitHub 远端", () => {
  assert.equal(parseRepositoryUrl("git@github.com:owner/repo.git"), "https://github.com/owner/repo");
  assert.equal(parseRepositoryUrl("https://github.com/owner/repo.git"), "https://github.com/owner/repo");
  assert.equal(parseRepositoryUrl("https://github.com/owner/repo"), "https://github.com/owner/repo");
  assert.equal(parseRepositoryUrl("https://gitlab.example.com/owner/repo.git"), undefined);
});

test("formatLocalDate 使用本地日期并补零", () => {
  assert.equal(formatLocalDate(new Date(2026, 0, 5, 12)), "2026-01-05");
  assert.equal(formatLocalDate(new Date(2026, 11, 31, 23)), "2026-12-31");
});

test("releaseArtifactNames 与 stage-release 产出的文件名一致", () => {
  assert.deepEqual(releaseArtifactNames("1.2.3"), [
    "MorphDoc-1.2.3-x86_64-Setup.exe",
    "MorphDoc-1.2.3-x86_64.zip",
    "MorphDoc-1.2.3-arm64.dmg",
    "MorphDoc-1.2.3-x64.dmg",
    "MorphDoc-Web-1.2.3-image.tar.gz",
    "MorphDoc-Web-1.2.3-deploy.zip"
  ]);
});

// ---------------------------------------------------------------------------
// 真实 git 仓库上的端到端：标签、提交、部署目录与依赖变化都从 git 读取
// ---------------------------------------------------------------------------

function git(cwd, args) {
  return execFileSync("git", ["-c", "user.name=SkyJourney", "-c", "user.email=sky.jiang.s.z@gmail.com", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8"
  });
}

function writeIn(directory, path, content) {
  mkdirSync(dirname(join(directory, path)), { recursive: true });
  writeFileSync(join(directory, path), content, "utf8");
}

function commit(directory, subject, body = "") {
  git(directory, ["add", "-A"]);
  git(directory, ["commit", "-q", "--allow-empty", "-m", subject, ...(body ? ["-m", body] : [])]);
}

function sampleRepository() {
  const directory = mkdtempSync(join(tmpdir(), "morphdoc-release-notes-"));
  git(directory, ["init", "-q"]);
  git(directory, ["remote", "add", "origin", "git@github.com:owner/repo.git"]);
  writeIn(directory, "package.json", JSON.stringify({ name: "morphdoc", version: "0.1.0", dependencies: { katex: "^0.16.28" } }, null, 2) + "\n");
  writeIn(directory, "apps/desktop/package.json", JSON.stringify({ name: "desktop", version: "0.1.0" }, null, 2) + "\n");
  writeIn(directory, "CHANGELOG.md", "# 变更日志\n\n## [Unreleased]\n\n### 变更\n\n- 暂无。\n\n## [0.1.0] - 2026-01-01\n\n### 新增\n\n- 初始\n");
  writeIn(directory, "deploy/compose.yaml", "services: {}\n");
  commit(directory, "chore: 初始化");
  git(directory, ["tag", "v0.1.0"]);

  writeIn(directory, "deploy/compose.yaml", "services:\n  app: {}\n");
  commit(directory, "feat: 新增导出 (#7)", "导出支持 PDF 与 DOCX。");

  const packageJson = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  packageJson.dependencies.katex = "^0.19.1";
  packageJson.dependencies.playwright = "1.62.0";
  writeIn(directory, "package.json", JSON.stringify(packageJson, null, 2) + "\n");
  commit(directory, "chore: 升级依赖 (#9)");
  return directory;
}

test("prepareRelease 从 git 读取上一个标签之后的提交、部署变化与依赖变化", () => {
  const directory = sampleRepository();
  const documents = prepareRelease(directory, { version: "0.2.0", date: "2026-02-01" });

  assert.match(documents.changelogSection, /- 新增导出 \(\[#7\]\(https:\/\/github\.com\/owner\/repo\/pull\/7\)\)/u);
  assert.match(documents.changelogSection, /- 升级依赖 \(\[#9\]\(https:\/\/github\.com\/owner\/repo\/pull\/9\)\)/u);
  assert.doesNotMatch(documents.changelogSection, /初始化/u, "标签之前的提交不得进入本版本");
  assert.match(documents.releaseNotes, /- `deploy\/compose\.yaml`/u);
  assert.match(documents.releaseNotes, /`katex` \^0\.16\.28 → \^0\.19\.1（package\.json）/u);
  assert.match(documents.releaseNotes, /新增 `playwright` 1\.62\.0（package\.json）/u);
  assert.deepEqual(documents.warnings, []);
});

test("collectDependencyChanges 忽略工作区内部链接与没有基线的情形", () => {
  const directory = sampleRepository();
  const changes = collectDependencyChanges(directory, "v0.1.0");
  assert.ok(changes.every((change) => !change.name.startsWith("@morphdoc/")));
  assert.deepEqual(collectDependencyChanges(directory, null), []);
});

test("setRelease 同步版本、写入 CHANGELOG 与发行说明，并拒绝覆盖", () => {
  const directory = sampleRepository();
  const result = setRelease(directory, "0.2.0", { date: "2026-02-01" });

  assert.deepEqual(result.written, ["CHANGELOG.md", "docs/releases/v0.2.0.md"]);
  assert.equal(JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).version, "0.2.0");
  assert.equal(JSON.parse(readFileSync(join(directory, "apps/desktop/package.json"), "utf8")).version, "0.2.0");
  const changelog = readFileSync(join(directory, "CHANGELOG.md"), "utf8");
  assert.ok(changelog.indexOf("## [0.2.0]") < changelog.indexOf("## [0.1.0]"));
  assert.ok(changelog.indexOf("## [Unreleased]") < changelog.indexOf("## [0.2.0]"));

  assert.throws(() => setRelease(directory, "0.2.0", { date: "2026-02-01" }), /已存在 \[0\.2\.0\] 章节，拒绝覆盖/u);
});

test("发布前校验：未补全的发行说明被拒绝，补全后通过", () => {
  const directory = sampleRepository();
  setRelease(directory, "0.2.0", { date: "2026-02-01" });

  const before = collectReleaseProblems(directory, "0.2.0");
  assert.equal(before.length, 1);
  assert.match(before[0], new RegExp(`仍含“${placeholder}”标记`, "u"));

  const notesPath = join(directory, "docs/releases/v0.2.0.md");
  writeFileSync(notesPath, readFileSync(notesPath, "utf8").split(placeholder).join("已补全"), "utf8");
  assert.deepEqual(collectReleaseProblems(directory, "0.2.0"), []);
});

test("发布前校验：缺少发行说明或 CHANGELOG 章节时报错", () => {
  const directory = sampleRepository();
  const problems = collectReleaseProblems(directory, "0.2.0");
  assert.ok(problems.some((line) => /CHANGELOG\.md 缺少 \[0\.2\.0\] 章节/u.test(line)));
  assert.ok(problems.some((line) => /缺少发行说明 docs\/releases\/v0\.2\.0\.md/u.test(line)));
});
