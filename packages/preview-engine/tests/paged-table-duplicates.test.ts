// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { duplicatedPagedTableRowIds } from "../src/paged-table-handler.js";

function row(id: string, keepWhole: boolean, text = id) {
  return (
    `<tr data-morphdoc-table-row-id="${id}" ` +
    `data-morphdoc-table-row-keep-whole="${keepWhole}"><td>${text}</td></tr>`
  );
}

function createRendered(...pages: string[][]) {
  const root = document.createElement("div");
  root.innerHTML = pages
    .map(
      (rows) =>
        `<section><table><tbody>${rows.join("")}</tbody></table></section>`
    )
    .join("");
  return root;
}

describe("分页后表格行重复检测", () => {
  it("每行只出现一次时没有重复", () => {
    const rendered = createRendered(
      [row("t1-r1", true), row("t1-r2", true)],
      [row("t1-r3", true)]
    );

    expect(duplicatedPagedTableRowIds(rendered)).toEqual([]);
  });

  it("整行保持不拆的行出现在两页时判定为重复", () => {
    // 复现：断点越过整张表格后重新开始，行 1 被排了两遍
    const rendered = createRendered(
      [row("t1-r1", true), row("t1-r2", true)],
      [row("t1-r1", true), row("t1-r2", true), row("t1-r3", true)]
    );

    expect(duplicatedPagedTableRowIds(rendered)).toEqual([
      "t1-r1",
      "t1-r2"
    ]);
  });

  it("超过一页高度的行允许被切成多段，不算重复", () => {
    const rendered = createRendered(
      [row("t1-r1", false)],
      [row("t1-r1", false)]
    );

    expect(duplicatedPagedTableRowIds(rendered)).toEqual([]);
  });

  it("整行被切成两段时文字不同，不算重复", () => {
    // 单元格很高时 Paged.js 会把一行切成两段：版面瑕疵，但输出不会多出内容
    const rendered = createRendered(
      [row("t1-r1", true, "A688652.SH 京仪装备 温控/半导体设备")],
      [row("t1-r1", true, "备(23%)")]
    );

    expect(duplicatedPagedTableRowIds(rendered)).toEqual([]);
  });

  it("没有行标识的表格行被忽略", () => {
    const root = document.createElement("div");
    root.innerHTML =
      "<table><tbody><tr><td>甲</td></tr><tr><td>甲</td></tr></tbody></table>";

    expect(duplicatedPagedTableRowIds(root)).toEqual([]);
  });
});
