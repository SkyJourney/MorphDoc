import { z } from "zod";

export const ECHARTS_FENCE_VERSION = 1;
export const DEFAULT_ECHARTS_FENCE_HEIGHT = "80mm";

export const supportedEChartsSeriesTypes = [
  "line",
  "bar",
  "pie",
  "scatter",
  "radar",
  "heatmap",
  "boxplot",
  "candlestick",
  "tree",
  "treemap",
  "sunburst",
  "graph",
  "sankey",
  "chord",
  "funnel",
  "gauge",
  "pictorialBar"
] as const;

export type SupportedEChartsSeriesType =
  (typeof supportedEChartsSeriesTypes)[number];

export const echartsFenceThemeSchema = z.enum([
  "document",
  "light",
  "dark"
]);

const positiveLengthPattern =
  /^(?:0*[1-9]\d*(?:\.\d+)?|0*\.\d*[1-9]\d*)(?:mm|cm|in|px)$/u;

export const echartsFenceSpecSchema = z
  .object({
    version: z.literal(ECHARTS_FENCE_VERSION).default(
      ECHARTS_FENCE_VERSION
    ),
    height: z
      .string()
      .regex(
        positiveLengthPattern,
        "height 必须是大于零的 mm、cm、in 或 px 长度"
      )
      .optional(),
    aspectRatio: z.number().positive().max(10).optional(),
    theme: echartsFenceThemeSchema.default("document"),
    caption: z.string().trim().min(1).max(500).optional(),
    option: z.record(z.string(), z.unknown())
  })
  .strict();

export type EChartsFenceSpec = z.infer<typeof echartsFenceSpecSchema>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface NormalizedEChartsFenceSpec {
  version: typeof ECHARTS_FENCE_VERSION;
  height?: string;
  aspectRatio?: number;
  theme: z.infer<typeof echartsFenceThemeSchema>;
  caption?: string;
  option: Record<string, JsonValue>;
}

export const echartsFenceErrorCodes = [
  "SOURCE_TOO_LARGE",
  "INVALID_YAML",
  "YAML_ALIAS_NOT_ALLOWED",
  "YAML_ANCHOR_NOT_ALLOWED",
  "YAML_TAG_NOT_ALLOWED",
  "INVALID_PROTOCOL",
  "INVALID_OPTION",
  "UNSAFE_OPTION",
  "LIMIT_EXCEEDED"
] as const;

export type EChartsFenceErrorCode =
  (typeof echartsFenceErrorCodes)[number];

export class EChartsFenceError extends Error {
  constructor(
    readonly code: EChartsFenceErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "EChartsFenceError";
  }
}
