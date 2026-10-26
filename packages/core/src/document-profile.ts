import { z } from "zod";

const scalarTextSchema = (maximumLength: number) =>
  z.preprocess(
    (value) => {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        return String(value).trim();
      }
      return value;
    },
    z.string().min(1).max(maximumLength)
  );

const shortTextSchema = scalarTextSchema(120);
const longTextSchema = scalarTextSchema(500);
const textListSchema = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value
          .split(/[，,]/u)
          .map((item) => item.trim())
          .filter(Boolean)
      : value,
  z.array(shortTextSchema).max(30)
);

export const documentProfileNameSchema = z.enum([
  "official",
  "briefing",
  "project-report",
  "tender"
]);

const officialDocumentProfileSchema = z
  .object({
    profile: z.literal("official"),
    issuer: shortTextSchema.optional(),
    number: shortTextSchema.optional(),
    secrecy: shortTextSchema.optional(),
    urgency: shortTextSchema.optional(),
    signatory: shortTextSchema.optional(),
    date: shortTextSchema.optional(),
    copyTo: textListSchema.optional(),
    printingOffice: shortTextSchema.optional()
  })
  .strict();

const briefingDocumentProfileSchema = z
  .object({
    profile: z.literal("briefing"),
    masthead: shortTextSchema.optional(),
    issue: shortTextSchema.optional(),
    publisher: shortTextSchema.optional(),
    signatory: shortTextSchema.optional(),
    date: shortTextSchema.optional(),
    contact: longTextSchema.optional()
  })
  .strict();

const projectReportDocumentProfileSchema = z
  .object({
    profile: z.literal("project-report"),
    projectName: longTextSchema.optional(),
    documentType: shortTextSchema.optional(),
    owner: longTextSchema.optional(),
    preparedBy: longTextSchema.optional(),
    version: shortTextSchema.optional(),
    date: shortTextSchema.optional()
  })
  .strict();

const tenderDocumentProfileSchema = z
  .object({
    profile: z.literal("tender"),
    copyMark: shortTextSchema.optional(),
    projectName: longTextSchema.optional(),
    projectNumber: shortTextSchema.optional(),
    volume: shortTextSchema.optional(),
    bidder: longTextSchema.optional(),
    representative: shortTextSchema.optional(),
    date: shortTextSchema.optional()
  })
  .strict();

export const documentProfileSchema = z.discriminatedUnion("profile", [
  officialDocumentProfileSchema,
  briefingDocumentProfileSchema,
  projectReportDocumentProfileSchema,
  tenderDocumentProfileSchema
]);

export type DocumentProfileName = z.infer<
  typeof documentProfileNameSchema
>;
export type DocumentProfile = z.infer<typeof documentProfileSchema>;
