import { z } from "zod";

export const EXPORT_CONFIG_VERSION = 4;
export const CSS_PIXELS_PER_INCH = 96;
export const PDF_POINTS_PER_INCH = 72;
export const MILLIMETERS_PER_INCH = 25.4;

export const supportedMermaidLayouts = ["dagre", "elk"] as const;
export const supportedMermaidThemes = [
  "default",
  "base",
  "dark",
  "forest",
  "neutral",
  "neo",
  "neo-dark",
  "redux",
  "redux-dark",
  "redux-color",
  "redux-dark-color"
] as const;
export const supportedMermaidLooks = [
  "classic",
  "handDrawn",
  "neo"
] as const;

export const supportedPaperFormats = [
  "A3",
  "A4",
  "A5",
  "Letter",
  "Legal"
] as const;

export const paperFormatLabels: Record<
  (typeof supportedPaperFormats)[number],
  string
> = {
  A3: "A3",
  A4: "A4",
  A5: "A5",
  Letter: "US-Letter",
  Legal: "US-Legal"
};

export const paperDimensionsMm: Record<
  (typeof supportedPaperFormats)[number],
  { width: number; height: number }
> = {
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 }
};

const lengthSchema = z
  .string()
  .regex(/^\d+(?:\.\d+)?(?:mm|cm|in)$/, "长度必须包含 mm、cm 或 in 单位");

export function lengthToMillimeters(value: string) {
  const number = Number.parseFloat(value);
  if (value.endsWith("cm")) {
    return number * 10;
  }
  if (value.endsWith("in")) {
    return number * MILLIMETERS_PER_INCH;
  }
  return number;
}

export function millimetersToCssPixels(value: number) {
  return (value * CSS_PIXELS_PER_INCH) / MILLIMETERS_PER_INCH;
}

export function cssPixelsToMillimeters(value: number) {
  return (value * MILLIMETERS_PER_INCH) / CSS_PIXELS_PER_INCH;
}

export function cssPixelsToPdfPoints(value: number) {
  return (value * PDF_POINTS_PER_INCH) / CSS_PIXELS_PER_INCH;
}

export function millimetersToPdfPoints(value: number) {
  return (value * PDF_POINTS_PER_INCH) / MILLIMETERS_PER_INCH;
}

export const pageMarginsSchema = z.object({
  top: lengthSchema,
  right: lengthSchema,
  bottom: lengthSchema,
  left: lengthSchema
});

export const marginModeSchema = z.enum(["theme", "custom"]);
export const pageDecorationsModeSchema = z.enum(["theme", "custom"]);

export const headerSlotSchema = z.object({
  enabled: z.boolean(),
  content: z.string().max(500)
});

const pageDecorationFontFamilySchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .regex(
    /^[\p{L}\p{N}\s,"'-]+$/u,
    "页眉页码字体只能包含字体名称、引号和逗号"
  );

export const headerSchema = z.object({
  enabled: z.boolean(),
  height: lengthSchema,
  showOnFirstPage: z.boolean().default(true),
  showDivider: z.boolean(),
  fontSize: lengthSchema,
  fontFamily: pageDecorationFontFamilySchema.default(
    '"Segoe UI", "Microsoft YaHei", sans-serif'
  ),
  color: z.string(),
  left: headerSlotSchema,
  center: headerSlotSchema,
  right: headerSlotSchema
});

export const pageNumberFormatSchema = z.enum([
  "page",
  "page-total",
  "chinese-page-total",
  "dash-page",
  "official-page",
  "custom"
]);

export const footerAlignmentSchema = z.enum([
  "left",
  "center",
  "right",
  "outer"
]);

export const footerSchema = z.object({
  enabled: z.boolean(),
  height: lengthSchema,
  showDivider: z.boolean(),
  fontSize: lengthSchema,
  fontFamily: pageDecorationFontFamilySchema.default(
    '"Segoe UI", "Microsoft YaHei", sans-serif'
  ),
  color: z.string(),
  alignment: footerAlignmentSchema,
  format: pageNumberFormatSchema,
  template: z.string().max(500).optional(),
  startFrom: z.number().int().positive(),
  showOnFirstPage: z.boolean().default(true)
});

const paperSchema = z
  .object({
    format: z.enum(supportedPaperFormats),
    orientation: z.enum(["portrait", "landscape"]),
    marginMode: marginModeSchema,
    margins: pageMarginsSchema
  })
  .superRefine((paper, context) => {
    const sourceDimensions = paperDimensionsMm[paper.format];
    const dimensions =
      paper.orientation === "portrait"
        ? sourceDimensions
        : {
            width: sourceDimensions.height,
            height: sourceDimensions.width
          };
    const horizontalMargins =
      lengthToMillimeters(paper.margins.left) +
      lengthToMillimeters(paper.margins.right);
    const verticalMargins =
      lengthToMillimeters(paper.margins.top) +
      lengthToMillimeters(paper.margins.bottom);

    if (horizontalMargins >= dimensions.width) {
      context.addIssue({
        code: "custom",
        message: "左右页边距之和必须小于纸张宽度",
        path: ["margins", "right"]
      });
    }
    if (verticalMargins >= dimensions.height) {
      context.addIssue({
        code: "custom",
        message: "上下页边距之和必须小于纸张高度",
        path: ["margins", "bottom"]
      });
    }
  });

export const mermaidConfigSchema = z.object({
  layout: z.enum(supportedMermaidLayouts),
  theme: z.enum(supportedMermaidThemes),
  look: z.enum(supportedMermaidLooks),
  fontFamily: z.string().trim().min(1).max(300)
});

export const exportConfigSchema = z.object({
  version: z.literal(EXPORT_CONFIG_VERSION),
  name: z.string().min(1).max(100),
  themeId: z.string().min(1),
  pageDecorationsMode: pageDecorationsModeSchema.default("theme"),
  mermaid: mermaidConfigSchema,
  paper: paperSchema,
  header: headerSchema,
  footer: footerSchema,
  metadata: z.object({
    title: z.string().max(300),
    author: z.string().max(300),
    subject: z.string().max(500),
    keywords: z.array(z.string().max(100)).max(30),
    language: z.string().max(30)
  }),
  print: z.object({
    background: z.boolean(),
    scale: z.number().min(0.1).max(2),
    pageBreakBeforeH1: z.boolean()
  })
});

export type ExportConfig = z.infer<typeof exportConfigSchema>;
export type MermaidExportConfig = ExportConfig["mermaid"];
export type PaperFormat = ExportConfig["paper"]["format"];
export type PaperOrientation = ExportConfig["paper"]["orientation"];
export type PageMargins = ExportConfig["paper"]["margins"];
export type MarginMode = ExportConfig["paper"]["marginMode"];
export type PageDecorationsMode = ExportConfig["pageDecorationsMode"];
export type HeaderConfig = ExportConfig["header"];
export type FooterConfig = ExportConfig["footer"];

export const defaultPageMargins: PageMargins = {
  top: "16mm",
  right: "16mm",
  bottom: "16mm",
  left: "16mm"
};

export function resolvePageMargins(
  paper: Pick<ExportConfig["paper"], "marginMode" | "margins">,
  themeMargins?: PageMargins
): PageMargins {
  const source =
    paper.marginMode === "theme"
      ? themeMargins ?? defaultPageMargins
      : paper.margins;
  return { ...source };
}

export function getPaperDimensionsMm(
  format: PaperFormat,
  orientation: PaperOrientation
) {
  const dimensions = paperDimensionsMm[format];
  return orientation === "portrait"
    ? dimensions
    : { width: dimensions.height, height: dimensions.width };
}

const disabledHeaderSlot = {
  enabled: false,
  content: ""
} as const;

export const defaultExportConfig: ExportConfig = {
  version: EXPORT_CONFIG_VERSION,
  name: "默认 A4 文档",
  themeId: "typora-github",
  pageDecorationsMode: "theme",
  mermaid: {
    layout: "dagre",
    theme: "default",
    look: "classic",
    fontFamily: "Segoe UI, Microsoft YaHei, sans-serif"
  },
  paper: {
    format: "A4",
    orientation: "portrait",
    marginMode: "theme",
    margins: { ...defaultPageMargins }
  },
  header: {
    enabled: false,
    height: "8mm",
    showOnFirstPage: true,
    showDivider: false,
    fontSize: "3mm",
    fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif',
    color: "#6b7280",
    left: disabledHeaderSlot,
    center: disabledHeaderSlot,
    right: disabledHeaderSlot
  },
  footer: {
    enabled: true,
    height: "8mm",
    showDivider: false,
    fontSize: "3mm",
    fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif',
    color: "#6b7280",
    alignment: "center",
    format: "page-total",
    startFrom: 1,
    showOnFirstPage: true
  },
  metadata: {
    title: "",
    author: "",
    subject: "",
    keywords: [],
    language: "zh-CN"
  },
  print: {
    background: true,
    scale: 1,
    pageBreakBeforeH1: false
  }
};
