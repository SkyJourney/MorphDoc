const PREPARED_ATTRIBUTE = "data-code-pagination-prepared";
const CHUNK_CLASS = "md-code-pagination-chunk";
const CHUNK_POSITION_ATTRIBUTE = "data-code-pagination-position";
const LINE_GROUP_CLASS = "md-code-line-group";
const LINE_CLASS = "md-code-line";
const LINE_INDENT_CLASS = "md-code-line-indent";

function splitNodeIntoLines(node: Node): Node[][] {
  const documentRef = node.ownerDocument;
  if (!documentRef) {
    throw new Error("代码块分页节点缺少 ownerDocument");
  }
  if (node.nodeType === node.TEXT_NODE) {
    return (node.textContent ?? "").split("\n").map((text) => [
      documentRef.createTextNode(text)
    ]);
  }

  if (node.nodeType !== node.ELEMENT_NODE) {
    return [[node.cloneNode(true)]];
  }

  const lineChildren = splitNodesIntoLines(
    Array.from(node.childNodes)
  );
  return lineChildren.map((children) => {
    const clone = node.cloneNode(false) as Element;
    clone.append(...children);
    return [clone];
  });
}

function splitNodesIntoLines(nodes: Node[]): Node[][] {
  const lines: Node[][] = [[]];

  for (const node of nodes) {
    const nodeLines = splitNodeIntoLines(node);
    lines.at(-1)?.push(...(nodeLines[0] ?? []));
    for (const line of nodeLines.slice(1)) {
      lines.push([...line]);
    }
  }

  return lines;
}

function lineHasContent(nodes: Node[]) {
  return nodes.some((node) => (node.textContent ?? "").length > 0);
}

function stabilizeLeadingWhitespace(
  documentRef: Document,
  nodes: Node[]
) {
  let indent = "";
  let index = 0;
  for (; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node || node.nodeType !== node.TEXT_NODE) {
      break;
    }
    const value = node.textContent ?? "";
    const match = value.match(/^[\t ]+/u);
    if (!match) {
      if (value.length === 0) {
        continue;
      }
      break;
    }
    indent += match[0];
    const remainder = value.slice(match[0].length);
    if (remainder) {
      node.textContent = remainder;
      break;
    }
  }
  if (!indent) {
    return nodes;
  }
  const indentElement = documentRef.createElement("span");
  indentElement.className = LINE_INDENT_CLASS;
  let columns = 0;
  for (const character of indent) {
    columns = character === "\t"
      ? columns + (4 - columns % 4)
      : columns + 1;
  }
  indentElement.dataset.codeIndentColumns = String(columns);
  indentElement.style.width = `${columns}ch`;
  indentElement.textContent = indent;
  return [
    indentElement,
    ...nodes.slice(index).filter(
      (node) =>
        node.nodeType !== node.TEXT_NODE ||
        (node.textContent ?? "").length > 0
    )
  ];
}

function createLineGroups(
  documentRef: Document,
  lines: Node[][]
) {
  const groups: HTMLElement[] = [];
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const remaining = lines.length - lineIndex;
    const groupSize =
      remaining === 1 ? 1 : remaining === 3 ? 3 : 2;
    const group = documentRef.createElement("span");
    group.className = LINE_GROUP_CLASS;

    for (
      let offset = 0;
      offset < groupSize && lineIndex < lines.length;
      offset += 1, lineIndex += 1
    ) {
      const line = documentRef.createElement("span");
      line.className = LINE_CLASS;
      line.append(
        ...stabilizeLeadingWhitespace(
          documentRef,
          lines[lineIndex] ?? []
        )
      );
      group.append(line);
    }

    groups.push(group);
  }

  return groups;
}

export function prepareCodeBlockPagination(root: ParentNode) {
  const codeBlocks = Array.from(
    root.querySelectorAll<HTMLElement>(
      `pre.md-fences:not([${PREPARED_ATTRIBUTE}])`
    )
  );

  for (const codeBlock of codeBlocks) {
    const code = codeBlock.querySelector<HTMLElement>(
      ":scope > code"
    );
    if (!code) {
      continue;
    }

    const sourceEndsWithNewline =
      code.textContent?.endsWith("\n") ?? false;
    const lines = splitNodesIntoLines(Array.from(code.childNodes));
    if (
      sourceEndsWithNewline &&
      lines.length > 1 &&
      !lineHasContent(lines.at(-1) ?? [])
    ) {
      lines.pop();
    }

    const groups = createLineGroups(code.ownerDocument, lines);
    const chunks = groups.map((group, index) => {
      const chunk = code.ownerDocument.createElement("div");
      for (const attribute of Array.from(codeBlock.attributes)) {
        chunk.setAttribute(attribute.name, attribute.value);
      }
      chunk.classList.add(CHUNK_CLASS);
      chunk.setAttribute(PREPARED_ATTRIBUTE, "true");
      chunk.setAttribute(
        CHUNK_POSITION_ATTRIBUTE,
        groups.length === 1
          ? "only"
          : index === 0
            ? "first"
            : index === groups.length - 1
              ? "last"
              : "middle"
      );

      const chunkCode = code.cloneNode(false) as HTMLElement;
      chunkCode.append(group);
      chunk.append(chunkCode);
      return chunk;
    });

    codeBlock.replaceWith(...chunks);
  }
}
