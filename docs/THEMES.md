# 主题开发指南

主题用于控制 Markdown 正文的字体、颜色、标题、表格、引用、代码块、公式和图表等视觉样式。纸张尺寸、页边距、页眉页脚、页码和 PDF 元数据属于导出配置，不应写入主题。

网页预览与未来的 Chromium PDF 必须使用相同的 `<article id="write">`、Markdown 渲染结果、主题 CSS 和打印 CSS。

## 1. 主题位置

项目支持两类主题：

```text
themes/<theme-id>/          随项目分发的内置主题
.local/themes/<theme-id>/   仅供当前设备使用的本地主题
```

- 内置主题的 `bundled` 必须为 `true`，并记录来源、作者和许可信息。
- 本地主题的 `bundled` 必须为 `false`，整个 `.local/` 目录已被 Git 忽略。
- 主题目录名必须与清单中的 `id` 完全一致。

## 2. 目录结构

最小主题：

```text
.local/themes/example/
├── theme.json
└── theme.css
```

包含基础层、打印层和资源的主题：

```text
.local/themes/example/
├── theme.json
├── base.css
├── theme.css
├── print.css
├── partials/
│   └── code.css
├── fonts/
│   └── example.woff2
└── images/
    └── quote.svg
```

每个主题必须自包含，不得通过 `../` 引用主题目录外的共享文件。

## 3. `theme.json`

完整示例：

```json
{
  "manifestVersion": 1,
  "id": "example",
  "name": "示例主题",
  "version": "1.0.0",
  "description": "用于演示主题清单的本地主题。",
  "author": "示例作者",
  "license": "MIT",
  "base": "base.css",
  "entry": "theme.css",
  "print": "print.css",
  "domPreset": "typora",
  "defaultFontSize": "16px",
  "supportedFeatures": [
    "code",
    "table",
    "task-list",
    "footnote",
    "katex",
    "mermaid"
  ],
  "bundled": false
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `manifestVersion` | 是 | 当前固定为 `1`。 |
| `id` | 是 | 小写字母、数字和连字符组成，且必须与目录名一致。 |
| `name` | 是 | 主题选择器中显示的名称。 |
| `version` | 是 | 主题版本，最长 30 个字符。 |
| `description` | 是 | 主题用途与来源说明。 |
| `author` | 是 | 作者或维护者。 |
| `license` | 是 | 许可证或本地使用边界。 |
| `base` | 否 | 可复用的基础 CSS。 |
| `entry` | 是 | 主题主体 CSS。 |
| `print` | 否 | 打印 CSS，建议将规则放入 `@media print`。 |
| `domPreset` | 是 | 当前支持 `typora`、`github`、`generic`。 |
| `defaultFontSize` | 是 | 主题建议的正文基准字号。 |
| `supportedFeatures` | 是 | 支持能力声明。 |
| `bundled` | 是 | 内置主题为 `true`，本地主题为 `false`。 |

支持能力值包括：

```text
code
table
task-list
footnote
katex
mermaid
```

## 4. CSS 组合顺序

服务端按以下顺序组合 CSS：

```text
base
→ entry
→ print
```

后加载的规则可以覆盖前面的规则。推荐职责：

- `base`：元素归一化、通用排版和分页基础规则。
- `entry`：颜色、字体、标题、表格、引用和代码块等主题视觉。
- `print`：只在打印时生效的分页与颜色调整。

如果主题不需要基础层或打印层，可以省略相应字段。

## 5. DOM 约定

渲染器输出的正文根节点固定为：

```html
<article id="write">
  <!-- 安全 Markdown HTML -->
</article>
```

主题应优先使用以下选择器：

```css
#write {
  color: #24292f;
  font-family: system-ui, sans-serif;
  line-height: 1.7;
}

#write h1,
#write h2 {
  break-after: avoid-page;
}

#write table {
  width: 100%;
  border-collapse: collapse;
  border-spacing: 0;
}

#write th,
#write td {
  border: 1px solid #d0d7de;
  padding: 0.5em 0.75em;
}
```

不要依赖某个编辑器的窗口、侧边栏、焦点状态或源码模式专用 DOM。当前预览和未来 PDF 不会添加 `typora-export` 类，纸张边距由导出配置负责。

## 6. 字体、图片和 CSS 导入

CSS 中可以使用主题目录内的相对资源：

```css
@font-face {
  font-family: "Example";
  src: url("./fonts/example.woff2") format("woff2");
}

#write blockquote {
  background-image: url("./images/quote.svg");
}
```

嵌套 CSS 可以使用相对于自身文件的资源：

```css
/* theme.css */
@import "partials/code.css";
```

```css
/* partials/code.css */
@font-face {
  font-family: "Example Mono";
  src: url("./fonts/example-mono.woff2") format("woff2");
}
```

允许通过资源接口提供的扩展名：

```text
.gif .jpeg .jpg .png .svg .webp
.ttf .woff .woff2
```

CSS `@import` 会在服务端展开，不作为静态资源直接返回。

## 7. 安全限制

主题注册器会拒绝：

- HTTP、HTTPS、协议相对地址和其他外部 URL；
- 绝对文件路径；
- 含 `..` 的 CSS、字体或图片路径；
- 逃出主题目录的符号链接；
- 非文件资源；
- CSS 循环导入；
- 超过 8 层的 CSS 导入；
- 不支持的 `@import` 语法；
- 不在允许列表中的静态资源类型。

`data:` URL 和同文档 `#fragment` 引用可以保留。编辑器专用的 `@include-when-export` 外部字体声明会被移除，主题应同时提供本地字体文件或可靠的系统字体回退。

## 8. 创建本地主题

1. 在 `.local/themes` 下创建与主题 ID 同名的目录。
2. 编写 `theme.json` 和入口 CSS。
3. 启动开发服务：

```powershell
pnpm run dev
```

4. 打开主题选择器检查主题是否出现。
5. 使用包含标题、表格、代码、公式和 Mermaid 的 Markdown 验证。
6. 检查浏览器控制台、窄屏布局和打印样式。

主题清单或资源路径无效时，服务端会拒绝加载该主题，而不是跳过安全检查。

## 9. 本地导入第三方默认主题

本机安装对应编辑器后，可以导入 GitHub、Pixyll 和 Whitey 三套适合打印的白色默认主题：

```powershell
pnpm run theme:import-typora
```

导入工具从对应编辑器的安装目录读取：

```text
resources/style/base.css
resources/style/themes/
```

每套主题都会获得独立的 `typora-base.css`、主题 CSS、资源目录和 `theme.json`。已有目标默认不会被覆盖。

确认替换现有本地副本时使用：

```powershell
pnpm run theme:import-typora -- --replace
```

替换前会先在临时目录完整生成主题；旧副本移动到：

```text
.local/theme-backups/
```

普通导入结果仍默认保存在 `.local`。GitHub、Pixyll 和 Whitey 三套第三方主题
已作为内置资源随项目分发，来源与作者记录在 `themes/THEME_NOTICE.md`。

## 10. 提交内置主题前检查

- 许可证明确允许目标范围内使用，或已在清单和内部说明中记录限制。
- 主题目录不包含用户文档、临时文件或无关资源。
- `pnpm test` 通过。
- `pnpm run typecheck` 通过。
- `pnpm run build` 通过。
- `git diff --check` 通过。
- 浏览器检查表格、长代码块、KaTeX、Mermaid、字体和分页边界。
