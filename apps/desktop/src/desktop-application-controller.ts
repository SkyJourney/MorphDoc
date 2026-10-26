import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  shell,
  type IpcMainInvokeEvent,
  type Rectangle
} from "electron";
import {
  mkdir,
  realpath,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import {
  DocxExportService,
  DocxThemeTokenService,
  MAXIMUM_MARKDOWN_LENGTH,
  readDocxExportRuntimeLimits,
  type ApplicationService
} from "@morphdoc/application";
import {
  PandocDocxConverter,
  PandocRuntime
} from "@morphdoc/docx-engine";
import {
  DESKTOP_CONSUME_PENDING_MARKDOWN,
  DESKTOP_CREATE_NEW_WINDOW,
  DESKTOP_DISCARD_PENDING_MARKDOWN,
  DESKTOP_GENERATE_PDF,
  DESKTOP_GET_DOCX_CAPABILITY,
  DESKTOP_GET_THEME_CSS,
  DESKTOP_LIST_THEMES,
  DESKTOP_MARKDOWN_OPENED,
  DESKTOP_OPEN_DOCUMENT_LINK,
  DESKTOP_OPEN_MARKDOWN,
  DESKTOP_OPEN_THEME_DIRECTORY,
  DESKTOP_REFRESH_THEMES,
  DESKTOP_RENDER_MARKDOWN,
  DESKTOP_RESOLVE_WINDOW_CLOSE,
  DESKTOP_SAVE_MARKDOWN,
  DESKTOP_SAVE_MARKDOWN_AS,
  DESKTOP_SAVE_PDF,
  DESKTOP_EXPORT_DOCX,
  DESKTOP_SET_DOCUMENT_DIRTY,
  DESKTOP_START_NEW_MARKDOWN,
  DESKTOP_WINDOW_CLOSE_REQUESTED
} from "./channels.js";
import {
  toDesktopDocxExportFailure,
  type DesktopDocxExportOutcome
} from "./docx-contract.js";
import { saveDesktopDocx } from "./desktop-docx-save.js";
import { ElectronDocxMediaEngine } from "./electron-docx-media-engine.js";
import {
  parseMarkdownRenderRequest,
  parseThemeId
} from "./application-contract.js";
import { ElectronPdfGenerator } from "./electron-pdf-generator.js";
import { resolveDesktopDocumentLinkAction } from "./desktop-document-link.js";
import {
  isMarkdownFilePath,
  createMarkdownDocumentKey,
  readMarkdownFileSnapshot,
  type MarkdownFileSnapshot
} from "./markdown-file.js";
import { parsePagedDocumentPayload } from "./pdf-contract.js";
import {
  loadWindowState,
  resolveWindowBounds,
  saveWindowState,
  type WindowState
} from "./window-state.js";
import { getWindowCloseDecision } from "./window-close-policy.js";
import { SaveLocationStore } from "./save-location-state.js";

const DEFAULT_WINDOW_SIZE = { width: 1440, height: 960 };
const MINIMUM_WINDOW_SIZE = { width: 1024, height: 720 };
const CASCADE_OFFSET = 32;
const FOCUS_CHECK_SUPPRESSION_MS = 800;

type MarkdownOpenReason = "open" | "reload" | "replace";

interface PendingOpenedMarkdown {
  snapshot: MarkdownFileSnapshot;
  reason: MarkdownOpenReason;
}

interface WindowSession {
  window: BrowserWindow;
  dirty: boolean;
  allowClose: boolean;
  closeRequestPending: boolean;
  currentFilePath: string | undefined;
  documentKey: string | undefined;
  documentRoot: string | undefined;
  baselineHash: string | undefined;
  pendingOpenedMarkdown: PendingOpenedMarkdown | undefined;
  focusCheckRunning: boolean;
  suppressFocusCheckUntil: number;
}

export interface DesktopApplicationControllerOptions {
  applicationService: ApplicationService;
  applicationUrl: string;
  renderUrl: string;
  preloadPath: string;
  pdfPreloadPath: string;
  docxRenderUrl: string;
  desktopResourcesPath: string;
  iconPath: string;
  themeDirectory: string;
  windowStatePath: string;
  saveLocationStatePath: string;
  documentsDirectory: string;
}

function focusWindow(window: BrowserWindow) {
  if (window.isDestroyed()) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
}

export class DesktopApplicationController {
  readonly #applicationService: ApplicationService;
  readonly #applicationUrl: string;
  readonly #applicationOrigin: string;
  readonly #preloadPath: string;
  readonly #iconPath: string;
  readonly #themeDirectory: string;
  readonly #windowStatePath: string;
  readonly #saveLocationStore: SaveLocationStore;
  readonly #pdfGenerator: ElectronPdfGenerator;
  readonly #docxExportService: DocxExportService;
  readonly #docxMediaEngine: ElectronDocxMediaEngine;
  readonly #sessions = new Map<number, WindowSession>();
  readonly #documentSessions = new Map<string, WindowSession>();
  #primarySession: WindowSession | undefined;
  #savedWindowState: WindowState | undefined;
  #saveWindowStateTimer: NodeJS.Timeout | undefined;
  #pendingWindowStateWrite = Promise.resolve();
  #latestWindowState: WindowState | undefined;

  constructor(options: DesktopApplicationControllerOptions) {
    this.#applicationService = options.applicationService;
    this.#applicationUrl = options.applicationUrl;
    this.#applicationOrigin = new URL(options.applicationUrl).origin;
    this.#preloadPath = options.preloadPath;
    this.#iconPath = options.iconPath;
    this.#themeDirectory = options.themeDirectory;
    this.#windowStatePath = options.windowStatePath;
    this.#saveLocationStore = new SaveLocationStore(
      options.saveLocationStatePath,
      options.documentsDirectory
    );
    this.#pdfGenerator = new ElectronPdfGenerator({
      renderUrl: options.renderUrl,
      preloadPath: options.pdfPreloadPath
    });
    const pandocRuntime = new PandocRuntime({
      desktopResourcesPath: options.desktopResourcesPath
    });
    this.#docxMediaEngine = new ElectronDocxMediaEngine({
      renderUrl: options.docxRenderUrl
    });
    this.#docxExportService = new DocxExportService({
      application: this.#applicationService,
      runtime: pandocRuntime,
      converter: new PandocDocxConverter({
        runtime: pandocRuntime,
        luaFilterUrl: new URL(
          "./docx-media-filter.lua",
          import.meta.url
        )
      }),
      themeTokens: new DocxThemeTokenService(
        this.#docxMediaEngine
      ),
      limits: readDocxExportRuntimeLimits()
    });
  }

  async initialize() {
    const [savedWindowState] = await Promise.all([
      loadWindowState(this.#windowStatePath),
      this.#saveLocationStore.initialize()
    ]);
    this.#savedWindowState = savedWindowState;
    this.#registerIpcHandlers();
  }

  async #recordSuccessfulFile(filePath: string) {
    await this.#saveLocationStore
      .recordSuccessfulFile(filePath)
      .catch((error: unknown) => {
        console.warn("无法持久化最近保存目录", error);
      });
  }

  async createWindow(filePath?: string) {
    let pendingSnapshot: MarkdownFileSnapshot | undefined;
    if (filePath) {
      pendingSnapshot = await readMarkdownFileSnapshot(
        filePath,
        MAXIMUM_MARKDOWN_LENGTH
      );
      const existing = this.#findDocumentSession(
        pendingSnapshot.documentKey
      );
      if (existing) {
        focusWindow(existing.window);
        return existing.window;
      }
    }
    return this.#createWindow(pendingSnapshot);
  }

  async #createWindow(
    pendingSnapshot?: MarkdownFileSnapshot,
    startBlank = false
  ) {
    const isPrimary = !this.#primarySession;
    const restoredWindowState = isPrimary
      ? this.#latestWindowState ?? this.#savedWindowState
      : undefined;
    const initialBounds = this.#resolveInitialBounds(isPrimary);
    const window = new BrowserWindow({
      title: `${__APP_WINDOW_TITLE__} v${app.getVersion()}`,
      icon: this.#iconPath,
      ...initialBounds,
      minWidth: Math.min(
        MINIMUM_WINDOW_SIZE.width,
        initialBounds.width
      ),
      minHeight: Math.min(
        MINIMUM_WINDOW_SIZE.height,
        initialBounds.height
      ),
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: this.#preloadPath
      }
    });
    const session: WindowSession = {
      window,
      dirty: false,
      allowClose: false,
      closeRequestPending: false,
      currentFilePath: undefined,
      documentKey: undefined,
      documentRoot: undefined,
      baselineHash: undefined,
      pendingOpenedMarkdown: pendingSnapshot
        ? { snapshot: pendingSnapshot, reason: "open" }
        : undefined,
      focusCheckRunning: false,
      suppressFocusCheckUntil: 0
    };
    this.#sessions.set(window.webContents.id, session);
    if (isPrimary) {
      this.#primarySession = session;
      this.#captureWindowState();
      this.#bindPrimaryWindowState(session);
    }
    this.#lockDownWindow(window);
    this.#bindWindowLifecycle(session);

    window.once("ready-to-show", () => {
      if (
        isPrimary &&
        restoredWindowState?.maximized &&
        !window.isDestroyed()
      ) {
        window.maximize();
      }
      window.show();
    });
    const targetUrl = new URL(this.#applicationUrl);
    if (startBlank) {
      targetUrl.searchParams.set("new", "1");
    }
    await window.loadURL(targetUrl.href);
    return window;
  }

  async openExternalMarkdown(filePath: string) {
    const snapshot = await readMarkdownFileSnapshot(
      filePath,
      MAXIMUM_MARKDOWN_LENGTH
    );
    const existing = this.#findDocumentSession(snapshot.documentKey);
    if (existing) {
      focusWindow(existing.window);
      return;
    }
    await this.#createWindow(snapshot);
  }

  focusMostRecentWindow() {
    const focused = BrowserWindow.getFocusedWindow();
    const focusedSession = focused
      ? [...this.#sessions.values()].find(
          (session) => session.window === focused
        )
      : undefined;
    if (focusedSession) {
      focusWindow(focusedSession.window);
      return true;
    }
    const session = [...this.#sessions.values()].at(-1);
    if (!session) {
      return false;
    }
    focusWindow(session.window);
    return true;
  }

  async flushWindowState() {
    if (this.#saveWindowStateTimer) {
      clearTimeout(this.#saveWindowStateTimer);
      this.#saveWindowStateTimer = undefined;
    }
    this.#captureWindowState();
    await this.#persistWindowState();
  }

  async closeResources() {
    await Promise.all([
      this.#pdfGenerator.close(),
      this.#docxExportService.close()
    ]);
    await this.#docxMediaEngine.close();
  }

  #resolveInitialBounds(isPrimary: boolean): Rectangle {
    const displays = screen
      .getAllDisplays()
      .map((display) => display.workArea);
    const primaryWorkArea = screen.getPrimaryDisplay().workArea;
    if (isPrimary) {
      return resolveWindowBounds(
        (this.#latestWindowState ?? this.#savedWindowState)?.bounds,
        displays,
        primaryWorkArea,
        DEFAULT_WINDOW_SIZE,
        MINIMUM_WINDOW_SIZE
      );
    }

    const reference =
      BrowserWindow.getFocusedWindow() ??
      [...this.#sessions.values()].at(-1)?.window;
    const referenceBounds =
      reference && !reference.isDestroyed()
        ? reference.getNormalBounds()
        : primaryWorkArea;
    return resolveWindowBounds(
      {
        x: referenceBounds.x + CASCADE_OFFSET,
        y: referenceBounds.y + CASCADE_OFFSET,
        width: referenceBounds.width,
        height: referenceBounds.height
      },
      displays,
      primaryWorkArea,
      DEFAULT_WINDOW_SIZE,
      MINIMUM_WINDOW_SIZE
    );
  }

  #lockDownWindow(window: BrowserWindow) {
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, targetUrl) => {
      if (new URL(targetUrl).origin !== this.#applicationOrigin) {
        event.preventDefault();
      }
    });
    const applicationSession = window.webContents.session;
    applicationSession.setPermissionCheckHandler(() => false);
    applicationSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false)
    );
  }

  #bindWindowLifecycle(session: WindowSession) {
    const { window } = session;
    const webContentsId = window.webContents.id;
    window.on("focus", () => {
      void this.#checkForExternalChange(session);
    });
    window.on("close", (event) => {
      const decision = getWindowCloseDecision(session);
      if (decision === "allow") {
        return;
      }
      event.preventDefault();
      if (decision === "request") {
        session.closeRequestPending = true;
        session.window.webContents.send(
          DESKTOP_WINDOW_CLOSE_REQUESTED
        );
      }
    });
    window.on("closed", () => {
      const wasPrimary = this.#primarySession === session;
      this.#sessions.delete(webContentsId);
      if (
        session.documentKey &&
        this.#documentSessions.get(session.documentKey) === session
      ) {
        this.#documentSessions.delete(session.documentKey);
      }
      if (wasPrimary) {
        this.#promotePrimarySession();
      }
    });
  }

  #promotePrimarySession() {
    const nextPrimary = [...this.#sessions.values()]
      .filter((session) => !session.window.isDestroyed())
      .at(-1);
    this.#primarySession = nextPrimary;
    if (!nextPrimary) {
      return;
    }
    this.#bindPrimaryWindowState(nextPrimary);
    this.#captureWindowState();
  }

  async #checkForExternalChange(session: WindowSession) {
    if (
      session.focusCheckRunning ||
      session.window.isDestroyed() ||
      !session.currentFilePath ||
      !session.baselineHash ||
      Date.now() < session.suppressFocusCheckUntil
    ) {
      return;
    }
    session.focusCheckRunning = true;
    try {
      let snapshot: MarkdownFileSnapshot;
      try {
        snapshot = await readMarkdownFileSnapshot(
          session.currentFilePath,
          MAXIMUM_MARKDOWN_LENGTH
        );
      } catch (error) {
        await dialog.showMessageBox(session.window, {
          type: "error",
          title: "无法检查文件",
          message: "当前 Markdown 文件已被删除或无法读取。",
          detail:
            error instanceof Error ? error.message : "未知文件错误",
          buttons: ["确定"],
          defaultId: 0,
          noLink: true
        });
        return;
      }
      if (snapshot.contentHash === session.baselineHash) {
        return;
      }

      const result = await dialog.showMessageBox(session.window, {
        type: "warning",
        title: "文件已在外部修改",
        message: session.dirty
          ? "文件已在外部修改，重新载入会丢弃当前未保存内容。"
          : "文件已在外部修改，是否重新载入？",
        detail: snapshot.filePath,
        buttons: ["暂不载入", "重新载入"],
        defaultId: 1,
        cancelId: 0,
        noLink: true
      });
      if (result.response === 1) {
        session.baselineHash = snapshot.contentHash;
        session.pendingOpenedMarkdown = {
          snapshot,
          reason: "reload"
        };
        session.window.webContents.send(
          DESKTOP_MARKDOWN_OPENED,
          "reload"
        );
      }
    } finally {
      session.focusCheckRunning = false;
      session.suppressFocusCheckUntil =
        Date.now() + FOCUS_CHECK_SUPPRESSION_MS;
    }
  }

  #bindPrimaryWindowState(session: WindowSession) {
    const schedule = () => {
      this.#captureWindowState();
      if (this.#saveWindowStateTimer) {
        clearTimeout(this.#saveWindowStateTimer);
      }
      this.#saveWindowStateTimer = setTimeout(() => {
        this.#saveWindowStateTimer = undefined;
        void this.#persistWindowState();
      }, 2_000);
    };
    session.window.on("move", schedule);
    session.window.on("resize", schedule);
    session.window.on("maximize", schedule);
    session.window.on("unmaximize", schedule);
  }

  #captureWindowState() {
    const window = this.#primarySession?.window;
    if (!window || window.isDestroyed()) {
      return;
    }
    this.#latestWindowState = {
      version: 1,
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized()
    };
  }

  #persistWindowState() {
    if (!this.#latestWindowState) {
      return this.#pendingWindowStateWrite;
    }
    const state = structuredClone(this.#latestWindowState);
    this.#pendingWindowStateWrite = this.#pendingWindowStateWrite
      .catch(() => undefined)
      .then(() => saveWindowState(this.#windowStatePath, state))
      .catch((error: unknown) => {
        console.warn("无法保存窗口状态", error);
      });
    return this.#pendingWindowStateWrite;
  }

  #findDocumentSession(documentKey: string) {
    const committed = this.#documentSessions.get(documentKey);
    if (committed) {
      return committed;
    }
    return [...this.#sessions.values()].find(
      (session) =>
        session.pendingOpenedMarkdown?.snapshot.documentKey ===
        documentKey
    );
  }

  #getSession(event: IpcMainInvokeEvent) {
    const session = this.#sessions.get(event.sender.id);
    let origin: string | undefined;
    try {
      origin = event.senderFrame
        ? new URL(event.senderFrame.url).origin
        : undefined;
    } catch {
      origin = undefined;
    }
    if (
      !session ||
      event.sender !== session.window.webContents ||
      origin !== this.#applicationOrigin
    ) {
      throw new Error("拒绝未授权的桌面请求");
    }
    return session;
  }

  #commitSnapshot(
    session: WindowSession,
    snapshot: MarkdownFileSnapshot
  ) {
    if (
      session.documentKey &&
      this.#documentSessions.get(session.documentKey) === session
    ) {
      this.#documentSessions.delete(session.documentKey);
    }
    session.currentFilePath = snapshot.filePath;
    session.documentKey = snapshot.documentKey;
    session.documentRoot = path.dirname(snapshot.filePath);
    session.baselineHash = snapshot.contentHash;
    session.dirty = false;
    this.#documentSessions.set(snapshot.documentKey, session);
  }

  #clearDocument(session: WindowSession) {
    if (
      session.documentKey &&
      this.#documentSessions.get(session.documentKey) === session
    ) {
      this.#documentSessions.delete(session.documentKey);
    }
    session.currentFilePath = undefined;
    session.documentKey = undefined;
    session.documentRoot = undefined;
    session.baselineHash = undefined;
    session.pendingOpenedMarkdown = undefined;
    session.dirty = false;
  }

  #registerIpcHandlers() {
    ipcMain.handle(
      DESKTOP_OPEN_DOCUMENT_LINK,
      async (event, unsafeHref: unknown) => {
        const session = this.#getSession(event);
        if (
          typeof unsafeHref !== "string" ||
          unsafeHref.length === 0 ||
          unsafeHref.length > 8_192
        ) {
          throw new Error("文档链接无效");
        }
        try {
          await this.#openDocumentLink(session, unsafeHref);
        } catch (error) {
          await dialog.showMessageBox(session.window, {
            type: "error",
            title: "无法打开链接",
            message:
              error instanceof Error
                ? error.message
                : "无法打开文档链接",
            detail: unsafeHref,
            buttons: ["确定"],
            defaultId: 0,
            noLink: true
          });
        }
      }
    );

    ipcMain.handle(DESKTOP_OPEN_MARKDOWN, async (event) => {
      const session = this.#getSession(event);
      const selection = await dialog.showOpenDialog(session.window, {
        title: "打开 Markdown",
        properties: ["openFile"],
        filters: [
          { name: "Markdown 文件", extensions: ["md", "markdown"] }
        ]
      });
      const filePath = selection.filePaths[0];
      if (selection.canceled || !filePath) {
        return undefined;
      }
      const snapshot = await readMarkdownFileSnapshot(
        filePath,
        MAXIMUM_MARKDOWN_LENGTH
      );
      const existing = this.#findDocumentSession(snapshot.documentKey);
      if (existing && existing !== session) {
        focusWindow(existing.window);
        return undefined;
      }
      this.#commitSnapshot(session, snapshot);
      return snapshot.document;
    });

    ipcMain.handle(DESKTOP_CONSUME_PENDING_MARKDOWN, async (event) => {
      const session = this.#getSession(event);
      const pending = session.pendingOpenedMarkdown;
      session.pendingOpenedMarkdown = undefined;
      if (!pending) {
        return undefined;
      }
      this.#commitSnapshot(session, pending.snapshot);
      return pending.snapshot.document;
    });

    ipcMain.handle(DESKTOP_DISCARD_PENDING_MARKDOWN, async (event) => {
      const session = this.#getSession(event);
      session.pendingOpenedMarkdown = undefined;
    });

    ipcMain.handle(DESKTOP_START_NEW_MARKDOWN, async (event) => {
      this.#clearDocument(this.#getSession(event));
    });

    ipcMain.handle(DESKTOP_CREATE_NEW_WINDOW, async (event) => {
      this.#getSession(event);
      await this.#createWindow(undefined, true);
    });

    ipcMain.handle(
      DESKTOP_RESOLVE_WINDOW_CLOSE,
      async (event, unsafeClose: unknown) => {
        if (typeof unsafeClose !== "boolean") {
          throw new Error("窗口关闭决策无效");
        }
        const session = this.#getSession(event);
        session.closeRequestPending = false;
        session.suppressFocusCheckUntil =
          Date.now() + FOCUS_CHECK_SUPPRESSION_MS;
        if (unsafeClose && !session.window.isDestroyed()) {
          session.allowClose = true;
          session.window.close();
        }
      }
    );

    ipcMain.handle(
      DESKTOP_SET_DOCUMENT_DIRTY,
      async (event, unsafeDirty: unknown) => {
        if (typeof unsafeDirty !== "boolean") {
          throw new Error("文档修改状态无效");
        }
        this.#getSession(event).dirty = unsafeDirty;
      }
    );

    const saveMarkdown = async (
      event: IpcMainInvokeEvent,
      unsafeFileName: unknown,
      unsafeMarkdown: unknown,
      forceSaveAs: boolean
    ) => {
        const session = this.#getSession(event);
        if (
          typeof unsafeFileName !== "string" ||
          unsafeFileName.length === 0 ||
          unsafeFileName.length > 500 ||
          typeof unsafeMarkdown !== "string" ||
          unsafeMarkdown.length > MAXIMUM_MARKDOWN_LENGTH
        ) {
          throw new Error("Markdown 保存参数无效");
        }

        let targetPath = session.currentFilePath;
        if (forceSaveAs || !targetPath) {
          const suggestedName = /\.(?:md|markdown)$/iu.test(
            path.basename(unsafeFileName)
          )
            ? path.basename(unsafeFileName)
            : `${path.basename(unsafeFileName)}.md`;
          const selection = await dialog.showSaveDialog(session.window, {
            title: forceSaveAs
              ? "另存为 Markdown"
              : "保存 Markdown",
            defaultPath:
              await this.#saveLocationStore.resolveDefaultPath(
                session.currentFilePath,
                suggestedName
              ),
            filters: [
              {
                name: "Markdown 文件",
                extensions: ["md", "markdown"]
              }
            ]
          });
          if (selection.canceled || !selection.filePath) {
            return undefined;
          }
          targetPath = /\.(?:md|markdown)$/iu.test(selection.filePath)
            ? selection.filePath
            : `${selection.filePath}.md`;
        }

        let targetKey = createMarkdownDocumentKey(
          path.resolve(targetPath)
        );
        try {
          targetKey = createMarkdownDocumentKey(
            await realpath(targetPath)
          );
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            )
          ) {
            throw error;
          }
        }
        const existing = this.#findDocumentSession(targetKey);
        if (existing && existing !== session) {
          focusWindow(existing.window);
          throw new Error("该 Markdown 已在另一个窗口中打开");
        }

        await writeFile(targetPath, unsafeMarkdown, "utf8");
        const snapshot = await readMarkdownFileSnapshot(
          targetPath,
          MAXIMUM_MARKDOWN_LENGTH
        );
        const canonicalExisting = this.#findDocumentSession(
          snapshot.documentKey
        );
        if (canonicalExisting && canonicalExisting !== session) {
          focusWindow(canonicalExisting.window);
          throw new Error("该 Markdown 已在另一个窗口中打开");
        }
        this.#commitSnapshot(session, snapshot);
        await this.#recordSuccessfulFile(targetPath);
        return { fileName: snapshot.document.fileName };
      };

    ipcMain.handle(
      DESKTOP_SAVE_MARKDOWN,
      (event, unsafeFileName: unknown, unsafeMarkdown: unknown) =>
        saveMarkdown(
          event,
          unsafeFileName,
          unsafeMarkdown,
          false
        )
    );
    ipcMain.handle(
      DESKTOP_SAVE_MARKDOWN_AS,
      (event, unsafeFileName: unknown, unsafeMarkdown: unknown) =>
        saveMarkdown(
          event,
          unsafeFileName,
          unsafeMarkdown,
          true
        )
    );

    ipcMain.handle(DESKTOP_OPEN_THEME_DIRECTORY, async (event) => {
      this.#getSession(event);
      await mkdir(this.#themeDirectory, { recursive: true });
      const errorMessage = await shell.openPath(this.#themeDirectory);
      if (errorMessage) {
        throw new Error(
          `无法打开自定义主题目录：${errorMessage}`
        );
      }
      return this.#themeDirectory;
    });

    ipcMain.handle(DESKTOP_REFRESH_THEMES, async (event) => {
      this.#getSession(event);
      this.#applicationService.invalidateThemes();
    });

    ipcMain.handle(
      DESKTOP_RENDER_MARKDOWN,
      async (event, unsafeRequest: unknown) => {
        const session = this.#getSession(event);
        return this.#applicationService.render(
          parseMarkdownRenderRequest(unsafeRequest),
          session.documentRoot
            ? {
                localRoot: session.documentRoot,
                allowUnrestrictedLocalFiles: true
              }
            : {}
        );
      }
    );

    ipcMain.handle(DESKTOP_LIST_THEMES, async (event) => {
      this.#getSession(event);
      return this.#applicationService.listThemes();
    });

    ipcMain.handle(
      DESKTOP_GET_THEME_CSS,
      async (event, unsafeThemeId: unknown) => {
        this.#getSession(event);
        const css = await this.#applicationService.getThemeCss(
          parseThemeId(unsafeThemeId)
        );
        if (css === undefined) {
          throw new Error("未找到指定主题");
        }
        return css;
      }
    );

    ipcMain.handle(
      DESKTOP_GENERATE_PDF,
      async (event, unsafePayload: unknown) => {
        this.#getSession(event);
        const result = await this.#pdfGenerator.generate(
          parsePagedDocumentPayload(unsafePayload)
        );
        return {
          pdf: result.pdf,
          pageCount: result.pageCount,
          echartsErrors: result.echartsErrors,
          mermaidErrors: result.mermaidErrors
        };
      }
    );

    ipcMain.handle(
      DESKTOP_SAVE_PDF,
      async (
        event,
        unsafeFileName: unknown,
        unsafePdf: unknown
      ) => {
        const session = this.#getSession(event);
        if (
          typeof unsafeFileName !== "string" ||
          unsafeFileName.length === 0 ||
          unsafeFileName.length > 500 ||
          !(unsafePdf instanceof Uint8Array) ||
          unsafePdf.byteLength === 0 ||
          unsafePdf.byteLength > 200 * 1024 * 1024
        ) {
          throw new Error("PDF 保存参数无效");
        }
        const suggestedName = path.basename(unsafeFileName).endsWith(
          ".pdf"
        )
          ? path.basename(unsafeFileName)
          : `${path.basename(unsafeFileName)}.pdf`;
        const selection = await dialog.showSaveDialog(session.window, {
          title: "导出 PDF",
          defaultPath:
            await this.#saveLocationStore.resolveDefaultPath(
              session.currentFilePath,
              suggestedName
            ),
          filters: [{ name: "PDF 文件", extensions: ["pdf"] }]
        });
        if (selection.canceled || !selection.filePath) {
          return false;
        }
        await writeFile(selection.filePath, unsafePdf);
        await this.#recordSuccessfulFile(selection.filePath);
        return true;
      }
    );

    ipcMain.handle(
      DESKTOP_GET_DOCX_CAPABILITY,
      async (event) => {
        this.#getSession(event);
        return this.#docxExportService.getCapability();
      }
    );

    ipcMain.handle(
      DESKTOP_EXPORT_DOCX,
      async (
        event,
        unsafeRequest: unknown
      ): Promise<DesktopDocxExportOutcome> => {
        const session = this.#getSession(event);
        const abortController = new AbortController();
        const abort = () =>
          abortController.abort(
            new Error("桌面应用窗口已关闭")
          );
        event.sender.once("destroyed", abort);
        try {
          const generated =
            await this.#docxExportService.generate(
              unsafeRequest,
              {
                mediaAdapter: this.#docxMediaEngine,
                imageContext: session.documentRoot
                  ? {
                      localRoot: session.documentRoot,
                      allowUnrestrictedLocalFiles: true
                    }
                  : {},
                signal: abortController.signal
              }
            );
          if (
            session.window.isDestroyed() ||
            event.sender.isDestroyed()
          ) {
            return {
              ok: false,
              error: "DOCX_RENDER_TIMEOUT",
              message: "DOCX 导出已取消",
              retryable: false
            };
          }

          const selection = await dialog.showSaveDialog(
            session.window,
            {
              title: "导出 DOCX",
              defaultPath:
                await this.#saveLocationStore.resolveDefaultPath(
                  session.currentFilePath,
                  generated.fileName
                ),
              filters: [
                {
                  name: "Word 文档",
                  extensions: ["docx"]
                }
              ]
            }
          );
          if (selection.canceled || !selection.filePath) {
            return {
              ok: true,
              saved: false,
              fileName: generated.fileName,
              diagnostics: generated.diagnostics,
              timings: generated.timings
            };
          }
          const saved = await saveDesktopDocx(
            selection.filePath,
            generated.docx
          );
          await this.#recordSuccessfulFile(saved.targetPath);
          return {
            ok: true,
            saved: true,
            fileName: saved.fileName,
            diagnostics: generated.diagnostics,
            timings: generated.timings
          };
        } catch (error) {
          return toDesktopDocxExportFailure(error);
        } finally {
          event.sender.removeListener("destroyed", abort);
        }
      }
    );
  }

  async #openDocumentLink(
    session: WindowSession,
    href: string
  ) {
    const action = resolveDesktopDocumentLinkAction(
      href,
      session.currentFilePath
    );
    if (action.type === "ignore" || action.type === "anchor") {
      return;
    }
    if (action.type === "external") {
      await shell.openExternal(action.href);
      return;
    }

    let targetStats;
    try {
      targetStats = await stat(action.filePath);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        await dialog.showMessageBox(session.window, {
          type: "warning",
          title: "找不到文件",
          message: "链接指向的本地文件不存在。",
          detail: action.filePath,
          buttons: ["确定"],
          defaultId: 0,
          noLink: true
        });
        return;
      }
      throw error;
    }

    if (
      targetStats.isFile() &&
      isMarkdownFilePath(action.filePath)
    ) {
      const snapshot = await readMarkdownFileSnapshot(
        action.filePath,
        MAXIMUM_MARKDOWN_LENGTH
      );
      const existing = this.#findDocumentSession(
        snapshot.documentKey
      );
      if (existing) {
        focusWindow(existing.window);
        return;
      }

      const result = await dialog.showMessageBox(session.window, {
        type: "question",
        title: "打开 Markdown",
        message: `如何打开 ${snapshot.document.fileName}？`,
        detail: session.dirty
          ? "当前窗口有未保存修改；选择当前窗口会放弃这些修改。"
          : snapshot.filePath,
        buttons: ["取消", "当前窗口打开", "新窗口打开"],
        defaultId: 2,
        cancelId: 0,
        noLink: true
      });
      if (result.response === 1) {
        session.pendingOpenedMarkdown = {
          snapshot,
          reason: "replace"
        };
        session.window.webContents.send(
          DESKTOP_MARKDOWN_OPENED,
          "replace"
        );
      } else if (result.response === 2) {
        await this.#createWindow(snapshot);
      }
      return;
    }

    const errorMessage = await shell.openPath(action.filePath);
    if (errorMessage) {
      throw new Error(`系统无法打开该路径：${errorMessage}`);
    }
  }
}
