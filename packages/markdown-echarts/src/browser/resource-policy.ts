const forbiddenSvgElements = [
  "script",
  "foreignObject",
  "iframe",
  "object",
  "embed"
] as const;

const urlFunctionPattern = /url\(\s*(['"]?)(.*?)\1\s*\)/giu;

function assertSafeUrlValue(value: string, context: string) {
  for (const match of value.matchAll(urlFunctionPattern)) {
    const target = match[2]?.trim() ?? "";
    if (!target.startsWith("#")) {
      throw new Error(`${context} 包含外部 SVG 资源`);
    }
  }
}

function assertSafeHref(value: string, context: string) {
  const normalized = value.trim();
  if (normalized && !normalized.startsWith("#")) {
    throw new Error(`${context} 包含外部 SVG 链接`);
  }
}

export function cloneSafeEChartsSvg(
  source: SVGSVGElement
): SVGSVGElement {
  const clone = source.cloneNode(true) as SVGSVGElement;
  if (clone.querySelector(forbiddenSvgElements.join(","))) {
    throw new Error("ECharts SVG 包含禁止元素");
  }

  for (const element of [clone, ...clone.querySelectorAll("*")]) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "href" || name === "xlink:href") {
        assertSafeHref(attribute.value, attribute.name);
        continue;
      }
      assertSafeUrlValue(attribute.value, attribute.name);
    }
    if (
      element.tagName.toLowerCase() === "style" &&
      /@import|url\(\s*(?!['"]?#)/iu.test(element.textContent ?? "")
    ) {
      throw new Error("ECharts SVG 样式包含外部资源");
    }
  }

  return clone;
}
