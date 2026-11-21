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

describe("Docker 部署契约", () => {
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
    // 版本号不再写死默认值：留空时服务读取镜像内的 package.json
    expect(compose).toContain('APP_VERSION: "${MORPHDOC_APP_VERSION:-}"');
    expect(compose).not.toMatch(/MORPHDOC_APP_VERSION:-\d/u);
    expect(dockerignore.split(/\r?\n/u)).toContain(".local");
    expect(dockerignore).toContain("!output/font-packs/root/**");
    expect(dockerfileIgnore).toBe(dockerignore);
  });

  it("提供镜像冒烟验收命令，并把其单元测试纳入 pnpm test", () => {
    const manifest = JSON.parse(
      readProjectFile("package.json")
    ) as PackageManifest;

    expect(manifest.scripts?.["verify:docker-smoke"]).toContain(
      "deploy/smoke-image.mjs"
    );
    expect(manifest.scripts?.["test:deploy-tools"]).toContain(
      "deploy/smoke-image.test.mjs"
    );
    expect(manifest.scripts?.["test"]).toContain(
      "pnpm run test:deploy-tools"
    );
  });

  it("提供显式真实 Docker 字体包验收命令", () => {
    const manifest = JSON.parse(
      readProjectFile("package.json")
    ) as PackageManifest;

    expect(manifest.scripts?.["verify:docker-font-pack"]).toContain(
      "deploy/verify-font-pack-compose.mjs"
    );
  });

  it("运行层带有根 package.json，服务据此确定应用版本", () => {
    // 服务在 APP_VERSION 为空时读取 <应用根>/package.json（相对 apps/server/dist 为
    // ../../../package.json）。Dockerfile 若不再把它复制进运行层，容器会在启动时报错退出，
    // 而 CI 并不运行镜像，只能靠这条静态契约守住
    const dockerfile = readProjectFile("deploy/Dockerfile");
    const runtime = dockerfile.slice(dockerfile.indexOf("AS runtime"));

    expect(runtime).toContain("WORKDIR /app");
    expect(runtime).toContain("COPY --chown=pwuser:pwuser package.json ./");
    expect(runtime).toContain(
      "COPY --chown=pwuser:pwuser --from=build /app/apps/server/dist ./apps/server/dist"
    );
    // 入口脚本按该布局启动服务
    expect(readProjectFile("deploy/entrypoint.sh")).toContain(
      "node /app/apps/server/dist/index.js"
    );
  });
});

describe("Node 版本锁定", () => {
  // .nvmrc 是唯一来源；CI、容器基础镜像、compose 默认值与文档必须与它一致。
  // 任何一处单独改动都会让这里失败，而不是在发布后才发现镜像与 CI 用了不同的 Node。
  const nodeVersion = readProjectFile(".nvmrc").trim();

  it(".nvmrc 是精确的 semver 版本，不是浮动的大版本", () => {
    expect(nodeVersion).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it("Dockerfile 的基础镜像引用精确版本，三个阶段共用同一个 ARG", () => {
    const dockerfile = readProjectFile("deploy/Dockerfile");

    expect(dockerfile).toContain(
      `ARG NODE_BASE_IMAGE=node:${nodeVersion}-bookworm-slim`
    );
    expect(dockerfile).toContain(
      `ARG RUNTIME_BASE_IMAGE=node:${nodeVersion}-bookworm-slim`
    );
    expect(dockerfile.match(/^FROM \$\{NODE_BASE_IMAGE\} AS /gmu)).toHaveLength(3);
    expect(dockerfile).not.toMatch(/^FROM node:/mu);
  });

  it("compose 的默认运行时镜像与 .nvmrc 一致", () => {
    const compose = readProjectFile("deploy/compose.yaml");

    expect(compose).toContain(
      `\${MORPHDOC_RUNTIME_BASE_IMAGE:-node:${nodeVersion}-bookworm-slim}`
    );
  });

  it("CI 复合 action 从 .nvmrc 读取 Node 版本，而不是另写一份", () => {
    const action = readProjectFile(".github/actions/setup/action.yml");

    expect(action).toContain("node-version-file: '.nvmrc'");
    expect(action).not.toMatch(/node-version: '\d/u);
  });

  it("仓库中不再残留浮动的 Node 大版本镜像引用", () => {
    for (const path of [
      "deploy/Dockerfile",
      "deploy/compose.yaml",
      "deploy/README.md",
      "docs/PANDOC_DISTRIBUTION.md"
    ]) {
      expect(readProjectFile(path), path).not.toMatch(/node:2[0-9]-bookworm/u);
    }
  });
});

describe("发布工作流契约", () => {
  it("在归集镜像之前，对构建出的同一个镜像执行冒烟验收", () => {
    // 只构建成功不足以证明镜像可用，因此冒烟必须排在归集之前；验收的镜像引用也必须与构建相同，
    // 否则归集的可能是另一份未经验收的镜像
    const workflow = readProjectFile(".github/workflows/release.yml");
    const buildIndex = workflow.indexOf("run: docker compose -f deploy/compose.yaml build");
    const smokeIndex = workflow.indexOf("run: pnpm run verify:docker-smoke");
    const stageIndex = workflow.indexOf("run: node scripts/stage-release.mjs");

    expect(buildIndex).toBeGreaterThan(-1);
    expect(smokeIndex).toBeGreaterThan(buildIndex);
    expect(stageIndex).toBeGreaterThan(smokeIndex);
    const smokeStepStart = workflow.lastIndexOf("- name:", smokeIndex);
    expect(workflow.slice(smokeStepStart, smokeIndex)).toContain(
      "MORPHDOC_IMAGE: morphdoc:v${{ needs.prepare.outputs.version }}"
    );
  });

  it("Prepare 用同一份门禁校验标签发布，演练只给警告，不再手写平行规则", () => {
    // 门禁只有 scripts/version.mjs 一份实现：标签发布失败即中止，演练只给出警告。
    // 手写的标签比较与说明文件检查已移除，避免两处规则逐渐漂移
    const workflow = readProjectFile(".github/workflows/release.yml");
    const prepare = workflow.slice(
      workflow.indexOf("  prepare:"),
      workflow.indexOf("  build-windows:")
    );

    expect(prepare).toContain(
      'if ! node scripts/version.mjs check --tag "$REF_NAME" --release; then'
    );
    expect(prepare).toContain("if ! node scripts/version.mjs check --release; then");
    expect(prepare).toContain("::warning::");
    expect(prepare).not.toContain('if [ "$REF_NAME" != "v${version}" ]');
    expect(prepare).not.toContain('if [ ! -s "docs/releases/v${version}.md" ]');
  });

  it("Prepare 用 .nvmrc 指定的 Node 运行门禁，而不是依赖 runner 预装版本", () => {
    const workflow = readProjectFile(".github/workflows/release.yml");
    const prepare = workflow.slice(
      workflow.indexOf("  prepare:"),
      workflow.indexOf("  build-windows:")
    );

    expect(prepare).toContain("uses: actions/setup-node@v7");
    expect(prepare).toContain("node-version-file: '.nvmrc'");
  });
});
