import { describe, expect, it } from "vitest";
import { defaultExportConfig } from "@morphdoc/core";
import {
  createMermaidSiteConfig,
  MERMAID_SECURE_CONFIG_KEYS
} from "../src/mermaid-config.js";

describe("Mermaid 站点配置", () => {
  it("默认使用 default 主题和 classic 外观", () => {
    const config = createMermaidSiteConfig(defaultExportConfig.mermaid);
    expect(config.theme).toBe("default");
    expect(config.look).toBe("classic");
    expect(config.securityLevel).toBe("strict");
    expect(config.startOnLoad).toBe(false);
    expect(config.flowchart?.wrappingWidth).toBe(320);
  });

  it("锁定安全限制和原始主题 CSS", () => {
    expect(MERMAID_SECURE_CONFIG_KEYS).toEqual(
      expect.arrayContaining([
        "secure",
        "securityLevel",
        "startOnLoad",
        "maxTextSize",
        "maxEdges",
        "suppressErrorRendering",
        "themeCSS"
      ])
    );
  });

  it("每次创建独立的 secure 配置数组", () => {
    const first = createMermaidSiteConfig(defaultExportConfig.mermaid);
    const second = createMermaidSiteConfig(defaultExportConfig.mermaid);
    expect(first.secure).toEqual(second.secure);
    expect(first.secure).not.toBe(second.secure);
  });

  it("应用导出配置中的布局、主题、外观和字体", () => {
    const config = createMermaidSiteConfig({
      layout: "elk",
      theme: "forest",
      look: "handDrawn",
      fontFamily: "Microsoft YaHei, sans-serif"
    });

    expect(config).toMatchObject({
      layout: "elk",
      theme: "forest",
      look: "handDrawn",
      fontFamily: "Microsoft YaHei, sans-serif"
    });
  });
});
