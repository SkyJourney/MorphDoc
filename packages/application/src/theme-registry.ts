import {
  readdir,
  readFile,
  realpath,
  stat
} from "node:fs/promises";
import {
  extname,
  isAbsolute,
  posix,
  relative,
  resolve,
  sep
} from "node:path";
import {
  MAXIMUM_DOCX_FONT_TOTAL_SOURCE_BYTES,
  themeManifestSchema,
  type DocxFontFace,
  type ThemeManifest
} from "@morphdoc/core";
import {
  discoverFontPacks,
  readInstalledFontPackAsset,
  resolveFontPackFaces,
  type FontPackDiagnostic,
  type FontPackFaceRequest,
  type FontPackRegistryResult,
  type ResolvedFontPackFace
} from "@morphdoc/font-pack-registry";

export interface ThemeRecord {
  manifest: ThemeManifest;
  directory: string;
  source: "bundled" | "local";
}

export interface ThemeFontAsset extends DocxFontFace {
  content: Uint8Array;
}

export interface ThemeRegistryOptions {
  bundledRoot: string;
  localRoot: string;
  onWarning?: (message: string) => void;
  cacheTtlMs?: number;
  createAssetUrl?: (themeId: string, assetPath: string) => string;
  fontPacks?: {
    roots: readonly string[];
    appVersion: string;
    cacheTtlMs?: number;
    preferredPackIds?: readonly string[];
    createAssetUrl?: (
      packId: string,
      packVersion: string,
      faceId: string,
      kind: "web" | "docx",
      sha256: string
    ) => string;
  };
}

export interface ThemeFontPackStatus {
  registryFingerprint: string;
  appliedFaces: Array<{
    family: string;
    weight: number;
    style: "normal" | "italic";
    packId: string;
    packVersion: string;
    faceId: string;
    webSha256: string;
    docxSha256: string;
  }>;
  diagnostics: FontPackDiagnostic[];
}

const assetContentTypes: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const cssImportPattern =
  /@import\s+(?:url\(\s*(?:\"([^\"]+)\"|'([^']+)'|([^'\"\s)]+))\s*\)|\"([^\"]+)\"|'([^']+)')\s*;/gi;
const maximumCssImportDepth = 8;
const sharedThemeAssetId = "_shared";
const sharedThemeAssetScheme = "theme-shared:";
const sharedFontCssPath = "official-fonts/fonts.css";
const engineCodeFontFaces: readonly DocxFontFace[] = [
  {
    family: "MorphDoc Mono",
    aliases: [
      "Cascadia Mono",
      "Cascadia Code",
      "Consolas",
      "Lucida Console",
      "SFMono-Regular",
      "Menlo",
      "Monaco",
      "Courier New",
      "Courier",
      "Source Code Pro",
      "JetBrains Mono"
    ],
    source: "fonts/morphdoc-mono.ttf",
    weight: 400,
    style: "normal",
    license: "OFL-1.1"
  },
  {
    family: "MorphDoc Mono",
    aliases: [
      "Cascadia Mono",
      "Cascadia Code",
      "Consolas",
      "Lucida Console",
      "SFMono-Regular",
      "Menlo",
      "Monaco",
      "Courier New",
      "Courier",
      "Source Code Pro",
      "JetBrains Mono"
    ],
    source: "fonts/morphdoc-mono-bold.ttf",
    weight: 700,
    style: "normal",
    license: "OFL-1.1"
  }
];

function isMissingFileError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function isInsideDirectory(directory: string, path: string) {
  const pathFromDirectory = relative(directory, path);
  return (
    pathFromDirectory === "" ||
    (!pathFromDirectory.startsWith(`..${sep}`) &&
      pathFromDirectory !== ".." &&
      !isAbsolute(pathFromDirectory))
  );
}

async function resolveThemeFile(directory: string, relativePath: string) {
  if (
    isAbsolute(relativePath) ||
    relativePath.includes("\0") ||
    relativePath.split(/[\\/]/).includes("..")
  ) {
    throw new Error("主题资源路径不安全");
  }

  const realDirectory = await realpath(directory);
  const candidate = resolve(realDirectory, relativePath);
  if (!isInsideDirectory(realDirectory, candidate)) {
    throw new Error("主题资源路径越界");
  }

  const realCandidate = await realpath(candidate);
  if (!isInsideDirectory(realDirectory, realCandidate)) {
    throw new Error("主题资源符号链接越界");
  }

  const fileStat = await stat(realCandidate);
  if (!fileStat.isFile()) {
    throw new Error("主题资源不是文件");
  }

  return realCandidate;
}

async function readThemeRoot(
  root: string,
  source: ThemeRecord["source"],
  onWarning?: (message: string) => void
): Promise<ThemeRecord[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error) && source === "local") {
      return [];
    }
    throw error;
  }

  const records: ThemeRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) {
      continue;
    }

    const directory = resolve(root, entry.name);
    try {
      const manifestPath = await resolveThemeFile(directory, "theme.json");
      const manifest = themeManifestSchema.parse(
        JSON.parse(await readFile(manifestPath, "utf8"))
      );

      if (manifest.id !== entry.name) {
        throw new Error("主题目录名必须与主题 ID 一致");
      }
      if (manifest.bundled !== (source === "bundled")) {
        throw new Error("主题 bundled 标记与来源不一致");
      }

      if (manifest.base) {
        await resolveThemeFile(directory, manifest.base);
      }
      await resolveThemeFile(directory, manifest.entry);
      if (manifest.print) {
        await resolveThemeFile(directory, manifest.print);
      }

      records.push({
        manifest,
        directory,
        source
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (source === "local") {
        onWarning?.(`已忽略无效本地主题 ${entry.name}：${message}`);
        continue;
      }
      throw new Error(`主题 ${entry.name} 无效：${message}`);
    }
  }

  return records;
}

function encodeAssetPath(path: string) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function prepareCssSegment(
  css: string,
  themeId: string,
  cssDirectory: string,
  createAssetUrl: (themeId: string, assetPath: string) => string,
  allowSharedAssets: boolean
) {
  return css.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (match, _quote: string, rawValue: string) => {
      const value = rawValue.trim();
      if (value.startsWith("data:") || value.startsWith("#")) {
        return match;
      }
      if (value.startsWith(sharedThemeAssetScheme)) {
        if (!allowSharedAssets) {
          throw new Error("本地主题不能引用内置共享资源");
        }
        const sharedPath = normalizeCssPath(
          value.slice(sharedThemeAssetScheme.length)
        );
        if (!sharedPath || sharedPath === ".") {
          throw new Error("内置共享资源路径不能为空");
        }
        return `url("${createAssetUrl(sharedThemeAssetId, sharedPath)}")`;
      }
      if (
        value.startsWith("/") ||
        value.startsWith("//") ||
        /^[a-z][a-z0-9+.-]*:/i.test(value)
      ) {
        throw new Error(`主题包含不允许的外部资源：${value}`);
      }

      const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
      if (normalized.split("/").includes("..")) {
        throw new Error(`主题资源路径不安全：${value}`);
      }

      const assetPath = posix.normalize(posix.join(cssDirectory, normalized));
      if (
        assetPath === ".." ||
        assetPath.startsWith("../") ||
        assetPath.startsWith("/")
      ) {
        throw new Error(`主题资源路径越界：${value}`);
      }

      return `url("${createAssetUrl(themeId, assetPath)}")`;
    }
  );
}

function readImportedPath(match: RegExpMatchArray) {
  return match.slice(1).find((value): value is string => value !== undefined);
}

function normalizeCssPath(relativePath: string) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    normalized.split("/").includes("..") ||
    /^[a-z][a-z0-9+.-]*:/i.test(normalized)
  ) {
    throw new Error(`主题 CSS 路径不安全：${relativePath}`);
  }

  return posix.normalize(normalized.replace(/^\.\//, ""));
}

async function loadThemeCssFile(
  theme: ThemeRecord,
  relativePath: string,
  createAssetUrl: (themeId: string, assetPath: string) => string,
  importStack: string[] = []
): Promise<string> {
  const normalizedPath = normalizeCssPath(relativePath);
  if (importStack.includes(normalizedPath)) {
    throw new Error(
      `主题 CSS 存在循环引用：${[...importStack, normalizedPath].join(" -> ")}`
    );
  }
  if (importStack.length >= maximumCssImportDepth) {
    throw new Error(`主题 CSS 导入层级超过 ${maximumCssImportDepth} 层`);
  }

  const cssPath = await resolveThemeFile(theme.directory, normalizedPath);
  const css = (await readFile(cssPath, "utf8")).replace(
    /^\s*@include-when-export\s+url\([^;\r\n]+;\s*$/gim,
    ""
  );
  const cssDirectory = posix.dirname(normalizedPath);
  const matches = [...css.matchAll(cssImportPattern)];
  let result = "";
  let previousEnd = 0;

  for (const match of matches) {
    const matchStart = match.index ?? 0;
    result += prepareCssSegment(
      css.slice(previousEnd, matchStart),
      theme.manifest.id,
      cssDirectory,
      createAssetUrl,
      theme.source === "bundled"
    );

    const importedPath = readImportedPath(match);
    if (!importedPath) {
      throw new Error(`无法解析主题 CSS 导入：${match[0]}`);
    }
    const normalizedImport = normalizeCssPath(importedPath);
    const importPath = posix.normalize(posix.join(cssDirectory, normalizedImport));
    result += await loadThemeCssFile(
      theme,
      importPath,
      createAssetUrl,
      [...importStack, normalizedPath]
    );
    previousEnd = matchStart + match[0].length;
  }

  const remainder = css.slice(previousEnd);
  result += prepareCssSegment(
    remainder,
    theme.manifest.id,
    cssDirectory,
    createAssetUrl,
    theme.source === "bundled"
  );
  if (/@import\b/i.test(result)) {
    throw new Error("主题包含不支持的 CSS @import 语法");
  }

  return result;
}

export function createThemeRegistry(options: ThemeRegistryOptions) {
  const createAssetUrl =
    options.createAssetUrl ??
    ((themeId: string, assetPath: string) =>
      `/api/themes/${encodeURIComponent(themeId)}/assets/${encodeAssetPath(assetPath)}`);
  const cacheTtlMs = options.cacheTtlMs ?? 1_000;
  if (!Number.isFinite(cacheTtlMs) || cacheTtlMs < 0) {
    throw new Error("主题缓存有效期必须是非负有限数值");
  }
  let cachedThemes:
    | {
        expiresAt: number;
        promise: Promise<ThemeRecord[]>;
      }
    | undefined;
  let sharedFontCssPromise: Promise<string> | undefined;
  let cachedFontPacks:
    | {
        expiresAt: number;
        promise: Promise<FontPackRegistryResult>;
      }
    | undefined;
  const reportedFontPackDiagnostics = new Set<string>();
  const fontPackCacheTtlMs =
    options.fontPacks?.cacheTtlMs ?? 5 * 60_000;
  if (!Number.isFinite(fontPackCacheTtlMs) || fontPackCacheTtlMs < 0) {
    throw new Error("字体包缓存有效期必须是非负有限数值");
  }
  const createFontPackAssetUrl =
    options.fontPacks?.createAssetUrl ??
    ((
      packId: string,
      packVersion: string,
      faceId: string,
      kind: "web" | "docx",
      fingerprint: string
    ) =>
      `/api/font-packs/${encodeURIComponent(
        packId
      )}/${encodeURIComponent(packVersion)}/${encodeURIComponent(
        faceId
      )}/${kind}?v=${fingerprint}`);

  function listFontPacks() {
    if (!options.fontPacks) {
      return Promise.resolve<FontPackRegistryResult>({
        packs: [],
        diagnostics: [],
        fingerprint: "0".repeat(64)
      });
    }
    const now = Date.now();
    if (cachedFontPacks && now < cachedFontPacks.expiresAt) {
      return cachedFontPacks.promise;
    }
    const promise = discoverFontPacks({
      roots: options.fontPacks.roots,
      appVersion: options.fontPacks.appVersion
    }).then((result) => {
      for (const item of result.diagnostics) {
        if (item.severity === "info") {
          continue;
        }
        const key = [
          item.code,
          item.root ?? "",
          item.packId ?? "",
          item.packVersion ?? "",
          item.message
        ].join(":");
        if (!reportedFontPackDiagnostics.has(key)) {
          reportedFontPackDiagnostics.add(key);
          options.onWarning?.(`字体包 ${item.code}：${item.message}`);
        }
      }
      return result;
    });
    cachedFontPacks = {
      expiresAt: now + fontPackCacheTtlMs,
      promise
    };
    void promise.catch(() => {
      if (cachedFontPacks?.promise === promise) {
        cachedFontPacks = undefined;
      }
    });
    return promise;
  }

  async function resolveThemeFontPacks(theme: ThemeRecord) {
    const registry = await listFontPacks();
    const declaredFaces = theme.manifest.docxFonts?.faces ?? [];
    const faces = [...declaredFaces, ...engineCodeFontFaces];
    const requests: FontPackFaceRequest[] = faces.map((face) => ({
      family: face.family,
      aliases: face.aliases,
      weight: face.weight,
      style: face.style
    }));
    const resolution = resolveFontPackFaces(requests, registry.packs, {
      preferredPackIds: options.fontPacks?.preferredPackIds ?? [],
      reportMissing: registry.packs.length > 0
    });
    const matches = new Map<DocxFontFace, ResolvedFontPackFace>();
    for (const match of resolution.resolved) {
      const index = requests.indexOf(match.request);
      const face = index < 0 ? undefined : faces[index];
      if (face) {
        matches.set(face, match);
      }
    }
    return {
      registry,
      resolution,
      matches,
      faces: faces.filter(
        (face) => declaredFaces.includes(face) || matches.has(face)
      )
    };
  }

  function createFontPackCss(
    matches: ReadonlyMap<DocxFontFace, ResolvedFontPackFace>
  ) {
    if (matches.size === 0) {
      return "";
    }
    const fingerprints = new Set<string>();
    const rules: string[] = [];
    const emitted = new Set<string>();
    for (const [request, match] of matches) {
      fingerprints.add(
        `${match.pack.id}@${match.pack.version}:${match.pack.fingerprint}`
      );
      for (const target of match.face.targets) {
        const key = `${target.toLocaleLowerCase("en-US")}:${
          request.weight
        }:${request.style}`;
        if (emitted.has(key)) {
          continue;
        }
        emitted.add(key);
        rules.push(
          [
            "@font-face {",
            `  font-family: "${target}";`,
            `  src: url("${createFontPackAssetUrl(
              match.pack.id,
              match.pack.version,
              match.face.id,
              "web",
              match.face.web.sha256
            )}") format("woff2");`,
            `  font-weight: ${request.weight};`,
            `  font-style: ${request.style};`,
            "  font-display: block;",
            "}"
          ].join("\n")
        );
      }
    }
    return [
      `/* morphdoc-font-packs:${[...fingerprints].sort().join(",")} */`,
      ...rules
    ].join("\n");
  }

  function loadSharedFontCss() {
    if (!sharedFontCssPromise) {
      sharedFontCssPromise = (async () => {
        const sharedRoot = resolve(
          options.bundledRoot,
          sharedThemeAssetId
        );
        try {
          const cssPath = await resolveThemeFile(
            sharedRoot,
            sharedFontCssPath
          );
          return prepareCssSegment(
            await readFile(cssPath, "utf8"),
            sharedThemeAssetId,
            posix.dirname(sharedFontCssPath),
            createAssetUrl,
            false
          );
        } catch (error) {
          if (isMissingFileError(error)) {
            return "";
          }
          throw error;
        }
      })();
      void sharedFontCssPromise.catch(() => {
        sharedFontCssPromise = undefined;
      });
    }
    return sharedFontCssPromise;
  }

  async function scanThemes() {
    const [bundledThemes, localThemes] = await Promise.all([
      readThemeRoot(options.bundledRoot, "bundled"),
      readThemeRoot(options.localRoot, "local", options.onWarning)
    ]);

    const bundledThemeIds = new Set(
      bundledThemes.map((theme) => theme.manifest.id)
    );
    const uniqueLocalThemes = localThemes.filter((theme) => {
      if (!bundledThemeIds.has(theme.manifest.id)) {
        return true;
      }
      options.onWarning?.(
        `已忽略与内置主题同 ID 的本地主题 ${theme.manifest.id}`
      );
      return false;
    });
    const themes = [...bundledThemes, ...uniqueLocalThemes];
    const themeIds = new Set<string>();
    for (const theme of themes) {
      if (themeIds.has(theme.manifest.id)) {
        throw new Error(`主题 ID 重复：${theme.manifest.id}`);
      }
      themeIds.add(theme.manifest.id);
    }

    return themes;
  }

  function list() {
    const now = Date.now();
    if (cachedThemes && now < cachedThemes.expiresAt) {
      return cachedThemes.promise;
    }

    const promise = scanThemes();
    cachedThemes = {
      expiresAt: now + cacheTtlMs,
      promise
    };
    void promise.catch(() => {
      if (cachedThemes?.promise === promise) {
        cachedThemes = undefined;
      }
    });
    return promise;
  }

  function invalidate() {
    cachedThemes = undefined;
    sharedFontCssPromise = undefined;
    cachedFontPacks = undefined;
    reportedFontPackDiagnostics.clear();
  }

  async function get(themeId: string) {
    return (await list()).find((theme) => theme.manifest.id === themeId);
  }

  async function getCss(themeId: string) {
    const theme = await get(themeId);
    if (!theme) {
      return undefined;
    }

    const cssFiles = [
      ...(theme.manifest.base ? [theme.manifest.base] : []),
      theme.manifest.entry,
      ...(theme.manifest.print
        ? [theme.manifest.print]
        : [])
    ];
    const [css, fontPacks] = await Promise.all([
      Promise.all(
        cssFiles.map((path) =>
          loadThemeCssFile(theme, path, createAssetUrl)
        )
      ),
      resolveThemeFontPacks(theme)
    ]);
    if (theme.source === "bundled") {
      css.unshift(await loadSharedFontCss());
    }
    return [...css, createFontPackCss(fontPacks.matches)]
      .filter(Boolean)
      .join("\n");
  }

  async function getFontPackAsset(
    packId: string,
    packVersion: string,
    faceId: string,
    kind: "web" | "docx"
  ) {
    const registry = await listFontPacks();
    const pack = registry.packs.find(
      (candidate) =>
        candidate.id === packId && candidate.version === packVersion
    );
    const face = pack?.faces.find((candidate) => candidate.id === faceId);
    if (!face) {
      return undefined;
    }
    const asset = face[kind];
    return {
      contentType: kind === "web" ? "font/woff2" : "font/ttf",
      content: await readInstalledFontPackAsset(asset),
      sha256: asset.sha256
    };
  }

  async function getFontPackStatus(
    themeId: string
  ): Promise<ThemeFontPackStatus | undefined> {
    const theme = await get(themeId);
    if (!theme) {
      return undefined;
    }
    const { registry, resolution } = await resolveThemeFontPacks(theme);
    return {
      registryFingerprint: registry.fingerprint,
      appliedFaces: resolution.resolved.map((match) => ({
        family: match.request.family,
        weight: match.request.weight,
        style: match.request.style,
        packId: match.pack.id,
        packVersion: match.pack.version,
        faceId: match.face.id,
        webSha256: match.face.web.sha256,
        docxSha256: match.face.docx.sha256
      })),
      diagnostics: [...registry.diagnostics, ...resolution.diagnostics]
    };
  }

  async function getAsset(themeId: string, assetPath: string) {
    if (themeId === sharedThemeAssetId) {
      const extension = extname(assetPath).toLowerCase();
      const contentType = assetContentTypes[extension];
      if (!contentType) {
        throw new Error("不支持的主题资源类型");
      }
      const sharedRoot = resolve(options.bundledRoot, sharedThemeAssetId);
      const path = await resolveThemeFile(sharedRoot, assetPath);
      return {
        contentType,
        content: await readFile(path)
      };
    }

    const theme = await get(themeId);
    if (!theme) {
      return undefined;
    }

    const extension = extname(assetPath).toLowerCase();
    const contentType = assetContentTypes[extension];
    if (!contentType) {
      throw new Error("不支持的主题资源类型");
    }

    const path = await resolveThemeFile(theme.directory, assetPath);
    return {
      contentType,
      content: await readFile(path)
    };
  }

  async function getDocxFonts(
    themeId: string
  ): Promise<ThemeFontAsset[] | undefined> {
    const theme = await get(themeId);
    if (!theme) {
      return undefined;
    }
    const fontPacks = await resolveThemeFontPacks(theme);
    const faces = fontPacks.faces;
    const fonts = await Promise.all(
      faces.map(async (face) => {
        const matched = fontPacks.matches.get(face);
        if (matched) {
          return {
            ...face,
            aliases: [
              ...new Set([...face.aliases, ...matched.face.targets])
            ],
            source: `font-pack:${matched.pack.id}/${matched.pack.version}/${matched.face.id}/docx`,
            license: matched.pack.license,
            content: await readInstalledFontPackAsset(matched.face.docx)
          };
        }
        const shared = face.source.startsWith(
          sharedThemeAssetScheme
        );
        if (shared && theme.source !== "bundled") {
          throw new Error("本地主题不能嵌入内置共享字体");
        }
        const asset = await getAsset(
          shared ? sharedThemeAssetId : theme.manifest.id,
          shared
            ? face.source.slice(sharedThemeAssetScheme.length)
            : face.source
        );
        if (!asset || !asset.contentType.startsWith("font/")) {
          throw new Error(
            `DOCX 字体资源无效：${face.source}`
          );
        }
        return {
          ...face,
          content: asset.content
        };
      })
    );
    const totalBytes = fonts.reduce(
      (total, font) => total + font.content.byteLength,
      0
    );
    if (totalBytes > MAXIMUM_DOCX_FONT_TOTAL_SOURCE_BYTES) {
      throw new Error("DOCX 字体资源总大小超过限制");
    }
    return fonts;
  }

  return {
    get,
    getAsset,
    getCss,
    getDocxFonts,
    getFontPackAsset,
    getFontPackStatus,
    invalidate,
    list
  };
}
