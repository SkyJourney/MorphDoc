import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultExportConfig } from "@morphdoc/core";
import { strFromU8, unzipSync } from "fflate";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const composeFile = path.join(scriptDirectory, "compose.yaml");
const image = process.env.MORPHDOC_IMAGE?.trim() || "morphdoc:local";
const fontPackRoot = path.resolve(
  path.join(repositoryRoot, "output", "font-packs", "root")
);
const expectedFontPacks = [
  { id: "morphdoc-serif-sc", version: "1.0.0" },
  { id: "morphdoc-sans-sc", version: "1.0.0" },
  { id: "morphdoc-mono", version: "1.0.0" }
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex").toLowerCase();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    env: options.env ?? process.env
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} 失败（退出码 ${result.status}）${
        options.capture ? `\n${result.stderr || result.stdout}` : ""
      }`
    );
  }
  return options.capture ? result.stdout.trim() : "";
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address ? address.port : undefined;
      server.close((error) =>
        error || !port
          ? reject(error ?? new Error("无法分配端口"))
          : resolve(port)
      );
    });
  });
}

async function waitForHealth(origin) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok && (await response.json()).status === "ok") {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `容器健康检查未就绪${lastError ? `：${String(lastError)}` : ""}`
  );
}

function assertNoFontPackMount(containerId) {
  const inspection = JSON.parse(
    run("docker", ["inspect", containerId], { capture: true })
  )[0];
  const mount = inspection.Mounts.find(
    (item) => item.Destination === "/app/.local/font-packs"
  );
  assert(!mount, "Docker 字体包必须来自镜像层，不能依赖运行时挂载");
}

async function exportDocx(origin) {
  const response = await fetch(`${origin}/api/docx`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      markdown:
        "---\ntitle: Docker 内置字体包验收\n---\n\n# Docker 内置字体包验收\n\n这是一段包含行内代码 `const value = 1` 的可编辑中文正文，代码前后不得换行。",
      fileName: "Docker 内置字体包验收.md",
      language: "zh-CN",
      resources: [],
      exportConfig: {
        ...defaultExportConfig,
        themeId: "gov-red-standard"
      }
    })
  });
  if (!response.ok) {
    throw new Error(
      `DOCX 导出失败（${response.status}）：${await response.text()}`
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

const fontPackStatus = await stat(fontPackRoot).catch(() => undefined);
assert(
  fontPackStatus?.isDirectory(),
  `未找到有效字体包根目录：${fontPackRoot}。请先运行 pnpm run build:font-pack。`
);
const localManifests = await Promise.all(
  expectedFontPacks.map(async (pack) => ({
    ...pack,
    content: await readFile(
      path.join(fontPackRoot, pack.id, pack.version, "font-pack.json")
    )
  }))
);
const buildEnvironment = {
  ...process.env,
  MORPHDOC_IMAGE: image
};
run(
  "docker",
  ["compose", "--file", composeFile, "build", "app"],
  { env: buildEnvironment }
);
run("docker", ["image", "inspect", image], { capture: true });
const embeddedManifestHashes = {};
for (const manifest of localManifests) {
  const embeddedHash = run(
    "docker",
    [
      "run",
      "--rm",
      "--entrypoint",
      "sha256sum",
      image,
      `/app/.local/font-packs/${manifest.id}/${manifest.version}/font-pack.json`
    ],
    { capture: true }
  ).split(/\s+/u)[0];
  assert(
    embeddedHash === sha256(manifest.content),
    `镜像内字体包清单不一致：${manifest.id}@${manifest.version}`
  );
  embeddedManifestHashes[`${manifest.id}@${manifest.version}`] = embeddedHash;
}

const port = await freePort();
const projectName = `morphdoc-font-pack-${randomUUID().slice(0, 8)}`;
const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), "morphdoc-docker-font-pack-")
);
const themeRoot = path.join(temporaryRoot, "empty-themes");
await mkdir(themeRoot, { recursive: true });
const environment = {
  ...buildEnvironment,
  MORPHDOC_PORT: String(port),
  MORPHDOC_THEME_DIR: themeRoot,
  MORPHDOC_APP_VERSION: "0.6.4"
};
const compose = [
  "compose",
  "--project-name",
  projectName,
  "--file",
  composeFile
];

try {
  run(
    "docker",
    [...compose, "up", "--detach", "--no-build", "--pull", "never"],
    { env: environment }
  );
  const containerId = run(
    "docker",
    [...compose, "ps", "--quiet", "app"],
    { capture: true, env: environment }
  );
  assert(containerId, "未创建 Docker 字体包验收容器");
  assertNoFontPackMount(containerId);
  const origin = `http://127.0.0.1:${port}`;
  await waitForHealth(origin);

  const capabilityResponse = await fetch(`${origin}/api/docx/capability`);
  const capability = await capabilityResponse.json();
  assert(
    capabilityResponse.ok &&
      capability.status === "available" &&
      capability.detectedVersion === "3.9.0.2",
    `DOCX capability 无效：${JSON.stringify(capability)}`
  );

  const cssResponse = await fetch(
    `${origin}/api/themes/gov-red-standard/css`
  );
  const css = await cssResponse.text();
  assert(cssResponse.ok, "主题 CSS 请求失败");
  assert(css.includes("morphdoc-font-packs:"), "主题 CSS 缺少字体包标记");
  for (const pack of expectedFontPacks) {
    assert(
      css.includes(`${pack.id}@${pack.version}`),
      `Docker 内置字体包未进入主题 CSS：${pack.id}@${pack.version}`
    );
  }
  const assetPath = css.match(
    /(\/api\/font-packs\/[^"'()\s]+\/web\?v=[a-f0-9]+)/u
  )?.[1];
  assert(assetPath, "Docker 内置字体包 CSS 缺少受控 WOFF2 地址");
  const assetResponse = await fetch(`${origin}${assetPath}`);
  assert(assetResponse.ok, "Docker 内置字体包 WOFF2 请求失败");
  assert(
    assetResponse.headers.get("content-type")?.includes("font/woff2"),
    "Docker 内置字体包 WOFF2 MIME 无效"
  );
  assert(
    assetResponse.headers.get("cache-control")?.includes("immutable"),
    "Docker 内置字体包 WOFF2 缓存策略无效"
  );

  const docx = await exportDocx(origin);
  const entries = unzipSync(docx);
  const fontParts = Object.keys(entries).filter((entry) =>
    entry.startsWith("word/fonts/")
  );
  assert(fontParts.length >= 2, `DOCX 字体部件不足：${fontParts.length}`);
  const fontTable = strFromU8(entries["word/fontTable.xml"]);
  assert(fontTable.includes("MorphDoc Serif SC"), "字体包未进入 DOCX 字体表");
  assert(fontTable.includes("MorphDoc Mono"), "等宽字体包未进入 DOCX 字体表");
  const documentXml = strFromU8(entries["word/document.xml"]);
  const inlineCodeParagraph = documentXml
    .match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/gu)
    ?.find(
      (paragraph) =>
        paragraph.includes("这是一段包含行内代码") &&
        paragraph.includes("const value = 1") &&
        paragraph.includes("代码前后不得换行")
    );
  assert(inlineCodeParagraph, "行内代码及前后正文未保持在同一 Word 段落");

  process.stdout.write(
    `${JSON.stringify(
      {
        image,
        embeddedManifestSha256: embeddedManifestHashes,
        runtimeFontPackMount: false,
        fontPackAvailable: true,
        pandocVersion: capability.detectedVersion,
        docxFontParts: fontParts.length
      },
      null,
      2
    )}\n`
  );
} finally {
  run(
    "docker",
    [...compose, "down", "--remove-orphans", "--timeout", "5"],
    { env: environment }
  );
  await rm(temporaryRoot, { recursive: true, force: true });
}
