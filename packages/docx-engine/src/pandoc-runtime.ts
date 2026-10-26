import path from "node:path";
import {
  DOCX_PANDOC_VERSION,
  type DocxCapability,
  type DocxRuntimeStatus
} from "@morphdoc/core";
import {
  MAXIMUM_REFERENCE_DOCX_BYTES,
  readReferenceDocxPackage
} from "./reference-package.js";
import {
  runPandocProcess,
  type PandocProcessOptions,
  type PandocProcessResult,
  type PandocProcessRunner
} from "./pandoc-process.js";

const DEFAULT_PROBE_TIMEOUT_MS = 3_000;
const DEFAULT_REFERENCE_TIMEOUT_MS = 5_000;
const MAXIMUM_PROBE_OUTPUT_BYTES = 16 * 1024;

export interface PandocRuntimeResolution {
  capability: DocxCapability;
  executablePath?: string;
}

export interface PandocRuntimeOptions {
  configuredPath?: string;
  desktopResourcesPath?: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  environment?: NodeJS.ProcessEnv;
  probeTimeoutMs?: number;
  referenceTimeoutMs?: number;
  runner?: PandocProcessRunner;
}

interface RuntimeCandidate {
  executablePath: string;
  exclusive: boolean;
}

export class PandocRuntimeUnavailableError extends Error {
  constructor(
    readonly status: Exclude<DocxRuntimeStatus, "available">,
    message: string
  ) {
    super(message);
    this.name = "PandocRuntimeUnavailableError";
  }
}

function unavailableCapability(
  status: Exclude<DocxRuntimeStatus, "available">,
  message: string,
  detectedVersion?: string
): DocxCapability {
  return {
    format: "docx",
    status,
    expectedVersion: DOCX_PANDOC_VERSION,
    ...(detectedVersion ? { detectedVersion } : {}),
    message
  };
}

function availableCapability(): DocxCapability {
  return {
    format: "docx",
    status: "available",
    expectedVersion: DOCX_PANDOC_VERSION,
    detectedVersion: DOCX_PANDOC_VERSION
  };
}

function parseDetectedVersion(result: PandocProcessResult) {
  const firstLine = new TextDecoder()
    .decode(result.stdout)
    .split(/\r?\n/u)[0]
    ?.trim();
  return firstLine?.replace(/^pandoc\s+/u, "").trim() ?? "";
}

function createProbeOptions(
  timeoutMs: number,
  environment: NodeJS.ProcessEnv
): PandocProcessOptions {
  return {
    timeoutMs,
    maxStdoutBytes: MAXIMUM_PROBE_OUTPUT_BYTES,
    maxStderrBytes: MAXIMUM_PROBE_OUTPUT_BYTES,
    env: environment
  };
}

function outcomeStatus(result: PandocProcessResult) {
  if (result.outcome === "not-found") {
    return "not-found" as const;
  }
  if (
    result.outcome === "timeout" ||
    result.outcome === "aborted"
  ) {
    return "probe-timeout" as const;
  }
  return "not-executable" as const;
}

function createCandidates(options: PandocRuntimeOptions) {
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const environment = options.environment ?? process.env;
  const configuredPath =
    options.configuredPath ??
    environment.DOCX_PANDOC_PATH?.trim() ??
    "";
  if (configuredPath) {
    return [
      {
        executablePath: configuredPath,
        exclusive: true
      }
    ];
  }

  const candidates: RuntimeCandidate[] = [];
  if (
    platform === "win32" &&
    architecture === "x64" &&
    options.desktopResourcesPath
  ) {
    candidates.push({
      executablePath: path.join(
        options.desktopResourcesPath,
        "pandoc",
        DOCX_PANDOC_VERSION,
        "windows-x86_64",
        "pandoc.exe"
      ),
      exclusive: false
    });
  }
  if (
    platform === "darwin" &&
    (architecture === "arm64" || architecture === "x64") &&
    options.desktopResourcesPath
  ) {
    candidates.push({
      executablePath: path.join(
        options.desktopResourcesPath,
        "pandoc",
        DOCX_PANDOC_VERSION,
        `darwin-${architecture}`,
        "pandoc"
      ),
      exclusive: false
    });
  }
  if (platform === "linux" && architecture === "x64") {
    candidates.push({
      executablePath: `/opt/pandoc/${DOCX_PANDOC_VERSION}/bin/pandoc`,
      exclusive: false
    });
  }
  candidates.push({
    executablePath: platform === "win32" ? "pandoc.exe" : "pandoc",
    exclusive: false
  });
  return candidates.filter(
    (candidate, index, all) =>
      all.findIndex(
        (item) => item.executablePath === candidate.executablePath
      ) === index
  );
}

async function probeCandidate(
  candidate: RuntimeCandidate,
  runner: PandocProcessRunner,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<PandocRuntimeResolution> {
  const result = await runner(
    candidate.executablePath,
    ["--version"],
    createProbeOptions(timeoutMs, environment)
  );
  if (
    result.outcome !== "completed" ||
    result.exitCode !== 0
  ) {
    const status =
      result.outcome === "completed"
        ? "not-executable"
        : outcomeStatus(result);
    return {
      capability: unavailableCapability(
        status,
        status === "probe-timeout"
          ? "Pandoc 版本探测超时"
          : status === "not-found"
            ? "未找到 Pandoc 运行时"
            : "Pandoc 运行时无法执行"
      )
    };
  }
  const detectedVersion = parseDetectedVersion(result);
  if (detectedVersion !== DOCX_PANDOC_VERSION) {
    return {
      capability: unavailableCapability(
        "version-mismatch",
        `Pandoc 版本不匹配，需要 ${DOCX_PANDOC_VERSION}`,
        detectedVersion || "未知"
      )
    };
  }
  return {
    capability: availableCapability(),
    executablePath: candidate.executablePath
  };
}

export async function probePandocRuntime(
  options: PandocRuntimeOptions = {}
): Promise<PandocRuntimeResolution> {
  const environment = options.environment ?? process.env;
  const runner = options.runner ?? runPandocProcess;
  let lastMissing: PandocRuntimeResolution | undefined;
  for (const candidate of createCandidates(options)) {
    const resolution = await probeCandidate(
      candidate,
      runner,
      environment,
      options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
    );
    if (resolution.capability.status === "available") {
      return resolution;
    }
    if (
      resolution.capability.status !== "not-found" ||
      candidate.exclusive
    ) {
      return resolution;
    }
    lastMissing = resolution;
  }
  return (
    lastMissing ?? {
      capability: unavailableCapability(
        "not-found",
        "未找到 Pandoc 运行时"
      )
    }
  );
}

export class PandocRuntime {
  private resolution:
    | Promise<PandocRuntimeResolution>
    | undefined = undefined;
  private defaultReference:
    | Promise<Uint8Array>
    | undefined = undefined;

  constructor(private readonly options: PandocRuntimeOptions = {}) {}

  probe() {
    this.resolution ??= probePandocRuntime(this.options);
    return this.resolution;
  }

  async getExecutablePath() {
    const resolution = await this.probe();
    if (resolution.capability.status !== "available") {
      throw new PandocRuntimeUnavailableError(
        resolution.capability.status,
        resolution.capability.message
      );
    }
    if (!resolution.executablePath) {
      throw new PandocRuntimeUnavailableError(
        "not-found",
        "Pandoc capability 可用但缺少可执行路径"
      );
    }
    return resolution.executablePath;
  }

  async getDefaultReferenceDocx() {
    this.defaultReference ??= this.loadDefaultReferenceDocx();
    try {
      return (await this.defaultReference).slice();
    } catch (error) {
      this.defaultReference = undefined;
      throw error;
    }
  }

  invalidate() {
    this.resolution = undefined;
    this.defaultReference = undefined;
  }

  private async loadDefaultReferenceDocx() {
    const executablePath = await this.getExecutablePath();
    const runner = this.options.runner ?? runPandocProcess;
    const result = await runner(
      executablePath,
      ["--print-default-data-file", "reference.docx"],
      {
        timeoutMs:
          this.options.referenceTimeoutMs ??
          DEFAULT_REFERENCE_TIMEOUT_MS,
        maxStdoutBytes: MAXIMUM_REFERENCE_DOCX_BYTES,
        maxStderrBytes: MAXIMUM_PROBE_OUTPUT_BYTES,
        env: this.options.environment ?? process.env
      }
    );
    if (
      result.outcome !== "completed" ||
      result.exitCode !== 0
    ) {
      const status =
        result.outcome === "timeout" ||
        result.outcome === "aborted"
          ? "probe-timeout"
          : result.outcome === "not-found"
            ? "not-found"
            : "not-executable";
      throw new PandocRuntimeUnavailableError(
        status,
        "无法读取 Pandoc 默认 reference.docx"
      );
    }
    readReferenceDocxPackage(result.stdout);
    return result.stdout;
  }
}
