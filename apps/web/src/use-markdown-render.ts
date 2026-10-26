import { useEffect, useState } from "react";
import type { RenderedMarkdownDocument } from "@morphdoc/core";
import { renderMarkdownDocument } from "./application-backend";
import type { MarkdownImageResource } from "./application-backend";

export interface MarkdownRenderCallbacks {
  onRenderStart?: () => void;
  onStatusChange?: (status: string) => void;
}

export function useMarkdownRender(
  markdown: string,
  language: string,
  resources: MarkdownImageResource[],
  callbacks: MarkdownRenderCallbacks = {}
) {
  const [result, setResult] =
    useState<RenderedMarkdownDocument | null>(null);
  const [error, setError] = useState("");
  const { onRenderStart, onStatusChange } = callbacks;

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      onStatusChange?.("正在渲染…");
      onRenderStart?.();
      setError("");

      void renderMarkdownDocument(
        { markdown, language, resources },
        controller.signal
      )
        .then((payload) => {
          setResult(payload);
          onStatusChange?.("预览已更新");
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) {
            setError(
              reason instanceof Error ? reason.message : "渲染失败"
            );
            onStatusChange?.("预览失败");
          }
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    language,
    markdown,
    onRenderStart,
    onStatusChange,
    resources
  ]);

  return { error, result };
}
