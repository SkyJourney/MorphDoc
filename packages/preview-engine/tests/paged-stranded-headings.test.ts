// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { hasForcedBreak } from "../src/paged-break-control.js";
import {
  HEADING_IDENTITY_ATTRIBUTE,
  STRANDED_HEADING_INVARIANT_ID,
  createStrandedHeadingInvariant,
  forceStrandedHeadingsToNextPage,
  stampHeadingIdentities,
  strandedPagedHeadingIds
} from "../src/paged-stranded-headings.js";

/** 用属性模拟可见性：带 data-hidden 的元素没有布局盒。 */
const visible = (element: Element) => !element.hasAttribute("data-hidden");

function heading(level: number, id: string, text = id) {
  return `<h${level} ${HEADING_IDENTITY_ATTRIBUTE}="${id}">${text}</h${level}>`;
}

/** 构造分页结果中的一页：页面区域 > 内容 > 文档根容器 > 若干块。 */
function pageHtml(...blocks: string[]) {
  return (
    '<div class="pagedjs_page"><div class="pagedjs_area">' +
    '<div class="pagedjs_page_content"><div><article>' +
    blocks.join("") +
    "</article></div></div></div></div>"
  );
}

function render(...pages: string[]) {
  const root = document.createElement("div");
  root.innerHTML = pages.join("");
  return root;
}

describe("孤立标题检测", () => {
  it("页末最后一个有内容的块是标题，且之后还有页面时判定为孤立", () => {
    const rendered = render(
      pageHtml("<p>正文一</p>", heading(2, "heading-1")),
      pageHtml("<p>正文二</p>")
    );

    expect(strandedPagedHeadingIds(rendered, visible)).toEqual(["heading-1"]);
  });

  it("标题之后跟着被隐藏的空表壳时同样判定为孤立", () => {
    const rendered = render(
      pageHtml(
        "<p>正文一</p>",
        heading(3, "heading-1"),
        '<table data-hidden="true"><thead><tr><th>表头</th></tr></thead></table>'
      ),
      pageHtml("<table><tbody><tr><td>首行</td></tr></tbody></table>")
    );

    expect(strandedPagedHeadingIds(rendered, visible)).toEqual(["heading-1"]);
  });

  it("尾部连续标题只返回第一个，避免每个标题各占一页", () => {
    const rendered = render(
      pageHtml(
        "<p>正文一</p>",
        heading(2, "heading-1"),
        heading(3, "heading-2"),
        heading(4, "heading-3")
      ),
      pageHtml("<p>正文二</p>")
    );

    expect(strandedPagedHeadingIds(rendered, visible)).toEqual(["heading-1"]);
  });

  it("标题之间夹着零高度的分页标记时仍视为连续", () => {
    const rendered = render(
      pageHtml(
        "<p>正文一</p>",
        heading(2, "heading-1"),
        '<div data-hidden="true"></div>',
        heading(3, "heading-2")
      ),
      pageHtml("<p>正文二</p>")
    );

    expect(strandedPagedHeadingIds(rendered, visible)).toEqual(["heading-1"]);
  });

  it("标题之后还有正文时不是孤立", () => {
    const rendered = render(
      pageHtml(heading(2, "heading-1"), "<p>紧随其后的正文</p>"),
      pageHtml("<p>下一页</p>")
    );

    expect(strandedPagedHeadingIds(rendered, visible)).toEqual([]);
  });

  it("文档最后一页的尾部标题无处可去，不处理", () => {
    const rendered = render(
      pageHtml("<p>正文一</p>"),
      pageHtml("<p>正文二</p>", heading(2, "heading-1"))
    );

    expect(strandedPagedHeadingIds(rendered, visible)).toEqual([]);
  });

  it("之后的页面都没有可见内容时视为文档末尾，不处理", () => {
    const rendered = render(
      pageHtml("<p>正文一</p>", heading(2, "heading-1")),
      pageHtml('<div data-hidden="true"></div>')
    );

    expect(strandedPagedHeadingIds(rendered, visible)).toEqual([]);
  });

  it("本页只有标题时换页没有意义，不处理", () => {
    const rendered = render(
      pageHtml(heading(2, "heading-1"), heading(3, "heading-2")),
      pageHtml("<p>正文二</p>")
    );

    expect(strandedPagedHeadingIds(rendered, visible)).toEqual([]);
  });

  it("没有标识的标题无法映射回源文档，被忽略", () => {
    const rendered = render(
      pageHtml("<p>正文一</p>", "<h2>没有标识</h2>"),
      pageHtml("<p>正文二</p>")
    );

    expect(strandedPagedHeadingIds(rendered, visible)).toEqual([]);
  });

  it("嵌套在引用等结构里的标题不干预", () => {
    const rendered = render(
      pageHtml(
        "<p>正文一</p>",
        `<blockquote>${heading(2, "heading-1")}</blockquote>`
      ),
      pageHtml("<p>正文二</p>")
    );

    expect(strandedPagedHeadingIds(rendered, visible)).toEqual([]);
  });

  it("图片等图形内容也算有内容", () => {
    const rendered = render(
      pageHtml(heading(2, "heading-1"), '<figure><img alt="图"></figure>'),
      pageHtml("<p>正文二</p>")
    );

    expect(strandedPagedHeadingIds(rendered, visible)).toEqual([]);
  });

  it("多页各自独立判定", () => {
    const rendered = render(
      pageHtml("<p>甲</p>", heading(2, "heading-1")),
      pageHtml("<p>乙</p>"),
      pageHtml("<p>丙</p>", heading(2, "heading-2")),
      pageHtml("<p>丁</p>")
    );

    expect(strandedPagedHeadingIds(rendered, visible)).toEqual([
      "heading-1",
      "heading-2"
    ]);
  });
});

describe("标题标识与恢复", () => {
  it("按文档顺序为全部级别的标题编号，重复标注是幂等的", () => {
    const root = document.createElement("article");
    root.innerHTML = "<h1>一</h1><p>文</p><h3>二</h3><blockquote><h2>三</h2></blockquote>";

    expect(stampHeadingIdentities(root)).toBe(3);
    expect(
      Array.from(root.querySelectorAll("h1, h2, h3")).map((element) =>
        element.getAttribute(HEADING_IDENTITY_ATTRIBUTE)
      )
    ).toEqual(["heading-1", "heading-2", "heading-3"]);
    expect(stampHeadingIdentities(root)).toBe(0);
  });

  it("只让被点名的标题强制换页，重复调用不重复计数", () => {
    const source = document.createElement("article");
    source.innerHTML = heading(2, "heading-1") + heading(2, "heading-2");

    expect(forceStrandedHeadingsToNextPage(source, ["heading-2"])).toBe(1);
    expect(forceStrandedHeadingsToNextPage(source, ["heading-2"])).toBe(0);

    const [first, second] = Array.from(source.querySelectorAll("h2"));
    expect(hasForcedBreak(first!, "before")).toBe(false);
    expect(hasForcedBreak(second!, "before")).toBe(true);
  });

  it("不变量为 warning 级别，检测与修复串联工作", () => {
    const invariant = createStrandedHeadingInvariant(visible);
    const source = document.createElement("article");
    source.innerHTML = heading(2, "heading-1");
    const rendered = render(
      pageHtml("<p>正文一</p>", heading(2, "heading-1")),
      pageHtml("<p>正文二</p>")
    );
    const context = { source, rendered };

    expect(invariant.id).toBe(STRANDED_HEADING_INVARIANT_ID);
    expect(invariant.severity).toBe("warning");
    expect(invariant.detect(context)).toEqual(["heading-1"]);
    expect(invariant.repair!(context, ["heading-1"])).toBe(1);
    // 已经施加过换页但仍孤立：返回 0，运行器据此停止，不会空转
    expect(invariant.repair!(context, ["heading-1"])).toBe(0);
  });
});
