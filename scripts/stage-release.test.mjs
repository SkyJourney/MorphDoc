import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { unzipSync } from "fflate";
import {
  checksumText,
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

test("正式发布不再拆分独立字体安装器和 ZIP", () => {
  assert.doesNotMatch(stageReleaseSource, /MorphDoc-FontPack-/u);
  assert.doesNotMatch(stageReleaseSource, /fontPackArtifacts/u);
});
