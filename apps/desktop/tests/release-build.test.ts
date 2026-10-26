import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  version?: string;
  productName?: string;
  scripts?: Record<string, string>;
}

interface ProductBrand {
  appId: string;
  englishName: string;
  displayName: string;
  windowTitle: string;
  executableName: string;
  artifactPrefix: string;
}

interface PandocRuntimeManifest {
  version: string;
  artifacts: Array<{
    platform: string;
    architecture: string;
    sha256: string;
    licenseFiles: string[];
    files?: Record<string, { bytes: number; sha256: string }>;
  }>;
}

const desktopRoot = fileURLToPath(new URL("../", import.meta.url));
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));

function readManifest<T = PackageManifest>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

describe("桌面发行构建链", () => {
  it("打包前按依赖顺序完整重建内嵌 Web", () => {
    const rootManifest = readManifest(`${projectRoot}/package.json`);
    const desktopManifest = readManifest(`${desktopRoot}/package.json`);
    const webBuild = rootManifest.scripts?.["build:web-runtime"] ?? "";
    const expectedWorkspaces = [
      "@morphdoc/markdown-echarts",
      "@morphdoc/core",
      "@morphdoc/renderer",
      "@morphdoc/preview-engine",
      "@morphdoc/application",
      "@morphdoc/web"
    ];

    let previousIndex = -1;
    for (const workspace of expectedWorkspaces) {
      const workspaceIndex = webBuild.indexOf(workspace);
      expect(workspaceIndex).toBeGreaterThan(previousIndex);
      previousIndex = workspaceIndex;
    }

    expect(desktopManifest.scripts?.["build:embedded-web"]).toBe(
      "pnpm -C ../.. run build:web-runtime"
    );
    expect(desktopManifest.scripts?.package).toMatch(
      /^pnpm run build:embedded-web && /
    );
    expect(desktopManifest.scripts?.make).toMatch(
      /^pnpm run build:embedded-web && /
    );
    expect(desktopManifest.scripts?.package).toContain(
      "pnpm run prepare:pandoc"
    );
    expect(desktopManifest.scripts?.make).toContain(
      "pnpm run prepare:pandoc"
    );
    expect(rootManifest.scripts?.["desktop:package"]).toBe(
      "pnpm run build:font-pack && pnpm --filter @morphdoc/desktop run package"
    );
    expect(rootManifest.scripts?.["desktop:make"]).toBe(
      "pnpm run build:font-pack && node scripts/build-desktop-release.mjs"
    );
    expect(rootManifest.scripts?.["desktop:make:with-font-pack"]).toBeUndefined();
  });

  it("将固定 Pandoc 最小运行时作为 Desktop 独立资源打包", () => {
    const desktopManifest = readManifest(`${desktopRoot}/package.json`);
    const runtimeManifest = readManifest<PandocRuntimeManifest>(
      `${projectRoot}/packages/docx-engine/src/pandoc-runtime.json`
    );
    const builderConfig = readFileSync(
      `${desktopRoot}/electron-builder.config.cjs`,
      "utf8"
    );
    const prepareScript = readFileSync(
      `${desktopRoot}/scripts/prepare-pandoc-runtime.mjs`,
      "utf8"
    );
    const windowsArtifact = runtimeManifest.artifacts.find(
      (artifact) =>
        artifact.platform === "win32" && artifact.architecture === "x64"
    );

    expect(runtimeManifest.version).toBe("3.9.0.2");
    expect(windowsArtifact).toMatchObject({
      sha256:
        "C97542F2800F446E788D9F74237856D995421AD1BB3CC8324286840C5F272D3A",
      licenseFiles: ["COPYING.rtf", "COPYRIGHT.txt"],
      files: {
        "pandoc.exe": {
          bytes: 231056136,
          sha256:
            "E83F8354C0F507222B5684797B9C5AE766F03889785995D14AAC27816EC456BA"
        }
      }
    });
    expect(desktopManifest.scripts?.["prepare:pandoc"]).toBe(
      "node scripts/prepare-pandoc-runtime.mjs"
    );
    expect(builderConfig).toContain(
      "`.runtime/pandoc/${pandocRuntime.version}/windows-x86_64`"
    );
    expect(builderConfig).toContain('"pandoc.exe"');
    expect(builderConfig).toContain('"COPYING.rtf"');
    expect(builderConfig).toContain('"COPYRIGHT.txt"');
    expect(prepareScript).toContain("sha256(downloaded)");
    expect(prepareScript).toContain("smokeTestPandoc");
    expect(prepareScript).toContain('process.argv.includes("--check")');
  });

  it("将内置主题示例作为独立资源复制到发行目录", () => {
    const builderConfig = readFileSync(
      `${desktopRoot}/electron-builder.config.cjs`,
      "utf8"
    );

    expect(builderConfig).toContain('from: "../../samples"');
    expect(builderConfig).toContain('to: "samples"');
  });

  it("保持安装身份并从统一配置生成 MorphDoc 发行名称", () => {
    const brand = readManifest<ProductBrand>(
      `${projectRoot}/product.json`
    );
    const desktopManifest = readManifest(
      `${desktopRoot}/package.json`
    );
    const builderConfig = readFileSync(
      `${desktopRoot}/electron-builder.config.cjs`,
      "utf8"
    );
    const installerInclude = readFileSync(
      `${desktopRoot}/build/installer.nsh`,
      "utf8"
    );

    expect(brand).toMatchObject({
      appId: "com.morphdoc.desktop",
      englishName: "MorphDoc",
      displayName: "墨呈",
      windowTitle: "墨呈 · MorphDoc",
      executableName: "MorphDoc",
      artifactPrefix: "MorphDoc"
    });
    expect(desktopManifest).toMatchObject({
      version: "0.6.4",
      productName: "MorphDoc"
    });
    expect(builderConfig).toContain("appId: brand.appId");
    expect(builderConfig).toContain("productName: brand.englishName");
    expect(builderConfig).toContain("executableName: brand.executableName");
    expect(builderConfig).toContain("shortcutName: brand.displayName");
    expect(installerInclude).toContain(
      '!define MORPHDOC_EXECUTABLE "MorphDoc.exe"'
    );
    expect(installerInclude).toContain(
      '!define MORPHDOC_DISPLAY_NAME "墨呈"'
    );
    expect(installerInclude).toContain(
      '!define INSTALL_REGISTRY_KEY "Software\\${APP_GUID}.MorphDoc"'
    );
    expect(installerInclude).toContain(
      'DeleteRegKey SHCTX "${MORPHDOC_LEGACY_INSTALL_REGISTRY_KEY}"'
    );
    expect(installerInclude).toContain(
      "Software\\Classes\\Applications\\${MORPHDOC_LEGACY_EXECUTABLE}"
    );
  });

  it("在安装版与便携版中强制内置完整字体包集合", () => {
    const builderConfig = readFileSync(
      `${desktopRoot}/electron-builder.config.cjs`,
      "utf8"
    );
    const desktopMain = readFileSync(
      `${desktopRoot}/src/main.ts`,
      "utf8"
    );
    const bundledBuild = readFileSync(
      `${projectRoot}/scripts/build-desktop-release.mjs`,
      "utf8"
    );
    const installerInclude = readFileSync(
      `${desktopRoot}/build/installer.nsh`,
      "utf8"
    );

    expect(builderConfig).toContain('../../output/font-packs/root');
    expect(builderConfig).toContain('to: "font-packs"');
    expect(desktopMain).toContain(
      'path.join(process.resourcesPath, "font-packs")'
    );
    expect(desktopMain).toContain("getDesktopUserFontPackDirectory()");
    expect(bundledBuild).not.toContain("createDesktopCompanionInclude");
    expect(bundledBuild).toContain("已生成字体直接内置");
    expect(installerInclude).not.toContain("FONT_PACK_COMPANION");
    expect(installerInclude).not.toContain("FontPackCompanionPage");
    expect(installerInclude).not.toContain("/WITHFONTPACK=");
  });

  it("将 DOCX Lua Filter 复制到桌面主进程资源目录", () => {
    const buildScript = readFileSync(
      `${desktopRoot}/scripts/build-main.mjs`,
      "utf8"
    );

    expect(buildScript).toContain(
      "packages/docx-engine/assets/docx-media-filter.lua"
    );
    expect(buildScript).toContain("dist/docx-media-filter.lua");
  });

  it("为 ESM 主进程中的 CommonJS 字体转换依赖保留 __dirname", () => {
    const buildScript = readFileSync(
      `${desktopRoot}/scripts/build-main.mjs`,
      "utf8"
    );

    expect(buildScript).toContain(
      'dirname as __morphDocDirname'
    );
    expect(buildScript).toContain(
      'fileURLToPath as __morphDocFileURLToPath'
    );
    expect(buildScript).toContain(
      "const __dirname = __morphDocDirname(__morphDocFileURLToPath(import.meta.url));"
    );
  });

  it("在 Docker Web 构建前复制样例并保留到运行镜像", () => {
    const dockerfile = readFileSync(
      `${projectRoot}/deploy/Dockerfile`,
      "utf8"
    );
    const samplesBuildCopyIndex = dockerfile.indexOf(
      "COPY samples ./samples"
    );
    const webBuildIndex = dockerfile.indexOf(
      "pnpm --filter @morphdoc/web run build"
    );

    expect(samplesBuildCopyIndex).toBeGreaterThan(-1);
    expect(webBuildIndex).toBeGreaterThan(samplesBuildCopyIndex);
    expect(dockerfile).toContain(
      "COPY --chown=pwuser:pwuser --from=build /app/samples ./samples"
    );
  });
});
