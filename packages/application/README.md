# @morphdoc/application

Web Server 与 Electron Desktop 共用的应用服务层，组合
`@morphdoc/core`、`@morphdoc/renderer` 和
`@morphdoc/docx-engine`，统一处理 Markdown 渲染、主题发现、主题资源、
图片资源和 DOCX 导出编排。Fastify 与 Electron IPC 只负责传输和平台
能力适配。

## 目录结构

```text
src/
  application-service.ts  渲染、主题和资源用例入口
  docx-export-service.ts  DOCX 并发、超时、错误和完整导出编排
  docx-media-service.ts   DOCX 媒体尺寸计算、PNG 校验与清单组装
  docx-theme-token-service.ts 主题指纹、快照缓存和 Word 令牌准备
  image-resources.ts      本地、Base64 与受限远程图片处理
  theme-registry.ts       内置及自定义主题扫描、校验与缓存
  index.ts                公共导出入口
tests/
  application-service.test.ts
  bundled-themes.test.ts
  docx-export-service.test.ts
  docx-media-service.test.ts
  docx-theme-token-service.test.ts
  image-resources.test.ts
```

## 使用

```ts
import { createApplicationService } from "@morphdoc/application";

const service = createApplicationService({
  bundledRoot,
  localRoot
});

const themes = await service.listThemes();
const document = await service.render(request);
const preparedDocx = await service.prepareDocxExport(docxRequest);
const preparedMedia = await prepareDocxMedia(
  preparedDocx,
  platformCaptureAdapter
);
```

Web 端通过 `apps/server` 的 HTTP API 调用；桌面端在主进程中创建同一
服务，并通过受限 IPC 暴露给渲染进程。Web 默认不接收本地素材目录，
Desktop 才会以 Markdown 所在目录为边界解析相对资源。

`prepareDocxExport()` 统一校验 DOCX 请求、解析图片资源、查找主题并返回
源请求、安全渲染文档、统一语义文档、主题清单和主题 CSS。它不调用
Pandoc；后续 DOCX 引擎直接消费同一语义树生成结构计划，避免 Server、
Desktop、HTML/PDF 与 DOCX 重复解释 Front Matter。

`prepareDocxMedia()` 根据纸张方向、尺寸、主题默认页边距和用户配置计算
内容区，调用平台捕获适配器，并校验捕获计划、PNG 签名、像素尺寸、单图
大小、总大小和媒体 ID。最终按文档顺序输出稳定的 `media-001.png`
清单；它不依赖 Playwright 或 Electron，平台代码只负责 Chromium 捕获。

`DocxThemeTokenService` 复用 Server Playwright 或 Desktop Electron
适配器采集主题计算样式，按主题 CSS 指纹缓存快照并生成 56 槽位令牌。
`explicit` 模式不启动浏览器，直接使用清单覆盖和预设降级。

`DocxExportService` 串联 capability 探测、请求准备、平台媒体捕获、主题
令牌准备、Pandoc 结构转换、最终 OOXML 分节收口和验收校验。媒体与主题
令牌并行准备。默认并发为 1、队列为 4、总超时为 90 秒；
可以通过 `DOCX_CONCURRENCY`、`DOCX_MAX_QUEUE` 和 `DOCX_TIMEOUT_MS`
配置。排队、探测、准备、主题样式、媒体、模板、Pandoc、校验和总耗时使用共享协议
返回；关闭服务时会取消活动任务、拒绝排队任务并等待清理完成。

内置主题来自仓库 `themes/`，当前名称为 GitHub、Pixyll、Whitey 和
Clean。额外主题从平台传入的
本地主题根目录扫描；与内置主题 ID 冲突时以内置主题为准。

## 开发与验证

```powershell
pnpm --filter @morphdoc/application run dev
pnpm --filter @morphdoc/application run test
pnpm --filter @morphdoc/application run typecheck
pnpm --filter @morphdoc/application run build
```
