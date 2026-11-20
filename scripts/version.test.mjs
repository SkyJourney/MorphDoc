import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  collectProblems,
  findVersionLiterals,
  isAllowlisted,
  normalizeVersion,
  readVersion,
  replaceVersion,
  setVersion
} from "./version.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 在临时目录里建立一个最小仓库：两个 package.json 与若干附加文件。 */
function fixtureRepository({ root = "2.0.0", desktop = "2.0.0", files = {} } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "morphdoc-version-"));
  const write = (path, content) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content, "utf8");
  };
  write("package.json", JSON.stringify({ name: "morphdoc", version: root, scripts: {} }, null, 2) + "\n");
  write("apps/desktop/package.json", JSON.stringify({ name: "desktop", version: desktop }, null, 2) + "\n");
  for (const [path, content] of Object.entries(files)) {
    write(path, content);
  }
  return { directory, files: ["package.json", "apps/desktop/package.json", ...Object.keys(files)] };
}

test("normalizeVersion 接受语义版本、去掉前缀 v 与首尾空白，并拒绝其他写法", () => {
  assert.equal(normalizeVersion("2.0.0"), "2.0.0");
  assert.equal(normalizeVersion("v1.2.3"), "1.2.3");
  assert.equal(normalizeVersion("1.2.3-rc.1"), "1.2.3-rc.1");
  assert.equal(normalizeVersion(" 1.2.3 "), "1.2.3");
  for (const bad of ["", "latest", "1.2", "1.2.3.4", "v"]) {
    assert.throws(() => normalizeVersion(bad), /无效版本号/u, `应拒绝 ${JSON.stringify(bad)}`);
  }
});

test("readVersion 只返回字符串形式的顶层 version", () => {
  assert.equal(readVersion('{ "version": "2.0.0" }'), "2.0.0");
  assert.equal(readVersion("{}"), undefined);
  assert.equal(readVersion('{ "version": 3 }'), undefined);
});

test("replaceVersion 只改动 version 行，保留缩进与其他字段", () => {
  const text = '{\n  "name": "x",\n  "version": "1.2.3",\n  "scripts": {\n    "a": "b"\n  }\n}\n';
  const updated = replaceVersion(text, "2.0.0");

  assert.equal(updated, text.replace('"version": "1.2.3"', '"version": "2.0.0"'));
});

test("replaceVersion 在 version 不是顶层字段时中止，不误改嵌套的 version", () => {
  // 嵌套的 version 出现在顶层 version 之前时，替换必须失败而不是改错位置
  const text = '{\n  "dependencies": {\n    "version": "1.2.3"\n  },\n  "version": "1.2.3"\n}\n';
  assert.throws(() => replaceVersion(text, "2.0.0"), /意外改动了其他内容|无法在/u);
});

test("replaceVersion 对缺少顶层 version 的文件报错", () => {
  assert.throws(() => replaceVersion('{ "name": "x" }', "2.0.0"), /缺少顶层 version/u);
});

test("findVersionLiterals 命中完整的版本号，不命中更长的版本片段", () => {
  const text = [
    "发布 1.2.3 版本",            // 命中
    "前缀 v1.2.3 也算",           // 命中
    "句末 1.2.3。也算",            // 命中
    "11.2.3 不算",                // 不命中：前面是数字
    "1.2.3.1 不算",               // 不命中：后面是 .数字
    "1.2.30 不算",                // 不命中：后面是数字
    "1.2.3-rc.1 不算"             // 不命中：预发布后缀
  ].join("\n");

  assert.deepEqual(findVersionLiterals(text, "1.2.3"), [1, 2, 3]);
});

test("isAllowlisted 只放行版本的出处与按版本留存的历史记录", () => {
  assert.equal(isAllowlisted("package.json"), true);
  assert.equal(isAllowlisted("apps/desktop/package.json"), true);
  assert.equal(isAllowlisted("pnpm-lock.yaml"), true);
  assert.equal(isAllowlisted("CHANGELOG.md"), true);
  assert.equal(isAllowlisted("docs/releases/v0.6.2.md"), true);
  assert.equal(isAllowlisted("README.md"), false);
  assert.equal(isAllowlisted("deploy/README.md"), false);
});

test("collectProblems 发现两个 package.json 版本不一致", () => {
  const { directory, files } = fixtureRepository({ root: "2.0.0", desktop: "1.2.3" });
  const { problems } = collectProblems({ root: directory, files });

  assert.equal(problems.length, 1);
  assert.match(problems[0], /apps\/desktop\/package\.json 的版本 1\.2\.3 与根 package\.json 的 2\.0\.0 不一致/u);
});

test("collectProblems 发现非允许文件里写死的当前版本", () => {
  const { directory, files } = fixtureRepository({
    files: { "docs/guide.md": "当前版本 2.0.0\n", "CHANGELOG.md": "## [2.0.0]\n" }
  });
  const { problems } = collectProblems({ root: directory, files });

  assert.equal(problems.length, 1);
  assert.match(problems[0], /docs\/guide\.md:1 写死了当前版本 2\.0\.0/u);
});

test("collectProblems 在标签与版本不一致时报错", () => {
  const { directory, files } = fixtureRepository({});

  assert.deepEqual(collectProblems({ root: directory, files, tag: "v2.0.0" }).problems, []);
  assert.match(
    collectProblems({ root: directory, files, tag: "v1.2.3" }).problems.join("\n"),
    /标签 v1\.2\.3 与 package\.json 版本 v2\.0\.0 不一致/u
  );
});

test("collectProblems 对不合法的根版本报错", () => {
  const { directory, files } = fixtureRepository({ root: "latest", desktop: "latest" });
  const { problems } = collectProblems({ root: directory, files });

  assert.ok(problems.some((line) => /不是合法的语义版本/u.test(line)));
});

test("setVersion 同步写入两个 package.json，并返回每个文件的变化", () => {
  const { directory } = fixtureRepository({ root: "1.2.3", desktop: "1.2.3" });
  const changes = setVersion(directory, "2.0.0");

  assert.deepEqual(
    changes.map(({ path, from, to }) => ({ path, from, to })),
    [
      { path: "package.json", from: "1.2.3", to: "2.0.0" },
      { path: "apps/desktop/package.json", from: "1.2.3", to: "2.0.0" }
    ]
  );
  assert.equal(readVersion(readFileSync(join(directory, "package.json"), "utf8")), "2.0.0");
  assert.equal(readVersion(readFileSync(join(directory, "apps/desktop/package.json"), "utf8")), "2.0.0");
});

test("真实仓库的版本一致，且没有写死的当前版本（与 pnpm test 中的守卫相同）", () => {
  const { problems, version } = collectProblems({ root: repositoryRoot });

  assert.ok(version, "应能读出根版本");
  assert.deepEqual(problems, []);
});
