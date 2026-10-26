import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import {
  readReferenceDocxPackage,
  requiredReferenceDocxParts
} from "../src/index.js";

function createReferencePackage(
  overrides: Record<string, Uint8Array> = {},
  mtime = new Date("2020-01-01T00:00:00.000Z")
) {
  const entries = Object.fromEntries(
    requiredReferenceDocxParts.map((name) => [
      name,
      new TextEncoder().encode(`<part name="${name}"/>`)
    ])
  );
  return zipSync(
    Object.fromEntries(
      Object.entries({ ...entries, ...overrides }).map(
        ([name, content]) => [name, [content, { mtime }]]
      )
    )
  );
}

describe("reference.docx 包", () => {
  it("预检中央目录并返回稳定指纹", () => {
    const content = createReferencePackage();
    const first = readReferenceDocxPackage(content);
    const second = readReferenceDocxPackage(
      createReferencePackage(
        {},
        new Date("2026-07-30T00:00:00.000Z")
      )
    );

    expect(first.entries.size).toBe(requiredReferenceDocxParts.length);
    expect(first.entries.has("word/styles.xml")).toBe(true);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it("拒绝路径穿越和缺少必要部件", () => {
    expect(() =>
      readReferenceDocxPackage(
        createReferencePackage({
          "../outside.xml": new Uint8Array([1])
        })
      )
    ).toThrow("不安全路径");

    const incomplete = zipSync({
      "[Content_Types].xml": new Uint8Array([1])
    });
    expect(() => readReferenceDocxPackage(incomplete)).toThrow(
      "缺少必要部件"
    );
  });
});
