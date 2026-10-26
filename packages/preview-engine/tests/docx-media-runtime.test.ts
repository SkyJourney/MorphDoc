// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectPagedDocxTableGeometries,
  collectDocxDocumentLayoutPlan,
  collectDocxInlineCodeLayouts,
  collectDocxListItemLayouts,
  collectDocxTextBlockLayouts,
  collectDocxMediaCaptureTargets,
  forcePagedTableRowsToNextPage,
  mergePagedTableGeometries,
  missingPagedTableRowIds,
  protectFittableInlineCodeParagraphs,
  removeInheritedPagedSplitJustification,
  renderDocxMediaCapturePlan,
  restorePagedTableColumns,
  restorePagedTableStructure,
  stabilizePagedTableColumns
} from "../src/index.js";

describe("DOCX 媒体捕获计划", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.scrollTo(0, 0);
  });

  it("连续布局使用原始打印媒体主题 CSS", async () => {
    const render = vi.fn(async () => ({
      echartsErrors: [],
      mermaidErrors: []
    }));
    const renderContinuous = vi.fn(async () => ({
      echartsErrors: [],
      mermaidErrors: []
    }));
    const root = document.createElement("main");
    root.innerHTML = '<article id="write"></article>';

    await renderDocxMediaCapturePlan(
      { render, renderContinuous } as never,
      root,
      {
        articleHtml: '<article id="write"></article>',
        fileName: "打印媒体.md",
        metadata: {
          title: "",
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
        themeCss: "@media print { html { font-size: 13px; } }",
        exportConfig: {} as never
      },
      { contentWidthPx: 640, contentHeightPx: 900 }
    );

    expect(renderContinuous).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ themeMedia: "print" })
    );
    expect(render).toHaveBeenCalledWith(
      expect.anything(),
      {
        target: "pdf",
        allowIncompleteTableGeometry: true
      }
    );
  });

  it("仅将能完整放入一页的顶层行内代码段落保持为整体", () => {
    document.body.innerHTML = `
      <article id="write">
        <p id="short" class="md-inline-code-paragraph">短段落</p>
        <p id="long" class="md-inline-code-paragraph">超长段落</p>
        <table><tbody><tr><td>
          <p id="cell" class="md-inline-code-paragraph">单元格段落</p>
        </td></tr></tbody></table>
      </article>
    `;
    const short = document.querySelector<HTMLElement>("#short")!;
    const long = document.querySelector<HTMLElement>("#long")!;
    const cell = document.querySelector<HTMLElement>("#cell")!;
    short.getBoundingClientRect = () => ({ height: 240 }) as DOMRect;
    long.getBoundingClientRect = () => ({ height: 1200 }) as DOMRect;
    cell.getBoundingClientRect = () => ({ height: 120 }) as DOMRect;

    expect(protectFittableInlineCodeParagraphs(document, 900)).toBe(1);
    expect(short.style.getPropertyValue("break-inside")).toBe("avoid");
    expect(short.style.getPropertyPriority("break-inside")).toBe("important");
    expect(short.dataset.morphdocInlineCodeKeepWhole).toBe("true");
    expect(long.style.getPropertyValue("break-inside")).toBe("");
    expect(cell.style.getPropertyValue("break-inside")).toBe("");
  });

  it("按逻辑表格去重采集分页后的真实列轨", () => {
    document.body.innerHTML = `
      <main class="pagedjs_pages">
        <section class="pagedjs_page">
          <div class="pagedjs_area">
            <table data-ref="table-a">
              <colgroup data-stabilized-columns="true">
                <col data-stabilized-width-px="120">
                <col data-stabilized-width-px="280">
              </colgroup>
              <tbody><tr><td>A</td><td>B</td></tr></tbody>
            </table>
          </div>
        </section>
        <section class="pagedjs_page">
          <div class="pagedjs_area">
            <table data-ref="table-a">
              <colgroup data-stabilized-columns="true">
                <col data-stabilized-width-px="120">
                <col data-stabilized-width-px="280">
              </colgroup>
              <tbody><tr><td>C</td><td>D</td></tr></tbody>
            </table>
          </div>
        </section>
      </main>
    `;
    const areas = Array.from(
      document.querySelectorAll<HTMLElement>(".pagedjs_area")
    );
    const tables = Array.from(
      document.querySelectorAll<HTMLTableElement>("table")
    );
    areas.forEach((area) => {
      area.getBoundingClientRect = () => ({
        left: 100, right: 900, top: 0, bottom: 900,
        width: 800, height: 900
      }) as DOMRect;
    });
    tables.forEach((table, index) => {
      table.getBoundingClientRect = () => ({
        left: index === 0 ? 900 : 140,
        right: index === 0 ? 1300 : 540,
        top: 20, bottom: 220,
        width: 400, height: 200
      }) as DOMRect;
    });

    expect(collectPagedDocxTableGeometries(document, {
      contentWidthPx: 800,
      contentHeightPx: 900
    })).toEqual([{
      ordinal: 1,
      widthPercent: 50,
      leftOffsetPercent: 5,
      columnWidthPercents: [30, 70]
    }]);
  });

  it("只覆盖列数一致的分页表格几何并保留连续布局行样式", () => {
    const row = {
      cells: [{
        columnSpan: 1,
        backgroundColor: "#ffffff",
        color: "#000000",
        bold: true,
        italic: false,
        alignment: "left" as const
      }]
    };
    const layout = {
      tables: [
        {
          ordinal: 1,
          widthPercent: 100,
          leftOffsetPercent: 0,
          columnWidthPercents: [40, 60],
          rows: [row]
        },
        {
          ordinal: 2,
          widthPercent: 100,
          leftOffsetPercent: 0,
          columnWidthPercents: [100],
          rows: [row]
        }
      ],
      textBlocks: [],
      listItems: [],
      inlineCodes: []
    };

    const merged = mergePagedTableGeometries(layout, [
      {
        ordinal: 1,
        widthPercent: 90,
        leftOffsetPercent: 5,
        columnWidthPercents: [30, 70]
      },
      {
        ordinal: 2,
        widthPercent: 80,
        leftOffsetPercent: 10,
        columnWidthPercents: [20, 80]
      }
    ]);

    expect(merged.tables[0]).toEqual({
      ...layout.tables[0],
      widthPercent: 90,
      leftOffsetPercent: 5,
      columnWidthPercents: [30, 70]
    });
    expect(merged.tables[0]?.rows).toBe(layout.tables[0]?.rows);
    expect(merged.tables[1]).toBe(layout.tables[1]);
  });

  it("只移除会把 Paged.js 末行两端对齐继承给子块的容器标记", () => {
    document.body.innerHTML = `
      <main id="pages">
        <article id="write" data-align-last-split-element="justify">
          <h1>标题</h1>
          <p data-align-last-split-element="justify">跨页正文</p>
        </article>
      </main>
    `;
    expect(
      removeInheritedPagedSplitJustification(
        document.querySelector("#pages")!
      )
    ).toBe(1);
    expect(
      document.querySelector("#write")?.hasAttribute(
        "data-align-last-split-element"
      )
    ).toBe(false);
    expect(
      document.querySelector("p")?.getAttribute(
        "data-align-last-split-element"
      )
    ).toBe("justify");
  });

  it("按文档顺序标记图片、Mermaid 和 ECharts", () => {
    document.body.innerHTML = `
      <article id="write">
        <figure class="md-document-image-block">
          <img class="md-document-image" alt="架构截图">
          <figcaption>系统架构</figcaption>
        </figure>
        <div class="mermaid"><svg aria-label="处理流程"></svg></div>
        <figure class="md-echarts">
          <div class="md-echarts-host" aria-label="年度收入">
            <svg></svg>
          </div>
          <figcaption>收入趋势</figcaption>
        </figure>
      </article>
    `;
    const media = Array.from(
      document.querySelectorAll<HTMLElement | SVGSVGElement>(
        "img, svg"
      )
    );
    const article = document.querySelector<HTMLElement>("#write")!;
    article.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 700,
        bottom: 900,
        width: 700,
        height: 900,
        toJSON: () => ({})
      }) as DOMRect;
    const horizontalPositions = [0, 200, 400];
    media.forEach((element, index) => {
      const left = horizontalPositions[index]!;
      element.getBoundingClientRect = () =>
        ({
          x: left,
          y: 20 + index * 100,
          left,
          top: 20 + index * 100,
          right: left + 300,
          bottom: 170 + index * 100,
          width: 300,
          height: 150,
          toJSON: () => ({})
        }) as DOMRect;
    });

    const targets = collectDocxMediaCaptureTargets(document, {
      contentWidthPx: 700,
      contentHeightPx: 900
    });

    expect(
      targets.map(
        ({ id, kind, kindOrdinal, altText, caption, alignment }) => ({
          id,
          kind,
          kindOrdinal,
          altText,
          caption,
          alignment
        })
      )
    ).toEqual([
      {
        id: "docx-media-1",
        kind: "image",
        kindOrdinal: 1,
        altText: "架构截图",
        caption: "系统架构",
        alignment: "left"
      },
      {
        id: "docx-media-2",
        kind: "mermaid",
        kindOrdinal: 1,
        altText: "处理流程",
        caption: undefined,
        alignment: "center"
      },
      {
        id: "docx-media-3",
        kind: "echarts",
        kindOrdinal: 1,
        altText: "年度收入",
        caption: "收入趋势",
        alignment: "right"
      }
    ]);
    expect(
      media.map((element) => element.dataset.docxMediaId)
    ).toEqual(["docx-media-1", "docx-media-2", "docx-media-3"]);
    expect(targets[0]?.rasterScale).toBe(3.125);
  });

  it("限制超大媒体的显示尺寸和 PNG 像素规模", () => {
    document.body.innerHTML = `
      <article id="write">
        <img class="md-document-image" alt="">
      </article>
    `;
    const image = document.querySelector("img")!;
    const article = document.querySelector<HTMLElement>("#write")!;
    article.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 800,
        bottom: 900,
        width: 800,
        height: 900,
        toJSON: () => ({})
      }) as DOMRect;
    image.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: image.style.width ? 800 : 4000,
        bottom: image.style.width ? 600 : 3000,
        width: image.style.width ? 800 : 4000,
        height: image.style.width ? 600 : 3000,
        toJSON: () => ({})
      }) as DOMRect;

    const [target] = collectDocxMediaCaptureTargets(document, {
      contentWidthPx: 800,
      contentHeightPx: 900
    });

    expect(target?.displayWidthPx).toBeLessThanOrEqual(800);
    expect(target?.displayHeightPx).toBeLessThanOrEqual(900);
    expect(target?.alignment).toBe("center");
    expect(
      (target?.captureWidthPx ?? 0) *
        (target?.rasterScale ?? 0)
    ).toBeLessThanOrEqual(4096);
    expect(target?.altText).toBe("图片 1");
  });

  it("从真实 DOM 几何采集主题无关的表格列宽比例", () => {
    document.body.innerHTML = `
      <article id="write">
        <table><tbody>
          <tr><td>短列</td><td>较长内容列</td></tr>
          <tr><td>1</td><td>2</td></tr>
        </tbody></table>
      </article>
    `;
    const article = document.querySelector<HTMLElement>("#write")!;
    const table = document.querySelector<HTMLTableElement>("table")!;
    const cells = Array.from(table.querySelectorAll<HTMLTableCellElement>("td"));
    article.getBoundingClientRect = () => ({
      left: 100,
      right: 900,
      top: 0,
      bottom: 900,
      width: 800,
      height: 900
    }) as DOMRect;
    table.getBoundingClientRect = () => ({
      left: 140,
      right: 860,
      top: 20,
      bottom: 220,
      width: 720,
      height: 200
    }) as DOMRect;
    cells.forEach((cell, index) => {
      const firstColumn = index % 2 === 0;
      cell.getBoundingClientRect = () => ({
        left: firstColumn ? 140 : 356,
        right: firstColumn ? 356 : 860,
        top: index < 2 ? 20 : 120,
        bottom: index < 2 ? 120 : 220,
        width: firstColumn ? 216 : 504,
        height: 100
      }) as DOMRect;
    });

    expect(
      collectDocxDocumentLayoutPlan(document, {
        contentWidthPx: 800,
        contentHeightPx: 900
      })
    ).toEqual({
      inlineCodes: [],
      listItems: [],
      textBlocks: [],
      tables: [
        {
          ordinal: 1,
          widthPercent: 90,
          leftOffsetPercent: 5,
          columnWidthPercents: [30, 70],
          rows: [
            {
              cells: [
                {
                  columnSpan: 1,
                  backgroundColor: "#ffffff",
                  color: "#000000",
                  bold: false,
                  italic: false,
                  alignment: "left"
                },
                {
                  columnSpan: 1,
                  backgroundColor: "#ffffff",
                  color: "#000000",
                  bold: false,
                  italic: false,
                  alignment: "left"
                }
              ]
            },
            {
              cells: [
                {
                  columnSpan: 1,
                  backgroundColor: "#ffffff",
                  color: "#000000",
                  bold: false,
                  italic: false,
                  alignment: "left"
                },
                {
                  columnSpan: 1,
                  backgroundColor: "#ffffff",
                  color: "#000000",
                  bold: false,
                  italic: false,
                  alignment: "left"
                }
              ]
            }
          ]
        }
      ]
    });
  });

  it("保留主题表格超出文档内容盒的实测宽度", () => {
    document.body.innerHTML = `
      <article id="write"><table><tbody><tr><td>内容</td></tr></tbody></table></article>
    `;
    const article = document.querySelector<HTMLElement>("#write")!;
    const table = document.querySelector<HTMLTableElement>("table")!;
    const cell = document.querySelector<HTMLTableCellElement>("td")!;
    article.getBoundingClientRect = () => ({
      left: 100,
      right: 900,
      top: 0,
      bottom: 900,
      width: 800,
      height: 900,
    }) as DOMRect;
    table.getBoundingClientRect = () => ({
      left: 100,
      right: 980,
      top: 20,
      bottom: 120,
      width: 880,
      height: 100,
    }) as DOMRect;
    cell.getBoundingClientRect = table.getBoundingClientRect;

    const layout = collectDocxDocumentLayoutPlan(document, {
      contentWidthPx: 800,
      contentHeightPx: 900,
    });

    expect(layout.tables[0]?.widthPercent).toBeCloseTo(110, 8);
    expect(layout.tables[0]?.columnWidthPercents).toEqual([100]);
  });

  it("分页前冻结整表实测列宽供拆分页片段复用", () => {
    document.body.innerHTML = `
      <article id="write"><table><tbody><tr><td>A</td><td>B</td></tr></tbody></table></article>
    `;
    const table = document.querySelector<HTMLTableElement>("table")!;
    const cells = Array.from(table.rows[0]!.cells);
    table.getBoundingClientRect = () => ({
      left: 100,
      right: 500,
      top: 0,
      bottom: 100,
      width: 400,
      height: 100
    }) as DOMRect;
    cells[0]!.getBoundingClientRect = () => ({
      left: 100,
      right: 220,
      top: 0,
      bottom: 100,
      width: 120,
      height: 100
    }) as DOMRect;
    cells[1]!.getBoundingClientRect = () => ({
      left: 220,
      right: 500,
      top: 0,
      bottom: 100,
      width: 280,
      height: 100
    }) as DOMRect;

    expect(stabilizePagedTableColumns(document)).toBe(1);
    expect(table.dataset.stabilizedColumns).toBe("true");
    expect(table.style.tableLayout).toBe("fixed");
    expect(Array.from(table.querySelectorAll("col")).map(
      (column) => column.style.width
    )).toEqual(["120px", "280px"]);
    expect(Array.from(table.querySelectorAll("col")).map(
      (column) => (column as HTMLTableColElement).dataset.stabilizedWidthPx
    )).toEqual(["120", "280"]);
    expect(Array.from(table.querySelectorAll("th, td")).map(
      (cell) => (cell as HTMLElement).style.width
    )).toEqual(["120px", "280px"]);
    expect(stabilizePagedTableColumns(document)).toBe(0);
  });

  it("DOCX 布局采集保持分页前原始列轨而不受辅助样式二次测量影响", () => {
    document.body.innerHTML = `
      <article id="write">
        <table data-stabilized-columns="true">
          <colgroup data-stabilized-columns="true">
            <col data-stabilized-width-px="120" style="width: 140px">
            <col data-stabilized-width-px="280" style="width: 260px">
          </colgroup>
          <tbody><tr><td>A</td><td>B</td></tr></tbody>
        </table>
      </article>
    `;
    const article = document.querySelector<HTMLElement>("#write")!;
    const table = document.querySelector<HTMLTableElement>("table")!;
    const cells = Array.from(table.rows[0]!.cells);
    article.getBoundingClientRect = () => ({
      left: 100, right: 500, top: 0, bottom: 100,
      width: 400, height: 100
    }) as DOMRect;
    table.getBoundingClientRect = article.getBoundingClientRect;
    cells[0]!.getBoundingClientRect = () => ({
      left: 100, right: 240, top: 0, bottom: 100,
      width: 140, height: 100
    }) as DOMRect;
    cells[1]!.getBoundingClientRect = () => ({
      left: 240, right: 500, top: 0, bottom: 100,
      width: 260, height: 100
    }) as DOMRect;

    const layout = collectDocxDocumentLayoutPlan(document, {
      contentWidthPx: 400,
      contentHeightPx: 900
    });

    expect(layout.tables[0]?.columnWidthPercents).toEqual([30, 70]);
  });

  it("冻结跨列单元格为对应列轨宽度之和", () => {
    document.body.innerHTML = `
      <table><tbody>
        <tr><td colspan="2">跨列</td></tr>
        <tr><td>甲</td><td>乙</td></tr>
      </tbody></table>
    `;
    const table = document.querySelector("table")!;
    const cells = Array.from(table.querySelectorAll("td"));
    table.getBoundingClientRect = () => ({
      left: 100, right: 500, top: 0, bottom: 100,
      width: 400, height: 100
    }) as DOMRect;
    cells[0]!.getBoundingClientRect = () => ({
      left: 100, right: 500, top: 0, bottom: 50,
      width: 400, height: 50
    }) as DOMRect;
    cells[1]!.getBoundingClientRect = () => ({
      left: 100, right: 220, top: 50, bottom: 100,
      width: 120, height: 50
    }) as DOMRect;
    cells[2]!.getBoundingClientRect = () => ({
      left: 220, right: 500, top: 50, bottom: 100,
      width: 280, height: 50
    }) as DOMRect;

    expect(stabilizePagedTableColumns(document)).toBe(1);
    expect(cells.map((cell) => cell.style.width)).toEqual([
      "400px", "120px", "280px"
    ]);
  });

  it("分页片段已有冻结列定义时不重复插入 colgroup", () => {
    document.body.innerHTML = `
      <table id="source">
        <colgroup data-stabilized-columns="true"><col style="width: 30%"><col style="width: 70%"></colgroup>
        <thead><tr><th>A</th><th>B</th></tr></thead>
        <tbody><tr><td>甲</td><td>乙</td></tr></tbody>
      </table>
      <table id="rendered">
        <colgroup data-stabilized-columns="true"><col style="width: 30%"><col style="width: 70%"></colgroup>
        <tbody><tr><td>丙</td><td>丁</td></tr></tbody>
      </table>
    `;
    const source = document.querySelector<HTMLTableElement>("#source")!;
    const rendered = document.querySelector<HTMLTableElement>("#rendered")!;

    restorePagedTableStructure(source, rendered);

    expect(rendered.querySelectorAll(":scope > colgroup")).toHaveLength(1);
    expect(rendered.querySelectorAll(":scope > colgroup > col")).toHaveLength(2);
    expect(rendered.querySelectorAll(":scope > thead")).toHaveLength(1);
    expect(Array.from(rendered.children).map((child) => child.tagName)).toEqual([
      "COLGROUP",
      "THEAD",
      "TBODY"
    ]);
  });

  it("分页前仅对可容纳于单页的表格行单元格启用整行保护", () => {
    document.body.innerHTML = `
      <table><tbody>
        <tr id="normal"><td>普通行</td><td>内容</td></tr>
        <tr id="tall"><td>超高行</td><td>内容</td></tr>
      </tbody></table>
    `;
    const table = document.querySelector<HTMLTableElement>("table")!;
    const normal = document.querySelector<HTMLTableRowElement>("#normal")!;
    const tall = document.querySelector<HTMLTableRowElement>("#tall")!;
    table.getBoundingClientRect = () => ({
      width: 400, height: 1020, top: 0, right: 400,
      bottom: 1020, left: 0
    }) as DOMRect;
    normal.getBoundingClientRect = () => ({
      width: 400, height: 120, top: 0, right: 400,
      bottom: 120, left: 0
    }) as DOMRect;
    tall.getBoundingClientRect = () => ({
      width: 400, height: 900, top: 120, right: 400,
      bottom: 1020, left: 0
    }) as DOMRect;
    Array.from(table.rows).flatMap((row) => Array.from(row.cells))
      .forEach((cell, index) => {
        cell.getBoundingClientRect = () => ({
          width: 200,
          height: index < 2 ? 120 : 900,
          top: index < 2 ? 0 : 120,
          right: index % 2 === 0 ? 200 : 400,
          bottom: index < 2 ? 120 : 1020,
          left: index % 2 === 0 ? 0 : 200
        }) as DOMRect;
      });

    stabilizePagedTableColumns(document, 800);

    expect(Array.from(normal.cells).map(
      (cell) => cell.style.getPropertyValue("break-inside")
    )).toEqual(["avoid", "avoid"]);
    expect(Array.from(tall.cells).map(
      (cell) => cell.style.getPropertyValue("break-inside")
    )).toEqual(["auto", "auto"]);
    expect(Array.from(normal.cells).every(
      (cell) => cell.style.getPropertyPriority("break-inside") === "important"
    )).toBe(true);
    expect(normal.dataset.morphdocTableRowId).toBe("table-1-row-1");
    expect(normal.dataset.morphdocTableRowKeepWhole).toBe("true");
    expect(tall.dataset.morphdocTableRowId).toBe("table-1-row-2");
    expect(tall.dataset.morphdocTableRowKeepWhole).toBe("false");
  });

  it("检测分页后缺失的可容纳正文行并施加恢复断点", () => {
    document.body.innerHTML = `
      <main id="source"><table><tbody>
        <tr data-morphdoc-table-row-id="row-1" data-morphdoc-table-row-keep-whole="true"><td>甲</td></tr>
        <tr data-morphdoc-table-row-id="row-2" data-morphdoc-table-row-keep-whole="true"><td>乙</td></tr>
        <tr data-morphdoc-table-row-id="row-tall" data-morphdoc-table-row-keep-whole="false"><td>超高</td></tr>
      </tbody></table></main>
      <main id="rendered"><table><tbody>
        <tr data-morphdoc-table-row-id="row-2"><td>乙</td></tr>
      </tbody></table></main>
    `;
    const source = document.querySelector("#source")!;
    const rendered = document.querySelector("#rendered")!;

    expect(missingPagedTableRowIds(source, rendered)).toEqual(["row-1"]);
    expect(forcePagedTableRowsToNextPage(source, ["row-1"])).toBe(1);
    const row = source.querySelector<HTMLTableRowElement>(
      '[data-morphdoc-table-row-id="row-1"]'
    )!;
    const table = row.closest("table")!;
    const marker = table.previousElementSibling as HTMLElement;
    expect(marker.dataset.morphdocTableRecoveryMarker).toBe("true");
    expect(marker.textContent).toBe("\u00a0");
    expect(marker.style.getPropertyValue("height")).toBe("1px");
    expect(marker.style.getPropertyValue("margin-bottom")).toBe("-1px");
    expect(marker.style.getPropertyValue("opacity")).toBe("0");
    expect(marker.style.getPropertyValue("break-before")).toBe("page");
    expect(marker.style.getPropertyPriority("break-before")).toBe("important");
    expect(table.dataset.morphdocTableRecovery).toBe("true");
    expect(row.dataset.morphdocTableRowRecovery).toBe("true");
    expect(forcePagedTableRowsToNextPage(source, ["row-1"])).toBe(1);
    expect(source.querySelectorAll("[data-morphdoc-table-recovery-marker]"))
      .toHaveLength(1);

  });

  it("在非首行缺失时拆分续表并将恢复断点放到表格外", () => {
    document.body.innerHTML = `
      <main id="source"><table id="source-table">
        <colgroup><col><col></colgroup>
        <thead><tr><th>甲</th><th>乙</th></tr></thead>
        <tbody>
          <tr data-morphdoc-table-row-id="row-1"><td>一</td><td>壹</td></tr>
          <tr data-morphdoc-table-row-id="row-2"><td>二</td><td>贰</td></tr>
          <tr data-morphdoc-table-row-id="row-3"><td>三</td><td>叁</td></tr>
        </tbody>
        <tfoot><tr><td>尾</td><td>末</td></tr></tfoot>
      </table></main>
    `;
    const source = document.querySelector("#source")!;

    expect(forcePagedTableRowsToNextPage(source, ["row-2"])).toBe(1);

    const tables = source.querySelectorAll<HTMLTableElement>("table");
    expect(tables).toHaveLength(2);
    expect(Array.from(tables[0]!.querySelectorAll("tbody > tr")).map(
      (row) => (row as HTMLElement).dataset.morphdocTableRowId
    )).toEqual(["row-1"]);
    expect(Array.from(tables[1]!.querySelectorAll("tbody > tr")).map(
      (row) => (row as HTMLElement).dataset.morphdocTableRowId
    )).toEqual(["row-2", "row-3"]);
    expect(tables[1]!.dataset.morphdocTableRecoveryContinuation).toBe("true");
    expect(tables[1]!.querySelector("colgroup")).not.toBeNull();
    expect(tables[1]!.querySelector("thead")).not.toBeNull();
    expect(tables[0]!.querySelector("tfoot")).toBeNull();
    expect(tables[1]!.querySelector("tfoot")).not.toBeNull();
    const marker = tables[1]!.previousElementSibling as HTMLElement;
    expect(marker.dataset.morphdocTableRecoveryMarker).toBe("true");
    expect(marker.style.getPropertyValue("break-before")).toBe("page");
    expect(marker.style.getPropertyPriority("break-before")).toBe("important");
  });

  it("仅将分页可视区域内真实可见的表格行视为已渲染", () => {
    document.body.innerHTML = `
      <main id="source"><table><tbody>
        <tr data-morphdoc-table-row-id="row-clipped" data-morphdoc-table-row-keep-whole="true"><td>裁切</td></tr>
        <tr data-morphdoc-table-row-id="row-visible" data-morphdoc-table-row-keep-whole="true"><td>可见</td></tr>
      </tbody></table></main>
      <main id="rendered">
        <section class="pagedjs_area" id="page-1">
          <table><tbody>
            <tr id="clipped" data-morphdoc-table-row-id="row-clipped"><td>裁切</td></tr>
            <tr id="visible" data-morphdoc-table-row-id="row-visible"><td>可见</td></tr>
          </tbody></table>
        </section>
        <section class="pagedjs_area" id="page-2">
          <table><tbody>
            <tr id="visible-duplicate" data-morphdoc-table-row-id="row-visible"><td>可见副本</td></tr>
          </tbody></table>
        </section>
      </main>
    `;
    const rect = (
      left: number,
      top: number,
      right: number,
      bottom: number
    ) => ({
      left, top, right, bottom,
      width: right - left,
      height: bottom - top,
      x: left,
      y: top,
      toJSON: () => ({})
    }) as DOMRect;
    document.querySelector<HTMLElement>("#page-1")!.getBoundingClientRect =
      () => rect(0, 0, 600, 800);
    document.querySelector<HTMLElement>("#page-2")!.getBoundingClientRect =
      () => rect(0, 900, 600, 1700);
    document.querySelector<HTMLElement>("#clipped")!.getBoundingClientRect =
      () => rect(0, 810, 600, 850);
    document.querySelector<HTMLElement>("#visible")!.getBoundingClientRect =
      () => rect(0, 780, 600, 820);
    document.querySelector<HTMLElement>("#visible-duplicate")!
      .getBoundingClientRect = () => rect(0, 920, 600, 960);

    expect(missingPagedTableRowIds(
      document.querySelector("#source")!,
      document.querySelector("#rendered")!
    )).toEqual(["row-clipped"]);
  });

  it("分页片段同步源表冻结列宽而不重复 colgroup", () => {
    document.body.innerHTML = `
      <table id="source" data-stabilized-columns="true">
        <colgroup data-stabilized-columns="true"><col data-stabilized-width-px="118" style="width: 120px"><col data-stabilized-width-px="282" style="width: 280px"></colgroup>
        <tbody><tr><td>甲</td><td>乙</td></tr></tbody>
      </table>
      <table id="rendered">
        <colgroup><col style="width: 100px"><col style="width: 300px"></colgroup>
        <tbody><tr><td>甲</td><td>乙</td></tr></tbody>
      </table>
    `;
    const source = document.querySelector<HTMLTableElement>("#source")!;
    const rendered = document.querySelector<HTMLTableElement>("#rendered")!;

    restorePagedTableColumns(source, rendered);

    expect(rendered.querySelectorAll(":scope > colgroup")).toHaveLength(1);
    expect(Array.from(rendered.querySelectorAll("col")).map(
      (column) => column.style.width
    )).toEqual(["120px", "280px"]);
    expect(Array.from(rendered.querySelectorAll("col")).map(
      (column) => (column as HTMLTableColElement).dataset.stabilizedWidthPx
    )).toEqual(["118", "282"]);
    expect(rendered.dataset.stabilizedColumns).toBe("true");
    expect(rendered.style.tableLayout).toBe("fixed");
  });

  it("按真实上下文采集行内代码字号、颜色和盒模型", () => {
    document.body.innerHTML = `
      <article id="write" style="font-size: 20px">
        <p><code style="font-size: .8em; letter-spacing: 1px; color: rgb(17, 34, 51); background: rgb(245, 245, 245); padding: 2px 4px">inline</code></p>
        <pre><code>block</code></pre>
      </article>
    `;
    expect(
      collectDocxInlineCodeLayouts(
        document.querySelector<HTMLElement>("#write")!
      )
    ).toEqual([
      {
        ordinal: 1,
        text: "inline",
        fontSizePt: 12,
        letterSpacingPt: 0.75,
        color: "#112233",
        backgroundColor: "#f5f5f5",
        paddingPt: {
          top: 1.5,
          right: 3,
          bottom: 1.5,
          left: 3
        },
        borderPt: {
          top: 0,
          right: 0,
          bottom: 0,
          left: 0
        }
      }
    ]);
  });

  it("按列表项实际文字起点采集嵌套缩进且排除子列表文字", () => {
    document.body.innerHTML = `
      <article id="write">
        <ul><li>一级 <code>代码</code><ul><li>二级项目</li></ul></li></ul>
      </article>
    `;
    const article = document.querySelector<HTMLElement>("#write")!;
    article.getBoundingClientRect = () => ({
      left: 100,
      right: 900,
      top: 0,
      bottom: 900,
      width: 800,
      height: 900
    }) as DOMRect;
    const rangePrototype = Object.getPrototypeOf(document.createRange()) as {
      getBoundingClientRect?: () => DOMRect;
    };
    const original = rangePrototype.getBoundingClientRect;
    rangePrototype.getBoundingClientRect = function (this: Range) {
      const left = this.startContainer.textContent === "二级项目" ? 340 : 220;
      return {
        left,
        right: left + 10,
        top: 20,
        bottom: 32,
        width: 10,
        height: 12
      } as DOMRect;
    };
    try {
      expect(collectDocxListItemLayouts(article)).toEqual([
        {
          ordinal: 1,
          text: "一级 代码",
          depth: 0,
          textStartPt: 90
        },
        {
          ordinal: 2,
          text: "二级项目",
          depth: 1,
          textStartPt: 180
        }
      ]);
    } finally {
      rangePrototype.getBoundingClientRect = original;
    }
  });

  it("不把普通两端对齐列表的自然末行误判为分散对齐", () => {
    document.body.innerHTML = `
      <article id="write">
        <ul><li style="text-align: justify; text-align-last: left">末行保持左对齐</li></ul>
      </article>
    `;
    const article = document.querySelector<HTMLElement>("#write")!;
    article.getBoundingClientRect = () => ({
      left: 0,
      right: 800,
      top: 0,
      bottom: 900,
      width: 800,
      height: 900
    }) as DOMRect;
    const rangePrototype = Object.getPrototypeOf(document.createRange()) as {
      getBoundingClientRect?: () => DOMRect;
    };
    const original = rangePrototype.getBoundingClientRect;
    rangePrototype.getBoundingClientRect = function (this: Range) {
      return {
        left: this.startOffset * 80,
        right: this.startOffset * 80 + 10,
        top: 20,
        bottom: 32,
        width: 10,
        height: 12
      } as DOMRect;
    };
    try {
      expect(collectDocxListItemLayouts(article)[0]?.alignment).toBeUndefined();
    } finally {
      rangePrototype.getBoundingClientRect = original;
    }
  });

  it("采集正文文本块在 Chromium 中的实际行断点", () => {
    document.body.innerHTML = `
      <article id="write">
        <section data-semantic-region="cover"><p>独立封面</p></section>
        <p>甲乙丙丁</p>
      </article>
    `;
    const rangePrototype = Object.getPrototypeOf(document.createRange()) as {
      getBoundingClientRect?: () => DOMRect;
    };
    const original = rangePrototype.getBoundingClientRect;
    rangePrototype.getBoundingClientRect = function (this: Range) {
      const top = this.startOffset < 2 ? 100 : 120;
      return {
        x: this.startOffset * 10,
        y: top,
        left: this.startOffset * 10,
        right: this.startOffset * 10 + 10,
        top,
        bottom: top + 12,
        width: 10,
        height: 12,
        toJSON: () => ({})
      } as DOMRect;
    };
    try {
      expect(
        collectDocxTextBlockLayouts(
          document.querySelector<HTMLElement>("#write")!
        )
      ).toEqual([
        {
          ordinal: 1,
          text: "甲乙丙丁",
          letterSpacingPt: 0,
          alignment: "left",
          linePitchPt: 15,
          lineBreakOffsets: [2]
        }
      ]);
    } finally {
      rangePrototype.getBoundingClientRect = original;
    }
  });
});
