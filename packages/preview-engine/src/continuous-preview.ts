export function findCommonPrefixLength(
  previous: readonly string[],
  next: readonly string[]
) {
  const maximum = Math.min(previous.length, next.length);
  let index = 0;
  while (index < maximum && previous[index] === next[index]) {
    index += 1;
  }
  return index;
}

export function createNodeSignature(node: Node) {
  if (node instanceof Element) {
    return `element:${node.outerHTML}`;
  }
  return `node:${node.nodeType}:${node.textContent ?? ""}`;
}

export function mountContinuousRenderStage(
  root: HTMLElement,
  articleTemplate: HTMLElement,
  content: DocumentFragment
) {
  const article = articleTemplate.cloneNode(false) as HTMLElement;
  article.dataset.continuousRenderStage = "true";
  article.append(content);
  root.append(article);

  return {
    article,
    takeContent() {
      const rendered = article.ownerDocument.createDocumentFragment();
      rendered.append(...Array.from(article.childNodes));
      return rendered;
    },
    dispose() {
      article.remove();
    }
  };
}
