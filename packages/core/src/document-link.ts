export type DocumentLinkKind =
  | "anchor"
  | "network"
  | "protocol"
  | "local"
  | "unsafe"
  | "invalid";

export interface ClassifiedDocumentLink {
  kind: DocumentLinkKind;
  href: string;
  normalizedHref: string;
  scheme?: string;
}

const schemePattern = /^([a-z][a-z\d+.-]*):/iu;
const windowsAbsolutePathPattern = /^[a-z]:[\\/]/iu;
const windowsUncPathPattern = /^\\\\[^\\]/u;
const unsafeSchemePattern = /^(?:data|javascript|vbscript)$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;
const pdfLocalLinkOrigin = "https://morphdoc.local.invalid";
const pdfLocalLinkPath = "/document-link";

function result(
  kind: DocumentLinkKind,
  href: string,
  normalizedHref = href,
  scheme?: string
): ClassifiedDocumentLink {
  return {
    kind,
    href,
    normalizedHref,
    ...(scheme ? { scheme } : {})
  };
}

export function classifyDocumentLink(
  rawHref: string
): ClassifiedDocumentLink {
  const href = rawHref.trim();
  if (!href || controlCharacterPattern.test(href)) {
    return result("invalid", href);
  }

  if (href.startsWith("#")) {
    return result("anchor", href);
  }

  if (
    windowsAbsolutePathPattern.test(href) ||
    windowsUncPathPattern.test(href)
  ) {
    return result("local", href);
  }

  if (href.startsWith("//")) {
    return result("network", href, `https:${href}`, "https");
  }

  const schemeMatch = schemePattern.exec(href);
  if (!schemeMatch) {
    return result("local", href);
  }

  const scheme = schemeMatch[1]?.toLowerCase() ?? "";
  if (unsafeSchemePattern.test(scheme)) {
    return result("unsafe", href, href, scheme);
  }

  if (scheme === "http" || scheme === "https") {
    try {
      const url = new URL(href);
      if (!url.hostname) {
        return result("invalid", href, href, scheme);
      }
      return result("network", href, href, scheme);
    } catch {
      return result("invalid", href, href, scheme);
    }
  }

  if (scheme === "file") {
    return result("local", href, href, scheme);
  }

  return result("protocol", href, href, scheme);
}

export function isSafeDocumentLink(rawHref: string) {
  const { kind } = classifyDocumentLink(rawHref);
  return kind !== "unsafe" && kind !== "invalid";
}

export function encodeLocalDocumentLinkForPdf(rawHref: string) {
  const link = classifyDocumentLink(rawHref);
  if (link.kind !== "local") {
    return undefined;
  }
  const encoded = new URL(pdfLocalLinkPath, pdfLocalLinkOrigin);
  encoded.searchParams.set("href", link.href);
  return encoded.href;
}

export function decodeLocalDocumentLinkFromPdf(rawHref: string) {
  let encoded: URL;
  try {
    encoded = new URL(rawHref);
  } catch {
    return undefined;
  }
  if (
    encoded.origin !== pdfLocalLinkOrigin ||
    encoded.pathname !== pdfLocalLinkPath
  ) {
    return undefined;
  }
  const href = encoded.searchParams.get("href");
  if (!href || classifyDocumentLink(href).kind !== "local") {
    return undefined;
  }
  return href;
}
