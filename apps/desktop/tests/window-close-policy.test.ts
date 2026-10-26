import { describe, expect, it } from "vitest";
import { getWindowCloseDecision } from "../src/window-close-policy.js";

describe("桌面窗口关闭策略", () => {
  it("干净文档或已授权窗口可以直接关闭", () => {
    expect(
      getWindowCloseDecision({
        dirty: false,
        allowClose: false,
        closeRequestPending: false
      })
    ).toBe("allow");
    expect(
      getWindowCloseDecision({
        dirty: true,
        allowClose: true,
        closeRequestPending: false
      })
    ).toBe("allow");
  });

  it("未保存文档只发出一次关闭确认请求", () => {
    expect(
      getWindowCloseDecision({
        dirty: true,
        allowClose: false,
        closeRequestPending: false
      })
    ).toBe("request");
    expect(
      getWindowCloseDecision({
        dirty: true,
        allowClose: false,
        closeRequestPending: true
      })
    ).toBe("wait");
  });
});
