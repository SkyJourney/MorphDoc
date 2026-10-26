const printMediaPattern =
  /@media(\s+)(only\s+)?print(?=\s*(?:\{|and\b|,))/gi;

export function enablePrintMediaForPreview(css: string) {
  return css.replace(
    printMediaPattern,
    (_match, whitespace: string, qualifier: string | undefined) =>
      `@media${whitespace}${qualifier ?? ""}screen`
  );
}
