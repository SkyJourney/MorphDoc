import type MarkdownIt from "markdown-it";
import type { Options as MarkdownItOptions } from "markdown-it";
import type Renderer from "markdown-it/lib/renderer.mjs";
import type Token from "markdown-it/lib/token.mjs";
import { echartsDomContract } from "./dom-contract.js";
import {
  ECHARTS_FENCE_VERSION,
  EChartsFenceError,
  type NormalizedEChartsFenceSpec
} from "./protocol.js";
import {
  parseEChartsFence,
  type ParseEChartsFenceOptions
} from "./parse-yaml.js";

export interface MarkdownItEChartsErrorContext {
  source: string;
  tokenIndex: number;
  environment: unknown;
}

export interface MarkdownItEChartsOptions {
  parse?: ParseEChartsFenceOptions;
  onError?: (
    error: EChartsFenceError,
    context: MarkdownItEChartsErrorContext
  ) => void;
}

type FenceRenderer = (
  tokens: Token[],
  index: number,
  options: MarkdownItOptions,
  environment: unknown,
  renderer: Renderer
) => string;

function renderError(markdown: MarkdownIt, error: EChartsFenceError) {
  const message = markdown.utils.escapeHtml(error.message);
  return `<div class="${echartsDomContract.errorClass}" role="alert">ECharts 图表配置无效：${message}</div>\n`;
}

function renderDefinition(
  markdown: MarkdownIt,
  definition: NormalizedEChartsFenceSpec
) {
  const serialized = markdown.utils.escapeHtml(
    JSON.stringify(definition)
  );
  const caption =
    definition.caption === undefined
      ? ""
      : `<figcaption>${markdown.utils.escapeHtml(definition.caption)}</figcaption>`;
  const label = markdown.utils.escapeHtml(
    definition.caption ?? "ECharts 图表"
  );

  return [
    `<figure class="${echartsDomContract.figureClass}"`,
    ` ${echartsDomContract.pendingAttribute}="true"`,
    ` ${echartsDomContract.protocolAttribute}="${ECHARTS_FENCE_VERSION}">`,
    `<div class="${echartsDomContract.hostClass}" role="img" aria-label="${label}"></div>`,
    `<pre class="${echartsDomContract.definitionClass}" hidden="hidden">${serialized}</pre>`,
    caption,
    "</figure>\n"
  ].join("");
}

function renderDefaultFence(
  defaultFenceRenderer: FenceRenderer | undefined,
  tokens: Token[],
  index: number,
  options: MarkdownItOptions,
  environment: unknown,
  renderer: Renderer
) {
  if (defaultFenceRenderer) {
    return defaultFenceRenderer(
      tokens,
      index,
      options,
      environment,
      renderer
    );
  }
  return renderer.renderToken(tokens, index, options);
}

export function markdownItECharts(
  markdown: MarkdownIt,
  pluginOptions: MarkdownItEChartsOptions = {}
) {
  const defaultFenceRenderer = markdown.renderer.rules.fence;

  markdown.renderer.rules.fence = (
    tokens,
    index,
    options,
    environment,
    renderer
  ) => {
    const token = tokens[index];
    const language = token?.info
      .trim()
      .split(/\s+/u)[0]
      ?.toLowerCase();
    if (!token || language !== "echarts") {
      return renderDefaultFence(
        defaultFenceRenderer,
        tokens,
        index,
        options,
        environment,
        renderer
      );
    }

    try {
      return renderDefinition(
        markdown,
        parseEChartsFence(token.content, pluginOptions.parse)
      );
    } catch (error) {
      const normalizedError =
        error instanceof EChartsFenceError
          ? error
          : new EChartsFenceError(
              "INVALID_YAML",
              error instanceof Error ? error.message : "未知错误",
              { cause: error }
            );
      pluginOptions.onError?.(normalizedError, {
        source: token.content,
        tokenIndex: index,
        environment
      });
      return renderError(markdown, normalizedError);
    }
  };
}
