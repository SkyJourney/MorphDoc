import { z } from "zod";

export const DOCX_STYLE_SLOT_NAMES = [
  "document",
  "document-title",
  "document-author",
  "paragraph",
  "strong",
  "emphasis",
  "strikethrough",
  "inline-code",
  "heading-1",
  "heading-2",
  "heading-3",
  "heading-4",
  "heading-5",
  "heading-6",
  "unordered-list",
  "ordered-list",
  "list-item",
  "block-quote",
  "block-quote-text",
  "code-block",
  "code-block-text",
  "code-token-keyword",
  "code-token-literal",
  "code-token-string",
  "code-token-attribute",
  "code-token-title",
  "code-token-number",
  "code-token-comment",
  "code-token-built-in",
  "code-token-meta",
  "code-token-variable",
  "code-token-operator",
  "code-token-regexp",
  "code-token-punctuation",
  "code-token-name",
  "table",
  "table-header",
  "table-cell",
  "hyperlink",
  "figure",
  "image",
  "caption",
  "footnotes",
  "official-masthead",
  "official-classification",
  "official-issuer",
  "official-issue-row",
  "official-number",
  "official-signatory",
  "official-title",
  "official-signature",
  "official-signature-issuer",
  "official-signature-date",
  "official-edition",
  "official-copy-to",
  "official-printing-row",
  "briefing-masthead",
  "briefing-masthead-text",
  "briefing-meta",
  "briefing-title",
  "briefing-contact",
  "project-report-cover",
  "project-report-project-name",
  "project-report-title",
  "project-report-version",
  "project-report-owner",
  "project-report-prepared-by",
  "project-report-date",
  "tender-cover",
  "tender-copy-mark",
  "tender-project-name",
  "tender-project-number",
  "tender-title",
  "tender-volume",
  "tender-bidder",
  "tender-representative",
  "tender-date"
] as const;

export const docxStyleSlotNameSchema = z.enum(
  DOCX_STYLE_SLOT_NAMES
);

export type DocxStyleSlotName = z.infer<
  typeof docxStyleSlotNameSchema
>;

export const docxStyleSlotKindSchema = z.enum([
  "document",
  "paragraph",
  "inline",
  "list",
  "table",
  "media",
  "structure"
]);

export type DocxStyleSlotKind = z.infer<
  typeof docxStyleSlotKindSchema
>;

export interface DocxStyleSlotDefinition {
  name: DocxStyleSlotName;
  kind: DocxStyleSlotKind;
  selector: string;
}

function slot(
  name: DocxStyleSlotName,
  kind: DocxStyleSlotKind
): DocxStyleSlotDefinition {
  return {
    name,
    kind,
    selector: `[data-docx-slot="${name}"]`
  };
}

const kinds: Record<DocxStyleSlotName, DocxStyleSlotKind> = {
  document: "document",
  "document-title": "paragraph",
  "document-author": "paragraph",
  paragraph: "paragraph",
  strong: "inline",
  emphasis: "inline",
  strikethrough: "inline",
  "inline-code": "inline",
  "heading-1": "paragraph",
  "heading-2": "paragraph",
  "heading-3": "paragraph",
  "heading-4": "paragraph",
  "heading-5": "paragraph",
  "heading-6": "paragraph",
  "unordered-list": "list",
  "ordered-list": "list",
  "list-item": "list",
  "block-quote": "paragraph",
  "block-quote-text": "paragraph",
  "code-block": "paragraph",
  "code-block-text": "inline",
  "code-token-keyword": "inline",
  "code-token-literal": "inline",
  "code-token-string": "inline",
  "code-token-attribute": "inline",
  "code-token-title": "inline",
  "code-token-number": "inline",
  "code-token-comment": "inline",
  "code-token-built-in": "inline",
  "code-token-meta": "inline",
  "code-token-variable": "inline",
  "code-token-operator": "inline",
  "code-token-regexp": "inline",
  "code-token-punctuation": "inline",
  "code-token-name": "inline",
  table: "table",
  "table-header": "table",
  "table-cell": "table",
  hyperlink: "inline",
  figure: "media",
  image: "media",
  caption: "paragraph",
  footnotes: "paragraph",
  "official-masthead": "structure",
  "official-classification": "structure",
  "official-issuer": "structure",
  "official-issue-row": "structure",
  "official-number": "structure",
  "official-signatory": "structure",
  "official-title": "structure",
  "official-signature": "structure",
  "official-signature-issuer": "structure",
  "official-signature-date": "structure",
  "official-edition": "structure",
  "official-copy-to": "structure",
  "official-printing-row": "structure",
  "briefing-masthead": "structure",
  "briefing-masthead-text": "structure",
  "briefing-meta": "structure",
  "briefing-title": "structure",
  "briefing-contact": "structure",
  "project-report-cover": "structure",
  "project-report-project-name": "structure",
  "project-report-title": "structure",
  "project-report-version": "structure",
  "project-report-owner": "structure",
  "project-report-prepared-by": "structure",
  "project-report-date": "structure",
  "tender-cover": "structure",
  "tender-copy-mark": "structure",
  "tender-project-name": "structure",
  "tender-project-number": "structure",
  "tender-title": "structure",
  "tender-volume": "structure",
  "tender-bidder": "structure",
  "tender-representative": "structure",
  "tender-date": "structure"
};

export const DOCX_STYLE_SLOTS: readonly DocxStyleSlotDefinition[] =
  DOCX_STYLE_SLOT_NAMES.map((name) => slot(name, kinds[name]));
