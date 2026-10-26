const PX_TO_PT = 72 / 96;
const MM_TO_PT = 72 / 25.4;

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function parseCssLengthToPt(
  input: string
): number | undefined {
  const value = input.trim().toLowerCase();
  if (value === "0") {
    return 0;
  }
  const match = /^(-?(?:\d+|\d*\.\d+))(px|pt|pc|in|cm|mm|q)$/u.exec(
    value
  );
  if (!match) {
    return undefined;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return undefined;
  }
  const unit = match[2];
  const factors: Readonly<Record<string, number>> = {
    px: PX_TO_PT,
    pt: 1,
    pc: 12,
    in: 72,
    cm: 72 / 2.54,
    mm: MM_TO_PT,
    q: MM_TO_PT / 4
  };
  const factor = unit ? factors[unit] : undefined;
  return factor === undefined ? undefined : round(amount * factor);
}

export function parseCssColor(
  input: string
): string | undefined {
  const value = input.trim().toLowerCase();
  if (value === "transparent") {
    return undefined;
  }
  const hex = /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/u.exec(value);
  if (hex?.[1]) {
    if (hex[1].length === 3) {
      return `#${[...hex[1]].map((part) => part.repeat(2)).join("")}`;
    }
    if (hex[1].length === 8) {
      const alpha = Number.parseInt(hex[1].slice(6), 16) / 255;
      if (alpha === 0) {
        return undefined;
      }
      const channels = [0, 2, 4].map((offset) =>
        Number.parseInt(hex[1]?.slice(offset, offset + 2) ?? "0", 16)
      );
      return formatRgb(compositeOnWhite(channels, alpha));
    }
    return `#${hex[1].slice(0, 6)}`;
  }
  const rgb =
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d+(?:\.\d+)?%?))?\s*\)$/u.exec(
      value
    );
  if (!rgb) {
    return undefined;
  }
  const alpha = parseAlpha(rgb[4]);
  if (alpha === 0) {
    return undefined;
  }
  const channels = rgb.slice(1, 4).map((part) =>
    Math.max(0, Math.min(255, Math.round(Number(part))))
  );
  return formatRgb(
    alpha === undefined ? channels : compositeOnWhite(channels, alpha)
  );
}

export function parseCssLinearGradientFallbackColor(
  input: string
): string | undefined {
  const value = input.trim();
  if (!/^(?:repeating-)?linear-gradient\(/iu.test(value)) {
    return undefined;
  }
  const colorValues = value.match(
    /rgba?\([^)]*\)|#[\da-f]{3,8}/giu
  ) ?? [];
  for (const colorValue of colorValues) {
    const parsed = parseCssColor(colorValue);
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
}

function parseAlpha(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const alpha = value.endsWith("%")
    ? Number(value.slice(0, -1)) / 100
    : Number(value);
  return Number.isFinite(alpha)
    ? Math.max(0, Math.min(1, alpha))
    : undefined;
}

function compositeOnWhite(
  channels: readonly number[],
  alpha: number
): number[] {
  return channels.map((channel) =>
    Math.round(channel * alpha + 255 * (1 - alpha))
  );
}

function formatRgb(channels: readonly number[]): string {
  return `#${channels
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function cssColorHasPartialAlpha(input: string): boolean {
  const value = input.trim().toLowerCase();
  const hex = /^#[\da-f]{6}([\da-f]{2})$/u.exec(value);
  if (hex?.[1]) {
    const alpha = Number.parseInt(hex[1], 16);
    return alpha > 0 && alpha < 255;
  }
  const rgb =
    /^rgba?\([^)]*(?:[,/]\s*(\d+(?:\.\d+)?%?))\s*\)$/u.exec(value);
  const alpha = parseAlpha(rgb?.[1]);
  return alpha !== undefined && alpha > 0 && alpha < 1;
}

export function parseCssFontFamilies(input: string): string[] {
  const families: string[] = [];
  let current = "";
  let quote = "";
  for (const character of input) {
    if ((character === `"` || character === "'") && !quote) {
      quote = character;
      continue;
    }
    if (character === quote) {
      quote = "";
      continue;
    }
    if (character === "," && !quote) {
      const family = current.trim();
      if (family) {
        families.push(family);
      }
      current = "";
      continue;
    }
    current += character;
  }
  const finalFamily = current.trim();
  if (finalFamily) {
    families.push(finalFamily);
  }
  return [...new Set(families)].slice(0, 20);
}

export interface ParsedCssBorder {
  widthPt: number;
  color: string;
  style: "none" | "single" | "double" | "dotted" | "dashed";
  approximated: boolean;
}

export function parseCssBorder(
  input: string
): ParsedCssBorder | undefined {
  const value = input.trim();
  const widthMatch =
    /(?:^|\s)(-?(?:\d+|\d*\.\d+)(?:px|pt|pc|in|cm|mm|q))(?=\s|$)/iu.exec(
      value
    );
  const styleMatch =
    /\b(none|hidden|solid|double|dotted|dashed|groove|ridge|inset|outset)\b/iu.exec(
      value
    );
  const colorMatch =
    /(rgba?\([^)]*\)|#[\da-f]{3,8})/iu.exec(value);
  if (!widthMatch?.[1] || !styleMatch?.[1] || !colorMatch?.[1]) {
    return undefined;
  }
  const widthPt = parseCssLengthToPt(widthMatch[1]);
  const color = parseCssColor(colorMatch[1]);
  if (widthPt === undefined) {
    return undefined;
  }
  const cssStyle = styleMatch[1].toLowerCase();
  if (widthPt <= 0 || cssStyle === "none" || cssStyle === "hidden") {
    return {
      widthPt: 0,
      color: color ?? "#000000",
      style: "none",
      approximated: false
    };
  }
  if (!color) {
    return undefined;
  }
  const supported = {
    solid: "single",
    double: "double",
    dotted: "dotted",
    dashed: "dashed"
  } as const;
  const style = supported[cssStyle as keyof typeof supported];
  return {
    widthPt,
    color,
    style: style ?? "single",
    approximated: style === undefined
  };
}

export function millimetersToPoints(value: number): number {
  return round(value * MM_TO_PT);
}

export function roundDocxValue(value: number): number {
  return round(value);
}
