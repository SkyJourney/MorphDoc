import {
  copyFile,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultExportConfig,
  type PreparedDocxMedia,
  type ThemeManifest
} from "@morphdoc/core";
import type { DocxThemeTokenSet } from "@morphdoc/docx-theme-engine";
import {
  PandocDocxConversionError,
  PandocDocxConverter,
  type PandocProcessRunner,
  type PandocRuntimeProvider
} from "../src/index.js";
import { createTestBaselineReference } from "./reference-test-fixture.js";

function theme(): ThemeManifest {
  return {
    manifestVersion: 1,
    id: "test-theme",
    name: "测试主题",
    version: "1.0.0",
    description: "测试",
    author: "测试",
    license: "内部许可",
    entry: "theme.css",
    domPreset: "generic",
    defaultFontSize: "16px",
    supportedFeatures: [],
    category: "general",
    compatibleProfiles: [],
    docxStyle: { preset: "technical" },
    bundled: true
  };
}

const emptyMedia: PreparedDocxMedia = {
  resources: [],
  echartsErrors: [],
  mermaidErrors: [],
  warnings: [],
  totalBytes: 0
};

const themeTokens: DocxThemeTokenSet = {
  schemaVersion: 1,
  themeId: "test-theme",
  themeFingerprint: "c".repeat(64),
  mode: "auto-with-overrides",
  basePreset: "technical",
  slots: [],
  diagnostics: []
};

function input() {
  return {
    markdown: "# 测试",
    fileName: "测试.md",
    language: "zh-CN",
    exportConfig: defaultExportConfig,
    theme: theme(),
    themeTokens,
    fonts: [],
    metadata: {
      title: "测试",
      author: "测试人",
      subject: "",
      keywords: [],
      language: "zh-CN"
    },
    semanticDocument: {
      schemaVersion: 1,
      titlePolicy: {
        metadataTitle: "suppress",
        firstBodyHeading: "keep"
      },
      regions: []
    },
    media: emptyMedia
  };
}

function argumentAfter(arguments_: readonly string[], name: string) {
  const index = arguments_.indexOf(name);
  if (index < 0 || !arguments_[index + 1]) {
    throw new Error(`缺少参数 ${name}`);
  }
  return arguments_[index + 1]!;
}

describe("Pandoc DOCX 转换器", () => {
  let temporaryRoot: string;
  const baseline = createTestBaselineReference();
  const runtime: PandocRuntimeProvider = {
    async getExecutablePath() {
      return "pandoc";
    },
    async getDefaultReferenceDocx() {
      return baseline;
    }
  };

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "docx-converter-test-")
    );
  });

  afterEach(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it("使用固定参数转换、校验并清理请求级临时目录", async () => {
    let requestDirectory = "";
    const runner = vi.fn<PandocProcessRunner>(
      async (_executable, arguments_, options) => {
        requestDirectory = options.cwd!;
        expect(arguments_).toContain("--lua-filter");
        expect(arguments_).toContain("--data-dir");
        expect(arguments_).toContain("--resource-path");
        expect(argumentAfter(arguments_, "--from")).toBe(
          "commonmark_x-yaml_metadata_block+pipe_tables+footnotes+task_lists+tex_math_dollars+raw_html"
        );
        expect(
          options.env?.MORPHDOC_DOCX_MEDIA_MAP
        ).toContain("media-map.json");
        expect(
          options.env?.MORPHDOC_DOCX_STRUCTURE_PLAN
        ).toContain("structure-plan.json");
        const structurePlan = JSON.parse(
          await import("node:fs/promises").then(({ readFile }) =>
            readFile(
              options.env!.MORPHDOC_DOCX_STRUCTURE_PLAN!,
              "utf8"
            )
          )
        );
        expect(structurePlan.titlePolicy.metadataTitle).toBe(
          "suppress"
        );
        await copyFile(
          argumentAfter(arguments_, "--reference-doc"),
          argumentAfter(arguments_, "--output")
        );
        return {
          outcome: "completed",
          exitCode: 0,
          stdout: new Uint8Array(),
          stderr: ""
        };
      }
    );
    const converter = new PandocDocxConverter({
      runtime,
      runner,
      temporaryRoot
    });
    const result = await converter.convert(input());

    expect(result.docx.byteLength).toBeGreaterThan(0);
    expect(result.validation.partCount).toBeGreaterThan(8);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(existsSync(requestDirectory)).toBe(false);
  });

  it("超时和无效输出均返回稳定错误并清理目录", async () => {
    let timeoutDirectory = "";
    const timeoutRunner = vi.fn<PandocProcessRunner>(
      async (_executable, _arguments, options) => {
        timeoutDirectory = options.cwd!;
        return {
          outcome: "timeout",
          exitCode: null,
          stdout: new Uint8Array(),
          stderr: ""
        };
      }
    );
    await expect(
      new PandocDocxConverter({
        runtime,
        runner: timeoutRunner,
        temporaryRoot
      }).convert(input())
    ).rejects.toMatchObject({
      code: "DOCX_RENDER_TIMEOUT"
    } satisfies Partial<PandocDocxConversionError>);
    expect(existsSync(timeoutDirectory)).toBe(false);

    const invalidRunner = vi.fn<PandocProcessRunner>(
      async (_executable, arguments_) => {
        await writeFile(
          argumentAfter(arguments_, "--output"),
          "not a docx"
        );
        return {
          outcome: "completed",
          exitCode: 0,
          stdout: new Uint8Array(),
          stderr: ""
        };
      }
    );
    await expect(
      new PandocDocxConverter({
        runtime,
        runner: invalidRunner,
        temporaryRoot
      }).convert(input())
    ).rejects.toMatchObject({
      code: "DOCX_OUTPUT_INVALID"
    } satisfies Partial<PandocDocxConversionError>);
  });

  it("进程失败时保留内部诊断但保持稳定的对外错误", async () => {
    const failedRunner = vi.fn<PandocProcessRunner>(async () => ({
      outcome: "completed",
      exitCode: 64,
      stdout: new Uint8Array(),
      stderr: "pandoc: 媒体映射失败"
    }));

    await expect(
      new PandocDocxConverter({
        runtime,
        runner: failedRunner,
        temporaryRoot
      }).convert(input())
    ).rejects.toMatchObject({
      code: "DOCX_GENERATION_FAILED",
      message: "Pandoc 未能生成 DOCX",
      diagnostics: {
        outcome: "completed",
        exitCode: 64,
        stderr: "pandoc: 媒体映射失败"
      }
    } satisfies Partial<PandocDocxConversionError>);
  });
});
