import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { unzipSync } from "fflate";
import {
  checksumText,
  collectDesktopNames,
  createDeploymentArchive,
  normalizeVersion,
  parseArguments
} from "./stage-release.mjs";

const stageReleaseSource = await readFile(
  new URL("./stage-release.mjs", import.meta.url),
  "utf8"
);

test("normalizeVersion 接受语义版本并移除 v 前缀", () => {
  assert.equal(normalizeVersion("v0.6.0"), "0.6.0");
  assert.equal(normalizeVersion("1.2.3-beta.1"), "1.2.3-beta.1");
  assert.throws(() => normalizeVersion("latest"), /无效发布版本/u);
});

test("parseArguments 拒绝不完整参数", () => {
  assert.deepEqual(
    [...parseArguments(["--version", "0.6.0", "--image", "test:1"])],
    [
      ["version", "0.6.0"],
      ["image", "test:1"]
    ]
  );
  assert.throws(() => parseArguments(["--version"]), /无效命令参数/u);
});

test("checksumText 生成标准 SHA256SUMS 格式", () => {
  assert.equal(
    checksumText([{ name: "artifact.zip", sha256: "abc" }]),
    "abc  artifact.zip\n"
  );
});

test("Web 离线部署 ZIP 包含 Compose 和导入说明", async () => {
  const directory = await mkdtemp(join(tmpdir(), "morphdoc-release-test-"));
  const output = join(directory, "deploy.zip");
  try {
    await createDeploymentArchive("0.6.0", output);
    const entries = unzipSync(new Uint8Array(await readFile(output)));
    const names = Object.keys(entries).sort();
    assert.ok(names.includes("MorphDoc-Web-0.6.0-deploy/compose.yaml"));
    assert.ok(names.includes("MorphDoc-Web-0.6.0-deploy/.env.example"));
    assert.ok(names.includes("MorphDoc-Web-0.6.0-deploy/OFFLINE-README.md"));
    assert.match(
      Buffer.from(
        entries["MorphDoc-Web-0.6.0-deploy/OFFLINE-README.md"]
      ).toString("utf8"),
      /docker load/u
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("parseArguments 支持 --release-notes 路径参数", () => {
  assert.equal(
    parseArguments(["--release-notes", "notes/dry-run.md"]).get("release-notes"),
    "notes/dry-run.md"
  );
});

/**
 * 在临时目录中按给定文件名与内容创建桌面产物，并在回调结束后清理。
 */
async function withDesktopDirectory(files, callback) {
  const directory = await mkdtemp(join(tmpdir(), "morphdoc-desktop-test-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(directory, name), content);
    }
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("collectDesktopNames 仅有 Windows 产物时不收录 dmg", async () => {
  await withDesktopDirectory(
    {
      "MorphDoc-1.0.0-x86_64-Setup.exe": "setup",
      "MorphDoc-1.0.0-x86_64.zip": "zip"
    },
    async (directory) => {
      assert.deepEqual(await collectDesktopNames(directory, "1.0.0"), [
        "MorphDoc-1.0.0-x86_64-Setup.exe",
        "MorphDoc-1.0.0-x86_64.zip"
      ]);
    }
  );
});

test("collectDesktopNames 按固定顺序收录已存在的 dmg", async () => {
  await withDesktopDirectory(
    {
      "MorphDoc-1.0.0-x86_64-Setup.exe": "setup",
      "MorphDoc-1.0.0-x86_64.zip": "zip",
      "MorphDoc-1.0.0-x64.dmg": "intel",
      "MorphDoc-1.0.0-arm64.dmg": "arm"
    },
    async (directory) => {
      assert.deepEqual(await collectDesktopNames(directory, "1.0.0"), [
        "MorphDoc-1.0.0-x86_64-Setup.exe",
        "MorphDoc-1.0.0-x86_64.zip",
        "MorphDoc-1.0.0-arm64.dmg",
        "MorphDoc-1.0.0-x64.dmg"
      ]);
    }
  );
});

test("collectDesktopNames 遇到空 dmg 必须报错而不是静默跳过", async () => {
  await withDesktopDirectory(
    {
      "MorphDoc-1.0.0-x86_64-Setup.exe": "setup",
      "MorphDoc-1.0.0-x86_64.zip": "zip",
      "MorphDoc-1.0.0-arm64.dmg": ""
    },
    async (directory) => {
      await assert.rejects(
        () => collectDesktopNames(directory, "1.0.0"),
        /发布源文件无效/u
      );
    }
  );
});

test("正式发布不再拆分独立字体安装器和 ZIP", () => {
  assert.doesNotMatch(stageReleaseSource, /MorphDoc-FontPack-/u);
  assert.doesNotMatch(stageReleaseSource, /fontPackArtifacts/u);
});
