import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverFontPacks,
  readInstalledFontPackAsset
} from "../src/index.js";
import { writeFontPack } from "./fixtures.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "morphdoc-font-pack-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("字体包注册器", () => {
  it("发现并验证兼容字体包，生成稳定指纹", async () => {
    const root = await temporaryDirectory();
    await writeFontPack(root);
    const first = await discoverFontPacks({ roots: [root], appVersion: "0.6.0" });
    const second = await discoverFontPacks({ roots: [root], appVersion: "0.6.0" });
    expect(first.packs).toHaveLength(1);
    expect(first.diagnostics).toEqual([]);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(await readInstalledFontPackAsset(first.packs[0]!.faces[0]!.docx)).toEqual(
      new Uint8Array([4, 5, 6, 7])
    );
  });

  it("同一根目录选择最高兼容版本并记录被覆盖版本", async () => {
    const root = await temporaryDirectory();
    await writeFontPack(root, { version: "1.0.0" });
    await writeFontPack(root, { version: "1.2.0" });
    const result = await discoverFontPacks({ roots: [root], appVersion: "0.6.0" });
    expect(result.packs[0]?.version).toBe("1.2.0");
    expect(result.diagnostics.map((item) => item.code)).toContain("PACK_SHADOWED");
  });

  it("多根目录优先使用靠前根目录中的包", async () => {
    const firstRoot = await temporaryDirectory();
    const secondRoot = await temporaryDirectory();
    await writeFontPack(firstRoot, { version: "1.0.0" });
    await writeFontPack(secondRoot, { version: "2.0.0" });
    const result = await discoverFontPacks({
      roots: [firstRoot, secondRoot],
      appVersion: "0.6.0"
    });
    expect(result.packs[0]?.version).toBe("1.0.0");
  });

  it("隔离不兼容和哈希错误的字体包", async () => {
    const root = await temporaryDirectory();
    await writeFontPack(root, {
      id: "future-pack",
      minimumAppVersion: "0.7.0"
    });
    await writeFontPack(root, { id: "broken-pack", corruptWebHash: true });
    const result = await discoverFontPacks({ roots: [root], appVersion: "0.6.0" });
    expect(result.packs).toEqual([]);
    expect(result.diagnostics.map((item) => item.code).sort()).toEqual([
      "MANIFEST_INVALID",
      "PACK_INCOMPATIBLE"
    ]);
  });

  it("读取时重新验证资源，拒绝注册后被替换的文件", async () => {
    const root = await temporaryDirectory();
    await writeFontPack(root);
    const result = await discoverFontPacks({ roots: [root], appVersion: "0.6.0" });
    const asset = result.packs[0]!.faces[0]!.web;
    await writeFile(asset.absolutePath, new Uint8Array([9, 9, 9]));
    await expect(readInstalledFontPackAsset(asset)).rejects.toThrow("SHA-256");
  });

  it("根目录缺失时返回信息诊断而不阻断", async () => {
    const root = join(await temporaryDirectory(), "missing");
    const result = await discoverFontPacks({ roots: [root], appVersion: "0.6.0" });
    expect(result.packs).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe("ROOT_NOT_FOUND");
  });
});
