# @morphdoc/preview-engine

墨呈的共享预览与分页引擎。Web 连续/快速预览、服务端
Playwright PDF 和 Electron PDF 均通过同一套运行时完成媒体渲染、尺寸
适配与 Paged.js 分页。

## 目录结构

```text
src/
├── index.ts                    公共导出入口
├── paged-document-runtime.ts   连续与分页渲染主流程
├── paged-preview.ts            分页载荷、消息协议与页面 CSS
├── continuous-preview.ts       无分页 DOM 更新与稳定节点复用
├── docx-media-runtime.ts       DOCX 连续媒体舞台与 PNG 捕获计划
├── incremental-pagination.ts   修改边界、稳定前缀与后缀分页缓存
├── paged-table-handler.ts      跨页表格表头处理
├── media-page-backfill.ts      图片与图表按文档顺序回填
├── document-image-fit.ts       Markdown 图片单页适配
├── mermaid-*.ts                Mermaid 配置、渲染与尺寸适配
├── echarts-page-fit.ts         ECharts 单页适配
├── diagram-page-fit.ts         图像类元素的共享几何计算
├── pdf-document-links.ts       PDF 本地链接暂存编码
├── preview-styles.ts           预览/打印媒体样式转换
└── paged-render-target.ts      Preview 与 PDF 运行目标
tests/                          引擎单元测试
```

## 使用方式

宿主负责提供渲染根节点和三份第三方样式，公共引擎不依赖 Vite 的
`?inline` 导入语法：

```ts
import { PagedDocumentRuntime } from "@morphdoc/preview-engine";

const runtime = new PagedDocumentRuntime(root, {
  highlightCss,
  katexCss,
  echartsCss
});

const result = await runtime.render(payload, {
  target: "preview",
  mermaidOutput: "svg-image"
});

const continuous = await runtime.renderContinuous(payload);

const mediaPlan = await renderDocxMediaCapturePlan(
  runtime,
  root,
  payload,
  {
    contentWidthPx,
    contentHeightPx
  }
);
```

`payload` 使用 `@morphdoc/core` 中的 `PagedDocumentPayload`。主题 CSS、
纸张尺寸、页边距、页眉页脚及 Markdown 功能标识都随载荷传入。

## 连续预览与增量分页

- `renderContinuous()` 不创建纸张和分页节点，只更新统一 `#write` DOM；
- 连续模式仍等待并渲染 Mermaid、ECharts、图片和字体；
- 快速分页为源块生成稳定身份，编辑后保留修改点之前的分页结果；
- 重新计算从最早受影响位置开始，后续页面串行生成；
- 缓存不参与 Playwright/Electron 的最终 PDF 权威输出。

围栏代码块遵循 `.md-fences` DOM 约定：外层 `pre.md-fences` 负责主题样式，
内部语义 `<code>` 会清除重复的行内代码背景、边框、内边距和字号缩放，
不使用 `!important`，自定义主题仍可用更具体规则覆盖。

## 媒体分页

图片、Mermaid 和 ECharts 必须与紧邻标题作为同一媒体块。引擎按 DOM
文档顺序串行处理，每个媒体元素至多回填或缩放一次。图片先按内容限宽
得到基准高度；上一页空白与媒体需求接近时，才尝试只缩放媒体主体回填，
标题始终保持自然尺寸。

## DOCX 媒体舞台

`renderDocxMediaCapturePlan()` 复用连续渲染流程，等待字体、图片、
Mermaid 和 ECharts 完成后，按 DOM 顺序标记普通图片、Mermaid SVG 与
ECharts SVG。运行时将媒体限制在纸张内容区内，并返回整数外包围捕获框、
显示尺寸、替代文本、图注和目标位图倍率。

目标倍率默认为 3.125（300 DPI），并受 4096px 单边和 1600 万像素上限
约束。运行时只生成平台无关的捕获计划；Server 使用 Playwright Chromium，
Desktop 使用 Electron Chromium 输出 PNG。

## PDF 链接

`preparePdfDocumentLinks()` 仅在 PDF 目标中将本地链接编码为
`https://morphdoc.local.invalid/...`。PDF.js 注释层通过 core 解码后交给
Web/Desktop 平台处理，HTTP/HTTPS 和文档内锚点保持原始 PDF 行为。

## 设计边界

- 本包不解析 Markdown；语义 HTML 由 `@morphdoc/renderer` 生成。
- 本包不读取文件、不发 HTTP 请求，也不决定 Web 或 Electron 平台行为。
- 第三方展示样式由宿主注入，便于浏览器、Playwright 和 Electron 复用。
- 媒体块按文档顺序串行判断回填，每个媒体元素至多触发一次重排。
- 连续与分页模式共享媒体渲染、链接和样式契约，不维护两套引擎。

## 验证

```powershell
pnpm --filter @morphdoc/preview-engine run test
pnpm --filter @morphdoc/preview-engine run typecheck
pnpm --filter @morphdoc/preview-engine run build
```
