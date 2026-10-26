const ELEMENT_NODE_TYPE = 1;

export function resolveBreakTokenElement(
  node: Node | undefined
): Element | undefined {
  if (!node) {
    return undefined;
  }

  if (node.nodeType === ELEMENT_NODE_TYPE) {
    return node as Element;
  }

  return node.parentElement ?? undefined;
}
