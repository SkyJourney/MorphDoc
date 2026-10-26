import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildFontPack, verifyFontPack } from "../src/index.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const katexFontRoot = join(
  dirname(createRequire(import.meta.url).resolve("katex/package.json")),
  "dist",
  "fonts"
);
const temporaryDirectories: string[] = [];

function hash(content: Uint8Array | string) {
  return createHash("sha256").update(content).digest("hex");
}

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "morphdoc-font-pack-builder-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function createFixture(root: string) {
  const sourceRoot = join(root, "source");
  const recipeRoot = join(root, "recipe");
  const outputRoot = join(root, "output", "root");
  const reportPath = join(root, "output", "report.json");
  await Promise.all([mkdir(sourceRoot, { recursive: true }), mkdir(recipeRoot, { recursive: true })]);
  const webName = "KaTeX_Main-Regular.woff2";
  const docxName = "KaTeX_Main-Regular.ttf";
  await Promise.all([
    copyFile(join(katexFontRoot, webName), join(sourceRoot, webName)),
    copyFile(join(katexFontRoot, docxName), join(sourceRoot, docxName))
  ]);
  const [web, docx] = await Promise.all([
    readFile(join(sourceRoot, webName)),
    readFile(join(sourceRoot, docxName))
  ]);
  const license = "Test Font License\n";
  const notice = "# Test font\n";
  await Promise.all([
    writeFile(join(recipeRoot, "LICENSE.txt"), license, "utf8"),
    writeFile(join(recipeRoot, "SOURCE.md"), notice, "utf8")
  ]);
  const recipe = {
    recipeVersion: 1,
    manifestVersion: 1,
    id: "test-serif",
    version: "1.0.0",
    name: "测试字体包",
    description: "构建器测试",
    internalFamily: "KaTeX_Main",
    license: "Test",
    licenseSource: "LICENSE.txt",
    licensePath: "LICENSE.txt",
    licenseBytes: Buffer.byteLength(license),
    licenseSha256: hash(license),
    noticeSource: "SOURCE.md",
    noticePath: "SOURCE.md",
    compatibility: {
      minimumAppVersion: "0.6.0",
      maximumAppVersionExclusive: "0.7.0"
    },
    faces: [
      {
        id: "main-regular",
        targets: ["KaTeX_Main"],
        weight: 400,
        style: "normal",
        web: {
          source: webName,
          path: `fonts/${webName}`,
          bytes: web.byteLength,
          sha256: hash(web)
        },
        docx: {
          source: docxName,
          path: `fonts/${docxName}`,
          bytes: docx.byteLength,
          sha256: hash(docx)
        }
      }
    ]
  };
  const recipePath = join(recipeRoot, "recipe.json");
  await writeFile(recipePath, `${JSON.stringify(recipe, null, 2)}\n`, "utf8");
  return { sourceRoot, recipeRoot, outputRoot, reportPath, recipePath, recipe };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("字体包构建器", () => {
  it("从冻结资源构建可注册、可重复验证的字体包", async () => {
    const fixture = await createFixture(await temporaryDirectory());
    const first = await buildFontPack(fixture);
    expect(first.unchanged).toBe(false);
    expect(first.packId).toBe("test-serif");
    expect(first.faces[0]).toMatchObject({
      family: "KaTeX_Main",
      weight: 400,
      permission: "installable"
    });
    expect(JSON.parse(await readFile(fixture.reportPath, "utf8"))).toMatchObject({
      packId: "test-serif",
      packVersion: "1.0.0"
    });

    const second = await buildFontPack(fixture);
    expect(second.unchanged).toBe(true);
    expect(second.packFingerprint).toBe(first.packFingerprint);

    const verified = await verifyFontPack({
      root: fixture.outputRoot,
      appVersion: "0.6.0",
      packId: "test-serif",
      packVersion: "1.0.0"
    });
    expect(verified.faces).toHaveLength(1);
  });

  it("拒绝哈希不匹配的冻结字体源", async () => {
    const fixture = await createFixture(await temporaryDirectory());
    const webPath = join(fixture.sourceRoot, "KaTeX_Main-Regular.woff2");
    const content = await readFile(webPath);
    content[content.byteLength - 1] = (content[content.byteLength - 1] ?? 0) ^ 1;
    await writeFile(webPath, content);
    await expect(buildFontPack(fixture)).rejects.toThrow("SHA-256");
  });

  it("拒绝覆盖内容不同的同版本发行包", async () => {
    const fixture = await createFixture(await temporaryDirectory());
    await buildFontPack(fixture);
    const changedRecipe = {
      ...fixture.recipe,
      description: "同版本内容发生变化"
    };
    await writeFile(
      fixture.recipePath,
      `${JSON.stringify(changedRecipe, null, 2)}\n`,
      "utf8"
    );
    await expect(buildFontPack(fixture)).rejects.toThrow("拒绝覆盖");
  });
});
