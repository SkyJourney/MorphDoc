import {
  type PdfAdapterGeneration,
  type PdfArtifactAdapter,
} from "./adapters.js";
import { createPdfVisualDiffReport } from "./report.js";
import { createPdfDocumentSnapshot } from "./snapshot.js";
import type {
  CreatePdfSnapshotOptions,
  CreatePdfVisualDiffOptions,
  PdfDocumentSnapshot,
  PdfVisualDiffReport,
} from "./types.js";

export interface PreparedPdfAdapterRun {
  id: string;
  generate(): Promise<PdfAdapterGeneration>;
}

export interface PdfAdapterVisualDiffResult {
  baseline: PdfAdapterGeneration;
  baselineSnapshot: PdfDocumentSnapshot;
  candidates: Array<{
    generation: PdfAdapterGeneration;
    snapshot: PdfDocumentSnapshot;
    report: PdfVisualDiffReport;
  }>;
}

export interface RunPdfAdapterVisualDiffOptions {
  baseline: PreparedPdfAdapterRun;
  candidates: PreparedPdfAdapterRun[];
  snapshot?: Omit<CreatePdfSnapshotOptions, "source">;
  report?: CreatePdfVisualDiffOptions;
}

export function preparePdfAdapterRun<TInput>(
  adapter: PdfArtifactAdapter<TInput>,
  input: TInput,
): PreparedPdfAdapterRun {
  return {
    id: adapter.id,
    generate: () => adapter.generate(input),
  };
}

export async function runPdfAdapterVisualDiff(
  options: RunPdfAdapterVisualDiffOptions,
): Promise<PdfAdapterVisualDiffResult> {
  if (options.candidates.length === 0) {
    throw new Error("视觉差异编排至少需要一个候选适配器");
  }
  const baseline = await options.baseline.generate();
  const baselineSnapshot = await createPdfDocumentSnapshot(
    baseline.pdf,
    {
      ...options.snapshot,
      source: baseline.source,
    },
  );
  const candidates: PdfAdapterVisualDiffResult["candidates"] = [];
  for (const candidateRun of options.candidates) {
    const generation = await candidateRun.generate();
    const snapshot = await createPdfDocumentSnapshot(
      generation.pdf,
      {
        ...options.snapshot,
        source: generation.source,
      },
    );
    const report = await createPdfVisualDiffReport(
      baselineSnapshot,
      snapshot,
      options.report,
    );
    candidates.push({ generation, snapshot, report });
  }
  return {
    baseline,
    baselineSnapshot,
    candidates,
  };
}
