import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  extractRequiredFiles,
  sha256
} from "../scripts/prepare-pandoc-runtime.mjs";

const artifact = {
  executableRelativePath: "pandoc.exe",
  licenseFiles: ["COPYING.rtf", "COPYRIGHT.txt"]
};

function archive(files: Record<string, string>) {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, content]) => [
        name,
        strToU8(content)
      ])
    )
  );
}

describe("Desktop Pandoc 最小运行时构建", () => {
  it("仅提取可执行文件和两份许可证文件", () => {
    const files = extractRequiredFiles(
      archive({
        "pandoc-3.9.0.2/pandoc.exe": "executable",
        "pandoc-3.9.0.2/COPYING.rtf": "license",
        "pandoc-3.9.0.2/COPYRIGHT.txt": "copyright",
        "pandoc-3.9.0.2/MANUAL.html": "manual"
      }),
      artifact
    );

    expect([...files.keys()].sort()).toEqual([
      "COPYING.rtf",
      "COPYRIGHT.txt",
      "pandoc.exe"
    ]);
  });

  it("拒绝缺失许可证文件的归档", () => {
    expect(() =>
      extractRequiredFiles(
        archive({
          "pandoc.exe": "executable",
          "COPYING.rtf": "license"
        }),
        artifact
      )
    ).toThrow("COPYRIGHT.txt");
  });

  it("拒绝用不同目录伪造的重复文件", () => {
    expect(() =>
      extractRequiredFiles(
        archive({
          "official/pandoc.exe": "official",
          "shadow/pandoc.exe": "shadow",
          "official/COPYING.rtf": "license",
          "official/COPYRIGHT.txt": "copyright"
        }),
        artifact
      )
    ).toThrow("重复文件：pandoc.exe");
  });

  it("使用大写十六进制输出稳定 SHA-256", () => {
    const content = strToU8("MorphDoc");
    expect(sha256(content)).toBe(
      createHash("sha256").update(content).digest("hex").toUpperCase()
    );
  });
});
