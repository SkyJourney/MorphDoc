import type {
  FontPackDiagnostic,
  FontPackFaceRequest,
  FontPackFaceResolution,
  InstalledFontPack,
  ResolveFontPackFacesOptions
} from "./types.js";

function normalizeFontFamily(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

function orderedPacks(
  packs: readonly InstalledFontPack[],
  preferredPackIds: readonly string[]
) {
  const preference = new Map(
    preferredPackIds.map((id, index) => [id, index])
  );
  return [...packs].sort((left, right) => {
    const leftRank = preference.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = preference.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftRank !== rightRank
      ? leftRank - rightRank
      : left.id.localeCompare(right.id, "en");
  });
}

export function resolveFontPackFaces(
  requests: readonly FontPackFaceRequest[],
  packs: readonly InstalledFontPack[],
  options: ResolveFontPackFacesOptions = {}
): FontPackFaceResolution {
  const resolved: FontPackFaceResolution["resolved"] = [];
  const unmatched: FontPackFaceRequest[] = [];
  const diagnostics: FontPackDiagnostic[] = [];
  const candidates = orderedPacks(packs, options.preferredPackIds ?? []);
  for (const request of requests) {
    const requestNames = new Set(
      [request.family, ...(request.aliases ?? [])].map(normalizeFontFamily)
    );
    let match: FontPackFaceResolution["resolved"][number] | undefined;
    for (const pack of candidates) {
      const face = pack.faces.find(
        (candidate) =>
          candidate.weight === request.weight &&
          candidate.style === request.style &&
          candidate.targets.some((target) =>
            requestNames.has(normalizeFontFamily(target))
          )
      );
      if (face) {
        match = {
          request,
          pack,
          face,
          matchedFamily:
            face.targets.find((target) =>
              requestNames.has(normalizeFontFamily(target))
            ) ?? request.family
        };
        break;
      }
    }
    if (match) {
      resolved.push(match);
      continue;
    }
    unmatched.push(request);
    if (options.reportMissing) {
      diagnostics.push({
        code: "FONT_FACE_NOT_PROVIDED",
        severity: "info",
        message: `没有字体包提供 ${request.family} ${request.weight} ${request.style}`
      });
    }
  }
  return { resolved, unmatched, diagnostics };
}
