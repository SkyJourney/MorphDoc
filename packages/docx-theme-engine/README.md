# @morphdoc/docx-theme-engine

DOCX 主题映射引擎负责在浏览器主题 CSS 与 Word 样式之间建立稳定、可诊断
的中间协议。

当前阶段包含：

- 60 个标准 Markdown 与结构化文档语义槽位；
- 覆盖普通文档、公文、简报、项目报告和标书的标准探针 DOM；
- Chromium/Electron 计算样式快照协议；
- 不绑定具体浏览器实现的计算样式采集器；
- 可安全注入主题 CSS、等待字体并自动清理 iframe 的浏览器运行脚本；
- 基于主题 CSS SHA-256 指纹的并发合并和 LRU 快照缓存；
- CSS 长度、颜色、字体、边框和布局值的通用解析器；
- 60 个语义槽位到 Word 文本、段落、表格、媒体和结构令牌的归一化；
- 封面最小高度、垂直对齐、轮廓线和隐藏字段语义；
- 自动映射、显式覆盖和预设降级配置；
- 样式来源、映射置信度和诊断协议；
- 旧版 `docxStyle.preset` 兼容归一化，并自动升级为
  `auto-with-overrides`。

本包不负责：

- 启动 Playwright 或 Electron；
- 读取主题目录或网络资源；
- 执行 Pandoc；
- 直接修改 OOXML；
- 按主题 ID 维护专属转换分支。

Server Playwright 与 Desktop Electron 适配器负责在现有受限浏览器生命周期
中执行本包脚本；主题 CSS 和字体资源继续使用各平台已有的同源资源协议。
`@morphdoc/application` 已负责指纹、快照缓存和令牌准备，
`@morphdoc/docx-engine` 已消费本包令牌生成动态 `reference.docx`。
Flex、Grid 和超出 Word 上限的装饰边不会静默丢弃，而是保留近似
令牌与诊断，供语义文档结构层选择 Word 表格、分节或段落布局实现。
