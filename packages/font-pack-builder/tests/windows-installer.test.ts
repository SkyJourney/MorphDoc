import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDesktopCompanionInclude,
  createWindowsFontPackInstallerArguments,
  windowsFontPackInstallerName
} from "../src/index.js";

const temporaryDirectories: string[] = [];
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Windows 字体包安装器构建", () => {
  it("保持用户级原子安装和精确卸载边界", async () => {
    const script = await readFile(
      join(repositoryRoot, "font-packs", "windows", "font-pack-installer.nsi"),
      "utf8"
    );
    expect(script).toContain(
      '$LOCALAPPDATA\\morphdoc\\font-packs'
    );
    expect(script).toContain(".installing-${PACK_ID}");
    expect(script).toContain(".backup-${PACK_ID}");
    expect(script).toContain('Rename "$R0\\${PACK_ID}" "$R1"');
    expect(script).toContain(
      'RMDir /r "${FONT_PACK_ROOT}\\${PACK_ID}"'
    );
    expect(script).not.toContain("Windows\\Fonts");
  });

  it("生成稳定发行文件名和完整 NSIS 定义", () => {
    expect(windowsFontPackInstallerName("morphdoc-serif-sc", "1.0.0")).toBe(
      "MorphDoc-FontPack-morphdoc-serif-sc-1.0.0-x86_64-Setup.exe"
    );
    const args = createWindowsFontPackInstallerArguments({
      packDirectory: "C:/pack",
      packId: "morphdoc-serif-sc",
      packVersion: "1.0.0",
      packName: "测试字体包",
      licensePath: "C:/pack/LICENSE.txt",
      outputPath: "C:/out/setup.exe",
      scriptPath: "C:/repo/font-pack-installer.nsi",
      registerUninstall: false
    });
    expect(args).toContain("/DPACK_ID=morphdoc-serif-sc");
    expect(args).toContain("/DPACK_VERSION=1.0.0");
    expect(args.slice(0, 3)).toEqual(["/V2", "/INPUTCHARSET", "UTF8"]);
    expect(args).not.toContain("/DREGISTER_UNINSTALL");
    expect(args.at(-1)).toMatch(/font-pack-installer\.nsi$/u);
  });

  it("生成绑定同目录文件名与 SHA-256 的桌面 include", async () => {
    const root = await mkdtemp(join(tmpdir(), "morphdoc-font-companion-"));
    temporaryDirectories.push(root);
    const installer = join(root, "font-setup.exe");
    const baseInclude = join(root, "installer.nsh");
    const output = join(root, "generated", "companion.nsh");
    await Promise.all([
      writeFile(installer, "installer", "utf8"),
      writeFile(baseInclude, "!macro customInstall\n!macroend\n", "utf8")
    ]);
    const result = await createDesktopCompanionInclude({
      installerPath: installer,
      baseIncludePath: baseInclude,
      outputPath: output,
      displayName: "测试字体包"
    });
    const expected = createHash("sha256")
      .update("installer")
      .digest("hex")
      .toUpperCase();
    const content = await readFile(output, "utf8");
    expect(result.installerHash).toBe(expected);
    expect(content).toContain('FONT_PACK_COMPANION_FILE "font-setup.exe"');
    expect(content).toContain(`FONT_PACK_COMPANION_SHA256 "${expected}"`);
    expect(content).toContain(baseInclude);
  });
});
