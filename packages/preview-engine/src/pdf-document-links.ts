import { encodeLocalDocumentLinkForPdf } from "@morphdoc/core";

export function preparePdfDocumentLinks(root: ParentNode) {
  let rewritten = 0;
  for (const link of root.querySelectorAll<HTMLAnchorElement>(
    "a[href]"
  )) {
    const href = link.getAttribute("href");
    if (!href) {
      continue;
    }
    const encoded = encodeLocalDocumentLinkForPdf(href);
    if (!encoded) {
      continue;
    }
    link.setAttribute("href", encoded);
    rewritten += 1;
  }
  return rewritten;
}
