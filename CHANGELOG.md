# 变更日志

本文档记录 MorphDoc（原 Markdown PDF 导出器）的重要版本变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[Semantic Versioning](https://semver.org/lang/zh-CN/)。发布时以对应版本章节作为
Gitea Release 页面正文的基础；构建产物、校验和及详细验收记录可继续写入
`docs/releases/v<version>.md`。

## [Unreleased]

### 变更

- 暂无。

## [0.6.4] - 2026-08-26

### 新增

- 桌面端新增 macOS 打包能力：`electron-builder` 增加独立 `mac` 配置块，产出
  `dmg`，按 arm64、x64 分别单独构建，不产出 universal 包（内置完整
  Chromium/Electron 与固定版本 Pandoc，合并双架构会让单包体积翻倍）。
- Pandoc 运行时清单新增 `darwin/arm64`、`darwin/x64` 两个官方发行项及独立
  许可证文件来源（macOS 官方 zip 本身不随附许可证文本）；桌面 Pandoc 候选
  路径与 `prepare-pandoc-runtime.mjs` 均已泛化为按 `--platform`/`--arch`
  参数选取目标，不再只认 Windows x64。

### 修复

- 修复 `apps/desktop/scripts/prepare-pandoc-runtime.mjs` 解压内置 Pandoc 时
  未保留 Unix 可执行权限位的问题（`unzipSync` 不保留压缩包内的权限信息），
  macOS/Linux 上解压出的二进制此前无法直接执行。
- 修复根 `package.json` 中 `build:web-runtime`、`dev`、`desktop:dev` 三个
  脚本的构建顺序错误：`@morphdoc/application` 依赖
  `@morphdoc/preview-engine`，但被排在其构建之前，在没有历史 `dist/`
  残留的全新环境（如全新克隆 + 全新 `pnpm install`）中会导致类型解析失败。
- 修正 `AGENTS.md` 中硬编码的 Windows 绝对路径与强制 PowerShell 语法，改为
  按当前 Shell 与仓库实际位置自适应。
- 修正测试用例 `packages/docx-engine/tests/pandoc-runtime.test.ts` 中硬编码
  反斜杠路径分隔符的断言，避免该测试仅能在 Windows 宿主上通过。

### 验证

- `docx-engine` 包 15 个测试文件、93 项测试通过；类型检查通过。
- 本机 macOS（Apple Silicon）实测：`pnpm run package:mac:arm64` 全链路成功，
  内置 darwin-arm64 版 Pandoc 3.9.0.2 完成下载、哈希校验与真实 DOCX 冒烟
  转换；未打包应用（`--dir`）可正常启动，主进程/渲染进程/GPU 进程/网络
  服务进程均稳定运行，AppleScript 可正常触发退出。实际截图确认窗口、
  macOS 原生菜单栏、Markdown 编辑器工具栏、中文字体与实时预览（标题、
  任务列表、表格、行内公式、引用块）均渲染正常。
- 补跑跳过真实语料依赖的全部工作区测试与全项目类型检查、生产构建均
  通过；`test:docx-real-world-corpus` 与 `test:docx-release-gate-suites`
  依赖 Git 忽略的真实客户文档语料（`tmp/`），本机没有该目录，这两步
  在当前环境下无法验证，留待接入真实语料的机器上执行。

### 兼容与部署

- 本版本仅完成开发基础设施与验证，未构建正式发行文件：没有产出真实签名
  的 dmg、没有重新构建 Windows 安装包，也没有重新构建 Docker 镜像；正式
  macOS 发行产物、Windows/Docker 同步验证留待后续门禁阶段完成后一并发布。

## [0.6.2] - 2026-08-26

### 修复

- 修复真实长文档中表格分页后的列宽、偏移和行样式丢失，冻结逻辑表格列轨并将
  打印几何稳定传递到 Paged.js 分片。
- 修复 Markdown 表格中 `<br>` 变体、连续换行、实体和行内代码的 DOCX 翻译，
  避免换行逃逸到目标单元格段落之外。
- 修复全 JSON 围栏缩进、表格末行对齐、代码高亮和行内代码连续性。
- 改进 PDF 文本流排序和数值范围归一化，减少窄字符重叠、跨视觉行破折号及重复
  表头映射造成的视觉比较误报。

### 验证

- 合成基线与真实文档样本A两套严格门禁为 `280/280`，真实文档样本C为
  `140/140`。
- 真实文档样本B残余误报为 `6/115`（`5.22%`），均核查为重复表头自动对齐或
  取样错配，基础设施错误为 0。
- 全项目测试、类型检查、生产构建、正式 Docker、内置字体 NSIS/ZIP 和离线发行
  归集通过。

### 发行与兼容性

- Desktop 安装器、免安装 ZIP 与 Docker 镜像统一为 0.6.2。
- Docker 继续内置固定 Chromium、Pandoc 3.9.0.2 和受校验字体包；Desktop
  继续直接内置 Serif、Sans、Mono 字体，无需安装系统字体。
- Windows 安装器尚未进行 Authenticode 签名，公开分发前需要完成签名。

## [0.6.1] - 2026-08-04

### 修复

- 重构通用 CSS 到 WordprocessingML 翻译链，统一字体、字号、行距、段距、缩进、
  边框、底纹、表格、引用和代码样式。
- 修复字体实际嵌入、中文标点字距、精确行距、打印媒体环境和 Markdown 行内代码
  连续性问题。

### 验证

- 建立 14 套主题 × 两个方向 × 五组页边距的 140 场景视觉矩阵，`140/140`
  全部通过。
- 四套独立封面执行 Chromium、Word、WPS 整页严格门禁，正文执行与物理分页无关
  的语义块门禁。
- 源码服务、Docker Web API 和实际安装 Desktop 三条生产 DOCX 导出链通过。

### 发行与兼容性

- Serif、Sans、Mono 三套字体直接内置于 Desktop 安装器和免安装 ZIP，不再发布
  独立字体安装器或字体 ZIP。
- Docker 内置固定 Chromium、Pandoc 3.9.0.2 和三套正式字体包。

## [0.6.0] - 2026-08-02

### 新增

- 新增原生可编辑 DOCX 导出，支持 Microsoft Word 与 WPS，并保留纸张、页边距、
  字体、段落、标题、代码块、表格、媒体、封面、页眉页脚和页码配置。
- 建立通用主题到 DOCX 样式翻译引擎，覆盖 14 套内置主题。
- 新增可扩展 Markdown 工具栏，支持标题、强调、代码、引用、列表、任务列表、
  分隔线及 M×N 表格。
- PDF 与 DOCX 统一收口至“导出”菜单，并提供生成进度提示。

### 变更

- 产品更名为“墨呈”，英文名 MorphDoc，并保留原 NSIS 安装身份以支持覆盖升级。
- Desktop 内置固定 Pandoc 3.9.0.2；Docker 内置 Chromium、Pandoc 和正式字体，
  支持完全离线部署。
- 正式字体资产改由仓库固定目录管理（公开版已取消 Git LFS），发行产物统一归集到 `release/v<version>/`。

### 修复

- 修复精确预览放大后的右侧留白、保存与导出默认路径、Desktop DOCX 媒体捕获
  超时及品牌迁移后的安装目录问题。

## [0.5.1] - 2026-07-29

### 新增

- 新增 4 套红头、3 套正式文档和 3 套标书主题，内置主题总数增至 14 套。
- 支持主题推荐页边距、页面装饰、页眉页脚、页码和结构化公文、报告及标书
  Front Matter。
- 内置 Fandol 中文字体、两份教程和 14 份主题示例。
- Desktop 增加新建、保存、另存为快捷键和未保存确认；另存为后跟随新路径。

### 修复

- 修复红头标题居中、正式文档字体、代码块长内容越界和大型代码块跨页留白。
- Docker Web 镜像补齐 `samples` 目录。

### 兼容性

- 未声明主题推荐设置的主题继续使用原有 16mm 默认页边距。

## [0.5.0] - 2026-07-28

### 新增

- 新增共享 Preview Engine，统一 Web 连续预览、快速分页、Playwright PDF 与
  Electron PDF 渲染链路。
- 新增连续预览和修改位置之后的增量分页，支持稳定前缀复用。
- Desktop 支持多窗口、同文件单例、本地路径与 Markdown 链接，以及聚焦时检测
  外部文件变化。
- Web 统一处理文档锚点和 HTTP/HTTPS 外链。

### 变更

- 内置主题统一为 GitHub、Pixyll、Whitey 和 Clean。
- Windows 安装包统一使用 NSIS，并提供免安装 ZIP。

### 修复

- 修复连续预览双滚动条、ECharts 尺寸、PDF 本地链接、围栏代码块样式和发行包
  复用陈旧 Web 构建产物的问题。

## [0.4.5] - 2026-07-28

### 新增

- Web 与 Desktop 支持新建和保存 Markdown；Desktop 增加 `.md`、`.markdown`
  文件关联、单实例系统打开、自定义主题目录和窗口状态恢复。
- 新文档可按一级标题或首行生成合法文件名，并直接导出 PDF。

### 变更

- 图片、Mermaid 和 ECharts 改为按文档顺序串行执行媒体分页回填，每个媒体元素
  至多重排一次，并保持标题原尺寸。
- Web 取消本地素材目录入口。

## [0.4.4] - 2026-07-27

### 变更

- Desktop 发行包仅保留简体中文和英文语言资源，显著缩减目录版、安装包和 ZIP
  体积，同时保留 Chromium 图形与软件渲染后备组件。

## [0.4.3] - 2026-07-27

### 变更

- Windows Desktop 从 Squirrel 迁移到标准 NSIS 安装向导，支持安装范围和安装目录
  选择。
- 安装包改用英文、无空格、包含版本与平台的文件名，并继续提供免安装 ZIP。

## [0.4.2] - 2026-07-27

### 变更

- 移除 Windows Desktop 原生应用菜单栏，使应用内容直接位于系统标题栏下方。
- 此版本仅更新 Desktop，Web 与 Docker Compose 继续保持 0.4.1。

## [0.4.1] - 2026-07-27

### 新增

- 支持 Web 素材目录、Desktop 同目录资源和受限公网图片下载。
- 支持图片标题、图片整块分页以及超高图片在单页内容区内自适应缩放。

### 修复

- 修复本地与网络图片的资源解析、自然尺寸解码和 PDF 分页边界问题。

## [0.4.0] - 2026-07-27

### 新增

- 首次发布 Electron Windows Desktop，复用与 Web 相同的渲染和 PDF 核心。
- 支持桌面 Markdown 文件选择、原生保存和离线 PDF 导出。

### 修复

- 固定桌面端英文可执行文件名，避免中文名称影响安装和自动化链路。

## [0.3.1] - 2026-07-27

### 新增

- 扩展 ECharts 第二阶段图表协议和示例覆盖，完善更多系列、坐标轴及组合图表。

## [0.3.0] - 2026-07-27

### 新增

- 新增 ECharts YAML 围栏、安全校验、浏览器 SVG 渲染和 PDF 输出。
- 增强编辑区折叠、页码导航和快速预览外层滚动交互。

### 修复

- ECharts 媒体块参与统一不可跨页处理，避免图表被分页裁断。

## [0.2.0] - 2026-07-27

### 新增

- 完善 Mermaid 配置、安全渲染、资源等待和预览缩放。
- 增强长文档分页、滚动同步和预览/PDF 边界处理。

### 变更

- 收敛 Web 预览和 Chromium PDF 的共享渲染抽象，减少链路分叉。

## [0.1.0] - 2026-07-26

### 新增

- 实现 Markdown 安全渲染核心、网页实时预览、本地主题兼容和导出设置。
- 支持真实分页预览、固定 Chromium PDF 导出和 PDF 精确预览。
- 支持长文档分页、页码导航、滚动同步以及 AIO Docker 容器部署。

[Unreleased]: https://github.com/SkyJourney/MorphDoc/compare/v0.6.4...main
[0.6.4]: https://github.com/SkyJourney/MorphDoc/releases/tag/v0.6.4
[0.6.2]: https://github.com/SkyJourney/MorphDoc/releases/tag/v0.6.2
[0.6.1]: https://github.com/SkyJourney/MorphDoc/releases/tag/v0.6.1
[0.6.0]: https://github.com/SkyJourney/MorphDoc/releases/tag/v0.6.0
[0.5.1]: https://github.com/SkyJourney/MorphDoc/releases/tag/v0.5.1
[0.5.0]: https://github.com/SkyJourney/MorphDoc/releases/tag/v0.5.0
[0.4.5]: https://github.com/SkyJourney/MorphDoc/releases/tag/v0.4.5
[0.4.4]: https://github.com/SkyJourney/MorphDoc/releases/tag/v0.4.4
[0.4.3]: https://github.com/SkyJourney/MorphDoc/releases/tag/v0.4.3
[0.4.2]: https://github.com/SkyJourney/MorphDoc/releases/tag/v0.4.2
[0.4.1]: https://github.com/SkyJourney/MorphDoc/releases/tag/v0.4.1
[0.4.0]: https://github.com/SkyJourney/MorphDoc/releases/tag/v0.4.0
[0.3.1]: https://github.com/SkyJourney/MorphDoc/releases/tag/v0.3.1
[0.3.0]: https://github.com/SkyJourney/MorphDoc/releases/tag/v0.3.0
[0.2.0]: https://github.com/SkyJourney/MorphDoc/releases/tag/v0.2.0
[0.1.0]: https://github.com/SkyJourney/MorphDoc/releases/tag/v0.1.0
