import type { ExportConfig } from "@morphdoc/core";
import { fitSvgDiagramsToPage } from "./diagram-page-fit.js";

export function fitOversizedEChartsToPage(
  container: ParentNode,
  config: ExportConfig
) {
  fitSvgDiagramsToPage(container, config, {
    containerSelector: ".md-echarts",
    svgSelector: ".md-echarts-host svg",
    resolvePageContent(figure, pageContent) {
      const host = figure.querySelector<HTMLElement>(
        ".md-echarts-host"
      );
      const figureHeight = figure.getBoundingClientRect().height;
      const hostHeight = host?.getBoundingClientRect().height ?? 0;
      const nonChartHeight = Math.max(
        0,
        figureHeight - hostHeight
      );
      return {
        width: pageContent.width,
        height: Math.max(0, pageContent.height - nonChartHeight)
      };
    },
    onFit(figure, _svg, fit) {
      const host = figure.querySelector<HTMLElement>(
        ".md-echarts-host"
      );
      if (!host) {
        return;
      }
      host.style.setProperty(
        "width",
        `${fit.width}px`,
        "important"
      );
      host.style.setProperty(
        "height",
        `${fit.height}px`,
        "important"
      );
      host.style.setProperty("margin-inline", "auto", "important");
      host.style.removeProperty("aspect-ratio");
    }
  });
}
