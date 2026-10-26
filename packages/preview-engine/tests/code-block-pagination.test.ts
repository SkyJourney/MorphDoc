// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { prepareCodeBlockPagination } from "../src/code-block-pagination.js";

function createRoot(codeHtml: string) {
  const root = document.createElement("article");
  root.innerHTML = `<pre class="md-fences"><code>${codeHtml}</code></pre>`;
  return root;
}

function getGroups(root: ParentNode) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(".md-code-line-group")
  );
}

function getLines(root: ParentNode) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(".md-code-line")
  );
}

function getChunks(root: ParentNode) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(".md-code-pagination-chunk")
  );
}

describe("代码块分页预处理", () => {
  it("偶数行按两行分组", () => {
    const root = createRoot("line-1\nline-2\nline-3\nline-4\n");

    prepareCodeBlockPagination(root);

    expect(getGroups(root).map((group) => group.children.length)).toEqual([
      2,
      2
    ]);
    expect(getLines(root).map((line) => line.textContent)).toEqual([
      "line-1",
      "line-2",
      "line-3",
      "line-4"
    ]);
    expect(
      getChunks(root).map((chunk) =>
        chunk.getAttribute("data-code-pagination-position")
      )
    ).toEqual(["first", "last"]);
  });

  it("奇数行将最后三行合组并保留单行代码块", () => {
    const oddRoot = createRoot(
      "line-1\nline-2\nline-3\nline-4\nline-5\n"
    );
    const singleRoot = createRoot("only-line\n");

    prepareCodeBlockPagination(oddRoot);
    prepareCodeBlockPagination(singleRoot);

    expect(
      getGroups(oddRoot).map((group) => group.children.length)
    ).toEqual([2, 3]);
    expect(
      getGroups(singleRoot).map((group) => group.children.length)
    ).toEqual([1]);
    expect(
      getChunks(singleRoot)[0]?.getAttribute(
        "data-code-pagination-position"
      )
    ).toBe("only");
  });

  it("跨行克隆语法高亮结构并保留空行", () => {
    const root = createRoot(
      '<span class="hljs-string">first\nsecond</span>\n\n' +
        '<span class="hljs-keyword">return</span> value;\n'
    );

    prepareCodeBlockPagination(root);

    const lines = getLines(root);
    expect(lines.map((line) => line.textContent)).toEqual([
      "first",
      "second",
      "",
      "return value;"
    ]);
    expect(
      lines[0]?.querySelector(".hljs-string")?.textContent
    ).toBe("first");
    expect(
      lines[1]?.querySelector(".hljs-string")?.textContent
    ).toBe("second");
    expect(
      lines[3]?.querySelector(".hljs-keyword")?.textContent
    ).toBe("return");
  });

  it("将高亮代码行首缩进封装为分页稳定节点", () => {
    const root = createRoot(
      '<span class="hljs-punctuation">{</span>\n  ' +
        '<span class="hljs-attr">"nested"</span>: true\n' +
        '<span class="hljs-punctuation">}</span>\n'
    );

    prepareCodeBlockPagination(root);

    const lines = getLines(root);
    const indent = lines[1]?.querySelector(
      ":scope > .md-code-line-indent"
    );
    expect(lines.map((line) => line.textContent)).toEqual([
      "{",
      '  "nested": true',
      "}"
    ]);
    expect(indent?.textContent).toBe("  ");
    expect((indent as HTMLElement | null)?.style.width).toBe("2ch");
    expect((indent as HTMLElement | null)?.dataset.codeIndentColumns)
      .toBe("2");
    expect(indent?.nextElementSibling?.classList.contains("hljs-attr"))
      .toBe(true);
  });

  it("重复调用不会再次包装已经准备的代码块", () => {
    const root = createRoot("line-1\nline-2\n");

    prepareCodeBlockPagination(root);
    const firstHtml = root.innerHTML;
    prepareCodeBlockPagination(root);

    expect(root.innerHTML).toBe(firstHtml);
    expect(root.querySelector("pre.md-fences")).toBeNull();
    const paginationChunks = getChunks(root);
    expect(paginationChunks).toHaveLength(1);
    expect(
      paginationChunks[0]?.classList.contains("md-fences")
    ).toBe(true);
    expect(
      paginationChunks[0]?.getAttribute(
        "data-code-pagination-prepared"
      )
    ).toBe("true");
  });

  it("复制代码元素属性并把每个双行组拆成同级分页片段", () => {
    const root = document.createElement("article");
    root.innerHTML =
      '<pre class="md-fences custom" data-source="demo">' +
      '<code class="hljs language-js" data-language="js">' +
      "line-1\nline-2\nline-3\nline-4\n" +
      "</code></pre>";

    prepareCodeBlockPagination(root);

    const chunks = getChunks(root);
    expect(chunks).toHaveLength(2);
    expect(Array.from(root.children)).toEqual(chunks);
    expect(chunks[0]?.classList.contains("custom")).toBe(true);
    expect(chunks[1]?.getAttribute("data-source")).toBe("demo");
    expect(
      chunks[1]?.querySelector("code")?.getAttribute("data-language")
    ).toBe("js");
  });
});
