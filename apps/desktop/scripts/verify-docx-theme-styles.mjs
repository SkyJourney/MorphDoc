import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApplicationService } from "@morphdoc/application";
import { defaultExportConfig } from "@morphdoc/core";
import {
  DOCX_STYLE_SLOT_NAMES,
  createDocxThemeStyleCaptureScript,
  createDocxThemeStyleFingerprint,
  normalizeDocxThemeMappingConfig,
  parseDocxThemeStyleRuntimeCapture,
  resolveDocxThemeTokens
} from "@morphdoc/docx-theme-engine";
import { app, BrowserWindow } from "electron";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(directory, "../../..");
const outputDirectory = path.join(
  repositoryDirectory,
  "output",
  "docx-theme-styles"
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

await app.whenReady();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("无法获取 Electron DOCX 主题样式验收地址");
}
const baseUrl = `http://127.0.0.1:${address.port}/`;
const window = new BrowserWindow({
  show: false,
  focusable: false,
  width: 800,
  height: 600,
  paintWhenInitiallyHidden: true,
  webPreferences: {
    backgroundThrottling: false,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  }
});

try {
  await window.loadURL(baseUrl);
  window.webContents.debugger.attach("1.3");
  await window.webContents.debugger.sendCommand(
    "Emulation.setEmulatedMedia",
    { media: "print" }
  );
  const { themes } = await application.listThemes();
  const bundledThemes = themes
    .filter((theme) => theme.source === "bundled")
    .sort((first, second) =>
      first.id.localeCompare(second.id, "en")
  );
  const snapshots = [];
  const tokenSets = [];
  for (const theme of bundledThemes) {
    console.error(`[Electron DOCX theme styles] capturing ${theme.id}`);
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
    const request = {
      themeId: theme.id,
      themeFingerprint,
      themeCss,
      baseUrl
    };
    const capture = await window.webContents.executeJavaScript(
      createDocxThemeStyleCaptureScript(request),
      true
    );
    const snapshot = parseDocxThemeStyleRuntimeCapture(
      request,
      capture
    );
    assert(
      snapshot.slots.length === DOCX_STYLE_SLOT_NAMES.length,
      `主题 ${theme.id} 的槽位数量不正确`
    );
    assert(
      snapshot.slots.every((slot) => slot.matched),
      `主题 ${theme.id} 存在未命中槽位`
    );
    snapshots.push(snapshot);
    tokenSets.push(
      resolveDocxThemeTokens({
        snapshot,
        config: normalizeDocxThemeMappingConfig(manifest)
      })
    );
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
  const playwrightReport = JSON.parse(
    fs.readFileSync(
      path.join(outputDirectory, "snapshots.json"),
      "utf8"
    )
  );
  const playwrightTokensByTheme = new Map(
    playwrightReport.tokenSets.map((tokens) => [
      tokens.themeId,
      tokens
    ])
  );
  const crossEngineMismatches = [];
  for (const electronTokens of tokenSets) {
    const playwrightTokens = playwrightTokensByTheme.get(
      electronTokens.themeId
    );
    assert(
      playwrightTokens,
      `Playwright 报告缺少主题 ${electronTokens.themeId}`
    );
    for (const electronSlot of electronTokens.slots) {
      const playwrightSlot = playwrightTokens.slots.find(
        (slot) => slot.slot === electronSlot.slot
      );
      if (
        JSON.stringify(playwrightSlot) !==
        JSON.stringify(electronSlot)
      ) {
        crossEngineMismatches.push(
          `${electronTokens.themeId}:${electronSlot.slot}`
        );
      }
    }
  }
  assert(
    crossEngineMismatches.length === 0,
    `Playwright/Electron 令牌不一致：${crossEngineMismatches.join("、")}`
  );
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(outputDirectory, "electron-snapshots.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        electronVersion: process.versions.electron,
        chromiumVersion: process.versions.chrome,
        themeCount: snapshots.length,
        slotCount: DOCX_STYLE_SLOT_NAMES.length,
        crossEngineTokenMismatches:
          crossEngineMismatches.length,
        snapshots,
        tokenSets
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  console.log(
    JSON.stringify({
      electronVersion: process.versions.electron,
      chromiumVersion: process.versions.chrome,
      themes: snapshots.length,
      slotsPerTheme: DOCX_STYLE_SLOT_NAMES.length,
      totalSlots:
        snapshots.length * DOCX_STYLE_SLOT_NAMES.length,
      tokenSets: tokenSets.length,
      crossEngineTokenMismatches:
        crossEngineMismatches.length,
      diagnostics: tokenSets.reduce(
        (count, tokens) => count + tokens.diagnostics.length,
        0
      )
    })
  );
} finally {
  if (
    !window.isDestroyed() &&
    window.webContents.debugger.isAttached()
  ) {
    window.webContents.debugger.detach();
  }
  if (!window.isDestroyed()) {
    window.destroy();
  }
  await new Promise((resolve) => server.close(resolve));
  app.quit();
}
