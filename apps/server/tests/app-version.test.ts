import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveAppVersion } from "../src/app-version.js";

const rootManifest = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8")
) as { version: string };

function manifestFile(content: string): URL {
  const directory = mkdtempSync(join(tmpdir(), "morphdoc-app-version-"));
  const path = join(directory, "package.json");
  writeFileSync(path, content, "utf8");
  return pathToFileURL(path);
}

describe("resolveAppVersion", () => {
  it("没有覆盖值时读取仓库根 package.json，而不是写死的回退值", () => {
    expect(resolveAppVersion({})).toBe(rootManifest.version);
  });

  it("环境变量 APP_VERSION 优先，并去除首尾空白", () => {
    expect(resolveAppVersion({ APP_VERSION: "9.9.9" })).toBe("9.9.9");
    expect(resolveAppVersion({ APP_VERSION: "  1.2.3  " })).toBe("1.2.3");
  });

  it("空字符串与纯空白视为未设置", () => {
    // compose 在 MORPHDOC_APP_VERSION 未配置时会传入空字符串
    expect(resolveAppVersion({ APP_VERSION: "" })).toBe(rootManifest.version);
    expect(resolveAppVersion({ APP_VERSION: "   " })).toBe(rootManifest.version);
  });

  it("读取指定 package.json 的 version", () => {
    expect(resolveAppVersion({}, manifestFile('{ "version": "3.4.5" }'))).toBe("3.4.5");
  });

  it.each([
    ["缺少 version", "{}"],
    ["version 为空串", '{ "version": "" }'],
    ["version 为纯空白", '{ "version": "   " }'],
    ["version 不是字符串", '{ "version": 1 }']
  ])("package.json %s 时抛出明确错误", (_name, content) => {
    expect(() => resolveAppVersion({}, manifestFile(content))).toThrow(/缺少有效的 version/u);
  });

  it("package.json 不存在时抛出读取错误而不是回退到写死的值", () => {
    expect(() =>
      resolveAppVersion({}, pathToFileURL(join(tmpdir(), "morphdoc-no-such-dir", "package.json")))
    ).toThrow();
  });
});
