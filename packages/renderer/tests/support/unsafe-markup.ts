/**
 * 在渲染后的 HTML 中查找真实的不安全标记。
 *
 * 渲染器会把原始 HTML 转义为可见文字（`&lt;script&gt;`），因此对原始字符串做正则
 * 匹配会把"被转义的文字"误判为危险内容。这里只解析**真实标签**：转义后正文里不会
 * 再出现字面的 `<`，所以匹配到的每个标签都是浏览器会真正解析的元素。
 */

/** 任何情况下都不应出现在渲染结果中的标签。 */
const forbiddenTags = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "style",
  "link",
  "meta",
  "base",
  "form",
  // SVG 中能引用外部资源或触发行为的元素：渲染器只放行 KaTeX 用到的 svg、path、line
  "use",
  "image",
  "foreignobject",
  "animate",
  "animatemotion",
  "animatetransform",
  "set"
]);

/** 可承载 URL 的属性，其值不得使用可执行协议。 */
const urlAttributes = new Set(["href", "src", "xlink:href", "action", "formaction", "poster"]);

// 属性值可能包含 ">"，因此按引号配对而不是简单匹配到下一个 ">"
const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/gu;
const attributePattern =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gu;

/** 解码数字与常见命名实体，防止用 `&#106;avascript:` 之类的写法绕过检查。 */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/giu, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/gu, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&colon;/giu, ":")
    .replace(/&tab;|&newline;/giu, "")
    .replace(/&amp;/giu, "&");
}

function isExecutableUrl(value: string): boolean {
  // 浏览器解析协议时会忽略 ASCII 空白与控制字符，必须先剔除再比较
  // eslint-disable-next-line no-control-regex
  const normalized = decodeEntities(value).replace(/[\u0000- \u007f]/gu, "").toLowerCase();
  return (
    normalized.startsWith("javascript:") ||
    normalized.startsWith("vbscript:") ||
    normalized.startsWith("data:text/html") ||
    normalized.startsWith("data:application/xhtml")
  );
}

/**
 * 查找渲染结果中的不安全标记。
 *
 * @param html 渲染后的 HTML
 * @returns 问题描述列表，没有问题时为空数组
 */
export function findUnsafeMarkup(html: string): string[] {
  const problems: string[] = [];
  for (const tag of html.matchAll(tagPattern)) {
    const name = (tag[1] ?? "").toLowerCase();
    if (forbiddenTags.has(name)) {
      problems.push(`禁止的标签 <${name}>`);
    }
    for (const attribute of (tag[2] ?? "").matchAll(attributePattern)) {
      const attributeName = (attribute[1] ?? "").toLowerCase();
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
      if (attributeName.startsWith("on")) {
        problems.push(`事件处理属性 ${attributeName}（位于 <${name}>）`);
      }
      if (urlAttributes.has(attributeName) && isExecutableUrl(value)) {
        problems.push(`可执行 URL ${attributeName}="${value.slice(0, 40)}"（位于 <${name}>）`);
      }
    }
  }
  return problems;
}
