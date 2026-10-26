import type {
  DocumentProfileName,
  FooterConfig,
  HeaderConfig,
  PageMargins,
  RenderedMarkdownDocument,
  ThemeCategory
} from "@morphdoc/core";

export interface ThemeSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  category: ThemeCategory;
  compatibleProfiles: DocumentProfileName[];
  pageDefaults?: {
    margins: PageMargins;
    header?: HeaderConfig;
    footer?: FooterConfig;
  };
  bundled: boolean;
  source: "bundled" | "local";
}

export interface MarkdownRenderInput {
  markdown: string;
  language: string;
  resources?: MarkdownImageResource[];
}

export interface MarkdownImageResource {
  path: string;
  data: string;
}

function throwIfAborted(signal?: AbortSignal) {
  signal?.throwIfAborted();
}

async function readErrorMessage(
  response: Response,
  fallback: string
) {
  try {
    const payload = (await response.json()) as { message?: unknown };
    return typeof payload.message === "string"
      ? payload.message
      : fallback;
  } catch {
    return fallback;
  }
}

export async function renderMarkdownDocument(
  input: MarkdownRenderInput,
  signal?: AbortSignal
) {
  throwIfAborted(signal);
  if (window.morphDocDesktop) {
    const result = await window.morphDocDesktop.renderMarkdown(input);
    throwIfAborted(signal);
    return result;
  }

  const response = await fetch("/api/render", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {})
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "渲染失败"));
  }
  return response.json() as Promise<RenderedMarkdownDocument>;
}

export async function listThemes(signal?: AbortSignal) {
  throwIfAborted(signal);
  if (window.morphDocDesktop) {
    const result = await window.morphDocDesktop.listThemes();
    throwIfAborted(signal);
    return result;
  }

  const response = await fetch("/api/themes", {
    ...(signal ? { signal } : {})
  });
  if (!response.ok) {
    throw new Error("无法加载主题清单");
  }
  return response.json() as Promise<{ themes: ThemeSummary[] }>;
}

export async function getThemeCss(
  themeId: string,
  signal?: AbortSignal
) {
  throwIfAborted(signal);
  if (window.morphDocDesktop) {
    const result = await window.morphDocDesktop.getThemeCss(themeId);
    throwIfAborted(signal);
    return result;
  }

  const response = await fetch(
    `/api/themes/${encodeURIComponent(themeId)}/css`,
    { ...(signal ? { signal } : {}) }
  );
  if (!response.ok) {
    throw new Error("无法加载主题");
  }
  return response.text();
}
