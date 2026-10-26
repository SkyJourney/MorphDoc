import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDeterministicFontPackArchive,
  fontPackArchiveName
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("字体包 ZIP 发行附件", () => {
  it("使用 MorphDoc 品牌和稳定文件名", () => {
    expect(fontPackArchiveName("morphdoc-serif-sc", "1.0.0")).toBe(
      "MorphDoc-FontPack-morphdoc-serif-sc-1.0.0.zip"
    );
  });

  it("生成可复现且可直接解压到字体包根目录的归档", async () => {
    const root = await mkdtemp(join(tmpdir(), "morphdoc-font-archive-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "fonts"), { recursive: true });
    await Promise.all([
      writeFile(join(root, "font-pack.json"), "{}\n", "utf8"),
      writeFile(join(root, "fonts", "Regular.ttf"), new Uint8Array([1, 2, 3]))
    ]);

    const first = await createDeterministicFontPackArchive(
      root,
      "morphdoc-serif-sc/1.0.0"
    );
    const second = await createDeterministicFontPackArchive(
      root,
      "morphdoc-serif-sc/1.0.0"
    );
    expect(first.content).toEqual(second.content);
    expect(first.entries).toEqual([
      "morphdoc-serif-sc/1.0.0/font-pack.json",
      "morphdoc-serif-sc/1.0.0/fonts/Regular.ttf"
    ]);
    const entries = unzipSync(first.content);
    expect(new TextDecoder().decode(entries[first.entries[0]!])).toBe("{}\n");
    expect(entries[first.entries[1]!]).toEqual(new Uint8Array([1, 2, 3]));
  });
});
