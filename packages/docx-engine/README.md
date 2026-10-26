# @morphdoc/docx-engine

纯 Node.js 的 DOCX 模板和 Pandoc 编排核心。当前阶段负责读取固定 Pandoc
版本的默认 `reference.docx`、验证 ZIP 安全边界，将归一化主题令牌和
兼容样式预设映射为 Word 样式，并生成纸张、页边距、字体、段落、代码、表格、
页眉、页脚和页码均已映射的动态模板。Pandoc 转换器通过静态 Lua Filter
将普通图片、Mermaid 和 ECharts 节点替换为受控 PNG，同时保留 Markdown
正文、标题、列表、表格、代码和公式的可编辑文档结构。统一语义文档模型
会先转换为主题无关的 Pandoc 结构计划，Lua Filter 再绑定标准 Markdown
样式与 `Md*` 结构样式；生成后的 OOXML 收口层负责真实分节、封面页眉页脚
隔离、正文页码重启、表格内容区全宽和分页控制。

## 设计边界

- 不依赖 Fastify、Electron 或浏览器 UI；
- ZIP 使用纯 JavaScript `fflate`；
- OOXML 使用 `@xmldom/xmldom`，不拼接未经转义的用户 XML；
- 不解析任意主题 CSS，只消费 `@morphdoc/docx-theme-engine` 的受限
  语义令牌；`docxStyle` 预设在槽位缺失时提供兼容降级；
- 槽位只映射到稳定的标准或 `Md*` Word 样式，不包含主题 ID 分支；
- Front Matter 结构、标题策略和分节意图只消费统一语义文档模型，不按
  主题 ID 编写转换分支；
- 生成结果会复验全部 XML、包内关系、内容类型、最终节和关键样式；
- 最终 DOCX 必须清除全部内部结构标记，并校验实际样式使用、分节、
  `SECTIONPAGES`、全宽表格和标题去重；
- 每次转换使用独立临时目录、隔离 Pandoc data 目录并在 `finally` 清理；
- 媒体映射检查顺序、PNG、像素、单图/总大小和物理显示尺寸；
- 并发排队、跨端用例编排和错误协议映射由
  `@morphdoc/application` 的 `DocxExportService` 统一负责。

## 安全限制

- 输入模板压缩包不超过 2 MiB；
- ZIP 条目不超过 256 个；
- 解压后总大小不超过 64 MiB；
- 拒绝加密、ZIP64、未知压缩方法、重复路径和路径穿越；
- 必须包含文档、样式、字体、编号、设置、关系和内容类型等关键部件。
- 最终 DOCX 不超过 64 MiB、512 个部件和 128 MiB 解压内容。

## 验证

```powershell
pnpm --filter @morphdoc/docx-engine run test
pnpm --filter @morphdoc/docx-engine run typecheck
pnpm --filter @morphdoc/docx-engine run build
pnpm run verify:docx-reference
pnpm run verify:docx-conversion
pnpm run verify:docx-acceptance
pnpm run verify:docx-theme-styles
pnpm run verify:docx-themes
```

`verify:docx-reference` 要求本机 `PATH` 中存在 Pandoc 3.9.0.2，也可以通过
`DOCX_PANDOC_PATH` 指定可执行文件。脚本从 Pandoc 读取原始默认模板，
分别验证公文 A4 与自定义横向模板，并在系统临时目录中完成转换和清理，
不会保留用户文档或验收产物。

`verify:docx-acceptance` 使用综合 Markdown 夹具和固定 Pandoc 生成技术
文档 A4、公文 A4、技术文档 Letter 横向三套 DOCX，自动检查纸张、页边距、
原生段落、标题、编号、表格、链接、脚注、OMML、PNG、页眉页脚、页码、
关键样式和 `altChunk` 禁用门禁。DOCX 与 JSON 报告写入被 Git 忽略的
`output/docx-acceptance/`，供 Word/WPS 互操作验收使用。根级命令还会
依次执行动态模板、媒体转换、Server HTTP 和 Desktop 原生保存验收；
仅需重跑三配置矩阵时可使用 `pnpm run verify:docx-matrix`。

`verify:docx-theme-styles` 使用 Playwright 与 Electron 分别采集 14 套
内置主题的 60 个槽位，检查跨引擎令牌一致性，并使用固定 Pandoc 默认
模板生成 14 份动态 `reference.docx`。模板矩阵检查标准 Markdown 样式、
结构化 `Md*` 样式、正文字体、字号、字体表和缓存指纹。

根级 `verify:docx-themes` 会先重新构建运行时并使用 Playwright Chromium
生成本轮真实主题令牌，再以固定 Pandoc 生成 14 份最终 DOCX。矩阵硬门禁
覆盖标准样式、原生页眉页脚、结构字段完整率、封面真实分节、正文页码
重启、`SECTIONPAGES`、内容区全宽表格、标题去重、内部标记清理和
`altChunk` 禁用；不会使用陈旧快照或合成令牌降级。
