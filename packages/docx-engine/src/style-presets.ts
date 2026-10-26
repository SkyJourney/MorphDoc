import {
  docxThemeStyleSchema,
  type DocxFontFamily,
  type DocxStylePreset,
  type DocxThemeStyle,
  type ThemeManifest
} from "@morphdoc/core";

export interface ResolvedDocxThemeStyle {
  preset: DocxStylePreset;
  body: {
    fonts: DocxFontFamily;
    sizePt: number;
    color: string;
    lineSpacing: number;
    firstLineIndentChars: number;
    spacingBeforePt: number;
    spacingAfterPt: number;
  };
  headings: {
    fonts: DocxFontFamily;
    sizesPt: [number, number, number, number, number, number];
    color: string;
    bold: boolean;
    spacingBeforePt: number;
    spacingAfterPt: number;
  };
  code: {
    fonts: DocxFontFamily;
    sizePt: number;
    color: string;
    backgroundColor: string;
    borderColor: string;
    lineSpacing: number;
  };
  blockQuote: {
    color: string;
    backgroundColor: string;
    borderColor: string;
    leftIndentChars: number;
    italic: boolean;
  };
  table: {
    fonts: DocxFontFamily;
    sizePt: number;
    color: string;
    headerColor: string;
    headerBackgroundColor: string;
    borderColor: string;
    cellMarginMm: number;
  };
  caption: {
    fonts: DocxFontFamily;
    sizePt: number;
    color: string;
    italic: boolean;
    alignment: "left" | "center" | "right";
  };
  hyperlink: {
    color: string;
    underline: boolean;
  };
}

const songFonts: DocxFontFamily = {
  latin: "Times New Roman",
  eastAsia: "SimSun"
};
const sansFonts: DocxFontFamily = {
  latin: "Arial",
  eastAsia: "SimHei"
};
const technicalFonts: DocxFontFamily = {
  latin: "Arial",
  eastAsia: "Microsoft YaHei"
};
const codeFonts: DocxFontFamily = {
  latin: "Consolas",
  eastAsia: "Microsoft YaHei"
};

const baseStyle: Omit<ResolvedDocxThemeStyle, "preset"> = {
  body: {
    fonts: songFonts,
    sizePt: 10.5,
    color: "#1f2328",
    lineSpacing: 1.5,
    firstLineIndentChars: 0,
    spacingBeforePt: 0,
    spacingAfterPt: 6
  },
  headings: {
    fonts: sansFonts,
    sizesPt: [22, 18, 16, 14, 12, 10.5],
    color: "#1f2328",
    bold: true,
    spacingBeforePt: 12,
    spacingAfterPt: 6
  },
  code: {
    fonts: codeFonts,
    sizePt: 9,
    color: "#24292f",
    backgroundColor: "#f6f8fa",
    borderColor: "#d0d7de",
    lineSpacing: 1.25
  },
  blockQuote: {
    color: "#57606a",
    backgroundColor: "#ffffff",
    borderColor: "#d0d7de",
    leftIndentChars: 2,
    italic: false
  },
  table: {
    fonts: songFonts,
    sizePt: 10.5,
    color: "#1f2328",
    headerColor: "#1f2328",
    headerBackgroundColor: "#f6f8fa",
    borderColor: "#d0d7de",
    cellMarginMm: 1.5
  },
  caption: {
    fonts: songFonts,
    sizePt: 9,
    color: "#57606a",
    italic: false,
    alignment: "center"
  },
  hyperlink: {
    color: "#0969da",
    underline: true
  }
};

const presetOverrides: Record<
  DocxStylePreset,
  Partial<Omit<ResolvedDocxThemeStyle, "preset">>
> = {
  general: {},
  technical: {
    body: {
      ...baseStyle.body,
      fonts: technicalFonts
    },
    table: {
      ...baseStyle.table,
      fonts: technicalFonts
    }
  },
  official: {
    body: {
      ...baseStyle.body,
      sizePt: 16,
      firstLineIndentChars: 2,
      spacingAfterPt: 0
    },
    headings: {
      ...baseStyle.headings,
      color: "#000000",
      sizesPt: [22, 18, 16, 16, 14, 12]
    }
  },
  formal: {
    body: {
      ...baseStyle.body,
      sizePt: 13.5,
      firstLineIndentChars: 2,
      spacingAfterPt: 0
    },
    headings: {
      ...baseStyle.headings,
      color: "#1f2937"
    }
  },
  tender: {
    body: {
      ...baseStyle.body,
      sizePt: 12,
      lineSpacing: 1.5
    },
    headings: {
      ...baseStyle.headings,
      color: "#1f4e79"
    },
    table: {
      ...baseStyle.table,
      headerBackgroundColor: "#dbeafe",
      borderColor: "#94a3b8"
    }
  }
};

function mergeSection<T extends object>(
  base: T,
  override:
    | { [Key in keyof T]?: T[Key] | undefined }
    | undefined
): T {
  if (!override) {
    return { ...base };
  }
  const result = { ...base };
  for (const key of Object.keys(override) as Array<keyof T>) {
    const value = override[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

export function inferDocxStylePreset(
  manifest: Pick<ThemeManifest, "category">
): DocxStylePreset {
  if (manifest.category === "red-letter") {
    return "official";
  }
  if (manifest.category === "formal") {
    return "formal";
  }
  if (manifest.category === "tender") {
    return "tender";
  }
  return "general";
}

export function resolveDocxThemeStyle(
  manifest: ThemeManifest
): ResolvedDocxThemeStyle {
  const declared: DocxThemeStyle = docxThemeStyleSchema.parse(
    manifest.docxStyle ?? {
      preset: inferDocxStylePreset(manifest)
    }
  );
  const presetName =
    declared.basePreset ??
    declared.preset ??
    inferDocxStylePreset(manifest);
  const preset = presetOverrides[presetName];
  const overrides = declared.overrides;
  const base = {
    ...baseStyle,
    ...preset
  };
  return {
    preset: presetName,
    body: mergeSection(
      mergeSection(base.body, declared.body),
      overrides?.body
    ),
    headings: mergeSection(
      mergeSection(base.headings, declared.headings),
      overrides?.headings
    ),
    code: mergeSection(
      mergeSection(base.code, declared.code),
      overrides?.code
    ),
    blockQuote: mergeSection(
      mergeSection(base.blockQuote, declared.blockQuote),
      overrides?.blockQuote
    ),
    table: mergeSection(
      mergeSection(base.table, declared.table),
      overrides?.table
    ),
    caption: mergeSection(
      mergeSection(base.caption, declared.caption),
      overrides?.caption
    ),
    hyperlink: mergeSection(
      mergeSection(base.hyperlink, declared.hyperlink),
      overrides?.hyperlink
    )
  };
}
