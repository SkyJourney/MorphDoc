import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  APP_VERSION,
  APP_VERSION_LABEL
} from "../src/app-version";

const webRoot = fileURLToPath(new URL("../", import.meta.url));

describe("应用版本", () => {
  it("从统一构建版本生成标题徽标", () => {
    expect(APP_VERSION).toBe("0.6.4");
    expect(APP_VERSION_LABEL).toBe("v0.6.4");
  });

  it("允许浏览器加载同源 Web Manifest", () => {
    const indexHtml = readFileSync(`${webRoot}/index.html`, "utf8");

    expect(indexHtml).toContain('rel="manifest"');
    expect(indexHtml).toContain("manifest-src 'self'");
  });
});
