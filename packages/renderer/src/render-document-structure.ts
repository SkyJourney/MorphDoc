import type {
  SemanticDocumentModel,
  SemanticDocumentNode,
  SemanticDocumentRole
} from "@morphdoc/core";

export interface RenderedDocumentStructure {
  profile: NonNullable<SemanticDocumentModel["profile"]>;
  prefixHtml: string;
  suffixHtml: string;
}

interface HtmlRole {
  tagName: string;
  className: string;
}

const htmlRoles: Readonly<Record<SemanticDocumentRole, HtmlRole>> = {
  "official-masthead": {
    tagName: "header",
    className: "doc-masthead doc-masthead-official"
  },
  "official-classification": {
    tagName: "div",
    className: "doc-classification"
  },
  "official-secrecy": {
    tagName: "span",
    className: "doc-secrecy"
  },
  "official-urgency": {
    tagName: "span",
    className: "doc-urgency"
  },
  "official-issuer": {
    tagName: "p",
    className: "doc-issuer"
  },
  "official-issue-row": {
    tagName: "div",
    className: "doc-issue-row"
  },
  "official-number": {
    tagName: "span",
    className: "doc-number"
  },
  "official-signatory": {
    tagName: "span",
    className: "doc-signatory"
  },
  "official-title": {
    tagName: "h1",
    className: "doc-title"
  },
  "official-signature": {
    tagName: "section",
    className: "doc-signature"
  },
  "official-signature-issuer": {
    tagName: "p",
    className: "doc-signature-issuer"
  },
  "official-signature-date": {
    tagName: "time",
    className: "doc-signature-date"
  },
  "official-edition": {
    tagName: "footer",
    className: "doc-edition"
  },
  "official-copy-to": {
    tagName: "p",
    className: "doc-copy-to"
  },
  "official-printing-row": {
    tagName: "div",
    className: "doc-printing-row"
  },
  "official-printing-office": {
    tagName: "span",
    className: "doc-printing-office"
  },
  "official-printing-date": {
    tagName: "time",
    className: "doc-printing-date"
  },
  "briefing-masthead": {
    tagName: "header",
    className: "doc-masthead doc-masthead-briefing"
  },
  "briefing-masthead-text": {
    tagName: "p",
    className: "doc-briefing-masthead"
  },
  "briefing-meta": {
    tagName: "div",
    className: "doc-briefing-meta"
  },
  "briefing-issue": {
    tagName: "span",
    className: "doc-briefing-issue"
  },
  "briefing-publisher": {
    tagName: "span",
    className: "doc-briefing-publisher"
  },
  "briefing-signatory": {
    tagName: "span",
    className: "doc-briefing-signatory"
  },
  "briefing-date": {
    tagName: "time",
    className: "doc-briefing-date"
  },
  "briefing-title": {
    tagName: "h1",
    className: "doc-title"
  },
  "briefing-contact": {
    tagName: "footer",
    className: "doc-briefing-contact"
  },
  "project-report-cover": {
    tagName: "header",
    className: "doc-cover doc-cover-project-report"
  },
  "project-report-project-name": {
    tagName: "p",
    className: "doc-cover-project-name"
  },
  "project-report-title": {
    tagName: "h1",
    className: "doc-cover-title"
  },
  "project-report-version": {
    tagName: "p",
    className: "doc-cover-version"
  },
  "project-report-owner": {
    tagName: "p",
    className: "doc-cover-owner"
  },
  "project-report-prepared-by": {
    tagName: "p",
    className: "doc-cover-prepared-by"
  },
  "project-report-date": {
    tagName: "time",
    className: "doc-cover-date"
  },
  "tender-cover": {
    tagName: "header",
    className: "doc-cover doc-cover-tender"
  },
  "tender-copy-mark": {
    tagName: "p",
    className: "doc-cover-copy-mark"
  },
  "tender-project-name": {
    tagName: "p",
    className: "doc-cover-project-name"
  },
  "tender-project-number": {
    tagName: "p",
    className: "doc-cover-project-number"
  },
  "tender-title": {
    tagName: "h1",
    className: "doc-cover-title"
  },
  "tender-volume": {
    tagName: "p",
    className: "doc-cover-volume"
  },
  "tender-bidder": {
    tagName: "p",
    className: "doc-cover-bidder"
  },
  "tender-representative": {
    tagName: "p",
    className: "doc-cover-representative"
  },
  "tender-date": {
    tagName: "time",
    className: "doc-cover-date"
  }
};

function renderNode(
  node: SemanticDocumentNode,
  options: {
    regionKind?: "cover";
    breakAfter?: "next-page";
  } = {}
): string {
  const role = htmlRoles[node.role];
  const content =
    node.kind === "group"
      ? node.children.map((child) => renderNode(child)).join("")
      : `${node.label ? `<span>${escapeHtml(node.label)}</span>` : ""}${escapeHtml(node.text)}`;
  const regionAttribute = options.regionKind
    ? ` data-semantic-region="${options.regionKind}"`
    : "";
  const breakAttribute = options.breakAfter
    ? ` data-semantic-break-after="${options.breakAfter}"`
    : "";
  return `<${role.tagName} class="${role.className}"${regionAttribute}${breakAttribute}>${content}</${role.tagName}>`;
}

export function renderDocumentStructure(
  model: SemanticDocumentModel
): RenderedDocumentStructure | undefined {
  if (!model.profile) {
    return undefined;
  }
  const prefixHtml = model.regions
    .filter(
      (region) =>
        region.kind === "cover" || region.kind === "prefix"
    )
    .flatMap((region) =>
      region.nodes.map((node, index) =>
        renderNode(node, {
          ...(region.kind === "cover"
            ? { regionKind: "cover" as const }
            : {}),
          ...(index === region.nodes.length - 1 &&
          region.section?.breakAfter
            ? { breakAfter: region.section.breakAfter }
            : {})
        })
      )
    )
    .join("");
  const suffixHtml = model.regions
    .filter((region) => region.kind === "suffix")
    .flatMap((region) => region.nodes)
    .map((node) => renderNode(node))
    .join("");
  return {
    profile: model.profile,
    prefixHtml,
    suffixHtml
  };
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[character] ?? character
  );
}
