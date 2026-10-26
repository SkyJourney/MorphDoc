export type PagedRenderTarget = "preview" | "pdf";

export function resolvePagedRenderTarget(
  search: string
): PagedRenderTarget {
  const target = new URLSearchParams(search).get("target");
  return target === "pdf" ? "pdf" : "preview";
}
