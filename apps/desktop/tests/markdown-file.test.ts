import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createMarkdownContentHash,
  createMarkdownDocumentKey,
  findMarkdownFileArgument,
  isMarkdownFilePath,
  readMarkdownDocument,
  readMarkdownFileSnapshot
} from "../src/markdown-file.js";

describe("桌面 Markdown 文件参数", () => {
  it("识别两种 Markdown 扩展名且忽略大小写", () => {
    expect(isMarkdownFilePath("C:\\docs\\周报.md")).toBe(true);
    expect(isMarkdownFilePath("C:\\docs\\说明.MARKDOWN")).toBe(true);
    expect(isMarkdownFilePath("C:\\docs\\说明.txt")).toBe(false);
  });

  // findMarkdownFileArgument 依赖 Node 的 path 模块识别绝对路径，其行为
  // 随宿主 OS 而定：Windows 风格盘符路径只有在 Windows 宿主上才会被
  // 识别为绝对路径，这与真实部署一致（Windows 安装包只会在 Windows 上
  // 收到 Windows 风格的启动参数），因此该用例仅在 Windows 宿主上有意义。
  it.runIf(process.platform === "win32")("从启动参数中提取绝对 Markdown 路径", () => {
    expect(
      findMarkdownFileArgument(
        [
          "C:\\Program Files\\morphdoc\\morphdoc.exe",
          "--original-process-start-time=1",
          "D:\\文档\\项目周报.md"
        ],
        "C:\\Windows"
      )
    ).toBe(path.normalize("D:\\文档\\项目周报.md"));
  });

  it("根据第二实例的工作目录解析相对路径", () => {
    expect(
      findMarkdownFileArgument(
        ["morphdoc.exe", "docs\\readme.markdown"],
        "D:\\项目"
      )
    ).toBe(path.resolve("D:\\项目", "docs\\readme.markdown"));
  });

  it("忽略非 Markdown 文件及 Chromium 参数", () => {
    expect(
      findMarkdownFileArgument(
        ["morphdoc.exe", "--inspect", "notes.txt"],
        "C:\\项目"
      )
    ).toBeUndefined();
  });

  it("统一读取 Markdown 并限制解码后的字符数", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "morphdoc-markdown-")
    );
    const filePath = path.join(directory, "示例.md");
    try {
      await writeFile(filePath, "# 示例", "utf8");
      await expect(
        readMarkdownDocument(filePath, 20)
      ).resolves.toEqual({
        markdown: "# 示例",
        fileName: "示例.md"
      });
      await expect(
        readMarkdownDocument(filePath, 2)
      ).rejects.toThrow("Markdown 文件过大");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("拒绝非 Markdown 扩展名", async () => {
    await expect(
      readMarkdownDocument("C:\\docs\\说明.txt", 100)
    ).rejects.toThrow("只允许打开 .md 或 .markdown 文件");
  });

  it("使用真实路径和内容哈希创建文件快照", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "morphdoc-snapshot-")
    );
    const filePath = path.join(directory, "快照.md");
    try {
      await writeFile(filePath, "# 第一版", "utf8");
      // readMarkdownFileSnapshot 内部会 realpath 解析符号链接（例如 macOS
      // 的 /var -> /private/var），返回的是规范化路径，因此断言也需要对
      // 同一路径做 realpath，而不是直接比较 mkdtemp 拼接出的原始路径。
      const canonicalFilePath = await realpath(filePath);
      const snapshot = await readMarkdownFileSnapshot(filePath, 100);

      expect(snapshot.document).toEqual({
        markdown: "# 第一版",
        fileName: "快照.md"
      });
      expect(snapshot.filePath).toBe(canonicalFilePath);
      expect(snapshot.documentKey).toBe(
        createMarkdownDocumentKey(canonicalFilePath)
      );
      expect(snapshot.contentHash).toBe(
        createMarkdownContentHash("# 第一版")
      );

      await writeFile(filePath, "# 第二版", "utf8");
      const changed = await readMarkdownFileSnapshot(filePath, 100);
      expect(changed.contentHash).not.toBe(snapshot.contentHash);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
