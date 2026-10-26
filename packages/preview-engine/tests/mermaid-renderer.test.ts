import { describe, expect, it, vi } from "vitest";
import { renderMermaidDefinitions } from "../src/mermaid-renderer.js";

describe("Mermaid 独立图表渲染", () => {
  it("单个图表失败后继续渲染后续图表", async () => {
    const renderDefinition = vi
      .fn()
      .mockRejectedValueOnce(new Error("语法错误"))
      .mockResolvedValueOnce({ svg: "<svg>第二张图</svg>" });

    const outcomes = await renderMermaidDefinitions(
      ["invalid", "flowchart LR\nA --> B"],
      renderDefinition
    );

    expect(renderDefinition).toHaveBeenCalledTimes(2);
    expect(outcomes[0]).toMatchObject({
      success: false,
      error: expect.any(Error)
    });
    expect(outcomes[1]).toEqual({
      success: true,
      svg: "<svg>第二张图</svg>"
    });
  });
});
