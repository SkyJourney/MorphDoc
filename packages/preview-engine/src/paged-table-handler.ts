import { Handler, registerHandlers } from "pagedjs";
import { resolveBreakTokenElement } from "./paged-break-token.js";

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

export function stabilizePagedTableColumns(
  root: ParentNode,
  pageContentHeightPx?: number
) {
  let stabilizedCount = 0;
  for (const [tableIndex, table] of Array.from(
    root.querySelectorAll<HTMLTableElement>("table")
  ).entries()) {
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
    if (
      table.dataset.stabilizedColumns === "true" ||
      table.querySelector(":scope > colgroup")
    ) {
      continue;
    }
    const widths = measuredColumnWidths(table);
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

export function missingPagedTableRowIds(
  source: ParentNode,
  rendered: ParentNode
) {
  const isVisiblePagedRow = (row: HTMLElement) => {
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
  };
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

function splitPagedTableBeforeRow(row: HTMLTableRowElement) {
  const body = row.parentElement as HTMLTableSectionElement | null;
  const table = row.closest<HTMLTableElement>("table");
  if (
    !body ||
    body.tagName !== "TBODY" ||
    !table ||
    body.querySelector(":scope > tr") === row
  ) {
    return table;
  }

  const continuation = table.cloneNode(false) as HTMLTableElement;
  continuation.dataset.morphdocTableRecoveryContinuation = "true";
  for (const child of Array.from(table.children)) {
    if (child.tagName === "COLGROUP" || child.tagName === "THEAD") {
      continuation.append(child.cloneNode(true));
    }
  }

  const continuationBody = body.cloneNode(false) as HTMLTableSectionElement;
  let movingRow: HTMLTableRowElement | null = row;
  while (movingRow) {
    const nextRow = movingRow.nextElementSibling as HTMLTableRowElement | null;
    continuationBody.append(movingRow);
    movingRow = nextRow;
  }
  continuation.append(continuationBody);

  let followingSection = body.nextElementSibling;
  while (followingSection) {
    const nextSection = followingSection.nextElementSibling;
    continuation.append(followingSection);
    followingSection = nextSection;
  }
  table.after(continuation);
  return continuation;
}

export function forcePagedTableRowsToNextPage(
  source: ParentNode,
  rowIds: readonly string[]
) {
  const requested = new Set(rowIds);
  let count = 0;
  for (const row of source.querySelectorAll<HTMLTableRowElement>(
    "tbody > tr[data-morphdoc-table-row-id]"
  )) {
    const id = row.dataset.morphdocTableRowId;
    if (!id || !requested.has(id)) {
      continue;
    }
    const table = splitPagedTableBeforeRow(row);
    let recoveryTarget: HTMLElement = row;
    if (table?.parentNode) {
      const previous = table.previousElementSibling as HTMLElement | null;
      const marker = previous?.dataset.morphdocTableRecoveryMarker === "true"
        ? previous
        : table.ownerDocument.createElement("div");
      if (marker !== previous) {
        marker.dataset.morphdocTableRecoveryMarker = "true";
        marker.setAttribute("aria-hidden", "true");
        marker.textContent = "\u00a0";
        marker.style.setProperty("height", "1px", "important");
        marker.style.setProperty("line-height", "1px", "important");
        marker.style.setProperty("margin", "0 0 -1px", "important");
        marker.style.setProperty("padding", "0", "important");
        marker.style.setProperty("border", "0", "important");
        marker.style.setProperty("overflow", "hidden", "important");
        marker.style.setProperty("opacity", "0", "important");
        table.parentNode.insertBefore(marker, table);
      }
      recoveryTarget = marker;
      table.dataset.morphdocTableRecovery = "true";
    }
    recoveryTarget.style.setProperty("break-before", "page", "important");
    recoveryTarget.style.setProperty(
      "page-break-before",
      "always",
      "important"
    );
    row.dataset.morphdocTableRowRecovery = "true";
    count += 1;
  }
  return count;
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
