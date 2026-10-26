import {
  EChartsFenceError,
  type JsonValue,
  type SupportedEChartsSeriesType
} from "./protocol.js";

type JsonObject = Record<string, JsonValue>;

export interface EChartsSeriesValidationContext {
  option: JsonObject;
  series: JsonObject;
  seriesIndex: number;
  hasDataset: boolean;
}

export type EChartsSeriesValidator = (
  context: EChartsSeriesValidationContext
) => void;

function fail(path: string, message: string): never {
  throw new EChartsFenceError(
    "INVALID_OPTION",
    `${path} ${message}`
  );
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return (
    value !== null &&
    value !== undefined &&
    !Array.isArray(value) &&
    typeof value === "object"
  );
}

function asObjects(value: JsonValue | undefined): JsonObject[] {
  if (Array.isArray(value)) {
    return value.filter(isObject);
  }
  return isObject(value) ? [value] : [];
}

function isNonEmptyData(value: JsonValue | undefined) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return isObject(value) && Object.keys(value).length > 0;
}

function datasetHasRows(dataset: JsonObject) {
  const source = dataset.source;
  if (Array.isArray(source)) {
    if (source.length === 0) {
      return false;
    }
    const firstRow = source[0];
    const hasHeader =
      dataset.sourceHeader === true ||
      (Array.isArray(firstRow) &&
        firstRow.length > 0 &&
        firstRow.every((value) => typeof value === "string"));
    return hasHeader ? source.length > 1 : true;
  }
  if (isObject(source)) {
    return Object.values(source).some(
      (column) => Array.isArray(column) && column.length > 0
    );
  }
  return false;
}

function datasets(option: JsonObject) {
  return asObjects(option.dataset);
}

function datasetHasSource(
  option: JsonObject,
  datasetIndex: number,
  visited = new Set<number>()
): boolean {
  const allDatasets = datasets(option);
  const dataset = allDatasets[datasetIndex];
  if (!dataset || visited.has(datasetIndex)) {
    return false;
  }
  visited.add(datasetIndex);

  if (datasetHasRows(dataset)) {
    return true;
  }
  if (dataset.transform === undefined) {
    return false;
  }

  const upstream = dataset.fromDatasetIndex;
  if (
    typeof upstream === "number" &&
    Number.isInteger(upstream) &&
    upstream >= 0
  ) {
    return datasetHasSource(option, upstream, visited);
  }
  return allDatasets.some(
    (candidate, index) =>
      index !== datasetIndex && datasetHasRows(candidate)
  );
}

function seriesHasDataset(option: JsonObject, series: JsonObject) {
  const datasetIndex =
    typeof series.datasetIndex === "number" &&
    Number.isInteger(series.datasetIndex)
      ? series.datasetIndex
      : 0;
  return datasetHasSource(option, datasetIndex);
}

function requireData(context: EChartsSeriesValidationContext) {
  if (
    !isNonEmptyData(context.series.data) &&
    !context.hasDataset
  ) {
    fail(
      `option.series.${context.seriesIndex}.data`,
      "必须是非空数组，或通过 dataset.source 提供数据"
    );
  }
}

function ensureCartesianAxes(option: JsonObject) {
  option.xAxis ??= {};
  option.yAxis ??= {};
}

function requireComponent(
  option: JsonObject,
  name: string,
  seriesIndex: number
) {
  if (option[name] === undefined) {
    fail(
      `option.${name}`,
      `是 option.series.${seriesIndex} 所用坐标系的必填组件`
    );
  }
}

function coordinateSystem(series: JsonObject) {
  return typeof series.coordinateSystem === "string"
    ? series.coordinateSystem
    : "cartesian2d";
}

function validateCartesianOrPolar(
  context: EChartsSeriesValidationContext
) {
  const coordinate = coordinateSystem(context.series);
  if (coordinate === "cartesian2d") {
    ensureCartesianAxes(context.option);
    return;
  }
  if (coordinate === "polar") {
    requireComponent(
      context.option,
      "polar",
      context.seriesIndex
    );
    requireComponent(
      context.option,
      "angleAxis",
      context.seriesIndex
    );
    requireComponent(
      context.option,
      "radiusAxis",
      context.seriesIndex
    );
    return;
  }
  fail(
    `option.series.${context.seriesIndex}.coordinateSystem`,
    `暂不支持 ${coordinate}`
  );
}

function dataValues(series: JsonObject): JsonValue[] {
  return Array.isArray(series.data) ? series.data : [];
}

function itemValue(item: JsonValue): JsonValue {
  return isObject(item) && item.value !== undefined
    ? item.value
    : item;
}

function requireTupleData(
  context: EChartsSeriesValidationContext,
  minimumLength: number,
  description: string
) {
  if (context.hasDataset) {
    return;
  }
  for (const [dataIndex, item] of dataValues(
    context.series
  ).entries()) {
    const value = itemValue(item);
    if (!Array.isArray(value) || value.length < minimumLength) {
      fail(
        `option.series.${context.seriesIndex}.data.${dataIndex}`,
        `必须是${description}`
      );
    }
  }
}

function validateLineOrBar(
  context: EChartsSeriesValidationContext
) {
  requireData(context);
  validateCartesianOrPolar(context);
}

function validateScatter(
  context: EChartsSeriesValidationContext
) {
  requireData(context);
  const coordinate = coordinateSystem(context.series);
  if (coordinate === "calendar") {
    requireComponent(
      context.option,
      "calendar",
      context.seriesIndex
    );
    requireTupleData(context, 2, "至少包含日期和值的数组");
    return;
  }
  validateCartesianOrPolar(context);
  requireTupleData(context, 2, "至少包含两个坐标值的数组");
}

function validatePie(context: EChartsSeriesValidationContext) {
  requireData(context);
  if (context.hasDataset) {
    return;
  }
  for (const [dataIndex, item] of dataValues(
    context.series
  ).entries()) {
    const value = itemValue(item);
    if (
      typeof value !== "number" ||
      !Number.isFinite(value)
    ) {
      fail(
        `option.series.${context.seriesIndex}.data.${dataIndex}.value`,
        "必须是有限数值"
      );
    }
  }
}

function radarIndicators(option: JsonObject) {
  return asObjects(option.radar).flatMap((radar) =>
    Array.isArray(radar.indicator)
      ? radar.indicator.filter(isObject)
      : []
  );
}

function validateRadar(context: EChartsSeriesValidationContext) {
  requireData(context);
  const indicators = radarIndicators(context.option);
  if (indicators.length === 0) {
    fail(
      "option.radar.indicator",
      "是雷达图的必填非空数组"
    );
  }
  if (context.hasDataset) {
    return;
  }
  requireTupleData(
    context,
    indicators.length,
    `至少包含 ${indicators.length} 个指标值的数组`
  );
}

function validateHeatmap(context: EChartsSeriesValidationContext) {
  requireData(context);
  const coordinate = coordinateSystem(context.series);
  if (coordinate === "calendar") {
    requireComponent(
      context.option,
      "calendar",
      context.seriesIndex
    );
    requireTupleData(context, 2, "包含日期和值的数组");
    return;
  }
  if (coordinate !== "cartesian2d") {
    fail(
      `option.series.${context.seriesIndex}.coordinateSystem`,
      `暂不支持 ${coordinate}`
    );
  }
  ensureCartesianAxes(context.option);
  requireTupleData(context, 3, "包含 x、y、值的三元数组");
}

function validateBoxplot(
  context: EChartsSeriesValidationContext
) {
  requireData(context);
  ensureCartesianAxes(context.option);
  requireTupleData(
    context,
    5,
    "包含最小值、Q1、中位数、Q3、最大值的五元数组"
  );
}

function validateCandlestick(
  context: EChartsSeriesValidationContext
) {
  requireData(context);
  ensureCartesianAxes(context.option);
  requireTupleData(
    context,
    4,
    "包含开盘、收盘、最低、最高值的四元数组"
  );
}

function requireDirectArray(
  context: EChartsSeriesValidationContext,
  key: "data" | "nodes" | "links" | "edges",
  description: string
): JsonValue[] {
  const value = context.series[key];
  if (!Array.isArray(value) || value.length === 0) {
    fail(
      `option.series.${context.seriesIndex}.${key}`,
      `必须是${description}`
    );
  }
  return value;
}

function validateHierarchyNodes(
  context: EChartsSeriesValidationContext,
  requireLeafValue: boolean
) {
  const roots = requireDirectArray(
    context,
    "data",
    "非空层级节点数组"
  );
  const pending = roots.map((node, index) => ({
    node,
    path: `option.series.${context.seriesIndex}.data.${index}`
  }));

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    if (!isObject(current.node)) {
      fail(current.path, "必须是层级节点对象");
    }
    const children = current.node.children;
    if (children !== undefined && !Array.isArray(children)) {
      fail(`${current.path}.children`, "必须是数组");
    }
    const childNodes = Array.isArray(children) ? children : [];
    childNodes.forEach((node, index) =>
      pending.push({
        node,
        path: `${current.path}.children.${index}`
      })
    );

    if (!requireLeafValue || childNodes.length > 0) {
      continue;
    }
    const value = current.node.value;
    const valid =
      typeof value === "number"
        ? Number.isFinite(value)
        : Array.isArray(value) &&
          value.length > 0 &&
          value.every(
            (item) =>
              typeof item === "number" && Number.isFinite(item)
          );
    if (!valid) {
      fail(
        `${current.path}.value`,
        "必须是有限数值或非空有限数值数组"
      );
    }
  }
}

function validateTree(context: EChartsSeriesValidationContext) {
  validateHierarchyNodes(context, false);
}

function validateTreemapOrSunburst(
  context: EChartsSeriesValidationContext
) {
  validateHierarchyNodes(context, true);
}

function relationNodes(
  context: EChartsSeriesValidationContext
): { values: JsonValue[]; key: "data" | "nodes" } {
  if (
    Array.isArray(context.series.data) &&
    context.series.data.length > 0
  ) {
    return { values: context.series.data, key: "data" };
  }
  return {
    values: requireDirectArray(
      context,
      "nodes",
      "非空节点数组"
    ),
    key: "nodes"
  };
}

function relationEdges(
  context: EChartsSeriesValidationContext,
  required: boolean
): { values: JsonValue[]; key: "links" | "edges" } {
  if (
    Array.isArray(context.series.links) &&
    context.series.links.length > 0
  ) {
    return { values: context.series.links, key: "links" };
  }
  if (
    Array.isArray(context.series.edges) &&
    context.series.edges.length > 0
  ) {
    return { values: context.series.edges, key: "edges" };
  }
  if (required) {
    return {
      values: requireDirectArray(
        context,
        "links",
        "非空关系边数组"
      ),
      key: "links"
    };
  }
  return { values: [], key: "links" };
}

function nodeIdentifiers(node: JsonValue, index: number) {
  const identifiers = new Set<string>([`#${index}`]);
  if (typeof node === "string" || typeof node === "number") {
    identifiers.add(String(node));
    return identifiers;
  }
  if (!isObject(node)) {
    return identifiers;
  }
  if (
    typeof node.id === "string" ||
    typeof node.id === "number"
  ) {
    identifiers.add(String(node.id));
  }
  if (
    typeof node.name === "string" ||
    typeof node.name === "number"
  ) {
    identifiers.add(String(node.name));
  }
  return identifiers;
}

function edgeEndpointExists(
  value: JsonValue | undefined,
  identifiers: Set<string>,
  nodeCount: number
) {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return false;
  }
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < nodeCount
  ) {
    return true;
  }
  return identifiers.has(String(value));
}

function validateRelationSeries(
  context: EChartsSeriesValidationContext,
  options: {
    requireEdges: boolean;
    requireEdgeValue: boolean;
    defaultGraphLayout?: boolean;
  }
) {
  const nodes = relationNodes(context);
  const identifiers = new Set<string>();
  nodes.values.forEach((node, index) => {
    if (
      node === null ||
      Array.isArray(node) ||
      (typeof node !== "object" &&
        typeof node !== "string" &&
        typeof node !== "number")
    ) {
      fail(
        `option.series.${context.seriesIndex}.${nodes.key}.${index}`,
        "必须是节点对象、名称或数值"
      );
    }
    nodeIdentifiers(node, index).forEach((identifier) =>
      identifiers.add(identifier)
    );
  });

  if (
    options.defaultGraphLayout &&
    context.series.layout === undefined
  ) {
    const hasCoordinates = nodes.values.every(
      (node) =>
        isObject(node) &&
        typeof node.x === "number" &&
        Number.isFinite(node.x) &&
        typeof node.y === "number" &&
        Number.isFinite(node.y)
    );
    context.series.layout = hasCoordinates ? "none" : "force";
  }

  const edges = relationEdges(context, options.requireEdges);
  edges.values.forEach((edge, edgeIndex) => {
    const path = `option.series.${context.seriesIndex}.${edges.key}.${edgeIndex}`;
    if (!isObject(edge)) {
      fail(path, "必须是关系边对象");
    }
    if (
      !edgeEndpointExists(
        edge.source,
        identifiers,
        nodes.values.length
      )
    ) {
      fail(`${path}.source`, "必须引用已存在的节点");
    }
    if (
      !edgeEndpointExists(
        edge.target,
        identifiers,
        nodes.values.length
      )
    ) {
      fail(`${path}.target`, "必须引用已存在的节点");
    }
    if (options.requireEdgeValue || edge.value !== undefined) {
      if (
        typeof edge.value !== "number" ||
        !Number.isFinite(edge.value) ||
        edge.value < 0
      ) {
        fail(`${path}.value`, "必须是非负有限数值");
      }
    }
  });
}

function validateGraph(context: EChartsSeriesValidationContext) {
  const coordinate = context.series.coordinateSystem;
  if (coordinate !== undefined && coordinate !== "none") {
    fail(
      `option.series.${context.seriesIndex}.coordinateSystem`,
      `暂不支持 ${String(coordinate)}`
    );
  }
  validateRelationSeries(context, {
    requireEdges: false,
    requireEdgeValue: false,
    defaultGraphLayout: true
  });
}

function validateSankey(context: EChartsSeriesValidationContext) {
  const coordinate = context.series.coordinateSystem;
  if (coordinate !== undefined && coordinate !== "view") {
    fail(
      `option.series.${context.seriesIndex}.coordinateSystem`,
      `暂不支持 ${String(coordinate)}`
    );
  }
  validateRelationSeries(context, {
    requireEdges: true,
    requireEdgeValue: true
  });
}

function validateChord(context: EChartsSeriesValidationContext) {
  const coordinate = context.series.coordinateSystem;
  if (coordinate !== undefined && coordinate !== "none") {
    fail(
      `option.series.${context.seriesIndex}.coordinateSystem`,
      `暂不支持 ${String(coordinate)}`
    );
  }
  validateRelationSeries(context, {
    requireEdges: true,
    requireEdgeValue: true
  });
}

function validateFiniteValueData(
  context: EChartsSeriesValidationContext
) {
  requireData(context);
  if (context.hasDataset) {
    return;
  }
  for (const [dataIndex, item] of dataValues(
    context.series
  ).entries()) {
    const value = itemValue(item);
    if (
      typeof value !== "number" ||
      !Number.isFinite(value)
    ) {
      fail(
        `option.series.${context.seriesIndex}.data.${dataIndex}.value`,
        "必须是有限数值"
      );
    }
  }
}

export const echartsSeriesValidators: ReadonlyMap<
  SupportedEChartsSeriesType,
  EChartsSeriesValidator
> = new Map([
  ["line", validateLineOrBar],
  ["bar", validateLineOrBar],
  ["pie", validatePie],
  ["scatter", validateScatter],
  ["radar", validateRadar],
  ["heatmap", validateHeatmap],
  ["boxplot", validateBoxplot],
  ["candlestick", validateCandlestick],
  ["tree", validateTree],
  ["treemap", validateTreemapOrSunburst],
  ["sunburst", validateTreemapOrSunburst],
  ["graph", validateGraph],
  ["sankey", validateSankey],
  ["chord", validateChord],
  ["funnel", validateFiniteValueData],
  ["gauge", validateFiniteValueData],
  ["pictorialBar", validateLineOrBar]
]);

export function validateAndApplyEChartsOptionDefaults(
  option: JsonObject
) {
  const series = option.series;
  if (!Array.isArray(series)) {
    return option;
  }

  for (const [seriesIndex, value] of series.entries()) {
    if (!isObject(value) || typeof value.type !== "string") {
      continue;
    }
    const type = value.type as SupportedEChartsSeriesType;
    const validator = echartsSeriesValidators.get(type);
    validator?.({
      option,
      series: value,
      seriesIndex,
      hasDataset: seriesHasDataset(option, value)
    });
  }
  return option;
}
