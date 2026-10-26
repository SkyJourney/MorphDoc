// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  assignPagedSourceReferences,
  createIncrementalPaginationPlan,
  findSourceNodePageIndex
} from "../src/incremental-pagination.js";

function createSourceNode(reference: string) {
  const node = document.createElement("section");
  node.dataset.ref = reference;
  return node;
}

function createPage(
  references: string[],
  startReference?: string
) {
  const element = document.createElement("article");
  for (const reference of references) {
    element.append(createSourceNode(reference));
  }
  return {
    element,
    startToken: startReference
      ? {
          node: createSourceNode(startReference),
          offset: 0
        }
      : undefined
  };
}

describe("快速预览增量分页计划", () => {
  it("从变化块所在页的前一页开始续排", () => {
    const sourceNodes = [
      createSourceNode("a"),
      createSourceNode("b"),
      createSourceNode("c"),
      createSourceNode("d")
    ];
    const pages = [
      createPage(["a"]),
      createPage(["b"], "b"),
      createPage(["c"], "c"),
      createPage(["d"], "d")
    ];

    expect(
      createIncrementalPaginationPlan(
        2,
        sourceNodes.length,
        sourceNodes,
        pages
      )
    ).toEqual({
      prefixLength: 2,
      invalidationPageIndex: 1,
      startToken: pages[1]?.startToken
    });
  });

  it("尾部新增时以旧文档最后一个块定位并回退一页", () => {
    const sourceNodes = [
      createSourceNode("a"),
      createSourceNode("b")
    ];
    const pages = [
      createPage(["a"]),
      createPage(["b"], "b")
    ];

    expect(
      createIncrementalPaginationPlan(
        2,
        sourceNodes.length,
        sourceNodes,
        pages
      )?.invalidationPageIndex
    ).toBe(0);
  });

  it("无法验证边界时拒绝使用旧分页缓存", () => {
    const sourceNodes = [createSourceNode("a")];
    const pages = [createPage(["other"])];

    expect(
      createIncrementalPaginationPlan(
        1,
        sourceNodes.length,
        sourceNodes,
        pages
      )
    ).toBeUndefined();
    expect(
      createIncrementalPaginationPlan(
        0,
        sourceNodes.length,
        sourceNodes,
        pages
      )
    ).toBeUndefined();
  });

  it("通过 data-ref 在分页结果中反查源节点页码", () => {
    const pages = [
      createPage(["a"]),
      createPage(["b", "c"])
    ];
    expect(
      findSourceNodePageIndex(pages, createSourceNode("c"))
    ).toBe(1);
  });

  it("只为新节点补充分页引用并保留既有引用", () => {
    const root = document.createElement("article");
    root.dataset.ref = "existing-root";
    root.id = "write";
    const child = document.createElement("p");
    child.id = "paragraph";
    root.append(child);
    let sequence = 0;

    assignPagedSourceReferences(root, () => {
      sequence += 1;
      return `generated-${sequence}`;
    });

    expect(root.dataset.ref).toBe("existing-root");
    expect(root.dataset.id).toBe("write");
    expect(child.dataset.ref).toBe("generated-1");
    expect(child.dataset.id).toBe("paragraph");
  });
});
