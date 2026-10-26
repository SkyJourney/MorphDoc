import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveDesktopDocxTargetPath,
  saveDesktopDocx
} from "../src/desktop-docx-save.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

async function createTemporaryDirectory() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "morphdoc-desktop-docx-save-")
  );
  temporaryDirectories.push(directory);
  return directory;
}

describe("Desktop DOCX 原生保存", () => {
  it("在用户未填写扩展名时补充 .docx 并原样落盘", async () => {
    const directory = await createTemporaryDirectory();
    const content = Uint8Array.of(80, 75, 3, 4, 1, 2, 3);
    const selectedPath = path.join(directory, "桌面验收");

    const saved = await saveDesktopDocx(selectedPath, content);

    expect(saved).toEqual({
      targetPath: `${selectedPath}.docx`,
      fileName: "桌面验收.docx"
    });
    expect(await readFile(saved.targetPath)).toEqual(Buffer.from(content));
  });

  it("大小写不敏感地保留已有 DOCX 扩展名", () => {
    expect(resolveDesktopDocxTargetPath("报告.DOCX")).toBe(
      "报告.DOCX"
    );
  });

  it("拒绝空路径或空内容", async () => {
    await expect(
      saveDesktopDocx("", Uint8Array.of(80, 75))
    ).rejects.toThrow("DOCX 保存参数无效");
    await expect(
      saveDesktopDocx("报告.docx", new Uint8Array())
    ).rejects.toThrow("DOCX 保存参数无效");
  });
});
