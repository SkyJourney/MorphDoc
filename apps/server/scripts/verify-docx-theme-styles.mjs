import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApplicationService } from "@morphdoc/application";
import {
  DOCX_PANDOC_VERSION,
  defaultExportConfig
} from "@morphdoc/core";
import {
  DOCX_STYLE_SLOT_NAMES,
  createDocxThemeStyleFingerprint,
  normalizeDocxThemeMappingConfig,
  resolveDocxThemeTokens
} from "@morphdoc/docx-theme-engine";
import {
  PandocRuntime,
  createDynamicReferenceDocx,
  readReferenceDocxPackage,
  resolveTokenFonts
} from "@morphdoc/docx-engine";
import { chromium } from "playwright";
import { captureDocxThemeStyleWithPlaywrightPage } from "../dist/playwright-docx-theme-style.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(directory, "../../..");
const outputDirectory = path.join(
  repositoryDirectory,
  "output",
  "docx-theme-styles"
);
const referenceDirectory = path.join(
  outputDirectory,
  "references"
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function styleBlock(stylesXml, styleId) {
  const escaped = styleId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return stylesXml.match(
    new RegExp(
      `<w:style[^>]*w:styleId="${escaped}"[^>]*>[\\s\\S]*?<\\/w:style>`,
      "u"
    )
  )?.[0];
}

function inspectReference(reference, tokens) {
  const entries = readReferenceDocxPackage(reference.content).entries;
  const stylesXml = new TextDecoder().decode(
    entries.get("word/styles.xml")
  );
  const fontTableXml = new TextDecoder().decode(
    entries.get("word/fontTable.xml")
  );
  const normal = styleBlock(stylesXml, "Normal");
  const paragraph = tokens.slots.find(
    (slot) => slot.slot === "paragraph"
  )?.style;
  assert(normal, `主题 ${tokens.themeId} 缺少 Normal 样式`);
  const fonts = resolveTokenFonts(paragraph, {
    latin: "Arial",
    eastAsia: "SimSun"
  });
  if (paragraph?.fontCandidates.length) {
    assert(
      normal.includes(`w:ascii="${fonts.latin}"`),
      `主题 ${tokens.themeId} 的 Latin 正文字体未写入模板`
    );
    assert(
      normal.includes(`w:eastAsia="${fonts.eastAsia}"`),
      `主题 ${tokens.themeId} 的东亚正文字体未写入模板`
    );
    assert(
      fontTableXml.includes(`w:name="${fonts.eastAsia}"`),
      `主题 ${tokens.themeId} 的东亚字体未写入字体表`
    );
  }
  if (paragraph?.fontSizePt !== undefined) {
    assert(
      normal.includes(
        `w:sz w:val="${Math.round(paragraph.fontSizePt * 2)}"`
      ),
      `主题 ${tokens.themeId} 的正文字号未写入模板`
    );
  }
  for (const styleId of [
    "Heading1",
    "SourceCode",
    "Table",
    "MdOfficialTitle",
    "MdBriefingTitle",
    "MdProjectReportTitle",
    "MdTenderTitle"
  ]) {
    assert(
      stylesXml.includes(`w:styleId="${styleId}"`),
      `主题 ${tokens.themeId} 缺少样式 ${styleId}`
    );
  }
  return {
    bytes: reference.content.byteLength,
    templateFingerprint: reference.templateFingerprint,
    cacheKey: reference.cacheKey,
    stylePreset: reference.stylePreset,
    partCount: reference.partCount,
    paragraphFonts: fonts,
    customStyleCount:
      stylesXml.match(/w:styleId="Md[A-Za-z]+"/gu)?.length ?? 0
  };
}

const application = createApplicationService({
  bundledRoot: path.join(repositoryDirectory, "themes"),
  localRoot: path.join(repositoryDirectory, ".local", "themes")
});

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8"
      });
      response.end("<!doctype html><html><body></body></html>");
      return;
    }
    const match = url.pathname.match(
      /^\/api\/themes\/([^/]+)\/assets\/(.+)$/u
    );
    if (!match) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const themeId = decodeURIComponent(match[1]);
    const assetPath = match[2]
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
    const asset = await application.getThemeAsset(
      themeId,
      assetPath
    );
    if (!asset) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "access-control-allow-origin": "*",
      "content-type": asset.contentType,
      "x-content-type-options": "nosniff"
    });
    response.end(asset.content);
  } catch (error) {
    response.writeHead(500);
    response.end(
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("无法获取 DOCX 主题样式验收地址");
}
const baseUrl = `http://127.0.0.1:${address.port}/`;
const browser = await chromium.launch({ headless: true });
const runtime = new PandocRuntime(
  process.env.DOCX_PANDOC_PATH?.trim()
    ? { configuredPath: process.env.DOCX_PANDOC_PATH.trim() }
    : {}
);
const capability = await runtime.probe();
if (capability.capability.status !== "available") {
  throw new Error(capability.capability.message);
}
assert(
  capability.capability.detectedVersion === DOCX_PANDOC_VERSION,
  `Pandoc 版本不匹配：期望 ${DOCX_PANDOC_VERSION}，实际 ${capability.capability.detectedVersion}`
);
const baseline = await runtime.getDefaultReferenceDocx();

try {
  const context = await browser.newContext({
    locale: "zh-CN",
    serviceWorkers: "block"
  });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const { themes } = await application.listThemes();
  const bundledThemes = themes
    .filter((theme) => theme.source === "bundled")
    .sort((first, second) =>
      first.id.localeCompare(second.id, "en")
  );
  const snapshots = [];
  const tokenSets = [];
  const references = [];
  for (const theme of bundledThemes) {
    console.error(`[DOCX theme styles] capturing ${theme.id}`);
    const prepared = await application.prepareDocxExport({
      markdown: `# ${theme.name}`,
      fileName: `${theme.id}.md`,
      language: "zh-CN",
      exportConfig: {
        ...defaultExportConfig,
        themeId: theme.id
      }
    });
    const themeCss = prepared.theme.css;
    const manifest = prepared.theme.manifest;
    const themeFingerprint =
      await createDocxThemeStyleFingerprint(theme.id, themeCss);
    const snapshot =
      await captureDocxThemeStyleWithPlaywrightPage(page, {
        themeId: theme.id,
        themeFingerprint,
        themeCss,
        baseUrl
      });
    assert(
      snapshot.slots.length === DOCX_STYLE_SLOT_NAMES.length,
      `主题 ${theme.id} 的槽位数量不正确`
    );
    const missing = snapshot.slots.filter((slot) => !slot.matched);
    assert(
      missing.length === 0,
      `主题 ${theme.id} 缺少槽位：${missing
        .map((slot) => slot.slot)
        .join("、")}`
    );
    snapshots.push(snapshot);
    const tokens = resolveDocxThemeTokens({
      snapshot,
      config: normalizeDocxThemeMappingConfig(manifest)
    });
    tokenSets.push(tokens);
    const reference = createDynamicReferenceDocx(baseline, {
      exportConfig: prepared.request.exportConfig,
      theme: manifest,
      fileName: prepared.request.fileName,
      metadata: prepared.document.metadata,
      themeTokens: tokens
    });
    fs.mkdirSync(referenceDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(referenceDirectory, `${theme.id}.docx`),
      reference.content
    );
    references.push({
      themeId: theme.id,
      ...inspectReference(reference, tokens)
    });
  }
  assert(
    snapshots.length === 14,
    `内置主题数量应为 14，实际为 ${snapshots.length}`
  );
  const invalidDiagnostics = tokenSets.flatMap((tokens) =>
    tokens.diagnostics.filter(
      (diagnostic) =>
        diagnostic.severity === "error" ||
        diagnostic.code === "css-value-invalid"
    )
  );
  assert(
    invalidDiagnostics.length === 0,
    `DOCX 样式令牌存在 ${invalidDiagnostics.length} 条无效诊断`
  );
  const paragraphStyles = new Set(
    snapshots.map(
      (snapshot) =>
        snapshot.slots.find((slot) => slot.slot === "paragraph")
          ?.computed?.fontFamily
    )
  );
  assert(
    paragraphStyles.size > 1,
    "主题 CSS 未产生可区分的正文字体计算结果"
  );
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(outputDirectory, "snapshots.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        chromiumVersion: browser.version(),
        themeCount: snapshots.length,
        slotCount: DOCX_STYLE_SLOT_NAMES.length,
        snapshots,
        tokenSets,
        pandocVersion: capability.capability.detectedVersion,
        references
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  console.log(
    JSON.stringify({
      chromiumVersion: browser.version(),
      themes: snapshots.length,
      slotsPerTheme: DOCX_STYLE_SLOT_NAMES.length,
      totalSlots:
        snapshots.length * DOCX_STYLE_SLOT_NAMES.length,
      tokenSets: tokenSets.length,
      diagnostics: tokenSets.reduce(
        (count, tokens) => count + tokens.diagnostics.length,
        0
      ),
      pandocVersion: capability.capability.detectedVersion,
      references: references.length
    })
  );
  await context.close();
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
