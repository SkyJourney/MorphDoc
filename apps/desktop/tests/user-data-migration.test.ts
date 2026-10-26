import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { migrateLegacyUserData } from "../src/user-data-migration.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

async function createRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "morphdoc-migration-"));
  temporaryDirectories.push(root);
  return root;
}

describe("品牌升级用户数据迁移", () => {
  it("首次启动时复制状态、主题和浏览器本地存储但保留旧目录", async () => {
    const root = await createRoot();
    const legacy = path.join(root, "Markdown PDF 导出器");
    const target = path.join(root, "MorphDoc");
    await mkdir(path.join(legacy, "themes", "custom"), {
      recursive: true
    });
    await mkdir(path.join(legacy, "Local Storage"), {
      recursive: true
    });
    await writeFile(
      path.join(legacy, "window-state.json"),
      '{"width":1280}',
      "utf8"
    );
    await writeFile(
      path.join(legacy, "themes", "custom", "theme.css"),
      "#write{}",
      "utf8"
    );

    const result = await migrateLegacyUserData([legacy], target);

    expect(result).toMatchObject({
      migrated: true,
      sourceDirectory: legacy,
      copiedEntries: ["window-state.json", "themes", "Local Storage"]
    });
    expect(
      await readFile(path.join(target, "window-state.json"), "utf8")
    ).toBe('{"width":1280}');
    expect(
      await readFile(
        path.join(target, "themes", "custom", "theme.css"),
        "utf8"
      )
    ).toBe("#write{}");
    expect(
      await readFile(path.join(legacy, "window-state.json"), "utf8")
    ).toBe('{"width":1280}');
  });

  it("目标目录已经存在时不覆盖新版本数据", async () => {
    const root = await createRoot();
    const legacy = path.join(root, "Markdown PDF 导出器");
    const target = path.join(root, "MorphDoc");
    await mkdir(legacy, { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(path.join(legacy, "window-state.json"), "legacy", "utf8");
    await writeFile(path.join(target, "window-state.json"), "current", "utf8");

    expect(await migrateLegacyUserData([legacy], target)).toEqual({
      migrated: false,
      copiedEntries: []
    });
    expect(
      await readFile(path.join(target, "window-state.json"), "utf8")
    ).toBe("current");
  });
});
