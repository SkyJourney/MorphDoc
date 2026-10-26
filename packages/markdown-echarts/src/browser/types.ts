import type {
  NormalizedEChartsFenceSpec
} from "../protocol.js";

export type EChartsOutputMode =
  | "interactive"
  | "inline-svg"
  | "svg-image";

export interface EChartsInstanceLike {
  setOption(option: unknown, options?: { notMerge?: boolean }): void;
  on(eventName: string, handler: () => void): void;
  off(eventName: string, handler: () => void): void;
  resize(): void;
  dispose(): void;
}

export interface EChartsEngine {
  init(
    container: HTMLElement,
    theme: string | object | null | undefined,
    options: {
      renderer: "svg";
      width?: number | string;
      height?: number | string;
      devicePixelRatio?: number;
      useDirtyRect?: boolean;
    }
  ): EChartsInstanceLike;
}

export interface RenderEChartsBlockOptions {
  engine?: EChartsEngine;
  outputMode?: EChartsOutputMode;
  timeoutMs?: number;
  signal?: AbortSignal;
  resolveTheme?: (
    theme: NormalizedEChartsFenceSpec["theme"],
    element: HTMLElement
  ) => string | object | null | undefined;
}

export interface RenderEChartsBlocksOptions
  extends RenderEChartsBlockOptions {
  concurrency?: number;
  onError?: (
    error: Error,
    element: HTMLElement,
    index: number
  ) => void;
}

export interface EChartsBlockRenderOutcome {
  element: HTMLElement;
  outputMode: EChartsOutputMode;
  success: boolean;
  durationMs: number;
  error?: Error;
  instance?: EChartsInstanceLike;
}
