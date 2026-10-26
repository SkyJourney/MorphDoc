import {
  contextBridge,
  ipcRenderer,
  type IpcRendererEvent
} from "electron";
import type {
  PagedDocumentPayload,
  PagedDocumentRenderResult
} from "@morphdoc/core";
import {
  PDF_RUNTIME_COMPLETE,
  PDF_RUNTIME_FAIL,
  PDF_RUNTIME_READY,
  PDF_RUNTIME_RENDER
} from "./channels.js";

type RenderListener = (
  requestId: number,
  payload: PagedDocumentPayload
) => Promise<void> | void;

contextBridge.exposeInMainWorld("__morphDocDesktopPdf", {
  ready: () => ipcRenderer.send(PDF_RUNTIME_READY),
  onRender: (listener: RenderListener) => {
    const handler = (
      _event: IpcRendererEvent,
      requestId: number,
      payload: PagedDocumentPayload
    ) => {
      void listener(requestId, payload);
    };
    ipcRenderer.on(PDF_RUNTIME_RENDER, handler);
    return () => ipcRenderer.removeListener(PDF_RUNTIME_RENDER, handler);
  },
  complete: (
    requestId: number,
    result: PagedDocumentRenderResult
  ) => ipcRenderer.send(PDF_RUNTIME_COMPLETE, requestId, result),
  fail: (requestId: number, message: string) =>
    ipcRenderer.send(PDF_RUNTIME_FAIL, requestId, message)
});
