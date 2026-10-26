import {
  app,
  Menu,
  net,
  protocol,
  session
} from "electron";
import { access, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createApplicationService,
  type ApplicationService
} from "@morphdoc/application";
import {
  parseFontPackResourceUrl,
  parseThemeResourceUrl
} from "./application-contract.js";
import {
  DesktopApplicationController
} from "./desktop-application-controller.js";
import { DESKTOP_PDF_PARTITION } from "./electron-pdf-generator.js";
import { DESKTOP_DOCX_PARTITION } from "./electron-docx-media-engine.js";
import {
  findMarkdownFileArgument,
  isMarkdownFilePath
} from "./markdown-file.js";
import { migrateLegacyUserData } from "./user-data-migration.js";

const APP_SCHEME = "morphdoc";
const APP_HOST = "bundle";
const THEME_HOST = "theme";
const FONT_PACK_HOST = "font-pack";
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let applicationController: DesktopApplicationController | undefined;
let pendingExternalMarkdownPath = findMarkdownFileArgument(
  process.argv,
  process.cwd()
);

function configurePackagedUserDataDirectory() {
  if (!app.isPackaged) {
    return Promise.resolve();
  }
  const appDataDirectory = app.getPath("appData");
  const targetDirectory = path.join(
    appDataDirectory,
    __APP_ENGLISH_NAME__
  );
  const targetAlreadyExists = existsSync(targetDirectory);
  app.setPath("userData", targetDirectory);
  if (targetAlreadyExists) {
    return Promise.resolve();
  }
  return migrateLegacyUserData(
    [path.join(appDataDirectory, __APP_LEGACY_DISPLAY_NAME__)],
    targetDirectory
  ).then(() => undefined);
}

const userDataMigration = configurePackagedUserDataDirectory();

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      codeCache: true,
      corsEnabled: true
    }
  }
]);

function getCommandLineValue(name: string) {
  const prefix = `--${name}=`;
  return process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function getWebRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "dist")
    : path.resolve(currentDirectory, "../../web/dist");
}

function getApplicationIcon() {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      process.platform === "darwin" ? "app.icns" : "app.ico"
    );
  }
  const projectRoot = path.resolve(currentDirectory, "../../..");
  return path.join(
    projectRoot,
    "logos",
    "desktop",
    process.platform === "darwin" ? "macos" : "windows",
    process.platform === "darwin" ? "app.icns" : "app.ico"
  );
}

function encodeThemeAssetPath(assetPath: string) {
  return assetPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function dispatchExternalMarkdown(filePath: string) {
  if (!applicationController) {
    pendingExternalMarkdownPath = filePath;
    return;
  }
  void applicationController.openExternalMarkdown(filePath).catch(
    (error: unknown) => {
      console.warn("无法打开系统传入的 Markdown 文件", error);
    }
  );
}

function getDesktopThemeDirectory() {
  return app.isPackaged
    ? path.join(app.getPath("userData"), "themes")
    : path.resolve(currentDirectory, "../../..", ".local", "themes");
}

function getDesktopUserFontPackDirectory() {
  if (!app.isPackaged) {
    return path.resolve(
      currentDirectory,
      "../../..",
      ".local",
      "font-packs"
    );
  }
  const localApplicationData = process.env.LOCALAPPDATA?.trim();
  return localApplicationData
    ? path.join(localApplicationData, "morphdoc", "font-packs")
    : path.join(app.getPath("userData"), "font-packs");
}

function createDesktopApplicationService() {
  const projectRoot = path.resolve(currentDirectory, "../../..");
  const fontPackRoots = app.isPackaged
    ? [
        path.join(process.resourcesPath, "font-packs"),
        getDesktopUserFontPackDirectory()
      ]
    : [
        path.join(projectRoot, "output", "font-packs", "root"),
        getDesktopUserFontPackDirectory()
      ];
  return createApplicationService({
    bundledRoot: app.isPackaged
      ? path.join(process.resourcesPath, "themes")
      : path.join(projectRoot, "themes"),
    localRoot: getDesktopThemeDirectory(),
    createAssetUrl: (themeId, assetPath) =>
      `${APP_SCHEME}://${THEME_HOST}/${encodeURIComponent(themeId)}/${encodeThemeAssetPath(assetPath)}`,
    fontPacks: {
      roots: fontPackRoots,
      appVersion: app.getVersion(),
      createAssetUrl: (
        packId,
        version,
        faceId,
        kind,
        sha256
      ) =>
        `${APP_SCHEME}://${FONT_PACK_HOST}/${encodeURIComponent(
          packId
        )}/${encodeURIComponent(version)}/${encodeURIComponent(
          faceId
        )}/${kind}?v=${sha256}`
    },
    onWarning: (message) => console.warn(message)
  });
}

function isContainedPath(root: string, target: string) {
  const relative = path.relative(root, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function registerApplicationProtocol(
  applicationService: ApplicationService
) {
  const webRoot = getWebRoot();
  const handleRequest = async (request: Request) => {
    const url = new URL(request.url);
    if (url.host === THEME_HOST) {
      try {
        const resource = parseThemeResourceUrl(request.url);
        if (!resource) {
          return new Response("Not found", { status: 404 });
        }
        const asset = await applicationService.getThemeAsset(
          resource.themeId,
          resource.assetPath
        );
        if (!asset) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(asset.content, {
          headers: {
            "access-control-allow-origin": "*",
            "cache-control": "public, max-age=300",
            "content-type": asset.contentType,
            "x-content-type-options": "nosniff"
          }
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }
    if (url.host === FONT_PACK_HOST) {
      try {
        const resource = parseFontPackResourceUrl(request.url);
        if (!resource) {
          return new Response("Not found", { status: 404 });
        }
        const asset = await applicationService.getFontPackAsset(
          resource.packId,
          resource.packVersion,
          resource.faceId,
          resource.kind
        );
        if (!asset) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(asset.content, {
          headers: {
            "access-control-allow-origin": "*",
            "cache-control": "public, max-age=31536000, immutable",
            "content-type": asset.contentType,
            etag: `\"${asset.sha256}\"`,
            "x-content-type-options": "nosniff"
          }
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }
    if (url.host !== APP_HOST) {
      return new Response("Not found", { status: 404 });
    }

    let relativePath: string;
    try {
      relativePath =
        decodeURIComponent(url.pathname).replace(/^\/+/, "") ||
        "index.html";
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const target = path.resolve(webRoot, relativePath);
    if (!isContainedPath(webRoot, target)) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      await access(target);
    } catch {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(target).href);
  };

  await Promise.all([
    protocol.handle(APP_SCHEME, handleRequest),
    session
      .fromPartition(DESKTOP_PDF_PARTITION)
      .protocol.handle(APP_SCHEME, handleRequest),
    session
      .fromPartition(DESKTOP_DOCX_PARTITION)
      .protocol.handle(APP_SCHEME, handleRequest)
  ]);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
let windowStateReadyToQuit = false;

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, arguments_, workingDirectory) => {
    const filePath = findMarkdownFileArgument(
      arguments_,
      workingDirectory
    );
    if (filePath) {
      dispatchExternalMarkdown(filePath);
    } else if (!applicationController?.focusMostRecentWindow()) {
      void applicationController?.createWindow();
    }
  });
  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    if (isMarkdownFilePath(filePath)) {
      dispatchExternalMarkdown(filePath);
    }
  });
  app.on("activate", () => {
    if (!applicationController?.focusMostRecentWindow()) {
      void applicationController?.createWindow();
    }
  });
  app.on("before-quit", (event) => {
    if (windowStateReadyToQuit || !applicationController) {
      return;
    }
    event.preventDefault();
    void Promise.all([
      applicationController.flushWindowState(),
      applicationController.closeResources()
    ]).finally(() => {
        windowStateReadyToQuit = true;
        app.quit();
        setTimeout(() => {
          windowStateReadyToQuit = false;
        }, 1_000);
      });
  });
  app
    .whenReady()
    .then(async () => {
      await userDataMigration;
      Menu.setApplicationMenu(null);
      if (process.platform === "win32") {
        app.setAppUserModelId(__APP_ID__);
      }
      const themeDirectory = getDesktopThemeDirectory();
      await mkdir(themeDirectory, { recursive: true });
      const applicationService = createDesktopApplicationService();
      await registerApplicationProtocol(applicationService);

      const developmentUrl = getCommandLineValue("web-url");
      const applicationUrl =
        developmentUrl ?? `${APP_SCHEME}://${APP_HOST}/index.html`;
      applicationController = new DesktopApplicationController({
        applicationService,
        applicationUrl,
        renderUrl: new URL(
          "/preview-frame.html?target=pdf",
          applicationUrl
        ).href,
        preloadPath: path.join(
          currentDirectory,
          "app-preload.cjs"
        ),
        pdfPreloadPath: path.join(
          currentDirectory,
          "pdf-preload.cjs"
        ),
        docxRenderUrl: new URL(
          "/preview-frame.html?target=continuous",
          applicationUrl
        ).href,
        desktopResourcesPath: process.resourcesPath,
        iconPath: getApplicationIcon(),
        themeDirectory,
        windowStatePath: path.join(
          app.getPath("userData"),
          "window-state.json"
        ),
        saveLocationStatePath: path.join(
          app.getPath("userData"),
          "save-location.json"
        ),
        documentsDirectory: app.getPath("documents")
      });
      await applicationController.initialize();

      const startupMarkdownPath = pendingExternalMarkdownPath;
      pendingExternalMarkdownPath = undefined;
      await applicationController.createWindow(startupMarkdownPath);
    })
    .catch((error: unknown) => {
      console.error("桌面应用启动失败", error);
      app.quit();
    });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
