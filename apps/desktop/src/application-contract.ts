import type { MarkdownRenderRequest } from "@morphdoc/application";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseMarkdownRenderRequest(
  value: unknown
): MarkdownRenderRequest {
  if (!isRecord(value)) {
    return {};
  }
  return {
    markdown: value.markdown,
    language: value.language,
    resources: value.resources
  };
}

export function parseThemeId(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(value)
  ) {
    throw new Error("主题 ID 无效");
  }
  return value;
}

export function parseThemeResourceUrl(requestUrl: string) {
  const url = new URL(requestUrl);
  if (url.protocol !== "morphdoc:" || url.host !== "theme") {
    return undefined;
  }

  let segments: string[];
  try {
    segments = url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    throw new Error("主题资源地址无效");
  }
  const [unsafeThemeId, ...assetSegments] = segments;
  if (!unsafeThemeId || assetSegments.length === 0) {
    throw new Error("主题资源地址无效");
  }

  return {
    themeId: parseThemeId(unsafeThemeId),
    assetPath: assetSegments.join("/")
  };
}

export function parseFontPackResourceUrl(requestUrl: string) {
  const url = new URL(requestUrl);
  if (url.protocol !== "morphdoc:" || url.host !== "font-pack") {
    return undefined;
  }
  let segments: string[];
  try {
    segments = url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    throw new Error("字体包资源地址无效");
  }
  const [packId, packVersion, faceId, kind, ...extra] = segments;
  if (
    !packId ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(packId) ||
    !packVersion ||
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(packVersion) ||
    !faceId ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(faceId) ||
    kind !== "web" ||
    extra.length > 0
  ) {
    throw new Error("字体包资源地址无效");
  }
  return { packId, packVersion, faceId, kind } as const;
}
