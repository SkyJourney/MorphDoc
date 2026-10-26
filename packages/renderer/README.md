# @morphdoc/renderer

将 Markdown 转换为统一、安全的 `#write` HTML 文档。Web 预览、服务端
PDF 和桌面端 PDF 均通过应用服务复用本包，不维护第二套 Markdown 解析
逻辑。

## 目录结构

```text
src/
  render-markdown.ts  Front Matter、Markdown 扩展、安全过滤与元数据
  index.ts            公共导出入口
tests/
  render-markdown.test.ts
```

## 支持能力

- 标题锚点、表格、任务列表、脚注和代码高亮；
- markdown-it 原生围栏代码块及 `.md-fences` DOM 兼容；
- KaTeX 数学公式；
- Mermaid 安全占位；
- `@morphdoc/markdown-echarts` ECharts YAML 围栏；
- 图片标题 DOM 与资源引用收集；
- 保留由 Web/Desktop 平台适配器处理的安全文档链接；
- `sanitize-html` 白名单过滤和统一 `<article id="write">` 输出。

## 使用

```ts
import { renderMarkdown } from "@morphdoc/renderer";

const result = renderMarkdown("# 示例", {
  language: "zh-CN"
});
```

普通围栏代码块输出为：

```html
<pre class="md-fences" lang="ts"><code class="language-ts">...</code></pre>
```

`.md-fences` 让主题负责完整代码块外观；共享预览引擎会移除内部
`code` 重复套用的行内代码盒模型，同时保留 highlight.js 的高亮 span。
Mermaid 和 ECharts 围栏继续使用各自的专用 DOM，不经过该分支。

实际应用优先通过 `@morphdoc/application` 调用，以便同时完成主题和图片
资源处理。

## 开发与验证

```powershell
pnpm --filter @morphdoc/renderer run dev
pnpm --filter @morphdoc/renderer run test
pnpm --filter @morphdoc/renderer run typecheck
pnpm --filter @morphdoc/renderer run build
```
