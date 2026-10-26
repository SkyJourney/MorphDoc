import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const markdownExtensions = new Set([".md", ".markdown"]);

export interface OpenedMarkdownDocument {
  markdown: string;
  fileName: string;
}

export interface MarkdownFileSnapshot {
  document: OpenedMarkdownDocument;
  filePath: string;
  documentKey: string;
  contentHash: string;
}

export function createMarkdownContentHash(markdown: string) {
  return createHash("sha256").update(markdown, "utf8").digest("hex");
}

export function createMarkdownDocumentKey(filePath: string) {
  const normalized = path.normalize(filePath);
  return process.platform === "win32"
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

export function isMarkdownFilePath(filePath: string) {
  return markdownExtensions.has(path.extname(filePath).toLowerCase());
}

export function findMarkdownFileArgument(
  arguments_: string[],
  workingDirectory: string
) {
  for (const argument of arguments_) {
    if (!argument || argument.startsWith("-")) {
      continue;
    }
    const candidate = path.isAbsolute(argument)
      ? path.normalize(argument)
      : path.resolve(workingDirectory, argument);
    if (isMarkdownFilePath(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export async function readMarkdownDocument(
  filePath: string,
  maximumLength: number
): Promise<OpenedMarkdownDocument> {
  if (!isMarkdownFilePath(filePath)) {
    throw new Error("只允许打开 .md 或 .markdown 文件");
  }
  if (!Number.isSafeInteger(maximumLength) || maximumLength <= 0) {
    throw new Error("Markdown 长度限制无效");
  }

  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) {
    throw new Error("Markdown 路径不是文件");
  }
  if (fileStats.size > maximumLength * 4) {
    throw new Error("Markdown 文件过大");
  }

  const markdown = await readFile(filePath, "utf8");
  if (markdown.length > maximumLength) {
    throw new Error("Markdown 文件过大");
  }
  return {
    markdown,
    fileName: path.basename(filePath)
  };
}

export async function readMarkdownFileSnapshot(
  filePath: string,
  maximumLength: number
): Promise<MarkdownFileSnapshot> {
  const canonicalPath = await realpath(filePath);
  const document = await readMarkdownDocument(
    canonicalPath,
    maximumLength
  );
  return {
    document,
    filePath: canonicalPath,
    documentKey: createMarkdownDocumentKey(canonicalPath),
    contentHash: createMarkdownContentHash(document.markdown)
  };
}
