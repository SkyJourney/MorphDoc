import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  AnnotationLayer,
  getDocument,
  GlobalWorkerOptions,
  RenderingCancelledException,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  getPdfCanvasRenderScale,
  getPdfPageCssDimensions,
  getPrecisePdfDocumentWidth
} from "./pdf-page-geometry";
import { createPdfAnnotationLinkService } from "./pdf-annotation-links";
import { PdfPageRenderQueue } from "./pdf-render-queue";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PRECISE_PDF_INLINE_GUTTER = 30;

type PdfJsAnnotationLinkService = Parameters<
  AnnotationLayer["render"]
>[0]["linkService"];

interface PdfPageDescriptor {
  pageNumber: number;
  width: number;
  height: number;
}

export interface PrecisePdfPreviewProps {
  blob: Blob;
  zoomPercent: number;
  onExternalLink?: (href: string) => void;
  onNavigateToPage?: (pageNumber: number) => void;
  onPageCount?: (pageCount: number) => void;
}

interface PrecisePdfPageProps {
  document: PDFDocumentProxy;
  descriptor: PdfPageDescriptor;
  onExternalLink: (href: string) => void;
  onNavigateToPage: (pageNumber: number) => void;
  renderQueue: PdfPageRenderQueue;
  zoomPercent: number;
}

function useNearViewport(elementRef: React.RefObject<HTMLElement | null>) {
  const [nearViewport, setNearViewport] = useState(false);
  const releaseTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }
    if (!("IntersectionObserver" in window)) {
      setNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          if (releaseTimerRef.current !== undefined) {
            window.clearTimeout(releaseTimerRef.current);
            releaseTimerRef.current = undefined;
          }
          setNearViewport(true);
          return;
        }

        releaseTimerRef.current = window.setTimeout(() => {
          releaseTimerRef.current = undefined;
          setNearViewport(false);
        }, 1_500);
      },
      {
        rootMargin: "1200px 0px"
      }
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (releaseTimerRef.current !== undefined) {
        window.clearTimeout(releaseTimerRef.current);
      }
    };
  }, [elementRef]);

  return nearViewport;
}

function PrecisePdfPage({
  document,
  descriptor,
  onExternalLink,
  onNavigateToPage,
  renderQueue,
  zoomPercent
}: PrecisePdfPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const annotationLayerRef = useRef<HTMLDivElement>(null);
  const [displayWidth, setDisplayWidth] = useState(0);
  const [renderError, setRenderError] = useState("");
  const [renderState, setRenderState] = useState<
    "idle" | "queued" | "rendering" | "rendered"
  >("idle");
  const nearViewport = useNearViewport(containerRef);
  const dimensions = getPdfPageCssDimensions(
    descriptor.width,
    descriptor.height,
    zoomPercent / 100
  );
  const pageStyle = {
    width: `${dimensions.width}px`,
    maxWidth: `${zoomPercent}%`,
    aspectRatio: `${descriptor.width} / ${descriptor.height}`
  } satisfies CSSProperties;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateWidth = () => setDisplayWidth(container.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const updateVisibility = useCallback(
    (visible: boolean) => {
      renderQueue.setVisible(descriptor.pageNumber, visible);
    },
    [descriptor.pageNumber, renderQueue]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    if (!("IntersectionObserver" in window)) {
      updateVisibility(true);
      return () => updateVisibility(false);
    }

    const observer = new IntersectionObserver(([entry]) => {
      updateVisibility(Boolean(entry?.isIntersecting));
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      updateVisibility(false);
    };
  }, [updateVisibility]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const textContainer = textLayerRef.current;
    const annotationContainer = annotationLayerRef.current;
    if (
      !nearViewport ||
      displayWidth <= 0 ||
      !canvas ||
      !textContainer ||
      !annotationContainer
    ) {
      return;
    }

    let disposed = false;
    let page: PDFPageProxy | undefined;
    let renderTask: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    let annotationLayer: AnnotationLayer | undefined;

    setRenderError("");
    setRenderState("queued");
    const cancelQueuedRender = renderQueue.schedule(
      descriptor.pageNumber,
      async () => {
        try {
          if (disposed) {
            return;
          }
          setRenderState("rendering");
          const loadedPage = await document.getPage(
            descriptor.pageNumber
          );
          page = loadedPage;
          const outputScale = Math.min(
            window.devicePixelRatio || 1,
            2
          );
          const renderScale = getPdfCanvasRenderScale(
            descriptor.width,
            displayWidth,
            outputScale
          );
          const displayScale = displayWidth / descriptor.width;
          const renderViewport = page.getViewport({
            scale: renderScale
          });
          const displayViewport = page.getViewport({
            scale: displayScale
          });
          const context = canvas.getContext("2d");
          if (!context) {
            throw new Error("浏览器无法创建 PDF Canvas");
          }

          canvas.width = Math.ceil(renderViewport.width);
          canvas.height = Math.ceil(renderViewport.height);
          canvas.style.width = `${displayViewport.width}px`;
          canvas.style.height = `${displayViewport.height}px`;
          textContainer.replaceChildren();
          annotationContainer.replaceChildren();

          renderTask = page.render({
            canvas,
            canvasContext: context,
            viewport: renderViewport
          });
          await renderTask.promise;
          if (disposed) {
            return;
          }
          setRenderState("rendered");

          textLayer = new TextLayer({
            container: textContainer,
            textContentSource: page.streamTextContent(),
            viewport: displayViewport
          });
          const annotations = await page.getAnnotations({
            intent: "display"
          });
          const linkService = createPdfAnnotationLinkService(
            document,
            descriptor.pageNumber,
            {
              onExternalLink,
              onNavigateToPage
            }
          );
          annotationLayer = new AnnotationLayer({
            div: annotationContainer,
            accessibilityManager: undefined,
            annotationCanvasMap: undefined,
            annotationEditorUIManager: undefined,
            page,
            viewport: displayViewport,
            structTreeLayer: undefined,
            commentManager: undefined,
            linkService,
            annotationStorage: document.annotationStorage
          });
          await Promise.all([
            textLayer.render(),
            annotationLayer.render({
              viewport: displayViewport,
              div: annotationContainer,
              annotations,
              page,
              linkService:
                linkService as unknown as PdfJsAnnotationLinkService,
              annotationStorage: document.annotationStorage,
              renderForms: false,
              enableScripting: false
            })
          ]);
        } catch (reason: unknown) {
          if (
            disposed ||
            reason instanceof RenderingCancelledException
          ) {
            return;
          }
          setRenderError(
            reason instanceof Error
              ? reason.message
              : "PDF 页面渲染失败"
          );
        }
      }
    );

    return () => {
      disposed = true;
      cancelQueuedRender();
      renderTask?.cancel();
      textLayer?.cancel();
      annotationLayer?.destroy();
      page?.cleanup();
      canvas.width = 0;
      canvas.height = 0;
      textContainer.replaceChildren();
      annotationContainer.replaceChildren();
      setRenderState("idle");
    };
  }, [
    descriptor.height,
    descriptor.pageNumber,
    descriptor.width,
    displayWidth,
    document,
    nearViewport,
    onExternalLink,
    onNavigateToPage,
    renderQueue
  ]);

  return (
    <article
      ref={containerRef}
      className="precise-pdf-page"
      style={pageStyle}
      aria-label={`PDF 第 ${descriptor.pageNumber} 页`}
    >
      <canvas
        ref={canvasRef}
        className={renderState === "rendered" ? "is-rendered" : ""}
        width={0}
        height={0}
        aria-hidden="true"
      />
      <div ref={textLayerRef} className="textLayer" />
      <div
        ref={annotationLayerRef}
        className="annotationLayer"
      />
      {renderState !== "rendered" ? (
        <span className="precise-pdf-page-placeholder">
          {renderState === "rendering"
            ? `正在渲染第 ${descriptor.pageNumber} 页…`
            : `第 ${descriptor.pageNumber} 页`}
        </span>
      ) : null}
      {renderError ? (
        <span className="precise-pdf-page-error">{renderError}</span>
      ) : null}
    </article>
  );
}

export function PrecisePdfPreview({
  blob,
  zoomPercent,
  onExternalLink,
  onNavigateToPage,
  onPageCount
}: PrecisePdfPreviewProps) {
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [pages, setPages] = useState<PdfPageDescriptor[]>([]);
  const [error, setError] = useState("");
  const renderQueue = useMemo(
    () => new PdfPageRenderQueue(1),
    [document]
  );
  const externalLinkRef = useRef(onExternalLink);
  const navigateToPageRef = useRef(onNavigateToPage);
  externalLinkRef.current = onExternalLink;
  navigateToPageRef.current = onNavigateToPage;
  const handleExternalLink = useCallback((href: string) => {
    externalLinkRef.current?.(href);
  }, []);
  const handleNavigateToPage = useCallback(
    (pageNumber: number) => {
      navigateToPageRef.current?.(pageNumber);
    },
    []
  );

  useEffect(() => () => renderQueue.dispose(), [renderQueue]);

  useEffect(() => {
    let disposed = false;
    let loadingTask:
      | ReturnType<typeof getDocument>
      | undefined;

    setDocument(undefined);
    setPages([]);
    setError("");

    void blob
      .arrayBuffer()
      .then((buffer) => {
        if (disposed) {
          return undefined;
        }
        loadingTask = getDocument({
          data: new Uint8Array(buffer)
        });
        return loadingTask.promise;
      })
      .then(async (loadedDocument) => {
        if (!loadedDocument || disposed) {
          return;
        }
        const descriptors = await Promise.all(
          Array.from(
            { length: loadedDocument.numPages },
            async (_, index) => {
              const page = await loadedDocument.getPage(index + 1);
              const viewport = page.getViewport({ scale: 1 });
              page.cleanup();
              return {
                pageNumber: index + 1,
                width: viewport.width,
                height: viewport.height
              };
            }
          )
        );
        if (disposed) {
          return;
        }
        setDocument(loadedDocument);
        setPages(descriptors);
        onPageCount?.(loadedDocument.numPages);
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          setError(
            reason instanceof Error ? reason.message : "无法读取 PDF"
          );
        }
      });

    return () => {
      disposed = true;
      void loadingTask?.destroy();
    };
  }, [blob, onPageCount]);

  if (error) {
    return <div className="precise-pdf-status is-error">{error}</div>;
  }
  if (!document || pages.length === 0) {
    return <div className="precise-pdf-status">正在读取精确预览…</div>;
  }

  const documentWidth = getPrecisePdfDocumentWidth(
    pages.map((page) => page.width),
    zoomPercent / 100,
    PRECISE_PDF_INLINE_GUTTER
  );

  return (
    <div
      className="precise-pdf-document"
      style={{ width: `${documentWidth}px` }}
    >
      {pages.map((page) => (
        <PrecisePdfPage
          key={page.pageNumber}
          document={document}
          descriptor={page}
          onExternalLink={handleExternalLink}
          onNavigateToPage={handleNavigateToPage}
          renderQueue={renderQueue}
          zoomPercent={zoomPercent}
        />
      ))}
    </div>
  );
}
