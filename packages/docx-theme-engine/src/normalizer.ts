import type {
  DocxFontFamily,
  DocxThemeStyleOverrides
} from "@morphdoc/core";
import {
  cssColorHasPartialAlpha,
  millimetersToPoints,
  parseCssBorder,
  parseCssColor,
  parseCssLinearGradientFallbackColor,
  parseCssFontFamilies,
  parseCssLengthToPt,
  roundDocxValue
} from "./css-values.js";
import type {
  NormalizedDocxThemeMappingConfig
} from "./configuration.js";
import {
  DOCX_STYLE_SLOTS,
  type DocxStyleSlotKind,
  type DocxStyleSlotName
} from "./slots.js";
import {
  docxThemeStyleSnapshotSchema,
  type DocxComputedStyle,
  type DocxThemeStyleSnapshot
} from "./snapshot.js";
import {
  docxThemeTokenSetSchema,
  type DocxResolvedStyleSlot,
  type DocxSlotStyleToken,
  type DocxStyleConfidence,
  type DocxThemeDiagnostic,
  type DocxThemeTokenSet
} from "./tokens.js";

type MutableStyle = {
  -readonly [Property in keyof DocxSlotStyleToken]:
    DocxSlotStyleToken[Property];
};

interface SlotNormalizationContext {
  slot: DocxStyleSlotName;
  kind: DocxStyleSlotKind;
  documentWidthPx?: number;
  diagnostics: DocxThemeDiagnostic[];
  approximate: boolean;
}

function cssLengthToPx(value: string): number {
  const valuePt = parseCssLengthToPt(value);
  return valuePt === undefined ? 0 : valuePt / 0.75;
}

function resolveDocumentContentWidthPx(
  snapshot: DocxThemeStyleSnapshot
): number | undefined {
  const computed = snapshot.slots.find(
    (entry) => entry.slot === "document"
  )?.computed;
  if (!computed) {
    return undefined;
  }
  const widthPt = parseCssLengthToPt(computed.width);
  if (widthPt === undefined) {
    return undefined;
  }
  const borderWidthPx = [computed.borderLeft, computed.borderRight]
    .map((value) => parseCssBorder(value)?.widthPt ?? 0)
    .reduce((total, valuePt) => total + valuePt / 0.75, 0);
  const contentWidthPx =
    widthPt / 0.75 -
    cssLengthToPx(computed.paddingLeft) -
    cssLengthToPx(computed.paddingRight) -
    borderWidthPx;
  return contentWidthPx > 0 ? contentWidthPx : widthPt / 0.75;
}

const paragraphKinds = new Set<DocxStyleSlotKind>([
  "document",
  "paragraph",
  "list",
  "structure"
]);
const widthSlots = new Set<DocxStyleSlotName>([
  "table",
  "figure"
]);
const bodyOverrideSlots = new Set<DocxStyleSlotName>([
  "document",
  "document-author",
  "paragraph",
  "unordered-list",
  "ordered-list",
  "list-item",
  "footnotes"
]);
const headingSlots = [
  "heading-1",
  "heading-2",
  "heading-3",
  "heading-4",
  "heading-5",
  "heading-6"
] as const satisfies readonly DocxStyleSlotName[];

function diagnostic(
  context: SlotNormalizationContext,
  input: Omit<DocxThemeDiagnostic, "slot">
): void {
  context.diagnostics.push({
    ...input,
    slot: context.slot
  });
}

function invalidCssValue(
  context: SlotNormalizationContext,
  property: string,
  value: string
): void {
  diagnostic(context, {
    severity: "warning",
    code: "css-value-invalid",
    property,
    message: `无法将 CSS ${property} 值“${value}”映射到 Word`
  });
  context.approximate = true;
}

function length(
  context: SlotNormalizationContext,
  property: string,
  value: string,
  options: { allowAuto?: boolean; nonNegative?: boolean } = {}
): number | undefined {
  const normalized = value.trim().toLowerCase();
  if (
    options.allowAuto &&
    ["auto", "none", "normal"].includes(normalized)
  ) {
    return undefined;
  }
  const result = parseCssLengthToPt(value);
  if (result === undefined) {
    invalidCssValue(context, property, value);
    return undefined;
  }
  if (options.nonNegative && result < 0) {
    diagnostic(context, {
      severity: "warning",
      code: "layout-approximated",
      property,
      message: `Word 不支持负的 ${property}，已收敛为 0`
    });
    context.approximate = true;
    return 0;
  }
  return result;
}

function color(
  context: SlotNormalizationContext,
  property: string,
  value: string,
  transparentAllowed = false
): string | undefined {
  const result = parseCssColor(value);
  if (
    result === undefined &&
    !(
      transparentAllowed &&
      /^(?:transparent|rgba?\([^)]*(?:,\s*0|\/\s*0%?)\s*\))$/iu.test(
        value.trim()
      )
    )
  ) {
    invalidCssValue(context, property, value);
  }
  if (result !== undefined && cssColorHasPartialAlpha(value)) {
    diagnostic(context, {
      severity: "info",
      code: "layout-approximated",
      property,
      message: `CSS ${property} 半透明色已按白底合成为 Word 不透明色`
    });
    context.approximate = true;
  }
  return result;
}

function normalizeAlignment(
  context: SlotNormalizationContext,
  computed: DocxComputedStyle
): DocxSlotStyleToken["alignment"] {
  const alignment = computed.textAlign.toLowerCase();
  if (
    alignment === "left" ||
    alignment === "center" ||
    alignment === "right" ||
    alignment === "justify"
  ) {
    return alignment;
  }
  if (alignment === "start") {
    return computed.direction === "rtl" ? "right" : "left";
  }
  if (alignment === "end") {
    return computed.direction === "rtl" ? "left" : "right";
  }
  invalidCssValue(context, "text-align", computed.textAlign);
  return undefined;
}

function normalizeBorder(
  context: SlotNormalizationContext,
  property: string,
  value: string
) {
  const parsed = parseCssBorder(value);
  if (!parsed) {
    invalidCssValue(context, property, value);
    return undefined;
  }
  if (parsed.approximated) {
    diagnostic(context, {
      severity: "warning",
      code: "css-property-unsupported",
      property,
      message: `CSS ${property} 的边框样式已近似为 Word 单实线`
    });
    context.approximate = true;
  }
  const widthPt = Math.min(20, parsed.widthPt);
  if (widthPt !== parsed.widthPt) {
    diagnostic(context, {
      severity: "warning",
      code: "layout-approximated",
      property,
      message: `CSS ${property} 宽度 ${parsed.widthPt}pt 超过 Word 映射上限，已收敛为 20pt`
    });
    context.approximate = true;
  }
  return parsed.style === "none" ? undefined : {
    widthPt,
    color: parsed.color,
    style: parsed.style
  };
}

function normalizeComputedSlot(
  computed: DocxComputedStyle,
  context: SlotNormalizationContext
): {
  style: DocxSlotStyleToken;
  confidence: DocxStyleConfidence;
} {
  const fontSizePt = length(
    context,
    "font-size",
    computed.fontSize
  );
  const style: MutableStyle = {
    fontCandidates: parseCssFontFamilies(computed.fontFamily)
  };
  if (!style.fontCandidates.length) {
    invalidCssValue(context, "font-family", computed.fontFamily);
  }
  if (fontSizePt !== undefined) {
    style.fontSizePt = fontSizePt;
  }
  const weight = Number.parseInt(computed.fontWeight, 10);
  style.bold =
    computed.fontWeight.toLowerCase() === "bold" ||
    (Number.isFinite(weight) && weight >= 600);
  style.italic = ["italic", "oblique"].includes(
    computed.fontStyle.toLowerCase()
  );
  const decorations = computed.textDecorationLine
    .toLowerCase()
    .split(/\s+/u);
  style.underline = decorations.includes("underline");
  style.strikethrough = decorations.includes("line-through");
  const foreground = color(context, "color", computed.color);
  if (foreground) {
    style.color = foreground;
  }
  const background = color(
    context,
    "background-color",
    computed.backgroundColor,
    true
  );
  if (background) {
    style.backgroundColor = background;
  } else if (computed.backgroundImage) {
    const gradientBackground = parseCssLinearGradientFallbackColor(
      computed.backgroundImage
    );
    if (gradientBackground) {
      style.backgroundColor = gradientBackground;
      diagnostic(context, {
        severity: "info",
        code: "layout-approximated",
        property: "background-image",
        message: "CSS 线性渐变已使用首个非透明色近似为 Word 段落底纹"
      });
      context.approximate = true;
    }
  }
  const letterSpacing = computed.letterSpacing.toLowerCase() === "normal"
    ? 0
    : length(context, "letter-spacing", computed.letterSpacing);
  if (letterSpacing !== undefined) {
    style.letterSpacingPt = letterSpacing;
  }
  if (fontSizePt !== undefined) {
    if (computed.lineHeight.toLowerCase() === "normal") {
      style.lineSpacing = 1.2;
      diagnostic(context, {
        severity: "info",
        code: "layout-approximated",
        property: "line-height",
        message: "CSS normal 行高按 Word 1.2 倍行距近似"
      });
      context.approximate = true;
    } else {
      const lineHeightPt = length(
        context,
        "line-height",
        computed.lineHeight
      );
      if (lineHeightPt !== undefined) {
        style.lineSpacing = roundDocxValue(
          Math.max(0.5, Math.min(10, lineHeightPt / fontSizePt))
        );
      }
    }
  }
  const top = normalizeBorder(context, "border-top", computed.borderTop);
  const right = normalizeBorder(
    context,
    "border-right",
    computed.borderRight
  );
  const bottom = normalizeBorder(
    context,
    "border-bottom",
    computed.borderBottom
  );
  const left = normalizeBorder(
    context,
    "border-left",
    computed.borderLeft
  );
  if (top || right || bottom || left) {
    style.borders = {
      ...(top ? { top } : {}),
      ...(right ? { right } : {}),
      ...(bottom ? { bottom } : {}),
      ...(left ? { left } : {})
    };
  }
  const outline = normalizeBorder(
    context,
    "outline",
    computed.outline
  );
  if (outline) {
    if (!style.borders) {
      style.borders = {
        top: outline,
        right: outline,
        bottom: outline,
        left: outline
      };
      diagnostic(context, {
        severity: "warning",
        code: "layout-approximated",
        property: "outline",
        message: "CSS outline 已近似为 Word 四边边框"
      });
    } else {
      style.outline = outline;
      diagnostic(context, {
        severity: "info",
        code: "layout-approximated",
        property: "outline",
        message: "CSS border 与 outline 并存，DOCX 容器将生成双层边框"
      });
    }
    context.approximate = true;
    const outlineOffsetPt = length(
      context,
      "outline-offset",
      computed.outlineOffset
    );
    if (outlineOffsetPt !== undefined && outlineOffsetPt !== 0) {
      if (style.outline) {
        style.outlineOffsetPt = outlineOffsetPt;
      }
      diagnostic(context, {
        severity: style.outline ? "info" : "warning",
        code: style.outline
          ? "layout-approximated"
          : "css-property-unsupported",
        property: "outline-offset",
        message: style.outline
          ? `DOCX 容器将以单元格间距近似 CSS outline-offset ${outlineOffsetPt}pt`
          : `Word 边框不支持 CSS outline-offset ${outlineOffsetPt}pt，结构层需近似处理`
      });
      context.approximate = true;
    }
  }
  if (paragraphKinds.has(context.kind) || context.kind === "table") {
    style.alignment = normalizeAlignment(context, computed);
    const firstLineIndentPt = length(
      context,
      "text-indent",
      computed.textIndent
    );
    const leftIndentPt = length(
      context,
      "margin-left",
      computed.marginLeft
    );
    const rightIndentPt = length(
      context,
      "margin-right",
      computed.marginRight
    );
    const spacingBeforePt = length(
      context,
      "margin-top",
      computed.marginTop,
      { nonNegative: true }
    );
    const spacingAfterPt = length(
      context,
      "margin-bottom",
      computed.marginBottom,
      { nonNegative: true }
    );
    if (firstLineIndentPt !== undefined) {
      style.firstLineIndentPt = firstLineIndentPt;
    }
    if (leftIndentPt !== undefined) {
      style.leftIndentPt = leftIndentPt;
    }
    if (rightIndentPt !== undefined) {
      style.rightIndentPt = rightIndentPt;
    }
    if (spacingBeforePt !== undefined) {
      style.spacingBeforePt = spacingBeforePt;
    }
    if (spacingAfterPt !== undefined) {
      style.spacingAfterPt = spacingAfterPt;
    }
  }
  const padding = {
    top: length(context, "padding-top", computed.paddingTop, {
      nonNegative: true
    }),
    right: length(context, "padding-right", computed.paddingRight, {
      nonNegative: true
    }),
    bottom: length(context, "padding-bottom", computed.paddingBottom, {
      nonNegative: true
    }),
    left: length(context, "padding-left", computed.paddingLeft, {
      nonNegative: true
    })
  };
  if (
    padding.top !== undefined &&
    padding.right !== undefined &&
    padding.bottom !== undefined &&
    padding.left !== undefined
  ) {
    style.paddingPt = {
      top: padding.top,
      right: padding.right,
      bottom: padding.bottom,
      left: padding.left
    };
  }
  const containingBlockWidthPt = computed.containingBlockWidth
    ? parseCssLengthToPt(computed.containingBlockWidth)
    : undefined;
  const relativeWidthPx =
    containingBlockWidthPt !== undefined
      ? containingBlockWidthPt / 0.75
      : context.documentWidthPx;
  if (
    (widthSlots.has(context.slot) || context.kind === "structure") &&
    relativeWidthPx
  ) {
    const widthPt = parseCssLengthToPt(computed.width);
    const widthPx = widthPt === undefined ? undefined : widthPt / 0.75;
    if (widthPx !== undefined) {
      const percent = (widthPx / relativeWidthPx) * 100;
      style.widthPercent = Math.round(
        Math.max(0, Math.min(100, percent))
      );
      if (percent > 100.01) {
        diagnostic(context, {
          severity: "info",
          code: "layout-approximated",
          property: "width",
          message: "元素宽度超过正文区域，已收敛为 100%"
        });
        context.approximate = true;
      }
    }
  }
  if (context.kind === "structure" && context.documentWidthPx) {
    const percentage = /^([+-]?(?:\d+\.?\d*|\.\d+))%$/u.exec(
      computed.minWidth
    );
    const minimumWidthPercent = percentage
      ? Number.parseFloat(percentage[1]!)
      : (() => {
          const minimumWidthPt = parseCssLengthToPt(computed.minWidth);
          return minimumWidthPt === undefined
            ? undefined
            : ((minimumWidthPt / 0.75) / context.documentWidthPx) * 100;
        })();
    if (
      minimumWidthPercent !== undefined &&
      minimumWidthPercent > 0
    ) {
      style.minimumWidthPercent = roundDocxValue(
        Math.min(100, minimumWidthPercent)
      );
    }
  }
  const minimumHeightPt = length(
    context,
    "min-height",
    computed.minHeight,
    { allowAuto: true, nonNegative: true }
  );
  if (minimumHeightPt !== undefined && minimumHeightPt > 0) {
    style.minimumHeightPt = minimumHeightPt;
  }
  const contentPaddingLeftPt = computed.contentPaddingLeft
    ? length(context, "content-padding-left", computed.contentPaddingLeft, {
        allowAuto: true,
        nonNegative: true
      })
    : undefined;
  if (contentPaddingLeftPt !== undefined && contentPaddingLeftPt > 0) {
    style.contentPaddingLeftPt = contentPaddingLeftPt;
  }
  if (computed.display === "none") {
    style.hidden = true;
  }
  if (
    computed.display === "flex" &&
    computed.flexDirection.startsWith("column")
  ) {
    const verticalAlignment = {
      "flex-start": "top",
      start: "top",
      center: "center",
      "flex-end": "bottom",
      end: "bottom"
    } as const;
    const resolved =
      verticalAlignment[
        computed.justifyContent as keyof typeof verticalAlignment
      ];
    if (resolved) {
      style.verticalAlignment = resolved;
    }
    const childAlignment = {
      "flex-start": "left",
      start: "left",
      center: "center",
      "flex-end": "right",
      end: "right",
      stretch: "stretch"
    } as const;
    const resolvedChildAlignment =
      childAlignment[
        computed.alignItems as keyof typeof childAlignment
      ];
    if (resolvedChildAlignment) {
      style.childAlignment = resolvedChildAlignment;
    }
  }
  const selfAlignment = {
    "flex-start": "left",
    start: "left",
    center: "center",
    "flex-end": "right",
    end: "right",
    stretch: "stretch"
  } as const;
  const resolvedSelfAlignment = computed.alignSelf
    ? selfAlignment[computed.alignSelf as keyof typeof selfAlignment]
    : undefined;
  if (resolvedSelfAlignment) {
    style.selfAlignment = resolvedSelfAlignment;
  }
  if (computed.display === "flex" || computed.display === "grid") {
    diagnostic(context, {
      severity: "info",
      code: "layout-approximated",
      property: "display",
      message: `CSS ${computed.display} 布局将由 DOCX 结构层近似`
    });
    context.approximate = true;
  }
  style.pageBreakBefore = ["page", "left", "right"].includes(
    computed.breakBefore
  )
    ? true
    : undefined;
  style.pageBreakAfter = ["page", "left", "right"].includes(
    computed.breakAfter
  )
    ? true
    : undefined;
  style.keepLines = ["avoid", "avoid-page"].includes(
    computed.breakInside
  )
    ? true
    : undefined;
  style.keepWithNext = ["avoid", "avoid-page"].includes(
    computed.breakAfter
  )
    ? true
    : undefined;
  return {
    style,
    confidence: context.approximate ? "approximate" : "exact"
  };
}

function overrideFontCandidates(fonts: DocxFontFamily): string[] {
  return [
    fonts.eastAsia,
    fonts.latin,
    ...(fonts.complexScript ? [fonts.complexScript] : [])
  ].filter((font, index, all) => all.indexOf(font) === index);
}

function applyBorderColor(
  style: MutableStyle,
  borderColor: string,
  sides: readonly ("top" | "right" | "bottom" | "left")[]
): void {
  const borders = { ...style.borders };
  for (const side of sides) {
    borders[side] = {
      widthPt: borders[side]?.widthPt ?? 0.75,
      style: borders[side]?.style ?? "single",
      color: borderColor
    };
  }
  style.borders = borders;
}

function applyOverrides(
  slot: DocxStyleSlotName,
  styleInput: DocxSlotStyleToken,
  overrides: DocxThemeStyleOverrides,
  replaceExisting: boolean
): {
  style: DocxSlotStyleToken;
  applied: boolean;
} {
  const style: MutableStyle = { ...styleInput };
  let applied = false;
  const assign = <Key extends keyof MutableStyle>(
    key: Key,
    value: MutableStyle[Key] | undefined
  ) => {
    if (
      value !== undefined &&
      (replaceExisting || style[key] === undefined)
    ) {
      style[key] = value;
      applied = true;
    }
  };
  if (bodyOverrideSlots.has(slot) && overrides.body) {
    const body = overrides.body;
    assign(
      "fontCandidates",
      body.fonts
        ? overrideFontCandidates(body.fonts)
        : undefined
    );
    assign("fontSizePt", body.sizePt);
    assign("color", body.color?.toLowerCase());
    assign("lineSpacing", body.lineSpacing);
    assign(
      "firstLineIndentPt",
      body.firstLineIndentChars === undefined
        ? undefined
        : body.firstLineIndentChars *
          (body.sizePt ?? style.fontSizePt ?? 12)
    );
    assign("spacingBeforePt", body.spacingBeforePt);
    assign("spacingAfterPt", body.spacingAfterPt);
  }
  const headingIndex = headingSlots.indexOf(
    slot as (typeof headingSlots)[number]
  );
  if (headingIndex >= 0 && overrides.headings) {
    const headings = overrides.headings;
    assign(
      "fontCandidates",
      headings.fonts
        ? overrideFontCandidates(headings.fonts)
        : undefined
    );
    assign("fontSizePt", headings.sizesPt?.[headingIndex]);
    assign("color", headings.color?.toLowerCase());
    assign("bold", headings.bold);
    assign("spacingBeforePt", headings.spacingBeforePt);
    assign("spacingAfterPt", headings.spacingAfterPt);
  }
  if (
    (slot === "inline-code" || slot === "code-block") &&
    overrides.code
  ) {
    const code = overrides.code;
    assign(
      "fontCandidates",
      code.fonts ? overrideFontCandidates(code.fonts) : undefined
    );
    assign("fontSizePt", code.sizePt);
    assign("color", code.color?.toLowerCase());
    assign("backgroundColor", code.backgroundColor?.toLowerCase());
    assign("lineSpacing", code.lineSpacing);
    if (code.borderColor) {
      applyBorderColor(
        style,
        code.borderColor.toLowerCase(),
        ["top", "right", "bottom", "left"]
      );
      applied = true;
    }
  }
  if (slot === "block-quote" && overrides.blockQuote) {
    const quote = overrides.blockQuote;
    assign("color", quote.color?.toLowerCase());
    assign("backgroundColor", quote.backgroundColor?.toLowerCase());
    assign("italic", quote.italic);
    assign(
      "leftIndentPt",
      quote.leftIndentChars === undefined
        ? undefined
        : quote.leftIndentChars * (style.fontSizePt ?? 12)
    );
    if (quote.borderColor) {
      applyBorderColor(
        style,
        quote.borderColor.toLowerCase(),
        ["left"]
      );
      applied = true;
    }
  }
  if (
    (slot === "table" ||
      slot === "table-header" ||
      slot === "table-cell") &&
    overrides.table
  ) {
    const table = overrides.table;
    assign(
      "fontCandidates",
      table.fonts ? overrideFontCandidates(table.fonts) : undefined
    );
    assign("fontSizePt", table.sizePt);
    assign(
      "color",
      (
        slot === "table-header"
          ? table.headerColor ?? table.color
          : table.color
      )?.toLowerCase()
    );
    if (slot === "table-header") {
      assign(
        "backgroundColor",
        table.headerBackgroundColor?.toLowerCase()
      );
    }
    if (table.borderColor) {
      applyBorderColor(
        style,
        table.borderColor.toLowerCase(),
        ["top", "right", "bottom", "left"]
      );
      applied = true;
    }
    if (
      table.cellMarginMm !== undefined &&
      (slot === "table-header" || slot === "table-cell")
    ) {
      const margin = millimetersToPoints(table.cellMarginMm);
      assign("paddingPt", {
        top: margin,
        right: margin,
        bottom: margin,
        left: margin
      });
    }
  }
  if (slot === "caption" && overrides.caption) {
    const caption = overrides.caption;
    assign(
      "fontCandidates",
      caption.fonts
        ? overrideFontCandidates(caption.fonts)
        : undefined
    );
    assign("fontSizePt", caption.sizePt);
    assign("color", caption.color?.toLowerCase());
    assign("italic", caption.italic);
    assign("alignment", caption.alignment);
  }
  if (slot === "hyperlink" && overrides.hyperlink) {
    assign("color", overrides.hyperlink.color?.toLowerCase());
    assign("underline", overrides.hyperlink.underline);
  }
  return { style, applied };
}

export interface ResolveDocxThemeTokensOptions {
  snapshot: DocxThemeStyleSnapshot;
  config: NormalizedDocxThemeMappingConfig;
}

export function resolveDocxThemeTokens(
  input: ResolveDocxThemeTokensOptions
): DocxThemeTokenSet {
  const snapshot = docxThemeStyleSnapshotSchema.parse(input.snapshot);
  const diagnostics: DocxThemeDiagnostic[] = [];
  const documentWidthPx = resolveDocumentContentWidthPx(snapshot);
  const snapshotBySlot = new Map(
    snapshot.slots.map((entry) => [entry.slot, entry])
  );
  const slots: DocxResolvedStyleSlot[] = DOCX_STYLE_SLOTS.map(
    (definition) => {
      const entry = snapshotBySlot.get(definition.name);
      const useComputedCss =
        input.config.mode !== "explicit" &&
        entry?.matched === true &&
        entry.computed !== undefined;
      let resolved: DocxResolvedStyleSlot;
      if (useComputedCss && entry.computed) {
        const context: SlotNormalizationContext = {
          slot: definition.name,
          kind: definition.kind,
          ...(documentWidthPx === undefined
            ? {}
            : { documentWidthPx }),
          diagnostics,
          approximate: false
        };
        const normalized = normalizeComputedSlot(
          entry.computed,
          context
        );
        resolved = {
          slot: definition.name,
          source: "computed-css",
          confidence: normalized.confidence,
          style: normalized.style
        };
      } else {
        const missing =
          input.config.mode !== "explicit" &&
          entry?.matched !== true;
        diagnostics.push({
          severity: missing ? "warning" : "info",
          code:
            missing
              ? "slot-not-found"
              : "preset-fallback-used",
          message:
            missing
              ? `样式槽位 ${definition.name} 未命中，使用 ${input.config.basePreset} 预设`
              : `显式模式下样式槽位 ${definition.name} 使用 ${input.config.basePreset} 预设`,
          slot: definition.name
        });
        resolved = {
          slot: definition.name,
          source: "preset-fallback",
          confidence: "fallback",
          style: { fontCandidates: [] }
        };
      }
      if (
        input.config.mode === "auto-with-overrides" ||
        input.config.mode === "explicit"
      ) {
        const override = applyOverrides(
          definition.name,
          resolved.style,
          input.config.overrides,
          input.config.mode === "explicit" ||
            !input.config.legacyPreset ||
            resolved.source === "preset-fallback"
        );
        if (override.applied) {
          diagnostics.push({
            severity: "info",
            code: "manifest-override-applied",
            message: `主题清单覆盖已应用到 ${definition.name}`,
            slot: definition.name
          });
          resolved = {
            slot: definition.name,
            source: "manifest-override",
            confidence: "exact",
            style: override.style
          };
        }
      }
      return resolved;
    }
  );
  const blockQuote = slots.find((entry) => entry.slot === "block-quote");
  const blockQuoteText = slots.find(
    (entry) => entry.slot === "block-quote-text"
  );
  if (blockQuote && blockQuoteText) {
    const text = blockQuoteText.style;
    blockQuote.style = {
      ...blockQuote.style,
      ...(text.fontCandidates.length > 0
        ? { fontCandidates: text.fontCandidates }
        : {}),
      ...(text.fontSizePt !== undefined
        ? { fontSizePt: text.fontSizePt }
        : {}),
      ...(text.bold !== undefined ? { bold: text.bold } : {}),
      ...(text.italic !== undefined ? { italic: text.italic } : {}),
      ...(text.underline !== undefined
        ? { underline: text.underline }
        : {}),
      ...(text.strikethrough !== undefined
        ? { strikethrough: text.strikethrough }
        : {}),
      ...(text.color !== undefined ? { color: text.color } : {}),
      ...(text.lineSpacing !== undefined
        ? { lineSpacing: text.lineSpacing }
        : {}),
      ...(text.letterSpacingPt !== undefined
        ? { letterSpacingPt: text.letterSpacingPt }
        : {}),
      ...(text.alignment !== undefined
        ? { alignment: text.alignment }
        : {}),
      ...(text.firstLineIndentPt !== undefined
        ? { firstLineIndentPt: text.firstLineIndentPt }
        : {})
    };
  }
  return docxThemeTokenSetSchema.parse({
    schemaVersion: 1,
    themeId: snapshot.themeId,
    themeFingerprint: snapshot.themeFingerprint,
    mode: input.config.mode,
    basePreset: input.config.basePreset,
    slots,
    diagnostics
  });
}
