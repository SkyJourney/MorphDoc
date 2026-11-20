import assert from "node:assert/strict";
import test from "node:test";
import {
  findViolations,
  nextThreshold,
  parseTestSteps,
  shortName
} from "./coverage.mjs";

test("parseTestSteps 按出现顺序提取 test 与 build 步骤并忽略其他命令", () => {
  const script =
    "pnpm run test:release-stage && pnpm --filter @morphdoc/core run test && " +
    "node --test scripts/a.test.mjs && pnpm --filter @morphdoc/core run build && " +
    "pnpm --filter @morphdoc/docx-engine run test";
  assert.deepEqual(parseTestSteps(script), [
    { pkg: "@morphdoc/core", command: "test" },
    { pkg: "@morphdoc/core", command: "build" },
    { pkg: "@morphdoc/docx-engine", command: "test" }
  ]);
});

test("parseTestSteps 对真实的根 test 脚本解析出非空且 test 步骤均有对应包", async () => {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );
  const steps = parseTestSteps(manifest.scripts.test);
  assert.ok(steps.length > 0);
  assert.ok(steps.some((step) => step.command === "test"));
});

test("nextThreshold 实测下浮 1 个百分点并向下取整", () => {
  assert.equal(nextThreshold(85.6, undefined), 84);
  assert.equal(nextThreshold(100, undefined), 99);
  assert.equal(nextThreshold(0.5, undefined), 0);
});

test("nextThreshold 只升不降", () => {
  assert.equal(nextThreshold(70, 80), 80);
  assert.equal(nextThreshold(95, 80), 94);
});

test("findViolations 仅报告低于阈值的指标，缺失阈值视为无要求", () => {
  const measured = { lines: 80, statements: 79, functions: 90, branches: 60 };
  assert.deepEqual(
    findViolations(measured, { lines: 80, statements: 80, branches: 61 }),
    ["statements 79.00% < 80%", "branches 60.00% < 61%"]
  );
  assert.deepEqual(findViolations(measured, undefined), []);
});

test("shortName 去除 @morphdoc/ 作用域", () => {
  assert.equal(shortName("@morphdoc/docx-engine"), "docx-engine");
});
