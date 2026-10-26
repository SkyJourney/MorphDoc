import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { getMakeNsisPath } from "app-builder-lib/out/toolsets/windows.js";
import { fontPackManifestSchema } from "@morphdoc/font-pack-registry";
import { verifyFontPack } from "./builder.js";

export const WINDOWS_FONT_PACK_ARCHITECTURE = "x86_64";

export interface BuildWindowsFontPackInstallerOptions {
  packRoot: string;
  appVersion: string;
  packId: string;
  packVersion: string;
  scriptPath: string;
  outputDirectory: string;
  iconPath?: string;
  reportPath?: string;
  fontPackRoot?: string;
  managerRoot?: string;
  registerUninstall?: boolean;
}

export interface WindowsFontPackInstallerReport {
  packId: string;
  packVersion: string;
  artifactPath: string;
  artifactName: string;
  bytes: number;
  sha256: string;
  nsisPath: string;
}

export interface CreateDesktopCompanionIncludeOptions {
  installerPath: string;
  baseIncludePath: string;
  outputPath: string;
  displayName: string;
}

function sha256(content: Uint8Array) {
  return createHash("sha256").update(content).digest("hex").toUpperCase();
}

function assertDefineValue(value: string, label: string) {
  if (value.includes('"') || value.includes("\r") || value.includes("\n")) {
    throw new Error(`${label} 包含 NSIS 定义不支持的字符`);
  }
  return value;
}

function define(name: string, value: string) {
  return `/D${name}=${assertDefineValue(value, name)}`;
}

export function windowsFontPackInstallerName(packId: string, version: string) {
  return `MorphDoc-FontPack-${packId}-${version}-${WINDOWS_FONT_PACK_ARCHITECTURE}-Setup.exe`;
}

export function createWindowsFontPackInstallerArguments(options: {
  packDirectory: string;
  packId: string;
  packVersion: string;
  packName: string;
  licensePath: string;
  outputPath: string;
  scriptPath: string;
  iconPath?: string;
  fontPackRoot?: string;
  managerRoot?: string;
  registerUninstall?: boolean;
}) {
  const argumentsList = [
    "/V2",
    "/INPUTCHARSET",
    "UTF8",
    define("PACK_DIRECTORY", resolve(options.packDirectory)),
    define("PACK_ID", options.packId),
    define("PACK_VERSION", options.packVersion),
    define("PACK_NAME", options.packName),
    define("PACK_LICENSE_FILE", resolve(options.licensePath)),
    define("OUTPUT_FILE", resolve(options.outputPath))
  ];
  if (options.iconPath) {
    argumentsList.push(define("ICON_FILE", resolve(options.iconPath)));
  }
  if (options.fontPackRoot) {
    argumentsList.push(define("FONT_PACK_ROOT", resolve(options.fontPackRoot)));
  }
  if (options.managerRoot) {
    argumentsList.push(define("MANAGER_ROOT", resolve(options.managerRoot)));
  }
  if (options.registerUninstall !== false) {
    argumentsList.push("/DREGISTER_UNINSTALL");
  }
  argumentsList.push(resolve(options.scriptPath));
  return argumentsList;
}

async function runProcess(
  executable: string,
  argumentsList: string[],
  environment?: NodeJS.ProcessEnv
) {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(executable, argumentsList, {
      env: environment,
      stdio: "inherit",
      windowsHide: true
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(
          new Error(
            `NSIS 编译失败：${signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`}`
          )
        );
      }
    });
  });
}

export async function buildWindowsFontPackInstaller(
  options: BuildWindowsFontPackInstallerOptions
): Promise<WindowsFontPackInstallerReport> {
  if (process.platform !== "win32") {
    throw new Error("字体包 NSIS 安装器只能在 Windows 上构建");
  }
  const verified = await verifyFontPack({
    root: options.packRoot,
    appVersion: options.appVersion,
    packId: options.packId,
    packVersion: options.packVersion
  });
  const packDirectory = resolve(verified.outputDirectory);
  const manifestPath = join(packDirectory, "font-pack.json");
  const manifest = fontPackManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")) as unknown
  );
  const scriptPath = resolve(options.scriptPath);
  const scriptStatus = await lstat(scriptPath);
  if (!scriptStatus.isFile() || scriptStatus.isSymbolicLink()) {
    throw new Error("字体包 NSIS 脚本不是受信任的普通文件");
  }
  const outputDirectory = resolve(options.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const artifactName = windowsFontPackInstallerName(
    options.packId,
    options.packVersion
  );
  const artifactPath = join(outputDirectory, artifactName);
  const nsis = await getMakeNsisPath(null);
  const argumentsList = createWindowsFontPackInstallerArguments({
    packDirectory,
    packId: manifest.id,
    packVersion: manifest.version,
    packName: manifest.name,
    licensePath: join(packDirectory, manifest.licenseFile),
    outputPath: artifactPath,
    scriptPath,
    ...(options.iconPath ? { iconPath: options.iconPath } : {}),
    ...(options.fontPackRoot ? { fontPackRoot: options.fontPackRoot } : {}),
    ...(options.managerRoot ? { managerRoot: options.managerRoot } : {}),
    ...(options.registerUninstall !== undefined
      ? { registerUninstall: options.registerUninstall }
      : {})
  });
  await runProcess(nsis.path, argumentsList, {
    ...process.env,
    ...nsis.env
  });
  const artifact = await readFile(artifactPath);
  const artifactStatus = await stat(artifactPath);
  const report: WindowsFontPackInstallerReport = {
    packId: manifest.id,
    packVersion: manifest.version,
    artifactPath,
    artifactName,
    bytes: artifactStatus.size,
    sha256: sha256(artifact),
    nsisPath: nsis.path
  };
  if (options.reportPath) {
    const reportPath = resolve(options.reportPath);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  return report;
}

export async function createDesktopCompanionInclude(
  options: CreateDesktopCompanionIncludeOptions
) {
  const installerPath = resolve(options.installerPath);
  const status = await lstat(installerPath);
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new Error("字体包伴随安装器不是受信任的普通文件");
  }
  const installerHash = sha256(await readFile(installerPath));
  const include = [
    `!define FONT_PACK_COMPANION_FILE "${assertDefineValue(basename(installerPath), "伴随安装器文件名")}"`,
    `!define FONT_PACK_COMPANION_SHA256 "${installerHash}"`,
    `!define FONT_PACK_COMPANION_NAME "${assertDefineValue(options.displayName, "伴随安装器名称")}"`,
    `!include "${assertDefineValue(resolve(options.baseIncludePath), "基础安装脚本路径")}"`,
    ""
  ].join("\n");
  const outputPath = resolve(options.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, include, "utf8");
  return {
    outputPath,
    installerPath,
    installerHash
  };
}
