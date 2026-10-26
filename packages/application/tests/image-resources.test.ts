import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  createImageResourceResolver,
  downloadRemoteImage,
  normalizeDocumentAssetPath
} from "../src/index.js";

const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);

describe("Markdown 图片资源安全", () => {
  it("解码合法相对路径并拒绝越界与绝对路径", () => {
    expect(
      normalizeDocumentAssetPath(
        "./%E6%96%87%E6%A1%A3.assets/a%20b.png?raw=1"
      )
    ).toBe("文档.assets/a b.png");
    expect(() => normalizeDocumentAssetPath("../secret.png")).toThrow(
      "越过文档目录"
    );
    expect(() => normalizeDocumentAssetPath("C:/secret.png")).toThrow(
      "绝对图片路径"
    );
  });

  it("在发起请求前拒绝直接指向本机的远程地址", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      downloadRemoteImage("http://127.0.0.1/private.png", fetcher)
    ).rejects.toThrow("非公网 IP");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("缓存成功的远程图片并把失败转换为可诊断占位", async () => {
    const remoteLoader = vi
      .fn()
      .mockResolvedValueOnce({
        content: png,
        contentType: "image/png"
      })
      .mockRejectedValueOnce(new Error("网络不可用"));
    const resolve = createImageResourceResolver({ remoteLoader });
    const first = await resolve(
      "![a](https://example.com/a.png)\n![a2](https://example.com/a.png)",
      undefined
    );
    const failed = await resolve(
      "![b](https://example.com/b.png)",
      undefined
    );

    expect(remoteLoader).toHaveBeenCalledTimes(2);
    expect(first.sources.get("https://example.com/a.png")).toMatch(
      /^data:image\/png;base64,/u
    );
    expect(failed.sources.get("https://example.com/b.png")).toMatch(
      /^data:image\/svg\+xml;base64,/u
    );
    expect(failed.warnings[0]).toContain("网络不可用");
  });

  it("仅在显式授权时允许桌面读取上级、绝对及 file URI 图片", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "morphdoc-local-images-")
    );
    const documentRoot = path.join(directory, "docs");
    const imagePath = path.join(directory, "共享图片.png");
    try {
      await writeFile(imagePath, png);
      const resolve = createImageResourceResolver();
      const sources = [
        "../共享图片.png",
        imagePath,
        pathToFileURL(imagePath).href
      ];
      const markdown = sources
        .map((source) => `![图](${source.replace(/ /gu, "%20")})`)
        .join("\n");

      const restricted = await resolve(markdown, undefined, {
        localRoot: documentRoot
      });
      expect(restricted.warnings).toHaveLength(3);

      const unrestricted = await resolve(markdown, undefined, {
        localRoot: documentRoot,
        allowUnrestrictedLocalFiles: true
      });
      expect(unrestricted.warnings).toEqual([]);
      expect(unrestricted.sources).toHaveLength(3);
      for (const dataUrl of unrestricted.sources.values()) {
        expect(dataUrl).toMatch(/^data:image\/png;base64,/u);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
