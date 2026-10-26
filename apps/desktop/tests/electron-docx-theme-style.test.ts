import {
  DOCX_STYLE_SLOT_NAMES,
  type DocxComputedStyle,
  type DocxThemeStyleCaptureRequest
} from "@morphdoc/docx-theme-engine";
import { describe, expect, it, vi } from "vitest";
import { captureDocxThemeStyleWithElectronWebContents } from "../src/electron-docx-theme-style.js";

const computed: DocxComputedStyle = {
  fontFamily: "Arial",
  fontSize: "16px",
  fontWeight: "400",
  fontStyle: "normal",
  color: "rgb(0, 0, 0)",
  backgroundColor: "rgba(0, 0, 0, 0)",
  lineHeight: "normal",
  letterSpacing: "normal",
  textAlign: "start",
  direction: "ltr",
  textIndent: "0px",
  textDecorationLine: "none",
  marginTop: "0px",
  marginRight: "0px",
  marginBottom: "0px",
  marginLeft: "0px",
  paddingTop: "0px",
  paddingRight: "0px",
  paddingBottom: "0px",
  paddingLeft: "0px",
  borderTop: "0px none rgb(0, 0, 0)",
  borderRight: "0px none rgb(0, 0, 0)",
  borderBottom: "0px none rgb(0, 0, 0)",
  borderLeft: "0px none rgb(0, 0, 0)",
  width: "640px",
  maxWidth: "none",
  minWidth: "0px",
  minHeight: "0px",
  height: "24px",
  breakBefore: "auto",
  breakAfter: "auto",
  breakInside: "auto",
  display: "block",
  flexDirection: "row",
  alignItems: "normal",
  justifyContent: "normal",
  outline: "rgb(0, 0, 0) none 0px",
  outlineOffset: "0px"
};

const request: DocxThemeStyleCaptureRequest = {
  themeId: "external-clean",
  themeFingerprint: "b".repeat(64),
  themeCss: "#write { color: #000; }",
  baseUrl: "morphdoc://app/"
};

describe("Electron DOCX 主题样式采集", () => {
  it("通过 CDP 切换打印媒体并在结束后恢复", async () => {
    let attached = false;
    const sendCommand = vi.fn(async () => undefined);
    const webContents = {
      debugger: {
        isAttached: () => attached,
        attach: vi.fn(() => {
          attached = true;
        }),
        detach: vi.fn(() => {
          attached = false;
        }),
        sendCommand
      },
      executeJavaScript: vi.fn(async () => ({
        rootFontSizePx: 16,
        viewport: {
          widthPx: 794,
          heightPx: 1123,
          deviceScaleFactor: 1
        },
        slots: DOCX_STYLE_SLOT_NAMES.map((slot) => ({
          slot,
          matched: true,
          computed
        }))
      })),
      isDestroyed: () => false
    };
    const snapshot =
      await captureDocxThemeStyleWithElectronWebContents(
        webContents as never,
        request
      );
    expect(sendCommand).toHaveBeenNthCalledWith(
      1,
      "Emulation.setEmulatedMedia",
      { media: "print" }
    );
    expect(sendCommand).toHaveBeenLastCalledWith(
      "Emulation.setEmulatedMedia",
      { media: "screen" }
    );
    expect(webContents.debugger.detach).toHaveBeenCalledTimes(1);
    expect(snapshot.slots).toHaveLength(
      DOCX_STYLE_SLOT_NAMES.length
    );
  });
});
