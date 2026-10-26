import {
  docxThemeStyleSnapshotSchema,
  type DocxComputedStyle,
  type DocxStyleSlotSnapshot,
  type DocxThemeStyleSnapshot
} from "./snapshot.js";
import { DOCX_STYLE_SLOTS } from "./slots.js";

export interface DocxStyleProbeRoot {
  querySelector(selector: string): unknown | null;
}

export type DocxComputedStyleReader = (
  element: unknown
) => Readonly<DocxComputedStyle>;

export type DocxComputedStyleDeclaration = {
  readonly [Property in keyof DocxComputedStyle]: string;
};

export interface CollectDocxThemeStyleSnapshotOptions {
  root: DocxStyleProbeRoot;
  readComputedStyle: DocxComputedStyleReader;
  themeId: string;
  themeFingerprint: string;
  viewport: {
    widthPx: number;
    heightPx: number;
    deviceScaleFactor: number;
  };
  rootFontSizePx: number;
}

export function readDocxComputedStyle(
  style: DocxComputedStyleDeclaration
): DocxComputedStyle {
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    color: style.color,
    backgroundColor: style.backgroundColor,
    ...(style.backgroundImage
      ? { backgroundImage: style.backgroundImage }
      : {}),
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    textAlign: style.textAlign,
    direction: style.direction,
    textIndent: style.textIndent,
    textDecorationLine: style.textDecorationLine,
    marginTop: style.marginTop,
    marginRight: style.marginRight,
    marginBottom: style.marginBottom,
    marginLeft: style.marginLeft,
    paddingTop: style.paddingTop,
    paddingRight: style.paddingRight,
    paddingBottom: style.paddingBottom,
    paddingLeft: style.paddingLeft,
    borderTop: style.borderTop,
    borderRight: style.borderRight,
    borderBottom: style.borderBottom,
    borderLeft: style.borderLeft,
    width: style.width,
    ...(style.containingBlockWidth
      ? { containingBlockWidth: style.containingBlockWidth }
      : {}),
    maxWidth: style.maxWidth,
    minWidth: style.minWidth,
    minHeight: style.minHeight,
    height: style.height,
    breakBefore: style.breakBefore,
    breakAfter: style.breakAfter,
    breakInside: style.breakInside,
    display: style.display,
    flexDirection: style.flexDirection,
    alignItems: style.alignItems,
    ...(style.alignSelf ? { alignSelf: style.alignSelf } : {}),
    justifyContent: style.justifyContent,
    ...(style.contentPaddingLeft
      ? { contentPaddingLeft: style.contentPaddingLeft }
      : {}),
    outline: style.outline,
    outlineOffset: style.outlineOffset
  };
}

export function collectDocxStyleSlotSnapshots(
  root: DocxStyleProbeRoot,
  readComputedStyle: DocxComputedStyleReader
): DocxStyleSlotSnapshot[] {
  return DOCX_STYLE_SLOTS.map((definition) => {
    const element = root.querySelector(definition.selector);
    if (!element) {
      return {
        slot: definition.name,
        matched: false
      };
    }
    return {
      slot: definition.name,
      matched: true,
      computed: { ...readComputedStyle(element) }
    };
  });
}

export function collectDocxThemeStyleSnapshot(
  options: CollectDocxThemeStyleSnapshotOptions
): DocxThemeStyleSnapshot {
  return docxThemeStyleSnapshotSchema.parse({
    schemaVersion: 1,
    themeId: options.themeId,
    themeFingerprint: options.themeFingerprint,
    viewport: options.viewport,
    rootFontSizePx: options.rootFontSizePx,
    slots: collectDocxStyleSlotSnapshots(
      options.root,
      options.readComputedStyle
    )
  });
}
