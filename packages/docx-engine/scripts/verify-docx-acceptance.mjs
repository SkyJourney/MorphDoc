import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOCX_PANDOC_VERSION,
  defaultExportConfig,
  themeManifestSchema
} from "@morphdoc/core";
import {
  PandocDocxConverter,
  PandocRuntime,
  createDocxMediaAcceptanceExpectation,
  inspectDocxAcceptance,
  resolveReferencePageOptions
} from "@morphdoc/docx-engine";
import { DOCX_STYLE_SLOT_NAMES } from "@morphdoc/docx-theme-engine";

const directory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(directory, "..");
const repositoryDirectory = path.resolve(packageDirectory, "../..");
const outputDirectory = path.join(
  repositoryDirectory,
  "output",
  "docx-acceptance"
);
const markdown = fs.readFileSync(
  path.join(packageDirectory, "fixtures", "docx-acceptance.md"),
  "utf8"
);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function loadTheme(id) {
  return themeManifestSchema.parse(
    JSON.parse(
      fs.readFileSync(
        path.join(repositoryDirectory, "themes", id, "theme.json"),
        "utf8"
      )
    )
  );
}

function mediaResource(kind, ordinal, dimensions, altText, caption) {
  return {
    id: `docx-media-${ordinal}`,
    kind,
    ordinal,
    kindOrdinal: 1,
    altText,
    ...(caption ? { caption } : {}),
    alignment: "center",
    displayWidthPx: dimensions.width,
    displayHeightPx: dimensions.height,
    captureX: 0,
    captureY: 0,
    captureWidthPx: dimensions.width,
    captureHeightPx: dimensions.height,
    rasterScale: 1,
    fileName: `${kind}-${ordinal}.png`,
    contentType: "image/png",
    content: png,
    pixelWidth: 1,
    pixelHeight: 1
  };
}

function createMedia() {
  const resources = [
    mediaResource(
      "image",
      1,
      { width: 384, height: 192 },
      "普通图片"
    ),
    mediaResource(
      "mermaid",
      2,
      { width: 480, height: 240 },
      "Mermaid 流程图",
      "Mermaid 流程图"
    ),
    mediaResource(
      "echarts",
      3,
      { width: 576, height: 288 },
      "ECharts 柱状图",
      "ECharts 柱状图"
    )
  ];
  return {
    resources,
    echartsErrors: [],
    mermaidErrors: [],
    warnings: [],
    totalBytes: png.byteLength * resources.length
  };
}

function createThemeTokens(theme) {
  return {
    schemaVersion: 1,
    themeId: theme.id,
    themeFingerprint: "c".repeat(64),
    mode: "auto-with-overrides",
    basePreset: theme.docxStyle?.preset ?? "general",
    slots: DOCX_STYLE_SLOT_NAMES.map((slot) => ({
      slot,
      source: "preset-fallback",
      confidence: "fallback",
      style: { fontCandidates: [] }
    })),
    diagnostics: []
  };
}

const technicalTheme = loadTheme("typora-like");
const officialTheme = loadTheme("gov-red-standard");
const coverTheme = loadTheme("formal-feasibility");
const semanticDocument = {
  schemaVersion: 1,
  titlePolicy: {
    metadataTitle: "emit",
    firstBodyHeading: "keep"
  },
  regions: []
};
const coverSemanticDocument = {
  schemaVersion: 1,
  profile: "project-report",
  titlePolicy: {
    metadataTitle: "suppress",
    firstBodyHeading: "keep"
  },
  regions: [
    {
      kind: "cover",
      nodes: [
        {
          kind: "group",
          role: "project-report-cover",
          children: [
            {
              kind: "text",
              role: "project-report-project-name",
              text: "智慧园区建设项目"
            },
            {
              kind: "text",
              role: "project-report-title",
              text: "可行性研究报告"
            },
            {
              kind: "text",
              role: "project-report-owner",
              label: "建设单位：",
              text: "示例建设集团"
            }
          ]
        }
      ],
      section: {
        headerFooter: "none",
        pageNumber: "hidden",
        breakAfter: "next-page",
        followingPageNumberStart: 1
      }
    }
  ]
};
const commonExpectation = {
  requiredText: [
    "可编辑的中文正文",
    "原生表格与单元格",
    "editableDocument",
    "正文没有通过"
  ],
  minimumParagraphs: 18,
  minimumTextRuns: 24,
  minimumTables: 1,
  minimumNumberedParagraphs: 6,
  minimumHyperlinks: 1,
  minimumFootnoteReferences: 1,
  minimumMathObjects: 2,
  minimumDrawings: 3,
  minimumPngImages: 1,
  requiredImageAltText: [
    "普通图片",
    "Mermaid 流程图",
    "ECharts 柱状图"
  ],
  requiredStyleIds: [
    "Normal",
    "Heading1",
    "Heading2",
    "Heading3",
    "SourceCode",
    "Table",
    "Caption"
  ],
  requirePageField: true
};

const technicalA4Config = {
  ...defaultExportConfig,
  name: "技术文档 A4 纵向验收",
  themeId: technicalTheme.id,
  pageDecorationsMode: "custom",
  paper: {
    ...defaultExportConfig.paper,
    format: "A4",
    orientation: "portrait",
    marginMode: "custom",
    margins: {
      top: "16mm",
      right: "16mm",
      bottom: "16mm",
      left: "16mm"
    }
  }
};
const officialA4Config = {
  ...defaultExportConfig,
  name: "公文 A4 纵向验收",
  themeId: officialTheme.id,
  pageDecorationsMode: "theme",
  paper: {
    ...defaultExportConfig.paper,
    format: "A4",
    orientation: "portrait",
    marginMode: "theme"
  }
};
const landscapeLetterConfig = {
  ...defaultExportConfig,
  name: "技术文档 Letter 横向验收",
  themeId: technicalTheme.id,
  pageDecorationsMode: "custom",
  paper: {
    ...defaultExportConfig.paper,
    format: "Letter",
    orientation: "landscape",
    marginMode: "custom",
    margins: {
      top: "20mm",
      right: "18mm",
      bottom: "22mm",
      left: "24mm"
    }
  },
  header: {
    ...defaultExportConfig.header,
    enabled: true,
    left: {
      enabled: true,
      content: "${title}"
    },
    right: {
      enabled: true,
      content: "${filename}"
    }
  },
  footer: {
    ...defaultExportConfig.footer,
    alignment: "right",
    format: "page-total",
    startFrom: 3
  }
};
const coverA4Config = {
  ...defaultExportConfig,
  name: "可研封面 A4 纵向验收",
  themeId: coverTheme.id,
  pageDecorationsMode: "theme",
  paper: {
    ...defaultExportConfig.paper,
    format: "A4",
    orientation: "portrait",
    marginMode: "theme"
  }
};

const variants = [
  {
    id: "technical-a4-portrait",
    theme: technicalTheme,
    exportConfig: technicalA4Config,
    expectation: {
      ...commonExpectation,
      id: "technical-a4-portrait",
      page: {
        widthTwips: 11906,
        heightTwips: 16838,
        orientation: "portrait",
        marginsTwips: {
          top: 907,
          right: 907,
          bottom: 907,
          left: 907
        }
      }
    }
  },
  {
    id: "official-a4-portrait",
    theme: officialTheme,
    exportConfig: officialA4Config,
    expectation: {
      ...commonExpectation,
      id: "official-a4-portrait",
      page: {
        widthTwips: 11906,
        heightTwips: 16838,
        orientation: "portrait",
        marginsTwips: {
          top: 2098,
          right: 1474,
          bottom: 1984,
          left: 1587
        }
      }
    }
  },
  {
    id: "technical-letter-landscape",
    theme: technicalTheme,
    exportConfig: landscapeLetterConfig,
    expectation: {
      ...commonExpectation,
      id: "technical-letter-landscape",
      page: {
        widthTwips: 15817,
        heightTwips: 12246,
        orientation: "landscape",
        marginsTwips: {
          top: 1134,
          right: 1020,
          bottom: 1247,
          left: 1361
        }
      }
    }
  },
  {
    id: "project-cover-a4-portrait",
    theme: coverTheme,
    exportConfig: coverA4Config,
    semanticDocument: coverSemanticDocument,
    expectation: {
      ...commonExpectation,
      id: "project-cover-a4-portrait",
      requiredText: [
        ...commonExpectation.requiredText,
        "智慧园区建设项目",
        "可行性研究报告"
      ],
      page: {
        widthTwips: 11906,
        heightTwips: 16838,
        orientation: "portrait",
        marginsTwips: {
          top: 1417,
          right: 1134,
          bottom: 1417,
          left: 1701
        }
      },
      minimumSections: 2,
      requireFirstSectionWithoutHeaderFooter: true,
      finalPageNumberStart: 1,
      requireSectionPagesField: true,
      requiredParagraphStyleIds: [
        "MdProjectReportProjectName",
        "MdProjectReportTitle",
        "MdProjectReportOwner"
      ]
    }
  }
];

const runtime = new PandocRuntime(
  process.env.DOCX_PANDOC_PATH?.trim()
    ? { configuredPath: process.env.DOCX_PANDOC_PATH.trim() }
    : {}
);
const capability = await runtime.probe();
if (capability.capability.status !== "available") {
  throw new Error(capability.capability.message);
}
if (
  capability.capability.detectedVersion !== DOCX_PANDOC_VERSION
) {
  throw new Error(
    `Pandoc 版本不匹配：期望 ${DOCX_PANDOC_VERSION}，实际 ${capability.capability.detectedVersion}`
  );
}
const converter = new PandocDocxConverter({ runtime });
fs.mkdirSync(outputDirectory, { recursive: true });

const results = [];
for (const variant of variants) {
  const variantSemanticDocument =
    variant.semanticDocument ?? semanticDocument;
  const fileName = `${variant.id}.md`;
  const metadata = {
    title: "v0.6.0 DOCX 自动验收",
    author: "墨呈研发组",
    subject: "Word 与 WPS 可编辑性验收",
    keywords: ["DOCX", "Pandoc", "OOXML"],
    language: "zh-CN"
  };
  const resolvedPage = resolveReferencePageOptions({
    exportConfig: variant.exportConfig,
    theme: variant.theme,
    fileName,
    metadata
  });
  const media = createMedia();
  const result = await converter.convert({
    markdown,
    fileName,
    language: "zh-CN",
    exportConfig: variant.exportConfig,
    theme: variant.theme,
    themeTokens: createThemeTokens(variant.theme),
    fonts: [],
    metadata,
    semanticDocument: variantSemanticDocument,
    media
  });
  const report = inspectDocxAcceptance(
    result.docx,
    {
      ...variant.expectation,
      media: createDocxMediaAcceptanceExpectation(
        media,
        variant.expectation.page
      ),
      pageDecorations: {
        exportConfig: {
          header: resolvedPage.header,
          footer: resolvedPage.footer
        },
        semanticDocument: variantSemanticDocument
      }
    }
  );
  const outputPath = path.join(outputDirectory, `${variant.id}.docx`);
  fs.writeFileSync(outputPath, result.docx);
  results.push({
    id: variant.id,
    themeId: variant.theme.id,
    outputFile: path.relative(repositoryDirectory, outputPath),
    bytes: result.docx.byteLength,
    templateFingerprint: result.templateFingerprint,
    templateCacheKey: result.templateCacheKey,
    conversionValidation: result.validation,
    conversionTimings: result.timings,
    acceptance: report
  });
}

const acceptanceReport = {
  generatedAt: new Date().toISOString(),
  pandocVersion: capability.capability.detectedVersion,
  fixture: path.relative(
    repositoryDirectory,
    path.join(packageDirectory, "fixtures", "docx-acceptance.md")
  ),
  variants: results
};
const reportPath = path.join(outputDirectory, "acceptance-report.json");
fs.writeFileSync(
  reportPath,
  `${JSON.stringify(acceptanceReport, null, 2)}\n`,
  "utf8"
);
console.log(JSON.stringify(acceptanceReport, null, 2));
