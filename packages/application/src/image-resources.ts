import { lookup } from "node:dns/promises";
import { readFile, realpath, stat } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractMarkdownImageSources } from "@morphdoc/renderer";

export const MAXIMUM_IMAGE_COUNT = 50;
export const MAXIMUM_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAXIMUM_TOTAL_IMAGE_BYTES = 15 * 1024 * 1024;
export const REMOTE_IMAGE_TIMEOUT_MS = 10_000;
export const MAXIMUM_REMOTE_REDIRECTS = 3;

const failedImageDataUrl = `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="120" viewBox="0 0 640 120"><rect width="640" height="120" fill="#f8fafc"/><rect x="1" y="1" width="638" height="118" fill="none" stroke="#cbd5e1"/><text x="320" y="67" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#64748b">图片加载失败</text></svg>`
).toString("base64")}`;

export interface MarkdownImageResource {
  path: string;
  contentType?: string;
  data: string;
}

export interface ImageResolutionContext {
  localRoot?: string;
  allowUnrestrictedLocalFiles?: boolean;
}

export interface ResolvedMarkdownImages {
  sources: ReadonlyMap<string, string>;
  warnings: string[];
}

export interface ImageResourceResolverOptions {
  remoteLoader?: (url: string) => Promise<LoadedImage>;
}

export interface LoadedImage {
  content: Buffer;
  contentType: string;
}

function isPrivateIpv4(
  address: string,
  allowProxyBenchmarkRange = false
) {
  const parts = address.split(".").map(Number);
  const [first, second] = parts;
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255) ||
    first === undefined ||
    second === undefined
  ) {
    return true;
  }
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (!allowProxyBenchmarkRange &&
      first === 198 &&
      (second === 18 || second === 19)) ||
    first >= 224
  );
}

function isPrivateIpAddress(
  address: string,
  allowProxyBenchmarkRange = false
) {
  const normalized = address.toLowerCase();
  if (isIP(normalized) === 4) {
    return isPrivateIpv4(normalized, allowProxyBenchmarkRange);
  }
  if (isIP(normalized) !== 6) {
    return true;
  }
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized)
  ) {
    return true;
  }
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  return mapped
    ? isPrivateIpv4(mapped, allowProxyBenchmarkRange)
    : false;
}

async function assertPublicRemoteUrl(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("仅支持 HTTP/HTTPS 图片");
  }
  if (
    url.username ||
    url.password ||
    url.hostname.toLowerCase() === "localhost"
  ) {
    throw new Error("图片地址包含不允许的认证或本地主机");
  }
  if (isIP(url.hostname)) {
    if (isPrivateIpAddress(url.hostname)) {
      throw new Error("图片地址指向非公网 IP");
    }
    return;
  }
  const addresses = await lookup(url.hostname, {
    all: true,
    verbatim: true
  });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isPrivateIpAddress(address, true))
  ) {
    throw new Error("图片域名解析到非公网 IP");
  }
}

function detectImageContentType(content: Buffer) {
  if (
    content.length >= 8 &&
    content.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return "image/png";
  }
  if (
    content.length >= 3 &&
    content[0] === 0xff &&
    content[1] === 0xd8 &&
    content[2] === 0xff
  ) {
    return "image/jpeg";
  }
  const prefix = content.subarray(0, 12).toString("ascii");
  if (prefix.startsWith("GIF87a") || prefix.startsWith("GIF89a")) {
    return "image/gif";
  }
  if (prefix.startsWith("RIFF") && prefix.endsWith("WEBP")) {
    return "image/webp";
  }
  if (
    content.length >= 12 &&
    content.subarray(4, 12).toString("ascii").startsWith("ftyp") &&
    /(?:avif|avis)/u.test(content.subarray(8, 32).toString("ascii"))
  ) {
    return "image/avif";
  }
  const textPrefix = content.subarray(0, Math.min(content.length, 4096))
    .toString("utf8")
    .replace(/^\uFEFF/u, "")
    .trimStart();
  if (
    /^(?:<\?xml[\s\S]*?\?>\s*)?<svg[\s>]/iu.test(textPrefix)
  ) {
    const svg = content.toString("utf8");
    if (
      /<script\b|<foreignObject\b|\son\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/)/iu.test(
        svg
      )
    ) {
      throw new Error("SVG 包含不安全的脚本或外部资源");
    }
    return "image/svg+xml";
  }
  throw new Error("资源不是受支持的图片格式");
}

function imageToDataUrl(image: LoadedImage) {
  return `data:${image.contentType};base64,${image.content.toString("base64")}`;
}

async function readResponseBody(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAXIMUM_IMAGE_BYTES
  ) {
    throw new Error("远程图片超过单文件大小限制");
  }
  if (!response.body) {
    throw new Error("远程图片响应为空");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAXIMUM_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("远程图片超过单文件大小限制");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export async function downloadRemoteImage(
  source: string,
  fetcher: typeof fetch = fetch
): Promise<LoadedImage> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    REMOTE_IMAGE_TIMEOUT_MS
  );
  try {
    let current = new URL(source);
    for (
      let redirectCount = 0;
      redirectCount <= MAXIMUM_REMOTE_REDIRECTS;
      redirectCount += 1
    ) {
      await assertPublicRemoteUrl(current);
      const response = await fetcher(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml",
          "user-agent": "morphdoc/0.4.1"
        }
      });
      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.has("location")
      ) {
        if (redirectCount === MAXIMUM_REMOTE_REDIRECTS) {
          throw new Error("远程图片重定向次数过多");
        }
        current = new URL(response.headers.get("location")!, current);
        continue;
      }
      if (!response.ok) {
        throw new Error(`远程图片返回 HTTP ${response.status}`);
      }
      const content = await readResponseBody(response);
      return {
        content,
        contentType: detectImageContentType(content)
      };
    }
    throw new Error("远程图片重定向次数过多");
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeDocumentAssetPath(source: string) {
  const pathOnly = source.split(/[?#]/u, 1)[0] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    throw new Error("图片路径 URL 编码无效");
  }
  const normalizedSeparators = decoded.replace(/\\/gu, "/");
  if (
    normalizedSeparators.startsWith("/") ||
    /^[a-z]:\//iu.test(normalizedSeparators) ||
    normalizedSeparators.includes("\0")
  ) {
    throw new Error("不允许绝对图片路径");
  }
  const segments = normalizedSeparators
    .split("/")
    .filter((segment) => segment && segment !== ".");
  if (segments.length === 0 || segments.includes("..")) {
    throw new Error("图片路径为空或越过文档目录");
  }
  return segments.join("/");
}

function isContainedPath(root: string, target: string) {
  const relative = path.relative(root, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function loadLocalImage(root: string, source: string) {
  const normalized = normalizeDocumentAssetPath(source);
  const realRoot = await realpath(root);
  const target = path.resolve(realRoot, ...normalized.split("/"));
  const realTarget = await realpath(target);
  if (!isContainedPath(realRoot, realTarget)) {
    throw new Error("图片路径越过文档目录");
  }
  const targetStat = await stat(realTarget);
  if (!targetStat.isFile()) {
    throw new Error("图片资源不是文件");
  }
  if (targetStat.size > MAXIMUM_IMAGE_BYTES) {
    throw new Error("本地图片超过单文件大小限制");
  }
  const content = await readFile(realTarget);
  return {
    content,
    contentType: detectImageContentType(content)
  };
}

function decodeUnrestrictedLocalPath(source: string) {
  if (/^file:/iu.test(source)) {
    try {
      return fileURLToPath(new URL(source));
    } catch {
      throw new Error("file: 图片路径格式无效");
    }
  }
  const pathOnly = source.split(/[?#]/u, 1)[0] ?? "";
  try {
    return decodeURIComponent(pathOnly);
  } catch {
    throw new Error("图片路径 URL 编码无效");
  }
}

async function loadUnrestrictedLocalImage(
  root: string,
  source: string
) {
  const decoded = decodeUnrestrictedLocalPath(source);
  const target =
    path.isAbsolute(decoded) || /^[a-z]:[\\/]/iu.test(decoded)
      ? path.normalize(decoded)
      : path.resolve(root, decoded);
  const realTarget = await realpath(target);
  const targetStat = await stat(realTarget);
  if (!targetStat.isFile()) {
    throw new Error("图片资源不是文件");
  }
  if (targetStat.size > MAXIMUM_IMAGE_BYTES) {
    throw new Error("本地图片超过单文件大小限制");
  }
  const content = await readFile(realTarget);
  return {
    content,
    contentType: detectImageContentType(content)
  };
}

function parseUploadedResources(value: unknown) {
  if (value === undefined) {
    return new Map<string, LoadedImage>();
  }
  if (!Array.isArray(value)) {
    throw new Error("图片素材必须是数组");
  }
  if (value.length > MAXIMUM_IMAGE_COUNT) {
    throw new Error(`图片数量不能超过 ${MAXIMUM_IMAGE_COUNT}`);
  }
  const result = new Map<string, LoadedImage>();
  let totalBytes = 0;
  for (const item of value) {
    if (
      typeof item !== "object" ||
      item === null ||
      !("path" in item) ||
      !("data" in item) ||
      typeof item.path !== "string" ||
      typeof item.data !== "string" ||
      item.data.length > Math.ceil(MAXIMUM_IMAGE_BYTES * 4 / 3) + 16
    ) {
      throw new Error("图片素材参数无效");
    }
    const normalized = normalizeDocumentAssetPath(item.path);
    if (result.has(normalized)) {
      throw new Error(`图片素材路径重复：${normalized}`);
    }
    const content = Buffer.from(item.data, "base64");
    if (content.length === 0 || content.length > MAXIMUM_IMAGE_BYTES) {
      throw new Error(`图片素材大小无效：${normalized}`);
    }
    totalBytes += content.length;
    if (totalBytes > MAXIMUM_TOTAL_IMAGE_BYTES) {
      throw new Error("图片素材总大小超过限制");
    }
    result.set(normalized, {
      content,
      contentType: detectImageContentType(content)
    });
  }
  return result;
}

export function createImageResourceResolver(
  options: ImageResourceResolverOptions = {}
) {
  const remoteLoader = options.remoteLoader ?? downloadRemoteImage;
  const remoteCache = new Map<
    string,
    { expiresAt: number; promise: Promise<LoadedImage> }
  >();

  function loadRemote(source: string) {
    const cached = remoteCache.get(source);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.promise;
    }
    const promise = remoteLoader(source);
    remoteCache.set(source, {
      expiresAt: Date.now() + 5 * 60_000,
      promise
    });
    if (remoteCache.size > 100) {
      const oldest = remoteCache.keys().next().value as string | undefined;
      if (oldest) {
        remoteCache.delete(oldest);
      }
    }
    void promise.catch(() => {
      if (remoteCache.get(source)?.promise === promise) {
        remoteCache.delete(source);
      }
    });
    return promise;
  }

  return async function resolve(
    markdown: string,
    resources: unknown,
    context: ImageResolutionContext = {}
  ): Promise<ResolvedMarkdownImages> {
    const references = extractMarkdownImageSources(markdown);
    if (references.length > MAXIMUM_IMAGE_COUNT) {
      throw new Error(`图片引用数量不能超过 ${MAXIMUM_IMAGE_COUNT}`);
    }
    const uploaded = parseUploadedResources(resources);
    const sources = new Map<string, string>();
    const warnings: string[] = [];
    let resolvedBytes = 0;

    for (const source of references) {
      if (source.startsWith("data:")) {
        continue;
      }
      try {
        let image: LoadedImage;
        if (/^https?:\/\//iu.test(source)) {
          image = await loadRemote(source);
        } else {
          let normalized: string | undefined;
          try {
            normalized = normalizeDocumentAssetPath(source);
          } catch (error) {
            if (!context.allowUnrestrictedLocalFiles) {
              throw error;
            }
          }
          const uploadedImage = normalized
            ? uploaded.get(normalized)
            : undefined;
          if (uploadedImage) {
            image = uploadedImage;
          } else if (context.localRoot) {
            image = context.allowUnrestrictedLocalFiles
              ? await loadUnrestrictedLocalImage(
                  context.localRoot,
                  source
                )
              : await loadLocalImage(context.localRoot, source);
          } else {
            throw new Error("未提供对应素材目录");
          }
        }
        resolvedBytes += image.content.length;
        if (resolvedBytes > MAXIMUM_TOTAL_IMAGE_BYTES) {
          throw new Error("文档图片总大小超过限制");
        }
        sources.set(source, imageToDataUrl(image));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "未知错误";
        warnings.push(`图片 ${source} 加载失败：${message}`);
        sources.set(source, failedImageDataUrl);
      }
    }
    return { sources, warnings };
  };
}
