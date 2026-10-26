import {
  type CSSProperties,
  type ChangeEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { EditorView } from "@codemirror/view";
import {
  createPagedDocumentPayload,
  getPaperDimensionsMm,
  millimetersToCssPixels,
  type DocxCapability,
  type ExportConfig
} from "@morphdoc/core";
import { ExportSettingsDrawer } from "./ExportSettingsDrawer";
import { PreviewPageControl } from "./PreviewPageControl";
import { PreviewZoomControl } from "./PreviewZoomControl";
import {
  loadExportConfig,
  resetExportConfig,
  saveExportConfig
} from "./export-settings";
import {
  createPagedPreviewRenderRequest,
  isPagedPreviewFrameMessage,
  type PagedPreviewPayload
} from "@morphdoc/preview-engine";
import {
  getNearestPageNumber,
  getPreviewPageScrollTop
} from "./preview-page";
import {
  createPdfExportCacheKey,
  downloadPdf,
  getCachedPdfExport,
  getOrRequestPdfExport,
  requestDesktopPdfExport,
  type CachedPdfExport,
  type PdfExportRequest
} from "./pdf-export";
import { APP_VERSION_LABEL } from "./app-version";
import {
  APP_DISPLAY_NAME,
  APP_SLOGAN
} from "./app-brand";
import { getSyncedScrollTop } from "./scroll-sync";
import {
  loadPreviewZoom,
  savePreviewZoom
} from "./preview-zoom";
import { useMarkdownRender } from "./use-markdown-render";
import {
  createMarkdownFileName,
  downloadMarkdown,
  ensureMarkdownFileName
} from "./document-file";
import { resolveWebDocumentLinkAction } from "./document-link";
import {
  type ThemeSummary,
  useThemeResources
} from "./use-theme-resources";
import { sampleMarkdown } from "./sample-markdown";
import { groupThemesByCategory } from "./theme-groups";
import { getBuiltinThemeSample } from "./builtin-theme-samples";
import {
  builtinTutorials,
  type BuiltinTutorial
} from "./builtin-tutorials";
import { DocumentActionDialog } from "./DocumentActionDialog";
import { getDocumentShortcut } from "./document-shortcuts";
import {
  applyThemeDefaults,
  selectTheme
} from "./theme-margins";
import {
  MarkdownEditor,
  type MarkdownEditorHandle
} from "./MarkdownEditor";
import { MarkdownToolbar } from "./MarkdownToolbar";
import {
  createDocxDiagnosticsMessage,
  downloadDocx,
  getDocxCapability,
  requestDesktopDocxExport,
  requestDocxExport
} from "./docx-export";
import {
  ExportMenu,
  type ExportCommand
} from "./ExportMenu";
import {
  ExportToast,
  type ExportToastState
} from "./ExportToast";

const PrecisePdfPreview = lazy(async () => {
  const module = await import("./PrecisePdfPreview");
  return { default: module.PrecisePdfPreview };
});

type PreviewMode = "quick" | "precise" | "continuous";
type DocumentKind = "sample" | "new" | "file";
type PendingDocumentAction =
  | {
      type: "new-current";
    }
  | {
      type: "close";
      systemRequest: boolean;
    };
type DocumentDialogState =
  | {
      type: "new-location";
    }
  | {
      type: "unsaved";
      action: PendingDocumentAction;
    };
const noImageResources: never[] = [];
const startsWithBlankMarkdown =
  Boolean(window.morphDocDesktop) &&
  new URLSearchParams(window.location.search).get("new") === "1";
const initialMarkdown = startsWithBlankMarkdown ? "" : sampleMarkdown;
const initialFileName = startsWithBlankMarkdown ? "" : "示例文档.md";
const initialDocumentKind: DocumentKind = startsWithBlankMarkdown
  ? "new"
  : "sample";

export function App() {
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [editorDocumentVersion, setEditorDocumentVersion] =
    useState(0);
  const [editorView, setEditorView] = useState<EditorView | null>(
    null
  );
  const [fileName, setFileName] = useState(initialFileName);
  const [documentKind, setDocumentKind] =
    useState<DocumentKind>(initialDocumentKind);
  const [savedMarkdown, setSavedMarkdown] = useState(initialMarkdown);
  const [exportConfig, setExportConfig] =
    useState<ExportConfig>(loadExportConfig);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [documentDialog, setDocumentDialog] =
    useState<DocumentDialogState>();
  const [documentActionBusy, setDocumentActionBusy] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [moreSubmenuOpen, setMoreSubmenuOpen] = useState<
    "tutorials" | "samples" | undefined
  >();
  const [themeRefreshKey, setThemeRefreshKey] = useState(0);
  const [sourcePanelCollapsed, setSourcePanelCollapsed] = useState(false);
  const [status, setStatus] = useState("正在准备预览…");
  const [appError, setAppError] = useState("");
  const [echartsError, setEChartsError] = useState("");
  const [mermaidError, setMermaidError] = useState("");
  const [paginationError, setPaginationError] = useState("");
  const [pdfError, setPdfError] = useState("");
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingDocx, setExportingDocx] = useState(false);
  const [docxCapability, setDocxCapability] =
    useState<DocxCapability>();
  const [docxCapabilityError, setDocxCapabilityError] = useState("");
  const [exportToast, setExportToast] =
    useState<ExportToastState>();
  const [previewMode, setPreviewMode] =
    useState<PreviewMode>("quick");
  const [previewZoom, setPreviewZoom] = useState(loadPreviewZoom);
  const [pdfCache, setPdfCache] = useState<CachedPdfExport>();
  const [previewFrameReady, setPreviewFrameReady] = useState(false);
  const [quickPreviewContentHeight, setQuickPreviewContentHeight] =
    useState<number>();
  const [previewPagination, setPreviewPagination] = useState({
    current: 0,
    total: 0
  });
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const markdownFileInputRef = useRef<HTMLInputElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const previewRequestIdRef = useRef(0);
  const pdfRequestKeyRef = useRef("");
  const previewModeRef = useRef<PreviewMode>("quick");
  const scrollSyncFrameRef = useRef<number | undefined>(undefined);
  const scrollSyncOriginRef = useRef<
    "editor" | "preview" | undefined
  >(undefined);
  const documentDirty = markdown !== savedMarkdown;
  const documentDirtyRef = useRef(documentDirty);
  const themeRefreshTargetRef = useRef<number | undefined>(undefined);
  documentDirtyRef.current = documentDirty;
  const dismissExportToast = useCallback(
    () => setExportToast(undefined),
    []
  );

  function replaceMarkdownDocument(content: string) {
    setMarkdown(content);
    setEditorDocumentVersion((version) => version + 1);
  }

  useEffect(() => {
    const bridge = window.morphDocDesktop;
    if (!bridge) {
      return;
    }
    let active = true;
    const consumeOpenedMarkdown = async (
      reason: "open" | "reload" | "replace" = "open"
    ) => {
      if (
        reason === "open" &&
        documentDirtyRef.current &&
        !window.confirm("当前文档有未保存修改，是否放弃并打开其他文件？")
      ) {
        try {
          await bridge.discardPendingMarkdown();
        } catch (reason) {
          if (active) {
            setAppError(
              reason instanceof Error
                ? reason.message
                : "无法丢弃待打开的 Markdown 文件"
            );
          }
        }
        return;
      }
      try {
        const opened = await bridge.consumePendingMarkdown();
        if (!active || !opened) {
          return;
        }
        setAppError("");
        replaceMarkdownDocument(opened.markdown);
        setFileName(opened.fileName);
        setDocumentKind("file");
        setSavedMarkdown(opened.markdown);
        setStatus("Markdown 与同目录图片素材已载入");
      } catch (reason) {
        if (active) {
          setAppError(
            reason instanceof Error
              ? reason.message
              : "无法打开 Markdown 文件"
          );
        }
      }
    };
    const removeListener = bridge.onMarkdownOpened((reason) => {
      void consumeOpenedMarkdown(reason);
    });
    void consumeOpenedMarkdown();
    return () => {
      active = false;
      removeListener();
    };
  }, []);

  useEffect(() => {
    const bridge = window.morphDocDesktop;
    if (!bridge) {
      return;
    }
    void bridge.setDocumentDirty(documentDirty).catch(
      (reason: unknown) => {
        console.warn("无法同步桌面文档修改状态", reason);
      }
    );
  }, [documentDirty]);

  useEffect(() => {
    let active = true;
    void getDocxCapability()
      .then((capability) => {
        if (!active) {
          return;
        }
        setDocxCapability(capability);
        setDocxCapabilityError("");
      })
      .catch((reason: unknown) => {
        if (!active) {
          return;
        }
        setDocxCapabilityError(
          reason instanceof Error
            ? reason.message
            : "无法检测 DOCX 导出能力"
        );
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const bridge = window.morphDocDesktop;
    if (!bridge) {
      return;
    }
    return bridge.onWindowCloseRequested(() => {
      requestDocumentClose(true);
    });
  }, [documentDialog, documentDirty]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcut = getDocumentShortcut(
        event,
        Boolean(window.morphDocDesktop)
      );
      if (!shortcut) {
        return;
      }
      event.preventDefault();
      if (documentDialog) {
        return;
      }
      if (shortcut === "save") {
        void handleSaveMarkdown();
      } else if (shortcut === "save-as") {
        void handleSaveMarkdownAs();
      } else if (shortcut === "new") {
        requestNewMarkdown();
      } else {
        requestDocumentClose(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [documentDialog, documentDirty, fileName, markdown]);

  useEffect(() => {
    if (!moreMenuOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }
      if (!moreMenuRef.current?.contains(event.target)) {
        setMoreMenuOpen(false);
        setMoreSubmenuOpen(undefined);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreMenuOpen(false);
        setMoreSubmenuOpen(undefined);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [moreMenuOpen]);

  const handleThemesLoaded = useCallback(
    (availableThemes: ThemeSummary[], loadedRefreshKey: number) => {
      setExportConfig((currentConfig) => {
        const currentTheme = availableThemes.find(
          (theme) => theme.id === currentConfig.themeId
        );
        if (currentTheme) {
          return applyThemeDefaults(currentConfig, currentTheme);
        }
        const preferredTheme =
          availableThemes.find((theme) => theme.id === "typora-github") ??
          availableThemes.find((theme) => theme.id === "typora-like") ??
          availableThemes[0];
        return preferredTheme
          ? selectTheme(currentConfig, preferredTheme)
          : currentConfig;
      });
      if (themeRefreshTargetRef.current === loadedRefreshKey) {
        themeRefreshTargetRef.current = undefined;
        setStatus("主题清单已刷新");
      }
    },
    []
  );
  const handleRenderStart = useCallback(() => {
    setEChartsError("");
    setMermaidError("");
  }, []);
  const { error: renderError, result } = useMarkdownRender(
    markdown,
    "zh-CN",
    noImageResources,
    {
      onRenderStart: handleRenderStart,
      onStatusChange: setStatus
    }
  );
  const {
    error: themeError,
    themeCss,
    themes
  } = useThemeResources(
    exportConfig.themeId,
    handleThemesLoaded,
    themeRefreshKey
  );
  const error =
    renderError ||
    themeError ||
    appError ||
    echartsError ||
    mermaidError ||
    paginationError ||
    pdfError;
  const themeId = exportConfig.themeId;
  const selectedTheme = themes.find((theme) => theme.id === themeId);
  const themeGroups = useMemo(
    () => groupThemesByCategory(themes),
    [themes]
  );
  const sampleThemeGroups = useMemo(
    () =>
      groupThemesByCategory(
        themes.filter((theme) => getBuiltinThemeSample(theme.id))
      ),
    [themes]
  );
  const effectiveFileName =
    documentKind === "new" || !fileName
      ? createMarkdownFileName(markdown)
      : fileName;
  const documentDisplayName =
    documentKind === "new" ? "新建文档" : fileName;
  const showUnsavedState = documentKind === "new" || documentDirty;
  const paperDimensions = getPaperDimensionsMm(
    exportConfig.paper.format,
    exportConfig.paper.orientation
  );
  const previewScale = previewZoom / 100;
  const naturalPaperWidth = millimetersToCssPixels(paperDimensions.width);
  const scaledPaperWidth = naturalPaperWidth * previewScale;
  const paperStyle = {
    width: `${scaledPaperWidth}px`,
    minWidth: `${scaledPaperWidth}px`,
    ...(quickPreviewContentHeight
      ? {
          height: `${quickPreviewContentHeight * previewScale}px`,
          minHeight: `${quickPreviewContentHeight * previewScale}px`
        }
      : {})
  } satisfies CSSProperties;
  const previewFrameStyle = {
    width: `${100 / previewScale}%`,
    height: quickPreviewContentHeight
      ? `${quickPreviewContentHeight}px`
      : `${100 / previewScale}%`,
    transform: `scale(${previewScale})`,
    transformOrigin: "top left"
  } satisfies CSSProperties;
  const previewPayload = useMemo<PagedPreviewPayload | undefined>(
    () =>
      result && themeCss
        ? createPagedDocumentPayload({
            document: result,
            fileName: effectiveFileName,
            themeCss,
            exportConfig
          })
        : undefined,
    [effectiveFileName, exportConfig, result, themeCss]
  );
  const pdfRequest = useMemo<PdfExportRequest>(
    () => ({
      markdown,
      fileName: effectiveFileName,
      language: "zh-CN",
      resources: noImageResources,
      exportConfig
    }),
    [effectiveFileName, exportConfig, markdown]
  );
  const pdfCacheKey = useMemo(
    () => createPdfExportCacheKey(pdfRequest),
    [pdfRequest]
  );
  const cachedPdf = getCachedPdfExport(pdfCache, pdfCacheKey);
  previewModeRef.current = previewMode;
  pdfRequestKeyRef.current = pdfCacheKey;

  useEffect(() => {
    try {
      saveExportConfig(exportConfig);
      setAppError("");
    } catch {
      setAppError("无法保存导出设置，当前设置仅在本次页面中有效");
    }
  }, [exportConfig]);

  useEffect(() => {
    savePreviewZoom(previewZoom);
    const frame = window.requestAnimationFrame(() => {
      synchronizeScroll("editor");
      updatePreviewCurrentPage();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [previewZoom]);

  useEffect(() => {
    if (pdfCache && pdfCache.key !== pdfCacheKey) {
      setPdfCache(undefined);
      setPreviewPagination({ current: 0, total: 0 });
    }
  }, [pdfCache, pdfCacheKey]);

  useEffect(() => {
    setPreviewFrameReady(false);
  }, [themeId]);

  useEffect(() => {
    function handlePreviewFrameMessage(event: MessageEvent<unknown>) {
      const frame = previewFrameRef.current;
      if (
        event.origin !== window.location.origin ||
        event.source !== frame?.contentWindow ||
        !isPagedPreviewFrameMessage(event.data)
      ) {
        return;
      }

      if (event.data.type === "ready") {
        setPreviewFrameReady(true);
        return;
      }

      if (event.data.type === "link") {
        handlePagedPreviewLink(event.data.href);
        return;
      }

      if (event.data.requestId !== previewRequestIdRef.current) {
        return;
      }

      if (event.data.type === "rendering") {
        setPaginationError("");
        setEChartsError("");
        setMermaidError("");
        setQuickPreviewContentHeight(undefined);
        setPreviewPagination({ current: 0, total: 0 });
        setStatus(
          event.data.layout === "continuous"
            ? "正在更新连续预览…"
            : "正在分页…"
        );
        return;
      }

      if (event.data.type === "error") {
        setPaginationError(event.data.message);
        setStatus("分页失败");
        return;
      }

      setEChartsError(
        event.data.echartsErrors.length > 0
          ? `ECharts：${event.data.echartsErrors.join("；")}`
          : ""
      );
      setMermaidError(
        event.data.mermaidErrors.length > 0
          ? `Mermaid：${event.data.mermaidErrors.join("；")}`
          : ""
      );
      setStatus(
        event.data.layout === "continuous"
          ? "连续预览已更新"
          : `预览已分页（${event.data.pageCount} 页）`
      );
      setQuickPreviewContentHeight(event.data.contentHeight);
      setPreviewPagination(
        event.data.layout === "continuous"
          ? { current: 0, total: 0 }
          : {
              current: event.data.pageCount > 0 ? 1 : 0,
              total: event.data.pageCount
            }
      );
      window.requestAnimationFrame(() => {
        synchronizeScroll("editor");
        window.requestAnimationFrame(updatePreviewCurrentPage);
      });
    }

    window.addEventListener("message", handlePreviewFrameMessage);
    return () =>
      window.removeEventListener("message", handlePreviewFrameMessage);
  }, []);

  useEffect(() => {
    function handleWindowScroll() {
      if (getOuterPreviewScroller() === document.scrollingElement) {
        updatePreviewCurrentPage();
      }
    }

    window.addEventListener("scroll", handleWindowScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleWindowScroll);
  }, [previewMode, quickPreviewContentHeight]);

  useEffect(() => {
    return () => {
      if (scrollSyncFrameRef.current !== undefined) {
        window.cancelAnimationFrame(scrollSyncFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const frameWindow = previewFrameRef.current?.contentWindow;
    if (!frameWindow || !previewFrameReady || !previewPayload) {
      return;
    }

    previewRequestIdRef.current += 1;
    frameWindow.postMessage(
      createPagedPreviewRenderRequest(
        previewRequestIdRef.current,
        previewPayload,
        previewMode === "continuous"
          ? "continuous"
          : "paged"
      ),
      window.location.origin
    );
  }, [previewFrameReady, previewMode, previewPayload]);

  function getOuterPreviewScroller() {
    const previewScroller = previewScrollRef.current;
    if (!previewScroller) {
      return null;
    }

    return previewScroller.scrollHeight > previewScroller.clientHeight + 1
      ? previewScroller
      : (document.scrollingElement as HTMLElement | null);
  }

  function getPreviewScroller() {
    return getOuterPreviewScroller();
  }

  function handlePagedPreviewLink(href: string) {
    const action = resolveWebDocumentLinkAction(href);
    if (action.type !== "anchor" && window.morphDocDesktop) {
      void window.morphDocDesktop.openDocumentLink(href).catch(
        (reason: unknown) => {
          setAppError(
            reason instanceof Error
              ? reason.message
              : "无法打开文档链接"
          );
        }
      );
      return;
    }
    if (action.type === "open") {
      window.open(
        action.href,
        "_blank",
        "noopener,noreferrer"
      );
      return;
    }
    if (action.type !== "anchor") {
      return;
    }

    const frame = previewFrameRef.current;
    const frameDocument = frame?.contentDocument;
    const scrollElement = getPreviewScroller();
    if (!frame || !frameDocument || !scrollElement) {
      return;
    }

    const rawAnchorId = action.href.slice(1);
    const anchorIds = [rawAnchorId];
    try {
      const decodedAnchorId = decodeURIComponent(rawAnchorId);
      if (decodedAnchorId !== rawAnchorId) {
        anchorIds.push(decodedAnchorId);
      }
    } catch {
      // 保留原始片段继续查找，兼容不完整的百分号编码。
    }
    const target = anchorIds
      .map(
        (anchorId) =>
          frameDocument.getElementById(anchorId) ??
          frameDocument.getElementsByName(anchorId).item(0)
      )
      .find((element) => Boolean(element));
    if (!target) {
      return;
    }

    const scrollerViewportTop =
      scrollElement === document.scrollingElement
        ? 0
        : scrollElement.getBoundingClientRect().top;
    const frameRect = frame.getBoundingClientRect();
    const frameScale =
      frame.offsetWidth > 0
        ? frameRect.width / frame.offsetWidth
        : 1;
    const targetTop = getPreviewPageScrollTop(
      scrollElement.scrollTop,
      frameRect.top +
        target.getBoundingClientRect().top * frameScale,
      scrollerViewportTop
    );
    scrollElement.scrollTo({ top: Math.max(0, targetTop) });
    window.requestAnimationFrame(updatePreviewCurrentPage);
  }

  function synchronizeScroll(origin: "editor" | "preview") {
    const source =
      origin === "editor"
        ? editorRef.current?.getScrollElement()
        : getPreviewScroller();
    const target =
      origin === "editor"
        ? getPreviewScroller()
        : editorRef.current?.getScrollElement();
    if (!source || !target) {
      return;
    }

    const activeOrigin = scrollSyncOriginRef.current;
    if (activeOrigin && activeOrigin !== origin) {
      return;
    }

    scrollSyncOriginRef.current = origin;
    target.scrollTop = getSyncedScrollTop(source, target);

    if (scrollSyncFrameRef.current !== undefined) {
      window.cancelAnimationFrame(scrollSyncFrameRef.current);
    }
    scrollSyncFrameRef.current = window.requestAnimationFrame(() => {
      scrollSyncOriginRef.current = undefined;
      scrollSyncFrameRef.current = undefined;
    });
  }

  function updatePreviewCurrentPage() {
    if (previewModeRef.current === "precise") {
      updatePrecisePreviewCurrentPage();
      return;
    }
    if (previewModeRef.current === "continuous") {
      return;
    }
    const frame = previewFrameRef.current;
    const frameDocument = frame?.contentDocument;
    const scrollElement = getPreviewScroller();
    if (!frame || !frameDocument || !scrollElement) {
      return;
    }

    const scrollerViewportTop =
      scrollElement === document.scrollingElement
        ? 0
        : scrollElement.getBoundingClientRect().top;
    const frameViewportTop = frame.getBoundingClientRect().top;
    const viewportCenter =
      scrollElement.scrollTop + scrollElement.clientHeight / 2;
    const pages = Array.from(
      frameDocument.querySelectorAll<HTMLElement>(".pagedjs_page")
    ).map((page) => {
      const rect = page.getBoundingClientRect();
      return {
        top: getPreviewPageScrollTop(
          scrollElement.scrollTop,
          frameViewportTop + rect.top * previewScale,
          scrollerViewportTop
        ),
        bottom: getPreviewPageScrollTop(
          scrollElement.scrollTop,
          frameViewportTop + rect.bottom * previewScale,
          scrollerViewportTop
        )
      };
    });
    const current = getNearestPageNumber(viewportCenter, pages);

    setPreviewPagination((pagination) =>
      pagination.current === current &&
      pagination.total === pages.length
        ? pagination
        : {
            current,
            total: pages.length
          }
    );
  }

  function updatePrecisePreviewCurrentPage() {
    const scrollElement = getOuterPreviewScroller();
    if (!scrollElement) {
      return;
    }
    const scrollerViewportTop =
      scrollElement === document.scrollingElement
        ? 0
        : scrollElement.getBoundingClientRect().top;
    const viewportCenter =
      scrollElement.scrollTop + scrollElement.clientHeight / 2;
    const pages = Array.from(
      scrollElement.querySelectorAll<HTMLElement>(
        ".precise-pdf-page"
      )
    ).map((page) => {
      const rect = page.getBoundingClientRect();
      return {
        top: getPreviewPageScrollTop(
          scrollElement.scrollTop,
          rect.top,
          scrollerViewportTop
        ),
        bottom: getPreviewPageScrollTop(
          scrollElement.scrollTop,
          rect.bottom,
          scrollerViewportTop
        )
      };
    });
    const current = getNearestPageNumber(viewportCenter, pages);

    setPreviewPagination((pagination) =>
      pagination.current === current &&
      pagination.total === pages.length
        ? pagination
        : {
            current,
            total: pages.length
          }
    );
  }

  function handlePreviewPageChange(pageNumber: number) {
    const scrollElement = getPreviewScroller();
    if (!scrollElement) {
      return;
    }

    let targetTop: number | undefined;
    if (previewModeRef.current === "precise") {
      const page = scrollElement.querySelectorAll<HTMLElement>(
        ".precise-pdf-page"
      )[pageNumber - 1];
      if (page) {
        const scrollerViewportTop =
          scrollElement === document.scrollingElement
            ? 0
            : scrollElement.getBoundingClientRect().top;
        targetTop = getPreviewPageScrollTop(
          scrollElement.scrollTop,
          page.getBoundingClientRect().top,
          scrollerViewportTop
        );
      }
    } else {
      const page =
        previewFrameRef.current?.contentDocument?.querySelectorAll<HTMLElement>(
          ".pagedjs_page"
        )[pageNumber - 1];
      if (page) {
        const scrollerViewportTop =
          scrollElement === document.scrollingElement
            ? 0
            : scrollElement.getBoundingClientRect().top;
        const frameViewportTop =
          previewFrameRef.current?.getBoundingClientRect().top ?? 0;
        targetTop = getPreviewPageScrollTop(
          scrollElement.scrollTop,
          frameViewportTop +
            page.getBoundingClientRect().top * previewScale,
          scrollerViewportTop
        );
      }
    }

    if (targetTop === undefined) {
      return;
    }

    setPreviewPagination((pagination) => ({
      ...pagination,
      current: pageNumber
    }));
    scrollElement.scrollTo({ top: Math.max(0, targetTop) });
  }

  const handlePrecisePageCount = useCallback((pageCount: number) => {
    setPreviewPagination({
      current: pageCount > 0 ? 1 : 0,
      total: pageCount
    });
    window.requestAnimationFrame(updatePrecisePreviewCurrentPage);
  }, []);

  function confirmDiscardChanges() {
    return (
      !documentDirty ||
      window.confirm("当前文档有未保存修改，是否放弃这些修改？")
    );
  }

  function handleOpenMarkdown() {
    if (!confirmDiscardChanges()) {
      return;
    }
    if (window.morphDocDesktop) {
      void handleDesktopOpenMarkdown();
      return;
    }
    markdownFileInputRef.current?.click();
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      setAppError("");
      const content = await file.text();
      replaceMarkdownDocument(content);
      setFileName(file.name);
      setDocumentKind("file");
      setSavedMarkdown(content);
      setStatus("Markdown 已载入；Web 端不读取本地相对图片");
    } catch {
      setAppError("无法读取所选 Markdown 文件");
    } finally {
      event.target.value = "";
    }
  }

  async function handleDesktopOpenMarkdown() {
    try {
      setAppError("");
      const opened = await window.morphDocDesktop?.openMarkdown();
      if (!opened) {
        return;
      }
      replaceMarkdownDocument(opened.markdown);
      setFileName(opened.fileName);
      setDocumentKind("file");
      setSavedMarkdown(opened.markdown);
      setStatus("Markdown 与同目录图片素材已载入");
    } catch (reason) {
      setAppError(
        reason instanceof Error ? reason.message : "无法打开 Markdown 文件"
      );
    }
  }

  function requestNewMarkdown() {
    setMoreMenuOpen(false);
    setMoreSubmenuOpen(undefined);
    if (window.morphDocDesktop) {
      setDocumentDialog({ type: "new-location" });
      return;
    }
    requestCurrentWindowNew();
  }

  function requestCurrentWindowNew() {
    if (documentDirty) {
      setDocumentDialog({
        type: "unsaved",
        action: { type: "new-current" }
      });
      return;
    }
    setDocumentDialog(undefined);
    void createMarkdownInCurrentWindow();
  }

  async function createMarkdownInCurrentWindow() {
    try {
      setAppError("");
      await window.morphDocDesktop?.startNewMarkdown();
      replaceMarkdownDocument("");
      setFileName("");
      setDocumentKind("new");
      setSavedMarkdown("");
      setStatus("新建文档尚未保存，可直接编辑或导出 PDF");
      window.requestAnimationFrame(() => editorRef.current?.focus());
    } catch (reason) {
      setAppError(
        reason instanceof Error ? reason.message : "无法新建 Markdown"
      );
    }
  }

  async function createMarkdownInNewWindow() {
    setDocumentDialog(undefined);
    try {
      setAppError("");
      await window.morphDocDesktop?.createNewWindow();
      setStatus("已在新窗口创建空白 Markdown");
    } catch (reason) {
      setAppError(
        reason instanceof Error
          ? reason.message
          : "无法创建新的 Markdown 窗口"
      );
    }
  }

  function requestDocumentClose(systemRequest: boolean) {
    const bridge = window.morphDocDesktop;
    if (!bridge) {
      return;
    }
    if (documentDialog) {
      if (systemRequest) {
        void bridge.resolveWindowClose(false);
      }
      return;
    }
    if (documentDirty) {
      setDocumentDialog({
        type: "unsaved",
        action: {
          type: "close",
          systemRequest
        }
      });
      return;
    }
    void bridge.resolveWindowClose(true);
  }

  async function completePendingDocumentAction(
    action: PendingDocumentAction
  ) {
    setDocumentDialog(undefined);
    if (action.type === "new-current") {
      await createMarkdownInCurrentWindow();
      return;
    }
    await window.morphDocDesktop?.resolveWindowClose(true);
  }

  function cancelDocumentDialog() {
    const currentDialog = documentDialog;
    setDocumentDialog(undefined);
    if (
      currentDialog?.type === "unsaved" &&
      currentDialog.action.type === "close" &&
      currentDialog.action.systemRequest
    ) {
      void window.morphDocDesktop?.resolveWindowClose(false);
    }
  }

  function discardPendingDocumentChanges() {
    if (documentDialog?.type !== "unsaved") {
      return;
    }
    void completePendingDocumentAction(documentDialog.action);
  }

  async function saveBeforePendingDocumentAction() {
    if (documentDialog?.type !== "unsaved" || documentActionBusy) {
      return;
    }
    const action = documentDialog.action;
    setDocumentActionBusy(true);
    try {
      if (await saveMarkdown()) {
        await completePendingDocumentAction(action);
      }
    } finally {
      setDocumentActionBusy(false);
    }
  }

  async function handleOpenThemeSample(theme: ThemeSummary) {
    const sample = getBuiltinThemeSample(theme.id);
    if (!sample) {
      setAppError(`找不到“${theme.name}”的内置示例`);
      return;
    }
    setMoreMenuOpen(false);
    setMoreSubmenuOpen(undefined);
    if (!confirmDiscardChanges()) {
      return;
    }
    try {
      setAppError("");
      await window.morphDocDesktop?.startNewMarkdown();
      replaceMarkdownDocument(sample.markdown);
      setFileName(sample.fileName);
      setDocumentKind("sample");
      setSavedMarkdown(sample.markdown);
      setExportConfig((currentConfig) =>
        selectTheme(
          {
            ...currentConfig,
            paper: {
              ...currentConfig.paper,
              marginMode: "theme"
            },
            pageDecorationsMode: "theme"
          },
          theme
        )
      );
      setStatus(
        `已打开“${theme.name}”主题示例，可编辑后另存为 Markdown`
      );
      window.requestAnimationFrame(() => editorRef.current?.focus());
    } catch (reason) {
      setAppError(
        reason instanceof Error ? reason.message : "无法打开主题示例"
      );
    }
  }

  async function handleOpenTutorial(tutorial: BuiltinTutorial) {
    const theme = themes.find(
      (availableTheme) => availableTheme.id === tutorial.themeId
    );
    if (!theme) {
      setAppError(`找不到教程需要的主题：${tutorial.themeId}`);
      return;
    }
    setMoreMenuOpen(false);
    setMoreSubmenuOpen(undefined);
    if (!confirmDiscardChanges()) {
      return;
    }
    try {
      setAppError("");
      await window.morphDocDesktop?.startNewMarkdown();
      replaceMarkdownDocument(tutorial.markdown);
      setFileName(tutorial.fileName);
      setDocumentKind("sample");
      setSavedMarkdown(tutorial.markdown);
      setExportConfig((currentConfig) =>
        selectTheme(
          {
            ...currentConfig,
            paper: {
              ...currentConfig.paper,
              marginMode: "theme"
            },
            pageDecorationsMode: "theme"
          },
          theme
        )
      );
      setStatus(
        `已打开“${tutorial.name}”，可编辑后另存为 Markdown`
      );
      window.requestAnimationFrame(() => editorRef.current?.focus());
    } catch (reason) {
      setAppError(
        reason instanceof Error ? reason.message : "无法打开内置教程"
      );
    }
  }

  async function saveMarkdown(forceSaveAs = false) {
    const suggestedName = ensureMarkdownFileName(fileName, markdown);
    try {
      setAppError("");
      const bridge = window.morphDocDesktop;
      let savedFileName = suggestedName;
      if (bridge) {
        const saved = forceSaveAs
          ? await bridge.saveMarkdownAs(suggestedName, markdown)
          : await bridge.saveMarkdown(suggestedName, markdown);
        if (!saved) {
          setStatus(
            forceSaveAs
              ? "已取消 Markdown 另存为"
              : "已取消 Markdown 保存"
          );
          return false;
        }
        savedFileName = saved.fileName;
      } else {
        downloadMarkdown(markdown, suggestedName);
      }
      setFileName(savedFileName);
      setDocumentKind("file");
      setSavedMarkdown(markdown);
      setStatus(
        forceSaveAs
          ? `Markdown 已另存为：${savedFileName}`
          : `Markdown 已保存：${savedFileName}`
      );
      return true;
    } catch (reason) {
      setAppError(
        reason instanceof Error
          ? reason.message
          : forceSaveAs
            ? "Markdown 另存为失败"
            : "Markdown 保存失败"
      );
      return false;
    }
  }

  async function handleSaveMarkdown() {
    setMoreMenuOpen(false);
    setMoreSubmenuOpen(undefined);
    return saveMarkdown();
  }

  async function handleSaveMarkdownAs() {
    setMoreMenuOpen(false);
    setMoreSubmenuOpen(undefined);
    return saveMarkdown(true);
  }

  async function handleOpenThemeDirectory() {
    setMoreMenuOpen(false);
    setMoreSubmenuOpen(undefined);
    try {
      setAppError("");
      const themeDirectory =
        await window.morphDocDesktop?.openThemeDirectory();
      if (themeDirectory) {
        setStatus(`自定义主题目录：${themeDirectory}`);
      }
    } catch (reason) {
      setAppError(
        reason instanceof Error
          ? reason.message
          : "无法打开自定义主题目录"
      );
    }
  }

  async function handleRefreshThemes() {
    setMoreMenuOpen(false);
    setMoreSubmenuOpen(undefined);
    try {
      setAppError("");
      await window.morphDocDesktop?.refreshThemes();
      setStatus("正在刷新主题清单…");
      setThemeRefreshKey((key) => {
        const nextKey = key + 1;
        themeRefreshTargetRef.current = nextKey;
        return nextKey;
      });
    } catch (reason) {
      setAppError(
        reason instanceof Error ? reason.message : "无法刷新主题清单"
      );
    }
  }

  async function generatePdf(download: boolean) {
    if (exportingPdf) {
      return;
    }

    setExportingPdf(true);
    setPdfError("");
    if (download) {
      setExportToast({
        kind: "progress",
        title: "正在生成 PDF",
        message: "正在渲染页面、图表和字体，请稍候"
      });
    } else {
      setStatus("正在生成精确预览…");
    }
    const requestedKey = pdfCacheKey;
    try {
      const resolved = await getOrRequestPdfExport(
        pdfRequest,
        pdfCache,
        previewPayload && window.morphDocDesktop
          ? () => requestDesktopPdfExport(previewPayload)
          : undefined
      );
      if (pdfRequestKeyRef.current !== requestedKey) {
        if (download) {
          setExportToast({
            kind: "error",
            title: "PDF 导出已停止",
            message: "文档已更新，请重新导出"
          });
        } else {
          setStatus("文档已更新，已丢弃过期 PDF");
        }
        return;
      }
      setPdfCache(resolved);
      const exported = resolved.result;
      if (download) {
        const saved = await downloadPdf(exported.blob, exported.fileName);
        if (!saved) {
          setExportToast(undefined);
          return;
        }
      }
      const pageDescription =
        exported.pageCount === undefined
          ? ""
          : `（${exported.pageCount} 页）`;
      const mermaidDescription =
        exported.mermaidErrorCount > 0
          ? `，${exported.mermaidErrorCount} 个 Mermaid 图表渲染失败`
          : "";
      const echartsDescription =
        exported.echartsErrorCount > 0
          ? `，${exported.echartsErrorCount} 个 ECharts 图表渲染失败`
          : "";
      const resultMessage =
        `${download ? "PDF 已导出" : "精确预览已生成"}${pageDescription}${echartsDescription}${mermaidDescription}`;
      if (download) {
        setExportToast({
          kind: "success",
          title: `PDF 已导出${pageDescription}`,
          message:
            echartsDescription || mermaidDescription
              ? `${echartsDescription}${mermaidDescription}`.replace(
                  /^，/u,
                  ""
                )
              : "文件已保存"
        });
      } else {
        setStatus(resultMessage);
      }
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "PDF 导出失败";
      if (download) {
        setExportToast({
          kind: "error",
          title: "PDF 导出失败",
          message
        });
      } else {
        setPdfError(message);
        setStatus("精确预览失败");
      }
    } finally {
      setExportingPdf(false);
    }
  }

  async function generateDocx() {
    if (
      exportingDocx ||
      docxCapability?.status !== "available"
    ) {
      return;
    }
    setExportingDocx(true);
    setExportToast({
      kind: "progress",
      title: "正在生成 DOCX",
      message: "正在转换样式并将图片和图表渲染为 PNG"
    });
    try {
      const request = {
        markdown,
        fileName: effectiveFileName,
        language: "zh-CN",
        resources: noImageResources,
        exportConfig
      };
      let diagnostics;
      if (window.morphDocDesktop) {
        const result = await requestDesktopDocxExport(request);
        if (!result.saved) {
          setExportToast(undefined);
          return;
        }
        diagnostics = result;
      } else {
        const result = await requestDocxExport(request);
        downloadDocx(result);
        diagnostics = result;
      }
      setExportToast({
        kind: "success",
        title: "DOCX 已导出",
        message: createDocxDiagnosticsMessage(diagnostics)
      });
    } catch (reason) {
      setExportToast({
        kind: "error",
        title: "DOCX 导出失败",
        message:
          reason instanceof Error
            ? reason.message
            : "DOCX 导出失败"
      });
    } finally {
      setExportingDocx(false);
    }
  }

  function handlePreviewModeChange(mode: PreviewMode) {
    if (mode === previewMode) {
      return;
    }
    const keepsFrame =
      previewMode !== "precise" && mode !== "precise";
    setPreviewMode(mode);
    if (!keepsFrame) {
      setPreviewFrameReady(false);
    }
    setQuickPreviewContentHeight(undefined);
    setPreviewPagination({ current: 0, total: 0 });
    previewScrollRef.current?.scrollTo({ top: 0 });
    if (mode === "precise" && !cachedPdf) {
      void generatePdf(false);
    }
  }

  function handlePreviewScroll() {
    synchronizeScroll("preview");
    updatePreviewCurrentPage();
  }

  const docxDisabledReason = !markdown.trim()
    ? "文档内容为空"
    : docxCapabilityError
      ? docxCapabilityError
      : !docxCapability
        ? "正在检测 DOCX 导出能力"
        : docxCapability.status === "available"
          ? undefined
          : docxCapability.message;
  const exportBusy = exportingPdf || exportingDocx;
  const exportCommands: ExportCommand[] = [
    {
      id: "pdf",
      label: "PDF",
      description: "固定版式，适合打印与归档",
      disabled: exportBusy || !markdown.trim(),
      disabledReason: !markdown.trim()
        ? "文档内容为空"
        : exportBusy
          ? "已有导出任务正在进行"
          : undefined,
      busy: exportingPdf,
      onSelect: () => generatePdf(true)
    },
    {
      id: "docx",
      label: "DOCX",
      description: "保留样式，可在 Word 与 WPS 中编辑",
      disabled: exportBusy || Boolean(docxDisabledReason),
      disabledReason: exportBusy
        ? "已有导出任务正在进行"
        : docxDisabledReason,
      busy: exportingDocx,
      onSelect: generateDocx
    }
  ];

  return (
    <main className="workspace">
      {exportToast ? (
        <ExportToast
          toast={exportToast}
          onDismiss={dismissExportToast}
        />
      ) : null}
      <header className="topbar">
        <div className="topbar-primary">
          <div className="topbar-brand">
            <p className="eyebrow">{APP_SLOGAN}</p>
            <div className="topbar-brand-title">
              <h1>{APP_DISPLAY_NAME}</h1>
              <span className="app-version">{APP_VERSION_LABEL}</span>
            </div>
          </div>
          <div className="document-summary">
            <span className="panel-kicker">源文件</span>
            <div className="document-name-row">
              <strong title={documentDisplayName}>
                {documentDisplayName}
              </strong>
              {showUnsavedState ? (
                <span className="unsaved-badge">未保存</span>
              ) : null}
            </div>
            <span
              className={`render-status${error ? " is-error" : ""}`}
              aria-live="polite"
              title={error || status}
            >
              {error || status}
            </span>
          </div>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={handleOpenMarkdown}>
            打开 Markdown
          </button>
          <div className="more-menu" ref={moreMenuRef}>
            <button
              type="button"
              aria-controls="document-actions-menu"
              aria-expanded={moreMenuOpen}
              aria-haspopup="menu"
              onClick={() => {
                setMoreMenuOpen((open) => !open);
                setMoreSubmenuOpen(undefined);
              }}
            >
              更多 ▾
            </button>
            {moreMenuOpen ? (
              <div
                id="document-actions-menu"
                className="more-menu-popover"
                role="menu"
              >
                <button
                  type="button"
                  className="menu-command"
                  role="menuitem"
                  onClick={requestNewMarkdown}
                >
                  <span>新建文件</span>
                  {window.morphDocDesktop ? <kbd>Ctrl+N</kbd> : null}
                </button>
                <button
                  type="button"
                  className="menu-command"
                  role="menuitem"
                  onClick={() => void handleSaveMarkdown()}
                >
                  <span>保存文件</span>
                  <kbd>Ctrl+S</kbd>
                </button>
                {window.morphDocDesktop ? (
                  <button
                    type="button"
                    className="menu-command"
                    role="menuitem"
                    onClick={() => void handleSaveMarkdownAs()}
                  >
                    <span>另存为文件</span>
                    <kbd>Ctrl+Shift+S</kbd>
                  </button>
                ) : null}
                <div className="menu-separator" role="separator" />
                <div
                  className="more-menu-submenu-item"
                  onPointerEnter={() =>
                    setMoreSubmenuOpen("tutorials")
                  }
                  onPointerLeave={() => setMoreSubmenuOpen(undefined)}
                >
                  <button
                    type="button"
                    className="submenu-trigger"
                    role="menuitem"
                    aria-controls="tutorials-menu"
                    aria-expanded={moreSubmenuOpen === "tutorials"}
                    aria-haspopup="menu"
                    onFocus={() => setMoreSubmenuOpen("tutorials")}
                    onClick={() => setMoreSubmenuOpen("tutorials")}
                  >
                    <span>使用教程</span>
                    <span aria-hidden="true">›</span>
                  </button>
                  {moreSubmenuOpen === "tutorials" ? (
                    <div
                      id="tutorials-menu"
                      className="more-menu-submenu"
                      role="menu"
                      aria-label="使用教程"
                    >
                      {builtinTutorials.map((tutorial) => (
                        <button
                          type="button"
                          role="menuitem"
                          key={tutorial.id}
                          onClick={() =>
                            void handleOpenTutorial(tutorial)
                          }
                        >
                          {tutorial.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div
                  className="more-menu-submenu-item"
                  onPointerEnter={() => setMoreSubmenuOpen("samples")}
                  onPointerLeave={() => setMoreSubmenuOpen(undefined)}
                >
                  <button
                    type="button"
                    className="submenu-trigger"
                    role="menuitem"
                    aria-controls="theme-samples-menu"
                    aria-expanded={moreSubmenuOpen === "samples"}
                    aria-haspopup="menu"
                    onFocus={() => setMoreSubmenuOpen("samples")}
                    onClick={() => setMoreSubmenuOpen("samples")}
                  >
                    <span>主题示例</span>
                    <span aria-hidden="true">›</span>
                  </button>
                  {moreSubmenuOpen === "samples" ? (
                    <div
                      id="theme-samples-menu"
                      className="more-menu-submenu"
                      role="menu"
                      aria-label="主题示例"
                    >
                      {sampleThemeGroups.map((group) => (
                        <section
                          className="sample-menu-group"
                          key={group.category}
                        >
                          <span className="sample-menu-group-label">
                            {group.label}
                          </span>
                          {group.themes.map((theme) => (
                            <button
                              type="button"
                              role="menuitem"
                              key={theme.id}
                              onClick={() =>
                                void handleOpenThemeSample(theme)
                              }
                            >
                              {theme.name}
                            </button>
                          ))}
                        </section>
                      ))}
                    </div>
                  ) : null}
                </div>
                {window.morphDocDesktop ? (
                  <>
                    <div className="menu-separator" role="separator" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleOpenThemeDirectory()}
                    >
                      打开自定义主题目录
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleRefreshThemes()}
                    >
                      刷新主题
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
          <input
            ref={markdownFileInputRef}
            hidden
            type="file"
            accept=".md,.markdown,text/markdown"
            onChange={handleFileChange}
          />
          <button type="button" onClick={() => setSettingsOpen(true)}>
            导出设置
          </button>
          <ExportMenu commands={exportCommands} />
        </div>
      </header>

      <section
        className={`editor-layout${
          sourcePanelCollapsed ? " is-source-collapsed" : ""
        }`}
      >
        <aside className="editor-panel" aria-label="Markdown 编辑区">
          <div
            id="markdown-source-content"
            className="source-panel-content"
            hidden={sourcePanelCollapsed}
          >
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">源文本</span>
                <strong>Markdown 原文</strong>
              </div>
              <button
                type="button"
                className="source-panel-toggle"
                aria-controls="markdown-source-content"
                aria-expanded="true"
                onClick={() => setSourcePanelCollapsed(true)}
              >
                收起
              </button>
            </div>
            <MarkdownToolbar editorView={editorView} />
            <MarkdownEditor
              ref={editorRef}
              value={markdown}
              documentVersion={editorDocumentVersion}
              onChange={setMarkdown}
              onEditorReady={setEditorView}
              onScroll={() => synchronizeScroll("editor")}
            />
          </div>
          {sourcePanelCollapsed ? (
            <button
              type="button"
              className="source-panel-restore"
              aria-controls="markdown-source-content"
              aria-expanded="false"
              onClick={() => {
                setSourcePanelCollapsed(false);
                window.requestAnimationFrame(() =>
                  editorRef.current?.focus()
                );
              }}
            >
              展开源文本
            </button>
          ) : null}
        </aside>

        <section className="preview-panel" aria-label="文档预览">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">实时预览</span>
              <strong>{result?.metadata.title || "未命名文档"}</strong>
            </div>
            <span className="preview-heading-actions">
              <span
                className="preview-mode-control"
                role="group"
                aria-label="预览模式"
              >
                <button
                  type="button"
                  className={
                    previewMode === "quick" ? "is-active" : ""
                  }
                  aria-pressed={previewMode === "quick"}
                  onClick={() => handlePreviewModeChange("quick")}
                >
                  快速
                </button>
                <button
                  type="button"
                  className={
                    previewMode === "precise" ? "is-active" : ""
                  }
                  aria-pressed={previewMode === "precise"}
                  disabled={exportingPdf}
                  onClick={() => handlePreviewModeChange("precise")}
                >
                  精确
                </button>
                <button
                  type="button"
                  className={
                    previewMode === "continuous" ? "is-active" : ""
                  }
                  aria-pressed={previewMode === "continuous"}
                  onClick={() =>
                    handlePreviewModeChange("continuous")
                  }
                >
                  连续
                </button>
              </span>
              <label className="theme-control">
                <span className="sr-only">预览主题</span>
                <select
                  aria-label="预览主题"
                  value={themeId}
                  onChange={(event) => {
                    const nextTheme = themes.find(
                      (theme) => theme.id === event.target.value
                    );
                    if (nextTheme) {
                      setExportConfig((currentConfig) =>
                        selectTheme(currentConfig, nextTheme)
                      );
                    }
                  }}
                >
                  {themes.length === 0 ? (
                    <option value={themeId}>正在加载主题…</option>
                  ) : (
                    themeGroups.map((group) => (
                      <optgroup
                        key={group.category}
                        label={group.label}
                      >
                        {group.themes.map((theme) => (
                          <option key={theme.id} value={theme.id}>
                            {theme.name}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  )}
                </select>
                {selectedTheme?.source === "local" ? (
                  <span className="local-theme-mark">本地</span>
                ) : null}
              </label>
            </span>
          </div>
          <div className="preview-toolbar">
            {previewPagination.total > 0 ? (
              <PreviewPageControl
                current={previewPagination.current}
                total={previewPagination.total}
                onNavigate={handlePreviewPageChange}
              />
            ) : (
              <span />
            )}
            <PreviewZoomControl
              value={previewZoom}
              onChange={setPreviewZoom}
            />
          </div>
          <div
            ref={previewScrollRef}
            className="preview-scroll"
            onScroll={handlePreviewScroll}
          >
            {previewMode !== "precise" ? (
              <div
                className={`paper${
                  previewMode === "continuous"
                    ? " continuous-paper"
                    : ""
                }`}
                style={paperStyle}
              >
                {previewPayload ? (
                  <iframe
                    ref={previewFrameRef}
                    className="preview-frame"
                    scrolling="no"
                    style={previewFrameStyle}
                    title="文档内容预览"
                    sandbox="allow-same-origin allow-scripts"
                    src="/preview-frame.html"
                  />
                ) : (
                  <div className="preview-loading">
                    正在生成文档预览…
                  </div>
                )}
              </div>
            ) : exportingPdf && !cachedPdf ? (
              <div className="precise-pdf-status">
                正在使用固定版本 Chromium 生成精确预览…
              </div>
            ) : cachedPdf ? (
              <Suspense
                fallback={
                  <div className="precise-pdf-status">
                    正在加载 PDF 查看器…
                  </div>
                }
              >
                <PrecisePdfPreview
                  blob={cachedPdf.blob}
                  zoomPercent={previewZoom}
                  onExternalLink={handlePagedPreviewLink}
                  onNavigateToPage={handlePreviewPageChange}
                  onPageCount={handlePrecisePageCount}
                />
              </Suspense>
            ) : (
              <div className="precise-pdf-status">
                <span>当前内容尚未生成精确预览</span>
                <button
                  type="button"
                  onClick={() => void generatePdf(false)}
                >
                  生成精确预览
                </button>
              </div>
            )}
          </div>
        </section>
      </section>
      {settingsOpen ? (
        <ExportSettingsDrawer
          config={exportConfig}
          theme={selectedTheme}
          onChange={setExportConfig}
          onClose={() => setSettingsOpen(false)}
          onReset={() => setExportConfig(resetExportConfig())}
        />
      ) : null}
      {documentDialog?.type === "new-location" ? (
        <DocumentActionDialog
          type="new-location"
          onCurrentWindow={requestCurrentWindowNew}
          onNewWindow={() => void createMarkdownInNewWindow()}
          onCancel={cancelDocumentDialog}
        />
      ) : documentDialog?.type === "unsaved" ? (
        <DocumentActionDialog
          type="unsaved"
          busy={documentActionBusy}
          onSave={() => void saveBeforePendingDocumentAction()}
          onDiscard={discardPendingDocumentChanges}
          onCancel={cancelDocumentDialog}
        />
      ) : null}
    </main>
  );
}
