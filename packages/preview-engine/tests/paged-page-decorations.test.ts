// @vitest-environment happy-dom

import { defaultExportConfig } from "@morphdoc/core";
import { describe, expect, it } from "vitest";
import { applyPagedPageDecorations } from "../src/paged-page-decorations.js";
import { createPagedPageSequence } from "../src/paged-page-sequence.js";
import type { PagedPreviewPayload } from "../src/paged-preview.js";

function createPage(content: string) {
  return `
    <div class="pagedjs_page">
      ${content}
      <div class="pagedjs_margin-top-left"><div class="pagedjs_margin-content">左页眉</div></div>
      <div class="pagedjs_margin-top-center"><div class="pagedjs_margin-content">中页眉</div></div>
      <div class="pagedjs_margin-top-right"><div class="pagedjs_margin-content">右页眉</div></div>
      <div class="pagedjs_margin-bottom-left"><div class="pagedjs_margin-content"></div></div>
      <div class="pagedjs_margin-bottom-center"><div class="pagedjs_margin-content"></div></div>
      <div class="pagedjs_margin-bottom-right"><div class="pagedjs_margin-content"></div></div>
    </div>
  `;
}

function createPayload(): PagedPreviewPayload {
  return {
    articleHtml: '<article id="write"></article>',
    fileName: "封面测试.md",
    metadata: {
      title: "封面测试",
      author: "",
      subject: "",
      keywords: [],
      language: "zh-CN"
    },
    semanticDocument: {
      schemaVersion: 1,
      titlePolicy: {
        metadataTitle: "suppress",
        firstBodyHeading: "keep"
      },
      regions: []
    },
    features: [],
    themeCss: "",
    exportConfig: {
      ...defaultExportConfig,
      header: {
        ...defaultExportConfig.header,
        enabled: true,
        showOnFirstPage: true
      },
      footer: {
        ...defaultExportConfig.footer,
        alignment: "outer",
        showOnFirstPage: false
      }
    }
  };
}

describe("分页页面装饰", () => {
  it("隐藏封面装饰并按正文页序计算首页和外侧页码", () => {
    const root = document.createElement("div");
    root.innerHTML = [
      createPage("封面"),
      createPage("正文首页"),
      createPage("正文第二页")
    ].join("");
    const payload = createPayload();
    const sequence = createPagedPageSequence(3, new Set([0]), 1);

    applyPagedPageDecorations(root, payload, sequence);

    const pages = root.querySelectorAll<HTMLElement>(".pagedjs_page");
    expect(pages[0]?.dataset.headerVisible).toBe("false");
    expect(pages[0]?.dataset.footerVisible).toBe("false");
    expect(
      pages[0]?.querySelector<HTMLElement>(".pagedjs_margin-top-left")
        ?.style.visibility
    ).toBe("hidden");
    expect(pages[1]?.dataset.headerVisible).toBe("true");
    expect(pages[1]?.dataset.footerVisible).toBe("false");
    expect(pages[2]?.dataset.footerVisible).toBe("true");
    const pageNumber = pages[2]?.querySelector<HTMLElement>(
      ".pagedjs_margin-bottom-left .pagedjs_margin-content"
    );
    expect(pageNumber?.textContent).toBe("2 / 2");
    expect(pageNumber?.dataset.pageNumberAlignment).toBe("left");
  });

  it("允许正文首页独立隐藏页眉但保留页码", () => {
    const root = document.createElement("div");
    root.innerHTML = createPage("正文首页");
    const payload = createPayload();
    payload.exportConfig = {
      ...payload.exportConfig,
      header: {
        ...payload.exportConfig.header,
        showOnFirstPage: false
      },
      footer: {
        ...payload.exportConfig.footer,
        alignment: "center",
        showOnFirstPage: true,
        startFrom: 5
      }
    };

    applyPagedPageDecorations(
      root,
      payload,
      createPagedPageSequence(1, new Set(), 5)
    );

    const page = root.querySelector<HTMLElement>(".pagedjs_page");
    expect(page?.dataset.headerVisible).toBe("false");
    expect(page?.dataset.footerVisible).toBe("true");
    expect(
      page?.querySelector<HTMLElement>(
        ".pagedjs_margin-bottom-center .pagedjs_margin-content"
      )?.textContent
    ).toBe("5 / 1");
  });
});
