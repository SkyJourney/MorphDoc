import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
  realpath,
  stat
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  MAXIMUM_FONT_PACK_COUNT,
  MAXIMUM_FONT_PACK_LICENSE_BYTES,
  MAXIMUM_FONT_PACK_MANIFEST_BYTES,
  compareSemanticVersions,
  fontPackManifestSchema,
  isAppVersionCompatible,
  semanticVersionSchema,
  type FontPackAsset,
  type FontPackManifest
} from "./schema.js";
import type {
  DiscoverFontPacksOptions,
  FontPackDiagnostic,
  FontPackRegistryResult,
  InstalledFontPack,
  InstalledFontPackAsset,
  InstalledFontPackFace
} from "./types.js";

function sha256(content: Uint8Array | string) {
  return createHash("sha256").update(content).digest("hex");
}

function isContainedPath(root: string, target: string) {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function readTrustedFile(
  packDirectory: string,
  asset: FontPackAsset | { path: string; bytes: number; sha256: string }
) {
  const candidate = resolve(packDirectory, ...asset.path.split("/"));
  if (!isContainedPath(packDirectory, candidate)) {
    throw new Error(`资源越过字体包目录：${asset.path}`);
  }
  const linkStatus = await lstat(candidate);
  if (linkStatus.isSymbolicLink() || !linkStatus.isFile()) {
    throw new Error(`资源不是普通文件：${asset.path}`);
  }
  const realCandidate = await realpath(candidate);
  if (!isContainedPath(packDirectory, realCandidate)) {
    throw new Error(`资源真实路径越过字体包目录：${asset.path}`);
  }
  const fileStatus = await stat(realCandidate);
  if (fileStatus.size !== asset.bytes) {
    throw new Error(`资源大小不匹配：${asset.path}`);
  }
  const content = await readFile(realCandidate);
  if (sha256(content) !== asset.sha256) {
    throw new Error(`资源 SHA-256 不匹配：${asset.path}`);
  }
  return { absolutePath: realCandidate, content };
}

async function loadPack(
  root: string,
  rootIndex: number,
  idDirectory: string,
  versionDirectory: string,
  appVersion: string
): Promise<InstalledFontPack> {
  const packDirectory = await realpath(versionDirectory);
  if (!isContainedPath(root, packDirectory)) {
    throw new Error("字体包目录越过注册根目录");
  }
  const manifestPath = resolve(packDirectory, "font-pack.json");
  const manifestStatus = await lstat(manifestPath);
  if (
    manifestStatus.isSymbolicLink() ||
    !manifestStatus.isFile() ||
    manifestStatus.size > MAXIMUM_FONT_PACK_MANIFEST_BYTES
  ) {
    throw new Error("font-pack.json 不是受支持的普通文件");
  }
  const manifest = fontPackManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")) as unknown
  );
  if (manifest.id !== idDirectory) {
    throw new Error(`清单 ID 与目录不一致：${manifest.id} != ${idDirectory}`);
  }
  const versionName = versionDirectory.split(/[\\/]/u).at(-1);
  if (manifest.version !== versionName) {
    throw new Error(`清单版本与目录不一致：${manifest.version} != ${versionName}`);
  }
  if (!isAppVersionCompatible(appVersion, manifest.compatibility)) {
    throw Object.assign(new Error("字体包与当前应用版本不兼容"), {
      code: "PACK_INCOMPATIBLE"
    });
  }
  const license = await readTrustedFile(packDirectory, {
    path: manifest.licenseFile,
    bytes: manifest.licenseBytes,
    sha256: manifest.licenseSha256
  });
  if (license.content.byteLength > MAXIMUM_FONT_PACK_LICENSE_BYTES) {
    throw new Error("字体包许可文件超过大小限制");
  }
  const faces: InstalledFontPackFace[] = [];
  for (const face of manifest.faces) {
    const web = await readTrustedFile(packDirectory, face.web);
    const docx = await readTrustedFile(packDirectory, face.docx);
    faces.push({
      ...face,
      web: {
        ...face.web,
        absolutePath: web.absolutePath,
        packDirectory
      },
      docx: {
        ...face.docx,
        absolutePath: docx.absolutePath,
        packDirectory
      }
    });
  }
  const fingerprint = sha256(
    JSON.stringify({
      manifestVersion: manifest.manifestVersion,
      id: manifest.id,
      version: manifest.version,
      licenseSha256: manifest.licenseSha256,
      faces: manifest.faces.map((face) => ({
        id: face.id,
        targets: [...face.targets].sort(),
        weight: face.weight,
        style: face.style,
        web: face.web.sha256,
        docx: face.docx.sha256
      }))
    })
  );
  return {
    ...manifest,
    root,
    directory: packDirectory,
    rootIndex,
    fingerprint,
    faces
  };
}

function diagnostic(
  code: FontPackDiagnostic["code"],
  severity: FontPackDiagnostic["severity"],
  message: string,
  fields: Partial<Omit<FontPackDiagnostic, "code" | "severity" | "message">> = {}
): FontPackDiagnostic {
  return { code, severity, message, ...fields };
}

export async function discoverFontPacks(
  options: DiscoverFontPacksOptions
): Promise<FontPackRegistryResult> {
  semanticVersionSchema.parse(options.appVersion);
  const diagnostics: FontPackDiagnostic[] = [];
  const candidates: InstalledFontPack[] = [];
  for (const [rootIndex, configuredRoot] of options.roots.entries()) {
    let root: string;
    const requestedRoot = resolve(configuredRoot);
    try {
      const requestedStatus = await lstat(requestedRoot);
      if (requestedStatus.isSymbolicLink() || !requestedStatus.isDirectory()) {
        diagnostics.push(
          diagnostic("ROOT_INVALID", "error", "字体包根目录不是普通目录", {
            root: requestedRoot
          })
        );
        continue;
      }
      root = await realpath(requestedRoot);
    } catch {
      diagnostics.push(
        diagnostic("ROOT_NOT_FOUND", "info", "字体包根目录不存在", {
          root: requestedRoot
        })
      );
      continue;
    }
    const rootStatus = await lstat(root);
    if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
      diagnostics.push(
        diagnostic("ROOT_INVALID", "error", "字体包根目录不是普通目录", { root })
      );
      continue;
    }
    const idEntries = (await readdir(root, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name, "en")
    );
    for (const idEntry of idEntries) {
      if (!idEntry.isDirectory() || idEntry.isSymbolicLink()) {
        continue;
      }
      const idDirectory = resolve(root, idEntry.name);
      const versionEntries = (await readdir(idDirectory, { withFileTypes: true })).sort(
        (a, b) => a.name.localeCompare(b.name, "en")
      );
      for (const versionEntry of versionEntries) {
        if (
          !versionEntry.isDirectory() ||
          versionEntry.isSymbolicLink() ||
          !semanticVersionSchema.safeParse(versionEntry.name).success
        ) {
          continue;
        }
        try {
          candidates.push(
            await loadPack(
              root,
              rootIndex,
              idEntry.name,
              resolve(idDirectory, versionEntry.name),
              options.appVersion
            )
          );
        } catch (error) {
          const incompatible =
            error instanceof Error &&
            "code" in error &&
            error.code === "PACK_INCOMPATIBLE";
          diagnostics.push(
            diagnostic(
              incompatible ? "PACK_INCOMPATIBLE" : "MANIFEST_INVALID",
              incompatible ? "warning" : "error",
              error instanceof Error ? error.message : "字体包加载失败",
              {
                root,
                packId: idEntry.name,
                packVersion: versionEntry.name
              }
            )
          );
        }
      }
    }
  }
  const selected = new Map<string, InstalledFontPack>();
  for (const candidate of candidates.sort((left, right) => {
    if (left.rootIndex !== right.rootIndex) {
      return left.rootIndex - right.rootIndex;
    }
    const idOrder = left.id.localeCompare(right.id, "en");
    return idOrder !== 0
      ? idOrder
      : compareSemanticVersions(right.version, left.version);
  })) {
    const existing = selected.get(candidate.id);
    if (!existing) {
      selected.set(candidate.id, candidate);
      continue;
    }
    diagnostics.push(
      diagnostic("PACK_SHADOWED", "info", "字体包版本被更高优先级版本覆盖", {
        root: candidate.root,
        packId: candidate.id,
        packVersion: candidate.version
      })
    );
  }
  const packs = [...selected.values()];
  if (packs.length > MAXIMUM_FONT_PACK_COUNT) {
    diagnostics.push(
      diagnostic("PACK_LIMIT_EXCEEDED", "error", "可用字体包数量超过限制")
    );
    packs.length = MAXIMUM_FONT_PACK_COUNT;
  }
  return {
    packs,
    diagnostics,
    fingerprint: sha256(
      packs.map((pack) => `${pack.id}@${pack.version}:${pack.fingerprint}`).join("\n")
    )
  };
}

export async function readInstalledFontPackAsset(
  asset: InstalledFontPackAsset
) {
  const content = (
    await readTrustedFile(asset.packDirectory, {
      path: asset.path,
      bytes: asset.bytes,
      sha256: asset.sha256
    })
  ).content;
  return new Uint8Array(content);
}
