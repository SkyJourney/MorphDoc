// @vitest-environment happy-dom

import { defaultExportConfig } from "@morphdoc/core";
import { describe, expect, it } from "vitest";
import {
  classifyPagedPages,
  createPagedPageSequence
} from "../src/paged-page-sequence.js";

function semanticDocument(withCover: boolean) {
  return {
    schemaVersion: 1 as const,
    titlePolicy: {
      metadataTitle: "suppress" as const,
      firstBodyHeading: "keep" as const
    },
    regions: withCover
      ? [
          {
            kind: "cover" as const,
            nodes: [
              {
                kind: "text" as const,
                role: "project-report-title" as const,
                text: "封面"
              }
            ],
            section: {
              headerFooter: "none" as const,
              pageNumber: "hidden" as const,
              breakAfter: "next-page" as const,
              followingPageNumberStart: 1
            }
          }
        ]
      : []
  };
}

describe("分页页面状态", () => {
  it("将封面排除在正文页序之外", () => {
    expect(createPagedPageSequence(4, new Set([0]), 1)).toEqual({
      physicalPageCount: 4,
      bodyPageCount: 3,
      bodyPageNumberStart: 1,
      pages: [
        { physicalPageIndex: 0, kind: "cover" },
        {
          physicalPageIndex: 1,
          kind: "body-first",
          bodyPageIndex: 0,
          pageNumber: 1
        },
        {
          physicalPageIndex: 2,
          kind: "body-rest",
          bodyPageIndex: 1,
          pageNumber: 2
        },
        {
          physicalPageIndex: 3,
          kind: "body-rest",
          bodyPageIndex: 2,
          pageNumber: 3
        }
      ]
    });
  });

  it("无封面时将物理首页识别为正文首页", () => {
    const sequence = createPagedPageSequence(2, new Set(), 5);

    expect(sequence.bodyPageCount).toBe(2);
    expect(sequence.pages[0]).toMatchObject({
      kind: "body-first",
      bodyPageIndex: 0,
      pageNumber: 5
    });
  });

  it("根据语义封面和分页 DOM 标记页面", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="pagedjs_page"><div data-semantic-region="cover">封面</div></div>
      <div class="pagedjs_page"><p>正文一</p></div>
      <div class="pagedjs_page"><p>正文二</p></div>
    `;

    const sequence = classifyPagedPages(root, {
      semanticDocument: semanticDocument(true),
      exportConfig: {
        ...defaultExportConfig,
        footer: { ...defaultExportConfig.footer, startFrom: 8 }
      }
    });

    const pages = root.querySelectorAll<HTMLElement>(".pagedjs_page");
    expect(sequence.bodyPageCount).toBe(2);
    expect(pages[0]?.dataset.pageKind).toBe("cover");
    expect(pages[0]?.dataset.pageNumber).toBeUndefined();
    expect(pages[1]?.dataset.pageKind).toBe("body-first");
    expect(pages[1]?.dataset.pageNumber).toBe("1");
    expect(pages[2]?.dataset.pageNumber).toBe("2");
  });

  it("没有封面语义时忽略孤立的封面 DOM 标记", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="pagedjs_page"><div data-semantic-region="cover">普通内容</div></div>
    `;

    const sequence = classifyPagedPages(root, {
      semanticDocument: semanticDocument(false),
      exportConfig: defaultExportConfig
    });

    expect(sequence.pages[0]).toMatchObject({
      kind: "body-first",
      pageNumber: 1
    });
  });
});
