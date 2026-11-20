import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";
import { zipSync } from "fflate";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function normalizeVersion(value) {
  const normalized = String(value ?? "").trim().replace(/^v/u, "");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(normalized)) {
    throw new Error(`无效发布版本：${value ?? ""}`);
  }
  return normalized;
}

export function parseArguments(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`无效命令参数：${key ?? ""}`);
    }
    result.set(key.slice(2), value);
  }
  return result;
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
      windowsHide: true
    });
    let stdout = "";
    if (options.capture) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise(stdout.trim());
      } else {
        reject(
          new Error(
            `${command} 执行失败：${signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`}`
          )
        );
      }
    });
  });
}

function deploymentFiles(version) {
  return {
    "compose.yaml": readFile(join(repositoryRoot, "deploy", "compose.yaml")),
    "nginx.conf": readFile(join(repositoryRoot, "deploy", "nginx.conf")),
    "README.md": readFile(join(repositoryRoot, "deploy", "README.md")),
    ".env.example": Promise.resolve(
      Buffer.from(
        [
          `MORPHDOC_IMAGE=morphdoc:v${version}`,
          "MORPHDOC_APP_VERSION=" + version,
          "MORPHDOC_PORT=8080",
          "PDF_CONCURRENCY=1",
          "PDF_MAX_QUEUE=4",
          "PDF_TIMEOUT_MS=120000",
          ""
        ].join("\n"),
        "utf8"
      )
    ),
    "OFFLINE-README.md": Promise.resolve(
      Buffer.from(
        [
          `# MorphDoc Web v${version} 离线部署`,
          "",
          `1. 将 \`MorphDoc-Web-${version}-image.tar.gz\` 放在本目录上一级。`,
          `2. 执行 \`docker load --input MorphDoc-Web-${version}-image.tar.gz\`。`,
          "3. 复制 `.env.example` 为 `.env` 并按需调整端口与并发。",
          "4. 执行 `docker compose --env-file .env up -d --no-build`。",
          "5. 访问 `/api/health`，确认状态为 `ok` 后再开放服务。",
          "",
          "镜像已经内置固定 Pandoc、Chromium 与正式字体包，不需要额外下载。",
          ""
        ].join("\n"),
        "utf8"
      )
    )
  };
}

export async function createDeploymentArchive(version, outputPath) {
  const entries = {};
  for (const [name, content] of Object.entries(deploymentFiles(version))) {
    entries[`MorphDoc-Web-${version}-deploy/${name}`] = new Uint8Array(
      await content
    );
  }
  await writeFile(outputPath, zipSync(entries, { level: 9 }));
}

export async function describeArtifacts(directory, names) {
  const entries = [];
  for (const name of names) {
    const path = join(directory, name);
    const info = await stat(path);
    entries.push({
      name,
      bytes: info.size,
      sha256: await sha256(path)
    });
  }
  return entries;
}

export function checksumText(entries) {
  return `${entries.map((entry) => `${entry.sha256}  ${entry.name}`).join("\n")}\n`;
}

async function assertReadableFile(path) {
  const handle = await open(path, "r");
  await handle.close();
  const info = await stat(path);
  if (!info.isFile() || info.size === 0) {
    throw new Error(`发布源文件无效：${relative(repositoryRoot, path)}`);
  }
}

/**
 * 汇总桌面端发布产物文件名。
 *
 * Windows 安装器与免安装 ZIP 为必需项，由调用方随后校验；
 * macOS 两种架构的 dmg 为可选项，仅在目录中存在时收录，
 * 以便同一脚本既能归集纯 Windows 发布，也能归集三端发布。
 * 已存在但为空文件或非普通文件的 dmg 视为损坏，直接抛出异常，不会被静默跳过。
 *
 * @param {string} directory 桌面端构建输出目录
 * @param {string} version 已规范化的发布版本
 * @returns {Promise<string[]>} 按固定顺序排列的产物文件名
 */
export async function collectDesktopNames(directory, version) {
  const required = [
    `MorphDoc-${version}-x86_64-Setup.exe`,
    `MorphDoc-${version}-x86_64.zip`
  ];
  const optional = [
    `MorphDoc-${version}-arm64.dmg`,
    `MorphDoc-${version}-x64.dmg`
  ];
  const present = [];
  for (const name of optional) {
    try {
      await assertReadableFile(join(directory, name));
      present.push(name);
    } catch (error) {
      // 仅"文件不存在"视为未提供该可选产物，其余错误必须暴露
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
  return [...required, ...present];
}

export async function stageRelease(options = {}) {
  const rootManifest = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8")
  );
  const version = normalizeVersion(options.version ?? rootManifest.version);
  const image = options.image ?? `morphdoc:v${version}`;
  const releaseRoot = resolve(options.releaseRoot ?? join(repositoryRoot, "release"));
  const finalDirectory = join(releaseRoot, `v${version}`);
  const stageDirectory = join(
    releaseRoot,
    `.stage-v${version}-${randomUUID()}`
  );
  try {
    await stat(finalDirectory);
    throw new Error(`发布目录已存在，拒绝覆盖：${finalDirectory}`);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const desktopDirectory = join(
    repositoryRoot,
    "apps",
    "desktop",
    "out",
    `v${version}`
  );
  const desktopNames = await collectDesktopNames(desktopDirectory, version);
  // 默认读取仓库内的版本发行说明；CI 演练等场景可显式指定其他文件
  const releaseNotesSource = options.releaseNotes
    ? resolve(options.releaseNotes)
    : join(repositoryRoot, "docs", "releases", `v${version}.md`);
  for (const name of desktopNames) {
    await assertReadableFile(join(desktopDirectory, name));
  }
  await assertReadableFile(releaseNotesSource);

  await mkdir(stageDirectory, { recursive: true });
  try {
    for (const name of desktopNames) {
      await copyFile(join(desktopDirectory, name), join(stageDirectory, name));
    }
    await copyFile(releaseNotesSource, join(stageDirectory, "RELEASE-NOTES.md"));

    const deployName = `MorphDoc-Web-${version}-deploy.zip`;
    await createDeploymentArchive(version, join(stageDirectory, deployName));

    const imageName = `MorphDoc-Web-${version}-image.tar.gz`;
    const imageOutput = join(stageDirectory, imageName);
    const imageTar = join(stageDirectory, `.image-${randomUUID()}.tar`);
    await run("docker", ["image", "inspect", image], { capture: true });
    await run("docker", ["save", "--output", imageTar, image]);
    await pipeline(
      createReadStream(imageTar),
      createGzip({ level: 9 }),
      createWriteStream(imageOutput)
    );
    await rm(imageTar, { force: true });

    const primaryNames = [
      ...desktopNames,
      imageName,
      deployName,
      "RELEASE-NOTES.md"
    ];
    const artifacts = await describeArtifacts(stageDirectory, primaryNames);
    const gitCommit = await run("git", ["rev-parse", "HEAD"], { capture: true });
    const imageId = JSON.parse(
      await run("docker", ["image", "inspect", image, "--format", "{{json .Id}}"], {
        capture: true
      })
    );
    const manifest = {
      schemaVersion: 1,
      product: "MorphDoc",
      displayName: "墨呈",
      version,
      gitCommit,
      docker: { image, imageId },
      artifacts
    };
    await writeFile(
      join(stageDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );
    const checksumEntries = await describeArtifacts(stageDirectory, [
      ...primaryNames,
      "manifest.json"
    ]);
    await writeFile(
      join(stageDirectory, "SHA256SUMS.txt"),
      checksumText(checksumEntries),
      "utf8"
    );

    await mkdir(releaseRoot, { recursive: true });
    await rename(stageDirectory, finalDirectory);
    return { version, image, directory: finalDirectory, artifacts };
  } catch (error) {
    await rm(stageDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const values = parseArguments(process.argv.slice(2));
  const result = await stageRelease({
    version: values.get("version"),
    image: values.get("image"),
    releaseNotes: values.get("release-notes")
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
