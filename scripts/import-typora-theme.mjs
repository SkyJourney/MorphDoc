import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localRoot = join(projectRoot, ".local");
const targetRoot = join(localRoot, "themes");
const backupRoot = join(localRoot, "theme-backups");
const replaceExisting = process.argv.slice(2).includes("--replace");
const unknownArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--replace");

if (unknownArguments.length > 0) {
  throw new Error(`不支持的参数：${unknownArguments.join(", ")}`);
}

const typoraThemes = [
  {
    key: "github",
    name: "Typora 默认（GitHub，本地）"
  },
  {
    key: "pixyll",
    name: "Typora 默认（Pixyll，本地）"
  },
  {
    key: "whitey",
    name: "Typora 默认（Whitey，本地）"
  }
];

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertReadable(path, label) {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(`${label}不存在或不可读取：${path}`);
  }
}

async function findTyporaInstallRoot() {
  const candidates = [
    process.env.TYPORA_INSTALL_DIR,
    process.env.ProgramFiles
      ? join(process.env.ProgramFiles, "Typora")
      : undefined,
    process.env["ProgramFiles(x86)"]
      ? join(process.env["ProgramFiles(x86)"], "Typora")
      : undefined,
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Programs", "Typora")
      : undefined
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (
      await pathExists(join(candidate, "resources", "style", "base.css"))
    ) {
      return candidate;
    }
  }

  throw new Error(
    "未找到 Typora 安装目录。请通过 TYPORA_INSTALL_DIR 指定安装根目录。"
  );
}

const installRoot = await findTyporaInstallRoot();
const sourceThemeRoot =
  process.env.TYPORA_THEME_DIR ??
  join(installRoot, "resources", "style", "themes");
const sourceBaseCss =
  process.env.TYPORA_BASE_CSS ??
  join(installRoot, "resources", "style", "base.css");
const packagePath = join(installRoot, "resources", "package.json");
const typoraVersion = (await pathExists(packagePath))
  ? JSON.parse(await readFile(packagePath, "utf8")).version ?? "local"
  : "local";

await assertReadable(sourceBaseCss, "Typora 基础 CSS");
await assertReadable(sourceThemeRoot, "Typora 默认主题目录");

for (const theme of typoraThemes) {
  await assertReadable(
    join(sourceThemeRoot, `${theme.key}.css`),
    `Typora ${theme.key} 主题`
  );
}

const existingTargets = [];
for (const theme of typoraThemes) {
  const target = join(targetRoot, `typora-${theme.key}`);
  if (await pathExists(target)) {
    existingTargets.push(target);
  }
}

if (existingTargets.length > 0 && !replaceExisting) {
  throw new Error(
    [
      "以下目标目录已存在：",
      ...existingTargets.map((path) => `- ${path}`),
      "如已确认替换这些本地副本，请使用 --replace。"
    ].join("\n")
  );
}

await mkdir(localRoot, { recursive: true });
await mkdir(targetRoot, { recursive: true });
const stagingRoot = await mkdtemp(join(localRoot, ".typora-import-"));

try {
  for (const theme of typoraThemes) {
    const id = `typora-${theme.key}`;
    const stagingThemeRoot = join(stagingRoot, id);
    const sourceCss = join(sourceThemeRoot, `${theme.key}.css`);
    const sourceAssets = join(sourceThemeRoot, theme.key);

    await mkdir(stagingThemeRoot, { recursive: true });
    await writeFile(
      join(stagingThemeRoot, "typora-base.css"),
      await readFile(sourceBaseCss, "utf8"),
      "utf8"
    );
    await writeFile(
      join(stagingThemeRoot, `${theme.key}.css`),
      await readFile(sourceCss, "utf8"),
      "utf8"
    );
    if (await pathExists(sourceAssets)) {
      await cp(sourceAssets, join(stagingThemeRoot, theme.key), {
        recursive: true,
        errorOnExist: true,
        force: false
      });
    }

    const manifest = {
      manifestVersion: 1,
      id,
      name: theme.name,
      version: typoraVersion,
      description:
        `从本机 Typora ${typoraVersion} 安装导入，仅供当前设备个人使用，` +
        "不进入 Git、容器或发布包。",
      author: "Typora",
      license: "本地个人使用，未随项目分发",
      base: "typora-base.css",
      entry: `${theme.key}.css`,
      domPreset: "typora",
      defaultFontSize: "16px",
      supportedFeatures: [
        "code",
        "table",
        "task-list",
        "footnote",
        "katex",
        "mermaid"
      ],
      bundled: false
    };

    await writeFile(
      join(stagingThemeRoot, "theme.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );
  }

  let currentBackupRoot;
  if (existingTargets.length > 0) {
    const backupStamp = new Date()
      .toISOString()
      .replaceAll(":", "")
      .replaceAll(".", "");
    currentBackupRoot = join(backupRoot, backupStamp);
    await mkdir(currentBackupRoot, { recursive: true });
  }

  const installedThemes = [];
  const backedUpThemes = [];
  try {
    for (const theme of typoraThemes) {
      const id = `typora-${theme.key}`;
      const target = join(targetRoot, id);
      if (await pathExists(target)) {
        const backup = join(currentBackupRoot, id);
        await rename(target, backup);
        backedUpThemes.push({ target, backup });
      }

      await rename(join(stagingRoot, id), target);
      installedThemes.push(target);
    }
  } catch (error) {
    for (const target of installedThemes.reverse()) {
      await rm(target, { recursive: true, force: true });
    }
    for (const { target, backup } of backedUpThemes.reverse()) {
      if (await pathExists(backup)) {
        await rename(backup, target);
      }
    }
    throw error;
  }

  console.log(`Typora 安装目录：${installRoot}`);
  console.log(`Typora 版本：${typoraVersion}`);
  for (const theme of typoraThemes) {
    console.log(
      `已导入本地主题：${join(targetRoot, `typora-${theme.key}`)}`
    );
  }
  if (currentBackupRoot) {
    console.log(`旧主题备份：${currentBackupRoot}`);
  }
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}
