const fallbackBaseName = "未命名文档";
const windowsReservedName =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

function stripMarkdownFormatting(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/<\/?[A-Za-z][^>]*>/gu, " ")
    .replace(/[`*_~]/gu, "")
    .replace(/^\s{0,3}(?:>\s*|[-+*]\s+|\d+[.)]\s+)/u, "")
    .trim();
}

export function legalizeMarkdownBaseName(value: string) {
  const normalized = stripMarkdownFormatting(value)
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[ .]+$/u, "");
  const shortened = Array.from(normalized).slice(0, 100).join("").trim();
  if (!shortened) {
    return fallbackBaseName;
  }
  return windowsReservedName.test(shortened)
    ? `文档 ${shortened}`
    : shortened;
}

export function deriveMarkdownBaseName(markdown: string) {
  const lines = markdown.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  let inFrontMatter = lines[0]?.trim() === "---";
  let inFence = false;
  let fenceMarker = "";
  let fenceLength = 0;
  let firstBodyLine = "";

  for (let index = inFrontMatter ? 1 : 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (inFrontMatter) {
      if (trimmed === "---" || trimmed === "...") {
        inFrontMatter = false;
      }
      continue;
    }

    if (inFence) {
      const closingFence = trimmed.match(/^(`+|~+)\s*$/u)?.[1];
      if (
        closingFence?.[0] === fenceMarker &&
        closingFence.length >= fenceLength
      ) {
        inFence = false;
        fenceMarker = "";
        fenceLength = 0;
      }
      continue;
    }

    const fence = trimmed.match(/^(`{3,}|~{3,})/u)?.[1];
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[0] ?? "";
        fenceLength = fence.length;
      }
      continue;
    }
    if (inFence || !trimmed) {
      continue;
    }

    const heading = line.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/u)?.[1];
    if (heading) {
      return legalizeMarkdownBaseName(heading);
    }
    if (!firstBodyLine) {
      firstBodyLine = line;
    }
  }

  return legalizeMarkdownBaseName(firstBodyLine);
}

export function createMarkdownFileName(markdown: string) {
  return `${deriveMarkdownBaseName(markdown)}.md`;
}

export function ensureMarkdownFileName(fileName: string, markdown: string) {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return createMarkdownFileName(markdown);
  }
  return /\.(?:md|markdown)$/iu.test(trimmed)
    ? trimmed
    : `${trimmed}.md`;
}

export function downloadMarkdown(markdown: string, fileName: string) {
  const url = URL.createObjectURL(
    new Blob([markdown], { type: "text/markdown;charset=utf-8" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
