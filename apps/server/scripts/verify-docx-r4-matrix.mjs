import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultExportConfig, themeManifestSchema } from "@morphdoc/core";
import { unzipSync } from "fflate";
import matter from "gray-matter";
import { buildApp } from "../dist/app.js";
import { createDocxMediaEngine } from "../dist/docx-media-engine.js";
import { createPdfGenerator } from "../dist/pdf-engine.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(directory, "../../..");
const appVersion = JSON.parse(
  fs.readFileSync(path.join(repositoryDirectory, "package.json"), "utf8")
).version;
const themesDirectory = path.join(repositoryDirectory, "themes");
const samplesDirectory = path.join(repositoryDirectory, "samples", "themes");
const webDirectory = path.join(repositoryDirectory, "apps", "web", "dist");
const outputDirectory = path.resolve(
  process.env.MORPHDOC_R4_OUTPUT_DIR?.trim() ||
    path.join(repositoryDirectory, "output", "docx-r4")
);
const pdfDirectory = path.join(outputDirectory, "chromium-pdf");
const docxDirectory = path.join(outputDirectory, "docx");
const standardReportPath = path.join(
  repositoryDirectory,
  "output",
  "docx-theme-matrix",
  "theme-matrix-report.json"
);
const fontPackRoot = path.resolve(
  process.env.MORPHDOC_FONT_PACK_DIR?.trim() ||
    path.join(repositoryDirectory, "output", "font-packs", "root")
);
const decoder = new TextDecoder();

function writeArtifactWithBusyFallback(filePath, content) {
  try {
    fs.writeFileSync(filePath, content);
    return filePath;
  } catch (error) {
    if (error?.code !== "EBUSY") {
      throw error;
    }
    const extension = path.extname(filePath);
    const fallbackPath = path.join(
      path.dirname(filePath),
      `${path.basename(filePath, extension)}-attempt-${randomUUID()}${extension}`
    );
    fs.writeFileSync(fallbackPath, content);
    process.stderr.write(
      `[DOCX R4 matrix] 既有产物被 Office 锁定，改写本次尝试文件：${path.basename(fallbackPath)}\n`
    );
    return fallbackPath;
  }
}

const inlineCodeContinuityProbes = [
  {
    id: "paragraph",
    code: "morphdoc_ic_p",
    text: "段落前morphdoc_ic_p段落后"
  },
  {
    id: "list-item",
    code: "morphdoc_ic_l",
    text: "列表前morphdoc_ic_l列表后"
  },
  {
    id: "table-cell",
    code: "morphdoc_ic_c",
    text: "单元格前morphdoc_ic_c单元格后"
  }
];

const inlineCodeContinuityMarkdown = `

## 行内代码连续性门禁

段落前\`morphdoc_ic_p\`段落后

- 列表前\`morphdoc_ic_l\`列表后

| 门禁 | 内容 | 邻接单元格 |
| --- | --- | --- |
| 行内代码 | 单元格前\`morphdoc_ic_c\`单元格后 | 邻甲<br>邻乙 |
| 相邻隔离 | 旁甲<br/>旁乙 | 附甲 |

| 场景 | 内容 |
| --- | --- |
| 壹式 | 标甲<br>标乙<br/>标丙<br />标丁 |
| 贰式 | 大甲<BR>大乙<BR/>大丙<BR />大丁 |
| 叁式 | 连甲<br><br>连乙 |
| 肆式 | <br>边界<br> |
| 伍式 | 转甲\\<br>转乙 &lt;br&gt; 转丙 |
| 陆式 | 属甲<br class="unsafe">属乙 |
| 柒式 | 码甲\`<br>\`码乙 |

表格外保留 外一<br>外二 原文。

\`\`\`html
围一<br>围二
\`\`\`
`;

const docxBreakParagraphProbes = [
  {
    id: "basic",
    marker: "标甲",
    expectedText: "标甲标乙标丙标丁",
    hardBreakCount: 3
  },
  {
    id: "case-insensitive",
    marker: "大甲",
    expectedText: "大甲大乙大丙大丁",
    hardBreakCount: 3
  },
  {
    id: "multiple",
    marker: "连甲",
    expectedText: "连甲连乙",
    hardBreakCount: 2
  },
  {
    id: "boundary",
    marker: "边界",
    expectedText: "边界",
    hardBreakCount: 2
  },
  {
    id: "adjacent-a",
    marker: "邻乙",
    expectedText: "邻甲邻乙",
    hardBreakCount: 1
  },
  {
    id: "adjacent-b",
    marker: "旁乙",
    expectedText: "旁甲旁乙",
    hardBreakCount: 1
  },
  {
    id: "escaped-and-entity",
    marker: "转甲",
    expectedText: "转甲&lt;br&gt;转乙 &lt;br&gt; 转丙",
    hardBreakCount: 0
  },
  {
    id: "attribute",
    marker: "属甲",
    expectedText: "属甲&lt;br class=\"unsafe\"&gt;属乙",
    hardBreakCount: 0
  },
  {
    id: "inline-code",
    marker: "码甲",
    expectedText: "码甲&lt;br&gt;码乙",
    hardBreakCount: 0,
    requiredCharacterStyle: "VerbatimChar"
  },
  {
    id: "outside-table",
    marker: "外一",
    expectedText: "表格外保留 外一&lt;br&gt;外二 原文。",
    hardBreakCount: 0
  },
  {
    id: "fenced-code",
    marker: "围一",
    expectedText: "围一&lt;br&gt;围二",
    hardBreakCount: 0,
    requiredParagraphStyle: "SourceCode"
  }
];

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"]
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function newestModifiedAt(targetPath) {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return stat.mtimeMs;
  }
  return fs.readdirSync(targetPath, { withFileTypes: true }).reduce(
    (newest, entry) =>
      Math.max(
        newest,
        newestModifiedAt(path.join(targetPath, entry.name))
      ),
    stat.mtimeMs
  );
}

function assertFreshArtifact(label, sourcePaths, artifactPath) {
  assert(fs.existsSync(artifactPath), `${label} 构建产物不存在：${artifactPath}`);
  const newestSource = Math.max(...sourcePaths.map(newestModifiedAt));
  const artifactModifiedAt = fs.statSync(artifactPath).mtimeMs;
  assert(
    artifactModifiedAt + 1_500 >= newestSource,
    `${label} 构建产物早于源码；请按依赖顺序重新构建后再执行门禁`
  );
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readExportConfigOverride() {
  const source = process.env.MORPHDOC_R4_EXPORT_CONFIG_JSON?.trim();
  if (!source) {
    return undefined;
  }
  const parsed = JSON.parse(source);
  assert(
    parsed && typeof parsed === "object" && !Array.isArray(parsed),
    "R4 导出配置覆盖必须是 JSON 对象"
  );
  return parsed;
}

function mergeExportConfig(base, override) {
  if (!override) {
    return base;
  }
  return {
    ...base,
    ...override,
    mermaid: { ...base.mermaid, ...override.mermaid },
    paper: {
      ...base.paper,
      ...override.paper,
      margins: { ...base.paper.margins, ...override.paper?.margins }
    },
    header: {
      ...base.header,
      ...override.header,
      left: { ...base.header.left, ...override.header?.left },
      center: { ...base.header.center, ...override.header?.center },
      right: { ...base.header.right, ...override.header?.right }
    },
    footer: { ...base.footer, ...override.footer },
    metadata: { ...base.metadata, ...override.metadata },
    print: { ...base.print, ...override.print }
  };
}

function readThemes() {
  return fs
    .readdirSync(themesDirectory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(themesDirectory, entry.name, "theme.json"))
    )
    .map((entry) =>
      themeManifestSchema.parse(
        readJson(path.join(themesDirectory, entry.name, "theme.json"))
      )
    )
    .sort((first, second) => first.id.localeCompare(second.id, "en"));
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address ? address.port : undefined;
      server.close((error) =>
        error || !port
          ? reject(error ?? new Error("无法分配 R4 验收端口"))
          : resolve(port)
      );
    });
  });
}

function resolveWebFile(relativePath) {
  const resolved = path.resolve(webDirectory, relativePath);
  const relative = path.relative(webDirectory, resolved);
  assert(
    relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
    `Web 资源路径越界：${relativePath}`
  );
  return resolved;
}

function registerWebRuntime(app) {
  app.get("/preview-frame.html", async (_request, reply) => {
    const content = fs.readFileSync(resolveWebFile("preview-frame.html"));
    return reply.type("text/html; charset=utf-8").send(content);
  });
  app.get("/assets/*", async (request, reply) => {
    const relativePath = String(request.params["*"] ?? "");
    const filePath = resolveWebFile(path.join("assets", relativePath));
    const stat = fs.statSync(filePath);
    assert(stat.isFile(), `Web 资源不是普通文件：${relativePath}`);
    return reply
      .type(
        contentTypes.get(path.extname(filePath).toLowerCase()) ||
          "application/octet-stream"
      )
      .send(fs.readFileSync(filePath));
  });
}

function inspectDocx(content) {
  const entries = unzipSync(content);
  const documentXml = decoder.decode(entries["word/document.xml"]);
  const stylesXml = decoder.decode(entries["word/styles.xml"]);
  const fontTableXml = decoder.decode(entries["word/fontTable.xml"]);
  const fontParts = Object.keys(entries).filter((name) =>
    name.startsWith("word/fonts/")
  );
  const fontNames = [
    ...fontTableXml.matchAll(/<w:font\s+w:name="([^"]+)"/gu)
  ].map((match) => match[1]);
  const embeddedFontNames = [
    ...fontTableXml.matchAll(/<w:font\s+w:name="([^"]+)"[\s\S]*?<\/w:font>/gu)
  ].flatMap((match) => /<w:embed(?:Regular|Bold|Italic|BoldItalic)\b/u.test(match[0])
    ? [match[1]]
    : []);
  const paragraphs = [
    ...documentXml.matchAll(/<w:p(?:\s|>)[\s\S]*?<\/w:p>/gu)
  ].map((match) => match[0]);
  const authorParagraphCount = paragraphs.filter((paragraph) =>
    /<w:pStyle\s+w:val="Author"\s*\/>/u.test(paragraph)
  ).length;
  const officialIssueRows = paragraphs.filter((paragraph) =>
    /<w:pStyle\s+w:val="MdOfficialIssueRow"\s*\/>/u.test(
      paragraph
    )
  );
  const officialIssueRowsWithRightTab = officialIssueRows.filter(
    (paragraph) =>
      [...paragraph.matchAll(/<w:tab(?:\s[^>]*)?\s*\/>/gu)].some(
        (match) =>
          /\bw:val="right"/u.test(match[0]) &&
          /\bw:pos="\d+"/u.test(match[0])
      )
  );
  const officialIssueRowContentTabCount = officialIssueRows.reduce(
    (count, paragraph) =>
      count + (paragraph.match(/<w:tab\s*\/>/gu)?.length ?? 0),
    0
  );
  const inlineCodeContinuity = inlineCodeContinuityProbes.map((probe) => {
    const matchingParagraphs = paragraphs.filter((paragraph) =>
      paragraph.includes(probe.code)
    );
    const paragraph = matchingParagraphs[0] ?? "";
    const text = [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu)]
      .map((match) => match[1])
      .join("");
    const codeRunPattern = new RegExp(
      `<w:r(?:\\s|>)[\\s\\S]*?<w:rStyle\\s+w:val="VerbatimChar"\\s*\\/>[\\s\\S]*?<w:t(?:\\s[^>]*)?>${probe.code}<\\/w:t>[\\s\\S]*?<\\/w:r>`,
      "u"
    );
    const hardBreakCount =
      paragraph.match(/<w:br(?:\s[^>]*)?\s*\/>/gu)?.length ?? 0;
    return {
      id: probe.id,
      code: probe.code,
      expectedText: probe.text,
      actualText: text,
      paragraphCount: matchingParagraphs.length,
      hardBreakCount,
      characterStylePresent: codeRunPattern.test(paragraph),
      passed:
        matchingParagraphs.length === 1 &&
        text === probe.text &&
        hardBreakCount === 0 &&
        codeRunPattern.test(paragraph)
    };
  });
  const breakProbes = docxBreakParagraphProbes.map((probe) => {
    const matchingParagraphs = paragraphs.map((paragraph) => ({
      paragraph,
      actualText: [
        ...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu)
      ].map((match) => match[1]).join("")
    })).filter(({ actualText }) => actualText === probe.expectedText);
    const paragraph = matchingParagraphs[0]?.paragraph ?? "";
    const actualText = matchingParagraphs[0]?.actualText ?? "";
    const hardBreakCount =
      paragraph.match(/<w:br(?:\s[^>]*)?\s*\/>/gu)?.length ?? 0;
    const runs = paragraph.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/gu) ?? [];
    const characterStylePresent = !probe.requiredCharacterStyle ||
      runs.some((run) =>
        run.includes(`w:rStyle w:val="${probe.requiredCharacterStyle}"`) &&
        run.includes("&lt;br&gt;")
      );
    const paragraphStylePresent = !probe.requiredParagraphStyle ||
      new RegExp(
        `<w:pStyle\\s+w:val="${probe.requiredParagraphStyle}"\\s*\\/>`,
        "u"
      ).test(paragraph);
    return {
      id: probe.id,
      marker: probe.marker,
      expectedText: probe.expectedText,
      actualText,
      expectedHardBreakCount: probe.hardBreakCount,
      hardBreakCount,
      paragraphCount: matchingParagraphs.length,
      characterStylePresent,
      paragraphStylePresent,
      passed:
        matchingParagraphs.length === 1 &&
        actualText === probe.expectedText &&
        hardBreakCount === probe.hardBreakCount &&
        characterStylePresent &&
        paragraphStylePresent
    };
  });
  const adjacentA = breakProbes.find((probe) => probe.id === "adjacent-a");
  const adjacentB = breakProbes.find((probe) => probe.id === "adjacent-b");
  const tableBreakSemantics = {
    probes: breakProbes,
    adjacentCellsIsolated:
      adjacentA?.paragraphCount === 1 &&
      adjacentB?.paragraphCount === 1 &&
      adjacentA.actualText !== adjacentB.actualText,
    passed:
      breakProbes.every((probe) => probe.passed) &&
      adjacentA?.paragraphCount === 1 &&
      adjacentB?.paragraphCount === 1
  };
  return {
    bytes: content.byteLength,
    sha256: sha256(content),
    partCount: Object.keys(entries).length,
    sectionCount: documentXml.match(/<w:sectPr(?:\s|>)/gu)?.length ?? 0,
    embeddedFontPartCount: fontParts.length,
    fontNames: [...new Set(fontNames)].sort((first, second) =>
      first.localeCompare(second, "en")
    ),
    embeddedFontNames: [...new Set(embeddedFontNames)].sort((first, second) =>
      first.localeCompare(second, "en")
    ),
    optionalFontPackApplied: fontTableXml.includes("MorphDoc Serif SC"),
    hasAltChunk: /<w:altChunk(?:\s|>)/u.test(documentXml),
    internalMarkerCount:
      documentXml.match(/MORPHDOC_(?:CONTAINER|SECTION)_/gu)?.length ?? 0,
    authorParagraphCount,
    officialIssueRowCount: officialIssueRows.length,
    officialIssueRowRightTabCount:
      officialIssueRowsWithRightTab.length,
    officialIssueRowContentTabCount,
    inlineCodeContinuity,
    inlineCodeContinuityPassed: inlineCodeContinuity.every(
      (probe) => probe.passed
    ),
    tableBreakSemantics,
    requiredStylesPresent: [
      "Normal",
      "Heading1",
      "SourceCode",
      "Table",
      "Caption"
    ].every((styleId) => stylesXml.includes(`w:styleId="${styleId}"`))
  };
}

async function requestArtifact(origin, route, payload, contentType) {
  const response = await fetch(`${origin}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const content = new Uint8Array(await response.arrayBuffer());
  assert(
    response.ok,
    `${route} 返回 ${response.status}：${decoder.decode(content)}`
  );
  assert(
    response.headers.get("content-type")?.includes(contentType),
    `${route} MIME 无效：${response.headers.get("content-type")}`
  );
  return { response, content };
}

async function requestJson(origin, route, payload) {
  const response = await fetch(`${origin}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  assert(response.ok, `${route} 返回 ${response.status}：${text}`);
  assert(
    response.headers.get("content-type")?.includes("application/json"),
    `${route} MIME 无效：${response.headers.get("content-type")}`
  );
  return JSON.parse(text);
}

function inspectHtmlBreakSemantics(articleHtml) {
  const cellFor = (marker) => {
    const cells = articleHtml.match(/<t[dh](?:\s[^>]*)?>[\s\S]*?<\/t[dh]>/gu) ?? [];
    return cells.find((cell) => cell.includes(marker)) ?? "";
  };
  const fragmentFor = (start, end) => {
    const startIndex = articleHtml.indexOf(start);
    const endIndex = articleHtml.indexOf(end, startIndex + start.length);
    return startIndex >= 0 && endIndex >= 0
      ? articleHtml.slice(startIndex, endIndex + end.length)
      : "";
  };
  const probes = [
    {
      id: "basic",
      passed: cellFor("标甲").includes(
        "标甲<br />标乙<br />标丙<br />标丁"
      )
    },
    {
      id: "case-insensitive",
      passed: cellFor("大甲").includes(
        "大甲<br />大乙<br />大丙<br />大丁"
      )
    },
    {
      id: "multiple",
      passed: cellFor("连甲").includes(
        "连甲<br /><br />连乙"
      )
    },
    {
      id: "boundary",
      passed: cellFor("边界").includes("<br />边界<br />")
    },
    {
      id: "escaped-and-entity",
      passed: cellFor("转甲").includes(
        "转甲&lt;br&gt;转乙 &lt;br&gt; 转丙"
      )
    },
    {
      id: "attribute-literal",
      passed: cellFor("属甲").includes(
        "属甲&lt;br class=\"unsafe\"&gt;属乙"
      )
    },
    {
      id: "inline-code-literal",
      passed: cellFor("码甲").includes(
        "码甲<code>&lt;br&gt;</code>码乙"
      )
    },
    {
      id: "outside-table-literal",
      passed: fragmentFor("外一", "外二").includes(
        "外一&lt;br&gt;外二"
      )
    },
    {
      id: "fenced-code-literal",
      passed: (() => {
        const fragment = fragmentFor("围一", "围二");
        return fragment.includes("&lt;") && fragment.includes("br") &&
          fragment.includes("&gt;") && !/<br(?:\s|\/?>)/iu.test(fragment);
      })()
    }
  ];
  const adjacentA = cellFor("邻甲");
  const adjacentB = cellFor("旁甲");
  const adjacentCellsIsolated =
    adjacentA.includes("邻甲<br />邻乙") &&
    adjacentB.includes("旁甲<br />旁乙") &&
    !adjacentA.includes("旁甲") &&
    !adjacentB.includes("邻甲");
  return {
    probes,
    adjacentCellsIsolated,
    passed: probes.every((probe) => probe.passed) && adjacentCellsIsolated
  };
}

function responseDiagnostics(response, kind) {
  return {
    serverTiming: response.headers.get("server-timing"),
    pageCount:
      kind === "pdf"
        ? Number(response.headers.get("x-pdf-page-count"))
        : undefined,
    warningCount:
      kind === "docx"
        ? Number(response.headers.get("x-docx-warning-count"))
        : undefined,
    echartsErrorCount: Number(
      response.headers.get("x-echarts-error-count")
    ),
    mermaidErrorCount: Number(
      response.headers.get("x-mermaid-error-count")
    )
  };
}

assert(fs.existsSync(standardReportPath), "缺少本轮标准 DOCX 主题矩阵报告");
assertFreshArtifact(
  "Preview Engine",
  [path.join(repositoryDirectory, "packages", "preview-engine", "src")],
  path.join(
    repositoryDirectory,
    "packages",
    "preview-engine",
    "dist",
    "semantic-cover-fit.js"
  )
);
assertFreshArtifact(
  "DOCX Engine",
  [path.join(repositoryDirectory, "packages", "docx-engine", "src")],
  path.join(
    repositoryDirectory,
    "packages",
    "docx-engine",
    "dist",
    "document-structure-transform.js"
  )
);
assertFreshArtifact(
  "Web Preview Runtime",
  [
    path.join(repositoryDirectory, "apps", "web", "src"),
    path.join(
      repositoryDirectory,
      "packages",
      "preview-engine",
      "dist",
      "semantic-cover-fit.js"
    )
  ],
  path.join(webDirectory, "preview-frame.html")
);
assert(
  fs.statSync(fontPackRoot).isDirectory(),
  `缺少有效字体包根目录：${fontPackRoot}`
);
const allThemes = readThemes();
assert(
  allThemes.length === 14,
  `内置主题数量应为 14，实际为 ${allThemes.length}`
);
const selectedThemeId =
  process.env.MORPHDOC_R4_THEME_ID?.trim() || undefined;
const externalMarkdownPath =
  process.env.MORPHDOC_R4_MARKDOWN_PATH?.trim() || undefined;
const appendInlineCodeProbes =
  process.env.MORPHDOC_R4_APPEND_INLINE_CODE_PROBES?.trim() !== "0";
const exportConfigOverride = readExportConfigOverride();
const themes = selectedThemeId
  ? allThemes.filter((theme) => theme.id === selectedThemeId)
  : allThemes;
assert(
  themes.length > 0,
  `R4 验收主题不存在：${selectedThemeId}`
);
const standardReport = readJson(standardReportPath);
assert(
  standardReport.themeCount === allThemes.length,
  "标准 DOCX 主题矩阵与 R4 主题数量不一致"
);
const standardByTheme = new Map(
  standardReport.results.map((result) => [result.id, result])
);

fs.mkdirSync(pdfDirectory, { recursive: true });
fs.mkdirSync(docxDirectory, { recursive: true });
const port = await reservePort();
const origin = `http://127.0.0.1:${port}`;
const pdfGenerator = createPdfGenerator({ renderOrigin: origin });
const docxMediaAdapter = createDocxMediaEngine({ renderOrigin: origin });
const captureDocxMedia = docxMediaAdapter.capture.bind(docxMediaAdapter);
let capturedDocxDocumentLayout;
docxMediaAdapter.capture = async (...args) => {
  const output = await captureDocxMedia(...args);
  capturedDocxDocumentLayout = structuredClone(
    output.plan.documentLayout ?? { tables: [] }
  );
  return output;
};
const app = buildApp({
  logger: { level: "error" },
  pdfGenerator,
  docxMediaAdapter,
  fontPacks: {
    roots: [fontPackRoot],
    appVersion
  }
});
registerWebRuntime(app);

const results = [];
try {
  await app.listen({ port, host: "127.0.0.1" });
  const capabilityResponse = await fetch(`${origin}/api/docx/capability`);
  const capability = await capabilityResponse.json();
  assert(
    capabilityResponse.ok &&
      capability.status === "available" &&
      capability.detectedVersion === "3.9.0.2",
    `DOCX capability 无效：${JSON.stringify(capability)}`
  );

  for (const theme of themes) {
    capturedDocxDocumentLayout = undefined;
    process.stderr.write(`[DOCX R4 matrix] generating ${theme.id}\n`);
    const samplePath = externalMarkdownPath
      ? path.resolve(repositoryDirectory, externalMarkdownPath)
      : path.join(samplesDirectory, `${theme.id}.md`);
    assert(fs.existsSync(samplePath), `主题缺少验收示例：${theme.id}`);
    const sourceMarkdown = fs.readFileSync(samplePath, "utf8");
    const markdown = `${sourceMarkdown.trimEnd()}${appendInlineCodeProbes ? inlineCodeContinuityMarkdown : ""}`;
    const sourceMetadata = matter(sourceMarkdown).data;
    const exportConfig = mergeExportConfig({
      ...defaultExportConfig,
      name: `${theme.name} R4 生产链验收`,
      themeId: theme.id,
      pageDecorationsMode: "theme",
      header: structuredClone(
        theme.pageDefaults?.header ?? defaultExportConfig.header
      ),
      footer: structuredClone(
        theme.pageDefaults?.footer ?? defaultExportConfig.footer
      ),
      paper: {
        ...defaultExportConfig.paper,
        format: "A4",
        orientation: "portrait",
        marginMode: "theme",
        margins: structuredClone(
          theme.pageDefaults?.margins ??
            defaultExportConfig.paper.margins
        )
      }
    }, exportConfigOverride);
    const payload = {
      markdown,
      fileName: path.basename(samplePath),
      language: "zh-CN",
      resources: [],
      exportConfig
    };
    const rendered = await requestJson(origin, "/api/render", payload);
    const htmlBreakSemantics = appendInlineCodeProbes
      ? inspectHtmlBreakSemantics(rendered.articleHtml)
      : undefined;
    if (appendInlineCodeProbes) {
      assert(
        htmlBreakSemantics.passed,
        `主题 ${theme.id} 的 Chromium br 语义门禁失败：${JSON.stringify(htmlBreakSemantics)}`
      );
    }
    const pdf = await requestArtifact(
      origin,
      "/api/pdf",
      payload,
      "application/pdf"
    );
    assert(
      decoder.decode(pdf.content.subarray(0, 5)) === "%PDF-",
      `主题 ${theme.id} 的 PDF 签名无效`
    );
    const docx = await requestArtifact(
      origin,
      "/api/docx",
      payload,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    const inspection = inspectDocx(docx.content);
    assert(!inspection.hasAltChunk, `主题 ${theme.id} 包含 altChunk`);
    assert(
      inspection.internalMarkerCount === 0,
      `主题 ${theme.id} 残留内部结构标记`
    );
    assert(
      inspection.requiredStylesPresent,
      `主题 ${theme.id} 缺少标准 Word 样式`
    );
    if (appendInlineCodeProbes) {
      assert(
        inspection.inlineCodeContinuityPassed,
        `主题 ${theme.id} 的行内代码连续性门禁失败：${JSON.stringify(inspection.inlineCodeContinuity)}`
      );
      assert(
        inspection.tableBreakSemantics.passed,
        `主题 ${theme.id} 的表格 br 换行门禁失败：${JSON.stringify(inspection.tableBreakSemantics)}`
      );
    }
    const standard = standardByTheme.get(theme.id);
    assert(standard, `标准矩阵缺少主题 ${theme.id}`);
    assert(
      standard.inspection.structureCoverage === 1 &&
        standard.inspection.titlePolicyPassed &&
        standard.inspection.titleDeduplicationPassed,
      `主题 ${theme.id} 的标准结构门禁未通过`
    );
    if (standard.inspection.profile) {
      assert(
        inspection.authorParagraphCount === 0,
        `结构化主题 ${theme.id} 残留重复 Author 段落`
      );
    }
    const expectsOfficialDualEndedRow = Boolean(
      sourceMetadata.document?.profile === "official" &&
        sourceMetadata.document.signatory
    );
    if (expectsOfficialDualEndedRow) {
      assert(
        inspection.officialIssueRowCount > 0 &&
          inspection.officialIssueRowCount ===
            inspection.officialIssueRowRightTabCount &&
          inspection.officialIssueRowContentTabCount ===
            inspection.officialIssueRowCount,
        `主题 ${theme.id} 的公文双端行缺少右制表位或签发人分隔`
      );
    } else {
      assert(
        inspection.officialIssueRowRightTabCount === 0 &&
          inspection.officialIssueRowContentTabCount === 0,
        `主题 ${theme.id} 的单端公文行包含无意义制表位`
      );
    }

    const pdfPath = path.join(pdfDirectory, `${theme.id}.pdf`);
    const preferredDocxPath = path.join(docxDirectory, `${theme.id}.docx`);
    fs.writeFileSync(pdfPath, pdf.content);
    const docxPath = writeArtifactWithBusyFallback(
      preferredDocxPath,
      docx.content
    );
    results.push({
      id: theme.id,
      name: theme.name,
      category: theme.category,
      compatibleProfiles: theme.compatibleProfiles,
      sample: path.relative(repositoryDirectory, samplePath),
      exportConfig,
      htmlBreakSemantics,
      pdf: {
        outputFile: path.relative(repositoryDirectory, pdfPath),
        bytes: pdf.content.byteLength,
        sha256: sha256(pdf.content),
        diagnostics: responseDiagnostics(pdf.response, "pdf")
      },
      docx: {
        outputFile: path.relative(repositoryDirectory, docxPath),
        inspection,
        documentLayout: capturedDocxDocumentLayout ?? { tables: [] },
        diagnostics: responseDiagnostics(docx.response, "docx")
      },
      standardInspection: standard.inspection,
      expectsOfficialDualEndedRow
    });
  }
} finally {
  await app.close();
}

const enhancedThemes = results.filter(
  (result) => result.docx.inspection.optionalFontPackApplied
);
for (const result of results) {
  assert(
    result.pdf.diagnostics.pageCount > 0,
    `主题 ${result.id} 的 PDF 页数无效`
  );
  assert(
    result.pdf.diagnostics.echartsErrorCount === 0 &&
      result.pdf.diagnostics.mermaidErrorCount === 0,
    `主题 ${result.id} 的 PDF 图表渲染失败`
  );
  assert(
    result.docx.diagnostics.echartsErrorCount === 0 &&
      result.docx.diagnostics.mermaidErrorCount === 0,
    `主题 ${result.id} 的 DOCX 图表渲染失败`
  );
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  origin,
  themeCount: themes.length,
  totalThemeCount: allThemes.length,
  selectedThemeId,
  fontPackRoot,
  standardReport: path.relative(repositoryDirectory, standardReportPath),
  outputDirectory: path.relative(repositoryDirectory, outputDirectory),
  enhancedThemeIds: enhancedThemes.map((result) => result.id),
  results
};
const reportPath = path.join(outputDirectory, "r4-matrix-report.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
