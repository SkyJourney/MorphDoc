import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFontPack,
  verifyFontPack
} from "../packages/font-pack-builder/dist/index.js";
import { discoverFontPacks } from "../packages/font-pack-registry/dist/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = join(repositoryRoot, "font-packs", "bundle.json");
const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
const outputRoot = join(repositoryRoot, "output", "font-packs", "root");
// 版本号只在 package.json 中维护：直接读取，不依赖 npm_package_version（仅在经由 pnpm 运行
// 时才存在），也不保留写死的回退值（每次发版都会悄悄过期）
const appVersion = JSON.parse(
  await readFile(join(repositoryRoot, "package.json"), "utf8")
).version;
if (typeof appVersion !== "string" || appVersion === "") {
  throw new Error("根 package.json 缺少有效的 version");
}

if (
  bundle.schemaVersion !== 1 ||
  !Array.isArray(bundle.packs) ||
  bundle.packs.length === 0
) {
  throw new Error("字体包集合清单无效");
}

const identities = new Set();
const reports = [];
for (const pack of bundle.packs) {
  const identity = `${pack.id}@${pack.version}`;
  if (identities.has(identity)) {
    throw new Error(`字体包集合存在重复项：${identity}`);
  }
  identities.add(identity);
  const reportPath = join(
    repositoryRoot,
    "output",
    "font-packs",
    `${pack.id}-build-report.json`
  );
  const built = await buildFontPack({
    recipePath: resolve(repositoryRoot, pack.recipe),
    sourceRoot: resolve(repositoryRoot, pack.sourceRoot),
    outputRoot,
    reportPath
  });
  const verified = await verifyFontPack({
    root: outputRoot,
    appVersion,
    packId: pack.id,
    packVersion: pack.version
  });
  reports.push({ identity, built, verified });
}

const registry = await discoverFontPacks({
  roots: [outputRoot],
  appVersion
});
const errors = registry.diagnostics.filter((item) => item.severity === "error");
if (errors.length > 0) {
  throw new Error(
    `字体包集合注册失败：${errors.map((item) => `${item.code} ${item.message}`).join("；")}`
  );
}
const actualIdentities = registry.packs
  .map((pack) => `${pack.id}@${pack.version}`)
  .sort();
const expectedIdentities = [...identities].sort();
if (JSON.stringify(actualIdentities) !== JSON.stringify(expectedIdentities)) {
  throw new Error(
    `字体包输出根目录包含清单外内容：期望 ${expectedIdentities.join(", ")}，实际 ${actualIdentities.join(", ")}`
  );
}

process.stdout.write(
  `${JSON.stringify({ appVersion, outputRoot, registryFingerprint: registry.fingerprint, reports }, null, 2)}\n`
);
