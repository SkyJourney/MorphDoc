const sampleModules = import.meta.glob<string>(
  "../../../samples/themes/*.md",
  {
    eager: true,
    query: "?raw",
    import: "default"
  }
);

export interface BuiltinThemeSample {
  themeId: string;
  fileName: string;
  markdown: string;
}

function getFileName(modulePath: string) {
  return modulePath.split("/").at(-1) ?? "";
}

export const builtinThemeSamples: BuiltinThemeSample[] = Object.entries(
  sampleModules
)
  .map(([modulePath, markdown]) => {
    const fileName = getFileName(modulePath);
    return {
      themeId: fileName.replace(/\.md$/i, ""),
      fileName,
      markdown
    };
  })
  .sort((first, second) =>
    first.themeId.localeCompare(second.themeId, "en")
  );

const builtinThemeSampleMap = new Map(
  builtinThemeSamples.map((sample) => [sample.themeId, sample])
);

export function getBuiltinThemeSample(themeId: string) {
  return builtinThemeSampleMap.get(themeId);
}
