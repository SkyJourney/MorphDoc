import { createHash } from "node:crypto";
import {
  MAXIMUM_DOCX_FONT_FACE_COUNT,
  MAXIMUM_DOCX_FONT_SOURCE_BYTES,
  MAXIMUM_DOCX_FONT_TOTAL_SOURCE_BYTES
} from "@morphdoc/core";
import fontverter from "fontverter";

export const MAXIMUM_DOCX_FONT_SFNT_BYTES = 16 * 1024 * 1024;
export const MAXIMUM_DOCX_FONT_TOTAL_SFNT_BYTES =
  48 * 1024 * 1024;
const MAXIMUM_FONT_CONVERSION_CACHE_ENTRIES = 8;
const SFNT_CHECKSUM_MAGIC = 0xb1b0afba;
const fontConversionCache = new Map<
  string,
  Promise<Uint8Array>
>();
let fontConversionQueue = Promise.resolve();

const supportedSfntSignatures = new Set([
  "\u0000\u0001\u0000\u0000",
  "OTTO",
  "true"
]);

export type DocxFontStyle = "normal" | "italic";
export type DocxFontEmbeddingPermission =
  | "installable"
  | "editable";

export interface DocxFontSource {
  family: string;
  aliases: string[];
  source: string;
  weight: number;
  style: DocxFontStyle;
  license: string;
  content: Uint8Array;
}

export interface SfntFontMetadata {
  family: string;
  subfamily: string;
  postscriptName?: string;
  weightClass: number;
  panose: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number
  ];
  unicodeRanges: readonly [number, number, number, number];
  codePageRanges: readonly [number, number];
  fixedPitch: boolean;
  fsType: number;
  permission: DocxFontEmbeddingPermission;
  noSubsetting: boolean;
  signature: "\u0000\u0001\u0000\u0000" | "OTTO" | "true";
}

export interface PreparedDocxFont {
  source: DocxFontSource;
  metadata: SfntFontMetadata;
  sfnt: Uint8Array;
  fingerprint: string;
}

export interface ObfuscatedDocxFont {
  content: Uint8Array;
  fontKey: string;
  partName: string;
}

interface SfntTable {
  offset: number;
  length: number;
  recordOffset: number;
}

function readTag(content: Uint8Array, offset: number) {
  return String.fromCharCode(
    content[offset] ?? 0,
    content[offset + 1] ?? 0,
    content[offset + 2] ?? 0,
    content[offset + 3] ?? 0
  );
}

function assertRange(
  content: Uint8Array,
  offset: number,
  length: number,
  label: string
) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > content.byteLength
  ) {
    throw new Error(`字体 ${label} 数据越界`);
  }
}

function readUint16(
  view: DataView,
  content: Uint8Array,
  offset: number,
  label: string
) {
  assertRange(content, offset, 2, label);
  return view.getUint16(offset, false);
}

function readUint32(
  view: DataView,
  content: Uint8Array,
  offset: number,
  label: string
) {
  assertRange(content, offset, 4, label);
  return view.getUint32(offset, false);
}

function readSfntTables(content: Uint8Array) {
  if (
    content.byteLength < 12 ||
    content.byteLength > MAXIMUM_DOCX_FONT_SFNT_BYTES
  ) {
    throw new Error("SFNT 字体大小无效");
  }
  const signature = readTag(content, 0);
  if (!supportedSfntSignatures.has(signature)) {
    throw new Error("字体不是受支持的 TrueType 或 OpenType SFNT");
  }

  const view = new DataView(
    content.buffer,
    content.byteOffset,
    content.byteLength
  );
  const tableCount = readUint16(
    view,
    content,
    4,
    "表目录数量"
  );
  if (tableCount < 1 || tableCount > 256) {
    throw new Error("SFNT 字体表数量无效");
  }
  assertRange(content, 12, tableCount * 16, "表目录");

  const tables = new Map<string, SfntTable>();
  for (let index = 0; index < tableCount; index += 1) {
    const recordOffset = 12 + index * 16;
    const tag = readTag(content, recordOffset);
    const offset = readUint32(
      view,
      content,
      recordOffset + 8,
      `${tag} 表偏移`
    );
    const length = readUint32(
      view,
      content,
      recordOffset + 12,
      `${tag} 表长度`
    );
    assertRange(content, offset, length, `${tag} 表`);
    if (tables.has(tag)) {
      throw new Error(`SFNT 字体包含重复表：${tag}`);
    }
    tables.set(tag, { offset, length, recordOffset });
  }

  return {
    signature: signature as SfntFontMetadata["signature"],
    tables,
    view
  };
}

function calculateSfntChecksum(
  content: Uint8Array,
  offset = 0,
  length = content.byteLength
) {
  assertRange(content, offset, length, "校验和");
  let checksum = 0;
  const paddedLength = Math.ceil(length / 4) * 4;
  for (
    let relativeOffset = 0;
    relativeOffset < paddedLength;
    relativeOffset += 4
  ) {
    let word = 0;
    for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
      const index = relativeOffset + byteIndex;
      word =
        (word << 8) |
        (index < length ? (content[offset + index] ?? 0) : 0);
    }
    checksum = (checksum + (word >>> 0)) >>> 0;
  }
  return checksum;
}

function normalizeSfntWeightClass(
  content: Uint8Array,
  weightClass: number
) {
  if (
    !Number.isInteger(weightClass) ||
    weightClass < 1 ||
    weightClass > 1000
  ) {
    throw new Error("字体声明权重必须位于 1 到 1000 之间");
  }
  const { tables, view } = readSfntTables(content);
  const os2 = tables.get("OS/2");
  const head = tables.get("head");
  if (!os2 || os2.length < 6) {
    throw new Error("SFNT 字体缺少可写入权重的 OS/2 表");
  }
  if (!head || head.length < 12) {
    throw new Error("SFNT 字体缺少完整 head 表");
  }
  if (view.getUint16(os2.offset + 4, false) === weightClass) {
    return;
  }

  view.setUint16(os2.offset + 4, weightClass, false);
  view.setUint32(
    os2.recordOffset + 4,
    calculateSfntChecksum(content, os2.offset, os2.length),
    false
  );

  const adjustmentOffset = head.offset + 8;
  view.setUint32(adjustmentOffset, 0, false);
  view.setUint32(
    head.recordOffset + 4,
    calculateSfntChecksum(content, head.offset, head.length),
    false
  );
  const checksum = calculateSfntChecksum(content);
  view.setUint32(
    adjustmentOffset,
    (SFNT_CHECKSUM_MAGIC - checksum) >>> 0,
    false
  );
  if (calculateSfntChecksum(content) !== SFNT_CHECKSUM_MAGIC) {
    throw new Error("SFNT 字体元数据规范化后校验和无效");
  }
}

function decodeUtf16Be(content: Uint8Array) {
  if (content.byteLength % 2 !== 0) {
    throw new Error("字体名称 UTF-16BE 长度无效");
  }
  let value = "";
  for (let offset = 0; offset < content.byteLength; offset += 2) {
    value += String.fromCharCode(
      ((content[offset] ?? 0) << 8) |
        (content[offset + 1] ?? 0)
    );
  }
  return value.replaceAll("\0", "").trim();
}

function decodeName(
  content: Uint8Array,
  platformId: number
) {
  if (platformId === 0 || platformId === 3) {
    return decodeUtf16Be(content);
  }
  return new TextDecoder("windows-1252")
    .decode(content)
    .replaceAll("\0", "")
    .trim();
}

function readFontName(
  content: Uint8Array,
  table: SfntTable,
  nameIds: readonly number[]
) {
  if (table.length < 6) {
    throw new Error("字体 name 表不完整");
  }
  const view = new DataView(
    content.buffer,
    content.byteOffset,
    content.byteLength
  );
  const count = readUint16(
    view,
    content,
    table.offset + 2,
    "name 记录数量"
  );
  const stringsOffset = readUint16(
    view,
    content,
    table.offset + 4,
    "name 字符串偏移"
  );
  assertRange(content, table.offset + 6, count * 12, "name 记录");

  const candidates: Array<{
    value: string;
    priority: number;
  }> = [];
  for (let index = 0; index < count; index += 1) {
    const offset = table.offset + 6 + index * 12;
    const platformId = readUint16(
      view,
      content,
      offset,
      "name platformID"
    );
    const languageId = readUint16(
      view,
      content,
      offset + 4,
      "name languageID"
    );
    const nameId = readUint16(
      view,
      content,
      offset + 6,
      "name nameID"
    );
    const requestedIndex = nameIds.indexOf(nameId);
    if (requestedIndex < 0) {
      continue;
    }
    const length = readUint16(
      view,
      content,
      offset + 8,
      "name 字符串长度"
    );
    const relativeOffset = readUint16(
      view,
      content,
      offset + 10,
      "name 字符串位置"
    );
    const valueOffset =
      table.offset + stringsOffset + relativeOffset;
    assertRange(content, valueOffset, length, "name 字符串");
    const value = decodeName(
      content.subarray(valueOffset, valueOffset + length),
      platformId
    );
    if (!value) {
      continue;
    }
    const platformPriority =
      platformId === 3 ? 30 : platformId === 0 ? 20 : 10;
    const languagePriority =
      languageId === 0x0409 ? 2 : languageId === 0 ? 1 : 0;
    candidates.push({
      value,
      priority:
        (nameIds.length - requestedIndex) * 100 +
        platformPriority +
        languagePriority
    });
  }

  return candidates.sort(
    (left, right) => right.priority - left.priority
  )[0]?.value;
}

export function resolveFontEmbeddingPermission(fsType: number) {
  if (
    !Number.isInteger(fsType) ||
    fsType < 0 ||
    fsType > 0xffff
  ) {
    throw new Error("字体 fsType 无效");
  }
  if ((fsType & 0xfef0) !== 0) {
    throw new Error(
      `字体 fsType 包含不支持的保留或位图嵌入标志：0x${fsType
        .toString(16)
        .padStart(4, "0")}`
    );
  }

  const usage = fsType & 0x000f;
  if (usage === 0) {
    return "installable" satisfies DocxFontEmbeddingPermission;
  }
  if (usage === 0x0008) {
    return "editable" satisfies DocxFontEmbeddingPermission;
  }
  if (usage === 0x0002) {
    throw new Error("字体许可证禁止嵌入");
  }
  if (usage === 0x0004) {
    throw new Error("字体仅允许预览和打印嵌入，不能用于可编辑 DOCX");
  }
  throw new Error(
    `字体 fsType 使用权限组合无效：0x${usage
      .toString(16)
      .padStart(4, "0")}`
  );
}

export function readSfntFontMetadata(
  content: Uint8Array
): SfntFontMetadata {
  const { signature, tables, view } = readSfntTables(content);
  const os2 = tables.get("OS/2");
  const name = tables.get("name");
  const post = tables.get("post");
  if (!os2 || os2.length < 68) {
    throw new Error("SFNT 字体缺少完整 OS/2 表");
  }
  if (!name) {
    throw new Error("SFNT 字体缺少 name 表");
  }
  if (post && post.length < 16) {
    throw new Error("SFNT 字体 post 表不完整");
  }

  const family = readFontName(content, name, [16, 1]);
  const subfamily = readFontName(content, name, [17, 2]);
  if (!family || !subfamily) {
    throw new Error("SFNT 字体缺少家族或字形面名称");
  }
  const fsType = readUint16(
    view,
    content,
    os2.offset + 8,
    "OS/2 fsType"
  );
  const permission = resolveFontEmbeddingPermission(fsType);
  const postscriptName = readFontName(content, name, [6]);
  const panose = Array.from(
    content.subarray(os2.offset + 32, os2.offset + 42)
  ) as unknown as SfntFontMetadata["panose"];
  const unicodeRanges = [
    readUint32(
      view,
      content,
      os2.offset + 42,
      "OS/2 ulUnicodeRange1"
    ),
    readUint32(
      view,
      content,
      os2.offset + 46,
      "OS/2 ulUnicodeRange2"
    ),
    readUint32(
      view,
      content,
      os2.offset + 50,
      "OS/2 ulUnicodeRange3"
    ),
    readUint32(
      view,
      content,
      os2.offset + 54,
      "OS/2 ulUnicodeRange4"
    )
  ] as const;
  const codePageRanges =
    os2.length >= 86
      ? ([
          readUint32(
            view,
            content,
            os2.offset + 78,
            "OS/2 ulCodePageRange1"
          ),
          readUint32(
            view,
            content,
            os2.offset + 82,
            "OS/2 ulCodePageRange2"
          )
        ] as const)
      : ([0, 0] as const);

  return {
    family,
    subfamily,
    ...(postscriptName ? { postscriptName } : {}),
    weightClass: readUint16(
      view,
      content,
      os2.offset + 4,
      "OS/2 usWeightClass"
    ),
    panose,
    unicodeRanges,
    codePageRanges,
    fixedPitch:
      post === undefined
        ? false
        : readUint32(
              view,
              content,
              post.offset + 12,
              "post isFixedPitch"
            ) !== 0,
    fsType,
    permission,
    noSubsetting: (fsType & 0x0100) !== 0,
    signature
  };
}

export async function prepareDocxFont(
  source: DocxFontSource
): Promise<PreparedDocxFont> {
  if (
    source.content.byteLength < 32 ||
    source.content.byteLength > MAXIMUM_DOCX_FONT_SOURCE_BYTES
  ) {
    throw new Error(`字体资源大小无效：${source.source}`);
  }
  const sourceFingerprint = createHash("sha256")
    .update(source.content)
    .digest("hex");
  let conversion = fontConversionCache.get(sourceFingerprint);
  if (!conversion) {
    if (
      fontConversionCache.size >=
      MAXIMUM_FONT_CONVERSION_CACHE_ENTRIES
    ) {
      const oldest = fontConversionCache.keys().next().value;
      if (oldest !== undefined) {
        fontConversionCache.delete(oldest);
      }
    }
    const sourceContent = Buffer.from(source.content);
    conversion = fontConversionQueue
      .then(() => fontverter.convert(sourceContent, "sfnt"))
      .then((converted) => {
        if (
          converted.byteLength < 32 ||
          converted.byteLength > MAXIMUM_DOCX_FONT_SFNT_BYTES
        ) {
          throw new Error(
            `字体解码后大小超过限制：${source.source}`
          );
        }
        return new Uint8Array(converted);
      });
    fontConversionQueue = conversion.then(
      () => undefined,
      () => undefined
    );
    fontConversionCache.set(sourceFingerprint, conversion);
    void conversion.catch(() => {
      if (
        fontConversionCache.get(sourceFingerprint) === conversion
      ) {
        fontConversionCache.delete(sourceFingerprint);
      }
    });
  }
  const sfnt = (await conversion).slice();
  normalizeSfntWeightClass(sfnt, source.weight);
  const metadata = readSfntFontMetadata(sfnt);
  if (metadata.weightClass !== source.weight) {
    throw new Error(
      `字体内部权重 ${metadata.weightClass} 与声明权重 ${source.weight} 不一致`
    );
  }
  const fingerprint = createHash("sha256")
    .update(sfnt)
    .digest("hex");
  return {
    source,
    metadata,
    sfnt,
    fingerprint
  };
}

export async function prepareDocxFonts(
  sources: readonly DocxFontSource[]
) {
  if (sources.length > MAXIMUM_DOCX_FONT_FACE_COUNT) {
    throw new Error("DOCX 字体字形面数量超过限制");
  }
  const totalSourceBytes = sources.reduce(
    (total, source) => total + source.content.byteLength,
    0
  );
  if (totalSourceBytes > MAXIMUM_DOCX_FONT_TOTAL_SOURCE_BYTES) {
    throw new Error("DOCX 字体资源总大小超过限制");
  }
  const fonts = await Promise.all(sources.map(prepareDocxFont));
  const totalSfntBytes = fonts.reduce(
    (total, font) => total + font.sfnt.byteLength,
    0
  );
  if (totalSfntBytes > MAXIMUM_DOCX_FONT_TOTAL_SFNT_BYTES) {
    throw new Error("DOCX 字体解码后总大小超过限制");
  }
  return fonts;
}

function formatGuid(bytes: Uint8Array) {
  const hex = Buffer.from(bytes).toString("hex").toUpperCase();
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16
  )}-${hex.slice(16, 20)}-${hex.slice(20)}}`;
}

function fontKeyBytes(fontKey: string) {
  const hex = fontKey.replace(/[{}-]/gu, "");
  if (!/^[0-9a-f]{32}$/iu.test(hex)) {
    throw new Error("DOCX 字体混淆键无效");
  }
  return Uint8Array.from(
    Array.from({ length: 16 }, (_, index) =>
      Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
    )
  ).reverse();
}

export function xorDocxFont(
  content: Uint8Array,
  fontKey: string
) {
  if (content.byteLength < 32) {
    throw new Error("待混淆字体内容不足 32 字节");
  }
  const result = content.slice();
  const key = fontKeyBytes(fontKey);
  for (let index = 0; index < 32; index += 1) {
    result[index] =
      (result[index] ?? 0) ^ (key[index % key.length] ?? 0);
  }
  return result;
}

export function obfuscateDocxFont(
  font: PreparedDocxFont
): ObfuscatedDocxFont {
  const keyBytes = createHash("sha256")
    .update(font.sfnt)
    .update("\0", "utf8")
    .update(font.source.family, "utf8")
    .update("\0", "utf8")
    .update(String(font.source.weight), "utf8")
    .update("\0", "utf8")
    .update(font.source.style, "utf8")
    .digest()
    .subarray(0, 16);
  keyBytes[6] = ((keyBytes[6] ?? 0) & 0x0f) | 0x40;
  keyBytes[8] = ((keyBytes[8] ?? 0) & 0x3f) | 0x80;
  const fontKey = formatGuid(keyBytes);
  const partStem = fontKey.slice(1, -1).toLowerCase();
  return {
    content: xorDocxFont(font.sfnt, fontKey),
    fontKey,
    partName: `word/fonts/${partStem}.odttf`
  };
}
