import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const desktopRoot = path.join(projectRoot, "apps", "desktop");
const manifestPath = path.join(
  projectRoot,
  "packages",
  "docx-engine",
  "src",
  "pandoc-runtime.json"
);
const maximumArchiveBytes = 64 * 1024 * 1024;
const maximumExtractedBytes = 256 * 1024 * 1024;
const downloadTimeoutMs = 120_000;

function sha256(content) {
  return createHash("sha256").update(content).digest("hex").toUpperCase();
}

function normalizedBaseName(fileName) {
  return fileName.replaceAll("\\", "/").split("/").filter(Boolean).at(-1);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function platformDirectoryName(platform, architecture) {
  if (platform === "win32" && architecture === "x64") {
    return "windows-x86_64";
  }
  if (platform === "darwin" && (architecture === "arm64" || architecture === "x64")) {
    return `darwin-${architecture}`;
  }
  throw new Error(`不支持的 Pandoc 桌面内置目标：${platform}/${architecture}`);
}

/** 归档下载得到的、需要从压缩包内部提取的文件名（不含通过 licenseSource 单独下载的许可证文件）。 */
function archiveRequiredNames(artifact) {
  const licenseSource = artifact.licenseSource ?? {};
  return [
    normalizedBaseName(artifact.executableRelativePath),
    ...artifact.licenseFiles
      .filter((fileName) => !licenseSource[fileName])
      .map(normalizedBaseName)
  ];
}

async function readRuntimeManifest({ platform, architecture }) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const artifact = manifest.artifacts?.find(
    (candidate) =>
      candidate.platform === platform && candidate.architecture === architecture
  );
  if (!artifact) {
    throw new Error(`Pandoc 清单缺少 ${platform}/${architecture} 发行项`);
  }
  if (artifact.archiveType !== "zip") {
    throw new Error(`Pandoc 清单要求 ${platform}/${architecture} 为 ZIP 发行项`);
  }
  const requiredNames = [
    normalizedBaseName(artifact.executableRelativePath),
    ...artifact.licenseFiles.map(normalizedBaseName)
  ];
  if (
    requiredNames.some(
      (fileName) =>
        !fileName ||
        !Number.isInteger(artifact.files?.[fileName]?.bytes) ||
        !/^[A-F0-9]{64}$/u.test(artifact.files?.[fileName]?.sha256 ?? "")
    )
  ) {
    throw new Error("Pandoc 清单缺少最小运行时文件哈希或长度");
  }
  return { manifest, artifact };
}

async function downloadArchive(downloadUrl, destination) {
  const response = await fetch(downloadUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(downloadTimeoutMs)
  });
  if (!response.ok) {
    throw new Error(`Pandoc 下载失败：HTTP ${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > maximumArchiveBytes
  ) {
    throw new Error("Pandoc 归档超过允许的下载大小");
  }
  const content = new Uint8Array(await response.arrayBuffer());
  if (content.byteLength > maximumArchiveBytes) {
    throw new Error("Pandoc 归档超过允许的下载大小");
  }
  await writeFile(destination, content);
  return content;
}

async function downloadLicenseSourceFile(downloadUrl) {
  const response = await fetch(downloadUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(downloadTimeoutMs)
  });
  if (!response.ok) {
    throw new Error(`Pandoc 许可证文件下载失败：HTTP ${response.status}`);
  }
  const content = new Uint8Array(await response.arrayBuffer());
  if (content.byteLength > maximumExtractedBytes) {
    throw new Error("Pandoc 许可证文件超过允许的下载大小");
  }
  return content;
}

/**
 * 部分平台（如 macOS）的官方归档不随附许可证文件，需要按清单声明的
 * 独立来源单独下载；返回的文件与归档内提取的文件合并后一并校验哈希。
 */
async function loadLicenseSourceFiles(artifact) {
  const files = new Map();
  for (const [fileName, source] of Object.entries(artifact.licenseSource ?? {})) {
    files.set(fileName, await downloadLicenseSourceFile(source.downloadUrl));
  }
  return files;
}

async function loadVerifiedArchive(artifact, archivePath) {
  if (await fileExists(archivePath)) {
    const cached = new Uint8Array(await readFile(archivePath));
    if (sha256(cached) === artifact.sha256) {
      return cached;
    }
    await rm(archivePath, { force: true });
  }

  const partialPath = `${archivePath}.${process.pid}.partial`;
  await rm(partialPath, { force: true });
  try {
    const downloaded = await downloadArchive(
      artifact.downloadUrl,
      partialPath
    );
    const actualHash = sha256(downloaded);
    if (actualHash !== artifact.sha256) {
      throw new Error(
        `Pandoc 归档 SHA-256 不匹配：期望 ${artifact.sha256}，实际 ${actualHash}`
      );
    }
    await rename(partialPath, archivePath);
    return downloaded;
  } finally {
    await rm(partialPath, { force: true });
  }
}

function extractRequiredFiles(archive, artifact) {
  const requiredNames = new Set(archiveRequiredNames(artifact));
  let selectedBytes = 0;
  const entries = unzipSync(archive, {
    filter(file) {
      const selected = requiredNames.has(normalizedBaseName(file.name));
      if (selected) {
        selectedBytes += file.originalSize;
        if (selectedBytes > maximumExtractedBytes) {
          throw new Error("Pandoc 最小运行时超过允许的解压大小");
        }
      }
      return selected;
    }
  });
  const files = new Map();
  for (const [entryName, content] of Object.entries(entries)) {
    const baseName = normalizedBaseName(entryName);
    if (!baseName || !requiredNames.has(baseName)) {
      continue;
    }
    if (files.has(baseName)) {
      throw new Error(`Pandoc 归档包含重复文件：${baseName}`);
    }
    files.set(baseName, content);
  }
  for (const requiredName of requiredNames) {
    if (!files.has(requiredName)) {
      throw new Error(`Pandoc 归档缺少必须文件：${requiredName}`);
    }
  }
  return files;
}

function verifyPandocVersion(executablePath, expectedVersion) {
  const result = spawnSync(executablePath, ["--version"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024,
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    throw new Error(`内置 Pandoc 无法执行：${result.error?.message ?? result.stderr}`);
  }
  const firstLine = result.stdout.split(/\r?\n/u)[0]?.trim();
  if (firstLine !== `pandoc ${expectedVersion}`) {
    throw new Error(
      `内置 Pandoc 版本不匹配：期望 pandoc ${expectedVersion}，实际 ${firstLine ?? "未知"}`
    );
  }
}

async function smokeTestPandoc(executablePath) {
  const smokeRoot = path.join(
    tmpdir(),
    `morphdoc-pandoc-smoke-${process.pid}-${Date.now()}`
  );
  const dataDirectory = path.join(smokeRoot, "data");
  const outputPath = path.join(smokeRoot, "smoke.docx");
  await mkdir(dataDirectory, { recursive: true });
  try {
    const result = spawnSync(
      executablePath,
      [
        "--from=gfm",
        "--to=docx",
        `--data-dir=${dataDirectory}`,
        `--output=${outputPath}`
      ],
      {
        encoding: "utf8",
        input: "# 墨呈\n\nPandoc 运行时冒烟测试。\n",
        maxBuffer: 1024 * 1024,
        windowsHide: true
      }
    );
    if (result.error || result.status !== 0) {
      throw new Error(`内置 Pandoc DOCX 冒烟失败：${result.error?.message ?? result.stderr}`);
    }
    const output = await readFile(outputPath);
    if (output.byteLength < 1024 || output[0] !== 0x50 || output[1] !== 0x4b) {
      throw new Error("内置 Pandoc 生成的 DOCX 不是有效 ZIP 包");
    }
  } finally {
    await rm(smokeRoot, { recursive: true, force: true });
  }
}

async function verifyPreparedRuntime(targetDirectory, manifest, artifact) {
  const auditPath = path.join(targetDirectory, "runtime-manifest.json");
  if (!(await fileExists(auditPath))) {
    return false;
  }
  try {
    const audit = JSON.parse(await readFile(auditPath, "utf8"));
    if (
      audit.version !== manifest.version ||
      audit.archiveSha256 !== artifact.sha256 ||
      audit.downloadUrl !== artifact.downloadUrl
    ) {
      return false;
    }
    const expectedFiles = [
      normalizedBaseName(artifact.executableRelativePath),
      ...artifact.licenseFiles.map(normalizedBaseName)
    ];
    for (const fileName of expectedFiles) {
      const content = await readFile(path.join(targetDirectory, fileName));
      const expected = artifact.files[fileName];
      if (
        !expected ||
        content.byteLength !== expected.bytes ||
        sha256(content) !== expected.sha256 ||
        audit.files?.[fileName]?.sha256 !== expected.sha256
      ) {
        return false;
      }
    }
    const executablePath = path.join(
      targetDirectory,
      normalizedBaseName(artifact.executableRelativePath)
    );
    verifyPandocVersion(executablePath, manifest.version);
    await smokeTestPandoc(executablePath);
    return true;
  } catch {
    return false;
  }
}

async function preparePandocRuntime({
  checkOnly = false,
  platform = process.platform,
  architecture = process.arch
} = {}) {
  const { manifest, artifact } = await readRuntimeManifest({ platform, architecture });
  const platformDirectory = platformDirectoryName(platform, architecture);
  const runtimeRoot = path.join(desktopRoot, ".runtime", "pandoc");
  const targetDirectory = path.join(
    runtimeRoot,
    manifest.version,
    platformDirectory
  );
  if (await verifyPreparedRuntime(targetDirectory, manifest, artifact)) {
    console.log(`Pandoc ${manifest.version} 最小运行时已通过校验`);
    return targetDirectory;
  }
  if (checkOnly) {
    throw new Error("Pandoc 最小运行时缺失或未通过完整性校验");
  }

  const downloadDirectory = path.join(runtimeRoot, "downloads");
  await mkdir(downloadDirectory, { recursive: true });
  const archiveName = new URL(artifact.downloadUrl).pathname.split("/").at(-1);
  if (!archiveName) {
    throw new Error("Pandoc 下载地址缺少归档文件名");
  }
  const archivePath = path.join(downloadDirectory, archiveName);
  const archive = await loadVerifiedArchive(artifact, archivePath);
  const files = new Map([
    ...extractRequiredFiles(archive, artifact),
    ...await loadLicenseSourceFiles(artifact)
  ]);
  const temporaryDirectory = path.join(
    runtimeRoot,
    manifest.version,
    `.${platformDirectory}-${process.pid}-${Date.now()}`
  );
  await rm(temporaryDirectory, { recursive: true, force: true });
  await mkdir(temporaryDirectory, { recursive: true });
  try {
    const auditFiles = {};
    for (const [fileName, content] of files) {
      const expected = artifact.files[fileName];
      const actualHash = sha256(content);
      if (
        !expected ||
        content.byteLength !== expected.bytes ||
        actualHash !== expected.sha256
      ) {
        throw new Error(`Pandoc 文件完整性校验失败：${fileName}`);
      }
      await writeFile(path.join(temporaryDirectory, fileName), content);
      auditFiles[fileName] = {
        bytes: content.byteLength,
        sha256: actualHash
      };
    }
    const executablePath = path.join(
      temporaryDirectory,
      normalizedBaseName(artifact.executableRelativePath)
    );
    if (platform !== "win32") {
      // unzipSync 不保留压缩包内的可执行权限位，POSIX 平台需要手动补上。
      await chmod(executablePath, 0o755);
    }
    verifyPandocVersion(executablePath, manifest.version);
    await smokeTestPandoc(executablePath);
    await writeFile(
      path.join(temporaryDirectory, "runtime-manifest.json"),
      `${JSON.stringify(
        {
          version: manifest.version,
          platform,
          architecture,
          license: manifest.license,
          projectUrl: manifest.projectUrl,
          sourceArchiveUrl: manifest.sourceArchiveUrl,
          downloadUrl: artifact.downloadUrl,
          archiveSha256: artifact.sha256,
          files: auditFiles
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await rm(targetDirectory, { recursive: true, force: true });
    await rename(temporaryDirectory, targetDirectory);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  console.log(`Pandoc ${manifest.version} 最小运行时已准备：${targetDirectory}`);
  return targetDirectory;
}

function readCliFlag(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((argument) => argument.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

const isDirectInvocation =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectInvocation) {
  preparePandocRuntime({
    checkOnly: process.argv.includes("--check"),
    platform: readCliFlag("platform") ?? process.platform,
    architecture: readCliFlag("arch") ?? process.arch
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export {
  extractRequiredFiles,
  preparePandocRuntime,
  sha256,
  verifyPandocVersion
};
