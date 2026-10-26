import {
  semanticDocumentModelSchema,
  type DocumentProfile,
  type MarkdownDocumentMetadata,
  type SemanticDocumentGroupNode,
  type SemanticDocumentModel,
  type SemanticDocumentNode,
  type SemanticDocumentRegion,
  type SemanticDocumentRole,
  type SemanticDocumentTextNode
} from "@morphdoc/core";

export interface CreateSemanticDocumentModelOptions {
  metadata: MarkdownDocumentMetadata;
  firstBodyHeading?: string;
}

function normalizeTitle(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

function text(
  role: SemanticDocumentRole,
  value: string | undefined,
  label?: string
): SemanticDocumentTextNode | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  return {
    kind: "text",
    role,
    text: normalized,
    ...(label ? { label } : {})
  };
}

function group(
  role: SemanticDocumentRole,
  children: readonly (SemanticDocumentNode | undefined)[],
  layout?: SemanticDocumentGroupNode["layout"]
): SemanticDocumentGroupNode | undefined {
  const resolved = children.filter(
    (child): child is SemanticDocumentNode => child !== undefined
  );
  return resolved.length
    ? {
        kind: "group",
        role,
        ...(layout ? { layout } : {}),
        children: resolved
      }
    : undefined;
}

function region(
  kind: SemanticDocumentRegion["kind"],
  nodes: readonly (SemanticDocumentNode | undefined)[],
  cover = false
): SemanticDocumentRegion | undefined {
  const resolved = nodes.filter(
    (node): node is SemanticDocumentNode => node !== undefined
  );
  if (!resolved.length) {
    return undefined;
  }
  return {
    kind,
    nodes: resolved,
    ...(cover
      ? {
          section: {
            headerFooter: "none",
            pageNumber: "hidden",
            breakAfter: "next-page",
            followingPageNumberStart: 1
          } as const
        }
      : {})
  };
}

function officialRegions(
  title: string,
  document: Extract<DocumentProfile, { profile: "official" }>
): SemanticDocumentRegion[] {
  const classification = group("official-classification", [
    text("official-secrecy", document.secrecy),
    text("official-urgency", document.urgency)
  ], "space-between");
  const issueRow = group("official-issue-row", [
    text("official-number", document.number),
    text("official-signatory", document.signatory, "签发人：")
  ], "space-between");
  const masthead = group("official-masthead", [
    classification,
    text("official-issuer", document.issuer),
    issueRow
  ]);
  const signature = group("official-signature", [
    text("official-signature-issuer", document.issuer),
    text("official-signature-date", document.date)
  ]);
  const printingRow = group("official-printing-row", [
    text("official-printing-office", document.printingOffice),
    text(
      "official-printing-date",
      document.date ? `${document.date}印发` : undefined
    )
  ], "space-between");
  const edition = group("official-edition", [
    text(
      "official-copy-to",
      document.copyTo?.join("、"),
      "抄送："
    ),
    printingRow
  ]);
  return [
    region("prefix", [
      masthead,
      text("official-title", title)
    ]),
    region("suffix", [signature, edition])
  ].filter(
    (item): item is SemanticDocumentRegion => item !== undefined
  );
}

function briefingRegions(
  title: string,
  document: Extract<DocumentProfile, { profile: "briefing" }>
): SemanticDocumentRegion[] {
  const details = group("briefing-meta", [
    text("briefing-issue", document.issue),
    text("briefing-publisher", document.publisher),
    text("briefing-signatory", document.signatory, "签发："),
    text("briefing-date", document.date)
  ], "space-between");
  const masthead = group("briefing-masthead", [
    text("briefing-masthead-text", document.masthead),
    details
  ]);
  return [
    region("prefix", [
      masthead,
      text("briefing-title", title)
    ]),
    region("suffix", [
      text("briefing-contact", document.contact)
    ])
  ].filter(
    (item): item is SemanticDocumentRegion => item !== undefined
  );
}

function projectReportRegions(
  title: string,
  document: Extract<
    DocumentProfile,
    { profile: "project-report" }
  >
): SemanticDocumentRegion[] {
  const cover = group("project-report-cover", [
    text(
      "project-report-project-name",
      document.projectName
    ),
    text(
      "project-report-title",
      document.documentType || title
    ),
    text("project-report-version", document.version),
    text("project-report-owner", document.owner, "建设单位："),
    text(
      "project-report-prepared-by",
      document.preparedBy,
      "编制单位："
    ),
    text("project-report-date", document.date)
  ]);
  const coverRegion = region("cover", [cover], true);
  return coverRegion ? [coverRegion] : [];
}

function tenderRegions(
  title: string,
  document: Extract<DocumentProfile, { profile: "tender" }>
): SemanticDocumentRegion[] {
  const cover = group("tender-cover", [
    text("tender-copy-mark", document.copyMark),
    text("tender-project-name", document.projectName),
    text("tender-project-number", document.projectNumber),
    text("tender-title", title),
    text("tender-volume", document.volume),
    text("tender-bidder", document.bidder, "投标人："),
    text(
      "tender-representative",
      document.representative,
      "法定代表人或授权代表："
    ),
    text("tender-date", document.date)
  ]);
  const coverRegion = region("cover", [cover], true);
  return coverRegion ? [coverRegion] : [];
}

function createRegions(
  metadata: MarkdownDocumentMetadata
): SemanticDocumentRegion[] {
  const document = metadata.document;
  if (!document) {
    return [];
  }
  switch (document.profile) {
    case "official":
      return officialRegions(metadata.title, document);
    case "briefing":
      return briefingRegions(metadata.title, document);
    case "project-report":
      return projectReportRegions(metadata.title, document);
    case "tender":
      return tenderRegions(metadata.title, document);
  }
}

function emittedTitle(metadata: MarkdownDocumentMetadata): string {
  const document = metadata.document;
  if (!document) {
    return "";
  }
  return document.profile === "project-report"
    ? document.documentType || metadata.title
    : metadata.title;
}

export function createSemanticDocumentModel(
  options: CreateSemanticDocumentModelOptions
): SemanticDocumentModel {
  const { metadata } = options;
  const firstHeading = normalizeTitle(options.firstBodyHeading);
  const metadataTitle = normalizeTitle(metadata.title);
  const structuralTitle = normalizeTitle(emittedTitle(metadata));
  const hasStructure = metadata.document !== undefined;
  const duplicatedMetadataTitle =
    Boolean(metadataTitle) && metadataTitle === firstHeading;
  const duplicatedStructuralTitle =
    Boolean(structuralTitle) && structuralTitle === firstHeading;
  return semanticDocumentModelSchema.parse({
    schemaVersion: 1,
    ...(metadata.document
      ? { profile: metadata.document.profile }
      : {}),
    titlePolicy: {
      metadataTitle:
        hasStructure || duplicatedMetadataTitle
          ? "suppress"
          : "emit",
      firstBodyHeading:
        hasStructure && duplicatedStructuralTitle
          ? "suppress"
          : "keep"
    },
    regions: createRegions(metadata)
  });
}
