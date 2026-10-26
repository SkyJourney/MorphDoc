import { z } from "zod";
import { createDocxStyleProbeMarkup } from "./probe.js";
import {
  docxThemeStyleSnapshotSchema,
  type DocxComputedStyle,
  type DocxThemeStyleSnapshot
} from "./snapshot.js";
import { DOCX_STYLE_SLOTS } from "./slots.js";

const DOCX_STYLE_PROBE_WIDTH_PX = 794;
const DOCX_STYLE_PROBE_HEIGHT_PX = 1123;
const DOCX_STYLE_PROBE_CONTENT_WIDTH_PX = 640;

export const docxThemeStyleCaptureRequestSchema = z.object({
  themeId: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  themeFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  themeCss: z.string().max(4 * 1024 * 1024),
  baseUrl: z.string().url().max(2048)
});

export type DocxThemeStyleCaptureRequest = z.infer<
  typeof docxThemeStyleCaptureRequestSchema
>;

export interface DocxThemeStyleCaptureAdapter {
  readonly themeStyleBaseUrl: string;
  captureThemeStyle(
    request: DocxThemeStyleCaptureRequest,
    signal?: AbortSignal
  ): Promise<DocxThemeStyleSnapshot>;
}

const runtimeCaptureSchema = z.object({
  rootFontSizePx: z.number().positive().max(200),
  viewport: z.object({
    widthPx: z.number().int().positive().max(10000),
    heightPx: z.number().int().positive().max(10000),
    deviceScaleFactor: z.number().positive().max(10)
  }),
  slots: z.array(
    z.object({
      slot: z.string(),
      matched: z.boolean(),
      computed: z.record(z.string(), z.string()).optional()
    })
  )
});

const computedProperties = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "color",
  "backgroundColor",
  "backgroundImage",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "direction",
  "textIndent",
  "textDecorationLine",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTop",
  "borderRight",
  "borderBottom",
  "borderLeft",
  "width",
  "maxWidth",
  "minWidth",
  "minHeight",
  "height",
  "breakBefore",
  "breakAfter",
  "breakInside",
  "display",
  "flexDirection",
  "alignItems",
  "alignSelf",
  "justifyContent",
  "outline",
  "outlineOffset"
] as const satisfies readonly (keyof DocxComputedStyle)[];

const baselineCss = `
html,
body {
  margin: 0;
  padding: 0;
}

* {
  box-sizing: border-box;
}

#write {
  width: ${DOCX_STYLE_PROBE_CONTENT_WIDTH_PX}px;
  margin: 0;
  padding: 0;
}

#write pre.md-fences > code,
#write .md-code-pagination-chunk > code {
  display: block;
  min-width: 0;
  max-width: 100%;
  padding: 0;
  padding-left: 8px;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  font-size: inherit;
  font-weight: inherit;
  line-height: inherit;
}
`;

export function createDocxThemeStyleCaptureScript(
  input: DocxThemeStyleCaptureRequest
): string {
  const request = docxThemeStyleCaptureRequestSchema.parse(input);
  const payload = JSON.stringify({
    request,
    markup: createDocxStyleProbeMarkup(),
    slots: DOCX_STYLE_SLOTS,
    properties: computedProperties,
    baselineCss,
    viewport: {
      width: DOCX_STYLE_PROBE_WIDTH_PX,
      height: DOCX_STYLE_PROBE_HEIGHT_PX
    }
  })
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  return `(async () => {
    const payload = ${payload};
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText =
      "position:fixed;left:-32000px;top:-32000px;" +
      "width:" + payload.viewport.width + "px;" +
      "height:" + payload.viewport.height + "px;" +
      "border:0;visibility:hidden;pointer-events:none;";
    document.body.appendChild(frame);
    try {
      const probeDocument = frame.contentDocument;
      const probeWindow = frame.contentWindow;
      if (!probeDocument || !probeWindow) {
        throw new Error("DOCX 主题样式探针 iframe 不可用");
      }
      probeDocument.open();
      probeDocument.write(
        "<!doctype html><html><head></head><body></body></html>"
      );
      probeDocument.close();
      const base = probeDocument.createElement("base");
      base.href = payload.request.baseUrl;
      probeDocument.head.appendChild(base);
      const baseline = probeDocument.createElement("style");
      baseline.dataset.docxProbeStyle = "baseline";
      baseline.textContent = payload.baselineCss;
      probeDocument.head.appendChild(baseline);
      const theme = probeDocument.createElement("style");
      theme.dataset.docxProbeStyle = "theme";
      theme.textContent = payload.request.themeCss;
      probeDocument.head.appendChild(theme);
      probeDocument.body.innerHTML = payload.markup;
      const fontReady = probeDocument.fonts
        ? probeDocument.fonts.ready
        : Promise.resolve();
      await Promise.race([
        fontReady,
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error("DOCX 主题字体等待超时")),
            10000
          );
        })
      ]);
      await new Promise((resolve) =>
        probeWindow.requestAnimationFrame(() =>
          probeWindow.requestAnimationFrame(resolve)
        )
      );
      const slots = payload.slots.map((definition) => {
        const element = probeDocument.querySelector(
          definition.selector
        );
        if (!element) {
          return {
            slot: definition.name,
            matched: false
          };
        }
        const style = probeWindow.getComputedStyle(element);
        const computed = {};
        for (const property of payload.properties) {
          computed[property] = style[property];
        }
        const contentElement = element.firstElementChild;
        if (contentElement) {
          computed.contentPaddingLeft =
            probeWindow.getComputedStyle(contentElement).paddingLeft;
        }
        const containingBlock = element.parentElement;
        if (containingBlock) {
          const containingStyle = probeWindow.getComputedStyle(
            containingBlock
          );
          const containingRect = containingBlock.getBoundingClientRect();
          const horizontalInsets = [
            containingStyle.borderLeftWidth,
            containingStyle.borderRightWidth,
            containingStyle.paddingLeft,
            containingStyle.paddingRight
          ].reduce(
            (total, value) => total + (Number.parseFloat(value) || 0),
            0
          );
          computed.containingBlockWidth =
            Math.max(0, containingRect.width - horizontalInsets) + "px";
        }
        return {
          slot: definition.name,
          matched: true,
          computed
        };
      });
      const rootFontSize = Number.parseFloat(
        probeWindow.getComputedStyle(
          probeDocument.documentElement
        ).fontSize
      );
      return {
        rootFontSizePx: rootFontSize,
        viewport: {
          widthPx: payload.viewport.width,
          heightPx: payload.viewport.height,
          deviceScaleFactor: probeWindow.devicePixelRatio || 1
        },
        slots
      };
    } finally {
      frame.remove();
    }
  })()`;
}

export function parseDocxThemeStyleRuntimeCapture(
  requestInput: DocxThemeStyleCaptureRequest,
  captureInput: unknown
): DocxThemeStyleSnapshot {
  const request =
    docxThemeStyleCaptureRequestSchema.parse(requestInput);
  const capture = runtimeCaptureSchema.parse(captureInput);
  return docxThemeStyleSnapshotSchema.parse({
    schemaVersion: 1,
    themeId: request.themeId,
    themeFingerprint: request.themeFingerprint,
    viewport: capture.viewport,
    rootFontSizePx: capture.rootFontSizePx,
    slots: capture.slots
  });
}
