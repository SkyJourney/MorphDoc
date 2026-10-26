import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import { prepareDocxFonts, type PreparedDocxFont } from "@morphdoc/docx-engine";
import {
  discoverFontPacks,
  fontPackManifestSchema,
  readInstalledFontPackAsset,
  type FontPackManifest,
  type InstalledFontPack
} from "@morphdoc/font-pack-registry";
import { fontPackRecipeSchema, type FontPackRecipe } from "./recipe.js";

const MAXIMUM_RECIPE_BYTES = 256 * 1024;
const MAXIMUM_NOTICE_BYTES = 256 * 1024;

export interface BuildFontPackOptions {
  recipePath: string;
  sourceRoot: string;
  outputRoot: string;
  reportPath?: string;
}

export interface VerifyFontPackOptions {
  root: string;
  appVersion: string;
  packId: string;
  packVersion: string;
}

export interface FontPackBuildReport {
  recipeSha256?: string;
  packId: string;
  packVersion: string;
  outputDirectory: string;
  unchanged: boolean;
  packFingerprint: string;
  registryFingerprint: string;
  totalBytes: number;
  faces: Array<{
    id: string;
    targets: string[];
    weight: number;
    style: "normal" | "italic";
    family: string;
    subfamily: string;
    postscriptName?: string;
    permission: "installable" | "editable";
    webSha256: string;
    docxSha256: string;
  }>;
}

function sha256(content: Uint8Array | string) {
  return createHash("sha256").update(content).digest("hex");
}

function normalizeText(content: string) {
  return content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function isContainedPath(root: string, target: string) {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function trustedRoot(root: string) {
  const requested = resolve(root);
  const status = await lstat(requested);
  if (status.isSymbolicLink() || !status.isDirectory()) {
    throw new Error(`目录不是受信任的普通目录：${requested}`);
  }
  return realpath(requested);
}

async function readTrustedFile(root: string, path: string, maximumBytes: number) {
  const candidate = resolve(root, ...path.split("/"));
  if (!isContainedPath(root, candidate)) {
    throw new Error(`资源越过受信任目录：${path}`);
  }
  const linkStatus = await lstat(candidate);
  if (linkStatus.isSymbolicLink() || !linkStatus.isFile()) {
    throw new Error(`资源不是普通文件：${path}`);
  }
  const realCandidate = await realpath(candidate);
  if (!isContainedPath(root, realCandidate)) {
    throw new Error(`资源真实路径越过受信任目录：${path}`);
  }
  const fileStatus = await stat(realCandidate);
  if (fileStatus.size > maximumBytes) {
    throw new Error(`资源超过容量限制：${path}`);
  }
  return new Uint8Array(await readFile(realCandidate));
}

async function readRecipe(recipePath: string) {
  const absolutePath = resolve(recipePath);
  const status = await lstat(absolutePath);
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    status.size > MAXIMUM_RECIPE_BYTES
  ) {
    throw new Error("字体包配方不是受支持的普通文件");
  }
  const content = await readFile(absolutePath);
  const recipe = fontPackRecipeSchema.parse(
    JSON.parse(content.toString("utf8")) as unknown
  );
  return {
    recipe,
    recipeDirectory: await trustedRoot(dirname(absolutePath)),
    recipeSha256: sha256(content)
  };
}

async function readVerifiedSource(
  root: string,
  asset: { source: string; bytes: number; sha256: string }
) {
  const content = await readTrustedFile(root, asset.source, asset.bytes);
  if (content.byteLength !== asset.bytes) {
    throw new Error(`字体源大小不匹配：${asset.source}`);
  }
  if (sha256(content) !== asset.sha256) {
    throw new Error(`字体源 SHA-256 不匹配：${asset.source}`);
  }
  return content;
}

function assertWoff2(content: Uint8Array, path: string) {
  if (
    content.byteLength < 4 ||
    String.fromCharCode(...content.subarray(0, 4)) !== "wOF2"
  ) {
    throw new Error(`Web 字体不是 WOFF2：${path}`);
  }
}

function assertTrueType(content: Uint8Array, path: string) {
  if (
    content.byteLength < 4 ||
    content[0] !== 0 ||
    content[1] !== 1 ||
    content[2] !== 0 ||
    content[3] !== 0
  ) {
    throw new Error(`DOCX 字体不是原生静态 TrueType：${path}`);
  }
}

function assertPreparedFont(
  font: PreparedDocxFont,
  recipe: FontPackRecipe,
  face: FontPackRecipe["faces"][number],
  kind: "web" | "docx"
) {
  if (font.metadata.family !== recipe.internalFamily) {
    throw new Error(
      `${kind} 字体内部家族不匹配：${font.metadata.family} != ${recipe.internalFamily}`
    );
  }
  if (font.metadata.weightClass !== face.weight) {
    throw new Error(
      `${kind} 字体内部字重不匹配：${font.metadata.weightClass} != ${face.weight}`
    );
  }
  if (font.metadata.permission !== "installable" && font.metadata.permission !== "editable") {
    throw new Error(`${kind} 字体不允许文档嵌入`);
  }
  if (kind === "docx" && font.metadata.signature !== "\u0000\u0001\u0000\u0000") {
    throw new Error("DOCX 字体解码后不是 TrueType SFNT");
  }
}

async function prepareRecipeAssets(recipe: FontPackRecipe, sourceRoot: string) {
  const assets = await Promise.all(
    recipe.faces.map(async (face) => {
      const [web, docx] = await Promise.all([
        readVerifiedSource(sourceRoot, face.web),
        readVerifiedSource(sourceRoot, face.docx)
      ]);
      assertWoff2(web, face.web.source);
      assertTrueType(docx, face.docx.source);
      return { face, web, docx };
    })
  );
  const createSources = (kind: "web" | "docx") =>
    assets.map(({ face, web, docx }) => ({
      family: recipe.internalFamily,
      aliases: [...face.targets],
      source: face[kind].source,
      weight: face.weight,
      style: face.style,
      license: recipe.license,
      content: kind === "web" ? web : docx
    }));
  const [webFonts, docxFonts] = await Promise.all([
    prepareDocxFonts(createSources("web")),
    prepareDocxFonts(createSources("docx"))
  ]);
  for (const [index, item] of assets.entries()) {
    const webFont = webFonts[index];
    const docxFont = docxFonts[index];
    if (!webFont || !docxFont) {
      throw new Error("字体元数据验证结果不完整");
    }
    assertPreparedFont(webFont, recipe, item.face, "web");
    assertPreparedFont(docxFont, recipe, item.face, "docx");
    if (docxFont.fingerprint !== item.face.docx.sha256) {
      throw new Error(
        `DOCX 字体需要规范化后才能使用，不是冻结的原生静态资产：${item.face.docx.source}`
      );
    }
    if (
      webFont.metadata.family !== docxFont.metadata.family ||
      webFont.metadata.weightClass !== docxFont.metadata.weightClass ||
      webFont.metadata.subfamily !== docxFont.metadata.subfamily
    ) {
      throw new Error(`Web 与 DOCX 字体元数据不一致：${item.face.id}`);
    }
  }
  return assets.map((item, index) => ({
    ...item,
    metadata: docxFonts[index]!.metadata
  }));
}

function createManifest(
  recipe: FontPackRecipe,
  licenseContent: Uint8Array
): FontPackManifest {
  return fontPackManifestSchema.parse({
    manifestVersion: recipe.manifestVersion,
    id: recipe.id,
    version: recipe.version,
    name: recipe.name,
    description: recipe.description,
    license: recipe.license,
    licenseFile: recipe.licensePath,
    licenseSha256: sha256(licenseContent),
    licenseBytes: licenseContent.byteLength,
    compatibility: recipe.compatibility,
    faces: recipe.faces.map((face) => ({
      id: face.id,
      targets: face.targets,
      weight: face.weight,
      style: face.style,
      web: {
        path: face.web.path,
        format: "woff2",
        bytes: face.web.bytes,
        sha256: face.web.sha256
      },
      docx: {
        path: face.docx.path,
        format: "truetype",
        bytes: face.docx.bytes,
        sha256: face.docx.sha256
      }
    }))
  });
}

async function writePackFile(root: string, path: string, content: Uint8Array | string) {
  const target = resolve(root, ...path.split("/"));
  if (!isContainedPath(root, target)) {
    throw new Error(`输出路径越过字体包目录：${path}`);
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function directoryFingerprint(root: string) {
  const files: Array<{ path: string; sha256: string }> = [];
  async function visit(directory: string) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name, "en")
    )) {
      const target = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`字体包输出包含符号链接：${target}`);
      }
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile()) {
        files.push({
          path: relative(root, target).split(sep).join("/"),
          sha256: sha256(await readFile(target))
        });
      } else {
        throw new Error(`字体包输出包含不支持的文件类型：${target}`);
      }
    }
  }
  await visit(root);
  return sha256(JSON.stringify(files));
}

async function installStagedPack(stagePack: string, outputRoot: string, recipe: FontPackRecipe) {
  const idDirectory = resolve(outputRoot, recipe.id);
  const finalDirectory = resolve(idDirectory, recipe.version);
  await mkdir(idDirectory, { recursive: true });
  try {
    const existing = await lstat(finalDirectory);
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new Error(`同版本目标不是普通目录：${finalDirectory}`);
    }
    const [existingFingerprint, stagedFingerprint] = await Promise.all([
      directoryFingerprint(finalDirectory),
      directoryFingerprint(stagePack)
    ]);
    if (existingFingerprint !== stagedFingerprint) {
      throw new Error(
        `拒绝覆盖内容不同的已发行字体包版本：${recipe.id}@${recipe.version}`
      );
    }
    return { directory: finalDirectory, unchanged: true };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      await rename(stagePack, finalDirectory);
      return { directory: finalDirectory, unchanged: false };
    }
    throw error;
  }
}

async function validateInstalledPack(
  pack: InstalledFontPack,
  expectedVersion: string
) {
  if (pack.version !== expectedVersion) {
    throw new Error(`字体包版本不匹配：${pack.version} != ${expectedVersion}`);
  }
  const contents = await Promise.all(
    pack.faces.map(async (face) => {
      const [web, docx] = await Promise.all([
        readInstalledFontPackAsset(face.web),
        readInstalledFontPackAsset(face.docx)
      ]);
      assertWoff2(web, face.web.path);
      assertTrueType(docx, face.docx.path);
      return { face, web, docx };
    })
  );
  const createSources = (kind: "web" | "docx") =>
    contents.map(({ face, web, docx }) => ({
      family: face.targets[0]!,
      aliases: face.targets.slice(1),
      source: face[kind].absolutePath,
      weight: face.weight,
      style: face.style,
      license: pack.license,
      content: kind === "web" ? web : docx
    }));
  const [webFonts, docxFonts] = await Promise.all([
    prepareDocxFonts(createSources("web")),
    prepareDocxFonts(createSources("docx"))
  ]);
  for (const [index, font] of docxFonts.entries()) {
    const face = pack.faces[index]!;
    const webFont = webFonts[index];
    if (
      !webFont ||
      font.metadata.signature !== "\u0000\u0001\u0000\u0000" ||
      font.metadata.weightClass !== face.weight ||
      font.fingerprint !== face.docx.sha256 ||
      webFont.metadata.family !== font.metadata.family ||
      webFont.metadata.subfamily !== font.metadata.subfamily ||
      webFont.metadata.weightClass !== font.metadata.weightClass
    ) {
      throw new Error(`已安装字体包元数据不匹配：${face.id}`);
    }
  }
  return docxFonts;
}

export async function verifyFontPack(
  options: VerifyFontPackOptions
): Promise<FontPackBuildReport> {
  const result = await discoverFontPacks({
    roots: [options.root],
    appVersion: options.appVersion
  });
  const blocking = result.diagnostics.filter((item) => item.severity !== "info");
  if (blocking.length > 0) {
    throw new Error(
      `字体包注册验证失败：${blocking.map((item) => `${item.code} ${item.message}`).join("；")}`
    );
  }
  const pack = result.packs.find((item) => item.id === options.packId);
  if (!pack) {
    throw new Error(`未发现字体包：${options.packId}`);
  }
  const fonts = await validateInstalledPack(pack, options.packVersion);
  return {
    packId: pack.id,
    packVersion: pack.version,
    outputDirectory: pack.directory,
    unchanged: true,
    packFingerprint: pack.fingerprint,
    registryFingerprint: result.fingerprint,
    totalBytes: pack.faces.reduce(
      (total, face) => total + face.web.bytes + face.docx.bytes,
      pack.licenseBytes
    ),
    faces: pack.faces.map((face, index) => ({
      id: face.id,
      targets: [...face.targets],
      weight: face.weight,
      style: face.style,
      family: fonts[index]!.metadata.family,
      subfamily: fonts[index]!.metadata.subfamily,
      ...(fonts[index]!.metadata.postscriptName
        ? { postscriptName: fonts[index]!.metadata.postscriptName }
        : {}),
      permission: fonts[index]!.metadata.permission,
      webSha256: face.web.sha256,
      docxSha256: face.docx.sha256
    }))
  };
}

export async function buildFontPack(
  options: BuildFontPackOptions
): Promise<FontPackBuildReport> {
  const { recipe, recipeDirectory, recipeSha256 } = await readRecipe(
    options.recipePath
  );
  const sourceRoot = await trustedRoot(options.sourceRoot);
  const [licenseText, noticeText, assets] = await Promise.all([
    readTrustedFile(recipeDirectory, recipe.licenseSource, recipe.licenseBytes),
    readTrustedFile(recipeDirectory, recipe.noticeSource, MAXIMUM_NOTICE_BYTES),
    prepareRecipeAssets(recipe, sourceRoot)
  ]);
  const normalizedLicense = new TextEncoder().encode(
    normalizeText(new TextDecoder().decode(licenseText))
  );
  if (
    normalizedLicense.byteLength !== recipe.licenseBytes ||
    sha256(normalizedLicense) !== recipe.licenseSha256
  ) {
    throw new Error("字体许可证大小或 SHA-256 与配方不匹配");
  }
  const manifest = createManifest(recipe, normalizedLicense);
  const outputRoot = resolve(options.outputRoot);
  await mkdir(outputRoot, { recursive: true });
  const stageRoot = resolve(
    dirname(outputRoot),
    `.font-pack-stage-${recipe.id}-${randomUUID()}`
  );
  const stagePack = resolve(stageRoot, recipe.id, recipe.version);
  await mkdir(stagePack, { recursive: true });
  try {
    await Promise.all([
      writePackFile(stagePack, recipe.licensePath, normalizedLicense),
      writePackFile(
        stagePack,
        recipe.noticePath,
        normalizeText(new TextDecoder().decode(noticeText))
      ),
      ...assets.flatMap((item) => [
        writePackFile(stagePack, item.face.web.path, item.web),
        writePackFile(stagePack, item.face.docx.path, item.docx)
      ])
    ]);
    await writePackFile(
      stagePack,
      "font-pack.json",
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    const stagedRegistry = await discoverFontPacks({
      roots: [stageRoot],
      appVersion: recipe.compatibility.minimumAppVersion
    });
    const stagedBlocking = stagedRegistry.diagnostics.filter(
      (item) => item.severity !== "info"
    );
    if (stagedBlocking.length > 0 || stagedRegistry.packs.length !== 1) {
      throw new Error(
        `暂存字体包注册验证失败：${stagedBlocking
          .map((item) => `${item.code} ${item.message}`)
          .join("；")}`
      );
    }
    const installed = await installStagedPack(stagePack, outputRoot, recipe);
    const report = await verifyFontPack({
      root: outputRoot,
      appVersion: recipe.compatibility.minimumAppVersion,
      packId: recipe.id,
      packVersion: recipe.version
    });
    const finalReport: FontPackBuildReport = {
      ...report,
      recipeSha256,
      outputDirectory: installed.directory,
      unchanged: installed.unchanged
    };
    if (options.reportPath) {
      const reportPath = resolve(options.reportPath);
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, `${JSON.stringify(finalReport, null, 2)}\n`, "utf8");
    }
    return finalReport;
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}
