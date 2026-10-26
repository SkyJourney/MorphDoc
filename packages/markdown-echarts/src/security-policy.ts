import {
  EChartsFenceError,
  supportedEChartsSeriesTypes,
  type JsonValue
} from "./protocol.js";

export interface EChartsSecurityLimits {
  maxDepth: number;
  maxNodes: number;
  maxObjectKeys: number;
  maxArrayLength: number;
  maxStringLength: number;
  maxSeries: number;
  maxHierarchyNodes: number;
  maxGraphNodes: number;
  maxGraphEdges: number;
}

export const defaultEChartsSecurityLimits: EChartsSecurityLimits = {
  maxDepth: 32,
  maxNodes: 50_000,
  maxObjectKeys: 1_000,
  maxArrayLength: 20_000,
  maxStringLength: 100_000,
  maxSeries: 32,
  maxHierarchyNodes: 5_000,
  maxGraphNodes: 5_000,
  maxGraphEdges: 10_000
};

const forbiddenPropertyNames = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "renderItem",
  "optionToContent",
  "contentToOption",
  "onclick",
  "onClick",
  "link",
  "sublink"
]);

const allowedTopLevelOptionKeys = new Set([
  "aria",
  "animation",
  "animationDelay",
  "animationDelayUpdate",
  "animationDuration",
  "animationDurationUpdate",
  "animationEasing",
  "animationEasingUpdate",
  "angleAxis",
  "axisPointer",
  "backgroundColor",
  "calendar",
  "color",
  "darkMode",
  "dataZoom",
  "dataset",
  "grid",
  "legend",
  "polar",
  "radar",
  "radiusAxis",
  "series",
  "textStyle",
  "title",
  "toolbox",
  "tooltip",
  "visualMap",
  "xAxis",
  "yAxis"
]);

const allowedToolboxFeatures = new Set([
  "brush",
  "dataZoom",
  "magicType",
  "restore",
  "saveAsImage"
]);

const unsafeStringPattern =
  /^(?:javascript|file|https?):|^\/\/|^data:|url\s*\(|image:\/\//iu;

interface TraversalState {
  nodes: number;
}

function optionPath(path: readonly (string | number)[]) {
  return path.length === 0 ? "option" : `option.${path.join(".")}`;
}

function assertSafeKey(key: string, path: readonly (string | number)[]) {
  if (forbiddenPropertyNames.has(key)) {
    throw new EChartsFenceError(
      "UNSAFE_OPTION",
      `${optionPath(path)} 包含禁止属性 ${key}`
    );
  }
}

function normalizeValue(
  value: unknown,
  path: readonly (string | number)[],
  depth: number,
  state: TraversalState,
  limits: EChartsSecurityLimits
): JsonValue {
  state.nodes += 1;
  if (state.nodes > limits.maxNodes) {
    throw new EChartsFenceError(
      "LIMIT_EXCEEDED",
      `ECharts option 节点数量不能超过 ${limits.maxNodes}`
    );
  }

  if (depth > limits.maxDepth) {
    throw new EChartsFenceError(
      "LIMIT_EXCEEDED",
      `ECharts option 嵌套深度不能超过 ${limits.maxDepth}`
    );
  }

  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new EChartsFenceError(
        "INVALID_OPTION",
        `${optionPath(path)} 必须是有限数值`
      );
    }
    return value;
  }

  if (typeof value === "string") {
    if (value.length > limits.maxStringLength) {
      throw new EChartsFenceError(
        "LIMIT_EXCEEDED",
        `${optionPath(path)} 字符串长度不能超过 ${limits.maxStringLength}`
      );
    }
    if (unsafeStringPattern.test(value.trim())) {
      throw new EChartsFenceError(
        "UNSAFE_OPTION",
        `${optionPath(path)} 包含被禁止的外部资源或危险 URL`
      );
    }
    if (
      path.at(-1) === "formatter" &&
      (value.includes("<") || value.includes(">"))
    ) {
      throw new EChartsFenceError(
        "UNSAFE_OPTION",
        `${optionPath(path)} 只允许不含 HTML 的模板字符串`
      );
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length > limits.maxArrayLength) {
      throw new EChartsFenceError(
        "LIMIT_EXCEEDED",
        `${optionPath(path)} 数组长度不能超过 ${limits.maxArrayLength}`
      );
    }
    return value.map((item, index) =>
      normalizeValue(item, [...path, index], depth + 1, state, limits)
    );
  }

  if (typeof value !== "object") {
    throw new EChartsFenceError(
      "INVALID_OPTION",
      `${optionPath(path)} 只能包含 JSON 可序列化值`
    );
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new EChartsFenceError(
      "INVALID_OPTION",
      `${optionPath(path)} 必须是普通对象`
    );
  }

  const entries = Object.entries(value);
  if (entries.length > limits.maxObjectKeys) {
    throw new EChartsFenceError(
      "LIMIT_EXCEEDED",
      `${optionPath(path)} 属性数量不能超过 ${limits.maxObjectKeys}`
    );
  }

  const normalized: Record<string, JsonValue> = {};
  for (const [key, child] of entries) {
    assertSafeKey(key, [...path, key]);
    normalized[key] = normalizeValue(
      child,
      [...path, key],
      depth + 1,
      state,
      limits
    );
  }
  return normalized;
}

function assertSupportedTopLevelKeys(option: Record<string, JsonValue>) {
  for (const key of Object.keys(option)) {
    if (!allowedTopLevelOptionKeys.has(key)) {
      throw new EChartsFenceError(
        "INVALID_OPTION",
        `option.${key} 暂不在首版支持范围内`
      );
    }
  }
}

function assertSupportedSeries(
  option: Record<string, JsonValue>,
  limits: EChartsSecurityLimits
) {
  const series = option.series;
  if (!Array.isArray(series) || series.length === 0) {
    throw new EChartsFenceError(
      "INVALID_OPTION",
      "option.series 必须是非空数组"
    );
  }
  if (series.length > limits.maxSeries) {
    throw new EChartsFenceError(
      "LIMIT_EXCEEDED",
      `option.series 数量不能超过 ${limits.maxSeries}`
    );
  }

  for (const [index, item] of series.entries()) {
    if (
      item === null ||
      Array.isArray(item) ||
      typeof item !== "object"
    ) {
      throw new EChartsFenceError(
        "INVALID_OPTION",
        `option.series.${index} 必须是对象`
      );
    }
    const type = item.type;
    if (
      typeof type !== "string" ||
      !supportedEChartsSeriesTypes.some(
        (supportedType) => supportedType === type
      )
    ) {
      throw new EChartsFenceError(
        "INVALID_OPTION",
        `option.series.${index}.type 暂不支持 ${String(type)}`
      );
    }
    assertSeriesStructureLimits(item, index, type, limits);
  }
}

function countHierarchyNodes(
  value: JsonValue | undefined,
  limit: number,
  path: string
) {
  if (!Array.isArray(value)) {
    return;
  }
  let count = 0;
  const pending = [...value];
  while (pending.length > 0) {
    const node = pending.pop();
    count += 1;
    if (count > limit) {
      throw new EChartsFenceError(
        "LIMIT_EXCEEDED",
        `${path} 层级节点数量不能超过 ${limit}`
      );
    }
    if (
      node !== null &&
      !Array.isArray(node) &&
      typeof node === "object" &&
      Array.isArray(node.children)
    ) {
      pending.push(...node.children);
    }
  }
}

function arrayLength(value: JsonValue | undefined) {
  return Array.isArray(value) ? value.length : 0;
}

function assertSeriesStructureLimits(
  series: Record<string, JsonValue>,
  seriesIndex: number,
  type: string,
  limits: EChartsSecurityLimits
) {
  const path = `option.series.${seriesIndex}`;
  if (
    type === "tree" ||
    type === "treemap" ||
    type === "sunburst"
  ) {
    countHierarchyNodes(
      series.data,
      limits.maxHierarchyNodes,
      `${path}.data`
    );
    return;
  }
  if (
    type !== "graph" &&
    type !== "sankey" &&
    type !== "chord"
  ) {
    return;
  }

  const nodeCount =
    arrayLength(series.data) + arrayLength(series.nodes);
  if (nodeCount > limits.maxGraphNodes) {
    throw new EChartsFenceError(
      "LIMIT_EXCEEDED",
      `${path} 节点数量不能超过 ${limits.maxGraphNodes}`
    );
  }
  const edgeCount =
    arrayLength(series.links) + arrayLength(series.edges);
  if (edgeCount > limits.maxGraphEdges) {
    throw new EChartsFenceError(
      "LIMIT_EXCEEDED",
      `${path} 边数量不能超过 ${limits.maxGraphEdges}`
    );
  }
}

function assertSafeToolbox(option: Record<string, JsonValue>) {
  if (option.toolbox === undefined) {
    return;
  }
  const toolboxes = Array.isArray(option.toolbox)
    ? option.toolbox
    : [option.toolbox];

  for (const toolbox of toolboxes) {
    if (
      toolbox === null ||
      Array.isArray(toolbox) ||
      typeof toolbox !== "object"
    ) {
      continue;
    }
    const feature = toolbox.feature;
    if (
      feature === undefined ||
      feature === null ||
      Array.isArray(feature) ||
      typeof feature !== "object"
    ) {
      continue;
    }
    for (const key of Object.keys(feature)) {
      if (!allowedToolboxFeatures.has(key)) {
        throw new EChartsFenceError(
          "UNSAFE_OPTION",
          `option.toolbox.feature.${key} 不允许使用`
        );
      }
    }
  }
}

function assertSafeTransforms(value: JsonValue, path: string[] = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => assertSafeTransforms(item, path));
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (key === "transform") {
      const transforms = Array.isArray(child) ? child : [child];
      for (const transform of transforms) {
        if (
          transform === null ||
          Array.isArray(transform) ||
          typeof transform !== "object" ||
          (transform.type !== "filter" && transform.type !== "sort")
        ) {
          throw new EChartsFenceError(
            "UNSAFE_OPTION",
            `${optionPath(childPath)} 只允许内置 filter 或 sort`
          );
        }
      }
    }
    assertSafeTransforms(child, childPath);
  }
}

export function normalizeAndValidateEChartsOption(
  value: unknown,
  limits: EChartsSecurityLimits = defaultEChartsSecurityLimits
): Record<string, JsonValue> {
  const normalized = normalizeValue(
    value,
    [],
    0,
    { nodes: 0 },
    limits
  );
  if (
    normalized === null ||
    Array.isArray(normalized) ||
    typeof normalized !== "object"
  ) {
    throw new EChartsFenceError(
      "INVALID_OPTION",
      "option 必须是普通对象"
    );
  }

  assertSupportedTopLevelKeys(normalized);
  assertSupportedSeries(normalized, limits);
  assertSafeToolbox(normalized);
  assertSafeTransforms(normalized);
  return normalized;
}
