import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseArguments,
  pdfProblems,
  publishedPort
} from "./smoke-image.mjs";

describe("parseArguments", () => {
  it("优先使用 --image", () => {
    assert.deepEqual(
      parseArguments(["--image", "morphdoc:a"], { MORPHDOC_IMAGE: "morphdoc:b" }),
      { image: "morphdoc:a" }
    );
  });

  it("未指定 --image 时回退到 MORPHDOC_IMAGE，两者都没有时使用 morphdoc:local", () => {
    assert.deepEqual(parseArguments([], { MORPHDOC_IMAGE: " morphdoc:b " }), {
      image: "morphdoc:b"
    });
    assert.deepEqual(parseArguments([], {}), { image: "morphdoc:local" });
  });

  it("拒绝未知参数或缺少取值的参数", () => {
    assert.throws(() => parseArguments(["--platform"]), /未知或不完整的参数/u);
    assert.throws(() => parseArguments(["--image"]), /未知或不完整的参数/u);
  });
});

describe("publishedPort", () => {
  it("解析 IPv4 映射端口", () => {
    assert.equal(publishedPort("127.0.0.1:49153\n"), 49153);
  });

  it("IPv4 与 IPv6 同时输出时取第一条", () => {
    assert.equal(publishedPort("[::]:49154\n127.0.0.1:49153"), 49154);
  });

  it("无法解析时抛出错误", () => {
    assert.throws(() => publishedPort(""), /无法解析端口映射/u);
  });
});

describe("pdfProblems", () => {
  const complete = [
    "%PDF-1.7",
    "1 0 obj << /Type /Font /Subtype /Type0 /ToUnicode 2 0 R >> endobj",
    "2 0 obj << /FontFile2 3 0 R >> endobj",
    "x".repeat(6000),
    "%%EOF",
    ""
  ].join("\n");

  it("接受具备可搜索中文字体结构的 PDF", () => {
    assert.deepEqual(pdfProblems(Buffer.from(complete, "latin1")), []);
  });

  it("逐项报告缺失的结构", () => {
    const problems = pdfProblems(Buffer.from("not a pdf", "latin1")).join("\n");
    assert.match(problems, /文件过小/u);
    assert.match(problems, /文件头/u);
    assert.match(problems, /%%EOF/u);
    assert.match(problems, /Type0/u);
    assert.match(problems, /ToUnicode/u);
    assert.match(problems, /字体未嵌入/u);
  });
});
