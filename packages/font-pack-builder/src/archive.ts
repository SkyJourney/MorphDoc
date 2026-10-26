import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { zipSync } from "fflate";
import { verifyFontPack } from "./builder.js";

const ARCHIVE_MTIME = new Date("1980-01-01T00:00:00.000Z");

export interface BuildFontPackArchiveOptions {
  packRoot: string;
  appVersion: string;
  packId: string;
  packVersion: string;
  outputDirectory: string;
  reportPath?: string;
}

export interface FontPackArchiveReport {
  packId: string;
  packVersion: string;
  artifactPath: string;
  artifactName: string;
  bytes: number;
  sha256: string;
  entries: string[];
}

function sha256(content: Uint8Array) {
  return createHash("sha256").update(content).digest("hex").toUpperCase();
}

export function fontPackArchiveName(packId: string, version: string) {
  return `MorphDoc-FontPack-${packId}-${version}.zip`;
}

async function collectFiles(directory: string, prefix: string) {
  const result: Array<{ name: string; content: Uint8Array }> = [];
  const visit = async (currentDirectory: string, relativeDirectory: string) => {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const entryPath = join(currentDirectory, entry.name);
      const status = await lstat(entryPath);
      if (status.isSymbolicLink()) {
        throw new Error(`字体包归档不允许符号链接：${entry.name}`);
      }
      const relativePath = posix.join(
        prefix,
        relativeDirectory.replaceAll("\\", "/"),
        entry.name
      );
      if (status.isDirectory()) {
        await visit(entryPath, posix.join(relativeDirectory, entry.name));
      } else if (status.isFile()) {
        result.push({ name: relativePath, content: await readFile(entryPath) });
      } else {
        throw new Error(`字体包归档只允许普通文件：${entry.name}`);
      }
    }
  };
  await visit(directory, "");
  return result;
}

export async function createDeterministicFontPackArchive(
  packDirectory: string,
  prefix: string
) {
  const files = await collectFiles(resolve(packDirectory), prefix);
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[file.name] = file.content;
  }
  return {
    content: zipSync(entries, { level: 9, mtime: ARCHIVE_MTIME }),
    entries: files.map((file) => file.name)
  };
}

export async function buildFontPackArchive(
  options: BuildFontPackArchiveOptions
): Promise<FontPackArchiveReport> {
  const verified = await verifyFontPack({
    root: options.packRoot,
    appVersion: options.appVersion,
    packId: options.packId,
    packVersion: options.packVersion
  });
  const archive = await createDeterministicFontPackArchive(
    verified.outputDirectory,
    `${verified.packId}/${verified.packVersion}`
  );
  const outputDirectory = resolve(options.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const artifactName = fontPackArchiveName(
    verified.packId,
    verified.packVersion
  );
  const artifactPath = join(outputDirectory, artifactName);
  await writeFile(artifactPath, archive.content);
  const report: FontPackArchiveReport = {
    packId: verified.packId,
    packVersion: verified.packVersion,
    artifactPath,
    artifactName,
    bytes: archive.content.byteLength,
    sha256: sha256(archive.content),
    entries: archive.entries
  };
  if (options.reportPath) {
    const reportPath = resolve(options.reportPath);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  return report;
}
