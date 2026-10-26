import { describe, expect, it } from "vitest";
import {
  compareSemanticVersions,
  fontPackManifestSchema,
  isAppVersionCompatible,
  semanticVersionSchema
} from "../src/index.js";

describe("字体包协议", () => {
  it("按 SemVer 规则比较版本并处理预发布版本", () => {
    expect(compareSemanticVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBeLessThan(0);
    expect(compareSemanticVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
    expect(semanticVersionSchema.safeParse("1.0.0-01").success).toBe(false);
  });

  it("使用包含下限、不包含上限的应用兼容区间", () => {
    const compatibility = {
      minimumAppVersion: "0.6.0",
      maximumAppVersionExclusive: "0.7.0"
    };
    expect(isAppVersionCompatible("0.6.0", compatibility)).toBe(true);
    expect(isAppVersionCompatible("0.6.9", compatibility)).toBe(true);
    expect(isAppVersionCompatible("0.7.0", compatibility)).toBe(false);
  });

  it("拒绝越界资源路径和倒置的兼容区间", () => {
    const parsed = fontPackManifestSchema.safeParse({
      manifestVersion: 1,
      id: "official-cjk",
      version: "1.0.0",
      name: "测试",
      description: "",
      license: "OFL-1.1",
      licenseFile: "../OFL.txt",
      licenseSha256: "a".repeat(64),
      licenseBytes: 10,
      compatibility: {
        minimumAppVersion: "0.7.0",
        maximumAppVersionExclusive: "0.6.0"
      },
      faces: []
    });
    expect(parsed.success).toBe(false);
  });
});
