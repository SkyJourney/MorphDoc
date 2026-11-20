#!/usr/bin/env node
/**
 * 容器镜像冒烟验收：真正启动镜像，并通过它生成一份 PDF。
 *
 * 只构建镜像不足以证明它可用：v0.6.5 的镜像能够构建，但服务启动即因依赖断链退出，
 * Chromium 版本也与服务锁定的版本不一致。本脚本以 compose 相同的运行参数启动容器，依次检查：
 *
 *   1. 运行时 Node 版本与 .nvmrc 精确一致（Node 版本锁定的落地验证）；
 *   2. 经 nginx 对外的 /api/health 返回 status=ok 且 service=morphdoc；
 *   3. /api/pdf 返回 application/pdf，且字节流具备可搜索 PDF 的结构
 *      （嵌入字体、Type0 中文字体、ToUnicode 映射）；
 *   4. 生成 PDF 后，容器日志中不含 "warmup failed"（Chromium 预热失败）。
 *
 * 用法：
 *   pnpm run verify:docker-smoke                 镜像取自环境变量 MORPHDOC_IMAGE（默认 morphdoc:local）
 *   node deploy/smoke-image.mjs --image <镜像>   显式指定镜像
 *
 * 在 Apple Silicon 上验证 amd64 镜像时，请先设置 DOCKER_DEFAULT_PLATFORM=linux/amd64。
 * 容器在结束时无论成功与否都会被删除。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultImage = "morphdoc:local";
const containerPort = 8080;
const startupTimeoutMs = 120_000;

// 样例覆盖中文、加粗、行内代码、表格、代码块与公式，一次生成即可触达主要渲染路径
const smokeMarkdown = [
  "---",
  "title: 镜像冒烟验收",
  "---",
  "",
  "# 镜像冒烟验收",
  "",
  "中文段落，包含 **加粗**、`行内代码` 与公式 $E = mc^2$。",
  "",
  "| 列一 | 列二 |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "```js",
  'console.log("smoke");',
  "```",
  ""
].join("\n");

/**
 * 解析命令行参数。镜像引用优先取 --image，其次取环境变量 MORPHDOC_IMAGE，最后使用 morphdoc:local。
 *
 * @param {string[]} values 参数列表（不含 node 与脚本路径）
 * @param {Record<string, string | undefined>} [env] 环境变量，默认为 process.env
 * @returns {{ image: string }} 解析结果
 * @throws {Error} 出现未知参数或参数缺少取值时抛出
 */
export function parseArguments(values, env = process.env) {
  let image;
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (key !== "--image" || !value) {
      throw new Error(`未知或不完整的参数：${key ?? ""}`);
    }
    image = value;
  }
  return { image: image ?? (env.MORPHDOC_IMAGE?.trim() || defaultImage) };
}

/**
 * 从 `docker port` 的输出中取出宿主机端口。IPv4 与 IPv6 映射可能同时输出，取第一条。
 *
 * @param {string} output `docker port` 的标准输出，例如 `127.0.0.1:49153`
 * @returns {number} 宿主机端口
 * @throws {Error} 输出无法解析时抛出
 */
export function publishedPort(output) {
  const match = output.split(/\r?\n/u)[0]?.match(/:(\d+)$/u);
  if (!match) {
    throw new Error(`无法解析端口映射：${output}`);
  }
  return Number(match[1]);
}

/**
 * 检查 PDF 字节是否具备可搜索中文文档的基本结构。
 *
 * @param {Buffer} bytes PDF 字节
 * @returns {string[]} 不满足项的描述列表，全部满足时为空数组
 */
export function pdfProblems(bytes) {
  const problems = [];
  const text = bytes.toString("latin1");
  if (bytes.length < 5_000) problems.push(`文件过小（${bytes.length} 字节）`);
  if (!text.startsWith("%PDF-")) problems.push("文件头不是 %PDF-");
  if (!text.trimEnd().endsWith("%%EOF")) problems.push("文件未以 %%EOF 结束");
  if (!/\/Type0/u.test(text)) problems.push("缺少 Type0 复合字体（中文字体未生效）");
  if (!/\/ToUnicode/u.test(text)) problems.push("缺少 ToUnicode 映射（文本不可搜索）");
  if (!/\/FontFile/u.test(text)) problems.push("字体未嵌入");
  return problems;
}

/**
 * 同步执行 docker 命令并返回去除首尾空白的标准输出。
 *
 * @param {string[]} args docker 子命令与参数
 * @returns {string} 标准输出
 * @throws {Error} 命令退出码非 0 时抛出，错误信息包含 docker 的标准错误输出
 */
function docker(args) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

/**
 * 读取容器的标准输出与标准错误（服务日志可能写入任一流）。
 *
 * @param {string} containerId 容器 ID
 * @returns {string} 合并后的日志文本
 */
function containerLogs(containerId) {
  const result = spawnSync("docker", ["logs", containerId], { encoding: "utf8" });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

/**
 * 强制删除容器。清理失败不应覆盖真正的验收结果，因此忽略其错误。
 *
 * @param {string} containerId 容器 ID
 */
function removeContainer(containerId) {
  spawnSync("docker", ["rm", "--force", containerId], { stdio: "ignore" });
}

/**
 * 等待服务通过健康检查。容器提前退出或超时都会抛出错误。
 *
 * @param {string} baseUrl 经 nginx 暴露的宿主机地址，例如 http://127.0.0.1:49153
 * @param {string} containerId 容器 ID，用于检测提前退出
 * @returns {Promise<Record<string, unknown>>} 健康检查响应体
 * @throws {Error} 容器提前退出或超时未返回 status=ok 时抛出
 */
async function waitForHealth(baseUrl, containerId) {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (docker(["inspect", "--format", "{{.State.Running}}", containerId]) !== "true") {
      throw new Error("容器在服务就绪前退出");
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        const body = await response.json();
        if (body.status === "ok" && body.service === "morphdoc") {
          return body;
        }
      }
    } catch {
      // 服务尚未监听，继续等待
    }
    await new Promise((done) => setTimeout(done, 2000));
  }
  throw new Error(`${startupTimeoutMs / 1000} 秒内 /api/health 未返回 status=ok`);
}

/**
 * 启动镜像并执行全部冒烟检查。
 *
 * @param {{ image: string }} options 镜像引用
 * @returns {Promise<Record<string, unknown>>} 各检查项的摘要，全部通过时返回
 * @throws {Error} 任一检查失败时抛出，错误信息附带容器日志末尾
 */
export async function runSmoke({ image }) {
  const expectedNode = readFileSync(join(repositoryRoot, ".nvmrc"), "utf8").trim();
  const summary = { image, checks: {} };

  const nodeVersion = docker(["run", "--rm", "--entrypoint", "node", image, "-v"]);
  summary.checks.nodeVersion = nodeVersion;
  if (nodeVersion !== `v${expectedNode}`) {
    throw new Error(`运行时 Node 为 ${nodeVersion}，与 .nvmrc 的 v${expectedNode} 不一致`);
  }

  // 与 deploy/compose.yaml 保持一致的运行参数。APP_VERSION 留空，使服务读取镜像内 package.json。
  const containerId = docker([
    "run", "--detach", "--init",
    "--shm-size=1gb",
    "--security-opt", "no-new-privileges:true",
    "--publish", `127.0.0.1::${containerPort}`,
    "--env", "HOST=127.0.0.1",
    "--env", "PORT=3001",
    "--env", `PDF_RENDER_ORIGIN=http://127.0.0.1:${containerPort}`,
    "--env", "APP_VERSION=",
    "--env", "FONT_PACK_ROOT=/app/.local/font-packs",
    image
  ]);

  try {
    const port = publishedPort(docker(["port", containerId, String(containerPort)]));
    const baseUrl = `http://127.0.0.1:${port}`;
    summary.checks.health = await waitForHealth(baseUrl, containerId);

    const { defaultExportConfig } = await import("@morphdoc/core");
    const response = await fetch(`${baseUrl}/api/pdf`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        markdown: smokeMarkdown,
        fileName: "smoke-test.md",
        language: "zh-CN",
        resources: [],
        exportConfig: defaultExportConfig
      })
    });
    if (!response.ok) {
      throw new Error(`/api/pdf 返回 ${response.status}：${(await response.text()).slice(0, 300)}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    const bytes = Buffer.from(await response.arrayBuffer());
    const problems = [
      ...(contentType.includes("application/pdf")
        ? []
        : [`Content-Type 不是 application/pdf（实际为 ${contentType}）`]),
      ...pdfProblems(bytes)
    ];
    summary.checks.pdf = { bytes: bytes.length, contentType, problems };
    if (problems.length > 0) {
      throw new Error(`生成的 PDF 不完整：${problems.join("；")}`);
    }

    summary.checks.chromiumWarmupFailed = /warmup failed/u.test(containerLogs(containerId));
    if (summary.checks.chromiumWarmupFailed) {
      throw new Error("Chromium 预热失败（容器日志含 warmup failed）");
    }
    summary.ok = true;
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const tail = containerLogs(containerId).split(/\r?\n/u).slice(-30).join("\n");
    throw new Error(`${message}\n容器日志末尾：\n${tail}`);
  } finally {
    removeContainer(containerId);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    const summary = await runSmoke(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `镜像冒烟验收失败：${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
