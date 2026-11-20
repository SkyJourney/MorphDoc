import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  APP_VERSION,
  APP_VERSION_LABEL
} from "../src/app-version";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const rootVersion = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8")
  ) as { version: string }
).version;

describe("应用版本", () => {
  it("从统一构建版本生成标题徽标", () => {
    // 版本号只在根 package.json 中维护，Vite 构建期注入；这里验证注入值与它一致，而不是
    // 写死某个具体版本（写死的断言每次发版都得跟着改）
    expect(APP_VERSION).toBe(rootVersion);
    expect(APP_VERSION_LABEL).toBe(`v${rootVersion}`);
  });

  it("允许浏览器加载同源 Web Manifest", () => {
    const indexHtml = readFileSync(`${webRoot}/index.html`, "utf8");

    expect(indexHtml).toContain('rel="manifest"');
    expect(indexHtml).toContain("manifest-src 'self'");
  });
});
