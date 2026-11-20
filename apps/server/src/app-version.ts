import { readFileSync } from "node:fs";

/**
 * 仓库根 package.json 相对本文件的位置。
 *
 * 源码（apps/server/src）与编译产物（apps/server/dist）位于同一深度，Docker 运行层里
 * 对应 /app/apps/server/dist/app-version.js 与 /app/package.json，三种场景路径一致，
 * 且只取决于本文件位置，不依赖进程的工作目录。
 */
const rootManifestUrl = new URL("../../../package.json", import.meta.url);

/**
 * 解析应用版本。
 *
 * 优先使用环境变量 APP_VERSION（部署时可选的显式覆盖）；未设置或为空白时，读取仓库根
 * package.json 的 version。版本号只在 package.json 中维护一份，这里不再保留写死的回退值：
 * 写死的回退值每次发版都会悄悄过期，却不会引发任何报错。
 *
 * @param env 环境变量，默认取 process.env，测试时可注入
 * @param manifestUrl package.json 位置，默认指向仓库根，测试时可注入
 * @returns 应用版本号
 * @throws 当没有覆盖值且 package.json 无法读取或缺少有效的 version 时抛出
 */
export function resolveAppVersion(
  env: NodeJS.ProcessEnv = process.env,
  manifestUrl: URL = rootManifestUrl
): string {
  const override = env.APP_VERSION?.trim();
  if (override) {
    return override;
  }

  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as {
    version?: unknown;
  };
  if (typeof manifest.version !== "string" || manifest.version.trim() === "") {
    throw new Error(`无法确定应用版本：${manifestUrl.pathname} 缺少有效的 version`);
  }
  return manifest.version;
}
