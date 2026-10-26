import { contextBridge, ipcRenderer } from "electron";
import type {
  DocxExportRequestInput,
  PagedDocumentPayload
} from "@morphdoc/core";
import type { MarkdownRenderRequest } from "@morphdoc/application";
import {
  DESKTOP_CONSUME_PENDING_MARKDOWN,
  DESKTOP_CREATE_NEW_WINDOW,
  DESKTOP_DISCARD_PENDING_MARKDOWN,
  DESKTOP_GET_THEME_CSS,
  DESKTOP_GET_DOCX_CAPABILITY,
  DESKTOP_EXPORT_DOCX,
  DESKTOP_GENERATE_PDF,
  DESKTOP_LIST_THEMES,
  DESKTOP_MARKDOWN_OPENED,
  DESKTOP_OPEN_MARKDOWN,
  DESKTOP_OPEN_DOCUMENT_LINK,
  DESKTOP_OPEN_THEME_DIRECTORY,
  DESKTOP_REFRESH_THEMES,
  DESKTOP_RENDER_MARKDOWN,
  DESKTOP_RESOLVE_WINDOW_CLOSE,
  DESKTOP_SAVE_MARKDOWN,
  DESKTOP_SAVE_MARKDOWN_AS,
  DESKTOP_SET_DOCUMENT_DIRTY,
  DESKTOP_START_NEW_MARKDOWN,
  DESKTOP_WINDOW_CLOSE_REQUESTED,
  DESKTOP_SAVE_PDF
} from "./channels.js";

contextBridge.exposeInMainWorld("morphDocDesktop", {
  openMarkdown: () => ipcRenderer.invoke(DESKTOP_OPEN_MARKDOWN),
  consumePendingMarkdown: () =>
    ipcRenderer.invoke(DESKTOP_CONSUME_PENDING_MARKDOWN),
  discardPendingMarkdown: () =>
    ipcRenderer.invoke(DESKTOP_DISCARD_PENDING_MARKDOWN),
  onMarkdownOpened: (
    listener: (reason: "open" | "reload" | "replace") => void
  ) => {
    const handleOpened = (
      _event: Electron.IpcRendererEvent,
      reason: "open" | "reload" | "replace"
    ) => listener(reason);
    ipcRenderer.on(DESKTOP_MARKDOWN_OPENED, handleOpened);
    return () =>
      ipcRenderer.removeListener(DESKTOP_MARKDOWN_OPENED, handleOpened);
  },
  startNewMarkdown: () =>
    ipcRenderer.invoke(DESKTOP_START_NEW_MARKDOWN),
  createNewWindow: () =>
    ipcRenderer.invoke(DESKTOP_CREATE_NEW_WINDOW),
  resolveWindowClose: (close: boolean) =>
    ipcRenderer.invoke(DESKTOP_RESOLVE_WINDOW_CLOSE, close),
  onWindowCloseRequested: (listener: () => void) => {
    const handleCloseRequested = () => listener();
    ipcRenderer.on(
      DESKTOP_WINDOW_CLOSE_REQUESTED,
      handleCloseRequested
    );
    return () =>
      ipcRenderer.removeListener(
        DESKTOP_WINDOW_CLOSE_REQUESTED,
        handleCloseRequested
      );
  },
  setDocumentDirty: (dirty: boolean) =>
    ipcRenderer.invoke(DESKTOP_SET_DOCUMENT_DIRTY, dirty),
  openDocumentLink: (href: string) =>
    ipcRenderer.invoke(DESKTOP_OPEN_DOCUMENT_LINK, href),
  saveMarkdown: (fileName: string, markdown: string) =>
    ipcRenderer.invoke(DESKTOP_SAVE_MARKDOWN, fileName, markdown),
  saveMarkdownAs: (fileName: string, markdown: string) =>
    ipcRenderer.invoke(DESKTOP_SAVE_MARKDOWN_AS, fileName, markdown),
  openThemeDirectory: () =>
    ipcRenderer.invoke(DESKTOP_OPEN_THEME_DIRECTORY),
  refreshThemes: () => ipcRenderer.invoke(DESKTOP_REFRESH_THEMES),
  renderMarkdown: (input: MarkdownRenderRequest) =>
    ipcRenderer.invoke(DESKTOP_RENDER_MARKDOWN, input),
  listThemes: () => ipcRenderer.invoke(DESKTOP_LIST_THEMES),
  getThemeCss: (themeId: string) =>
    ipcRenderer.invoke(DESKTOP_GET_THEME_CSS, themeId),
  generatePdf: (payload: PagedDocumentPayload) =>
    ipcRenderer.invoke(DESKTOP_GENERATE_PDF, payload),
  savePdf: (fileName: string, pdf: Uint8Array) =>
    ipcRenderer.invoke(DESKTOP_SAVE_PDF, fileName, pdf),
  getDocxCapability: () =>
    ipcRenderer.invoke(DESKTOP_GET_DOCX_CAPABILITY),
  exportDocx: (request: DocxExportRequestInput) =>
    ipcRenderer.invoke(DESKTOP_EXPORT_DOCX, request)
});
