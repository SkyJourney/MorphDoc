export function createSvgDataUrl(svgMarkup: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
}

export interface MermaidBoxSize {
  width: number;
  height: number;
}

export type MermaidOutputMode = "inline-svg" | "svg-image";

export function resolveMermaidOutputMode(
  search: string
): MermaidOutputMode {
  return new URLSearchParams(search).get("mermaid-output") ===
    "inline-svg"
    ? "inline-svg"
    : "svg-image";
}

export function getLockedMermaidBoxSize(
  size: MermaidBoxSize
): MermaidBoxSize | undefined {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    return undefined;
  }

  return size;
}

export function getMermaidImageAlt(
  ariaLabel: string | null,
  title: string | null
) {
  return ariaLabel?.trim() || title?.trim() || "Mermaid 图表";
}

export function replaceMermaidSvgWithImages(container: ParentNode) {
  const diagrams = Array.from(
    container.querySelectorAll<HTMLElement>(".mermaid")
  );

  for (const diagram of diagrams) {
    const svg = diagram.querySelector<SVGSVGElement>("svg");
    if (!svg) {
      continue;
    }

    const documentWindow = svg.ownerDocument.defaultView;
    const svgRect = svg.getBoundingClientRect();
    const diagramRect = diagram.getBoundingClientRect();
    const computedStyle = documentWindow?.getComputedStyle(svg);
    const lockedSvgSize = getLockedMermaidBoxSize(svgRect);
    const lockedDiagramSize = getLockedMermaidBoxSize(diagramRect);
    const image = svg.ownerDocument.createElement("img");
    image.className = "mermaid-svg-image";
    image.alt = getMermaidImageAlt(
      svg.getAttribute("aria-label"),
      svg.querySelector("title")?.textContent ?? null
    );
    image.src = createSvgDataUrl(
      new XMLSerializer().serializeToString(svg)
    );
    image.style.cssText = svg.style.cssText;
    if (computedStyle?.display) {
      image.style.setProperty("display", computedStyle.display, "important");
    }
    if (computedStyle?.verticalAlign) {
      image.style.setProperty(
        "vertical-align",
        computedStyle.verticalAlign,
        "important"
      );
    }
    if (lockedSvgSize) {
      const width = `${lockedSvgSize.width}px`;
      const height = `${lockedSvgSize.height}px`;
      image.style.setProperty("width", width, "important");
      image.style.setProperty("height", height, "important");
      image.style.setProperty("max-width", width, "important");
      image.style.setProperty("max-height", height, "important");
      image.setAttribute("width", String(lockedSvgSize.width));
      image.setAttribute("height", String(lockedSvgSize.height));
    }
    if (lockedDiagramSize) {
      diagram.style.setProperty("box-sizing", "border-box", "important");
      diagram.style.setProperty(
        "height",
        `${lockedDiagramSize.height}px`,
        "important"
      );
    }
    svg.replaceWith(image);
  }
}
