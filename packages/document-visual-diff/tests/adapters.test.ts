import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createChromiumPdfAdapter,
  createWordDocxRoundTripAdapter,
  createWordPdfAdapter,
  createWpsDocxRoundTripAdapter,
  createWpsPdfAdapter,
  preparePdfAdapterRun,
  runPdfAdapterVisualDiff,
  type OfficeAutomationBackend,
} from "../src/index.js";
import { createMinimalPdf } from "./pdf-fixture.js";

describe("PDF 产物适配器", () => {
  it("Chromium 适配器复用调用方生成链并校验 PDF", async () => {
    const generate = vi.fn(async () => ({
      pdf: createMinimalPdf("Chromium"),
      pageCount: 1,
      diagnostics: ["ok"],
    }));
    const adapter = createChromiumPdfAdapter({
      label: "统一 Chromium",
      generate,
    });
    expect(await adapter.probe()).toMatchObject({
      available: true,
      adapterId: "chromium",
    });
    const result = await adapter.generate({ markdown: "# 标题" });
    expect(generate).toHaveBeenCalledWith({ markdown: "# 标题" });
    expect(result.source.kind).toBe("chromium");
    expect(result.pageCount).toBe(1);
    expect(result.diagnostics).toEqual(["ok"]);
  });

  it("拒绝生产者返回非 PDF 字节", async () => {
    const adapter = createChromiumPdfAdapter({
      generate: async () => new TextEncoder().encode("not a pdf"),
    });
    await expect(adapter.generate(undefined)).rejects.toThrow(
      "PDF 文件签名",
    );
  });
});

describe("Office PDF 适配器", () => {
  it("分别使用 Word 与 WPS ProgID 并清理临时输出", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "visual-diff-office-test-"),
    );
    const docxPath = join(directory, "fixture.docx");
    await writeFile(docxPath, "fixture");
    const calls: Array<{
      client: string;
      progId: string;
      outputPath: string;
    }> = [];
    const roundTripCalls: string[] = [];
    const backend: OfficeAutomationBackend = {
      probe: async () => true,
      exportPdf: async (options) => {
        const pdf = createMinimalPdf(options.client);
        await writeFile(options.outputPath, pdf);
        calls.push({
          client: options.client,
          progId: options.progId,
          outputPath: options.outputPath,
        });
        return { bytes: pdf.byteLength, pageCount: 1 };
      },
      roundTripDocx: async (options) => {
        const docx = Buffer.from("round-trip-docx");
        await writeFile(options.outputPath, docx);
        roundTripCalls.push(options.client);
        return {
          bytes: docx.byteLength,
          before: [
            { index: 1, widthPt: 100, heightPt: 50, type: 3 },
          ],
          saved: [
            { index: 1, widthPt: 90, heightPt: 45, type: 3 },
          ],
          resizedShapeIndex: 1,
          resizeScale: options.resizeScale,
        };
      },
    };
    try {
      const word = createWordPdfAdapter({ backend });
      const wps = createWpsPdfAdapter({ backend });
      expect((await word.probe()).available).toBe(true);
      expect((await wps.probe()).available).toBe(true);
      expect((await word.generate({ docxPath })).source.kind).toBe("word");
      expect((await wps.generate({ docxPath })).source.kind).toBe("wps");
      const wordRoundTrip = await createWordDocxRoundTripAdapter({
        backend,
      }).generate({ docxPath });
      const wpsRoundTrip = await createWpsDocxRoundTripAdapter({
        backend,
      }).generate({ docxPath });
      expect(wordRoundTrip.saved[0]?.widthPt).toBe(90);
      expect(wpsRoundTrip.saved[0]?.heightPt).toBe(45);
      expect(roundTripCalls).toEqual(["word", "wps"]);
      expect(calls.map(({ client, progId }) => ({ client, progId }))).toEqual([
        { client: "word", progId: "Word.Application" },
        { client: "wps", progId: "KWPS.Application" },
      ]);
      for (const call of calls) {
        await expect(
          import("node:fs/promises").then(({ stat }) =>
            stat(call.outputPath),
          ),
        ).rejects.toThrow();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("Office 偶发未生成 PDF 时清理残留并有界重试", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "visual-diff-office-retry-test-"),
    );
    const docxPath = join(directory, "fixture.docx");
    await writeFile(docxPath, "fixture");
    let attempts = 0;
    const backend: OfficeAutomationBackend = {
      probe: async () => true,
      exportPdf: async (options) => {
        attempts += 1;
        if (attempts === 1) {
          await writeFile(options.outputPath, "partial");
          throw new Error("Office 未生成有效 PDF");
        }
        const pdf = createMinimalPdf("retry");
        await writeFile(options.outputPath, pdf);
        return { bytes: pdf.byteLength, pageCount: 1 };
      },
    };
    try {
      const result = await createWordPdfAdapter({ backend }).generate({
        docxPath,
      });
      expect(result.pageCount).toBe(1);
      expect(attempts).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("PDF 适配器视觉编排", () => {
  it("基线只生成一次并按顺序比较全部候选", async () => {
    const order: string[] = [];
    const adapter = (label: string) =>
      createChromiumPdfAdapter({
        label,
        generate: async () => {
          order.push(label);
          return createMinimalPdf("same");
        },
      });
    const result = await runPdfAdapterVisualDiff({
      baseline: preparePdfAdapterRun(adapter("baseline"), undefined),
      candidates: [
        preparePdfAdapterRun(adapter("candidate-1"), undefined),
        preparePdfAdapterRun(adapter("candidate-2"), undefined),
      ],
      snapshot: { includeRaster: false },
    });
    expect(order).toEqual(["baseline", "candidate-1", "candidate-2"]);
    expect(result.candidates).toHaveLength(2);
    expect(
      result.candidates.map(({ report }) => report.status),
    ).toEqual(["failed", "failed"]);
    expect(
      result.candidates.flatMap(({ report }) =>
        report.issues.map((issue) => issue.code),
      ),
    ).toEqual(["RASTER_MISSING", "RASTER_MISSING"]);
  });
});
