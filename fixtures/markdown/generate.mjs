#!/usr/bin/env node
/**
 * Markdown 夹具生成器。
 *
 * 两类输入由本文件负责，而不是以静态文件入库：
 *
 * 1. 压力文档：长文档、超宽表格、深层嵌套、大量代码块/图片/脚注。使用带种子的
 *    伪随机数生成，同一种子永远产出逐字节相同的内容，失败时可精确复现。
 * 2. 编码变体：CRLF 换行、UTF-8 BOM、纯空白输入。仓库的 .gitattributes 设置了
 *    `* text=auto eol=lf`，且 `git diff --check` 会拒绝行尾空白，因此这些字节级变体
 *    无法稳定地存成文件，只能在测试时由 LF 夹具派生。
 *
 * 命令行：
 *   node fixtures/markdown/generate.mjs --out <目录> [--seed <整数>]
 * 把全部压力文档写入指定目录，便于手动检查或喂给端到端测试。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const defaultSeed = 20260729;

/**
 * mulberry32 伪随机数生成器：体积小、分布足够均匀、跨平台结果一致。
 *
 * @param {number} seed 32 位整数种子
 * @returns {() => number} 每次调用返回 [0, 1) 的浮点数
 */
export function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, items) {
  return items[Math.floor(random() * items.length)];
}

function between(random, minimum, maximum) {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

const cjkWords = [
  "项目", "管理", "系统", "文档", "排版", "导出", "预览", "主题", "分页",
  "表格", "图表", "公式", "标题", "段落", "列表", "引用", "脚注", "样式"
];
const latinWords = [
  "render", "theme", "export", "preview", "layout", "table", "chart",
  "markdown", "document", "section", "heading"
];

function sentence(random) {
  const parts = [];
  const count = between(random, 6, 14);
  for (let index = 0; index < count; index += 1) {
    parts.push(random() < 0.25 ? pick(random, latinWords) : pick(random, cjkWords));
  }
  return `${parts.join(random() < 0.5 ? "" : " ")}。`;
}

function paragraph(random) {
  const sentences = [];
  const count = between(random, 2, 5);
  for (let index = 0; index < count; index += 1) {
    sentences.push(sentence(random));
  }
  return sentences.join("");
}

const codeSnippets = [
  ["ts", "export const value: number = 42;\nconsole.log(value);"],
  ["python", "def add(a, b):\n    return a + b"],
  ["bash", "set -euo pipefail\necho \"ok\""],
  ["json", '{ "key": "value", "list": [1, 2, 3] }'],
  ["sql", "SELECT id FROM users WHERE active = true;"]
];

// 1x1 透明 PNG，保证生成的图片引用是合法且体积极小的 Data URL
const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function longDocument(random) {
  const lines = ["# 压力文档：长篇文章", ""];
  for (let section = 1; section <= 120; section += 1) {
    lines.push(`## 第 ${section} 节 ${pick(random, cjkWords)}`, "");
    const paragraphs = between(random, 2, 4);
    for (let index = 0; index < paragraphs; index += 1) {
      lines.push(paragraph(random), "");
    }
    if (random() < 0.3) {
      for (let item = 1; item <= between(random, 2, 5); item += 1) {
        lines.push(`- ${sentence(random)}`);
      }
      lines.push("");
    }
    if (random() < 0.15) {
      const [language, code] = pick(random, codeSnippets);
      lines.push(`\`\`\`${language}`, code, "```", "");
    }
  }
  return `${lines.join("\n")}\n`;
}

function wideTable(random) {
  const columns = 30;
  const rows = 60;
  const header = Array.from({ length: columns }, (_, index) => `列${index + 1}`);
  const lines = [
    "# 压力文档：超宽表格",
    "",
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`
  ];
  for (let row = 0; row < rows; row += 1) {
    const cells = Array.from({ length: columns }, () =>
      random() < 0.5 ? String(between(random, 0, 9999)) : pick(random, cjkWords)
    );
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return `${lines.join("\n")}\n`;
}

function deepNesting() {
  const depth = 12;
  const lines = ["# 压力文档：深层嵌套", "", "## 嵌套列表", ""];
  for (let level = 0; level < depth; level += 1) {
    lines.push(`${"  ".repeat(level)}- 第 ${level + 1} 层列表项`);
  }
  lines.push("", "## 嵌套引用", "");
  for (let level = 1; level <= depth; level += 1) {
    lines.push(`${">".repeat(level)} 第 ${level} 层引用`);
  }
  return `${lines.join("\n")}\n`;
}

function manyCodeBlocks(random) {
  const lines = ["# 压力文档：大量代码块", ""];
  for (let index = 1; index <= 80; index += 1) {
    const [language, code] = pick(random, codeSnippets);
    lines.push(`## 代码 ${index}`, "", `\`\`\`${language}`, code, "```", "");
  }
  return `${lines.join("\n")}\n`;
}

function manyImages() {
  const lines = ["# 压力文档：大量图片", ""];
  for (let index = 1; index <= 40; index += 1) {
    lines.push(`![图 ${index}](${tinyPng})`, "");
  }
  return `${lines.join("\n")}\n`;
}

function manyFootnotes(random) {
  const lines = ["# 压力文档：大量脚注", ""];
  const count = 50;
  for (let index = 1; index <= count; index += 1) {
    lines.push(`${paragraph(random)}[^n${index}]`, "");
  }
  for (let index = 1; index <= count; index += 1) {
    lines.push(`[^n${index}]: ${sentence(random)}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * 生成全部压力文档。
 *
 * @param {number} [seed] 伪随机种子，默认固定，保证未显式指定时结果可复现
 * @returns {Record<string, string>} 文件名（不含扩展名）到 Markdown 内容的映射
 */
export function generateStressFixtures(seed = defaultSeed) {
  // 每份文档使用由种子派生的独立随机流，增删某一份不会改变其他文档的内容
  const stream = (offset) => createRandom(seed + offset);
  return {
    "stress-long-document": longDocument(stream(1)),
    "stress-wide-table": wideTable(stream(2)),
    "stress-deep-nesting": deepNesting(),
    "stress-many-codeblocks": manyCodeBlocks(stream(4)),
    "stress-many-images": manyImages(),
    "stress-many-footnotes": manyFootnotes(stream(6))
  };
}

/** 把 LF 换行的文本转换为 CRLF（先归一化，避免出现 \r\r\n）。 */
export function toCrlf(text) {
  return text.replace(/\r\n/gu, "\n").replace(/\n/gu, "\r\n");
}

/** 在文本开头加上 UTF-8 BOM。 */
export function withBom(text) {
  return `﻿${text}`;
}

/**
 * 纯空白或近乎空白的输入，用于验证渲染器对"没有实际内容"的文档保持稳定。
 *
 * @returns {Record<string, string>} 名称到输入内容的映射
 */
export function whitespaceInputs() {
  return {
    empty: "",
    newlines: "\n\n\n",
    spaces: "   ",
    "mixed-whitespace": "\n\n   \n\t\n\n",
    "bom-only": "﻿"
  };
}

async function main() {
  const values = process.argv.slice(2);
  let outDirectory;
  let seed = defaultSeed;
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (key === "--out" && value) {
      outDirectory = resolve(value);
    } else if (key === "--seed" && /^\d+$/u.test(value ?? "")) {
      seed = Number(value);
    } else {
      throw new Error(`无效参数：${key ?? ""} ${value ?? ""}`.trim());
    }
  }
  if (!outDirectory) {
    throw new Error("必须通过 --out 指定输出目录");
  }
  await mkdir(outDirectory, { recursive: true });
  for (const [name, content] of Object.entries(generateStressFixtures(seed))) {
    await writeFile(join(outDirectory, `${name}.md`), content, "utf8");
  }
  process.stdout.write(`已写入 ${outDirectory}（种子 ${seed}）\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
