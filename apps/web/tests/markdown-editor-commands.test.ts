import { describe, expect, it } from "vitest";
import {
  createMarkdownTable,
  setMarkdownHeading,
  toggleMarkdownLinePrefix,
  wrapMarkdownSelection
} from "../src/markdown-editor-commands";

describe("Markdown 编辑器命令", () => {
  it("包装、取消包装文本并保持内容选区", () => {
    expect(wrapMarkdownSelection("正文", "**")).toEqual({
      insert: "**正文**",
      selectionFrom: 2,
      selectionTo: 4
    });
    expect(wrapMarkdownSelection("**正文**", "**")).toEqual({
      insert: "正文",
      selectionFrom: 0,
      selectionTo: 2
    });
    expect(
      wrapMarkdownSelection("", "`", "`", "code")
    ).toEqual({
      insert: "`code`",
      selectionFrom: 1,
      selectionTo: 5
    });
  });

  it("切换引用和无序列表前缀", () => {
    expect(toggleMarkdownLinePrefix("甲\n乙", "quote")).toBe(
      "> 甲\n> 乙"
    );
    expect(
      toggleMarkdownLinePrefix("> 甲\n> 乙", "quote")
    ).toBe("甲\n乙");
    expect(
      toggleMarkdownLinePrefix("1. 甲\n2. 乙", "unordered-list")
    ).toBe("- 甲\n- 乙");
  });

  it("为选中的多行生成连续有序列表并保留空行", () => {
    expect(
      toggleMarkdownLinePrefix(
        "第一项\n\n第二项\n第三项",
        "ordered-list"
      )
    ).toBe("1. 第一项\n\n2. 第二项\n3. 第三项");
  });

  it("为选中的多行生成无序列表和任务列表", () => {
    expect(
      toggleMarkdownLinePrefix(
        "第一项\n第二项\n第三项",
        "unordered-list"
      )
    ).toBe("- 第一项\n- 第二项\n- 第三项");
    expect(
      toggleMarkdownLinePrefix(
        "第一项\n第二项\n第三项",
        "task-list"
      )
    ).toBe("- [ ] 第一项\n- [ ] 第二项\n- [ ] 第三项");
  });

  it("设置标题时替换现有标题级别", () => {
    expect(setMarkdownHeading("## 标题\n正文", 3)).toBe(
      "### 标题\n### 正文"
    );
    expect(setMarkdownHeading("### 标题", 1)).toBe("# 标题");
  });

  it("生成指定列数和总行数的 Markdown 表格", () => {
    expect(createMarkdownTable(3, 4)).toEqual({
      insert:
        "| 列 1 | 列 2 | 列 3 |\n" +
        "| --- | --- | --- |\n" +
        "| 内容 | 内容 | 内容 |\n" +
        "| 内容 | 内容 | 内容 |\n" +
        "| 内容 | 内容 | 内容 |",
      selectionFrom: 2,
      selectionTo: 5
    });
    expect(() => createMarkdownTable(0, 2)).toThrow(RangeError);
    expect(() => createMarkdownTable(3, 11)).toThrow(RangeError);
  });
});
