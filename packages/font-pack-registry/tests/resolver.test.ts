import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverFontPacks,
  resolveFontPackFaces
} from "../src/index.js";
import { writeFontPack } from "./fixtures.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("字体包候选解析", () => {
  it("按家族别名、字重和样式精确匹配", async () => {
    const root = await mkdtemp(join(tmpdir(), "morphdoc-font-resolve-"));
    temporaryDirectories.push(root);
    await writeFontPack(root);
    const registry = await discoverFontPacks({ roots: [root], appVersion: "0.6.0" });
    const result = resolveFontPackFaces(
      [
        {
          family: "Theme Song",
          aliases: ["FandolSong"],
          weight: 400,
          style: "normal"
        },
        {
          family: "Theme Song",
          aliases: ["FandolSong"],
          weight: 700,
          style: "normal"
        }
      ],
      registry.packs,
      { reportMissing: true }
    );
    expect(result.resolved[0]?.matchedFamily).toBe("FandolSong");
    expect(result.unmatched).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("FONT_FACE_NOT_PROVIDED");
  });

  it("允许调用方显式指定字体包优先级", async () => {
    const root = await mkdtemp(join(tmpdir(), "morphdoc-font-priority-"));
    temporaryDirectories.push(root);
    await writeFontPack(root, { id: "alpha-pack" });
    await writeFontPack(root, { id: "preferred-pack" });
    const registry = await discoverFontPacks({ roots: [root], appVersion: "0.6.0" });
    const result = resolveFontPackFaces(
      [{ family: "FandolSong", weight: 400, style: "normal" }],
      registry.packs,
      { preferredPackIds: ["preferred-pack"] }
    );
    expect(result.resolved[0]?.pack.id).toBe("preferred-pack");
  });
});
