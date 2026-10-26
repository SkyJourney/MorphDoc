# @morphdoc/core

跨 Web、Server、Desktop 和渲染器共享的纯数据模型与校验规则。该包不
依赖浏览器、Electron 或 Fastify，负责保证各运行端使用同一份协议。

## 目录结构

```text
src/
  document.ts       Markdown 文档、分页载荷、结果与耗时模型
  document-link.ts  跨端链接分类与 PDF 本地链接编码协议
  docx.ts           DOCX 请求、能力、错误、结果与文件名协议
  docx-style.ts     主题 DOCX 样式预设和安全覆盖协议
  export-config.ts  纸张、边距、页眉页脚、页码与图表配置
  theme.ts          主题清单、主题能力与 CSS 载荷模型
  index.ts          公共导出入口
tests/
  document.test.ts
  document-link.test.ts
  docx.test.ts
  export-config.test.ts
```

## 使用

```ts
import {
  classifyDocumentLink,
  createDocxFileName,
  createPagedDocumentPayload,
  defaultExportConfig,
  docxExportRequestSchema,
  exportConfigSchema
} from "@morphdoc/core";

const link = classifyDocumentLink("../docs/example.md");
const config = exportConfigSchema.parse(defaultExportConfig);
const docxRequest = docxExportRequestSchema.parse({
  markdown: "# Example",
  exportConfig: config
});
const docxFileName = createDocxFileName("example.md");
const payload = createPagedDocumentPayload({
  document,
  fileName: "example.md",
  themeCss,
  exportConfig: config
});
```

DOCX 协议固定 Pandoc `3.9.0.2`，并统一定义跨 HTTP/IPC 使用的请求、
capability、错误码、结果、诊断、耗时、媒体捕获计划和 PNG 资源清单。
媒体协议固定 300 DPI 目标倍率，并限制边长、总像素、单文件大小和总量。
该包只描述数据协议，不启动 Pandoc、浏览器或读写临时文件。

`classifyDocumentLink()` 只负责稳定分类，不执行平台动作。Web 根据分类
处理锚点和网络链接；Desktop 决定是否调用浏览器、系统程序或打开新的
Markdown 窗口。精确 PDF 使用保留的 `.invalid` 地址暂存本地链接，
PDF.js 注释层展示时再安全解码，避免 Chromium 将相对路径误转成站点 URL。

新增跨端字段时，应先在这里定义类型、默认值、Zod 校验和兼容迁移，再由
各适配层消费，避免 Web 与 Desktop 分别维护协议。

## 开发与验证

```powershell
pnpm --filter @morphdoc/core run dev
pnpm --filter @morphdoc/core run test
pnpm --filter @morphdoc/core run typecheck
pnpm --filter @morphdoc/core run build
```
