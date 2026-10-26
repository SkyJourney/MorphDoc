import type { ExportConfig } from "@morphdoc/core";
import {
  calculateDiagramPageFit,
  fitSvgDiagramsToPage,
  getPageContentDimensions,
  parseSvgViewBox,
  type DiagramDimensions,
  type DiagramPageFit
} from "./diagram-page-fit.js";

export type MermaidDimensions = DiagramDimensions;
export type MermaidPageFit = DiagramPageFit;
export {
  getPageContentDimensions,
  parseSvgViewBox
};
export const calculateMermaidPageFit = calculateDiagramPageFit;

export function fitOversizedMermaidToPage(
  container: ParentNode,
  config: ExportConfig
) {
  fitSvgDiagramsToPage(container, config, {
    containerSelector: ".mermaid"
  });
}
