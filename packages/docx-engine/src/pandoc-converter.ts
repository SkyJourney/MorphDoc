import {
  randomUUID
} from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  MAXIMUM_DOCX_OUTPUT_BYTES,
  type DocxExportErrorCode,
  type ExportConfig,
  type MarkdownDocumentMetadata,
  type PreparedDocxMedia,
  type SemanticDocumentModel,
  type ThemeManifest
} from "@morphdoc/core";
import type { DocxThemeTokenSet } from "@morphdoc/docx-theme-engine";
import {
  createDynamicReferenceCacheKey,
  createDynamicReferenceDocx,
  type DynamicReferenceDocxResult
} from "./reference-builder.js";
import { finalizeGeneratedDocxStructure } from "./document-structure-transform.js";
import {
  prepareDocxFonts,
  type DocxFontSource
} from "./font-embedding.js";
import { embedFontsInGeneratedDocx } from "./font-package-transform.js";
import type { DynamicReferenceDocxOptions } from "./reference-options.js";
import { preparePandocMedia } from "./pandoc-media.js";
import { createPandocStructurePlan } from "./pandoc-structure.js";
import {
  runPandocProcess,
  type PandocProcessRunner
} from "./pandoc-process.js";
import { readReferenceDocxPackage } from "./reference-package.js";
import type { PandocRuntime } from "./pandoc-runtime.js";
import {
  validateGeneratedDocx,
  type DynamicReferenceValidation
} from "./validator.js";

const DEFAULT_CONVERSION_TIMEOUT_MS = 60_000;
const MAXIMUM_PANDOC_STDOUT_BYTES = 1024 * 1024;
const MAXIMUM_PANDOC_STDERR_BYTES = 64 * 1024;
const DEFAULT_REFERENCE_CACHE_SIZE = 32;
const temporaryDirectoryPrefix = "morphdoc-docx-";
const mediaMapEnvironmentName = "MORPHDOC_DOCX_MEDIA_MAP";
const structurePlanEnvironmentName =
  "MORPHDOC_DOCX_STRUCTURE_PLAN";
const luaFilterUrl = new URL(
  "../assets/docx-media-filter.lua",
  import.meta.url
);

export interface PandocRuntimeProvider {
  getExecutablePath(): Promise<string>;
  getDefaultReferenceDocx(): Promise<Uint8Array>;
}

export interface PandocDocxConversionInput {
  markdown: string;
  fileName: string;
  language: string;
  exportConfig: ExportConfig;
  theme: ThemeManifest;
  themeTokens: DocxThemeTokenSet;
  fonts: DocxFontSource[];
  metadata: MarkdownDocumentMetadata;
  semanticDocument: SemanticDocumentModel;
  media: PreparedDocxMedia;
}

export interface PandocDocxConversionTimings {
  referenceMs: number;
  pandocMs: number;
  validationMs: number;
}

export interface PandocDocxConversionResult {
  docx: Uint8Array;
  templateFingerprint: string;
  templateCacheKey: string;
  validation: DynamicReferenceValidation;
  timings: PandocDocxConversionTimings;
}

export interface PandocDocxConverterOptions {
  runtime: PandocRuntimeProvider | PandocRuntime;
  luaFilterUrl?: URL;
  runner?: PandocProcessRunner;
  environment?: NodeJS.ProcessEnv;
  temporaryRoot?: string;
  timeoutMs?: number;
  maximumOutputBytes?: number;
  referenceCacheSize?: number;
}

export interface PandocDocxConversionDiagnostics {
  outcome: string;
  exitCode: number | null;
  stderr: string;
}

export class PandocDocxConversionError extends Error {
  constructor(
    readonly code: Extract<
      DocxExportErrorCode,
      | "DOCX_RUNTIME_NOT_FOUND"
      | "DOCX_RENDER_TIMEOUT"
      | "DOCX_GENERATION_FAILED"
      | "DOCX_OUTPUT_INVALID"
    >,
    message: string,
    options?: ErrorOptions & {
      diagnostics?: PandocDocxConversionDiagnostics;
    }
  ) {
    super(message, options);
    this.name = "PandocDocxConversionError";
    this.diagnostics = options?.diagnostics;
  }

  readonly diagnostics: PandocDocxConversionDiagnostics | undefined;
}

function processDiagnostics(
  result: Awaited<ReturnType<PandocProcessRunner>>
): PandocDocxConversionDiagnostics {
  return {
    outcome: result.outcome,
    exitCode: result.exitCode,
    stderr: result.stderr.trim().slice(-16 * 1024)
  };
}

function ensureOutputLimit(value: number | undefined) {
  const limit = value ?? MAXIMUM_DOCX_OUTPUT_BYTES;
  if (
    !Number.isInteger(limit) ||
    limit < 1024 ||
    limit > MAXIMUM_DOCX_OUTPUT_BYTES
  ) {
    throw new Error("DOCX 输出大小上限无效");
  }
  return limit;
}

function ensureTimeout(value: number | undefined) {
  const timeout = value ?? DEFAULT_CONVERSION_TIMEOUT_MS;
  if (
    !Number.isInteger(timeout) ||
    timeout < 1_000 ||
    timeout > 10 * 60_000
  ) {
    throw new Error("DOCX 转换超时配置无效");
  }
  return timeout;
}

function referenceOptions(
  input: PandocDocxConversionInput
): DynamicReferenceDocxOptions {
  return {
    exportConfig: input.exportConfig,
    theme: input.theme,
    themeTokens: input.themeTokens,
    semanticDocument: input.semanticDocument,
    fileName: input.fileName,
    metadata: {
      title: input.metadata.title,
      author: input.metadata.author
    }
  };
}

function pandocArguments(paths: {
  markdown: string;
  output: string;
  reference: string;
  luaFilter: string;
  resourceDirectory: string;
  dataDirectory: string;
  language: string;
}) {
  return [
    paths.markdown,
    "--from",
    "commonmark_x-yaml_metadata_block+pipe_tables+footnotes+task_lists+tex_math_dollars+raw_html",
    "--to",
    "docx",
    "--standalone",
    "--reference-doc",
    paths.reference,
    "--lua-filter",
    paths.luaFilter,
    "--resource-path",
    paths.resourceDirectory,
    "--data-dir",
    paths.dataDirectory,
    "--metadata",
    `lang=${paths.language}`,
    "--output",
    paths.output
  ];
}

export class PandocDocxConverter {
  private luaFilterContent: Promise<Uint8Array> | undefined;
  private readonly runner: PandocProcessRunner;
  private readonly timeoutMs: number;
  private readonly maximumOutputBytes: number;
  private readonly referenceCacheSize: number;
  private readonly referenceCache = new Map<
    string,
    DynamicReferenceDocxResult
  >();

  constructor(private readonly options: PandocDocxConverterOptions) {
    this.runner = options.runner ?? runPandocProcess;
    this.timeoutMs = ensureTimeout(options.timeoutMs);
    this.maximumOutputBytes = ensureOutputLimit(
      options.maximumOutputBytes
    );
    this.referenceCacheSize =
      options.referenceCacheSize ?? DEFAULT_REFERENCE_CACHE_SIZE;
    if (
      !Number.isInteger(this.referenceCacheSize) ||
      this.referenceCacheSize < 1 ||
      this.referenceCacheSize > 128
    ) {
      throw new Error("DOCX 动态模板缓存容量无效");
    }
  }

  private loadLuaFilter() {
    this.luaFilterContent ??= readFile(
      this.options.luaFilterUrl ?? luaFilterUrl
    );
    return this.luaFilterContent;
  }

  async convert(
    input: PandocDocxConversionInput,
    signal?: AbortSignal
  ): Promise<PandocDocxConversionResult> {
    let preparedMedia;
    let structurePlan;
    let preparedFonts;
    try {
      preparedMedia = preparePandocMedia(input.media);
      preparedFonts = await prepareDocxFonts(input.fonts);
      structurePlan = createPandocStructurePlan(
        input.semanticDocument,
        input.themeTokens,
        { markerSeed: randomUUID() }
      );
    } catch (error) {
      throw new PandocDocxConversionError(
        "DOCX_GENERATION_FAILED",
        "DOCX 媒体或语义结构映射无效",
        { cause: error }
      );
    }

    const temporaryDirectory = await mkdtemp(
      path.join(
        this.options.temporaryRoot ?? os.tmpdir(),
        temporaryDirectoryPrefix
      )
    );
    try {
      const referenceStarted = performance.now();
      const [executablePath, baseline, filterContent] =
        await Promise.all([
          this.options.runtime.getExecutablePath(),
          this.options.runtime.getDefaultReferenceDocx(),
          this.loadLuaFilter()
        ]);
      const reference = this.getOrCreateReference(baseline, input);
      const referenceMs = performance.now() - referenceStarted;

      const paths = {
        markdown: path.join(temporaryDirectory, "document.md"),
        output: path.join(temporaryDirectory, "document.docx"),
        reference: path.join(temporaryDirectory, "reference.docx"),
        luaFilter: path.join(
          temporaryDirectory,
          "docx-media-filter.lua"
        ),
        mediaMap: path.join(temporaryDirectory, "media-map.json"),
        structurePlan: path.join(
          temporaryDirectory,
          "structure-plan.json"
        ),
        mediaDirectory: path.join(temporaryDirectory, "media"),
        dataDirectory: path.join(temporaryDirectory, "pandoc-data")
      };
      await Promise.all([
        mkdir(paths.mediaDirectory),
        mkdir(paths.dataDirectory)
      ]);
      await Promise.all([
        writeFile(paths.markdown, input.markdown, "utf8"),
        writeFile(paths.reference, reference.content),
        writeFile(paths.luaFilter, filterContent),
        writeFile(
          paths.mediaMap,
          JSON.stringify(preparedMedia.map),
          "utf8"
        ),
        writeFile(
          paths.structurePlan,
          JSON.stringify(structurePlan),
          "utf8"
        ),
        ...preparedMedia.files.map((file) =>
          writeFile(
            path.join(temporaryDirectory, file.relativePath),
            file.content
          )
        )
      ]);

      const pandocStarted = performance.now();
      const processResult = await this.runner(
        executablePath,
        pandocArguments({
          markdown: paths.markdown,
          output: paths.output,
          reference: paths.reference,
          luaFilter: paths.luaFilter,
          resourceDirectory: temporaryDirectory,
          dataDirectory: paths.dataDirectory,
          language: input.language
        }),
        {
          cwd: temporaryDirectory,
          env: {
            ...(this.options.environment ?? process.env),
            [mediaMapEnvironmentName]: paths.mediaMap,
            [structurePlanEnvironmentName]: paths.structurePlan
          },
          timeoutMs: this.timeoutMs,
          maxStdoutBytes: MAXIMUM_PANDOC_STDOUT_BYTES,
          maxStderrBytes: MAXIMUM_PANDOC_STDERR_BYTES,
          ...(signal ? { signal } : {})
        }
      );
      const pandocMs = performance.now() - pandocStarted;
      if (
        processResult.outcome === "timeout" ||
        processResult.outcome === "aborted"
      ) {
        throw new PandocDocxConversionError(
          "DOCX_RENDER_TIMEOUT",
          "DOCX 转换超时或已取消"
        );
      }
      if (
        processResult.outcome !== "completed" ||
        processResult.exitCode !== 0
      ) {
        throw new PandocDocxConversionError(
          processResult.outcome === "not-found"
            ? "DOCX_RUNTIME_NOT_FOUND"
            : "DOCX_GENERATION_FAILED",
          "Pandoc 未能生成 DOCX",
          { diagnostics: processDiagnostics(processResult) }
        );
      }

      const validationStarted = performance.now();
      const outputStat = await stat(paths.output);
      if (
        !outputStat.isFile() ||
        outputStat.size < 1 ||
        outputStat.size > this.maximumOutputBytes
      ) {
        throw new PandocDocxConversionError(
          "DOCX_OUTPUT_INVALID",
          "DOCX 输出大小无效"
        );
      }
      let docx: Uint8Array;
      let validation: DynamicReferenceValidation;
      try {
        const pandocDocx = await readFile(paths.output);
        const finalized = finalizeGeneratedDocxStructure(
          pandocDocx,
          structurePlan,
          input.themeTokens,
          preparedMedia.layout,
          preparedMedia.documentLayout
        );
        docx = embedFontsInGeneratedDocx(
          finalized.content,
          preparedFonts
        ).content;
        if (docx.byteLength > this.maximumOutputBytes) {
          throw new Error("DOCX 结构收口后的输出大小无效");
        }
        validation = validateGeneratedDocx(docx);
      } catch (error) {
        throw new PandocDocxConversionError(
          "DOCX_OUTPUT_INVALID",
          "DOCX 输出结构无效",
          { cause: error }
        );
      }
      const validationMs = performance.now() - validationStarted;
      return {
        docx,
        templateFingerprint: reference.templateFingerprint,
        templateCacheKey: reference.cacheKey,
        validation,
        timings: {
          referenceMs,
          pandocMs,
          validationMs
        }
      };
    } catch (error) {
      if (error instanceof PandocDocxConversionError) {
        throw error;
      }
      throw new PandocDocxConversionError(
        "DOCX_GENERATION_FAILED",
        "DOCX 转换失败",
        { cause: error }
      );
    } finally {
      await rm(temporaryDirectory, {
        recursive: true,
        force: true
      });
    }
  }

  clearReferenceCache() {
    this.referenceCache.clear();
  }

  private getOrCreateReference(
    baseline: Uint8Array,
    input: PandocDocxConversionInput
  ) {
    const options = referenceOptions(input);
    const baselineFingerprint =
      readReferenceDocxPackage(baseline).fingerprint;
    const cacheKey = createDynamicReferenceCacheKey(
      baselineFingerprint,
      options
    );
    const cached = this.referenceCache.get(cacheKey);
    if (cached) {
      this.referenceCache.delete(cacheKey);
      this.referenceCache.set(cacheKey, cached);
      return cached;
    }
    const reference = createDynamicReferenceDocx(
      baseline,
      options
    );
    this.referenceCache.set(cacheKey, reference);
    while (this.referenceCache.size > this.referenceCacheSize) {
      const oldest = this.referenceCache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.referenceCache.delete(oldest);
    }
    return reference;
  }
}
