import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyDocumentLink } from "@morphdoc/core";

export type DesktopDocumentLinkAction =
  | {
      type: "anchor";
      href: string;
    }
  | {
      type: "external";
      href: string;
    }
  | {
      type: "local";
      filePath: string;
    }
  | {
      type: "ignore";
    };

function decodeLocalPath(href: string) {
  const pathOnly = href.split(/[?#]/u, 1)[0] ?? "";
  try {
    return decodeURIComponent(pathOnly);
  } catch {
    throw new Error("本地链接的 URL 编码无效");
  }
}

export function resolveDesktopDocumentLinkAction(
  href: string,
  markdownFilePath?: string
): DesktopDocumentLinkAction {
  const link = classifyDocumentLink(href);
  if (link.kind === "anchor") {
    return { type: "anchor", href: link.normalizedHref };
  }
  if (link.kind === "network" || link.kind === "protocol") {
    return { type: "external", href: link.normalizedHref };
  }
  if (link.kind !== "local") {
    return { type: "ignore" };
  }

  if (link.scheme === "file") {
    try {
      return {
        type: "local",
        filePath: path.normalize(fileURLToPath(new URL(link.href)))
      };
    } catch {
      throw new Error("file: 链接格式无效");
    }
  }

  const decoded = decodeLocalPath(link.href);
  if (path.isAbsolute(decoded) || /^[a-z]:[\\/]/iu.test(decoded)) {
    return { type: "local", filePath: path.normalize(decoded) };
  }
  if (!markdownFilePath) {
    throw new Error("当前文档尚未保存，无法解析相对本地链接");
  }
  return {
    type: "local",
    filePath: path.resolve(path.dirname(markdownFilePath), decoded)
  };
}
