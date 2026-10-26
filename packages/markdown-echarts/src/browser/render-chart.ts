import { echartsDomContract } from "../dom-contract.js";
import {
  DEFAULT_ECHARTS_FENCE_HEIGHT,
  EChartsFenceError,
  echartsFenceSpecSchema,
  type NormalizedEChartsFenceSpec
} from "../protocol.js";
import {
  normalizeAndValidateEChartsOption
} from "../security-policy.js";
import {
  validateAndApplyEChartsOptionDefaults
} from "../semantic-validator.js";
import { defaultEChartsEngine } from "./engine.js";
import { freezeEChartsSvg } from "./freeze-svg.js";
import type {
  EChartsBlockRenderOutcome,
  EChartsInstanceLike,
  EChartsOutputMode,
  RenderEChartsBlockOptions
} from "./types.js";

interface ActiveChart {
  instance: EChartsInstanceLike;
  observer?: ResizeObserver;
}

const activeCharts = new WeakMap<HTMLElement, ActiveChart>();

function abortError() {
  return new DOMException("ECharts 渲染已取消", "AbortError");
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw abortError();
  }
}

function normalizeDefinition(value: unknown): NormalizedEChartsFenceSpec {
  const protocolResult = echartsFenceSpecSchema.safeParse(value);
  if (!protocolResult.success) {
    throw new EChartsFenceError(
      "INVALID_PROTOCOL",
      "ECharts 占位节点中的协议无效"
    );
  }
  const normalized: NormalizedEChartsFenceSpec = {
    version: protocolResult.data.version,
    theme: protocolResult.data.theme,
    option: validateAndApplyEChartsOptionDefaults(
      normalizeAndValidateEChartsOption(
        protocolResult.data.option
      )
    )
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

function readDefinition(element: HTMLElement) {
  const definition = element.querySelector<HTMLElement>(
    `.${echartsDomContract.definitionClass}`
  );
  if (!definition) {
    throw new Error("缺少 ECharts 配置节点");
  }
  try {
    return normalizeDefinition(
      JSON.parse(definition.textContent ?? "")
    );
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("ECharts 配置节点无法解析");
  }
}

function applyChartSize(
  host: HTMLElement,
  definition: NormalizedEChartsFenceSpec
) {
  host.style.width = "100%";
  if (definition.height !== undefined) {
    host.style.height = definition.height;
    host.style.removeProperty("aspect-ratio");
    return;
  }
  host.style.removeProperty("height");
  host.style.aspectRatio = String(definition.aspectRatio);
}

function resolveDefaultTheme(
  theme: NormalizedEChartsFenceSpec["theme"]
) {
  return theme === "dark" ? "dark" : undefined;
}

function nextFrame(element: HTMLElement) {
  const requestFrame =
    element.ownerDocument.defaultView?.requestAnimationFrame;
  if (!requestFrame) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    requestFrame(() => resolve());
  });
}

async function waitForRender(
  instance: EChartsInstanceLike,
  host: HTMLElement,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  setOption: () => void
) {
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  let finishedHandler: (() => void) | undefined;

  const completion = new Promise<void>((resolve, reject) => {
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      resolve();
    };
    const fail = (error: Error) => {
      if (finished) {
        return;
      }
      finished = true;
      reject(error);
    };
    finishedHandler = finish;
    instance.on("finished", finishedHandler);
    timer = setTimeout(
      () => fail(new Error(`ECharts 渲染超过 ${timeoutMs}ms`)),
      timeoutMs
    );
    abortHandler = () => fail(abortError());
    signal?.addEventListener("abort", abortHandler, { once: true });

    try {
      setOption();
    } catch (error) {
      fail(
        error instanceof Error
          ? error
          : new Error("ECharts setOption 失败")
      );
    }
  });

  try {
    await Promise.race([
      completion,
      (async () => {
        await nextFrame(host);
        await nextFrame(host);
        if (!host.querySelector("svg")) {
          await completion;
        }
      })()
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (abortHandler) {
      signal?.removeEventListener("abort", abortHandler);
    }
    if (finishedHandler) {
      instance.off("finished", finishedHandler);
    }
  }
}

function storeInteractiveChart(
  element: HTMLElement,
  host: HTMLElement,
  instance: EChartsInstanceLike
) {
  let observer: ResizeObserver | undefined;
  const ResizeObserverConstructor =
    element.ownerDocument.defaultView?.ResizeObserver;
  if (ResizeObserverConstructor) {
    observer = new ResizeObserverConstructor(() => instance.resize());
    observer.observe(host);
  }
  const active: ActiveChart = { instance };
  if (observer !== undefined) {
    active.observer = observer;
  }
  activeCharts.set(element, active);
}

function showRenderError(element: HTMLElement, error: Error) {
  element.removeAttribute(echartsDomContract.pendingAttribute);
  element.classList.add(echartsDomContract.errorClass);
  const host = element.querySelector<HTMLElement>(
    `.${echartsDomContract.hostClass}`
  );
  if (host) {
    host.setAttribute("role", "alert");
    host.textContent = `ECharts 图表渲染失败：${error.message}`;
  }
}

export function disposeEChartsBlock(element: HTMLElement) {
  const active = activeCharts.get(element);
  if (!active) {
    return;
  }
  active.observer?.disconnect();
  active.instance.dispose();
  activeCharts.delete(element);
}

export async function renderEChartsBlock(
  element: HTMLElement,
  options: RenderEChartsBlockOptions = {}
): Promise<EChartsBlockRenderOutcome> {
  const startedAt = performance.now();
  const outputMode: EChartsOutputMode =
    options.outputMode ?? "inline-svg";
  let instance: EChartsInstanceLike | undefined;

  try {
    throwIfAborted(options.signal);
    disposeEChartsBlock(element);

    const definition = readDefinition(element);
    const host = element.querySelector<HTMLElement>(
      `.${echartsDomContract.hostClass}`
    );
    if (!host) {
      throw new Error("缺少 ECharts 渲染容器");
    }

    applyChartSize(host, definition);
    const fonts = element.ownerDocument.fonts;
    if (fonts) {
      await fonts.ready;
    }
    throwIfAborted(options.signal);

    const engine = options.engine ?? defaultEChartsEngine;
    const theme =
      options.resolveTheme?.(definition.theme, element) ??
      resolveDefaultTheme(definition.theme);
    instance = engine.init(host, theme, {
      renderer: "svg",
      useDirtyRect: false
    });

    const series = Array.isArray(definition.option.series)
      ? definition.option.series.map((item) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? {
                ...item,
                animation: false,
                animationDelay: 0,
                animationDelayUpdate: 0,
                animationDuration: 0,
                animationDurationUpdate: 0
              }
            : item
        )
      : definition.option.series;
    const option = {
      ...definition.option,
      animation: false,
      animationDelay: 0,
      animationDelayUpdate: 0,
      animationDuration: 0,
      animationDurationUpdate: 0,
      series
    };
    await waitForRender(
      instance,
      host,
      options.timeoutMs ?? 5_000,
      options.signal,
      () => instance?.setOption(option, { notMerge: true })
    );
    throwIfAborted(options.signal);

    if (outputMode === "interactive") {
      storeInteractiveChart(element, host, instance);
      element.removeAttribute(echartsDomContract.pendingAttribute);
      element.dataset.echartsRendered = "interactive";
      return {
        element,
        outputMode,
        success: true,
        durationMs: performance.now() - startedAt,
        instance
      };
    }

    const svg = host.querySelector<SVGSVGElement>("svg");
    if (!svg) {
      throw new Error("ECharts 未生成 SVG");
    }
    const frozenOutput = freezeEChartsSvg(
      host,
      svg,
      outputMode,
      definition.caption ?? "ECharts 图表"
    );
    instance.dispose();
    instance = undefined;
    host.replaceChildren(frozenOutput);
    element.removeAttribute(echartsDomContract.pendingAttribute);
    element.dataset.echartsRendered = outputMode;
    return {
      element,
      outputMode,
      success: true,
      durationMs: performance.now() - startedAt
    };
  } catch (error) {
    instance?.dispose();
    const normalizedError =
      error instanceof Error
        ? error
        : new Error("未知 ECharts 渲染错误");
    showRenderError(element, normalizedError);
    return {
      element,
      outputMode,
      success: false,
      durationMs: performance.now() - startedAt,
      error: normalizedError
    };
  }
}
