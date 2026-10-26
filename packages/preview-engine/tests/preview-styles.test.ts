import { describe, expect, it } from "vitest";
import { enablePrintMediaForPreview } from "../src/preview-styles.js";

describe("打印媒体预览", () => {
  it("将打印媒体规则转换为屏幕预览规则", () => {
    const css = `
html { font-size: 16px; }
@media print {
  html { font-size: 13px; }
}
`;

    expect(enablePrintMediaForPreview(css)).toContain("@media screen {");
    expect(enablePrintMediaForPreview(css)).toContain(
      "html { font-size: 13px; }"
    );
  });

  it("支持 only print 和带条件的打印媒体规则", () => {
    const css = [
      "@media only print { body { color: black; } }",
      "@media print and (color) { body { background: white; } }"
    ].join("\n");

    expect(enablePrintMediaForPreview(css)).toBe(
      [
        "@media only screen { body { color: black; } }",
        "@media screen and (color) { body { background: white; } }"
      ].join("\n")
    );
  });

  it("不改变普通屏幕媒体规则", () => {
    const css = "@media screen and (min-width: 800px) { body { margin: 0; } }";
    expect(enablePrintMediaForPreview(css)).toBe(css);
  });
});
