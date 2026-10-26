import {
  CSS_PIXELS_PER_INCH,
  PDF_POINTS_PER_INCH
} from "@morphdoc/core";

export const PDF_PAGE_CSS_SCALE =
  CSS_PIXELS_PER_INCH / PDF_POINTS_PER_INCH;

export function getPdfPageCssDimensions(
  widthPoints: number,
  heightPoints: number,
  displayScale = 1
) {
  return {
    width: widthPoints * PDF_PAGE_CSS_SCALE * displayScale,
    height: heightPoints * PDF_PAGE_CSS_SCALE * displayScale
  };
}

export function getPdfCanvasRenderScale(
  widthPoints: number,
  displayWidthCssPixels: number,
  devicePixelRatio: number
) {
  if (
    widthPoints <= 0 ||
    displayWidthCssPixels <= 0 ||
    devicePixelRatio <= 0
  ) {
    return 0;
  }
  return (displayWidthCssPixels / widthPoints) * devicePixelRatio;
}

export function getPrecisePdfDocumentWidth(
  pageWidthsPoints: readonly number[],
  displayScale: number,
  inlineGutter: number
) {
  const maximumPageWidth = Math.max(0, ...pageWidthsPoints);
  if (
    maximumPageWidth <= 0 ||
    displayScale <= 0 ||
    inlineGutter < 0
  ) {
    return 0;
  }
  return Math.ceil(
    maximumPageWidth * PDF_PAGE_CSS_SCALE * displayScale +
      inlineGutter * 2
  );
}
