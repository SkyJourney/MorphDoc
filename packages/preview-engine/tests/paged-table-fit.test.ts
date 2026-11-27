// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  TABLE_FIT_ATTRIBUTE,
  TABLE_FIT_TOLERANCE_PX,
  browserTableFitMeasurements,
  fitTableToAvailableWidth,
  scaleColumnWidthsToFit,
  stabilizePagedTableColumns,
  type TableFitMeasurements
} from "../src/index.js";

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);

function rect(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({})
  } as DOMRect;
}

/** 构造一个 N 列、表头加两行正文的表格。 */
function buildTable(columns: number) {
  const cells = (tag: string, label: string) =>
    Array.from(
      { length: columns },
      (_, index) => `<${tag}>${label}${index + 1}</${tag}>`
    ).join("");
  const wrapper = document.createElement("div");
  wrapper.innerHTML =
    `<table><thead><tr>${cells("th", "列")}</tr></thead><tbody>` +
    `<tr>${cells("td", "甲")}</tr><tr>${cells("td", "乙")}</tr>` +
    "</tbody></table>";
  return wrapper.querySelector("table")!;
}

interface FakeLayout {
  /** 自动布局下各列的自然宽度。 */
  natural: number[];
  /** 压缩单元格内边距之后各列的宽度。 */
  compact: number[];
  naturalRowHeight?: number;
  compactRowHeight?: number;
}

/**
 * 布局模拟器：happy-dom 没有布局引擎，这里按表格当前状态给出几何。
 *
 * - 已有冻结的 colgroup 时，列宽取 `<col>` 上的像素值（固定布局的行为）；
 * - 否则按是否带有适配属性，取压缩或自然宽度；行高同理。
 */
function installFakeLayout(table: HTMLTableElement, layout: FakeLayout) {
  const widths = () => {
    const columns = Array.from(
      table.querySelectorAll<HTMLElement>(":scope > colgroup > col")
    );
    if (columns.length > 0) {
      return columns.map((column) => Number.parseFloat(column.style.width));
    }
    return table.hasAttribute(TABLE_FIT_ATTRIBUTE)
      ? layout.compact
      : layout.natural;
  };
  const rowHeight = () =>
    table.hasAttribute(TABLE_FIT_ATTRIBUTE)
      ? (layout.compactRowHeight ?? 40)
      : (layout.naturalRowHeight ?? 40);
  table.getBoundingClientRect = () =>
    rect(0, 0, sum(widths()), rowHeight() * table.rows.length);
  for (const row of Array.from(table.rows)) {
    row.getBoundingClientRect = () => rect(0, 0, sum(widths()), rowHeight());
    for (const [index, cell] of Array.from(row.cells).entries()) {
      cell.getBoundingClientRect = () => {
        const current = widths();
        return rect(
          sum(current.slice(0, index)),
          0,
          current[index]!,
          rowHeight()
        );
      };
    }
  }
}

/** 与布局模拟器配套的测量实现，并记录调用顺序。 */
function measurementsFor(layout: FakeLayout, available: number) {
  const calls: string[] = [];
  const measurements: TableFitMeasurements = {
    availableWidth: () => {
      calls.push("available");
      return available;
    },
    tableWidth: (table) => {
      const state = table.getAttribute(TABLE_FIT_ATTRIBUTE) ?? "none";
      calls.push(`width@${state}`);
      return sum(state === "none" ? layout.natural : layout.compact);
    }
  };
  return { measurements, calls };
}

function columnPixels(table: HTMLTableElement) {
  return Array.from(
    table.querySelectorAll<HTMLElement>(":scope > colgroup > col")
  ).map((column) => Number.parseFloat(column.style.width));
}

describe("按比例缩列", () => {
  it("缩放后总宽恰好等于可用宽度，并保持各列比例", () => {
    const scaled = scaleColumnWidthsToFit([40, 80, 120], 120);

    expect(sum(scaled)).toBeCloseTo(120, 9);
    expect(scaled[1]! / scaled[0]!).toBeCloseTo(2, 9);
    expect(scaled[2]! / scaled[0]!).toBeCloseTo(3, 9);
  });

  it("总宽不超过可用宽度时不放大，返回独立的副本", () => {
    const widths = [30, 40];
    const result = scaleColumnWidthsToFit(widths, 500);

    expect(result).toEqual([30, 40]);
    expect(result).not.toBe(widths);
  });

  it("总宽恰好等于可用宽度时原样返回", () => {
    expect(scaleColumnWidthsToFit([50, 50], 100)).toEqual([50, 50]);
  });

  it.each([0, -10, Number.NaN])(
    "可用宽度无效（%s）时原样返回，避免把列缩成零",
    (available) => {
      expect(scaleColumnWidthsToFit([30, 40], available)).toEqual([30, 40]);
    }
  );

  it("没有列时返回空数组", () => {
    expect(scaleColumnWidthsToFit([], 100)).toEqual([]);
  });
});

describe("表格适配页宽的判定", () => {
  const layout: FakeLayout = { natural: [100, 100, 100], compact: [60, 60, 60] };

  it("没有超宽时不做任何处理，只测量一次表格宽度", () => {
    const table = buildTable(3);
    const { measurements, calls } = measurementsFor(layout, 320);

    const result = fitTableToAvailableWidth(table, measurements);

    expect(result).toEqual({ availableWidth: 320 });
    expect(table.hasAttribute(TABLE_FIT_ATTRIBUTE)).toBe(false);
    expect(calls).toEqual(["available", "width@none"]);
  });

  it("超宽但压缩内边距后放得下：标记为 compact", () => {
    const table = buildTable(3);
    const { measurements } = measurementsFor(layout, 200);

    const result = fitTableToAvailableWidth(table, measurements);

    expect(result.mode).toBe("compact");
    expect(table.getAttribute(TABLE_FIT_ATTRIBUTE)).toBe("compact");
  });

  it("压缩内边距后仍超宽：升级为 scaled，属性同步更新", () => {
    const table = buildTable(3);
    const { measurements } = measurementsFor(layout, 120);

    const result = fitTableToAvailableWidth(table, measurements);

    expect(result).toEqual({ mode: "scaled", availableWidth: 120 });
    expect(table.getAttribute(TABLE_FIT_ATTRIBUTE)).toBe("scaled");
  });

  it("先测自然宽度，再在写入属性之后测压缩宽度，顺序不能颠倒", () => {
    const table = buildTable(3);
    const { measurements, calls } = measurementsFor(layout, 200);

    fitTableToAvailableWidth(table, measurements);

    expect(calls).toEqual(["available", "width@none", "width@compact"]);
  });

  it("超出可用宽度的亚像素误差在容差之内，视为放得下", () => {
    const table = buildTable(2);
    const fake: TableFitMeasurements = {
      availableWidth: () => 200,
      tableWidth: () => 200 + TABLE_FIT_TOLERANCE_PX
    };

    expect(fitTableToAvailableWidth(table, fake).mode).toBeUndefined();
    expect(table.hasAttribute(TABLE_FIT_ATTRIBUTE)).toBe(false);
  });

  it("刚好超过容差即判为超宽", () => {
    const table = buildTable(2);
    const fake: TableFitMeasurements = {
      availableWidth: () => 200,
      tableWidth: (target) =>
        target.hasAttribute(TABLE_FIT_ATTRIBUTE)
          ? 200 + TABLE_FIT_TOLERANCE_PX / 2
          : 200 + TABLE_FIT_TOLERANCE_PX + 0.1
    };

    expect(fitTableToAvailableWidth(table, fake).mode).toBe("compact");
  });

  it.each([0, -5, Number.NaN])(
    "可用宽度无法测量（%s）时不处理，也不去测表格宽度",
    (available) => {
      const table = buildTable(2);
      const fake: TableFitMeasurements = {
        availableWidth: () => available,
        tableWidth: () => {
          throw new Error("不应测量表格宽度");
        }
      };

      expect(fitTableToAvailableWidth(table, fake).mode).toBeUndefined();
      expect(table.hasAttribute(TABLE_FIT_ATTRIBUTE)).toBe(false);
    }
  );
});

describe("浏览器测量实现", () => {
  it("容器尚未参与布局时可用宽度为 0，默认实现因此不会误处理", () => {
    const table = buildTable(2);
    document.body.append(table);

    expect(browserTableFitMeasurements.availableWidth(table)).toBe(0);
    expect(fitTableToAvailableWidth(table).mode).toBeUndefined();
    table.remove();
  });

  it("没有父容器时可用宽度为 0", () => {
    const orphan = document.createElement("table");

    expect(browserTableFitMeasurements.availableWidth(orphan)).toBe(0);
  });

  it("可用宽度是容器内容宽度，要扣除左右内边距", () => {
    const container = document.createElement("div");
    container.style.paddingLeft = "10px";
    container.style.paddingRight = "30px";
    Object.defineProperty(container, "clientWidth", { value: 600 });
    const table = document.createElement("table");
    container.append(table);
    document.body.append(container);

    expect(browserTableFitMeasurements.availableWidth(table)).toBe(560);
    container.remove();
  });

  it("表格宽度取盒子宽度与滚动宽度中较大者：block + overflow 的表格溢出只体现在 scrollWidth", () => {
    const table = document.createElement("table");
    table.getBoundingClientRect = () => rect(0, 0, 500, 40);
    Object.defineProperty(table, "scrollWidth", { value: 720, configurable: true });

    expect(browserTableFitMeasurements.tableWidth(table)).toBe(720);

    Object.defineProperty(table, "scrollWidth", { value: 300, configurable: true });
    expect(browserTableFitMeasurements.tableWidth(table)).toBe(500);
  });
});

describe("冻结列宽时适配页宽", () => {
  const wide: FakeLayout = {
    natural: [100, 100, 100, 100],
    compact: [60, 60, 60, 60],
    naturalRowHeight: 40,
    compactRowHeight: 40
  };

  function stabilize(
    table: HTMLTableElement,
    layout: FakeLayout,
    available: number,
    fit: boolean | undefined,
    pageHeight?: number
  ) {
    installFakeLayout(table, layout);
    const { measurements } = measurementsFor(layout, available);
    stabilizePagedTableColumns(
      table.parentElement!,
      pageHeight,
      fit === undefined
        ? undefined
        : { fitToAvailableWidth: fit, fitMeasurements: measurements }
    );
  }

  it("默认不适配：超宽表格保持原有行为（DOCX 路径依赖这一点）", () => {
    const table = buildTable(4);
    stabilize(table, wide, 200, undefined);

    expect(table.hasAttribute(TABLE_FIT_ATTRIBUTE)).toBe(false);
    expect(columnPixels(table)).toEqual([100, 100, 100, 100]);
  });

  it("显式关闭与默认等价", () => {
    const table = buildTable(4);
    stabilize(table, wide, 200, false);

    expect(table.hasAttribute(TABLE_FIT_ATTRIBUTE)).toBe(false);
    expect(columnPixels(table)).toEqual([100, 100, 100, 100]);
  });

  it("开启但没有超宽：产出与关闭时逐字相同，现有文档不受影响", () => {
    const off = buildTable(4);
    const on = buildTable(4);
    stabilize(off, wide, 1000, false);
    stabilize(on, wide, 1000, true);

    expect(on.outerHTML).toBe(off.outerHTML);
    expect(on.hasAttribute(TABLE_FIT_ATTRIBUTE)).toBe(false);
  });

  it("压缩内边距即可放下：用压缩后的列宽冻结，总宽不超过可用宽度", () => {
    const table = buildTable(4);
    stabilize(table, wide, 300, true);

    expect(table.getAttribute(TABLE_FIT_ATTRIBUTE)).toBe("compact");
    expect(columnPixels(table)).toEqual([60, 60, 60, 60]);
    expect(sum(columnPixels(table))).toBeLessThanOrEqual(300);
    expect(table.dataset.stabilizedColumns).toBe("true");
    expect(table.style.tableLayout).toBe("fixed");
  });

  it("压缩后仍超宽：把列宽按比例缩到恰好等于可用宽度", () => {
    const uneven: FakeLayout = {
      natural: [100, 200, 300, 400],
      compact: [50, 100, 150, 200]
    };
    const table = buildTable(4);
    stabilize(table, uneven, 250, true);

    expect(table.getAttribute(TABLE_FIT_ATTRIBUTE)).toBe("scaled");
    const columns = columnPixels(table);
    expect(sum(columns)).toBeCloseTo(250, 6);
    // 比例保持 1:2:3:4
    expect(columns[1]! / columns[0]!).toBeCloseTo(2, 6);
    expect(columns[3]! / columns[0]!).toBeCloseTo(4, 6);
  });

  it("单元格宽度与冻结的列宽一致，跨页续表据此还原", () => {
    const table = buildTable(4);
    stabilize(table, wide, 200, true);

    const cellWidths = Array.from(table.rows[1]!.cells).map((cell) =>
      Number.parseFloat(cell.style.width)
    );
    expect(cellWidths).toEqual(columnPixels(table));
  });

  it("行高判定发生在适配之后：压缩后一页能放下的行必须标记为整行保持", () => {
    // 自然布局下每行 1200px（高于页面 1000px），压缩后只有 800px
    const tallWhenWide: FakeLayout = {
      natural: [100, 100, 100, 100],
      compact: [60, 60, 60, 60],
      naturalRowHeight: 1200,
      compactRowHeight: 800
    };
    const fitted = buildTable(4);
    const unfitted = buildTable(4);
    stabilize(fitted, tallWhenWide, 300, true, 1000);
    stabilize(unfitted, tallWhenWide, 300, false, 1000);

    const keepWhole = (table: HTMLTableElement) =>
      Array.from(table.querySelectorAll<HTMLElement>("tbody > tr")).map(
        (row) => row.dataset.morphdocTableRowKeepWhole
      );
    expect(keepWhole(fitted)).toEqual(["true", "true"]);
    expect(keepWhole(unfitted)).toEqual(["false", "false"]);
  });

  it("作者已给出列宽（带 colgroup）的表格不处理，也不去测量", () => {
    const table = buildTable(4);
    table.insertBefore(
      document.createElement("colgroup"),
      table.firstChild
    );
    installFakeLayout(table, wide);
    const fake: TableFitMeasurements = {
      availableWidth: () => {
        throw new Error("不应测量带 colgroup 的表格");
      },
      tableWidth: () => {
        throw new Error("不应测量带 colgroup 的表格");
      }
    };

    stabilizePagedTableColumns(table.parentElement!, undefined, {
      fitToAvailableWidth: true,
      fitMeasurements: fake
    });

    expect(table.hasAttribute(TABLE_FIT_ATTRIBUTE)).toBe(false);
  });

  it("已经冻结过的表格不会再次适配，重复调用是幂等的", () => {
    const table = buildTable(4);
    stabilize(table, wide, 200, true);
    const once = table.outerHTML;

    stabilize(table, wide, 200, true);

    expect(table.outerHTML).toBe(once);
  });

  it("同一文档里多个表格各自独立判定", () => {
    const container = document.createElement("div");
    const narrow = buildTable(2);
    const broad = buildTable(4);
    container.append(narrow, broad);
    const narrowLayout: FakeLayout = { natural: [50, 50], compact: [30, 30] };
    installFakeLayout(narrow, narrowLayout);
    installFakeLayout(broad, wide);
    stabilizePagedTableColumns(container, undefined, {
      fitToAvailableWidth: true,
      fitMeasurements: {
        availableWidth: () => 150,
        tableWidth: (table) => {
          const layout = table === narrow ? narrowLayout : wide;
          return sum(
            table.hasAttribute(TABLE_FIT_ATTRIBUTE)
              ? layout.compact
              : layout.natural
          );
        }
      }
    });

    expect(narrow.hasAttribute(TABLE_FIT_ATTRIBUTE)).toBe(false);
    expect(columnPixels(narrow)).toEqual([50, 50]);
    expect(broad.getAttribute(TABLE_FIT_ATTRIBUTE)).toBe("scaled");
    expect(sum(columnPixels(broad))).toBeCloseTo(150, 6);
  });
});
