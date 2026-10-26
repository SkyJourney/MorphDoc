export interface MermaidSvgResult {
  svg: string;
  bindFunctions?: (element: Element) => void;
}

export type MermaidRenderOutcome =
  | ({ success: true } & MermaidSvgResult)
  | {
      success: false;
      error: unknown;
    };

export async function renderMermaidDefinitions(
  definitions: string[],
  renderDefinition: (
    definition: string,
    index: number
  ) => Promise<MermaidSvgResult>
): Promise<MermaidRenderOutcome[]> {
  const outcomes: MermaidRenderOutcome[] = [];

  for (const [index, definition] of definitions.entries()) {
    try {
      outcomes.push({
        success: true,
        ...(await renderDefinition(definition, index))
      });
    } catch (error: unknown) {
      outcomes.push({
        success: false,
        error
      });
    }
  }

  return outcomes;
}
