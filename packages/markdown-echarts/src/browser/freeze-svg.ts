import { echartsDomContract } from "../dom-contract.js";
import { cloneSafeEChartsSvg } from "./resource-policy.js";
import type { EChartsOutputMode } from "./types.js";

function svgDataUrl(serialized: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
}

export function freezeEChartsSvg(
  host: HTMLElement,
  source: SVGSVGElement,
  outputMode: Exclude<EChartsOutputMode, "interactive">,
  label: string
) {
  const svg = cloneSafeEChartsSvg(source);
  svg.removeAttribute("style");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.display = "block";

  if (outputMode === "inline-svg") {
    return svg;
  }

  const image = host.ownerDocument.createElement("img");
  image.className = `${echartsDomContract.figureClass}-svg-image`;
  image.alt = label;
  image.src = svgDataUrl(new XMLSerializer().serializeToString(svg));
  image.style.width = "100%";
  image.style.height = "100%";
  image.style.objectFit = "contain";
  image.style.display = "block";
  return image;
}
