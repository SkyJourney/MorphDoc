import { describe, expect, it } from "vitest";
import {
  createMarkdownFileName,
  deriveMarkdownBaseName,
  ensureMarkdownFileName,
  legalizeMarkdownBaseName
} from "../src/document-file";

describe("Markdown 默认文件名", () => {
  it("优先使用 Front Matter 与代码围栏之外的一级标题", () => {
    expect(
      deriveMarkdownBaseName(`---
title: 元数据标题
---
第一行正文

\`\`\`markdown
# 围栏标题
\`\`\`

# 2026 年研发周报：第 31 周`)
    ).toBe("2026 年研发周报 第 31 周");
  });

  it("没有一级标题时使用第一行非空正文", () => {
    expect(
      createMarkdownFileName(
        "\n\n> **本周完成** [API 重构](https://example.com)\n后续内容"
      )
    ).toBe("本周完成 API 重构.md");
  });

  it("四字符围栏不会被较短的同类围栏提前关闭", () => {
    expect(
      deriveMarkdownBaseName(`\`\`\`\`markdown
# 围栏内标题
\`\`\`
# 仍在围栏内
\`\`\`\`
# 正文标题`)
    ).toBe("正文标题");
  });

  it("清理非法字符并规避 Windows 保留名称", () => {
    expect(legalizeMarkdownBaseName('季度总结：<测试> / "版本"')).toBe(
      "季度总结 测试 版本"
    );
    expect(legalizeMarkdownBaseName("CON")).toBe("文档 CON");
  });

  it("空文档使用回退文件名并限制名称长度", () => {
    expect(createMarkdownFileName(" \n")).toBe("未命名文档.md");
    expect(legalizeMarkdownBaseName("文".repeat(150))).toHaveLength(100);
  });

  it("保留已有 Markdown 扩展名", () => {
    expect(ensureMarkdownFileName("报告.markdown", "# 报告")).toBe(
      "报告.markdown"
    );
    expect(ensureMarkdownFileName("报告", "# 报告")).toBe("报告.md");
  });
});
