declare module "fontverter" {
  export type FontFormat = "sfnt" | "woff" | "woff2";

  export interface Fontverter {
    convert(
      content: Buffer,
      targetFormat: FontFormat,
      sourceFormat?: FontFormat
    ): Promise<Buffer>;
    detectFormat(content: Buffer): FontFormat;
  }

  const fontverter: Fontverter;
  export default fontverter;
}
