import {
  mkdir,
  mkdtemp,
  readFile,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SaveLocationStore,
  loadSaveLocationState,
  parseSaveLocationState,
  resolveDefaultSavePath,
  saveSaveLocationState
} from "../src/save-location-state.js";

let temporaryDirectory: string | undefined;

async function createTemporaryDirectory() {
  temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "morphdoc-save-location-")
  );
  return temporaryDirectory;
}

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

describe("桌面默认保存位置", () => {
  it("只接受版本匹配的绝对目录状态", () => {
    expect(
      parseSaveLocationState({
        version: 1,
        directory: path.resolve("C:/Documents")
      })
    ).toEqual({
      version: 1,
      directory: path.resolve("C:/Documents")
    });
    expect(
      parseSaveLocationState({ version: 2, directory: "C:/Documents" })
    ).toBeUndefined();
    expect(
      parseSaveLocationState({ version: 1, directory: "relative" })
    ).toBeUndefined();
  });

  it("优先使用有效的源文件目录", async () => {
    const root = await createTemporaryDirectory();
    const sourceDirectory = path.join(root, "source");
    const historyDirectory = path.join(root, "history");
    const documentsDirectory = path.join(root, "documents");
    await Promise.all([
      mkdir(sourceDirectory),
      mkdir(historyDirectory),
      mkdir(documentsDirectory)
    ]);

    await expect(
      resolveDefaultSavePath({
        sourceFilePath: path.join(sourceDirectory, "source.md"),
        lastSaveDirectory: historyDirectory,
        documentsDirectory,
        suggestedFileName: "report.pdf"
      })
    ).resolves.toBe(path.join(sourceDirectory, "report.pdf"));
  });

  it("源目录不可用时使用最近成功目录", async () => {
    const root = await createTemporaryDirectory();
    const historyDirectory = path.join(root, "history");
    const documentsDirectory = path.join(root, "documents");
    await Promise.all([
      mkdir(historyDirectory),
      mkdir(documentsDirectory)
    ]);

    await expect(
      resolveDefaultSavePath({
        sourceFilePath: path.join(root, "missing", "source.md"),
        lastSaveDirectory: historyDirectory,
        documentsDirectory,
        suggestedFileName: "report.docx"
      })
    ).resolves.toBe(path.join(historyDirectory, "report.docx"));
  });

  it("源目录和历史目录均不可用时回退到文档目录", async () => {
    const root = await createTemporaryDirectory();
    const documentsDirectory = path.join(root, "documents");
    await mkdir(documentsDirectory);

    await expect(
      resolveDefaultSavePath({
        lastSaveDirectory: path.join(root, "missing"),
        documentsDirectory,
        suggestedFileName: "draft.md"
      })
    ).resolves.toBe(path.join(documentsDirectory, "draft.md"));
  });

  it("以原子 JSON 状态持久化并恢复最近目录", async () => {
    const root = await createTemporaryDirectory();
    const directory = path.join(root, "saved");
    const statePath = path.join(root, "state", "save-location.json");
    await mkdir(directory);

    await saveSaveLocationState(statePath, directory);

    await expect(loadSaveLocationState(statePath)).resolves.toEqual({
      version: 1,
      directory
    });
    expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual({
      version: 1,
      directory
    });
  });

  it("跨 Store 实例恢复最近成功文件目录", async () => {
    const root = await createTemporaryDirectory();
    const savedDirectory = path.join(root, "saved");
    const documentsDirectory = path.join(root, "documents");
    const statePath = path.join(root, "save-location.json");
    await Promise.all([
      mkdir(savedDirectory),
      mkdir(documentsDirectory)
    ]);
    const first = new SaveLocationStore(
      statePath,
      documentsDirectory
    );
    await first.initialize();
    await first.recordSuccessfulFile(
      path.join(savedDirectory, "first.pdf")
    );

    const restored = new SaveLocationStore(
      statePath,
      documentsDirectory
    );
    await restored.initialize();

    await expect(
      restored.resolveDefaultPath(undefined, "second.docx")
    ).resolves.toBe(path.join(savedDirectory, "second.docx"));
  });
});
