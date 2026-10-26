import { createHash } from "node:crypto";
import { MAXIMUM_DOCX_OUTPUT_BYTES } from "@morphdoc/core";
import { unzipSync, zipSync, type Zippable } from "fflate";

export const MAXIMUM_REFERENCE_DOCX_BYTES = 2 * 1024 * 1024;
export const MAXIMUM_REFERENCE_ENTRY_COUNT = 256;
export const MAXIMUM_REFERENCE_UNCOMPRESSED_BYTES =
  64 * 1024 * 1024;
export const MAXIMUM_GENERATED_DOCX_ENTRY_COUNT = 512;
export const MAXIMUM_GENERATED_DOCX_UNCOMPRESSED_BYTES =
  128 * 1024 * 1024;

export interface DocxPackageLimits {
  maximumBytes: number;
  maximumEntryCount: number;
  maximumUncompressedBytes: number;
}

export const referenceDocxPackageLimits: DocxPackageLimits = {
  maximumBytes: MAXIMUM_REFERENCE_DOCX_BYTES,
  maximumEntryCount: MAXIMUM_REFERENCE_ENTRY_COUNT,
  maximumUncompressedBytes: MAXIMUM_REFERENCE_UNCOMPRESSED_BYTES
};

export const generatedDocxPackageLimits: DocxPackageLimits = {
  maximumBytes: MAXIMUM_DOCX_OUTPUT_BYTES,
  maximumEntryCount: MAXIMUM_GENERATED_DOCX_ENTRY_COUNT,
  maximumUncompressedBytes:
    MAXIMUM_GENERATED_DOCX_UNCOMPRESSED_BYTES
};

export const requiredReferenceDocxParts = [
  "[Content_Types].xml",
  "_rels/.rels",
  "word/document.xml",
  "word/fontTable.xml",
  "word/numbering.xml",
  "word/settings.xml",
  "word/styles.xml",
  "word/_rels/document.xml.rels",
  "word/theme/theme1.xml"
] as const;

export interface ReferenceDocxPackage {
  fingerprint: string;
  entries: ReadonlyMap<string, Uint8Array>;
}

interface ZipDirectoryEntry {
  name: string;
  uncompressedSize: number;
}

function fingerprintEntries(
  entries: ReadonlyMap<string, Uint8Array>
) {
  const hash = createHash("sha256");
  for (const [name, content] of [...entries].sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(content.byteLength));
    hash.update(name, "utf8");
    hash.update(Uint8Array.of(0));
    hash.update(length);
    hash.update(content);
  }
  return hash.digest("hex");
}

function findEndOfCentralDirectory(content: Uint8Array) {
  const view = new DataView(
    content.buffer,
    content.byteOffset,
    content.byteLength
  );
  const minimumOffset = Math.max(0, content.byteLength - 65_557);
  for (
    let offset = content.byteLength - 22;
    offset >= minimumOffset;
    offset -= 1
  ) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("reference.docx 缺少 ZIP 中央目录");
}

function validateEntryName(name: string) {
  if (
    !name ||
    name.includes("\\") ||
    name.startsWith("/") ||
    name.includes(":") ||
    name.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`reference.docx 包含不安全路径：${name}`);
  }
}

function inspectZipDirectory(
  content: Uint8Array,
  limits: DocxPackageLimits
) {
  if (
    content.byteLength < 22 ||
    content.byteLength > limits.maximumBytes
  ) {
    throw new Error("reference.docx 压缩包大小超过限制或内容不完整");
  }

  const view = new DataView(
    content.buffer,
    content.byteOffset,
    content.byteLength
  );
  const endOffset = findEndOfCentralDirectory(content);
  const diskNumber = view.getUint16(endOffset + 4, true);
  const directoryDisk = view.getUint16(endOffset + 6, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const directorySize = view.getUint32(endOffset + 12, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  if (
    diskNumber !== 0 ||
    directoryDisk !== 0 ||
    entryCount > limits.maximumEntryCount ||
    entryCount === 0 ||
    directoryOffset + directorySize > endOffset
  ) {
    throw new Error("reference.docx ZIP 中央目录不受支持");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipDirectoryEntry[] = [];
  const names = new Set<string>();
  let totalUncompressedBytes = 0;
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > endOffset ||
      view.getUint32(offset, true) !== 0x02014b50
    ) {
      throw new Error("reference.docx ZIP 中央目录损坏");
    }
    const flags = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nextOffset =
      offset + 46 + nameLength + extraLength + commentLength;
    if (
      nextOffset > endOffset ||
      (flags & 0x1) !== 0 ||
      ![0, 8].includes(compressionMethod) ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff
    ) {
      throw new Error("reference.docx 包含不支持的 ZIP 条目");
    }
    const name = decoder.decode(
      content.subarray(offset + 46, offset + 46 + nameLength)
    );
    validateEntryName(name);
    if (names.has(name)) {
      throw new Error(`reference.docx 包含重复条目：${name}`);
    }
    names.add(name);
    totalUncompressedBytes += uncompressedSize;
    if (
      totalUncompressedBytes >
      limits.maximumUncompressedBytes
    ) {
      throw new Error("reference.docx 解压后总大小超过限制");
    }
    entries.push({ name, uncompressedSize });
    offset = nextOffset;
  }
  if (offset !== directoryOffset + directorySize) {
    throw new Error("reference.docx ZIP 中央目录长度不一致");
  }
  return entries;
}

export function readDocxPackage(
  content: Uint8Array,
  limits: DocxPackageLimits
): ReferenceDocxPackage {
  const directory = inspectZipDirectory(content, limits);
  const unzipped = unzipSync(content);
  const entries = new Map<string, Uint8Array>();
  for (const descriptor of directory) {
    if (descriptor.name.endsWith("/")) {
      continue;
    }
    const value = unzipped[descriptor.name];
    if (
      !value ||
      value.byteLength !== descriptor.uncompressedSize
    ) {
      throw new Error(
        `reference.docx 条目解压尺寸不一致：${descriptor.name}`
      );
    }
    entries.set(descriptor.name, value);
  }
  for (const required of requiredReferenceDocxParts) {
    if (!entries.has(required)) {
      throw new Error(`reference.docx 缺少必要部件：${required}`);
    }
  }
  return {
    fingerprint: fingerprintEntries(entries),
    entries
  };
}

export function readReferenceDocxPackage(
  content: Uint8Array
): ReferenceDocxPackage {
  return readDocxPackage(content, referenceDocxPackageLimits);
}

export function readGeneratedDocxPackage(
  content: Uint8Array
): ReferenceDocxPackage {
  return readDocxPackage(content, generatedDocxPackageLimits);
}

function writeDocxPackage(
  entries: ReadonlyMap<string, Uint8Array>,
  limits: DocxPackageLimits
) {
  const zippable: Zippable = {};
  const mtime = new Date("1980-01-01T00:00:00.000Z");
  for (const [name, content] of [...entries].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    validateEntryName(name);
    zippable[name] = [content, { mtime }];
  }
  const result = zipSync(zippable, {
    level: 6,
    mtime
  });
  readDocxPackage(result, limits);
  return result;
}

export function writeReferenceDocxPackage(
  entries: ReadonlyMap<string, Uint8Array>
) {
  return writeDocxPackage(entries, referenceDocxPackageLimits);
}

export function writeGeneratedDocxPackage(
  entries: ReadonlyMap<string, Uint8Array>
) {
  return writeDocxPackage(entries, generatedDocxPackageLimits);
}
