import type { DocxFontFamily } from "@morphdoc/core";
import {
  docxThemeTokenSetSchema,
  type DocxResolvedStyleSlot,
  type DocxSlotStyleToken,
  type DocxStyleSlotName,
  type DocxThemeTokenSet
} from "@morphdoc/docx-theme-engine";

export interface DocxWordStyleBinding {
  styleId: string;
  type: "paragraph" | "character";
  basedOn?: string;
}

function paragraph(
  styleId: string,
  basedOn = "Normal"
): DocxWordStyleBinding {
  return { styleId, type: "paragraph", basedOn };
}

function character(
  styleId: string,
  basedOn = "DefaultParagraphFont"
): DocxWordStyleBinding {
  return { styleId, type: "character", basedOn };
}

export const DOCX_SLOT_WORD_STYLE_BINDINGS: Readonly<
  Partial<
    Record<
      DocxStyleSlotName,
      readonly DocxWordStyleBinding[]
    >
  >
> = {
  "document-title": [paragraph("Title")],
  "document-author": [paragraph("Author")],
  paragraph: [
    paragraph("Normal", ""),
    paragraph("BodyText"),
    paragraph("FirstParagraph"),
    paragraph("Definition"),
    paragraph("Figure")
  ],
  strong: [character("Strong")],
  emphasis: [character("Emphasis")],
  strikethrough: [character("Strikeout")],
  "inline-code": [character("VerbatimChar", "BodyTextChar")],
  "heading-1": [
    paragraph("Heading1"),
    character("Heading1Char")
  ],
  "heading-2": [
    paragraph("Heading2"),
    character("Heading2Char")
  ],
  "heading-3": [
    paragraph("Heading3"),
    character("Heading3Char")
  ],
  "heading-4": [
    paragraph("Heading4"),
    character("Heading4Char")
  ],
  "heading-5": [
    paragraph("Heading5"),
    character("Heading5Char")
  ],
  "heading-6": [
    paragraph("Heading6"),
    character("Heading6Char")
  ],
  "unordered-list": [paragraph("MdUnorderedList", "BodyText")],
  "ordered-list": [paragraph("MdOrderedList", "BodyText")],
  "list-item": [
    paragraph("Compact", "BodyText"),
    paragraph("ListParagraph", "BodyText")
  ],
  "block-quote": [paragraph("BlockText", "BodyText")],
  "code-block": [paragraph("SourceCode")],
  hyperlink: [character("Hyperlink", "BodyTextChar")],
  figure: [paragraph("Figure")],
  caption: [
    paragraph("Caption"),
    paragraph("TableCaption", "Caption"),
    paragraph("ImageCaption", "Caption")
  ],
  footnotes: [paragraph("FootnoteText")],
  "official-masthead": [paragraph("MdOfficialMasthead")],
  "official-classification": [
    paragraph("MdOfficialClassification")
  ],
  "official-issuer": [paragraph("MdOfficialIssuer")],
  "official-issue-row": [paragraph("MdOfficialIssueRow")],
  "official-number": [paragraph("MdOfficialNumber")],
  "official-signatory": [paragraph("MdOfficialSignatory")],
  "official-title": [paragraph("MdOfficialTitle")],
  "official-signature": [paragraph("MdOfficialSignature")],
  "official-signature-issuer": [
    paragraph("MdOfficialSignatureIssuer")
  ],
  "official-signature-date": [
    paragraph("MdOfficialSignatureDate")
  ],
  "official-edition": [paragraph("MdOfficialEdition")],
  "official-copy-to": [paragraph("MdOfficialCopyTo")],
  "official-printing-row": [
    paragraph("MdOfficialPrintingRow")
  ],
  "briefing-masthead": [paragraph("MdBriefingMasthead")],
  "briefing-masthead-text": [paragraph("MdBriefingMastheadText")],
  "briefing-meta": [paragraph("MdBriefingMeta")],
  "briefing-title": [paragraph("MdBriefingTitle")],
  "briefing-contact": [paragraph("MdBriefingContact")],
  "project-report-cover": [paragraph("MdProjectReportCover")],
  "project-report-project-name": [
    paragraph("MdProjectReportProjectName")
  ],
  "project-report-title": [paragraph("MdProjectReportTitle")],
  "project-report-version": [
    paragraph("MdProjectReportVersion")
  ],
  "project-report-owner": [paragraph("MdProjectReportOwner")],
  "project-report-prepared-by": [
    paragraph("MdProjectReportPreparedBy")
  ],
  "project-report-date": [paragraph("MdProjectReportDate")],
  "tender-cover": [paragraph("MdTenderCover")],
  "tender-copy-mark": [paragraph("MdTenderCopyMark")],
  "tender-project-name": [paragraph("MdTenderProjectName")],
  "tender-project-number": [
    paragraph("MdTenderProjectNumber")
  ],
  "tender-title": [paragraph("MdTenderTitle")],
  "tender-volume": [paragraph("MdTenderVolume")],
  "tender-bidder": [paragraph("MdTenderBidder")],
  "tender-representative": [
    paragraph("MdTenderRepresentative")
  ],
  "tender-date": [paragraph("MdTenderDate")]
};

export const PANDOC_SYNTAX_STYLE_IDS = [
  "AlertTok",
  "AnnotationTok",
  "AttributeTok",
  "BaseNTok",
  "BuiltInTok",
  "CharTok",
  "CommentTok",
  "CommentVarTok",
  "ConstantTok",
  "ControlFlowTok",
  "DataTypeTok",
  "DecValTok",
  "DocumentationTok",
  "ErrorTok",
  "ExtensionTok",
  "FloatTok",
  "FunctionTok",
  "ImportTok",
  "InformationTok",
  "KeywordTok",
  "NormalTok",
  "OperatorTok",
  "OtherTok",
  "PreprocessorTok",
  "SpecialCharTok",
  "SpecialStringTok",
  "StringTok",
  "VariableTok",
  "VerbatimStringTok",
  "WarningTok"
] as const;

const pandocSyntaxSlots: Readonly<
  Partial<Record<(typeof PANDOC_SYNTAX_STYLE_IDS)[number], DocxStyleSlotName>>
> = {
  AlertTok: "code-token-keyword",
  AnnotationTok: "code-token-comment",
  AttributeTok: "code-token-attribute",
  BaseNTok: "code-token-number",
  BuiltInTok: "code-token-built-in",
  CharTok: "code-token-string",
  CommentTok: "code-token-comment",
  CommentVarTok: "code-token-comment",
  ConstantTok: "code-token-literal",
  ControlFlowTok: "code-token-keyword",
  DataTypeTok: "code-token-attribute",
  DecValTok: "code-token-number",
  DocumentationTok: "code-token-comment",
  ErrorTok: "code-token-keyword",
  ExtensionTok: "code-token-built-in",
  FloatTok: "code-token-number",
  FunctionTok: "code-token-title",
  ImportTok: "code-token-keyword",
  InformationTok: "code-token-comment",
  KeywordTok: "code-token-keyword",
  OperatorTok: "code-token-operator",
  PreprocessorTok: "code-token-meta",
  SpecialCharTok: "code-token-string",
  SpecialStringTok: "code-token-string",
  StringTok: "code-token-string",
  VariableTok: "code-token-variable",
  VerbatimStringTok: "code-token-string",
  WarningTok: "code-token-keyword"
};

export function resolvePandocSyntaxStyleSlot(
  styleId: string,
  text = "",
  context: { htmlTagName?: boolean; objectPropertyKey?: boolean } = {}
): DocxStyleSlotName | "code-block-text" | undefined {
  if (!(PANDOC_SYNTAX_STYLE_IDS as readonly string[]).includes(styleId)) {
    return undefined;
  }
  if (context.htmlTagName) {
    return "code-token-name";
  }
  if (context.objectPropertyKey) {
    return "code-token-attribute";
  }
  if (
    styleId === "NormalTok" ||
    styleId === "OtherTok" ||
    ((styleId === "FunctionTok" || styleId === "DataTypeTok") &&
      /^[\p{P}\p{S}\s]+$/u.test(text))
  ) {
    return styleId === "FunctionTok" || styleId === "DataTypeTok"
      ? "code-token-punctuation"
      : "code-block-text";
  }
  return pandocSyntaxSlots[
    styleId as (typeof PANDOC_SYNTAX_STYLE_IDS)[number]
  ] ?? "code-block-text";
}

const eastAsiaFontPattern =
  /(?:fandol|yahei|simsun|simhei|fangsong|kaiti|dengxian|cjk|source\s+han|pingfang|heiti|songti|宋|黑|仿宋|楷|等线)/iu;
const genericFontNames = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui"
]);

export function resolveTokenFonts(
  token: DocxSlotStyleToken | undefined,
  fallback: DocxFontFamily,
  options: { preserveFallbackEastAsia?: boolean } = {}
): DocxFontFamily {
  const candidates = (token?.fontCandidates ?? []).filter(
    (candidate) =>
      !genericFontNames.has(candidate.trim().toLowerCase())
  );
  if (!candidates.length) {
    return fallback;
  }
  const eastAsia =
    candidates.find((candidate) =>
      eastAsiaFontPattern.test(candidate)
    ) ?? (options.preserveFallbackEastAsia
      ? fallback.eastAsia
      : candidates[0]!);
  const latin =
    candidates.find(
      (candidate) => !eastAsiaFontPattern.test(candidate)
    ) ?? candidates[0]!;
  return {
    latin,
    eastAsia,
    complexScript: latin
  };
}

export function createDocxTokenSlotMap(
  input: DocxThemeTokenSet
): ReadonlyMap<DocxStyleSlotName, DocxResolvedStyleSlot> {
  const tokens = docxThemeTokenSetSchema.parse(input);
  return new Map(
    tokens.slots.map((entry) => [entry.slot, entry])
  );
}

export function collectDocxTokenFonts(
  input: DocxThemeTokenSet
): Set<string> {
  const fonts = new Set<string>();
  for (const { style } of input.slots) {
    for (const candidate of style.fontCandidates) {
      if (!genericFontNames.has(candidate.trim().toLowerCase())) {
        fonts.add(candidate);
      }
    }
  }
  return fonts;
}
