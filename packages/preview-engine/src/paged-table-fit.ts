/**
 * 表格适配页宽：分页之前把“比页面内容区更宽”的表格收进页面。
 *
 * ## 背景
 *
 * 列很多的表格（例如 21 列的附录总表），自动布局下每列至少要容纳一个字符加上
 * 单元格内边距，总宽度会超过页面内容区。`stabilizePagedTableColumns` 会把测得
 * 的列宽原样冻结，于是这个水平溢出被带进了 Paged.js：它把水平溢出当成需要分页
 * 的溢出，在单元格文字中间把一整行切成两段（第二段往往只剩 `%)` 之类几个字符），
 * 页数也随之成倍增加。
 *
 * ## 处理
 *
 * “内容宽度不得超过页面内容区”是分页之前的约束，应当在冻结列宽之前满足：
 *
 * 1. 表格没有超宽：不处理，与此前的行为完全一致；
 * 2. 超宽：压缩单元格横向内边距（`compact`），由共享 CSS 按
 *    `data-morphdoc-table-fit` 属性生效，然后重新测量；
 * 3. 压缩后仍超宽：在冻结列宽时把各列按比例缩到页面内容区宽度（`scaled`）。
 *
 * 这只保证“不溢出、不切行”，不保证好看：页面放不下的列数本来就不适合竖排。
 *
 * ## 范围
 *
 * 只用于真正要呈现给读者的分页（预览与 PDF）。DOCX 借用分页布局测量表格几何，
 * 列宽要与 Word 的表格模型对应，不应被改动，因此由运行时选项显式关闭。
 */

/** 标记表格已被适配页宽；取值见 {@link TableFitMode}。 */
export const TABLE_FIT_ATTRIBUTE = "data-morphdoc-table-fit";

/**
 * 适配方式：
 * - `compact`：压缩单元格横向内边距后即可放入页面；
 * - `scaled`：压缩内边距后仍超宽，列宽还需按比例缩小（同样使用压缩的内边距）。
 */
export type TableFitMode = "compact" | "scaled";

/** 判定“超宽”时容忍的亚像素误差。 */
export const TABLE_FIT_TOLERANCE_PX = 0.5;

/** 适配过程需要的两项测量，浏览器实现之外可注入以便测试。 */
export interface TableFitMeasurements {
  /**
   * 表格可用的内容宽度（px）。
   *
   * @returns 无法测量（容器未参与布局等）时返回 0，此时不做任何适配
   */
  availableWidth(table: HTMLTableElement): number;
  /** 表格在当前样式下的实际宽度（px），应包含被裁切的水平溢出。 */
  tableWidth(table: HTMLTableElement): number;
}

function pixels(value: string | undefined) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 基于真实布局的测量：容器内容宽度，以及表格宽度与滚动宽度中较大者。 */
export const browserTableFitMeasurements: TableFitMeasurements = {
  availableWidth(table) {
    const parent = table.parentElement;
    if (!parent) {
      return 0;
    }
    const style = parent.ownerDocument.defaultView?.getComputedStyle(parent);
    const padding =
      pixels(style?.paddingLeft) + pixels(style?.paddingRight);
    return Math.max(0, parent.clientWidth - padding);
  },
  tableWidth(table) {
    // 主题可能把表格设为 display:block + overflow:auto，此时盒子宽度等于容器宽度，
    // 真正的溢出只体现在 scrollWidth 上
    return Math.max(table.getBoundingClientRect().width, table.scrollWidth);
  }
};

/** 适配结果。 */
export interface TableFitResult {
  /** 采用的适配方式；表格没有超宽或无法测量时为 `undefined`。 */
  mode?: TableFitMode;
  /** 测得的可用宽度（px）。 */
  availableWidth: number;
}

/**
 * 判断并施加表格适配：超宽时写入 `data-morphdoc-table-fit` 属性。
 *
 * 属性写入后，调用方需要在冻结列宽之前重新测量列宽，此时内边距已经被压缩。
 *
 * @param table 待检查的表格
 * @param measurements 测量实现，默认读取真实布局
 */
export function fitTableToAvailableWidth(
  table: HTMLTableElement,
  measurements: TableFitMeasurements = browserTableFitMeasurements
): TableFitResult {
  const availableWidth = measurements.availableWidth(table);
  if (!(availableWidth > 0)) {
    return { availableWidth };
  }
  const fits = () =>
    measurements.tableWidth(table) <= availableWidth + TABLE_FIT_TOLERANCE_PX;

  if (fits()) {
    return { availableWidth };
  }
  table.setAttribute(TABLE_FIT_ATTRIBUTE, "compact");
  if (fits()) {
    return { mode: "compact", availableWidth };
  }
  table.setAttribute(TABLE_FIT_ATTRIBUTE, "scaled");
  return { mode: "scaled", availableWidth };
}

/**
 * 把各列宽度按比例缩小到恰好等于可用宽度。
 *
 * 总宽度不超过可用宽度（或可用宽度无效）时原样返回副本，不会放大。
 *
 * @param widths 各列当前宽度（px）
 * @param availableWidth 可用宽度（px）
 */
export function scaleColumnWidthsToFit(
  widths: readonly number[],
  availableWidth: number
): number[] {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (!(availableWidth > 0) || !(total > availableWidth)) {
    return [...widths];
  }
  const factor = availableWidth / total;
  return widths.map((width) => width * factor);
}
