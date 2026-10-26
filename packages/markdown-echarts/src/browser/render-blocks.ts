import { echartsDomContract } from "../dom-contract.js";
import {
  disposeEChartsBlock,
  renderEChartsBlock
} from "./render-chart.js";
import type {
  EChartsBlockRenderOutcome,
  RenderEChartsBlocksOptions
} from "./types.js";

export async function renderEChartsBlocks(
  root: ParentNode,
  options: RenderEChartsBlocksOptions = {}
) {
  const elements = Array.from(
    root.querySelectorAll<HTMLElement>(
      `.${echartsDomContract.figureClass}[${echartsDomContract.pendingAttribute}]`
    )
  );
  const outcomes = new Array<EChartsBlockRenderOutcome>(
    elements.length
  );
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? 2, elements.length || 1)
  );
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < elements.length) {
      const index = nextIndex;
      nextIndex += 1;
      const element = elements[index];
      if (!element) {
        continue;
      }
      const outcome = await renderEChartsBlock(element, options);
      outcomes[index] = outcome;
      if (!outcome.success && outcome.error) {
        options.onError?.(outcome.error, element, index);
      }
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, () => worker())
  );
  return outcomes;
}

export function disposeEChartsBlocks(root: ParentNode) {
  const elements = root.querySelectorAll<HTMLElement>(
    `.${echartsDomContract.figureClass}`
  );
  for (const element of elements) {
    disposeEChartsBlock(element);
  }
}
