import { Handler, registerHandlers } from "pagedjs";

/**
 * Paged.js 内置的 `UndisplayedFilter` 有一条过于宽泛的规则：凡是带内联
 * `style` 属性、且内联 `display` 不是其他取值的元素，都会被标记为
 * `data-undisplayed`，等同于“不显示”。
 *
 * 被标记的元素会被 `displayedElementAfter()` 等函数跳过，后果是：
 *
 * - 标题的 `break-after: avoid` 会把 `data-previous-break-after` 写到被
 *   跳过元素“之后”的节点上；
 * - 之后一旦那个节点放不下，Paged.js 按“前一个节点”回退，会越过被标记的
 *   元素，把整张表格甚至整块内容推到下一页，留下空页、重复行或标题孤立。
 *
 * 本项目为了稳定分页，会给表格、单元格、图片和各类分页辅助节点写内联
 * `style`，因此必须让内置过滤器“看不到”这些仅因带 `style` 而被误判的
 * 元素，同时保持真正的 `display: none` 仍被标记。
 *
 * 做法：在内置过滤器运行之前（`beforeParsed`）把内联 `style` 暂存到自定义
 * 属性，在内置过滤器运行之后（`filter`，自定义处理器必然排在内置处理器
 * 之后）原样还原。两步之间内置过滤器看不到这些元素的内联样式，也就不会
 * 误标；而 CSS 规则声明的 `display: none` 与内联 `display: none` 不受影响。
 */
export const INLINE_STYLE_STASH_ATTRIBUTE = "data-morphdoc-inline-style";

type StyledElement = Element & ElementCSSInlineStyle;

/**
 * 判断元素内联样式是否显式隐藏了自身。
 *
 * @param element 带内联样式的元素
 * @returns 内联 `display` 为 `none` 时返回 `true`
 */
function hidesItself(element: StyledElement) {
  return element.style?.display === "none";
}

/**
 * 还原此前暂存的内联样式，并删除暂存属性。
 *
 * 可重复调用；上一次分页中途失败而残留的暂存属性也会在此被还原。
 *
 * @param root 需要处理的根节点（文档片段或元素）
 * @returns 被还原的元素数量
 */
export function restoreStashedInlineStyles(root: ParentNode) {
  let restored = 0;
  for (const element of Array.from(
    root.querySelectorAll(`[${INLINE_STYLE_STASH_ATTRIBUTE}]`)
  )) {
    const stashed = element.getAttribute(INLINE_STYLE_STASH_ATTRIBUTE);
    element.removeAttribute(INLINE_STYLE_STASH_ATTRIBUTE);
    if (stashed !== null) {
      element.setAttribute("style", stashed);
      restored += 1;
    }
  }
  return restored;
}

/**
 * 暂存内联样式，使内置 `UndisplayedFilter` 不再因为 `style` 属性而误判。
 *
 * 内联 `display: none` 的元素保持原样，继续由内置过滤器正确标记。
 *
 * @param root 需要处理的根节点（文档片段或元素）
 * @returns 被暂存的元素数量
 */
export function stashInlineStylesForPaged(root: ParentNode) {
  // 先清理上一次异常中断可能残留的暂存，避免样式丢失
  restoreStashedInlineStyles(root);

  let stashed = 0;
  for (const element of Array.from(
    root.querySelectorAll<StyledElement>("[style]")
  )) {
    if (hidesItself(element)) {
      continue;
    }
    element.setAttribute(
      INLINE_STYLE_STASH_ATTRIBUTE,
      element.getAttribute("style") ?? ""
    );
    element.removeAttribute("style");
    stashed += 1;
  }
  return stashed;
}

/**
 * Paged.js 处理器：避免内联样式被内置过滤器误判为“不显示”。
 *
 * - `beforeParsed`：在内置过滤器运行前暂存内联样式；
 * - `filter`：在内置过滤器运行后还原内联样式。
 */
class InlineStyleVisibilityHandler extends Handler {
  constructor(
    chunker: unknown,
    polisher: unknown,
    caller: unknown
  ) {
    super(chunker, polisher, caller);
  }

  beforeParsed(content: ParentNode) {
    stashInlineStylesForPaged(content);
  }

  filter(content: ParentNode) {
    restoreStashedInlineStyles(content);
  }
}

const handlerRegistration = globalThis as typeof globalThis & {
  __morphDocInlineStyleGuardRegistered?: boolean;
};

if (!handlerRegistration.__morphDocInlineStyleGuardRegistered) {
  registerHandlers(InlineStyleVisibilityHandler);
  handlerRegistration.__morphDocInlineStyleGuardRegistered = true;
}

export { InlineStyleVisibilityHandler };
