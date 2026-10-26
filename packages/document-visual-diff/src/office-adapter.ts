import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

import {
  assertPdfBytes,
  type PdfAdapterCapability,
  type PdfAdapterGeneration,
  type PdfArtifactAdapter,
} from "./adapters.js";
import type { PdfSnapshotSource } from "./types.js";

const execFileAsync = promisify(execFile);
const MAX_OFFICE_INPUT_BYTES = 250 * 1024 * 1024;
const MAX_OFFICE_OUTPUT_BYTES = 500 * 1024 * 1024;

export type OfficeClientKind = "word" | "wps";

export interface OfficePdfAdapterInput {
  docxPath: string;
}

export interface OfficeExportMetadata {
  pageCount?: number;
  bytes: number;
}

export interface OfficeInlineShapeObservation {
  index: number;
  widthPt: number;
  heightPt: number;
  type?: number;
}

export interface OfficeDocxRoundTripMetadata {
  bytes: number;
  before: OfficeInlineShapeObservation[];
  saved: OfficeInlineShapeObservation[];
  resizedShapeIndex: number;
  resizeScale: number;
}

export interface OfficeDocxRoundTripGeneration
  extends OfficeDocxRoundTripMetadata {
  client: OfficeClientKind;
  docx: Uint8Array;
  elapsedMs: number;
}

export interface OfficeDocxRoundTripAdapter {
  id: string;
  client: OfficeClientKind;
  probe(): Promise<PdfAdapterCapability>;
  generate(
    input: OfficePdfAdapterInput,
  ): Promise<OfficeDocxRoundTripGeneration>;
}

export interface OfficeAutomationBackend {
  probe(progId: string, timeoutMs: number): Promise<boolean>;
  exportPdf(options: {
    client: OfficeClientKind;
    progId: string;
    inputPath: string;
    outputPath: string;
    timeoutMs: number;
  }): Promise<OfficeExportMetadata>;
  roundTripDocx?(options: {
    client: OfficeClientKind;
    progId: string;
    inputPath: string;
    outputPath: string;
    timeoutMs: number;
    resizeScale: number;
  }): Promise<OfficeDocxRoundTripMetadata>;
}

export interface OfficePdfAdapterOptions {
  label?: string;
  timeoutMs?: number;
  backend?: OfficeAutomationBackend;
}

interface OfficeDescriptor {
  id: string;
  client: OfficeClientKind;
  progId: string;
  defaultLabel: string;
}

const POWERSHELL_PROBE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$progId = $env:MORPHDOC_OFFICE_PROGID
$type = [Type]::GetTypeFromProgID($progId, $false)
if ($null -eq $type) { exit 2 }
[pscustomobject]@{ available = $true; progId = $progId } |
  ConvertTo-Json -Compress
`;

const POWERSHELL_EXPORT_SCRIPT = `
$ErrorActionPreference = 'Stop'
$client = $env:MORPHDOC_OFFICE_CLIENT
$progId = $env:MORPHDOC_OFFICE_PROGID
$resolvedInput = (Resolve-Path -LiteralPath $env:MORPHDOC_OFFICE_INPUT).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($env:MORPHDOC_OFFICE_OUTPUT)
if ([System.IO.File]::Exists($resolvedOutput)) {
  throw "Office PDF 输出已存在：$resolvedOutput"
}
$application = $null
$document = $null
try {
  $application = New-Object -ComObject $progId
  $application.Visible = $false
  try { $application.DisplayAlerts = 0 } catch {}
  if ($client -eq 'word') {
    $application.AutomationSecurity = 3
    $application.Options.SaveNormalPrompt = $false
    $document = $application.Documents.OpenNoRepairDialog(
      $resolvedInput, $false, $true, $false, '', '', $false,
      '', '', 0, 0, $false, $false, 0, $true
    )
  } else {
    try { $application.AutomationSecurity = 3 } catch {}
    $document = $application.Documents.Open(
      $resolvedInput, $false, $true, $false
    )
  }
  $pageCount = $null
  try { $pageCount = $document.ComputeStatistics(2) } catch {}
  $document.ExportAsFixedFormat($resolvedOutput, 17)
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    if ([System.IO.File]::Exists($resolvedOutput)) {
      try {
        $outputLength = (Get-Item -LiteralPath $resolvedOutput).Length
        if ($outputLength -gt 0) { break }
      } catch {}
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  if (
    -not [System.IO.File]::Exists($resolvedOutput) -or
    (Get-Item -LiteralPath $resolvedOutput).Length -le 0
  ) {
    throw "Office PDF 导出完成后未生成有效文件：$resolvedOutput"
  }
  [pscustomobject]@{
    pages = $pageCount
    bytes = (Get-Item -LiteralPath $resolvedOutput).Length
  } | ConvertTo-Json -Compress
} finally {
  if ($null -ne $document) {
    try { $document.Close($false) } finally {
      [System.Runtime.InteropServices.Marshal]::ReleaseComObject(
        $document
      ) | Out-Null
    }
  }
  if ($null -ne $application) {
    try { $application.Quit() } finally {
      [System.Runtime.InteropServices.Marshal]::ReleaseComObject(
        $application
      ) | Out-Null
    }
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
`;

const POWERSHELL_ROUND_TRIP_SCRIPT = `
$ErrorActionPreference = 'Stop'
$client = $env:MORPHDOC_OFFICE_CLIENT
$progId = $env:MORPHDOC_OFFICE_PROGID
$resizeScale = [double]::Parse(
  $env:MORPHDOC_OFFICE_RESIZE_SCALE,
  [Globalization.CultureInfo]::InvariantCulture
)
$resolvedInput = (Resolve-Path -LiteralPath $env:MORPHDOC_OFFICE_INPUT).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($env:MORPHDOC_OFFICE_OUTPUT)
if ([System.IO.File]::Exists($resolvedOutput)) {
  throw "Office DOCX 互存输出已存在：$resolvedOutput"
}
[System.IO.File]::Copy($resolvedInput, $resolvedOutput, $false)
$application = $null
$document = $null
function Read-InlineShapes($value) {
  $result = @()
  for ($index = 1; $index -le $value.InlineShapes.Count; $index += 1) {
    $shape = $value.InlineShapes.Item($index)
    $result += [pscustomobject]@{
      index = $index
      widthPt = [double]$shape.Width
      heightPt = [double]$shape.Height
      type = [int]$shape.Type
    }
  }
  return @($result)
}
function Open-Document($application, $client, $path, $readOnly) {
  if ($client -eq 'word' -and $readOnly) {
    return $application.Documents.OpenNoRepairDialog(
      $path, $false, $readOnly, $false, '', '', $false,
      '', '', 0, 0, $false, $false, 0, $true
    )
  }
  return $application.Documents.Open($path, $false, $readOnly, $false)
}
try {
  $application = New-Object -ComObject $progId
  $application.Visible = $false
  try { $application.DisplayAlerts = 0 } catch {}
  try { $application.AutomationSecurity = 3 } catch {}
  $document = Open-Document $application $client $resolvedOutput $false
  try { $document.EmbedTrueTypeFonts = $false } catch {}
  try { $document.SaveSubsetFonts = $false } catch {}
  $before = @(Read-InlineShapes $document)
  if ($before.Count -lt 1) {
    throw 'Office DOCX 不包含可缩放的内联图片'
  }
  $shape = $document.InlineShapes.Item(1)
  $originalWidth = [double]$shape.Width
  $originalHeight = [double]$shape.Height
  $shape.Width = [single]($originalWidth * $resizeScale)
  $expectedHeight = $originalHeight * $resizeScale
  if ([Math]::Abs([double]$shape.Height - $expectedHeight) -gt 0.5) {
    $shape.Height = [single]$expectedHeight
  }
  if (
    [Math]::Abs([double]$shape.Width - ($originalWidth * $resizeScale)) -gt 0.5 -or
    [Math]::Abs([double]$shape.Height - $expectedHeight) -gt 0.5
  ) {
    throw (
      'Office 未在内存中按比例缩放首张图片：' +
      "readOnly=$($document.ReadOnly), " +
      "before=$originalWidth/$originalHeight, " +
      "actual=$([double]$shape.Width)/$([double]$shape.Height), " +
      "expected=$($originalWidth * $resizeScale)/$expectedHeight"
    )
  }
  $document.Close($true)
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject(
    $document
  ) | Out-Null
  $document = $null
  $document = Open-Document $application $client $resolvedOutput $true
  $saved = @(Read-InlineShapes $document)
  [pscustomobject]@{
    bytes = (Get-Item -LiteralPath $resolvedOutput).Length
    before = $before
    saved = $saved
    resizedShapeIndex = 1
    resizeScale = $resizeScale
  } | ConvertTo-Json -Compress -Depth 5
} finally {
  if ($null -ne $document) {
    try { $document.Close($false) } finally {
      [System.Runtime.InteropServices.Marshal]::ReleaseComObject(
        $document
      ) | Out-Null
    }
  }
  if ($null -ne $application) {
    try { $application.Quit() } finally {
      [System.Runtime.InteropServices.Marshal]::ReleaseComObject(
        $application
      ) | Out-Null
    }
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
`;

function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

function parseJsonLine(
  stdout: string,
): Record<string, unknown> {
  const line = stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) {
    throw new Error("Office 自动化没有返回结果");
  }
  const parsed: unknown = JSON.parse(line);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Office 自动化返回格式无效");
  }
  return parsed as Record<string, unknown>;
}

export class PowerShellOfficeAutomationBackend
  implements OfficeAutomationBackend
{
  async probe(progId: string, timeoutMs: number): Promise<boolean> {
    if (process.platform !== "win32") {
      return false;
    }
    try {
      await execFileAsync(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-EncodedCommand",
          encodePowerShell(POWERSHELL_PROBE_SCRIPT),
        ],
        {
          timeout: Math.min(timeoutMs, 15_000),
          windowsHide: true,
          encoding: "utf8",
          env: {
            ...process.env,
            MORPHDOC_OFFICE_PROGID: progId,
          },
        },
      );
      return true;
    } catch {
      return false;
    }
  }

  async exportPdf(options: {
    client: OfficeClientKind;
    progId: string;
    inputPath: string;
    outputPath: string;
    timeoutMs: number;
  }): Promise<OfficeExportMetadata> {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodePowerShell(POWERSHELL_EXPORT_SCRIPT),
      ],
      {
        timeout: options.timeoutMs,
        windowsHide: true,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          MORPHDOC_OFFICE_CLIENT: options.client,
          MORPHDOC_OFFICE_PROGID: options.progId,
          MORPHDOC_OFFICE_INPUT: options.inputPath,
          MORPHDOC_OFFICE_OUTPUT: options.outputPath,
        },
      },
    );
    const parsed = parseJsonLine(stdout);
    const bytes = parsed.bytes;
    const pages = parsed.pages;
    if (typeof bytes !== "number" || !Number.isSafeInteger(bytes)) {
      throw new Error("Office 自动化未返回有效的 PDF 字节数");
    }
    return {
      bytes,
      ...(typeof pages === "number" && Number.isSafeInteger(pages)
        ? { pageCount: pages }
        : {}),
    };
  }

  async roundTripDocx(options: {
    client: OfficeClientKind;
    progId: string;
    inputPath: string;
    outputPath: string;
    timeoutMs: number;
    resizeScale: number;
  }): Promise<OfficeDocxRoundTripMetadata> {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodePowerShell(POWERSHELL_ROUND_TRIP_SCRIPT),
      ],
      {
        timeout: options.timeoutMs,
        windowsHide: true,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          MORPHDOC_OFFICE_CLIENT: options.client,
          MORPHDOC_OFFICE_PROGID: options.progId,
          MORPHDOC_OFFICE_INPUT: options.inputPath,
          MORPHDOC_OFFICE_OUTPUT: options.outputPath,
          MORPHDOC_OFFICE_RESIZE_SCALE: String(options.resizeScale),
        },
      },
    );
    const parsed = parseJsonLine(stdout);
    const bytes = parsed.bytes;
    const before = parsed.before;
    const saved = parsed.saved;
    if (
      typeof bytes !== "number" ||
      !Number.isSafeInteger(bytes) ||
      !Array.isArray(before) ||
      !Array.isArray(saved)
    ) {
      throw new Error("Office DOCX 互存返回格式无效");
    }
    const parseShapes = (value: unknown[]) =>
      value.map((entry) => {
        if (
          typeof entry !== "object" ||
          entry === null ||
          typeof (entry as Record<string, unknown>).index !== "number" ||
          typeof (entry as Record<string, unknown>).widthPt !== "number" ||
          typeof (entry as Record<string, unknown>).heightPt !== "number"
        ) {
          throw new Error("Office 内联图片观测格式无效");
        }
        const shape = entry as Record<string, unknown>;
        return {
          index: shape.index as number,
          widthPt: shape.widthPt as number,
          heightPt: shape.heightPt as number,
          ...(typeof shape.type === "number"
            ? { type: shape.type }
            : {}),
        };
      });
    return {
      bytes,
      before: parseShapes(before),
      saved: parseShapes(saved),
      resizedShapeIndex: 1,
      resizeScale: options.resizeScale,
    };
  }
}

async function validateDocxPath(inputPath: string): Promise<string> {
  if (extname(inputPath).toLowerCase() !== ".docx") {
    throw new Error("Office PDF 适配器只接受 .docx 文件");
  }
  const resolvedPath = await realpath(resolve(inputPath));
  const inputStat = await stat(resolvedPath);
  if (!inputStat.isFile()) {
    throw new Error("Office PDF 输入必须是普通文件");
  }
  if (
    inputStat.size <= 0 ||
    inputStat.size > MAX_OFFICE_INPUT_BYTES
  ) {
    throw new Error(
      `Office PDF 输入大小超限：${inputStat.size}`,
    );
  }
  return resolvedPath;
}

function createOfficePdfAdapter(
  descriptor: OfficeDescriptor,
  options: OfficePdfAdapterOptions = {},
): PdfArtifactAdapter<OfficePdfAdapterInput> {
  const backend =
    options.backend ?? new PowerShellOfficeAutomationBackend();
  const timeoutMs = options.timeoutMs ?? 180_000;
  const source: PdfSnapshotSource = {
    kind: descriptor.client,
    label: options.label ?? descriptor.defaultLabel,
  };
  return {
    id: descriptor.id,
    source,
    async probe(): Promise<PdfAdapterCapability> {
      const available = await backend.probe(
        descriptor.progId,
        timeoutMs,
      );
      return {
        available,
        adapterId: descriptor.id,
        source,
        detail: available
          ? `已注册 ${descriptor.progId}`
          : `未找到 ${descriptor.progId}`,
      };
    },
    async generate(
      input: OfficePdfAdapterInput,
    ): Promise<PdfAdapterGeneration> {
      const inputPath = await validateDocxPath(input.docxPath);
      const temporaryDirectory = await mkdtemp(
        join(tmpdir(), `morphdoc-${descriptor.client}-`),
      );
      const outputPath = join(
        temporaryDirectory,
        `${basename(inputPath, extname(inputPath))}.pdf`,
      );
      const startedAt = performance.now();
      try {
        let metadata: OfficeExportMetadata | undefined;
        let lastError: unknown;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            metadata = await backend.exportPdf({
              client: descriptor.client,
              progId: descriptor.progId,
              inputPath,
              outputPath,
              timeoutMs,
            });
            break;
          } catch (error) {
            lastError = error;
            await rm(outputPath, { force: true });
            if (attempt < 3) {
              await new Promise<void>((resolve) => {
                setTimeout(resolve, attempt * 250);
              });
            }
          }
        }
        if (!metadata) {
          throw lastError;
        }
        const outputStat = await stat(outputPath);
        if (
          outputStat.size <= 0 ||
          outputStat.size > MAX_OFFICE_OUTPUT_BYTES ||
          outputStat.size !== metadata.bytes
        ) {
          throw new Error(
            `Office PDF 输出大小无效：${outputStat.size}`,
          );
        }
        const pdf = Uint8Array.from(await readFile(outputPath));
        assertPdfBytes(pdf, source.label);
        return {
          source,
          pdf,
          ...(metadata.pageCount === undefined
            ? {}
            : { pageCount: metadata.pageCount }),
          elapsedMs: performance.now() - startedAt,
          diagnostics: [],
        };
      } finally {
        await rm(temporaryDirectory, {
          recursive: true,
          force: true,
        });
      }
    },
  };
}

export function createWordPdfAdapter(
  options: OfficePdfAdapterOptions = {},
): PdfArtifactAdapter<OfficePdfAdapterInput> {
  return createOfficePdfAdapter(
    {
      id: "word",
      client: "word",
      progId: "Word.Application",
      defaultLabel: "Microsoft Word",
    },
    options,
  );
}

export function createWpsPdfAdapter(
  options: OfficePdfAdapterOptions = {},
): PdfArtifactAdapter<OfficePdfAdapterInput> {
  return createOfficePdfAdapter(
    {
      id: "wps",
      client: "wps",
      progId: "KWPS.Application",
      defaultLabel: "WPS Writer",
    },
    options,
  );
}

function createOfficeDocxRoundTripAdapter(
  descriptor: OfficeDescriptor,
  options: OfficePdfAdapterOptions = {},
): OfficeDocxRoundTripAdapter {
  const backend =
    options.backend ?? new PowerShellOfficeAutomationBackend();
  const timeoutMs = options.timeoutMs ?? 180_000;
  const resizeScale = 0.9;
  return {
    id: `${descriptor.id}-docx-round-trip`,
    client: descriptor.client,
    async probe() {
      const available = await backend.probe(
        descriptor.progId,
        timeoutMs,
      );
      return {
        available,
        adapterId: `${descriptor.id}-docx-round-trip`,
        source: {
          kind: descriptor.client,
          label: `${descriptor.defaultLabel} DOCX 互存`,
        },
        detail: available
          ? `已注册 ${descriptor.progId}`
          : `未找到 ${descriptor.progId}`,
      };
    },
    async generate(input) {
      if (!backend.roundTripDocx) {
        throw new Error("Office 自动化后端不支持 DOCX 互存");
      }
      const inputPath = await validateDocxPath(input.docxPath);
      const temporaryDirectory = await mkdtemp(
        join(
          dirname(inputPath),
          `.morphdoc-${descriptor.client}-round-trip-`,
        ),
      );
      const outputPath = join(
        temporaryDirectory,
        `${basename(inputPath, extname(inputPath))}-round-trip.docx`,
      );
      const startedAt = performance.now();
      try {
        const metadata = await backend.roundTripDocx({
          client: descriptor.client,
          progId: descriptor.progId,
          inputPath,
          outputPath,
          timeoutMs,
          resizeScale,
        });
        const outputStat = await stat(outputPath);
        if (
          outputStat.size <= 0 ||
          outputStat.size > MAX_OFFICE_OUTPUT_BYTES ||
          outputStat.size !== metadata.bytes
        ) {
          throw new Error(
            `Office DOCX 互存输出大小无效：${outputStat.size}`,
          );
        }
        return {
          client: descriptor.client,
          docx: Uint8Array.from(await readFile(outputPath)),
          ...metadata,
          elapsedMs: performance.now() - startedAt,
        };
      } finally {
        await rm(temporaryDirectory, {
          recursive: true,
          force: true,
        });
      }
    },
  };
}

export function createWordDocxRoundTripAdapter(
  options: OfficePdfAdapterOptions = {},
) {
  return createOfficeDocxRoundTripAdapter(
    {
      id: "word",
      client: "word",
      progId: "Word.Application",
      defaultLabel: "Microsoft Word",
    },
    options,
  );
}

export function createWpsDocxRoundTripAdapter(
  options: OfficePdfAdapterOptions = {},
) {
  return createOfficeDocxRoundTripAdapter(
    {
      id: "wps",
      client: "wps",
      progId: "KWPS.Application",
      defaultLabel: "WPS Writer",
    },
    options,
  );
}
