import type { SfntFontMetadata } from "./font-embedding.js";

export type WordFontFamily =
  | "auto"
  | "decorative"
  | "modern"
  | "roman"
  | "script"
  | "swiss";

export interface WordFontMetadata {
  panose1: string;
  charset: string;
  family: WordFontFamily;
  pitch: "fixed" | "variable";
  signature: {
    usb0: string;
    usb1: string;
    usb2: string;
    usb3: string;
    csb0: string;
    csb1: string;
  };
}

const codePageCharsets = [
  { bit: 18, charset: "86" },
  { bit: 20, charset: "88" },
  { bit: 17, charset: "80" },
  { bit: 19, charset: "81" },
  { bit: 21, charset: "82" },
  { bit: 16, charset: "DE" },
  { bit: 6, charset: "B2" },
  { bit: 5, charset: "B1" },
  { bit: 7, charset: "BA" },
  { bit: 2, charset: "CC" },
  { bit: 3, charset: "A1" },
  { bit: 4, charset: "A2" },
  { bit: 31, charset: "02" }
] as const;

function uint32Hex(value: number) {
  return value.toString(16).toUpperCase().padStart(8, "0");
}

function byteHex(value: number) {
  return value.toString(16).toUpperCase().padStart(2, "0");
}

function hasCodePageBit(
  ranges: SfntFontMetadata["codePageRanges"],
  bit: number
) {
  const range = ranges[Math.floor(bit / 32)] ?? 0;
  return ((range >>> (bit % 32)) & 1) === 1;
}

function resolveCharset(metadata: SfntFontMetadata) {
  return (
    codePageCharsets.find(({ bit }) =>
      hasCodePageBit(metadata.codePageRanges, bit)
    )?.charset ?? "00"
  );
}

function resolveFamily(metadata: SfntFontMetadata): WordFontFamily {
  if (metadata.fixedPitch) {
    return "modern";
  }
  const [familyType, serifStyle] = metadata.panose;
  if (familyType === 3) {
    return "script";
  }
  if (familyType === 4) {
    return "decorative";
  }
  if (familyType !== 2) {
    return "auto";
  }
  if (serifStyle >= 11 && serifStyle <= 13) {
    return "swiss";
  }
  if (
    (serifStyle >= 2 && serifStyle <= 10) ||
    serifStyle === 14 ||
    serifStyle === 15
  ) {
    return "roman";
  }
  return "auto";
}

export function createWordFontMetadata(
  metadata: SfntFontMetadata
): WordFontMetadata {
  const [usb0, usb1, usb2, usb3] = metadata.unicodeRanges;
  const [csb0, csb1] = metadata.codePageRanges;
  return {
    panose1: metadata.panose.map(byteHex).join(""),
    charset: resolveCharset(metadata),
    family: resolveFamily(metadata),
    pitch: metadata.fixedPitch ? "fixed" : "variable",
    signature: {
      usb0: uint32Hex(usb0),
      usb1: uint32Hex(usb1),
      usb2: uint32Hex(usb2),
      usb3: uint32Hex(usb3),
      csb0: uint32Hex(csb0),
      csb1: uint32Hex(csb1)
    }
  };
}
