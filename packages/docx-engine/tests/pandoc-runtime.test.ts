import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { zipSync } from "fflate";
import {
  DOCX_PANDOC_VERSION,
  type DocxRuntimeStatus
} from "@morphdoc/core";
import {
  PandocRuntime,
  probePandocRuntime,
  type PandocProcessResult,
  type PandocProcessRunner
} from "../src/index.js";

const encoder = new TextEncoder();

function processResult(
  overrides: Partial<PandocProcessResult> = {}
): PandocProcessResult {
  return {
    outcome: "completed",
    exitCode: 0,
    stdout: encoder.encode(`pandoc ${DOCX_PANDOC_VERSION}\n`),
    stderr: "",
    ...overrides
  };
}

function runnerWith(result: PandocProcessResult) {
  return vi.fn<PandocProcessRunner>().mockResolvedValue(result);
}

function createReferenceDocx() {
  const xml = (value: string) => encoder.encode(value);
  return zipSync({
    "[Content_Types].xml": xml("<Types/>"),
    "_rels/.rels": xml("<Relationships/>"),
    "word/document.xml": xml("<document/>"),
    "word/fontTable.xml": xml("<fonts/>"),
    "word/numbering.xml": xml("<numbering/>"),
    "word/settings.xml": xml("<settings/>"),
    "word/styles.xml": xml("<styles/>"),
    "word/_rels/document.xml.rels": xml("<Relationships/>"),
    "word/theme/theme1.xml": xml("<theme/>")
  });
}

describe("Pandoc 运行时探测", () => {
  it.each([
    ["not-found", "not-found"],
    ["not-executable", "not-executable"],
    ["timeout", "probe-timeout"],
    ["aborted", "probe-timeout"],
    ["output-limit", "not-executable"]
  ] satisfies Array<[PandocProcessResult["outcome"], DocxRuntimeStatus]>)(
    "将 %s 映射为 %s",
    async (outcome, expectedStatus) => {
      const resolution = await probePandocRuntime({
        configuredPath: "C:\\trusted\\pandoc.exe",
        runner: runnerWith(
          processResult({ outcome, exitCode: null, stdout: new Uint8Array() })
        )
      });
      expect(resolution.capability.status).toBe(expectedStatus);
    }
  );

  it("拒绝不同补丁版本", async () => {
    const resolution = await probePandocRuntime({
      configuredPath: "C:\\trusted\\pandoc.exe",
      runner: runnerWith(
        processResult({
          stdout: encoder.encode("pandoc 3.9.0.1\n")
        })
      )
    });
    expect(resolution.capability).toMatchObject({
      status: "version-mismatch",
      detectedVersion: "3.9.0.1"
    });
  });

  it("显式路径失败时不静默回退 PATH", async () => {
    const runner = runnerWith(
      processResult({
        outcome: "not-found",
        exitCode: null,
        stdout: new Uint8Array()
      })
    );
    const resolution = await probePandocRuntime({
      configuredPath: "C:\\missing\\pandoc.exe",
      runner
    });
    expect(resolution.capability.status).toBe("not-found");
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("内置路径不存在时回退到 PATH", async () => {
    const runner = vi
      .fn<PandocProcessRunner>()
      .mockResolvedValueOnce(
        processResult({
          outcome: "not-found",
          exitCode: null,
          stdout: new Uint8Array()
        })
      )
      .mockResolvedValueOnce(processResult());
    const resolution = await probePandocRuntime({
      platform: "win32",
      architecture: "x64",
      desktopResourcesPath: "C:\\app\\resources",
      environment: {},
      runner
    });
    expect(resolution).toMatchObject({
      capability: { status: "available" },
      executablePath: "pandoc.exe"
    });
    expect(runner.mock.calls[0]?.[0]).toContain(
      path.join("pandoc", DOCX_PANDOC_VERSION, "windows-x86_64", "pandoc.exe")
    );
  });

  it("macOS 内置路径不存在时回退到 PATH", async () => {
    const runner = vi
      .fn<PandocProcessRunner>()
      .mockResolvedValueOnce(
        processResult({
          outcome: "not-found",
          exitCode: null,
          stdout: new Uint8Array()
        })
      )
      .mockResolvedValueOnce(processResult());
    const resolution = await probePandocRuntime({
      platform: "darwin",
      architecture: "arm64",
      desktopResourcesPath: "/Applications/MorphDoc.app/Contents/Resources",
      environment: {},
      runner
    });
    expect(resolution).toMatchObject({
      capability: { status: "available" },
      executablePath: "pandoc"
    });
    expect(runner.mock.calls[0]?.[0]).toContain(
      path.join("pandoc", DOCX_PANDOC_VERSION, "darwin-arm64", "pandoc")
    );
  });

  it("缓存探测和默认 reference.docx，并向调用方返回副本", async () => {
    const reference = createReferenceDocx();
    const runner = vi
      .fn<PandocProcessRunner>()
      .mockResolvedValueOnce(processResult())
      .mockResolvedValueOnce(
        processResult({ stdout: reference })
      );
    const runtime = new PandocRuntime({
      configuredPath: "C:\\trusted\\pandoc.exe",
      runner
    });
    const first = await runtime.getDefaultReferenceDocx();
    first[0] = 0;
    const second = await runtime.getDefaultReferenceDocx();

    expect(second[0]).not.toBe(0);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[1]?.[1]).toEqual([
      "--print-default-data-file",
      "reference.docx"
    ]);
  });
});
