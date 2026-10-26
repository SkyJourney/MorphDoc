import { z } from "zod";
import { documentProfileNameSchema } from "./document-profile.js";

export const semanticDocumentRoleSchema = z.enum([
  "official-masthead",
  "official-classification",
  "official-secrecy",
  "official-urgency",
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
  "official-printing-office",
  "official-printing-date",
  "briefing-masthead",
  "briefing-masthead-text",
  "briefing-meta",
  "briefing-issue",
  "briefing-publisher",
  "briefing-signatory",
  "briefing-date",
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
]);

export type SemanticDocumentRole = z.infer<
  typeof semanticDocumentRoleSchema
>;

export interface SemanticDocumentTextNode {
  kind: "text";
  role: SemanticDocumentRole;
  text: string;
  label?: string | undefined;
}

export interface SemanticDocumentGroupNode {
  kind: "group";
  role: SemanticDocumentRole;
  layout?: "space-between" | undefined;
  children: SemanticDocumentNode[];
}

export type SemanticDocumentNode =
  | SemanticDocumentTextNode
  | SemanticDocumentGroupNode;

export const semanticDocumentNodeSchema: z.ZodType<
  SemanticDocumentNode
> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("text"),
      role: semanticDocumentRoleSchema,
      text: z.string().min(1).max(1000),
      label: z.string().min(1).max(100).optional()
    }),
    z.object({
      kind: z.literal("group"),
      role: semanticDocumentRoleSchema,
      layout: z.literal("space-between").optional(),
      children: z.array(semanticDocumentNodeSchema).min(1).max(30)
    })
  ])
);

export const semanticDocumentRegionKindSchema = z.enum([
  "cover",
  "prefix",
  "suffix"
]);

export type SemanticDocumentRegionKind = z.infer<
  typeof semanticDocumentRegionKindSchema
>;

export const semanticDocumentSectionIntentSchema = z.object({
  headerFooter: z.literal("none"),
  pageNumber: z.literal("hidden"),
  breakAfter: z.literal("next-page"),
  followingPageNumberStart: z.number().int().min(0).max(100000)
});

export type SemanticDocumentSectionIntent = z.infer<
  typeof semanticDocumentSectionIntentSchema
>;

export const semanticDocumentRegionSchema = z.object({
  kind: semanticDocumentRegionKindSchema,
  nodes: z.array(semanticDocumentNodeSchema).min(1).max(30),
  section: semanticDocumentSectionIntentSchema.optional()
});

export type SemanticDocumentRegion = z.infer<
  typeof semanticDocumentRegionSchema
>;

export const semanticDocumentTitlePolicySchema = z.object({
  metadataTitle: z.enum(["emit", "suppress"]),
  firstBodyHeading: z.enum(["keep", "suppress"])
});

export type SemanticDocumentTitlePolicy = z.infer<
  typeof semanticDocumentTitlePolicySchema
>;

export const semanticDocumentModelSchema = z.object({
  schemaVersion: z.literal(1),
  profile: documentProfileNameSchema.optional(),
  titlePolicy: semanticDocumentTitlePolicySchema,
  regions: z.array(semanticDocumentRegionSchema).max(10)
});

export type SemanticDocumentModel = z.infer<
  typeof semanticDocumentModelSchema
>;
