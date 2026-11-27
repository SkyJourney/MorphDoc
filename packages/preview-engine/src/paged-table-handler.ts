import { Handler, registerHandlers } from "pagedjs";
import { forceBreakBefore } from "./paged-break-control.js";
import { resolveBreakTokenElement } from "./paged-break-token.js";
import type { PaginationInvariant } from "./paged-pagination-invariants.js";
import {
  fitTableToAvailableWidth,
  scaleColumnWidthsToFit,
  type TableFitMeasurements
} from "./paged-table-fit.js";

interface PagedBreakToken {
  node?: Node;
}

interface PagedChunker {
  source: ParentNode;
}

function measuredColumnWidths(table: HTMLTableElement) {
  const rows = Array.from(table.rows);
  const columnCount = rows.reduce(
    (maximum, row) => Math.max(
      maximum,
      Array.from(row.cells).reduce(
        (total, cell) => total + Math.max(1, cell.colSpan),
        0
      )
    ),
    0
  );
  const tableRect = table.getBoundingClientRect();
  if (columnCount < 1 || tableRect.width <= 0) {
    return [];
  }
  const boundaries = Array.from(
    { length: columnCount + 1 },
    () => [] as number[]
  );
  boundaries[0]!.push(0);
  boundaries[columnCount]!.push(tableRect.width);
  for (const row of rows) {
    let column = 0;
    for (const cell of Array.from(row.cells)) {
      const span = Math.max(1, cell.colSpan);
      const rect = cell.getBoundingClientRect();
      boundaries[column]?.push(
        Math.max(0, Math.min(tableRect.width, rect.left - tableRect.left))
      );
      column = Math.min(columnCount, column + span);
      boundaries[column]?.push(
        Math.max(0, Math.min(tableRect.width, rect.right - tableRect.left))
      );
    }
  }
  const resolved = boundaries.map((samples, index) =>
    samples.length > 0
      ? samples.reduce((sum, value) => sum + value, 0) / samples.length
      : tableRect.width * index / columnCount
  );
  resolved[0] = 0;
  resolved[columnCount] = tableRect.width;
  for (let index = 1; index < resolved.length; index += 1) {
    resolved[index] = Math.max(resolved[index - 1]! + 0.01, resolved[index]!);
  }
  return resolved.slice(1).map(
    (boundary, index) => boundary - resolved[index]!
  );
}

function applyColumnWidthWeights(
  columns: readonly HTMLTableColElement[],
  weights: readonly number[]
) {
  for (const [index, column] of columns.entries()) {
    column.style.width = `${Math.max(0, weights[index] ?? 0)}px`;
  }
}

function applyCellWidthTracks(
  table: HTMLTableElement,
  widths: readonly number[]
) {
  for (const row of Array.from(table.rows)) {
    let columnIndex = 0;
    for (const cell of Array.from(row.cells)) {
      const span = Math.max(1, cell.colSpan);
      const width = widths
        .slice(columnIndex, columnIndex + span)
        .reduce((sum, value) => sum + value, 0);
      if (width > 0) {
        cell.style.width = `${width}px`;
      }
      columnIndex += span;
    }
  }
}

/** `stabilizePagedTableColumns` 的可选行为。 */
export interface StabilizePagedTableOptions {
  /**
   * 是否把比可用宽度更宽的表格收进页面（见 `paged-table-fit.ts`）。
   * 默认关闭：只有真正呈现给读者的分页才应当开启，DOCX 路径保持原样。
   */
  fitToAvailableWidth?: boolean;
  /** 宽度测量实现，默认读取真实布局；测试时可注入。 */
  fitMeasurements?: TableFitMeasurements;
}

export function stabilizePagedTableColumns(
  root: ParentNode,
  pageContentHeightPx?: number,
  options: StabilizePagedTableOptions = {}
) {
  let stabilizedCount = 0;
  for (const [tableIndex, table] of Array.from(
    root.querySelectorAll<HTMLTableElement>("table")
  ).entries()) {
    const needsStabilizing =
      table.dataset.stabilizedColumns !== "true" &&
      !table.querySelector(":scope > colgroup");
    // 适配页宽必须先于行高判定：压缩内边距会改变行高，先判定会得到过期的 keepWhole
    const fit =
      options.fitToAvailableWidth && needsStabilizing
        ? fitTableToAvailableWidth(table, options.fitMeasurements)
        : undefined;
    let bodyRowIndex = 0;
    if (pageContentHeightPx && pageContentHeightPx > 0) {
      for (const row of Array.from(table.rows)) {
        const rowHeight = row.getBoundingClientRect().height;
        const keepWhole = rowHeight > 0 && rowHeight <= pageContentHeightPx;
        if (row.parentElement?.tagName === "TBODY") {
          row.dataset.morphdocTableRowId ??=
            `table-${tableIndex + 1}-row-${bodyRowIndex + 1}`;
          row.dataset.morphdocTableRowKeepWhole = String(keepWhole);
          bodyRowIndex += 1;
        }
        for (const cell of Array.from(row.cells)) {
          cell.style.setProperty(
            "break-inside",
            keepWhole ? "avoid" : "auto",
            "important"
          );
          cell.style.setProperty(
            "page-break-inside",
            keepWhole ? "avoid" : "auto",
            "important"
          );
        }
      }
    }
    if (!needsStabilizing) {
      continue;
    }
    const measuredWidths = measuredColumnWidths(table);
    // 压缩内边距后仍超宽：冻结列宽前把各列按比例缩到可用宽度
    const widths =
      fit?.mode === "scaled"
        ? scaleColumnWidthsToFit(measuredWidths, fit.availableWidth)
        : measuredWidths;
    const total = widths.reduce((sum, value) => sum + value, 0);
    if (widths.length === 0 || total <= 0) {
      continue;
    }
    const colgroup = table.ownerDocument.createElement("colgroup");
    colgroup.dataset.stabilizedColumns = "true";
    for (const width of widths) {
      const column = table.ownerDocument.createElement("col");
      column.dataset.stabilizedWidthPx = String(width);
      colgroup.append(column);
    }
    table.insertBefore(colgroup, table.firstChild);
    table.dataset.stabilizedColumns = "true";
    table.style.tableLayout = "fixed";
    const columns = Array.from(colgroup.children) as HTMLTableColElement[];
    let weights = widths;
    applyColumnWidthWeights(columns, weights);
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const measured = measuredColumnWidths(table);
      if (
        measured.length !== widths.length ||
        measured.some((width) => width <= 0)
      ) {
        break;
      }
      weights = weights.map(
        (weight, index) => weight * widths[index]! / measured[index]!
      );
      applyColumnWidthWeights(columns, weights);
    }
    applyCellWidthTracks(table, widths);
    stabilizedCount += 1;
  }
  return stabilizedCount;
}

/**
 * 判断分页后的表格行是否在所在页面区域内可见。
 *
 * 溢出到页面区域之外的行不算真正渲染出来。
 *
 * @param row 分页结果中的表格行
 * @returns 与页面区域有实际交集时返回 `true`
 */
function isVisiblePagedRow(row: HTMLElement) {
  const pageArea = row.closest<HTMLElement>(".pagedjs_area");
  if (!pageArea) {
    return true;
  }
  const rowRect = row.getBoundingClientRect();
  const areaRect = pageArea.getBoundingClientRect();
  const intersectionWidth = Math.min(rowRect.right, areaRect.right) -
    Math.max(rowRect.left, areaRect.left);
  const intersectionHeight = Math.min(rowRect.bottom, areaRect.bottom) -
    Math.max(rowRect.top, areaRect.top);
  return intersectionWidth > 0.5 && intersectionHeight > 0.5;
}

/**
 * 找出在分页结果中被完整重复排版的表格正文行。
 *
 * 判据是同一个行标识下有两个或以上可见实例，且它们的文字内容完全相同。
 * 这对应 Paged.js 把已经排过的内容又排了一遍（例如断点越过整张表格后重新开始）。
 *
 * 两类情形不算重复：
 *
 * - 高度超过一页的行本来就允许被切成多段（`keep-whole` 为 `false`）；
 * - 单元格很高时，Paged.js 可能把整行切成两段，两段文字内容不同，这是
 *   版面上的瑕疵，但不会让输出多出内容，不应让导出失败。
 *
 * @param rendered 分页结果根节点
 * @returns 被完整重复排版的行标识
 */
export function duplicatedPagedTableRowIds(rendered: ParentNode) {
  const textsById = new Map<string, string[]>();
  for (const row of Array.from(
    rendered.querySelectorAll<HTMLElement>(
      '[data-morphdoc-table-row-id][data-morphdoc-table-row-keep-whole="true"]'
    )
  )) {
    const id = row.dataset.morphdocTableRowId;
    if (!id || !isVisiblePagedRow(row)) {
      continue;
    }
    const text = (row.textContent ?? "").replace(/\s+/g, " ").trim();
    textsById.set(id, [...(textsById.get(id) ?? []), text]);
  }
  return Array.from(textsById)
    .filter(([, texts]) => new Set(texts).size < texts.length)
    .map(([id]) => id);
}

export function missingPagedTableRowIds(
  source: ParentNode,
  rendered: ParentNode
) {
  const renderedIds = new Set(
    Array.from(rendered.querySelectorAll<HTMLElement>(
      "[data-morphdoc-table-row-id]"
    )).filter(isVisiblePagedRow)
      .map((row) => row.dataset.morphdocTableRowId)
      .filter((id): id is string => Boolean(id))
  );
  return Array.from(source.querySelectorAll<HTMLTableRowElement>(
    'tbody > tr[data-morphdoc-table-row-id][data-morphdoc-table-row-keep-whole="true"]'
  )).map((row) => row.dataset.morphdocTableRowId)
    .filter((id): id is string => Boolean(id))
    .filter((id) => !renderedIds.has(id));
}

/** 表格行恢复的结果。 */
export interface PagedTableRowRecoveryResult {
  /** 在源文档中定位到的行数。 */
  located: number;
  /** 本次新增了强制分页的行数；此前已经施加过的不重复计数。 */
  added: number;
}

/**
 * 让指定的表格正文行从下一页开始。
 *
 * 通过 `forceBreakBefore` 表达分页意图，由共享 CSS 映射后交给 Paged.js：
 *
 * - 缺失的是整张表的第一行时，表头此前已经排在上一页，应让整张表换页，
 *   否则会留下只有表头的残页；
 * - 其他情形只让该行换页，续页上的表头由 `RepeatTableHeadersHandler`
 *   自动重复。
 *
 * @param source 重新分页所用的源文档
 * @param rowIds 需要换页的行标识（`data-morphdoc-table-row-id`）
 */
export function forcePagedTableRowsToNextPage(
  source: ParentNode,
  rowIds: readonly string[]
): PagedTableRowRecoveryResult {
  const requested = new Set(rowIds);
  const result: PagedTableRowRecoveryResult = { located: 0, added: 0 };
  for (const row of source.querySelectorAll<HTMLTableRowElement>(
    "tbody > tr[data-morphdoc-table-row-id]"
  )) {
    const id = row.dataset.morphdocTableRowId;
    if (!id || !requested.has(id)) {
      continue;
    }
    result.located += 1;
    const table = row.closest<HTMLTableElement>("table");
    const isFirstRowOfTable =
      table !== null && table.querySelector("tbody > tr") === row;
    const target: Element = isFirstRowOfTable ? table : row;
    if (forceBreakBefore(target)) {
      result.added += 1;
    }
    row.dataset.morphdocTableRowRecovery = "true";
  }
  return result;
}

/** 表格正文行丢失不变量的标识。 */
export const TABLE_ROW_MISSING_INVARIANT_ID = "table-row-missing";

/** 表格正文行整行重复不变量的标识。 */
export const TABLE_ROW_DUPLICATED_INVARIANT_ID = "table-row-duplicated";

/**
 * 表格相关的分页不变量。
 *
 * - 整行保持不拆的正文行不得丢失：违反时让缺失的行换页后重排；
 * - 整行保持不拆的正文行不得被完整重复排版：只检测，无法通过换页修复。
 */
export function createTableRowInvariants(): PaginationInvariant[] {
  return [
    {
      id: TABLE_ROW_MISSING_INVARIANT_ID,
      title: "分页后表格正文行缺失",
      detect: ({ source, rendered }) =>
        missingPagedTableRowIds(source, rendered),
      repair: ({ source }, rowIds) => {
        const result = forcePagedTableRowsToNextPage(source, rowIds);
        if (result.located !== rowIds.length) {
          throw new Error(
            `分页表格行恢复标记不完整：缺失 ${rowIds.length} 行，` +
              `仅定位 ${result.located} 行`
          );
        }
        return result.added;
      }
    },
    {
      id: TABLE_ROW_DUPLICATED_INVARIANT_ID,
      title: "分页后表格正文行重复",
      detect: ({ rendered }) => duplicatedPagedTableRowIds(rendered)
    }
  ];
}

export function restorePagedTableStructure(
  sourceTable: HTMLTableElement,
  renderedTable: HTMLTableElement
) {
  restorePagedTableColumns(sourceTable, renderedTable);

  if (!renderedTable.querySelector("thead")) {
    const sourceHeader = sourceTable.querySelector("thead");
    if (sourceHeader) {
      const firstNonColumnGroup = Array.from(renderedTable.children).find(
        (child) => child.tagName !== "COLGROUP"
      ) ?? null;
      renderedTable.insertBefore(
        sourceHeader.cloneNode(true),
        firstNonColumnGroup
      );
    }
  }
}

export function restorePagedTableColumns(
  sourceTable: HTMLTableElement,
  renderedTable: HTMLTableElement
) {
  const sourceGroups = Array.from(
    sourceTable.querySelectorAll<HTMLTableColElement>(
      ":scope > colgroup"
    )
  );
  if (sourceGroups.length === 0) {
    return;
  }
  const renderedGroups = Array.from(
    renderedTable.querySelectorAll<HTMLTableColElement>(
      ":scope > colgroup"
    )
  );
  const matchingStructure =
    renderedGroups.length === sourceGroups.length &&
    renderedGroups.every(
      (group, index) =>
        group.children.length === sourceGroups[index]?.children.length
    );
  if (!matchingStructure) {
    for (const group of renderedGroups) {
      group.remove();
    }
    const firstChild = renderedTable.firstChild;
    for (const group of sourceGroups) {
      renderedTable.insertBefore(group.cloneNode(true), firstChild);
    }
  } else {
    for (const [groupIndex, sourceGroup] of sourceGroups.entries()) {
      const renderedGroup = renderedGroups[groupIndex]!;
      for (const attribute of Array.from(sourceGroup.attributes)) {
        renderedGroup.setAttribute(attribute.name, attribute.value);
      }
      for (const [columnIndex, sourceColumn] of Array.from(
        sourceGroup.children
      ).entries()) {
        const renderedColumn = renderedGroup.children[
          columnIndex
        ] as HTMLTableColElement;
        for (const attribute of Array.from(sourceColumn.attributes)) {
          renderedColumn.setAttribute(attribute.name, attribute.value);
        }
      }
    }
  }
  if (sourceTable.dataset.stabilizedColumns === "true") {
    renderedTable.dataset.stabilizedColumns = "true";
    renderedTable.style.tableLayout = "fixed";
  }
}

function elementAncestors(
  element: Element,
  selector: string
) {
  const ancestors: Element[] = [];
  let current = element.parentElement;

  while (current) {
    if (current.matches(selector)) {
      ancestors.unshift(current);
    }
    current = current.parentElement;
  }

  return ancestors;
}

class RepeatTableHeadersHandler extends Handler {
  declare chunker: PagedChunker;
  private splitTableRefs: string[] = [];

  constructor(
    chunker: unknown,
    polisher: unknown,
    caller: unknown
  ) {
    super(chunker, polisher, caller);
  }

  afterPageLayout(
    pageElement: HTMLElement,
    _page: unknown,
    breakToken?: PagedBreakToken
  ) {
    this.splitTableRefs = [];
    for (const renderedTable of pageElement.querySelectorAll<HTMLTableElement>(
      "table[data-ref]"
    )) {
      const ref = renderedTable.getAttribute("data-ref");
      if (!ref) {
        continue;
      }
      const sourceTable =
        this.chunker.source.querySelector<HTMLTableElement>(
          `table[data-ref="${CSS.escape(ref)}"]`
        );
      if (sourceTable) {
        restorePagedTableColumns(sourceTable, renderedTable);
      }
    }
    const element = resolveBreakTokenElement(breakToken?.node);
    if (!element) {
      return;
    }

    const tables = elementAncestors(element, "table");
    if (element.matches("table")) {
      tables.push(element);
    }

    this.splitTableRefs = Array.from(
      new Set(
        tables
          .map((table) => table.getAttribute("data-ref"))
          .filter((ref): ref is string => Boolean(ref))
      )
    );

    for (const ref of this.splitTableRefs) {
      const renderedTable =
        pageElement.querySelector<HTMLElement>(
          `table[data-ref="${CSS.escape(ref)}"]`
        );
      if (!renderedTable?.querySelector("tbody > tr")) {
        renderedTable?.setAttribute(
          "data-empty-split-table",
          "true"
        );
      }
    }
  }

  layout(rendered: HTMLElement) {
    for (const renderedTable of rendered.querySelectorAll<HTMLTableElement>(
      "table[data-ref]"
    )) {
      const ref = renderedTable.getAttribute("data-ref");
      if (!ref) {
        continue;
      }
      const sourceTable =
        this.chunker.source.querySelector<HTMLTableElement>(
          `table[data-ref="${CSS.escape(ref)}"]`
        );
      if (sourceTable) {
        restorePagedTableColumns(sourceTable, renderedTable);
      }
    }
    for (const ref of this.splitTableRefs) {
      const renderedTable =
        rendered.querySelector<HTMLTableElement>(
          `table[data-ref="${CSS.escape(ref)}"]`
        );
      if (
        !renderedTable ||
        renderedTable.hasAttribute("data-repeated-header")
      ) {
        continue;
      }

      const sourceTable =
        this.chunker.source.querySelector<HTMLTableElement>(
          `table[data-ref="${CSS.escape(ref)}"]`
        );
      if (!sourceTable) {
        continue;
      }

      restorePagedTableStructure(sourceTable, renderedTable);

      renderedTable.setAttribute("data-repeated-header", "true");
    }
  }
}

const handlerRegistration = globalThis as typeof globalThis & {
  __morphDocTableHandlerRegistered?: boolean;
};

if (!handlerRegistration.__morphDocTableHandlerRegistered) {
  registerHandlers(RepeatTableHeadersHandler);
  handlerRegistration.__morphDocTableHandlerRegistered = true;
}

export { RepeatTableHeadersHandler };
