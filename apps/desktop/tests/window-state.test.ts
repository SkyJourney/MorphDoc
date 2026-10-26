import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadWindowState,
  parseWindowState,
  resolveWindowBounds,
  saveWindowState
} from "../src/window-state.js";

const primaryWorkArea = {
  x: 0,
  y: 0,
  width: 1920,
  height: 1040
};
const defaultSize = { width: 1440, height: 960 };
const minimumSize = { width: 1024, height: 720 };

describe("桌面窗口状态", () => {
  it("校验并规范化持久化状态", () => {
    expect(
      parseWindowState({
        version: 1,
        bounds: {
          x: 120.4,
          y: 80.6,
          width: 1280.2,
          height: 800.8
        },
        maximized: true
      })
    ).toEqual({
      version: 1,
      bounds: {
        x: 120,
        y: 81,
        width: 1280,
        height: 801
      },
      maximized: true
    });
  });

  it("拒绝损坏或不受支持的状态", () => {
    expect(parseWindowState(undefined)).toBeUndefined();
    expect(
      parseWindowState({
        version: 2,
        bounds: primaryWorkArea,
        maximized: false
      })
    ).toBeUndefined();
    expect(
      parseWindowState({
        version: 1,
        bounds: { x: 0, y: 0, width: -1, height: 720 },
        maximized: false
      })
    ).toBeUndefined();
  });

  it("首次启动时在主显示器居中", () => {
    expect(
      resolveWindowBounds(
        undefined,
        [primaryWorkArea],
        primaryWorkArea,
        defaultSize,
        minimumSize
      )
    ).toEqual({
      x: 240,
      y: 40,
      width: 1440,
      height: 960
    });
  });

  it("将部分溢出的窗口完整收回原显示器", () => {
    expect(
      resolveWindowBounds(
        { x: 1700, y: 900, width: 1280, height: 800 },
        [primaryWorkArea],
        primaryWorkArea,
        defaultSize,
        minimumSize
      )
    ).toEqual({
      x: 640,
      y: 240,
      width: 1280,
      height: 800
    });
  });

  it("显示器移除后在主显示器居中恢复", () => {
    expect(
      resolveWindowBounds(
        { x: 3000, y: 120, width: 1200, height: 780 },
        [primaryWorkArea],
        primaryWorkArea,
        defaultSize,
        minimumSize
      )
    ).toEqual({
      x: 360,
      y: 130,
      width: 1200,
      height: 780
    });
  });

  it("窗口大于工作区时缩小到可完整展示", () => {
    const compactWorkArea = {
      x: 1920,
      y: 0,
      width: 1280,
      height: 680
    };
    expect(
      resolveWindowBounds(
        { x: 2000, y: -100, width: 1800, height: 1000 },
        [primaryWorkArea, compactWorkArea],
        primaryWorkArea,
        defaultSize,
        minimumSize
      )
    ).toEqual({
      x: 1920,
      y: 0,
      width: 1280,
      height: 680
    });
  });

  it("通过临时文件原子保存并可重新载入", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "morphdoc-window-")
    );
    const filePath = path.join(directory, "window-state.json");
    const state = {
      version: 1 as const,
      bounds: { x: 10, y: 20, width: 1200, height: 800 },
      maximized: false
    };
    try {
      await saveWindowState(filePath, state);
      await expect(loadWindowState(filePath)).resolves.toEqual(state);
      const updatedState = {
        ...state,
        bounds: { x: 30, y: 40, width: 1280, height: 900 },
        maximized: true
      };
      await saveWindowState(filePath, updatedState);
      await expect(loadWindowState(filePath)).resolves.toEqual(
        updatedState
      );
      expect(await readdir(directory)).toEqual(["window-state.json"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
