import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  scripts?: Record<string, string>;
}

const projectRoot = fileURLToPath(
  new URL("../../../", import.meta.url)
);

function readProjectFile(relativePath: string) {
  return readFileSync(`${projectRoot}/${relativePath}`, "utf8");
}

describe("Docker v0.6.4 部署契约", () => {
  it("完整构建并复制 DOCX 运行时工作区和 Lua Filter", () => {
    const dockerfile = readProjectFile("deploy/Dockerfile");
    const workspaces = [
      "semantic-document",
      "docx-theme-engine",
      "font-pack-registry",
      "docx-engine"
    ];

    for (const workspace of workspaces) {
      expect(dockerfile).toContain(
        `COPY packages/${workspace}/package.json packages/${workspace}/package.json`
      );
      expect(dockerfile).toContain(
        `pnpm --filter @morphdoc/${workspace} run build`
      );
      expect(dockerfile).toContain(
        `/app/packages/${workspace}/dist ./packages/${workspace}/dist`
      );
    }
    expect(dockerfile).toContain(
      "/app/packages/docx-engine/assets ./packages/docx-engine/assets"
    );
    expect(dockerfile).toContain("COPY tsconfig.base.json product.json ./");
  });

  it("固定校验 Pandoc 二进制、许可证、版权和最终版本", () => {
    const dockerfile = readProjectFile("deploy/Dockerfile");

    expect(dockerfile).toContain("ARG PANDOC_VERSION=3.9.0.2");
    expect(dockerfile).toContain(
      "A69ABFABABDA8A56969A254B09F9553A7BE89DDEC00D4E0FE9FD585D71A67508"
    );
    expect(dockerfile).toContain(
      "9D56CAC92294E206AF026A5502BEE0FED77200B08B51EC28AA63C9EFDA4DCFDD"
    );
    expect(dockerfile).toContain(
      "842E33EF01625E93F85BEBB8BAC83AA570186B7AA77A09971257CC29F8F60740"
    );
    expect(dockerfile).toContain(
      "COPY --from=pandoc-runtime /opt/pandoc/3.9.0.2 /opt/pandoc/3.9.0.2"
    );
    expect(dockerfile).toContain(
      "ln -sfn /opt/pandoc/3.9.0.2/bin/pandoc /usr/local/bin/pandoc"
    );
    expect(dockerfile).toContain(
      'test "$(pandoc --version | head -n 1)" = "pandoc 3.9.0.2"'
    );
  });

  it("将受校验字体包内置到镜像并取消运行时字体挂载", () => {
    const dockerfile = readProjectFile("deploy/Dockerfile");
    const compose = readProjectFile("deploy/compose.yaml");
    const dockerignore = readProjectFile(".dockerignore");
    const dockerfileIgnore = readProjectFile(
      "deploy/Dockerfile.dockerignore"
    );

    expect(compose).toContain(
      "FONT_PACK_ROOT: /app/.local/font-packs"
    );
    expect(compose).not.toContain("MORPHDOC_FONT_PACK_DIR");
    expect(dockerfile).toContain(
      "COPY --chown=pwuser:pwuser output/font-packs/root /app/.local/font-packs"
    );
    expect(dockerfile).toContain("FONT_PACK_ROOT=/app/.local/font-packs");
    expect(compose).toContain(
      'APP_VERSION: "${MORPHDOC_APP_VERSION:-0.6.4}"'
    );
    expect(dockerignore.split(/\r?\n/u)).toContain(".local");
    expect(dockerignore).toContain("!output/font-packs/root/**");
    expect(dockerfileIgnore).toBe(dockerignore);
  });

  it("提供显式真实 Docker 字体包验收命令", () => {
    const manifest = JSON.parse(
      readProjectFile("package.json")
    ) as PackageManifest;

    expect(manifest.scripts?.["verify:docker-font-pack"]).toContain(
      "deploy/verify-font-pack-compose.mjs"
    );
  });
});
