import { describe, expect, it } from "vitest";
import {
  createSvgDataUrl,
  getLockedMermaidBoxSize,
  getMermaidImageAlt,
  resolveMermaidOutputMode
} from "../src/mermaid-static-image.js";

describe("Mermaid 静态 SVG 图片", () => {
  it("生成无需外部请求的 UTF-8 Data URL", () => {
    const url = createSvgDataUrl(
      '<svg xmlns="http://www.w3.org/2000/svg"><text>中文 &amp; A</text></svg>'
    );

    expect(url).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(decodeURIComponent(url.split(",")[1] ?? "")).toContain(
      "<text>中文 &amp; A</text>"
    );
  });

  it("保留渲染后的精确小数尺寸", () => {
    expect(
      getLockedMermaidBoxSize({
        width: 742.375,
        height: 386.625
      })
    ).toEqual({
      width: 742.375,
      height: 386.625
    });
    expect(
      getLockedMermaidBoxSize({
        width: 0,
        height: 386.625
      })
    ).toBeUndefined();
  });

  it("优先使用无障碍标签并回退到 SVG 标题", () => {
    expect(getMermaidImageAlt(" 数据链路 ", "备用标题")).toBe(
      "数据链路"
    );
    expect(getMermaidImageAlt(null, " 数据关系图 ")).toBe(
      "数据关系图"
    );
    expect(getMermaidImageAlt(" ", null)).toBe("Mermaid 图表");
  });

  it("默认使用静态 SVG 并允许内部切回内联模式", () => {
    expect(resolveMermaidOutputMode("")).toBe("svg-image");
    expect(resolveMermaidOutputMode("?target=pdf")).toBe("svg-image");
    expect(
      resolveMermaidOutputMode(
        "?target=pdf&mermaid-output=inline-svg"
      )
    ).toBe("inline-svg");
    expect(
      resolveMermaidOutputMode("?mermaid-output=unknown")
    ).toBe("svg-image");
  });
});
