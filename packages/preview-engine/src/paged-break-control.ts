/**
 * 分页意图：强制分页的统一表达。
 *
 * ## 背景
 *
 * Paged.js 只从 **CSS 规则**中解析 `break-before` / `break-after`，并据此生成它
 * 内部使用的 `data-break-before` 等属性；元素上的**内联样式**会被完全忽略。
 * 实测在两个段落之间插入 `style="break-before: page !important"` 的节点，页数
 * 不变；改用 CSS 规则选中的属性后则正确换页（包括表格行之间，表头自动重复）。
 *
 * 因此模块里各自 `element.style.setProperty("break-before", "page")` 的写法
 * 实际上没有任何分页效果。本模块把“我要在这里强制分页”收敛成唯一的表达：
 *
 * 1. **意图**：调用 `forceBreakBefore` / `forceBreakAfter`，在元素上写语义属性；
 * 2. **映射**：`pagedBreakControlCss` 把语义属性映射成 `break-*` 声明，随样式表
 *    交给 Paged.js，由 Paged.js 自己的 CSS 解析生成分页数据。
 *
 * 这与封面的 `data-semantic-break-after` 规则是同一种已被验证的模式。
 *
 * ## 为什么不直接写 Paged.js 的内部属性
 *
 * `break-after` 需要同步标记“下一个显示的元素”，并跳过被隐藏的元素；这些规则
 * 属于 Paged.js 的内部实现。交给它自己的 CSS 解析处理，可以避免复刻这些细节，
 * 也不会随 Paged.js 升级而失效。
 *
 * 文档首个元素之前的强制分页、文档最后一个元素之后的强制分页，都不会产生空白页。
 */

/** 在目标元素之前强制分页的语义属性。 */
export const FORCE_BREAK_BEFORE_ATTRIBUTE = "data-morphdoc-break-before";

/** 在目标元素之后强制分页的语义属性。 */
export const FORCE_BREAK_AFTER_ATTRIBUTE = "data-morphdoc-break-after";

/** 当前只支持整页分页。 */
const FORCED_BREAK_VALUE = "page";

/** 强制分页的位置。 */
export type ForcedBreakPosition = "before" | "after";

function attributeOf(position: ForcedBreakPosition) {
  return position === "before"
    ? FORCE_BREAK_BEFORE_ATTRIBUTE
    : FORCE_BREAK_AFTER_ATTRIBUTE;
}

/**
 * 在元素之前强制分页。
 *
 * 重复调用是幂等的。
 *
 * @param element 需要从新页开始的元素
 * @returns 本次调用是否新增了强制分页（已存在时返回 `false`）
 */
export function forceBreakBefore(element: Element) {
  return setForcedBreak(element, "before");
}

/**
 * 在元素之后强制分页。
 *
 * 重复调用是幂等的。
 *
 * @param element 其后需要换页的元素
 * @returns 本次调用是否新增了强制分页（已存在时返回 `false`）
 */
export function forceBreakAfter(element: Element) {
  return setForcedBreak(element, "after");
}

function setForcedBreak(
  element: Element,
  position: ForcedBreakPosition
) {
  const attribute = attributeOf(position);
  if (element.getAttribute(attribute) === FORCED_BREAK_VALUE) {
    return false;
  }
  element.setAttribute(attribute, FORCED_BREAK_VALUE);
  return true;
}

/**
 * 判断元素是否已声明强制分页。
 *
 * @param element 待检查的元素
 * @param position 强制分页的位置
 */
export function hasForcedBreak(
  element: Element,
  position: ForcedBreakPosition
) {
  return element.getAttribute(attributeOf(position)) === FORCED_BREAK_VALUE;
}

/**
 * 取消元素上已声明的强制分页。
 *
 * @param element 目标元素
 * @param position 强制分页的位置
 * @returns 取消前是否存在该声明
 */
export function clearForcedBreak(
  element: Element,
  position: ForcedBreakPosition
) {
  const existed = hasForcedBreak(element, position);
  element.removeAttribute(attributeOf(position));
  return existed;
}

/**
 * 把分页意图映射为 Paged.js 能识别的 CSS 规则。
 *
 * 必须随样式表一起交给 Paged.js；Paged.js 解析后会把这些声明从输出样式中移除，
 * 因此不会在已经分好页的内容上再次触发浏览器自身的分页。
 */
export const pagedBreakControlCss = `
[${FORCE_BREAK_BEFORE_ATTRIBUTE}="${FORCED_BREAK_VALUE}"] {
  break-before: ${FORCED_BREAK_VALUE};
  page-break-before: always;
}

[${FORCE_BREAK_AFTER_ATTRIBUTE}="${FORCED_BREAK_VALUE}"] {
  break-after: ${FORCED_BREAK_VALUE};
  page-break-after: always;
}
`;
