import echartsCss from "@morphdoc/markdown-echarts/styles.css?inline";
import {
  isPagedPreviewRenderRequest,
  PAGED_PREVIEW_MESSAGE_SCOPE,
  PagedDocumentRuntime,
  SHARED_HIGHLIGHT_CSS,
  renderDocxMediaCapturePlan,
  resolveMermaidOutputMode,
  resolvePagedRenderTarget,
  type PagedPreviewFrameMessage,
  type PagedPreviewPayload
} from "@morphdoc/preview-engine";
import katexCss from "katex/dist/katex.min.css?inline";
import {
  beginPreviewFrameRender,
  completePreviewFrameRender
} from "./preview-frame-visibility";
import { withHiddenWindowAnimationFrames } from "./hidden-window-animation-frame";

function getPreviewRoot() {
  const element = document.querySelector<HTMLElement>("#preview-root");
  if (!element) {
    throw new Error("分页预览容器不存在");
  }
  return element;
}

const previewRoot = getPreviewRoot();
const renderTarget = resolvePagedRenderTarget(window.location.search);
const mermaidOutput = resolveMermaidOutputMode(window.location.search);
const runtime = new PagedDocumentRuntime(previewRoot, {
  highlightCss: SHARED_HIGHLIGHT_CSS,
  katexCss,
  echartsCss
});
document.documentElement.dataset.renderTarget = renderTarget;

let latestRequestId = 0;
let renderQueue = Promise.resolve();

function post(message: PagedPreviewFrameMessage) {
  window.parent.postMessage(message, window.location.origin);
}

function measurePreviewContentHeight() {
  const rootRect = previewRoot.getBoundingClientRect();
  const documentRect =
    document.documentElement.getBoundingClientRect();
  return Math.ceil(
    Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      previewRoot.scrollHeight,
      rootRect.bottom - documentRect.top
    )
  );
}

document.addEventListener(
  "click",
  (event) => {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>("a[href]")
        : undefined;
    const href = target?.getAttribute("href")?.trim();
    if (!href) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    post({
      scope: PAGED_PREVIEW_MESSAGE_SCOPE,
      type: "link",
      href
    });
  },
  { capture: true }
);

async function renderPagedPreview(
  requestId: number,
  payload: PagedPreviewPayload,
  layout: "paged" | "continuous"
) {
  if (requestId !== latestRequestId) {
    return;
  }

  beginPreviewFrameRender(document.documentElement, requestId);
  post({
    scope: PAGED_PREVIEW_MESSAGE_SCOPE,
    type: "rendering",
    requestId,
    layout
  });

  try {
    const result =
      layout === "continuous"
        ? await runtime.renderContinuous(payload, {
            shouldContinue: () => requestId === latestRequestId
          })
        : await runtime.render(payload, {
            target: renderTarget,
            mermaidOutput,
            shouldContinue: () => requestId === latestRequestId
          });
    if (!result) {
      return;
    }

    post({
      scope: PAGED_PREVIEW_MESSAGE_SCOPE,
      type: "rendered",
      requestId,
      layout,
      contentHeight: measurePreviewContentHeight(),
      ...result
    });
  } finally {
    if (requestId === latestRequestId) {
      completePreviewFrameRender(document.documentElement, requestId);
    }
  }
}

window.__morphDocRender = async (
  payload,
  target = renderTarget
) => {
  const result = await runtime.render(payload, {
    target,
    mermaidOutput
  });
  if (!result) {
    throw new Error("分页文档渲染已取消");
  }
  return result;
};
window.__morphDocRenderDocxMedia = (payload, dimensions) =>
  withHiddenWindowAnimationFrames(window, () =>
    renderDocxMediaCapturePlan(
      runtime,
      previewRoot,
      payload,
      dimensions
    )
  );
document.documentElement.dataset.runtimeReady = "true";

const desktopPdfBridge = window.__morphDocDesktopPdf;
if (desktopPdfBridge) {
  desktopPdfBridge.onRender(async (requestId, payload) => {
    try {
      const result = await withHiddenWindowAnimationFrames(
        window,
        async () => window.__morphDocRender?.(payload, "pdf")
      );
      if (!result) {
        throw new Error("PDF 分页运行时不可用");
      }
      desktopPdfBridge.complete(requestId, result);
    } catch (reason: unknown) {
      desktopPdfBridge.fail(
        requestId,
        reason instanceof Error ? reason.message : "PDF 分页失败"
      );
    }
  });
  desktopPdfBridge.ready();
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (
    event.origin !== window.location.origin ||
    event.source !== window.parent ||
    !isPagedPreviewRenderRequest(event.data)
  ) {
    return;
  }

  latestRequestId = Math.max(latestRequestId, event.data.requestId);
  const { requestId, layout, payload } = event.data;
  renderQueue = renderQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        await renderPagedPreview(requestId, payload, layout);
      } catch (reason: unknown) {
        if (requestId !== latestRequestId) {
          return;
        }
        post({
          scope: PAGED_PREVIEW_MESSAGE_SCOPE,
          type: "error",
          requestId,
          message:
            reason instanceof Error ? reason.message : "分页预览失败"
        });
      }
    });
});

post({
  scope: PAGED_PREVIEW_MESSAGE_SCOPE,
  type: "ready"
});
