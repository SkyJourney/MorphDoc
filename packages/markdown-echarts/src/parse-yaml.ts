import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument
} from "yaml";
import type { Pair, ParsedNode } from "yaml";
import {
  DEFAULT_ECHARTS_FENCE_HEIGHT,
  EChartsFenceError,
  echartsFenceSpecSchema,
  type NormalizedEChartsFenceSpec
} from "./protocol.js";
import {
  defaultEChartsSecurityLimits,
  normalizeAndValidateEChartsOption,
  type EChartsSecurityLimits
} from "./security-policy.js";
import {
  validateAndApplyEChartsOptionDefaults
} from "./semantic-validator.js";

export interface ParseEChartsFenceOptions {
  maxSourceBytes?: number;
  securityLimits?: EChartsSecurityLimits;
}

export const defaultMaxEChartsFenceSourceBytes = 512 * 1024;

function inspectYamlNode(node: ParsedNode | null | undefined): void {
  if (!node) {
    return;
  }
  if (isAlias(node)) {
    throw new EChartsFenceError(
      "YAML_ALIAS_NOT_ALLOWED",
      "ECharts YAML 不允许使用别名"
    );
  }
  if (node.anchor !== undefined) {
    throw new EChartsFenceError(
      "YAML_ANCHOR_NOT_ALLOWED",
      "ECharts YAML 不允许使用锚点"
    );
  }
  if (node.tag !== undefined) {
    throw new EChartsFenceError(
      "YAML_TAG_NOT_ALLOWED",
      "ECharts YAML 不允许使用显式标签"
    );
  }
  if (isMap(node)) {
    for (const pair of node.items as Pair<ParsedNode, ParsedNode>[]) {
      inspectYamlNode(pair.key);
      inspectYamlNode(pair.value);
    }
    return;
  }
  if (isSeq(node)) {
    for (const item of node.items) {
      inspectYamlNode(item);
    }
    return;
  }
  if (!isScalar(node)) {
    throw new EChartsFenceError(
      "INVALID_YAML",
      "ECharts YAML 包含无法识别的节点"
    );
  }
}

function formatZodError(error: {
  issues: { path: PropertyKey[]; message: string }[];
}) {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}：${issue.message}` : issue.message;
    })
    .join("；");
}

export function parseEChartsFence(
  source: string,
  options: ParseEChartsFenceOptions = {}
): NormalizedEChartsFenceSpec {
  const maxSourceBytes =
    options.maxSourceBytes ?? defaultMaxEChartsFenceSourceBytes;
  if (new TextEncoder().encode(source).byteLength > maxSourceBytes) {
    throw new EChartsFenceError(
      "SOURCE_TOO_LARGE",
      `ECharts YAML 不能超过 ${maxSourceBytes} 字节`
    );
  }

  const document = parseDocument(source, {
    schema: "core",
    strict: true,
    uniqueKeys: true,
    prettyErrors: true
  });
  if (document.errors.length > 0) {
    throw new EChartsFenceError(
      "INVALID_YAML",
      document.errors.map((error) => error.message).join("；")
    );
  }

  inspectYamlNode(document.contents);

  let parsed: unknown;
  try {
    parsed = document.toJS({
      maxAliasCount: 0,
      mapAsMap: false
    });
  } catch (error) {
    throw new EChartsFenceError(
      "INVALID_YAML",
      error instanceof Error ? error.message : "ECharts YAML 解析失败",
      { cause: error }
    );
  }

  const protocolResult = echartsFenceSpecSchema.safeParse(parsed);
  if (!protocolResult.success) {
    throw new EChartsFenceError(
      "INVALID_PROTOCOL",
      formatZodError(protocolResult.error)
    );
  }

  const securityLimits =
    options.securityLimits ?? defaultEChartsSecurityLimits;
  const option = validateAndApplyEChartsOptionDefaults(
    normalizeAndValidateEChartsOption(
      protocolResult.data.option,
      securityLimits
    )
  );
  const normalized: NormalizedEChartsFenceSpec = {
    version: protocolResult.data.version,
    theme: protocolResult.data.theme,
    option
  };
  if (protocolResult.data.height !== undefined) {
    normalized.height = protocolResult.data.height;
  } else if (protocolResult.data.aspectRatio === undefined) {
    normalized.height = DEFAULT_ECHARTS_FENCE_HEIGHT;
  }
  if (protocolResult.data.aspectRatio !== undefined) {
    normalized.aspectRatio = protocolResult.data.aspectRatio;
  }
  if (protocolResult.data.caption !== undefined) {
    normalized.caption = protocolResult.data.caption;
  }
  return normalized;
}
