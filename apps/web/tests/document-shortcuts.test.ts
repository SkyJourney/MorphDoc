import { describe, expect, it } from "vitest";
import { getDocumentShortcut } from "../src/document-shortcuts";

function shortcutEvent(
  key: string,
  overrides: Partial<Parameters<typeof getDocumentShortcut>[0]> = {}
) {
  return {
    key,
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    ...overrides
  };
}

describe("文档快捷键", () => {
  it("在桌面端识别新建、保存、另存为和关闭", () => {
    expect(getDocumentShortcut(shortcutEvent("n"), true)).toBe("new");
    expect(getDocumentShortcut(shortcutEvent("S"), true)).toBe("save");
    expect(
      getDocumentShortcut(
        shortcutEvent("S", { shiftKey: true }),
        true
      )
    ).toBe("save-as");
    expect(getDocumentShortcut(shortcutEvent("w"), true)).toBe("close");
    expect(
      getDocumentShortcut(
        shortcutEvent("s", { ctrlKey: false, metaKey: true }),
        true
      )
    ).toBe("save");
  });

  it("Web 端只接管保存", () => {
    expect(getDocumentShortcut(shortcutEvent("n"), false)).toBeUndefined();
    expect(getDocumentShortcut(shortcutEvent("w"), false)).toBeUndefined();
    expect(getDocumentShortcut(shortcutEvent("s"), false)).toBe("save");
    expect(
      getDocumentShortcut(
        shortcutEvent("s", { shiftKey: true }),
        false
      )
    ).toBeUndefined();
  });

  it("忽略组合输入、长按和带附加修饰键的按键", () => {
    expect(
      getDocumentShortcut(
        shortcutEvent("s", { isComposing: true }),
        true
      )
    ).toBeUndefined();
    expect(
      getDocumentShortcut(shortcutEvent("s", { repeat: true }), true)
    ).toBeUndefined();
    expect(
      getDocumentShortcut(shortcutEvent("s", { altKey: true }), true)
    ).toBeUndefined();
    expect(
      getDocumentShortcut(
        shortcutEvent("n", { shiftKey: true }),
        true
      )
    ).toBeUndefined();
    expect(
      getDocumentShortcut(
        shortcutEvent("s", { shiftKey: true, altKey: true }),
        true
      )
    ).toBeUndefined();
  });
});
