import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOCX_PANDOC_VERSION,
  defaultExportConfig,
  themeManifestSchema
} from "@morphdoc/core";
import {
  createDynamicReferenceDocx,
  PandocRuntime,
  validateGeneratedDocx
} from "@morphdoc/docx-engine";
import { unzipSync } from "fflate";

const directory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(directory, "..");
const repositoryDirectory = path.resolve(packageDirectory, "../..");
const fixturePath = path.join(
  packageDirectory,
  "fixtures",
  "pandoc-reference.md"
);
const themePath = path.join(
  repositoryDirectory,
  "themes",
  "gov-red-standard",
  "theme.json"
);
const runtime = new PandocRuntime(
  process.env.DOCX_PANDOC_PATH?.trim()
    ? { configuredPath: process.env.DOCX_PANDOC_PATH.trim() }
    : {}
);
const runtimeResolution = await runtime.probe();
assert(
  runtimeResolution.capability.status === "available",
  runtimeResolution.capability.status === "available"
    ? ""
    : runtimeResolution.capability.message
);
const pandocExecutable = await runtime.getExecutablePath();
const maximumBuffer = 128 * 1024 * 1024;
const decoder = new TextDecoder();

function runPandoc(arguments_, options = {}) {
  const result = spawnSync(pandocExecutable, arguments_, {
    encoding: options.binary ? null : "utf8",
    maxBuffer: maximumBuffer,
    ...options
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : result.stderr;
    throw new Error(
      stderr?.trim() || `Pandoc 退出码 ${String(result.status)}`
    );
  }
  return result;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function countMatches(value, pattern) {
  return value.match(pattern)?.length ?? 0;
}

function inspectResult(content, expected) {
  const validation = validateGeneratedDocx(content);
  const entries = unzipSync(content);
  const documentXml = decoder.decode(entries["word/document.xml"]);
  const stylesXml = decoder.decode(entries["word/styles.xml"]);
  const settingsXml = decoder.decode(entries["word/settings.xml"]);
  const relationshipsXml = decoder.decode(
    entries["word/_rels/document.xml.rels"]
  );
  const bodyIsEditable =
    documentXml.includes("可编辑的中文正文") &&
    documentXml.includes("<w:tbl") &&
    documentXml.includes("editableDocument");
  const checks = {
    pageWidth: documentXml.includes(`w:w="${expected.pageWidth}"`),
    pageHeight: documentXml.includes(`w:h="${expected.pageHeight}"`),
    orientation:
      expected.orientation === "portrait"
        ? !documentXml.includes('w:orient="landscape"')
        : documentXml.includes('w:orient="landscape"'),
    leftMargin: documentXml.includes(`w:left="${expected.leftMargin}"`),
    sourceCodeStyle: stylesXml.includes('w:styleId="SourceCode"'),
    chineseBodyFont: stylesXml.includes('w:eastAsia="SimSun"'),
    editableBody: bodyIsEditable,
    headerReferences:
      countMatches(documentXml, /w:headerReference/gu) ===
      expected.headerCount,
    footerReferences:
      countMatches(documentXml, /w:footerReference/gu) ===
      expected.footerCount,
    pageField: Object.entries(entries)
      .filter(([name]) => /^word\/footer\d+\.xml$/u.test(name))
      .some(([, value]) =>
        decoder.decode(value).includes(" PAGE \\* MERGEFORMAT ")
      ),
    headerRelationship:
      expected.headerCount === 0 ||
      relationshipsXml.includes("relationships/header"),
    footerRelationship:
      expected.footerCount === 0 ||
      relationshipsXml.includes("relationships/footer"),
    evenOddSetting:
      expected.usesEvenAndOddPages ===
      settingsXml.includes("<w:evenAndOddHeaders")
  };
  for (const [name, passed] of Object.entries(checks)) {
    assert(passed, `${expected.id} 的语义检查失败：${name}`);
  }
  assert(
    validation.headerCount === expected.headerCount,
    `${expected.id} 的页眉部件数量不正确`
  );
  assert(
    validation.footerCount === expected.footerCount,
    `${expected.id} 的页脚部件数量不正确`
  );
  return { validation, checks };
}

function createVariant(
  temporaryDirectory,
  baseline,
  theme,
  markdown,
  variant
) {
  const reference = createDynamicReferenceDocx(baseline, {
    exportConfig: variant.exportConfig,
    theme,
    fileName: `${variant.id}.md`,
    metadata: {
      title: "阶段六动态模板验收",
      author: "墨呈研发组"
    }
  });
  const referencePath = path.join(
    temporaryDirectory,
    `${variant.id}-reference.docx`
  );
  const markdownPath = path.join(
    temporaryDirectory,
    `${variant.id}.md`
  );
  const resultPath = path.join(
    temporaryDirectory,
    `${variant.id}-result.docx`
  );
  fs.writeFileSync(referencePath, reference.content);
  fs.writeFileSync(markdownPath, markdown);
  runPandoc([
    markdownPath,
    "--from",
    "markdown",
    "--to",
    "docx",
    "--reference-doc",
    referencePath,
    "--output",
    resultPath
  ]);
  const result = fs.readFileSync(resultPath);
  return {
    id: variant.id,
    referenceBytes: reference.content.byteLength,
    resultBytes: result.byteLength,
    templateFingerprint: reference.templateFingerprint,
    cacheKey: reference.cacheKey,
    ...inspectResult(result, variant.expected)
  };
}

const detectedVersion = runtimeResolution.capability.detectedVersion;
assert(
  detectedVersion === DOCX_PANDOC_VERSION,
  `Pandoc 版本不匹配：期望 ${DOCX_PANDOC_VERSION}，实际 ${detectedVersion || "未知"}`
);

const baseline = await runtime.getDefaultReferenceDocx();
const theme = themeManifestSchema.parse(
  JSON.parse(fs.readFileSync(themePath, "utf8"))
);
const markdown = fs.readFileSync(fixturePath, "utf8");
const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "morphdoc-docx-reference-")
);

const customConfig = {
  ...defaultExportConfig,
  name: "DOCX 横向验收",
  pageDecorationsMode: "custom",
  paper: {
    ...defaultExportConfig.paper,
    orientation: "landscape",
    marginMode: "custom",
    margins: {
      top: "20mm",
      right: "25mm",
      bottom: "22mm",
      left: "30mm"
    }
  },
  header: {
    ...defaultExportConfig.header,
    enabled: true,
    showDivider: true,
    left: {
      enabled: true,
      content: "${title}"
    },
    center: {
      enabled: true,
      content: "${author}"
    },
    right: {
      enabled: true,
      content: "${filename}"
    }
  },
  footer: {
    ...defaultExportConfig.footer,
    alignment: "outer",
    format: "chinese-page-total",
    startFrom: 5,
    showOnFirstPage: false
  }
};

const variants = [
  {
    id: "official-a4",
    exportConfig: defaultExportConfig,
    expected: {
      id: "official-a4",
      pageWidth: 11906,
      pageHeight: 16838,
      orientation: "portrait",
      leftMargin: 1587,
      headerCount: 0,
      footerCount: 2,
      usesEvenAndOddPages: true
    }
  },
  {
    id: "custom-landscape",
    exportConfig: customConfig,
    expected: {
      id: "custom-landscape",
      pageWidth: 16838,
      pageHeight: 11906,
      orientation: "landscape",
      leftMargin: 1701,
      headerCount: 3,
      footerCount: 3,
      usesEvenAndOddPages: true
    }
  }
];

try {
  const results = variants.map((variant) =>
    createVariant(
      temporaryDirectory,
      baseline,
      theme,
      markdown,
      variant
    )
  );
  console.log(
    JSON.stringify(
      {
        pandocVersion: detectedVersion,
        baselineBytes: baseline.byteLength,
        variants: results
      },
      null,
      2
    )
  );
} finally {
  fs.rmSync(temporaryDirectory, {
    recursive: true,
    force: true
  });
}
