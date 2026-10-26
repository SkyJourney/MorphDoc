import { describe, expect, it } from "vitest";
import { resolvePagedRenderTarget } from "../src/paged-render-target.js";

describe("分页文档渲染目标", () => {
  it("默认使用网页预览目标", () => {
    expect(resolvePagedRenderTarget("")).toBe("preview");
    expect(resolvePagedRenderTarget("?target=unknown")).toBe("preview");
  });

  it("识别 PDF 渲染目标", () => {
    expect(resolvePagedRenderTarget("?target=pdf")).toBe("pdf");
    expect(resolvePagedRenderTarget("?foo=1&target=pdf")).toBe("pdf");
  });
});
