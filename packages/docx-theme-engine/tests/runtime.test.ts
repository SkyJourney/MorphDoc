import { describe, expect, it, vi } from "vitest";
import {
  DOCX_STYLE_SLOT_NAMES,
  DocxThemeStyleSnapshotCache,
  createDocxThemeStyleCaptureScript,
  createDocxThemeStyleFingerprint,
  parseDocxThemeStyleRuntimeCapture,
  type DocxComputedStyle,
  type DocxThemeStyleCaptureRequest
} from "../src/index.js";

const request: DocxThemeStyleCaptureRequest = {
  themeId: "external-clean",
  themeFingerprint: "d".repeat(64),
  themeCss: "#write { color: #111; }",
  baseUrl: "https://example.invalid/"
};

const computed: DocxComputedStyle = {
  fontFamily: "Arial",
  fontSize: "16px",
  fontWeight: "400",
  fontStyle: "normal",
  color: "rgb(17, 17, 17)",
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
  borderTop: "0px none rgb(17, 17, 17)",
  borderRight: "0px none rgb(17, 17, 17)",
  borderBottom: "0px none rgb(17, 17, 17)",
  borderLeft: "0px none rgb(17, 17, 17)",
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
  outline: "0px none rgb(17, 17, 17)",
  outlineOffset: "0px"
};

function createRuntimeCapture() {
  return {
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
  };
}

describe("DOCX 主题样式浏览器运行时", () => {
  it("脚本只通过序列化载荷注入主题 CSS", () => {
    const script = createDocxThemeStyleCaptureScript({
      ...request,
      themeCss: '#write::before { content: "</style><script>x</script>"; }'
    });
    expect(script).toContain("theme.textContent");
    expect(script).toContain("style[property]");
    expect(script).toContain("contentPaddingLeft");
    expect(script).toContain("padding-left: 8px");
    expect(script).toContain("#write pre.md-fences \\u003e code");
    expect(script).not.toContain("font-family: inherit");
    expect(script).toContain("frame.remove()");
    expect(script).not.toContain("</style><script>x</script>");
  });

  it("将浏览器采集结果绑定到主题身份", () => {
    const snapshot = parseDocxThemeStyleRuntimeCapture(
      request,
      createRuntimeCapture()
    );
    expect(snapshot.themeId).toBe("external-clean");
    expect(snapshot.slots).toHaveLength(
      DOCX_STYLE_SLOT_NAMES.length
    );
  });

  it("同一主题内容生成稳定 SHA-256 指纹", async () => {
    const first = await createDocxThemeStyleFingerprint(
      request.themeId,
      request.themeCss
    );
    const second = await createDocxThemeStyleFingerprint(
      request.themeId,
      request.themeCss
    );
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      await createDocxThemeStyleFingerprint(
        request.themeId,
        `${request.themeCss}\n`
      )
    ).not.toBe(first);
  });
});

describe("DOCX 主题样式快照缓存", () => {
  it("合并并发采集并按指纹复用结果", async () => {
    const adapter = {
      captureThemeStyle: vi.fn(async (input) =>
        parseDocxThemeStyleRuntimeCapture(
          input,
          createRuntimeCapture()
        )
      )
    };
    const cache = new DocxThemeStyleSnapshotCache(adapter);
    const [first, second] = await Promise.all([
      cache.capture(request),
      cache.capture(request)
    ]);
    expect(first).toBe(second);
    expect(adapter.captureThemeStyle).toHaveBeenCalledTimes(1);
    expect((await cache.capture(request))).toBe(first);
    expect(adapter.captureThemeStyle).toHaveBeenCalledTimes(1);
  });

  it("按最近使用顺序限制缓存容量", async () => {
    const adapter = {
      captureThemeStyle: vi.fn(async (input) =>
        parseDocxThemeStyleRuntimeCapture(
          input,
          createRuntimeCapture()
        )
      )
    };
    const cache = new DocxThemeStyleSnapshotCache(adapter, {
      maximumEntries: 1
    });
    await cache.capture(request);
    await cache.capture({
      ...request,
      themeId: "external-dark",
      themeFingerprint: "e".repeat(64)
    });
    expect(cache.size).toBe(1);
    await cache.capture(request);
    expect(adapter.captureThemeStyle).toHaveBeenCalledTimes(3);
  });
});
