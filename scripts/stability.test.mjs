import assert from "node:assert/strict";
import test from "node:test";
import { classifyFailures, parseFailures, parseRuns } from "./stability.mjs";

test("parseFailures 识别 vitest 的 FAIL 行并去重", () => {
  const output = [
    " FAIL  tests/a.test.ts > 套件 > 用例一",
    "some noise",
    " FAIL  tests/a.test.ts > 套件 > 用例一",
    "\u001b[41m\u001b[1m FAIL \u001b[22m\u001b[49m tests/b.test.ts > 用例二"
  ].join("\n");
  assert.deepEqual([...parseFailures(output)].sort(), [
    "tests/a.test.ts > 套件 > 用例一",
    "tests/b.test.ts > 用例二"
  ]);
});

test("parseFailures 识别 node:test 的 not ok 并忽略通过项", () => {
  const output = [
    "ok 1 - 通过的用例",
    "not ok 2 - 失败的用例",
    "not ok 3 - 带指令的用例 # TODO later"
  ].join("\n");
  assert.deepEqual([...parseFailures(output)].sort(), ["失败的用例", "带指令的用例"].sort());
});

test("parseFailures 对全部通过的输出返回空集合", () => {
  assert.equal(parseFailures("Test Files 3 passed (3)\nTests 10 passed (10)").size, 0);
});

test("classifyFailures 区分不稳定与确定性失败", () => {
  const perRun = [
    new Set(["always", "sometimes"]),
    new Set(["always"]),
    new Set(["always", "sometimes"])
  ];
  const { flaky, consistent } = classifyFailures(perRun);
  assert.deepEqual([...consistent], [["always", 3]]);
  assert.deepEqual([...flaky], [["sometimes", 2]]);
});

test("classifyFailures 在无失败时两类均为空", () => {
  const { flaky, consistent } = classifyFailures([new Set(), new Set()]);
  assert.equal(flaky.size + consistent.size, 0);
});

test("parseRuns 默认 5 次并校验范围与格式", () => {
  assert.equal(parseRuns([]), 5);
  assert.equal(parseRuns(["--runs", "10"]), 10);
  assert.throws(() => parseRuns(["--runs", "0"]), /1～20/u);
  assert.throws(() => parseRuns(["--runs", "21"]), /1～20/u);
  assert.throws(() => parseRuns(["--runs", "3; rm -rf /"]), /正整数/u);
  assert.throws(() => parseRuns(["--runs"]), /正整数/u);
  assert.throws(() => parseRuns(["--bogus"]), /未知参数/u);
});
