import { classifyDocumentLink } from "@morphdoc/core";

export type WebDocumentLinkAction =
  | {
      type: "anchor";
      href: string;
    }
  | {
      type: "open";
      href: string;
    }
  | {
      type: "ignore";
    };

export function resolveWebDocumentLinkAction(
  href: string
): WebDocumentLinkAction {
  const link = classifyDocumentLink(href);
  if (link.kind === "anchor") {
    return {
      type: "anchor",
      href: link.normalizedHref
    };
  }

  if (
    link.kind === "network" ||
    (link.kind === "protocol" &&
      (link.scheme === "mailto" || link.scheme === "tel"))
  ) {
    return {
      type: "open",
      href: link.normalizedHref
    };
  }

  return { type: "ignore" };
}
