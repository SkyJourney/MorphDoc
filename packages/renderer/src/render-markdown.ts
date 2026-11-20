import { anchor } from "@mdit/plugin-anchor";
import { footnote } from "@mdit/plugin-footnote";
import { katex } from "@mdit/plugin-katex";
import { tasklist } from "@mdit/plugin-tasklist";
import type {
  DocumentProfile,
  MarkdownDocumentMetadata,
  RenderedMarkdownDocument,
  ThemeFeature
} from "@morphdoc/core";
import {
  classifyDocumentLink,
  documentProfileSchema,
  isSafeDocumentLink
} from "@morphdoc/core";
import { createSemanticDocumentModel } from "@morphdoc/semantic-document";
import {
  markdownItECharts,
  type MarkdownItEChartsErrorContext
} from "@morphdoc/markdown-echarts";
import matter from "gray-matter";
import hljs from "highlight.js";
import MarkdownIt from "markdown-it";
import type { Options as MarkdownItOptions } from "markdown-it";
import type Renderer from "markdown-it/lib/renderer.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import type Token from "markdown-it/lib/token.mjs";
import sanitizeHtml from "sanitize-html";
import { renderDocumentStructure } from "./render-document-structure.js";

export const RENDERER_VERSION = 1;

export class MarkdownDocumentParseError extends Error {
  readonly code = "INVALID_FRONT_MATTER";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MarkdownDocumentParseError";
  }
}

export type { MarkdownDocumentMetadata } from "@morphdoc/core";

export interface RenderMarkdownOptions {
  language?: string;
  imageSourceMap?: ReadonlyMap<string, string>;
  warnings?: readonly string[];
}

export interface RenderedMarkdown
  extends Omit<RenderedMarkdownDocument, "rendererVersion"> {
  rendererVersion: typeof RENDERER_VERSION;
  markdownBody: string;
}

const markdownOptions: MarkdownItOptions = {
  html: false,
  breaks: false,
  linkify: true,
  typographer: false,
  highlight(code, language) {
    const normalizedLanguage = language.trim().toLowerCase();

    if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
      return hljs.highlight(code, {
        language: normalizedLanguage,
        ignoreIllegals: true
      }).value;
    }

    return MarkdownIt().utils.escapeHtml(code);
  }
};

const markdown = new MarkdownIt(markdownOptions)
  .use(anchor, {
    level: 1,
    uniqueSlugStartIndex: 2,
    tabIndex: false
  })
  .use(footnote)
  .use(tasklist, {
    disabled: true,
    label: true,
    containerClass: "contains-task-list",
    itemClass: "md-task-list-item",
    checkboxClass: "task-list-item-checkbox",
    labelClass: "task-list-item-label"
  })
  .use(katex, {
    delimiters: "all",
    output: "html",
    throwOnError: false,
    strict: "warn",
    trust: false
  });

const tableBreakMarkupPattern = /^(?:<br>|<br\/>|<br \/>)/iu;

function tableBreakCandidateRule(
  state: StateInline,
  silent: boolean
): boolean {
  const match = state.src.slice(state.pos).match(tableBreakMarkupPattern);
  if (!match) {
    return false;
  }
  if (!silent) {
    const token = state.push("table_break_candidate", "", 0);
    token.content = match[0];
  }
  state.pos += match[0].length;
  return true;
}

markdown.inline.ruler.before(
  "html_inline",
  "table_break_candidate",
  tableBreakCandidateRule
);
markdown.core.ruler.after("inline", "scope_table_breaks", (state) => {
  let tableCellDepth = 0;
  for (const token of state.tokens) {
    if (token.type === "td_open" || token.type === "th_open") {
      tableCellDepth += 1;
      continue;
    }
    if (token.type === "td_close" || token.type === "th_close") {
      tableCellDepth = Math.max(0, tableCellDepth - 1);
      continue;
    }
    if (token.type !== "inline") {
      continue;
    }
    for (const child of token.children ?? []) {
      if (child.type === "table_break_candidate" && tableCellDepth > 0) {
        child.type = "table_break";
      }
    }
  }
});
markdown.renderer.rules.table_break_candidate = (tokens, index) =>
  markdown.utils.escapeHtml(tokens[index]?.content ?? "");
markdown.renderer.rules.table_break = () => "<br>";

const markdownAlertTitles = new Map([
  ["note", "Note"],
  ["tip", "Tip"],
  ["important", "Important"],
  ["warning", "Warning"],
  ["caution", "Caution"]
]);

markdown.core.ruler.after("scope_table_breaks", "github_alerts", (state) => {
  for (let index = 0; index < state.tokens.length - 2; index += 1) {
    const blockquote = state.tokens[index];
    const paragraph = state.tokens[index + 1];
    const inline = state.tokens[index + 2];
    if (
      blockquote?.type !== "blockquote_open" ||
      paragraph?.type !== "paragraph_open" ||
      inline?.type !== "inline"
    ) {
      continue;
    }
    const [marker, bodyBreak] = inline.children ?? [];
    const match = marker?.type === "text"
      ? marker.content.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/iu)
      : undefined;
    if (!marker || !match) {
      continue;
    }
    const alertType = match[1]?.toLowerCase();
    const title = alertType ? markdownAlertTitles.get(alertType) : undefined;
    if (!alertType || !title) {
      continue;
    }
    blockquote.attrJoin("class", `md-alert md-alert-${alertType}`);
    marker.type = "markdown_alert_title";
    marker.content = title;
    marker.meta = { alertType };
    if (bodyBreak?.type === "softbreak") {
      bodyBreak.type = "markdown_alert_body_break";
    }
  }
});
markdown.renderer.rules.markdown_alert_title = (tokens, index) => {
  const token = tokens[index];
  const alertType = typeof token?.meta?.alertType === "string"
    ? token.meta.alertType
    : "note";
  return `<span class="md-alert-text md-alert-text-${escapeAttribute(alertType)}">${markdown.utils.escapeHtml(token?.content ?? "")}</span>`;
};
markdown.renderer.rules.markdown_alert_body_break = () => "</p>\n<p>";

const defaultValidateLink = markdown.validateLink.bind(markdown);
markdown.validateLink = (href) =>
  defaultValidateLink(href) ||
  classifyDocumentLink(href).scheme === "file";

const defaultFenceRenderer = markdown.renderer.rules.fence;
const defaultImageRenderer = markdown.renderer.rules.image;
const defaultParagraphOpenRenderer =
  markdown.renderer.rules.paragraph_open;
const defaultParagraphCloseRenderer =
  markdown.renderer.rules.paragraph_close;
const lengthStylePattern = /^-?\d+(?:\.\d+)?(?:em|ex|px|%)$/u;
const tableTextAlignStylePattern = /^(?:left|center|right)$/u;

interface MarkdownRenderEnvironment {
  warnings?: string[];
  imageSourceMap?: ReadonlyMap<string, string>;
  standaloneImage?: boolean;
}

function getStandaloneImage(
  token: Token | undefined
): Token | undefined {
  if (token?.type !== "inline") {
    return undefined;
  }
  const meaningful = (token.children ?? []).filter(
    (child) =>
      child.type !== "text" || child.content.trim().length > 0
  );
  return meaningful.length === 1 && meaningful[0]?.type === "image"
    ? meaningful[0]
    : undefined;
}

markdown.renderer.rules.paragraph_open = (
  tokens,
  index,
  options,
  environment,
  renderer
) => {
  const standaloneImage = getStandaloneImage(tokens[index + 1]);
  (environment as MarkdownRenderEnvironment).standaloneImage =
    Boolean(standaloneImage);
  if (standaloneImage) {
    return '<figure class="md-document-image-block">\n';
  }
  const inlineToken = tokens[index + 1];
  if (
    inlineToken?.type === "inline" &&
    (inlineToken.children ?? []).some((child) => child.type === "code_inline")
  ) {
    tokens[index]?.attrJoin("class", "md-inline-code-paragraph");
  }
  return defaultParagraphOpenRenderer
    ? defaultParagraphOpenRenderer(
        tokens,
        index,
        options,
        environment,
        renderer
      )
    : renderer.renderToken(tokens, index, options);
};

markdown.renderer.rules.paragraph_close = (
  tokens,
  index,
  options,
  environment,
  renderer
) => {
  const renderEnvironment =
    environment as MarkdownRenderEnvironment;
  if (renderEnvironment.standaloneImage) {
    renderEnvironment.standaloneImage = false;
    return "</figure>\n";
  }
  return defaultParagraphCloseRenderer
    ? defaultParagraphCloseRenderer(
        tokens,
        index,
        options,
        environment,
        renderer
      )
    : renderer.renderToken(tokens, index, options);
};

markdown.renderer.rules.fence = (
  tokens,
  index,
  options,
  environment,
  renderer
) => {
  const token = tokens[index];
  const language = token?.info.trim().split(/\s+/u)[0]?.toLowerCase();

  if (token && language === "mermaid") {
    return `<div class="mermaid" data-mermaid-pending="true">${markdown.utils.escapeHtml(token.content)}</div>\n`;
  }

  if (defaultFenceRenderer) {
    const renderedFence = defaultFenceRenderer(
      tokens,
      index,
      options,
      environment,
      renderer
    );
    const languageAttribute = language
      ? ` lang="${escapeAttribute(language)}"`
      : "";

    return renderedFence.replace(
      /^<pre>/u,
      `<pre class="md-fences"${languageAttribute}>`
    );
  }

  return renderFallbackFence(tokens, index, renderer);
};

markdown.renderer.rules.image = (
  tokens,
  index,
  options,
  environment,
  renderer
) => {
  const token = tokens[index];
  const renderEnvironment =
    environment as MarkdownRenderEnvironment;
  const imageSourceMap = renderEnvironment.imageSourceMap;
  const source = token?.attrGet("src");
  const resolvedSource = source
    ? imageSourceMap?.get(source)
    : undefined;
  if (token) {
    if (resolvedSource) {
      token.attrSet("src", resolvedSource);
    }
    token.attrJoin("class", "md-document-image");
  }

  const imageHtml = defaultImageRenderer
    ? defaultImageRenderer(
      tokens,
      index,
      options,
      environment,
      renderer
    )
    : renderer.renderToken(tokens, index, options);
  if (renderEnvironment.standaloneImage && token) {
    return (
      imageHtml +
      `<figcaption class="md-document-image-caption">${markdown.utils.escapeHtml(token.content)}</figcaption>`
    );
  }
  return imageHtml;
};

markdown.use(markdownItECharts, {
  onError(error, context: MarkdownItEChartsErrorContext) {
    const environment = context.environment as
      | { warnings?: string[] }
      | undefined;
    environment?.warnings?.push(
      `ECharts 图表配置无效：${error.message}`
    );
  }
});

const safeHtmlOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    "article",
    "div",
    "figure",
    "figcaption",
    "img",
    "input",
    "mark",
    "section",
    "span",
    "sub",
    "summary",
    "sup",
    // KaTeX 用内联 SVG 绘制根号、可拉伸箭头、宽重音符、上下括号和划线。
    // 只放行它实际产生的三种图形标签；use、image、foreignObject、animate、
    // script、style 等能引用外部资源或执行行为的标签一律不在白名单内。
    "svg",
    "path",
    "line"
  ],
  allowedAttributes: {
    "*": ["class", "id", "title", "aria-*", "role"],
    a: ["href", "name", "target", "rel"],
    div: ["class", "data-mermaid-pending"],
    figure: [
      "class",
      "data-echarts-pending",
      "data-echarts-protocol"
    ],
    img: ["src", "alt", "title", "width", "height"],
    input: ["type", "checked", "disabled", "class"],
    li: ["class", "value"],
    ol: ["class", "start"],
    pre: ["class", "hidden", "lang"],
    span: ["class", "style"],
    td: ["colspan", "rowspan", "style"],
    th: ["colspan", "rowspan", "scope", "style"],
    // 属性名取自 KaTeX 0.16 与 0.19 对根号、箭头、重音、括号、划线等命令的实际输出。
    // sanitize-html 会把属性名转为小写（viewBox → viewbox），浏览器解析内联 SVG 时
    // 会按 HTML 规范的"SVG 属性大小写修正"步骤还原，因此这里使用小写名称。
    // 不放行 xmlns（内联 SVG 不需要）、href、xlink:href、style 以外的表现属性与事件属性。
    svg: ["width", "height", "viewbox", "preserveaspectratio", "style"],
    path: ["d"],
    line: ["x1", "y1", "x2", "y2", "stroke-width"]
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: {
    img: ["http", "https", "data"]
  },
  allowedSchemesAppliedToAttributes: ["src", "cite"],
  allowedStyles: {
    span: {
      height: [lengthStylePattern],
      top: [lengthStylePattern],
      width: [lengthStylePattern],
      "min-width": [lengthStylePattern],
      "margin-left": [lengthStylePattern],
      "margin-right": [lengthStylePattern],
      "padding-left": [lengthStylePattern],
      "vertical-align": [lengthStylePattern],
      "border-bottom-width": [lengthStylePattern]
    },
    // KaTeX 的 \vec 等命令会给 svg 设置 width:0.471em 这样的内联宽度
    svg: {
      width: [lengthStylePattern]
    },
    td: {
      "text-align": [tableTextAlignStylePattern]
    },
    th: {
      "text-align": [tableTextAlignStylePattern]
    }
  },
  transformTags: {
    a(tagName, attributes) {
      const href = attributes.href;
      if (href && !isSafeDocumentLink(href)) {
        delete attributes.href;
      }
      return {
        tagName,
        attribs: {
          ...attributes,
          rel: "noopener noreferrer"
        }
      };
    }
  }
};

/**
 * 对渲染得到的 HTML 执行安全过滤，是渲染链路唯一的 HTML 安全边界。
 *
 * 按白名单保留标签、属性、样式与链接协议，其余内容一律移除。单独导出以便不经过
 * Markdown 解析、直接以恶意 HTML 验证过滤行为。
 *
 * @param html 待过滤的 HTML 片段
 * @returns 过滤后的 HTML 片段
 */
export function sanitizeRenderedHtml(html: string): string {
  return sanitizeHtml(html, safeHtmlOptions);
}

export function renderMarkdown(
  source: string,
  options: RenderMarkdownOptions = {}
): RenderedMarkdown {
  const warnings = [...(options.warnings ?? [])];
  const parsed = parseFrontMatter(source);
  const environment = {
    warnings,
    imageSourceMap: options.imageSourceMap
  };
  const rendered = markdown.render(parsed.content, environment);
  const bodyHtml = sanitizeRenderedHtml(rendered);
  const firstBodyHeading = extractFirstHeading(parsed.content);
  const metadata = normalizeMetadata(
    parsed.data,
    options.language ?? "zh-CN",
    firstBodyHeading
  );
  const semanticDocument = createSemanticDocumentModel({
    metadata,
    firstBodyHeading
  });
  const structure = renderDocumentStructure(semanticDocument);
  const profileAttribute = structure
    ? ` data-document-profile="${structure.profile}"`
    : "";
  const articleHtml = `<article id="write" class="markdown-body" lang="${escapeAttribute(metadata.language)}"${profileAttribute}>${structure?.prefixHtml ?? ""}${bodyHtml}${structure?.suffixHtml ?? ""}</article>`;

  return {
    rendererVersion: RENDERER_VERSION,
    markdownBody: parsed.content,
    articleHtml,
    bodyHtml,
    metadata,
    semanticDocument,
    features: detectFeatures(bodyHtml),
    warnings
  };
}

function collectImageSources(tokens: readonly Token[], sources: Set<string>) {
  for (const token of tokens) {
    if (token.type === "image") {
      const source = token.attrGet("src");
      if (source) {
        sources.add(source);
      }
    }
    if (token.children) {
      collectImageSources(token.children, sources);
    }
  }
}

export function extractMarkdownImageSources(source: string) {
  const parsed = parseFrontMatter(source);
  const sources = new Set<string>();
  collectImageSources(markdown.parse(parsed.content, {}), sources);
  return [...sources];
}

function parseFrontMatter(source: string) {
  try {
    // 必须传入选项对象：gray-matter 仅在未传选项时才读写其全局缓存 matter.cache，
    // 而它在解析之前就写入缓存，解析失败后条目残留，同样内容的下一次调用会直接命中
    // 缓存而不再抛错（整段 YAML 被当作正文）。缓存还以浅拷贝返回，多次调用会共享
    // 同一个 data 对象。服务端与桌面主进程长驻，预览、换主题、导出都会重复渲染同一内容。
    return matter(source, {});
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    throw new MarkdownDocumentParseError(
      `无法解析 Markdown Front Matter：${message}`,
      { cause: error }
    );
  }
}

function normalizeMetadata(
  data: Record<string, unknown>,
  fallbackLanguage: string,
  fallbackTitle: string
): MarkdownDocumentMetadata {
  return {
    title: readString(data.title) || fallbackTitle,
    author: readString(data.author),
    subject: readString(data.subject) || readString(data.description),
    keywords: readStringList(data.keywords ?? data.tags),
    language: readString(data.language ?? data.lang) || fallbackLanguage,
    ...(data.document === undefined
      ? {}
      : { document: normalizeDocumentProfile(data.document) })
  };
}

function normalizeDocumentProfile(value: unknown): DocumentProfile {
  const parsed = documentProfileSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  const details = parsed.error.issues
    .map((issue) => {
      const path = ["document", ...issue.path].join(".");
      return `${path}：${issue.message}`;
    })
    .join("；");
  throw new MarkdownDocumentParseError(
    `文档结构配置无效：${details}`
  );
}

function readString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(readString).filter(Boolean).slice(0, 30);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 30);
  }

  return [];
}

function extractFirstHeading(source: string): string {
  const heading = source.match(/^#\s+(.+?)\s*#*\s*$/mu);
  return heading?.[1]?.trim() ?? "";
}

/**
 * 判断 HTML 中是否存在带有指定 class 的真实标签。
 *
 * 输入必须是经过安全过滤的 HTML：此时正文与代码中的 "<" 和 ">" 均已被转义为
 * "&lt;" 与 "&gt;"，字面出现的 "<标签 ..." 一定是真实元素。因此只在标签内部匹配
 * class 属性，正文里恰好出现的 katex、mermaid、footnote 等普通单词，以及代码块里
 * 展示的 class="katex" 之类文本，都不会被误判。
 *
 * @param html 经过安全过滤的 HTML
 * @param tokens 任一 class 名称命中即视为存在
 */
function hasElementWithClass(html: string, tokens: readonly string[]): boolean {
  // 连字符在字符类之外不是特殊字符；带 u 标志的正则里 "\-" 还是非法转义，因此不转义它
  const alternatives = tokens
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("|");
  const pattern = new RegExp(
    `<[a-zA-Z][^>]*\\sclass="(?:[^"]*\\s)?(?:${alternatives})(?:\\s[^"]*)?"`,
    "u"
  );
  return pattern.test(html);
}

function detectFeatures(html: string): ThemeFeature[] {
  // 标签类特性只能由真实标签产生；class 类特性按真实元素的 class 判断
  const featureChecks: Array<[ThemeFeature, (html: string) => boolean]> = [
    ["code", (value) => /<pre\b/u.test(value)],
    ["table", (value) => /<table\b/u.test(value)],
    ["task-list", (value) => hasElementWithClass(value, ["md-task-list-item"])],
    [
      "footnote",
      (value) => hasElementWithClass(value, ["footnote-ref", "footnotes"])
    ],
    // katex-error 是公式语法错误时的占位，文档仍然使用了公式
    ["katex", (value) => hasElementWithClass(value, ["katex", "katex-error"])],
    ["mermaid", (value) => hasElementWithClass(value, ["mermaid"])],
    // md-echarts-error 是图表配置无效时的占位，文档仍然使用了图表
    [
      "echarts",
      (value) => hasElementWithClass(value, ["md-echarts", "md-echarts-error"])
    ]
  ];

  return featureChecks
    .filter(([, check]) => check(html))
    .map(([feature]) => feature);
}

function renderFallbackFence(
  tokens: Token[],
  index: number,
  renderer: Renderer
): string {
  const token = tokens[index];

  if (!token) {
    return "";
  }

  return `<pre${renderer.renderAttrs(token)}><code>${markdown.utils.escapeHtml(token.content)}</code></pre>\n`;
}

function escapeAttribute(value: string): string {
  return markdown.utils.escapeHtml(value);
}
