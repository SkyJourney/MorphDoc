import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOCX_MIME_TYPE,
  defaultExportConfig
} from "@morphdoc/core";
import { inspectDocxAcceptance } from "@morphdoc/docx-engine";
import { DOCX_STYLE_SLOTS } from "@morphdoc/docx-theme-engine";
import { buildApp } from "../dist/app.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(directory, "../../..");
const outputDirectory = path.join(
  repositoryDirectory,
  "output",
  "docx-acceptance"
);
const temporaryPrefix = "morphdoc-docx-";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function temporaryDirectories() {
  return new Set(
    fs
      .readdirSync(os.tmpdir(), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && entry.name.startsWith(temporaryPrefix)
      )
      .map((entry) => entry.name)
  );
}

const markdown = `---
title: Server HTTP DOCX 验收
author: 墨呈研发组
---

# HTTP 导出保持可编辑

这是一段由真实 Fastify 路由和 Pandoc 生成的可编辑中文正文，包含
[验收链接](https://example.invalid/server-docx)。

1. 原生编号第一项
2. 原生编号第二项

| HTTP 门禁 | 预期 |
| --- | --- |
| MIME | DOCX |
| 内容 | 可编辑 |

脚注必须保留。[^server-footnote]

公式 $a^2+b^2=c^2$ 必须使用 OMML。

[^server-footnote]: Server HTTP 验收脚注。
`;
const exportConfig = {
  ...defaultExportConfig,
  themeId: "typora-like",
  pageDecorationsMode: "custom",
  paper: {
    ...defaultExportConfig.paper,
    marginMode: "custom",
    margins: {
      top: "16mm",
      right: "16mm",
      bottom: "16mm",
      left: "16mm"
    }
  }
};
const computedStyle = {
  fontFamily: '"Microsoft YaHei", sans-serif',
  fontSize: "16px",
  fontWeight: "400",
  fontStyle: "normal",
  color: "rgb(34, 34, 34)",
  backgroundColor: "rgba(0, 0, 0, 0)",
  lineHeight: "24px",
  letterSpacing: "normal",
  textAlign: "start",
  direction: "ltr",
  textIndent: "0px",
  textDecorationLine: "none",
  marginTop: "0px",
  marginRight: "0px",
  marginBottom: "8px",
  marginLeft: "0px",
  paddingTop: "0px",
  paddingRight: "0px",
  paddingBottom: "0px",
  paddingLeft: "0px",
  borderTop: "0px none rgb(34, 34, 34)",
  borderRight: "0px none rgb(34, 34, 34)",
  borderBottom: "0px none rgb(34, 34, 34)",
  borderLeft: "0px none rgb(34, 34, 34)",
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
  outline: "0px none rgb(34, 34, 34)",
  outlineOffset: "0px"
};
const mediaAdapter = {
  themeStyleBaseUrl:
    "http://localhost:5173/preview-frame.html",
  async captureThemeStyle(request) {
    return {
      schemaVersion: 1,
      themeId: request.themeId,
      themeFingerprint: request.themeFingerprint,
      viewport: {
        widthPx: 794,
        heightPx: 1123,
        deviceScaleFactor: 1
      },
      rootFontSizePx: 16,
      slots: DOCX_STYLE_SLOTS.map(({ name }) => ({
        slot: name,
        matched: true,
        computed: computedStyle
      }))
    };
  },
  async capture() {
    return {
      plan: {
        targets: [],
        echartsErrors: [],
        mermaidErrors: []
      },
      captures: []
    };
  },
  async close() {}
};
const pdfGenerator = {
  async generate() {
    throw new Error("DOCX HTTP 验收不得调用 PDF");
  },
  async close() {}
};
const beforeTemporaryDirectories = temporaryDirectories();
const app = buildApp({
  logger: { level: "error" },
  pdfGenerator,
  docxMediaAdapter: mediaAdapter
});

let response;
try {
  const capabilityResponse = await app.inject({
    method: "GET",
    url: "/api/docx/capability"
  });
  assert(capabilityResponse.statusCode === 200, "DOCX capability 请求失败");
  assert(
    capabilityResponse.json().status === "available",
    `DOCX capability 不可用：${capabilityResponse.body}`
  );

  response = await app.inject({
    method: "POST",
    url: "/api/docx",
    payload: {
      markdown,
      fileName: "目录/Server HTTP 验收.md",
      language: "zh-CN",
      resources: [],
      exportConfig
    }
  });
} finally {
  await app.close();
}

assert(
  response.statusCode === 200,
  `DOCX HTTP 返回 ${response.statusCode}：${response.body}`
);
assert(
  response.headers["content-type"]?.includes(DOCX_MIME_TYPE),
  `DOCX MIME 无效：${response.headers["content-type"]}`
);
assert(
  response.headers["content-disposition"]?.includes(
    "Server%20HTTP%20%E9%AA%8C%E6%94%B6.docx"
  ),
  `DOCX 文件名无效：${response.headers["content-disposition"]}`
);
assert(
  response.headers["cache-control"] === "no-store",
  "DOCX HTTP 响应必须禁用缓存"
);
for (const timing of [
  "runtime-probe",
  "prepare",
  "media",
  "reference",
  "pandoc",
  "validation",
  "total"
]) {
  assert(
    response.headers["server-timing"]?.includes(`${timing};dur=`),
    `Server-Timing 缺少 ${timing}`
  );
}
assert(
  response.headers["x-docx-warning-count"] === "0",
  "无媒体 HTTP 验收不应产生 DOCX 警告"
);

const report = inspectDocxAcceptance(response.rawPayload, {
  id: "server-http",
  page: {
    widthTwips: 11906,
    heightTwips: 16838,
    orientation: "portrait",
    marginsTwips: {
      top: 907,
      right: 907,
      bottom: 907,
      left: 907
    }
  },
  requiredText: [
    "真实 Fastify 路由",
    "原生编号第一项",
    "HTTP 门禁"
  ],
  requiredFootnoteText: ["Server HTTP 验收脚注"],
  minimumParagraphs: 8,
  minimumTextRuns: 12,
  minimumTables: 1,
  minimumNumberedParagraphs: 2,
  minimumHyperlinks: 1,
  minimumFootnoteReferences: 1,
  minimumMathObjects: 1,
  requiredStyleIds: [
    "Normal",
    "Heading1",
    "SourceCode",
    "Table",
    "Caption"
  ],
  requirePageField: true
});

const afterTemporaryDirectories = temporaryDirectories();
const leakedTemporaryDirectories = [...afterTemporaryDirectories].filter(
  (name) => !beforeTemporaryDirectories.has(name)
);
assert(
  leakedTemporaryDirectories.length === 0,
  `DOCX HTTP 遗留临时目录：${leakedTemporaryDirectories.join(", ")}`
);

fs.mkdirSync(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, "server-http.docx");
const reportPath = path.join(
  outputDirectory,
  "server-http-report.json"
);
fs.writeFileSync(outputPath, response.rawPayload);
const result = {
  outputFile: path.relative(repositoryDirectory, outputPath),
  bytes: response.rawPayload.byteLength,
  headers: {
    contentType: response.headers["content-type"],
    contentDisposition: response.headers["content-disposition"],
    cacheControl: response.headers["cache-control"],
    serverTiming: response.headers["server-timing"],
    warningCount: response.headers["x-docx-warning-count"],
    echartsErrorCount: response.headers["x-echarts-error-count"],
    mermaidErrorCount: response.headers["x-mermaid-error-count"]
  },
  leakedTemporaryDirectories,
  acceptance: report
};
fs.writeFileSync(
  reportPath,
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8"
);
console.log(JSON.stringify(result, null, 2));
