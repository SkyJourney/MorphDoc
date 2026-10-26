# 墨呈进度

最后更新：2026-08-26

## v0.6.4 环境自适应与 macOS 打包

- `AGENTS.md` 不再硬编码 Windows 绝对路径与强制 PowerShell 语法；会话启动检查改为
  动态确认仓库根目录，命令语法跟随当前会话实际 Shell。
- 新增 macOS 桌面打包能力：`electron-builder` 增加独立 `mac` 配置块，产出 `dmg`，
  按 arm64、x64 分别单独构建、不产出 universal 包；Pandoc 运行时清单新增
  `darwin/arm64`、`darwin/x64` 两个官方发行项（含独立许可证文件来源，因为 macOS
  官方 zip 本身不随附许可证文本），`prepare-pandoc-runtime.mjs` 与桌面 Pandoc
  候选路径均已泛化为按 `--platform`/`--arch` 参数选取目标。
- 顺手发现并修复两个此前从未在 macOS 全新环境下暴露过的真实 bug：
  解压内置 Pandoc 时未保留 Unix 可执行权限位（`unzipSync` 不保留压缩包内权限，
  已补 `chmod 0o755`）；根 `package.json` 的 `build:web-runtime`/`dev`/`desktop:dev`
  把 `@morphdoc/application` 排在其依赖的 `@morphdoc/preview-engine` 之前构建，
  在没有历史 `dist/` 残留的全新环境中会导致类型解析失败，已调整构建顺序。
- 本机 macOS（Apple Silicon）实测：`pnpm run package:mac:arm64` 全链路成功，内置
  darwin-arm64 版 Pandoc 3.9.0.2 完成下载、哈希校验与真实 DOCX 冒烟转换；未打包
  应用（`--dir`）可正常启动，主/渲染/GPU/网络服务进程均稳定运行，可正常退出。
  实际截图确认窗口、macOS 原生菜单栏、编辑器工具栏、中文字体与实时预览（标题、
  任务列表、表格、行内公式、引用块）均渲染正常。
- 跳过依赖真实语料的 `test:docx-real-world-corpus`、`test:docx-release-gate-suites`
  后，其余全部工作区测试、全项目类型检查和生产构建均通过；这两步依赖 Git 忽略、
  需从可信来源单独提供的真实客户文档（`tmp/`），本机没有该目录，留待接入真实
  语料的机器上执行。
- 本版本仅完成开发基础设施与验证，未构建正式发行文件：没有产出真实签名的
  dmg、没有重新构建 Windows 安装包，也没有重新构建 Docker 镜像；下一步是统一
  DOCX 发布门禁的产出目录规范（版本号动态化，不再写死）并新增清理脚本，随后
  评估四套 140 门禁矩阵的并行执行策略。

## v0.6.2 DOCX 发布门禁结论

- 原整批 560 已停用，有效门禁由四套相互独立的 140 组成，未启动、恢复或重建旧 560 流程。
- 标准合成基线和真实文档样本A严格执行完成，合计 `280/280`。真实文档样本C完成 `140/140`；其后仅比较器文本映射变更，应用渲染与 DOCX 字节链未改变。
- 真实文档样本B在 115 个已完成样本中，通用文本修复将残余门禁误报收敛为 6 个，比例 `5.22%`，基础设施错误为 0。
- 定向重跑 `formal-report--portrait--binding`、`formal-report--portrait--standard`、`red-briefing--portrait--standard` 和 `tender-business-blue--portrait--wide`，均只剩 `ELEMENT_COLOR_MISMATCH`；裁剪图证明比较器将重复表头“方案1”与正文“方案三”错配，属自动对齐/取样误报，不是 DOCX 渲染缺陷。
- 按本次发布决策，合成基线与样本A保持严格通过；样本B和 样本C 在失败率不超过 10% 且所有残余问题核查为非渲染误报后宽松通过。四套发布门禁已结案，进入 v0.6.2 统一验证与发行构建。
- v0.6.2 全项目测试、类型检查、生产构建及 `git diff --check` 已通过。
  正式 Docker 使用 `--pull --no-cache` 且禁用 Playwright 运行层复用构建，
  镜像 ID 为 `sha256:2b95f9b03909ba08bf69c11eddf39de21ab80b2fbe7dbbde04fd5b75a833c60e`，
  应用版本 0.6.2、Pandoc 3.9.0.2、固定 Chromium 和三套内置字体均已核验。
- `release/v0.6.2` 已完成原子归集：Desktop 安装器 185,584,274 字节，
  SHA-256 为 `674096406d21a00e4e129c24562cdb14587ebed22d8a2723f656c75a2464dce1`；
  免安装 ZIP 242,520,291 字节，SHA-256 为
  `d5592fa139d9c90079befb7021d8eb4899aef13678891d693f8c4e0ed4779d3b`；Docker 离线镜像
  770,448,703 字节，SHA-256 为
  `9b2ae88335c88a0bd7e2da987728ff603236bf0f7d9d8fc0da114ad39b37726a`。

## 1. 当前概况

项目目录：

```text
<项目根目录>
```

当前分支：

```text
main
```

已有提交：

```text
b459def fix: 修复预览与 PDF 渲染边界问题
d93728b feat: 完善 Mermaid 配置与预览缩放
d1b5880 feat: 实现 Chromium PDF 导出与精确预览
d625523 fix: 修复长文档分页与滚动同步
1d93f31 feat: 实现真实分页预览
52cf816 feat: 完善导出设置与打印预览
ec14f79 feat: 扩展本地主题兼容能力
fa07472 feat: 实现网页实时预览
7224dfd feat: 实现 Markdown 渲染核心
ec48bce chore: 初始化项目骨架
```

`v0.4.1` 图片资源阶段已经完成：Web 素材目录、Desktop 同目录资源、
受限公网图片下载、可见图片标题、图片整块分页与超高图片单页适配均复用
统一渲染链路。Electron 安装包和 Docker Compose 发布候选均已通过验证。

`v0.4.2` 为仅面向桌面端的维护版本：移除 Windows 原生应用菜单栏；
Web/Compose 发布仍保持 `v0.4.1`。

`v0.4.3` 将桌面发行包迁移为标准 NSIS 安装向导，并使用全英文、无空格、
包含版本与平台的安装包文件名；Web/Compose 发布仍保持 `v0.4.1`。

`v0.4.4` 仅精简 Electron 桌面发行包的语言资源，保留简体中文和英文；
Web/Compose 发布仍保持 `v0.4.1`。

`v0.4.5` 同步更新 Web 与 Desktop：新增新建/保存 Markdown、桌面文件
关联、窗口状态恢复、自定义主题目录和收纳式“更多”菜单；Web 明确取消
本地素材目录。图片、Mermaid 与 ECharts 的分页算法统一为按文档顺序
串行计算的媒体块回填，每个媒体元素至多重排一次，标题保持原尺寸。

`v0.5.0` 完成渲染架构和桌面文档工作流升级：分页与连续预览抽取为共享
`packages/preview-engine`，快速预览支持从修改位置复用稳定前缀；Web
增加连续预览和受控外链，Desktop 支持多窗口、同文件单例、本地链接及
聚焦时外部文件变化提示。四套主题统一命名，并修复围栏代码块的 DOM
兼容和桌面发行包复用陈旧 Web 产物的问题。

`v0.5.1` 正式版新增 10 套政企与标书主题、规范页边距和页面装饰、
结构化公文 Front Matter、内置中文字体、教程及 14 份主题示例；同时
重组“更多”菜单，补齐桌面文件快捷键、未保存确认和跟随新路径的另存为，
并修复红头标题居中、代码块自动换行、左侧内容留白和跨页分页。Windows
安装包、Docker Compose、本机安装与发布验证均已完成。

`v0.6.0` 已完成开发立项，核心范围冻结为 DOCX 导出与 Markdown
工具栏。DOCX 采用 Node.js 编排、固定版本 Pandoc、动态
`reference.docx` 和 Chromium/Electron 高分辨率 PNG 媒体管线，不引入
Python；左侧编辑器计划升级为 CodeMirror 6，并通过项目自有命令注册层
支持基础工具栏及后续 Front Matter、ECharts YAML 工具扩展。完整设计与
验收门禁见 [v0.6.0 设计文档](V0.6.0_DESIGN.md)。

`v0.6.1` 已冻结为 DOCX 视觉一致性和发布门禁修复版本。发布后复核确认
`v0.6.0` 的 14 主题矩阵主要验证 CSS 槽位、OOXML 结构和样式存在性，
六个视觉场景只覆盖五套主题；视觉报告中的像素、墨迹 IoU 和边缘 IoU
failure 还被外层白名单过滤，导致报告失败时总门禁仍可通过。`v0.6.1`
要求四套独立封面执行 Chromium、Word、WPS 整页硬门禁，正文改为跨页
无关的语义块局部视觉门禁，并对字体真实解析、嵌入和发布后三条生产链路
建立阻断验收。完整范围见 [v0.6.1 设计文档](V0.6.1_DESIGN.md)。

`v0.6.1` 最终视觉矩阵已完成：14 套内置主题 × 纵横两个方向 × 主题默认、
标准、紧凑、宽松、非对称装订五组页边距共 140 个场景全部通过，阻断失败
和诊断失败均为 0。修复集中在通用 CSS 到 OOXML 翻译、字体嵌入、中文
标点字距、精确行距、打印媒体和行内代码连续性，没有引入按主题 ID 分支。
同一 `red-briefing` 已通过源码服务、Docker Web API 和实际安装 Desktop
三条生产链，三份 DOCX 均约 24.17 MB、包含 5 个字体部件；安装版产物经
真实 Word/WPS 渲染均为 2 页 A4，封面和正文逐页复核通过。

`v0.6.0` 阶段 2 已完成 Pandoc 运行时探查：固定 `3.9.0.2`，官方
Windows ZIP 和 Linux amd64 tarball 的 SHA-256 均已核验；Linux 静态程序
可直接运行于 `node:22-bookworm-slim`。Desktop 安装包预计增加约
39.34 MiB，解压目录增加约 220.35 MiB；Docker 压缩层预计增加约
32.92 MiB，运行内容增加约 154.13 MiB。项目许可证为 Apache License 2.0（开源版）。三套第三方导入主题的来源
与作者保存在各自 `theme.json` 中，并登记于 `themes/THEME_NOTICE.md`。

`v0.6.0` 发布收口阶段 A 已完成品牌与版本迁移：用户界面中文名为
“墨呈”，产品标语为“一稿多式，即写即呈”，窗口标题为
“墨呈 · MorphDoc v0.6.0”；Desktop 安装目录、可执行文件与发行产物统一
使用 `MorphDoc`。Electron `appId` 和 Markdown 文件关联 ProgID 保持不变，
并为旧版用户数据、快捷方式和应用注册项提供兼容迁移与清理。

`v0.6.0` 发布收口阶段 B 已完成 Desktop Pandoc 内置链路：发行构建根据
受版本控制的清单准备官方 Pandoc `3.9.0.2` Windows x64 ZIP，严格校验
SHA-256，只提取 `pandoc.exe`、`COPYING.rtf`、`COPYRIGHT.txt` 并生成
审计清单；打包前执行精确版本、默认模板和最小 DOCX 冒烟。生产环境优先
使用 `process.resourcesPath` 下的固定程序，无需用户安装 Pandoc，显式
开发配置和系统 PATH 降级仍保持兼容。

`v0.6.0` 发布收口阶段 C 已完成字体发行链收口。字体包构建器新增确定性
ZIP 附件，Windows 独立安装器和附件统一使用 `MorphDoc-FontPack` 名称；
Desktop 组合发行在同目录放置主安装器、字体安装器和手动 ZIP，主安装器
仅绑定字体安装器文件名与 SHA-256，检测成功时显示默认勾选项，本体及免
安装包均不包含字体包目录。Docker 构建上下文只放行受校验字体包根目录，
镜像固定内置到 `/app/.local/font-packs`，Compose 已取消字体运行时挂载。
真实 Docker 门禁确认镜像内清单哈希一致、无字体卷、Pandoc 为 3.9.0.2、
WOFF2 可用，生产 DOCX 含 5 个字体部件。当前镜像大小为 711,082,692
字节；Desktop 主安装器为 140,279,447 字节，独立字体安装器为
24,488,770 字节，字体 ZIP 为 29,186,293 字节。

`v0.6.0` 发布前 Desktop DOCX 媒体捕获超时修复已完成。共享图片等待
逻辑消除了 `decode()` 与加载事件之间的竞态，并增加有界超时；隐藏窗口
中的媒体渲染使用定时器驱动帧调度，Electron 捕获阶段临时激活合成表面，
同时为布局与单媒体截图提供可诊断的独立超时。Windows 目录版使用默认
10 页示例完成真实导出，12 个媒体全部生成 PNG，最终 DOCX 为 8,937,824
字节、包含 12 个媒体部件和 5 个字体部件；单元测试、类型检查、生产构建
及 `git diff --check` 均通过。

`v0.6.0` 发布前主题展示名已完成品牌中立化：四套基础主题分别显示为
GitHub、Clean、Pixyll 和 Whitey，默认主题仍为 GitHub。为确保覆盖升级
和历史配置兼容，`typora-github`、`typora-like`、`typora-pixyll`、
`typora-whitey` 等内部主题 ID、目录名和配置键保持不变；来源说明、作者
字段及许可证审计信息也继续保留。

`v0.6.0` 发布收口阶段 D 已建立统一发版规则。正式分发文件只允许归集到
被 Git 忽略的 `release/v<version>/`；统一脚本从 Desktop、字体包和
版本化 Docker 镜像生成安装器、便携 ZIP、字体附件、离线镜像 tar.gz、
Web 部署 ZIP、发行说明、机器可读清单及 SHA-256 校验文件，先写入临时
目录并在全部成功后原子落盘，既有版本目录禁止覆盖。正式字体资产迁入
`font-packs/assets/<id>/<semver>/` 并直接入库（后续公开版已取消 Git LFS），构建器继续严格校验
冻结字节数、哈希、内部字族名和嵌入权限。本次 `release/v0.6.0` 的 8 项
校验和全部通过，707,722,584 字节的离线镜像归档已由 `docker load` 重新
导入，镜像 ID 保持
`sha256:53bfbc9592542d4ffe9ec3017c401c6d49a28c4ee993c6c5fc00536b1d01978a`，
运行容器健康状态为 `healthy`。

`v0.6.0` 阶段 3 已完成 DOCX 共享协议：`packages/core` 统一定义请求
Schema、资源、Pandoc capability、错误码、结果、诊断、耗时、MIME 和
安全文件名；`packages/application` 新增 `prepareDocxExport()`，复用
现有主题、图片和 Markdown 安全渲染能力，为后续 Server 与 Desktop DOCX
引擎返回同一种准备结果。本阶段未新增 HTTP 路由、IPC 或 Pandoc 调用。

`v0.6.0` 阶段 4 已将左侧原生文本框升级为 CodeMirror 6，并建立项目
自有 Markdown 命令注册层和响应式基础工具栏。当前支持撤销、重做、
H1～H6、加粗、斜体、删除线、行内代码、代码块、引用、三类列表、尺寸
表格和分隔线；链接、图片等功能化工具延后。现有实现保留受控 Markdown
状态、防抖预览、文件工作流、文档脏状态、折叠恢复焦点及编辑/预览滚动
同步。外部文档替换会重置历史，单次工具栏操作形成一个 CodeMirror
事务。

`v0.6.0` 阶段 5 已完成 DOCX 资源预处理管线：复用连续预览运行时等待
图片、Mermaid、ECharts 和字体，按纸张内容区生成稳定媒体捕获计划；
Server 使用 Playwright Chromium、Desktop 使用 Electron Chromium，
统一将所有媒体捕获为 PNG。目标为 300 DPI，并限制 4096px 单边、1600
万像素、8 MiB 单图和 30 MiB 总量。本阶段只提供共享服务和平台适配器，
尚未新增 DOCX HTTP 路由、应用 IPC、Pandoc 调用或导出按钮。

`v0.6.0` 阶段 6 已完成纯 Node.js 动态 `reference.docx` 引擎：14 套
内置主题均声明结构化 DOCX 样式预设；引擎基于 Pandoc 3.9.0.2 默认模板
映射纸张、方向、页边距、正文、标题、代码、引用、表格、图注、字体、
首页/奇偶页眉页脚和动态页码。生成后会校验全部 XML、包内关系、内容
类型、最终节与关键样式，并使用稳定缓存键区分基线、Pandoc 版本、主题、
配置和元数据。本机真实 Pandoc 验收覆盖公文 A4 和自定义横向两组模板，
输出仍由标准 Word 段落、文本 Run、表格和代码文本组成，可继续编辑。

`v0.6.0` 阶段 7 已完成 Pandoc 转换服务：运行时按受信任配置、Desktop
资源、Docker 固定目录和 PATH 顺序发现并精确校验 3.9.0.2；默认模板和
动态模板使用稳定指纹与有界缓存。静态 Lua Filter 在 Pandoc AST 层将
普通图片、Mermaid 和 ECharts 替换为高分辨率 PNG，正文、表格、代码和
公式继续由 Pandoc 生成可编辑结构。每次转换使用独立临时目录和隔离的
data 目录，完成后校验 OOXML 并清理。共享应用服务提供有界并发、排队、
总超时、取消、关闭、capability、错误码和完整分阶段耗时；尚未新增
HTTP 路由、Desktop IPC 或导出按钮。

`v0.6.0` 阶段 8 已完成 Web 与 Desktop DOCX 导出交互：Server 提供
DOCX capability 与导出 HTTP API，Desktop 通过最小权限 IPC 在主进程
完成生成和原生另存为，两端复用共享服务、固定 Pandoc、PNG 媒体管线和
错误协议。顶栏原“导出 PDF”按钮升级为可扩展“导出”菜单，当前包含 PDF
与 DOCX，后续可增加 HTML 等格式；导出进度、成功和失败使用独立顶部
Toast 与非确定进度条，不污染预览状态或 PDF 精确预览缓存。Desktop
退出会等待 PDF、DOCX、Pandoc 与隐藏媒体窗口完成清理，Lua Filter 作为
明确构建资源进入桌面主进程目录。

`v0.6.0` 阶段 9 已建立 DOCX 自动化验收门禁：综合样例覆盖可编辑正文、
标题、字符样式、列表、表格、代码、链接、脚注、OMML、普通图片、
Mermaid 和 ECharts；OOXML 验收器检查纸张、方向、四边页边距、原生结构、
PNG 关系、替代文本、页眉页脚、页码、关键样式及 `altChunk` 禁用。
真实 Pandoc 3.9.0.2 矩阵生成技术文档 A4、公文 A4 和技术文档 Letter
横向三套固定产物；Server HTTP 验收覆盖 MIME、UTF-8 文件名、诊断头、
分阶段耗时和临时目录清理，Desktop 原生保存覆盖扩展名与字节完整性。
统一命令为 `pnpm run verify:docx-acceptance`，产物及 JSON 报告写入被 Git
忽略的 `output/docx-acceptance/`，供阶段 10 的 Word/WPS 双向互存使用。

`v0.6.0` 阶段 10 已完成第一轮 Word 与全主题视觉审计：页眉页脚从表格
模拟改为原生段落、制表位和页码字段，并增加禁止页眉页脚表格回退的
OOXML 校验。14 套内置主题均可由 Word 正常打开和编辑，纸张、页边距、
原生结构、页眉页脚和页码字段通过；使用 Word 原生排版引擎导出 14 份
PDF，并逐页检查 22 个页面。审计同时确认当前实现尚未达到完整主题映射
门禁：4 套独立封面均未生成，8 套结构化主题的 Front Matter 未完整进入
Word，6 套主题存在重复标题，所有表格仍为自动收缩宽度，暗标和经典黑白
主题存在错误的蓝色样式。完整结论见
[DOCX 全主题视觉与结构审计](V0.6.0_DOCX_THEME_AUDIT.md)，统一复现命令
为 `pnpm run verify:docx-themes`。

下一阶段已冻结为建立独立 `packages/docx-theme-engine`：通过标准语义
样式探针和 Chromium/Electron `getComputedStyle()` 将主题 CSS 转换为
DOCX 样式令牌，支持自动映射、清单覆盖和预设降级；Front Matter 结构
将通过与 HTML/PDF 共用的语义文档模型进入 Pandoc AST。转换逻辑不得按
主题 ID 分支，普通外部主题即使没有 `docxStyle` 也应获得可诊断的基础
DOCX 映射。

`v0.6.0` 阶段 11 的协议骨架已建立为独立
`packages/docx-theme-engine`：定义 56 个稳定语义样式槽位、浏览器计算
样式快照、Word 目标样式令牌、属性来源、映射置信度和诊断协议。
`docxStyle` 支持 `auto`、`auto-with-overrides`、`explicit` 三种模式，
普通外部主题缺少 DOCX 声明时默认进入自动映射；现有主题的 `preset` 和
扁平样式覆盖保持兼容。标准探针 DOM 已覆盖普通文档、公文、简报、项目
报告和标书，Profile 专属槽位避免同名类在不同结构上下文中互相污染；
平台无关采集器可以按稳定顺序读取全部 `getComputedStyle()` 并保留未
命中状态。Server Playwright 与 Desktop Electron 适配器已经复用现有
受限浏览器和隐藏窗口，通过临时同源 iframe 安全注入主题 CSS、等待字体、
采集样式并立即清理；映射引擎同时提供按主题 CSS SHA-256 指纹进行并发
合并和有界 LRU 缓存的快照服务，待下一阶段接入导出编排。真实矩阵对
14 套主题分别在 Playwright Chromium 151 和
Electron Chromium 150 中采集 56 个槽位，共检查两组各 784 个槽位；
两端逐槽位 `font-family`、`font-size` 和 `color` 差异为 0。统一复现
命令为 `pnpm run verify:docx-theme-styles`，结果写入被 Git 忽略的
`output/docx-theme-styles/`。

阶段 11 的计算样式归一化已经完成：通用解析器支持浏览器长度到 Word
磅值、RGB/RGBA/十六进制颜色、带引号字体候选、粗斜体、上下划线、行距、
字符间距、段落缩进与间距、四边内边距和边框、百分比宽度、分页控制；
结构令牌额外保留封面最小高度、Flex 纵向对齐、CSS outline 四边框近似
以及 `display:none` 隐藏字段。旧版仅声明 `docxStyle.preset` 的内置主题
自动升级为 `auto-with-overrides`，因此主题 CSS 成为主来源，清单覆盖
优先，原预设只在槽位缺失时降级；真正的 `explicit` 模式仍完全跳过 CSS。
Playwright Chromium 151 与 Electron Chromium 150 分别对 14 套主题生成
14 组、每组 56 槽位的 Word 令牌，跨引擎令牌差异为 0，无无效 CSS 诊断。
当前 14 条有效诊断均为 Flex/Grid 结构近似、商务标书超粗装饰边收敛或
经典标书双层边框与轮廓偏移近似，将在下一阶段由语义文档结构层消费。当前尚未将令牌接入
`reference.docx` 或 Pandoc 转换链路。

`v0.6.0` 阶段 12A 已建立独立 `packages/semantic-document` 和版本化
统一语义文档协议。普通文档、公文、简报、项目报告与标书现在先从
Front Matter 和正文首个 H1 构建主题无关的语义树，再由 Renderer 投影为
现有 HTML 节点与类名，因此网页预览和 PDF 的 DOM 保持兼容；同一模型也
随 `RenderedMarkdownDocument` 进入 `PreparedDocxExport`。模型已表达
版头、落款、版记、封面、标题去重策略，以及封面隐藏页眉页脚、隐藏页码、
下一页分节和正文页码重启意图。当前尚未改变 Pandoc AST、动态
`reference.docx` 或最终 DOCX；下一步阶段 12B 将把已归一化的主题令牌
接入动态 Word 模板。

`v0.6.0` 阶段 12B 已将主题令牌接入真实 DOCX 生产链。应用层现在复用
Server Playwright 与 Desktop Electron 适配器，按主题 CSS SHA-256
指纹缓存计算样式快照，并与媒体捕获并行生成 56 槽位令牌；`explicit`
模式直接使用清单覆盖与预设降级，无需启动浏览器。完整令牌进入 Pandoc
转换输入和动态模板缓存键，主题变化不会复用旧模板；诊断进入导出警告，
并新增 `themeStyleMs` 耗时。DOCX 引擎通过固定槽位映射写入标准 Markdown
样式和 31 个 `Md*` 结构样式，同时覆盖字体、字号、颜色、段落、代码、
引用、表格、图注、链接、字体表与 Office 主题字体，全程不按主题 ID
分支。Playwright Chromium 151 与 Electron Chromium 150 对 14 套主题
各采集 784 个槽位，完整令牌差异为 0；固定 Pandoc 3.9.0.2 的默认模板
成功生成并验证 14 份动态 `reference.docx`，每份均含 31 个结构样式。
当前结构样式尚未绑定到 Pandoc AST，封面、版头、分节与标题去重留给
阶段 12C。

`v0.6.0` 阶段 12C 已完成通用 Pandoc 结构映射和最终 OOXML 收口。统一
语义文档模型先生成主题无关的结构计划，静态 Lua Filter 将公文版头、
文号、签发人、落款、版记、简报元数据及项目/标书封面注入可编辑 Word
段落，并绑定标准 Markdown 样式和 31 个 `Md*` 结构样式；转换过程不按
主题 ID 分支。最终 DOCX 后处理生成真实分节，支持封面无页眉页脚、正文
页码从 1 重启和 `SECTIONPAGES`，同时收口容器边框、背景、分页控制、
表格内容区全宽、固定网格和行不拆分。标题策略会抑制 YAML 与首个 H1
重复，所有内部结构标记在输出前强制清除。根级
`pnpm run verify:docx-themes` 现在强制先用 Playwright Chromium 151
重新采集 14 套主题各 56 个真实槽位，再由 Pandoc 3.9.0.2 生成最终矩阵；
结果为 11/11 表格全宽、8/8 结构化主题字段完整、4/4 独立封面分节合格、
重复标题失败 0、内部标记残留 0。下一步阶段 12D 继续使用真实 Word/WPS
做视觉、编辑和互存回归，自动结构通过不替代客户端验收。

阶段 12C-R1 已完成 WordprocessingML 严格性修复。OOXML 写入层现在按
模式顺序生成和规范化段落、文本、表格、单元格、分节及条件表格样式属性；
样式生成将 CSS `justify` 映射为合法的 `w:jc="both"`，表格宽度仅写入
正文表格而不写入表格样式，最终转换会移除 Pandoc 追加的重复样式 ID。
内置校验器会拒绝乱序属性、重复样式 ID、非法两端对齐枚举和表格样式
`w:tblW`。Microsoft Open XML SDK 2.20 审计确认 14 份最终 DOCX 的上述
错误全部归零；Microsoft Word 和 WPS 均以禁止修复的只读方式正常打开
14/14，Word 成功导出 31 页 PDF。逐页检查未发现内容丢失、裁切、重叠或
空白正文。下一步按 R2 字体嵌入、R3 PDF 与 DOCX 视觉差异引擎、R4 全主题
深度回归的顺序推进。

阶段 12D-R2 已完成纯 Node.js DOCX 字体嵌入和代表主题验收。主题清单可
声明本地或内置共享的 OTF、TTF、WOFF、WOFF2 字形；引擎使用
`fontverter` 将 Web 字体转为 SFNT，解析字体内部名称、字重和 `fsType`，
仅接受可安装或可编辑嵌入权限，再以稳定字体键生成 ODTTF 部件、字体表
关系和内容类型。最终校验会解混淆字体并重新检查 SFNT、权限、字体族、
关系、孤立部件和内容类型。WOFF2 WASM 解码已改为进程内串行调度，避免
并发非重入导致批量字体损坏。内置主题统一前置共享字体 CSS，网页、PDF
和 DOCX 使用同一字体资产，映射过程不按主题 ID 分支。

测试机未安装 Fandol 或 Open Sans。政企正式工作报告、政企红头标准文件
和 GitHub 分别成功嵌入 2、5、5 个字形面，Word 与 WPS 均能打开、
显示和编辑；Word → WPS → Word 双向编辑 3/3 通过。完整 14 主题矩阵、
全项目测试、类型检查和构建通过。视觉检查确认正式报告和 Github 在
Word/WPS 均为 2 页；红头主题在 Word 为 2 页、WPS 为 3 页，版记被移到
近空白末页，已冻结为 R3 视觉差异引擎的首个回归样例。WPS 默认另存还会
移除嵌入字体，启用字体嵌入后可保留但会扩大互存文件；项目不会因 WPS
写回器产生的 OOXML 顺序问题放宽自身严格门禁。完整记录见
[DOCX 字体嵌入与代表主题验收](V0.6.0_DOCX_FONT_EMBEDDING.md)。

阶段 12D-R3 已完成独立 `packages/document-visual-diff` 视觉差异引擎和
字体兼容收口。引擎通过可替换适配器调用 Word、WPS 或既有 PDF，统一
提取页面、文字与栅格快照，并以页数、纸张、正文相似度、平均像素误差、
变化像素率、墨迹 IoU 和边缘 IoU 生成 JSON/HTML 报告；所有 Office
自动化均使用独立临时输出并在结束后清理。DOCX 样式层将固定 CSS 行高
写为 Word 精确行距，修复 WPS 中红头版记被挤到第三页的问题；字体解析
同时规范可变字体字重，并从 SFNT `OS/2`、`head`、`post` 表通用提取
Panose、字符集、字体族、间距和 Unicode/代码页签名，写入
`fontTable.xml`。映射与严格校验均不按主题或字体名称分支，校验器会
拒绝字体表声明与实际嵌入字体不一致的文档。

使用原生静态 TrueType 中文字体资产的两字形面验证中，Word 与 WPS 均
正确使用嵌入字体显示红头版头、标题和页码，文档保持 2 页、可选择和
编辑；Word 导出 PDF 相对基线两页的正文相似度均为 1，第一页 MAE
为 1.986、墨迹/边缘 IoU 为 0.812/0.805，第二页 MAE 为 1.176、
墨迹/边缘 IoU 为 0.786/0.832，未发现裁切、重叠、缺字或异常页眉页脚。
静态字体单面约 14.85 MiB，不进入主安装包；后续如立项字体包，将采用
独立可选安装与运行时发现机制。WPS 默认保存会移除嵌入字体、Word 会
保留使用字形子集，这是客户端写回行为，不影响导出文件的首次打开和
编辑门禁。

阶段 12D-FP1 已建立独立 `packages/font-pack-registry`，冻结可选字体包
协议和安全发现边界。字体包使用
`root/<pack-id>/<semver>/font-pack.json` 固定布局，清单声明应用兼容
区间、许可文件、字体目标家族、别名、字重、样式以及同源 Web WOFF2 和
DOCX 静态 TrueType 资源。注册器按根目录顺序和最高兼容版本确定可用包，
使用完整 SemVer 比较，并对清单、普通文件、路径包含关系、符号链接、
单资源/总容量、许可文件和 SHA-256 执行严格校验；实际读取资源时会再次
验证大小与哈希，避免注册后文件被替换。候选解析按字体家族或别名、字重
和斜体精确匹配，支持调用方显式指定字体包优先级；根目录缺失、版本不
兼容、资源损坏、版本覆盖和字体面未提供均返回结构化诊断，缺少字体包
不会阻断后续安全降级。当前尚未接入主题、Preview/PDF、DOCX、Desktop
安装器或 Docker；FP2 将让 Web WOFF2 与 DOCX TTF 进入同一主题字体解析
结果，并把字体包指纹纳入缓存和导出诊断。全仓 454 项测试、类型检查和
生产构建通过。

阶段 12D-FP2 已将可选字体包接入统一主题与 DOCX 生产链。应用层按主题
声明、字体家族或别名、字重和样式解析同一逻辑字体面：Web、Preview 与
PDF 在主题 CSS 末尾注入 WOFF2 `@font-face`，DOCX 同时选用对应的静态
TrueType 字体，并保留字体包许可、版本和来源诊断；未命中的字体面继续
安全降级到主题原有字体。字体包版本、资源 SHA-256 和整体指纹已进入
主题令牌、样式快照、动态模板及导出缓存边界，替换资源不会错误复用旧
结果。Server 只暴露带 ETag 和不可变缓存头的 WOFF2 资源端点，通过
`FONT_PACK_ROOT` 配置字体包根目录；Desktop 使用受限的
`morphdoc://font-pack/.../web` 协议，并从应用数据目录发现可选字体包，均不
对渲染器暴露 DOCX TTF 原始资源。静态字体单面上限调整为 16 MiB、单次
DOCX 字体源总量调整为 48 MiB，与已验证的原生中文 TrueType 资产一致。

全仓 458 项测试、类型检查、生产构建和 14 套主题真实 Pandoc 矩阵通过；
临时字体包验证确认政企红头标准文件可从同一字体包解析两个 WOFF2/TTF
字形面，其余字体继续按主题资产降级，最终五个字体源均通过 SFNT 与嵌入
权限校验。字体二进制、独立安装包和 Docker 分发尚未进入仓库；下一步
FP3 只处理独立 NSIS 字体包、Docker 可选挂载及其安装/升级/卸载门禁。

阶段 12D-FP3-A 已建立独立 `packages/font-pack-builder` 和首个冻结字体包
配方 `morphdoc-serif-sc@1.0.0`。主仓库只保存配方、OFL-1.1 许可证、上游提交
与派生说明，不保存约 41.37 MiB 字体二进制；发布人员从 Git 忽略的受信任
源目录提供 Regular 400、Bold 700 两组静态 TTF/WOFF2。构建器会校验
普通文件、路径包含关系、大小、SHA-256、WOFF2/TrueType 格式、字体内部
家族、字重、Web/DOCX 元数据一致性及文档嵌入权限，再原子组装版本化
`font-pack.json` 目录。相同版本内容一致时重复构建保持幂等，内容不同时
拒绝覆盖；字体包只匹配 `FandolSong` 与 `MorphDoc Fandol Song`，不会通过
`SimSun` 等通用别名错误替换仿宋、黑体、楷体或外部主题字体。

统一命令为 `pnpm run build:font-pack` 和 `pnpm run verify:font-pack`，默认
产物写入被 Git 忽略的 `output/font-packs/`。真实资产构建结果为
41,371,798 字节，两字形面均为 `MorphDoc Serif SC`、`fsType=0`、可安装嵌入；
应用层验收确认政企红头标准文件同时取得两组 WOFF2 和静态 TTF，其余三个
字体面继续使用主题安全降级。全仓 461 项测试、类型检查和生产构建通过。
本阶段未修改 NSIS 或 Docker；下一步 FP3-B 实现独立用户级字体包安装、
升级、卸载和主安装器同目录可选入口。

阶段 12D-FP3-B 已实现 Windows 独立字体包安装与 Desktop 同目录可选入口。
字体包构建器复用 electron-builder `26.15.3` 锁定并校验的 NSIS 3.0.4.1，
不要求系统安装 NSIS，也不引入第二套 Electron。独立安装器以当前用户权限
将完整 `morphdoc-serif-sc` ID 安装到
`%LOCALAPPDATA%/morphdoc/font-packs/`，不注册系统字体；安装使用暂存、
备份、原子提升和失败回滚，同版本重装幂等，独立卸载只清理该 ID。隔离
根目录验收中，首次静默安装、同版本重装和卸载退出码均为 0，注册器复核
的字体包指纹仍为
`67adac137fa74ca54b4ab07dd584ae87657a1aec413b7f125141c5351fa5b89d`。

主安装器通过生成的 NSIS include 绑定同目录字体包安装器的精确文件名与
SHA-256；交互模式仅在文件存在且哈希正确时显示默认勾选项，并在执行前
再次复核哈希。静默主安装默认跳过，只有 `/WITHFONTPACK=1` 才安装；字体
包失败不会回滚主程序。统一组合命令为
`pnpm run desktop:make:with-font-pack`，普通 Desktop 构建不启用伴随逻辑。
真实组合产物中，主安装器为 115,328,133 字节，独立字体包安装器为
24,489,062 字节；桌面解包目录未包含字体二进制或字体包安装器。Windows
实机安装向导确认可选页位于安装目录页之后，说明文字完整且字体包默认
勾选；未执行主程序重装。全仓 465 项测试、类型检查、生产构建和组合发行
构建通过。下一步 FP3-C 实现 Docker 可选字体包挂载与部署门禁。
本阶段按版本策略未提前修改应用的 `0.5.1` 版本号；正式 `v0.6.0` 发布
提交升级版本后，字体包才满足其 `minimumAppVersion=0.6.0` 运行时门禁。

已修复 `v0.5.1` 遗留的精确预览放大后右侧留白丢失问题。精确 PDF 文档
容器现在按当前缩放下最宽页面加左右各 30px 显式计算自身宽度，页面较小
时仍由 `min-width: 100%` 居中，页面溢出时双侧留白则稳定进入横向
`scrollWidth`。真实 Chromium 在 100%、120% 和 400% 下滚动到最右端，
文档右侧留白分别约为 30.38px、30.05px 和 30.45px；120% 与 400%
均准确到达各自最大横向滚动值，快速和连续预览结构未改变。

Desktop 已统一 Markdown 保存/另存为、PDF 导出和 DOCX 导出的默认路径
策略：有效源文件目录优先，其次使用最近一次成功写入文件的目录，最后
回退到 Electron 返回的用户“文档”目录。最近目录只在目标文件实际写入
成功后更新，普通保存已有 Markdown 也会更新；状态使用版本化 JSON、
临时文件和原子替换写入应用数据目录，因此可跨窗口和应用重启复用。源
目录或历史目录被删除、移动、变为普通文件或不可访问时会自动跳过，不
阻断保存对话框。状态持久化失败不会把已经成功写入的用户文件误报为保存
失败。该优化作为独立提交完成，不与 FP3-C Docker 部署改动混合。

`v0.5.1` Web 与 Desktop 旧渲染引擎曾在整篇代码围栏全部标记为 JSON 时
出现缩进视觉丢失；任一围栏改为其他语言后其余 JSON 又会恢复。使用原始
问题文档在当前 `v0.6.0` Chromium 快速预览中验证，首次完整渲染的 14 个
JSON 代码块均保留 2/4/6 级缩进，将首个围栏改为 `text` 后的增量渲染也
保持正常。该问题标记为随 `v0.6.0` 渲染引擎重构消失，不再追加生产修复。

阶段 12D-FP3-C 已完成 Docker v0.6.0 DOCX 运行链和可选字体包挂载。镜像
构建补齐统一语义文档、DOCX 主题映射、字体包注册器和 DOCX 引擎工作区，
并将 Lua Filter 作为明确运行资产复制；独立下载阶段对 Pandoc `3.9.0.2`
Linux amd64 二进制、GPL 许可证和版权文件分别执行固定 SHA-256 校验，
最终运行镜像只保留 `/opt/pandoc/3.9.0.2/`，不包含下载工具或可选字体包。
基于已验证 Chromium 运行层生成的验收镜像内容大小为 681,961,183 字节，
以非 root `pwuser` 运行，DOCX capability 精确识别 Pandoc `3.9.0.2`。

Compose 通过 `MORPHDOC_FONT_PACK_DIR` 将宿主机字体包根目录只读挂载到
`/app/.local/font-packs`，并以 `MORPHDOC_APP_VERSION=0.6.0` 执行兼容性
判断。静态部署契约覆盖 DOCX workspace、Pandoc 版本与三组哈希、Lua
Filter、只读挂载以及 Docker 构建上下文排除。统一真实门禁为
`pnpm run verify:docker-font-pack`：空目录场景正常降级；有效
`morphdoc-serif-sc@1.0.0` 提供不可变缓存 WOFF2，并进入真实 DOCX 字体表和
字体部件；篡改 WOFF2 后注册器拒绝整个字体包，主题 CSS 不再注入字体包，
但 DOCX 仍通过主题字体安全降级并成功生成。三组隔离 Compose 容器、网络
和临时目录均在验收后清理。全仓 94 个测试文件、480 项测试、类型检查、
生产构建和 `git diff --check` 均通过。下一步 R4 进入 14 套主题深度视觉
回归。

阶段 12D-R4-2 已建立可复现的全主题生产链矩阵。统一命令
`pnpm run verify:docx-r4-matrix` 会先重新生成 14 套主题的标准 DOCX 结构
基线并复验可选字体包，再构建同源 Web 预览运行时，通过真实 Fastify HTTP
接口和 Playwright Chromium 分别生成 14 份 PDF 与 14 份 DOCX。产物与
结构化报告写入被 Git 忽略的 `output/docx-r4/`，供后续 Word、WPS 和视觉
差异阶段复用。

本轮生产链共生成 28 页 Chromium PDF；14/14 DOCX 均保留标准 Word
段落、标题、代码、表格和图注样式，不含 `altChunk` 或内部结构标记，
Front Matter、封面分节、标题去重及表格全宽继续通过标准矩阵门禁。
PDF 与 DOCX 的 Mermaid、ECharts 错误均为 0；`gov-red-standard` 通过
Server 字体包注册链命中 `morphdoc-serif-sc@1.0.0`，字体表包含
`MorphDoc Serif SC` 并实际嵌入 5 个字体部件。3 条诊断仍是已冻结的商务标书
超粗边框和经典标书双层边框结构近似。Server 44 项测试、类型检查、构建
及 `git diff --check` 通过。下一步 R4-3 使用 Microsoft Word 对 14 份
生产 DOCX 执行无修复打开、编辑、保存和 PDF 导出。

阶段 12D-R4 媒体专项已完成生产链、OOXML、Word/WPS 编辑互存和视觉
门禁。媒体捕获协议现在记录实际显示尺寸、内容区边界和左右/居中对齐，
Pandoc 媒体布局使用稳定绑定标记与整数 EMU；最终 DrawingML 强制
`wp:inline`、零环绕距离、锁定宽高比、无裁切/旋转/翻转，并校验 PNG
关系、替代文本、孤立部件和纸张内容区上限。普通图片、宽图、高图、
Mermaid 与 ECharts 共 5 个媒体在 Word/WPS 中均可编辑；自动化将首图
缩放至 90% 后原位保存并重开，Word 非目标图尺寸漂移为 0，WPS 最大仅
0.046 pt，且两端没有浮动图片或额外图片关系。

统一命令 `pnpm run verify:docx-media-visuals` 会通过真实 Server HTTP 生成
Chromium PDF 与 DOCX，再由 Word/WPS 导出 PDF、编辑互存并复导 PDF；
三份 PDF 使用独立 PDF.js worker 生成页面快照、叠加图和热力图，避免
多文档进程级状态污染。五色几何门禁检查物理尺寸、宽高比和水平中心；
高图允许 Chromium 媒体回填与 DOCX 限高策略产生尺寸差异，但仍强制比例、
对齐及 Word/WPS 物理尺寸一致。4 条图片题注在 Chromium、Word、WPS
三端均要求距页面中心不超过 8 pt；`ImageCaption` 已固定为居中，同时
保留主题提供的字体、字号、颜色和行距。Chromium 为 4 页，Word/WPS 为
5 页，属于已允许的自然分页差异；三端可编辑文本完整。原始逐页像素报告
仍如实标记页数与正文流差异，媒体专项门禁按上述契约通过。产物位于
`output/docx-media-gate/`。

阶段 12D-R4 布局视觉矩阵已完成。统一命令
`pnpm run verify:docx-layout-visual-matrix` 覆盖 A4/Letter、纵向/横向、
主题/自定义及非对称页边距、普通文档、公文和两类独立封面，通过真实
Chromium、Microsoft Word 与 WPS Writer 生成逐页原图、叠加图、热力图和
结构化报告。发布门禁明确以元素颗粒度为准：字体、字重、颜色、尺寸、
段落与代码内边距、标题和封面换行、表格边框与填充、图片尺寸和对齐、
页眉页脚及页码位置属于严格项；Word/WPS 与 Chromium 的正文分页位置、
页数和由排版引擎产生的自然行容纳差异仅作为诊断，不单独阻断。封面仍
必须保持独立单页并在正文前强制换页。

六组矩阵的 Word/WPS 可编辑文本均精确匹配，严格问题为 0。视觉审查发现
主题普遍将折叠表格边框声明在 `th/td` 而非 `table`：转换器此前误用旧
模板的浅色细边框。本轮已将单元格四边通用映射到 OOXML 外框和
`insideH/insideV`，保留表自身显式边框优先级；横向规章制度主题重新渲染
后，Chromium、Word、WPS 的网格颜色、线宽和表头填充一致。随后重跑
14 套主题生产矩阵，全部完成同源 PDF/DOCX、结构、字体包、封面分节、
标题去重、表格全宽、媒体和 OOXML 校验。

## 2. 已完成

### 2.1 项目骨架

- 建立 pnpm workspaces。
- 建立 React + Vite 前端。
- 建立 Fastify 后端。
- 建立 `packages/core` 共享包。
- 建立主题、测试和 Docker 目录。
- 初始化本地 Git 仓库。

### 2.2 导出配置模型

`packages/core/src/export-config.ts` 已包含：

- 版本 3 配置模型；
- A3、A4、A5、Letter、Legal、Tabloid 和自定义纸张；
- 横向、纵向；
- 四边页边距；
- 页眉和页脚左右中区域；
- 页码位置和格式；
- PDF 元数据；
- 打印背景、缩放和一级标题分页选项；
- Mermaid 布局、主题、外观和字体；
- Zod 数据校验；
- 默认 A4 技术文档预设。

### 2.3 主题接口

`packages/core/src/theme.ts`、`themes/typora-like` 和动态主题注册器已包含：

- 版本化主题清单；
- 主题 ID、名称、版本、作者、许可证；
- DOM 预设；
- 支持能力声明；
- 可选基础 CSS、主体 CSS 和打印 CSS；
- 自制简洁技术文档主题；
- `#write` 兼容文档结构；
- 内置主题和 `.local/themes` 本地主题动态扫描；
- 按基础 CSS、主体 CSS、打印 CSS 的固定顺序组合；
- 主题内相对 CSS `@import` 安全展开；
- 主题 CSS 相对资源重写与受限资源接口；
- 目录匹配、真实路径包含关系和外部 URL 安全检查。

内置主题包含项目自有的简洁技术文档主题，以及三套第三方导入主题
（GitHub、Pixyll 和 Whitey 风格）。三套第三方主题的来源与作者记录在
`themes/THEME_NOTICE.md`。

### 2.4 Markdown 渲染核心

提交 `7224dfd` 已完成：

- `packages/renderer` 独立工作区；
- Front Matter 解析；
- Markdown 到安全 HTML；
- 标题锚点；
- 表格；
- 任务列表；
- 脚注；
- highlight.js 代码高亮；
- KaTeX 数学公式；
- Mermaid 安全占位；
- sanitize-html 安全过滤；
- 元数据规范化；
- 功能检测；
- 统一 `<article id="write">` 输出；
- 5 项渲染单元测试。

### 2.5 网页实时预览

提交 `fa07472` 已完成：

- 可测试的 Fastify `buildApp()`；
- `POST /api/render` 服务端统一 Markdown 渲染；
- 动态主题清单、CSS 和资源 API；
- Markdown 编辑及本地 `.md` 文件读取；
- 250ms 防抖 A4 实时预览；
- iframe 隔离主题 CSS；
- KaTeX、highlight.js 和按需加载的 Mermaid；
- 桌面双栏与移动端上下布局；
- 5 项渲染器测试和 4 项后端测试。

### 2.6 主题兼容增强

提交 `ec14f79` 已完成：

- 主题清单可选基础 CSS；
- 基础 CSS、主体 CSS、打印 CSS 固定组合顺序；
- 安全的相对 CSS `@import` 展开和资源 URL 重写；
- CSS 导入深度、循环、外部 URL 和越界路径检查；
- GitHub、Pixyll 和 Whitey 三套本地第三方白色主题导入；
- 可恢复替换和默认防覆盖；
- 主题开发指南；
- 后端测试增至 6 项。

### 2.7 导出设置与打印预览

提交 `52cf816` 已完成：

- 导出配置升级到版本 3，并兼容迁移版本 2 浏览器缓存；
- 纸张收敛为 A3、A4、A5、US-Letter 和 US-Legal；
- 默认 A4 纵向和 16mm 四边页边距；
- 统一 96 CSS px/in、72 PDF pt/in 和 25.4mm/in 的物理单位换算；
- 响应式导出设置抽屉；
- 纸张、方向、页边距、页眉、页码和主题的版本化浏览器缓存；
- 页眉左中右内容和变量；
- 五种页码样式、对齐和起始页码；
- Mermaid 官方配置 frontmatter、默认主题与错误隔离；
- Mermaid 全局 Dagre/ELK 布局、官方主题、外观和字体设置；
- Markdown 表格对齐属性保留和自适应列宽；
- 纸张尺寸和页边距实时预览。

## 3. Chromium PDF 导出与精确预览

### 3.1 Chromium PDF 导出

- 引入固定版本 Playwright Chromium。
- 新增 `POST /api/pdf`，复用服务端 Markdown 渲染结果、`#write` DOM、主题 CSS、打印 CSS 和统一分页运行时。
- PDF 文本可搜索，支持中文、长表格、KaTeX、Mermaid、页眉、页脚和页码。
- Chromium 浏览器实例复用，每个请求使用独立 BrowserContext。
- 支持浏览器预热、并发门控、排队上限、超时和关闭清理。
- 仅允许同源、`data:`、`blob:` 和 `about:` 资源，阻止 PDF 页面访问外部网络。
- PDF 响应提供安全的 UTF-8 文件名、页数、Mermaid 错误数和 `Server-Timing`。
- 前端“导出 PDF”按钮已启用，生成完成后直接下载。

### 3.2 快速预览与精确预览

- 快速预览继续使用 Paged.js，适合编辑时即时反馈。
- 精确预览直接复用 `/api/pdf` 结果，确保显示页数和最终下载一致。
- 快速与精确模式可以切换，PDF 缓存按 Markdown、主题和导出配置失效。
- PDF.js 使用集中渲染队列，当前可见页优先，滚动方向上的相邻页次优先。
- 远离视口的 Canvas 延迟释放，避免 65 页长文档持续占用大尺寸位图内存。
- 未完成渲染的页面显示白色占位，Canvas 完成后才显示，消除快速滚动时的黑影。
- 编辑区和两种预览模式支持按滚动比例同步定位。

### 3.3 Mermaid 分页性能优化

- Mermaid 仍使用官方渲染器、配置 frontmatter、严格安全模式、默认主题和 classic 样式。
- 渲染完成后记录 SVG 与容器的实际小数宽高，将 SVG 转为内嵌 Data URL 图片再交给 Paged.js 分页。
- 静态 SVG 仍由 Chromium 以矢量和可搜索文字输出，不发生位图化。
- 快速预览和 PDF 默认使用相同的静态 SVG；`mermaid-output=inline-svg` 仅保留为内部诊断开关。
- 65 页、67 个 Mermaid 的附件中，分页耗时约从 2.60 秒降至 1.29 秒，总生成耗时约降低 12.7%。
- A/B PDF 均为 65 页，逐页 61,102 个非空白字符和 11,762 个文本项完全一致。

### 3.4 PDF 性能观测

- 记录排队、浏览器、上下文、导航、文档渲染、Mermaid、资源等待、分页、PDF 打印和总耗时。
- `Server-Timing` 已暴露上述关键阶段，包括 `mermaid-conversion`。
- 65 页附件的主要耗时来自 Mermaid 渲染、Paged.js 分页和 Chromium PDF 打印。
- PDF 缓冲区直接返回，避免无意义的二次 `Buffer` 复制。

### 3.5 AIO 容器部署

- 使用多阶段 Dockerfile 构建前端、后端和共享包。
- 基于 Node.js 22 Debian 构建运行镜像，并由项目锁定的 Playwright
  `1.62.0` 安装精确匹配的 Chromium 与系统依赖。
- 单容器内由 Nginx 提供前端并代理 Fastify API。
- Playwright 通过同一 Nginx 地址加载精确预览运行时。
- 容器以非 root `pwuser` 运行并提供 1 GiB 共享内存。
- Compose 支持端口、只读主题目录、PDF 并发、队列和超时配置。
- 增加容器健康检查和统一进程退出处理。
- Nginx 显式以 JavaScript MIME 类型提供 PDF.js `.mjs` Worker。

### 3.6 Mermaid 配置与预览缩放

- Mermaid 固定为 `11.16.0`，ELK 使用官方
  `@mermaid-js/layout-elk@0.2.2` 并按需加载核心布局代码。
- 全局导出设置支持 Dagre、ELK、官方主题、Classic、Hand-drawn、Neo
  外观和自定义本地字体。
- 单图 `config` Front Matter 可以覆盖全局布局、主题、外观、字体、
  `themeVariables` 和图表专属配置。
- `style`、`classDef` 和 `linkStyle` 保持 Mermaid 原生语义。
- `themeCSS`、严格安全模式和资源限制不能由 Markdown 覆盖。
- Mermaid 与 Paged.js 计算期间隐藏分页 iframe，避免显示官方渲染器的
  临时测量节点。
- 快速预览和精确预览共用 50%～400% 显示缩放，支持滑块、手动输入、
  100% 重置和独立浏览器缓存。
- 缩放不进入导出配置，不改变分页或 PDF；精确预览会按显示宽度重绘
  邻近 Canvas，保持文字清晰。

### 3.7 渲染边界修复与复用重构

- PDF 总超时覆盖 Chromium 启动、上下文创建、页面渲染和有界清理，
  浏览器预热也受同一超时约束。
- 当前预览模式的重复点击不再触发无意义的状态重置和 PDF 请求。
- Mermaid 分页测量使用实际主题、字体和盒模型，静态 SVG 图片锁定实际
  小数尺寸，避免测量容器宽度与真实纸张不一致。
- 非法 Front Matter 在预览和 PDF API 中统一返回 400；无效本地主题
  会被隔离并记录警告，不影响其他主题。
- `packages/core` 统一维护 Markdown 文档、分页载荷、分页结果和耗时类型，
  前端快速预览与后端 PDF 使用同一个载荷构造函数。
- 前端 Markdown 防抖渲染与主题清单/CSS 加载已从 `App.tsx` 抽取为独立
  Hook，保留原有取消请求和错误隔离行为。
- 主题注册表增加 1 秒目录扫描缓存和主动失效接口，减少同一请求链路中
  重复遍历主题目录，同时兼顾本地主题热更新。
- CSS 像素与 PDF 点数换算只使用 core 中的共享常量；删除已经不参与协议
  或逻辑的 `contentHeight` 字段。

### 3.8 Windows 显示缩放与快速预览分页差异

- 此前 65 页长文档在快速预览中生成 64 页、在精确预览和最终 PDF 中
  生成 65 页；该差异并非由 Chromium 版本不同导致。
- 出现差异时，笔记本内屏使用 Windows 150% 系统显示缩放。切换到使用
  100% 显示缩放的外接显示器后，快速预览与精确预览的分页结果基本一致。
- 当前定位是：Windows 显示缩放改变浏览器的 `devicePixelRatio`，并可能
  影响字体栅格化和 CSS 布局中的子像素取整；单处差异很小，但会在长文档
  分页过程中累计，最终造成页数差异。
- 精确预览直接展示服务端 Chromium 生成的 PDF，最终下载也复用同一结果，
  因此精确预览和最终 PDF 继续作为权威分页结果；快速预览定位为编辑期间的
  客户端近似分页，不承诺在所有显示缩放环境下与 PDF 页数完全一致。
- 后续优化快速预览时，应重点检查 `devicePixelRatio`、浏览器页面缩放、
  字体度量和逐页高度取整；分页测量不得依赖物理像素，视觉缩放不得参与
  文档排版和分页计算，并避免逐页取整造成累计误差。
- 后续分页回归应覆盖 Windows 100%、125% 和 150% 系统显示缩放，分别
  记录快速预览、精确预览和最终 PDF 的页数及分页边界。

### 3.9 Markdown ECharts 图表

- 新增可独立复用的 `packages/markdown-echarts` 工作区，为 Markdown-it
  提供安全的 `echarts` YAML 围栏。
- 围栏支持版本、固定高度或宽高比、主题、图注和 ECharts `option`；
  高度默认 80mm，主题默认跟随文档。
- 当前支持 line、bar、scatter、pie、radar、heatmap、boxplot 和
  candlestick 系列，并校验各系列的数据结构和必要坐标系。
- 每个系列必须使用非空 `series[].data`、`dataset.source` 或具有有效
  上游数据的内置 transform；缺少数据等错误会显示包含配置路径的局部
  占位，不中断整篇 Markdown。
- YAML 会转换为安全纯数据对象；禁止函数、自定义标签、锚点和别名、
  外部 URL、HTML formatter、原型污染属性及 `custom` 系列。
- 浏览器按需加载 ECharts 模块，以 SVG 渲染，并可冻结为内联 SVG 或
  SVG Data URL 图片；快速预览与 PDF 使用同一套运行时。
- 分页遵循 Mermaid 的不可拆分规则：当前页空间足够时原位放置，不足时
  移到下一页，超高图表等比例缩放到单页内，不跨页切割。
- PDF 输出等待 ECharts、Mermaid、字体和图片全部完成后再分页，并分别
  返回 ECharts 与 Mermaid 错误数量。
- 包内 README 已记录围栏语法、默认值、验证规则、错误行为、安全边界、
  Markdown-it 接入和浏览器渲染方式。

### 3.10 工作区布局与页码导航

- 默认 Markdown 示例新增 ECharts 柱状图，打开网页即可验证 YAML 围栏、
  SVG 渲染和分页。
- 文件名及渲染、分页、导出错误状态从源文本标题栏迁移到顶部应用标题
  旁，长文件名支持省略和完整悬停提示。
- 源文本区域支持收起和展开；桌面端收起为 48px 左侧窄栏，预览区扩展
  到剩余宽度并保持纸张居中，窄屏收起为 44px 顶部横条。
- 折叠内容使用真实 `display:none`，不会残留可聚焦文本框或进入无障碍
  树；按钮提供 `aria-controls` 和 `aria-expanded`。
- 当前页从预览标题行移到缩放工具栏左侧，显示为
  `第 [n] / 总页数 页`，避免重复信息。
- 页码输入支持 Enter 和失焦提交，自动限制到 1～总页数；空值和非法
  小数恢复当前页。
- 快速预览直接定位 iframe 内 `.pagedjs_page`；精确预览定位
  `.precise-pdf-page`。滚动预览时输入框同步当前页。
- 精确预览会动态识别桌面内部滚动容器或窄屏主窗口滚动容器，目标页顶端
  与实际可视滚动区域对齐。
- 快速预览 iframe 只负责生成分页内容并回传自然高度，滚动统一交给外层
  `.preview-scroll`；滚动条因此与精确预览一样贴在右侧预览容器边缘，
  不再贴着居中的纸张右边缘。
- 快速预览的页码识别和跳转会合并外层滚动位置、iframe 位置、内部分页
  位置与显示缩放比例，50%～400% 视觉缩放不会破坏页码同步。

### 3.11 ECharts 第二阶段图表

- ECharts 系列支持从首版 8 种扩展到 17 种，新增 `tree`、`treemap`、
  `sunburst`、`graph`、`sankey`、`chord`、`funnel`、`gauge` 和
  `pictorialBar`。
- 当前使用 ECharts 6.1.0，`chord` 直接采用 ECharts 6 官方和弦图及
  `ChordChart` 按需模块，不引入第三方扩展。
- `tree`、`treemap` 和 `sunburst` 校验递归层级结构；矩形树图和旭日图
  的叶节点必须提供有限数值。
- `graph`、`sankey` 和 `chord` 校验节点、关系边、端点引用与边权重；
  Graph 未指定布局时，有完整坐标则使用 `none`，否则默认使用 `force`。
- `funnel`、`gauge` 校验有限数值数据；`pictorialBar` 复用柱图的数据和
  坐标轴规则，并允许不加载外部资源的 `path://` 内嵌矢量路径。
- 安全策略新增层级节点、关系节点和关系边数量限制，继续禁止外部图片、
  跳转链接、函数、HTML formatter 和原型污染属性。
- 默认 Markdown 现在包含基础柱状图及九种第二阶段图表，每种均使用独立
  YAML 围栏，可直接编辑和观察 SVG、分页及错误占位行为。
- Treemap 默认示例关闭节点下钻和面包屑，显式启用父级与叶节点标签，并
  增加白色分隔边框，避免扁平数据区域缺少辨识信息或底部控件占用空间。
- Markdown/PDF 属于确定性的静态输出场景，浏览器引擎会在全局和系列级
  强制关闭 ECharts 动画、动画延迟和持续时间，不允许 YAML 动画参数使
  预览或 PDF 停留在动画中间帧。

### 3.12 v0.4.0 Electron 桌面端

- 新增 `apps/desktop` Electron 43.2.0 工作区，使用 Electron Forge
  7.11.2 打包。
- 根项目版本升级为 `0.4.0`，Vite 从根 `package.json` 注入统一版本，
  工具标题右侧显示 `v0.4.0` 徽标。
- 应用窗口和 PDF 窗口均关闭 Node Integration，启用 Context Isolation
  和 Chromium Sandbox，并使用不同 preload 暴露窄 IPC 接口。
- 桌面端 PDF 直接接收 Web 端已经构造的共享分页载荷，复用现有
  `PagedDocumentRuntime`、主题 CSS、Mermaid 和 ECharts 运行时。
- 隐藏 PDF 窗口使用 Electron 自带 Chromium 的
  `webContents.printToPDF()`，桌面发行包不携带 Playwright Chromium。
- Paged.js 的帧队列在纯隐藏窗口中不会推进；桌面 PDF 任务期间使用
  计时器调度分页队列，分页完成后恢复原生 `requestAnimationFrame`。
- Chromium 打印前将透明、不可聚焦、不进入任务栏的 PDF 窗口短暂放到
  屏幕外，使复杂分页页面拥有可打印的窗口表面，用户不会看到该窗口。
- PDF Buffer 通过受控 IPC 返回 Web 界面，桌面端使用系统“另存为”对话框
  写入文件；Web 版继续使用浏览器下载行为。
- 生产页面通过 `morphdoc://bundle/` 自定义安全协议加载，不使用权限过宽的
  `file://`；PDF Session 只允许同源、`data:`、`blob:` 和 `about:`
  资源。
- Windows x64 未签名目录包、Squirrel `Setup.exe` 和 ZIP 已由 Forge
  成功生成；`app.asar` 只包含
  编译后的主进程、preload 和清单，Web 静态资源作为只读资源单独打包。
- 新增 `packages/application`，统一封装 Markdown 渲染、主题清单、主题
  CSS 和主题资源读取；Fastify 仅作为 HTTP 适配器。
- Web 端通过应用后端抽象选择 HTTP 或 Electron IPC；桌面端通过受限 IPC
  直接调用共享服务，不启动 Fastify，不占用本地 HTTP 端口。
- 主题资源通过 `morphdoc://theme/` 安全协议提供，应用窗口与独立 PDF
  Session 均完成协议注册和来源限制。
- 修复 Electron 主进程 ESM Bundle 中 YAML 依赖动态加载 `process`
  失败的问题，构建时注入 Node `createRequire`。
- `logos/` 作为统一品牌源：Web 使用 favicon、Apple Touch Icon 和
  Web Manifest，Electron 使用 ICO、ICNS、窗口图标和安装器图标。
- Forge 输出目录包含版本号，正式内部交付使用 Squirrel `Setup.exe`，
  ZIP 作为免安装辅助包；当前未签名。

### 3.13 v0.4.0 内置主题与发布产物

- `.local/themes` 中 GitHub、Pixyll 和 Whitey 三套主题已复制到
  `themes/`，从 v0.4.0 起随 Web 容器和桌面安装包内置。
- 内置主题注册优先于相同 ID 的本地主题，避免 Compose 默认挂载旧副本
  覆盖发布版本，并记录可诊断警告。
- Windows 正式安装包为
  `Markdown PDF 导出器-0.4.0 Setup.exe`，约 137.48 MiB；SHA-256 为
  `9C12F9A007E102BDB5213ABC5246F4480083FCA5D67DCD45354728BCFDB54220`。
- 中文产品名、窗口标题、安装包和开始菜单名称保持不变，Windows 主程序
  与进程文件固定为 `morphdoc.exe`；目录包和 Squirrel NUPKG 均已验证。
- 本地镜像为 `morphdoc:v0.4.0`；Compose 容器保持健康运行并
  监听 `http://localhost:8080`。
- Dockerfile 默认保留完整 Playwright Chromium 安装路径，同时支持通过
  构建参数复用本机已验证的旧版本运行层，适合内网软件源较慢的环境。

### 3.14 v0.4.1 图片资源与标题分页

- `packages/application` 统一提取 Markdown 图片引用，将验证后的本地或
  远程图片转换为 Data URL，再交给 Web 预览、Playwright PDF 和 Electron
  PDF 共用的 HTML。
- Web 增加素材目录选择，支持把 Markdown 的关联图片作为受限 Base64
  资源随渲染和 PDF 请求提交；请求体上限同步提高到 24 MiB。
- Desktop 增加原生“打开 Markdown”，主进程记录文档目录并直接读取相对
  图片，不启动 Server，也不允许读取文档目录之外的文件。
- 相对路径支持中文、空格和百分号编码；拒绝绝对路径、`..` 穿越和符号
  链接越界。
- 远程图片支持 HTTP/HTTPS、逐跳重定向校验、10 秒超时、格式嗅探与
  5 分钟缓存；阻止 localhost、私网和链路本地目标，并兼容企业代理常用
  的域名 Fake-IP 网段。
- 每篇文档最多 50 个图片引用，单图不超过 8 MiB，总图片不超过 15 MiB；
  支持 PNG、JPEG、GIF、WebP、AVIF 和受限 SVG。
- 独立图片使用 `figure + img + figcaption`，`[]` 中的文本显示为图片
  标题；行内混排图片继续保持普通段落语义。
- 图片与标题整块分页。超高图先扣除标题区实际高度，再等比例缩放到单页，
  与 Mermaid 和 ECharts 遵循相同的不可跨页规则。
- 默认示例增加 NASA 中等尺寸图与 Unsplash 超高竖图，直接覆盖正常图片
  和超高图片分页场景。

### 3.15 v0.4.2 桌面窗口精简

- Electron 主进程不再创建默认应用菜单，移除窗口顶部的
  `File / Edit / View / Window` 原生菜单栏。
- 应用窗口同时启用菜单栏自动隐藏，避免 Windows 恢复默认菜单。
- 该维护版本只重新生成桌面安装包和免安装 ZIP；Web/Compose 镜像继续
  使用已验证的 `v0.4.1`。

### 3.16 v0.4.3 标准 Windows 安装向导

- 桌面发行链路由 Electron Forge Squirrel 迁移到 electron-builder
  26.15.3 的 NSIS assisted installer。
- 安装向导提供当前用户/所有用户安装选项、安装目录选择、安装进度和完成
  页面；主程序继续使用 `morphdoc.exe`。
- 正式安装包固定命名为
  `morphdoc-0.4.3-x86_64-Setup.exe`，免安装包命名为
  `morphdoc-0.4.3-x86_64.zip`。
- 项目自有 `build/installer.nsh` 显式创建桌面和开始菜单快捷方式，
  安装完成后直接启动主程序，不依赖 `.lnk`。
- 卸载时显式清理桌面快捷方式、开始菜单快捷方式及其目录。
- 安装包和校验文件作为 Gitea `v0.4.3` Release 附件发布，不写入 Git
  历史。

### 3.17 v0.4.4 桌面语言包精简

- Electron 发行包只保留 `zh-CN` 和 `en-US` 两种 Chromium 语言资源。
- 不裁剪 ICU、ANGLE、Direct3D、Dawn、SwiftShader 或其他 Chromium
  运行时组件，保证桌面预览与 PDF 导出在不同图形环境下的可靠性。
- 本版本只重新生成桌面安装包和免安装 ZIP；Web/Compose 发布继续保持
  `v0.4.1`。

### 3.18 v0.4.5 文档工作流与媒体分页

- Web 与 Desktop 均支持新建 Markdown；未保存时使用“未命名文档”状态，
  不显示伪造源文件名，并允许直接导出 PDF。
- Web 保存使用浏览器下载；Desktop 使用原生另存为。默认文件名优先取
  第一个一级标题，没有一级标题时取首行可见文本，并清理 Windows 非法
  字符、保留名和末尾空格或句点。
- “打开 Markdown”继续作为顶部独立强操作；新建、保存及桌面自定义主题
  目录收纳到“更多”菜单，Web 不再显示本地素材目录入口。
- Windows 安装包注册 `.md` 和 `.markdown` 文件关联；系统打开文件会
  转交给现有单实例窗口并自动加载。
- Desktop 监听窗口位置、尺寸和最大化变化，延迟写入完整状态；退出前
  刷新待写状态。下次启动按当前显示器工作区限制尺寸并修正坐标，避免
  多显示器断开后窗口落在屏幕外。
- Desktop 会建立自定义主题目录，“更多”菜单可直接在资源管理器打开；
  目录允许留空，放入合法主题后由共享主题注册器读取。
- 图片、Mermaid 和 ECharts 统一视为带标题的媒体块。分页按 DOM 文档
  顺序串行处理，每个媒体元素只允许一次回填或缩放重排。
- 图片基准高度按原尺寸先收缩到内容限宽后计算；媒体块只有在上一页空白
  与所需空间比例达到阈值时才尝试回填。缩放只作用于图片或图表内容，
  标题保持原字号和自然高度。
- ECharts 在分页前冻结为 SVG 图片，三类媒体共享回填决策与边界检查；
  无法安全回填时仍移至下一页，保证顺序、不跨页且不覆盖后续内容。
- 默认示例仅保留一张网络图片，并新增有效 Base64 横图、不同尺寸图片、
  Mermaid 和 ECharts，用于观察媒体分页、标题配对和渲染效果。
- 根 README、Desktop README、四个工作区包 README、进度文档和发布
  规范随版本同步更新。

### 3.19 v0.5.0 共享预览引擎与桌面多窗口

- 新增 `packages/preview-engine`，从 `apps/web` 抽取 Paged.js 运行时、
  Mermaid、ECharts、图片尺寸适配、媒体回填、跨页表格和共享页面 CSS。
- Web 快速预览、服务端 Playwright PDF 与 Electron PDF 直接使用同一个
  Preview Engine；Markdown 解析仍由 `packages/renderer` 的 markdown-it
  管线负责，应用服务继续统一主题与图片资源。
- 新增“连续”预览模式，不创建纸张和分页节点，适合高频编辑；快速预览
  保留分页反馈，精确预览与最终 PDF 继续作为权威结果。
- 增量分页根据源块稳定身份识别最早修改位置，复用此前稳定分页前缀，并
  串行重算受影响后缀；最终 PDF 不依赖客户端缓存。
- Web 只处理当前文档锚点和 HTTP/HTTPS 外链，外链使用浏览器新窗口；
  本地路径及不支持协议不会替换预览 iframe。
- Desktop 支持 HTTP/HTTPS、系统协议、相对或绝对本地路径及 `file:`
  URI；Markdown 链接提示在当前窗口或新窗口打开。
- Desktop 改为多窗口，并按规范化文件路径保持同一文件单例；窗口聚焦时
  比较磁盘修改时间，检测到外部变化后提示是否重新加载。
- 主窗口关闭后会选取仍存活的最新窗口作为状态持久化主窗口；窗口位置、
  尺寸和最大化状态仍按约 2 秒防抖写入并在启动时修正到可见工作区。
- Core 新增跨端文档链接分类与 PDF 本地链接编码协议；精确 PDF 使用
  `morphdoc.local.invalid` 暂存本地链接，PDF.js 注释层解码后交给平台。
- 内置主题名称统一为 GitHub、Pixyll、Whitey 和 Clean，默认主题为
  GitHub；删除强制覆盖主题链接样式的
  `!important`，保留主题自身设计。
- markdown-it 普通围栏输出 `pre.md-fences` 和可选 `lang`；Preview
  Engine 仅重置内部语义 `code` 的重复行内盒模型，代码块与行内代码均
  保持主题预期，Mermaid/ECharts 专用围栏不受影响。
- 根级 `build:web-runtime` 统一内嵌 Web 的六个工作区构建顺序；Desktop
  `package` 和 `make` 强制先调用该脚本，防止安装包复制陈旧
  `apps/web/dist`。

### 3.20 v0.5.1 正式文档主题与桌面文件工作流

- 围栏代码按正文宽度自动换行，长单词允许安全断行；代码内容统一保留
  `8px` 左侧内边距，并保留代码块外框、语法高亮和主题兼容 DOM。
- 多行代码块按至少两行一组生成可分页分片，当前页能容纳一组时不再将
  整块代码推到下一页；跨页分片保持连续边框和完整文本。
- 新增政企标准红头、函件红头、企业简版红头、简报红头 4 套红头主题，
  正式制度、正式报告、可研报告 3 套正式文档主题，以及经典标书、商务蓝
  标书、暗标 3 套标书主题。
- 主题清单新增分类、文档结构预设、推荐导出设置和页面装饰；没有主题推荐
  时保持 16mm 默认页边距，正式主题自动采用规范页边距、页眉页脚和页码。
- Renderer 根据结构化 Front Matter 生成红头、文号、签发人、密级、
  主送、正文、附件、落款、抄送和印发信息，也支持项目报告与标书封面。
- 红头标题使用居中网格布局，签发人不再挤压发文机关；正文、红头标题、
  页眉页脚使用主题内置 Fandol 中文字体，降低跨机器显示差异。
- `samples/tutorials` 内置 ECharts 和公文主题教程，包含 YAML 示例、
  字段说明、图表标题和图例渲染；公文教程保持 GitHub 阅读主题。
- `samples/themes` 为全部 14 套主题提供示例；Desktop 发行配置将教程、
  示例和字体随应用复制，打开主题示例时自动切换相应主题。
- 移除顶部加号入口，将文件操作、教程与示例、主题管理整合为三个菜单
  分区；文件操作统一命名为“新建文件”“保存文件”“另存为文件”。
- Desktop 支持 `Ctrl+N`、`Ctrl+W`、`Ctrl+S`、`Ctrl+Shift+S`，新建和
  关闭时对未保存内容进行确认；另存为成功后当前窗口追踪新文件路径，
  Web 端不显示或拦截“另存为”。

### 3.21 v0.6.0 DOCX 资源预处理

- `packages/core` 新增图片、Mermaid、ECharts 的媒体类型、捕获计划、
  PNG 资源清单和跨端限制常量；
- `packages/preview-engine` 复用连续文档运行时建立 DOCX 媒体舞台，
  等待图片、字体和图表完成后按 DOM 顺序生成捕获目标；
- 媒体按纸张方向、纸张尺寸、主题默认页边距和用户页边距限制显示宽高；
- 普通图片、SVG、Mermaid 和 ECharts 统一输出 PNG，默认 300 DPI，
  超大媒体会按 4096px 单边和 1600 万像素上限降低倍率；
- 捕获框使用覆盖元素边界的整数坐标，避免 Chromium 对小数坐标缩放时
  裁切边缘或产生不可预测的位图尺寸；
- `packages/application` 校验捕获计划、媒体 ID、PNG 签名、IHDR 尺寸、
  单图大小、总大小和计划匹配关系，并生成稳定文件名；
- Server 的 Playwright 与 Desktop 的 Electron 适配器均使用 Chromium
  DevTools 截图协议，不引入 Sharp、Python 或其他原生图片依赖；
- 真实 Chromium 冒烟已将输入 SVG 图片、Mermaid 和 ECharts 依次输出为
  753×378、809×222、2103×591 PNG，图表错误均为 0。

## 4. 已执行验证

2026-07-30 对 v0.6.0 阶段 5 执行：

- 完整工作区 61 个测试文件、308 项测试全部通过；
- Markdown ECharts、Core、Renderer、Application、Preview Engine、
  Web、Server 和 Desktop 类型检查全部通过；
- Web Runtime、Server 和 Desktop 生产构建通过；
- 真实 Playwright Chromium 使用 SVG 图片、Mermaid 和 ECharts 完成
  300 DPI PNG 捕获，媒体顺序、尺寸、格式和错误清单验证通过；
- `git diff --check` 通过，仅有 Git 对 Windows 工作区换行转换的提示。

2026-07-29 对 v0.5.1 完整工作区及最终代码块修复执行：

```text
pnpm test
pnpm run typecheck
pnpm run build
git diff --check
```

- 最终修复前的完整工作区共 65 个测试文件、286 项测试全部通过；将
  左侧内边距调整到共享分页规则后，Preview Engine 18 项和 Application
  9 项定向测试再次通过；
- Markdown ECharts、Core、Renderer、Application、Preview Engine、
  Web、Server 和 Desktop 类型检查全部通过；
- Web 生产资源、Server 和 Desktop 主进程/Preload 构建通过，生产资源
  中的应用版本为 `0.5.1`；
- 保留的手动验收服务继续运行：Web 与主题 API 均返回 HTTP 200，
  Electron 应用及其 GPU、网络、渲染进程正常存活；
- `git diff --check` 通过，仅有 Git 对 Windows 工作区换行转换的提示。
- v0.5.1 Windows 目录版、NSIS 和 ZIP 经完整内嵌 Web 重建后生成；
  目录版主程序文件版本为 `0.5.1`、产品版本为 `0.5.1.0`，启动后正常
  响应，并保留独立验收窗口。
- 目录版包含 14 套主题、14 份主题示例、2 份教程、5 个 Fandol WOFF2
  中文字体及其许可文件，语言包仅保留 `zh-CN` 和 `en-US`；ZIP 中同样
  检出主题、示例和字体资源。
- NSIS 安装包 `morphdoc-0.5.1-x86_64-Setup.exe` 为 114,688,014
  字节，SHA-256 为
  `676CCE73D782B0B15AC6BC68F253CFBC4740383583E4DAA98F746EDF9999C5CC`。
- 免安装包 `morphdoc-0.5.1-x86_64.zip` 为 152,183,607 字节，
  SHA-256 为
  `82BF6ADF1200604F145CC86FA3ED193955CF6741EBEE3DF8953483515CFF621F`。
- 主程序与安装包 Authenticode 状态均为未签名，与当前发行说明一致。
- 正式镜像 `morphdoc:v0.5.1` 内容 ID 为
  `sha256:72f519a69bfd6cb2f6df30c2be938e58ceb6f20e4748a32551874de3d436b276`；
  Compose 强制替换后健康运行在 `http://localhost:8080`。
- 容器确认包含 14 套主题和 17 份 Markdown 教程/示例；生产 Bundle
  同时包含代码自动换行、任意长单词断行和 `8px` 左侧内边距。
- 容器代码块回归 PDF 返回 HTTP 200，共 2 页、64,721 字节，
  Mermaid/ECharts 错误数均为 0；视觉检查确认长 SQL 正确换行、跨页
  连续、24 个字段完整且没有右侧越界。
- 本机 NSIS 安装项版本为 `0.5.1`，发布者为 `YIXIONG Tech.ltd`；
  用户完成安装和桌面端手动验收，未发现发布阻塞问题。

2026-07-28 在当前完整工作区成功执行：

```text
pnpm test
pnpm run typecheck
pnpm run build
git diff --check
```

结果：

- ECharts 围栏测试：36 项通过；
- Core 共享协议测试：15 项通过；
- 渲染器测试：14 项通过；
- 应用服务测试：11 项通过；
- Preview Engine 测试：53 项通过；
- 前端测试：54 项通过；
- 后端测试：29 项通过；
- 桌面端测试：26 项通过；
- 全项目共 238 项测试通过；
- 全项目类型检查通过；
- 生产构建通过；
- `git diff --check` 通过。

`v0.5.0` 双端与发行验收结果：

- 正式镜像 `morphdoc:v0.5.0` 内容 ID 为
  `sha256:13a0955f3629e4e96d7af9d38230ead5ff6b8b70be2b35d5f8da9fdeb1f66474`，
  大小 640,294,504 字节；Compose 使用该内容 ID 健康运行在
  `http://localhost:8080`。
- Web 快速、连续和精确预览完成真实浏览器验证：连续模式只有外层滚动，
  ECharts 使用完整内容宽度和配置高度；快速预览后缀编辑保留稳定前缀。
- Web 外链样式、受控新窗口和本地链接禁用通过；精确 PDF 注释层保留
  HTTP/HTTPS 与锚点，并能将 `.invalid` 地址解码为原始本地路径。
- Desktop 多窗口、同一文件单例、主窗口关闭后的状态接管、最大化防抖
  写入和重启恢复通过；本机安装版已升级至 v0.5.0。
- 围栏代码块在 GitHub 中显示完整外框且内部不再逐行出现行内
  代码方框；Web 与最终 Desktop 安装版均由用户确认，ECharts 围栏未受
  普通代码块兼容样式影响。
- 正式 NSIS 为 `morphdoc-0.5.0-x86_64-Setup.exe`，95,004,759
  字节，SHA-256 为
  `60992D1FDCA513F46346C78478537EB4159D8C0E76B41ECF3CDC25BE77707D92`。
- 正式 ZIP 为 `morphdoc-0.5.0-x86_64.zip`，132,485,574 字节，
  SHA-256 为
  `D74F82293FB67126E583546CBA894569EFC9A0B1B6343FAC648CCC95F1D188D8`。
- 安装版内嵌 `paged-preview` Bundle 与本地最新 Web Bundle 的
  SHA-256 均为
  `BD29762A2E3CF1A2AAC4DD055D623B42C754DF46A3E773DD99B01CDFDAE36CE5`；
  `.md`、`.markdown` OpenWithProgids 注册正常。

`v0.4.5` 双端与媒体分页验收结果：

- 正式镜像 `morphdoc:v0.4.5` 已完成多阶段构建，镜像内容 ID
  为 `sha256:0703c3762cd0e4e551ce44732b064a938c2095eb331a22e28861a148fe520354`；
  Compose 已强制替换为正式镜像并健康运行在 `http://localhost:8080`。
- 正式镜像 PDF 冒烟请求返回 HTTP 200，生成 1 页、96,661 字节 PDF，
  Mermaid 与 ECharts 错误数均为 0。
- 默认示例在 Web 快速预览与精确预览中均为 10 页；12 个媒体块均只
  出现一次，全部标题正确配对，无重叠、越界、解码或图表错误。
- 容器生成 `output/pdf/v0.4.5-media-pagination-rc.pdf`，共 10 页、
  928,803 字节；Mermaid 与 ECharts 错误数均为 0，逐页视觉检查通过。
- Desktop 新建、输入、默认标题文件名保存、原生 PDF 导出均通过；
  `output/桌面保存验收.md` 内容正确，Desktop README 导出 PDF 为 5 页。
- 从第二实例系统打开 `README.md` 时保持单窗口并自动加载；自定义主题
  目录能够打开且可识别已有主题。
- 窗口最大化变化约 2 秒后写入状态；重启恢复最大化。窗口位置与尺寸
  测试覆盖屏幕越界修正、最小尺寸、原子写入和损坏状态回退。
- 正式 NSIS 安装包为 `morphdoc-0.4.5-x86_64-Setup.exe`，
  94,998,489 字节，SHA-256 为
  `9CBD6362E15AA745185805E753D5A7749434E0E142E6CE0F66463E6A19468F1D`。
- 免安装包为 `morphdoc-0.4.5-x86_64.zip`，132,477,245 字节，
  SHA-256 为
  `97B2D44E72F626A3396E5AB5B330FFB7F9BECAF945A1707808C876940A82E850`。
- 正式目录版主程序版本为 `0.4.5`，只包含 `zh-CN` 和 `en-US` 语言包，
  Authenticode 状态为未签名，启动后应用与渲染进程均正常响应。
- 本机当前用户安装已从 `0.4.3` 原位升级到 `0.4.5`；卸载注册信息、
  桌面与开始菜单快捷方式、`.md` 和 `.markdown` 打开注册均验证通过，
  安装版应用启动正常。

Electron 桌面端第一阶段验证结果：

- Electron 43.2.0 应用窗口成功加载现有 React/Vite 界面，标题旁正确显示
  `v0.4.0`。
- 最小 Markdown 通过隐藏 Electron Chromium 生成 1 页、52,308 字节
  PDF，文字可搜索，并通过桌面原生保存通道落盘。
- 默认示例通过桌面端生成 4 页、439,501 字节 A4 PDF，Mermaid 和
  10 个 ECharts 图表错误数均为 0。
- 将默认示例全部 4 页渲染为 PNG 后逐页检查，Tree、Treemap、Sunburst、
  Graph、Sankey、Chord、Funnel、Gauge 和 PictorialBar 均完整显示，
  未发现空白页、黑块、跨页切割或明显裁切。
- PDF.js 可以从 4 页中提取 670 个非空白字符，各页均包含可搜索文字。
- Forge 成功生成 Windows x64 未签名目录包，生产窗口通过
  `morphdoc://bundle/index.html` 加载，版本徽标和界面静态资源正常。
- 精简后的 `app.asar` 约 554 KiB，Web 静态资源共 134 个文件、约
  9.0 MiB；运行目录只包含 Electron 自带的一套 Chromium。

已使用浏览器插件完成视觉验证：

- 默认示例中的 ECharts 柱状图生成 1 个内联 SVG，无错误占位；
- 顶栏文件名、分页状态与操作按钮在桌面和窄屏均无重叠；
- 桌面端源文本收起后宽度从 576px 降为 48px，预览区从 864px 扩展
  到 1392px；窄屏折叠条为 44px；
- 快速预览输入第 2 页后目标页顶端对齐 iframe 视口，滚动回首页和第二页
  时输入框分别同步为 1 和 2；
- 页码输入 0 和 99 时分别限制到 1 和总页数；
- 精确预览输入第 2 页后，目标页与桌面滚动容器顶部误差为 0；
- 快速预览改用外层滚动容器后，右侧容器边界为 1440px，纸张边界约为
  1400px，滚动条稳定贴在容器最右侧而非纸张边缘；
- 快速预览输入第 1 页后目标页与外层可视区域顶部误差为 0，外层滚动到
  第 2 页时页码输入框同步更新为 2；
- 快速预览在 50% 和 150% 下的可滚动高度分别随内容显示高度缩放，
  iframe 自身保持无滚动；切换精确/快速模式后仍使用同一右侧滚动条；
- 桌面端收起源文本后，预览滚动容器从 48px 延伸至窗口右边缘，纸张仍
  在扩展后的预览区域内居中；
- 窄屏精确预览自动使用主窗口滚动，并正确跳转到第 2 页；
- 页码控件在窄屏独占首行，缩放控件在下一行铺满，没有与预览模式或主题
  选择器重叠；
- 当前默认 Markdown 和主题资源加载正常，快速预览生成 2 页；
- 编辑 Markdown 后标题、表格、Mermaid 和分页状态均完成防抖重绘；
- 从本地 GitHub 主题切换到内置第三方主题后 iframe 正常重建；
- 本轮浏览器回归期间控制台无警告或错误；
- 预览缩放在 50%、100%、150% 和 400% 下均按比例显示，快速与精确
  预览的分页结果不受缩放影响；
- 包含 ELK、Base 主题、Hand-drawn 外观、自定义字体、
  `themeVariables`、`style` 和 `classDef` 的 Mermaid 样例在快速预览
  与精确预览中均成功渲染；
- 在 Windows 150% 系统显示缩放的笔记本内屏上，65 页附件的快速预览
  生成 64 页，67 个 Mermaid 全部使用静态 SVG；
- 同一附件的精确预览和最终 PDF 均为 65 页；
- 切换到 Windows 100% 系统显示缩放的外接显示器后，快速预览与精确预览
  的分页结果基本一致，进一步排除了 Chromium 版本差异这一判断方向；
- 精确预览快速跳转至第 46、47、65 页，无黑色 Canvas、空白页或渲染错误；
- PDF.js 同时只保留视口邻近页面的 Canvas，远端页面资源可以释放；
- Mermaid A/B PDF 页数、逐页文字和抽样视觉结果一致；
- 抽查第 2、6、27、53、65 页，Mermaid 尺寸、分页位置和末页内容正常。

ECharts 第二阶段浏览器与 PDF 验证结果：

- 默认示例生成 10 个 ECharts SVG，包含原柱状图和九种新增系列，错误
  占位数为 0，浏览器控制台无警告或错误；
- 快速预览生成 6 页，第 2～6 页各放置两张完整图表，所有图表边界均位于
  当前页内容区内，没有跨页切割；
- 精确预览同样生成 6 页，逐页跳转正常；Chord、Funnel、Gauge 和
  PictorialBar 的 PDF Canvas 视觉检查通过；
- 使用默认导出配置调用 PDF API 生成 4 页 PDF，响应中的 ECharts 和
  Mermaid 错误数均为 0；
- PDF 中九种新增图表的标题均可搜索；将全部页面渲染为 PNG 后，Tree、
  Treemap、Sunburst、Graph、Sankey、Chord、Funnel、Gauge 和
  PictorialBar 均显示完整，未发现裁切、重叠、黑块或空白图表。
- 修正 Treemap 示例后再次检查快速与精确预览：底部下钻面包屑已隐藏，
  五个叶节点边界清晰；SVG 中父级和叶节点共 7 个标签均处于可见状态。
- 进一步确认此前 Treemap 标签虽存在于 SVG，但被冻结在入场动画初始帧，
  `fill-opacity` 约为 `0.000014`，肉眼近似完全透明；全局关闭动画后，
  快速预览和精确 PDF 中的 2 个父级及 5 个叶节点标签均清晰可见。

2026-07-27 已重新构建并启动本地发布候选镜像：

- 使用完整多阶段 `deploy/Dockerfile` 构建
  `morphdoc:v0.3.0`，镜像大小约 612 MB；
- Compose 强制重建后容器健康检查通过，服务继续监听
  `http://localhost:8080`；
- 首页返回 200，`POST /api/render` 的 ECharts 冒烟请求返回
  `code`、`echarts` 功能标识和 `md-echarts` 安全占位；
- 容器内 `@morphdoc/markdown-echarts` 工作区包可正常加载；
- 当前镜像已通过发布前手动验收，并作为 `v0.3.0` 发布镜像保留运行。

此前主题阶段已使用浏览器插件完成视觉验证：

- 导入并打开 `tmp/真实周报样本.md`；
- 参考 `tmp/真实周报样本.pdf` 的 PDF 输出；
- GitHub、Pixyll 和 Whitey 三套保留的本地主题均可正常切换；
- 三套主题中的表格均为 `border-collapse: collapse`、单元格间距为 0，并铺满 `#write` 内容宽度；
- GitHub 表格边框颜色与主题定义的 `#dfe2e5` 一致；
- Open Sans、PT Serif 和 Merriweather 字体资源均成功加载；
- KaTeX、代码高亮和 Mermaid 正常显示；
- 浏览器控制台无警告或错误。

2026-07-26 已在 Docker Desktop 完成 AIO 容器验证：

- Docker Compose 配置展开、镜像构建、启动、健康检查和重启恢复通过；
- 运行镜像约 611 MB，Node.js、Nginx、Fastify 和 Chromium 均以非
  root UID 999 运行；
- Nginx 首页、分页运行页、API、主题 CSS 和 PDF.js Worker 均正常；
- 默认只读挂载识别 1 个内置主题和 3 个本地主题；
- 周报通过容器导出为 4 页，附件通过容器导出为 65 页，Mermaid
  错误数均为 0；
- 两份 PDF 的所有页面均包含可搜索文字，附件共提取 68,434 个字符；
- 抽查周报第 1、4 页和附件第 1、33、65 页，未发现裁切、重叠、
  黑块或空白页；
- 浏览器快速预览、主题切换、精确 PDF.js 预览和导出交互通过；
- 修复 Nginx 缺少 `.mjs` MIME 映射导致精确预览 Worker 加载失败的问题。

`v0.3.0` 发布验收完成后，已停止并删除本项目 Compose 容器及网络以释放
本地资源；`morphdoc:v0.3.0` 镜像继续保留。

2026-07-27 已构建并启动 `v0.3.1` 发布候选：

- 使用完整多阶段 Dockerfile 构建 `morphdoc:v0.3.1`，镜像
  大小约 612 MB；
- Compose 容器使用该镜像运行并通过健康检查，服务监听
  `http://localhost:8080`；
- 容器首页返回 200，默认 Markdown 解析出 10 个 ECharts 围栏，
  错误占位和渲染警告均为 0；
- 容器生成的默认配置 PDF 为 4 页、约 521 KiB，ECharts 和 Mermaid
  渲染错误数均为 0；
- ECharts 已编译进按需加载的前端浏览器 Bundle，生产运行时不需要保留
  独立的 `echarts` Node.js 包；
- 当前容器保留运行，等待 `v0.3.1` 发布前手动验收。

2026-07-27 已完成 `v0.4.0` 最终发布候选验证：

- 生成本地镜像 `morphdoc:v0.4.0`，镜像内容 ID 为
  `sha256:1bf4a136e9b822fa0925070cd522ea2adbad8b388d8e039d6509024d466666b3`；
- Compose 强制替换为 v0.4.0 后健康检查通过，首页返回 200，健康接口
  返回 `ok`，主题接口返回 4 个 `bundled` 主题；
- 容器 Chromium 生成中文、表格、KaTeX、代码和 Mermaid 验收 PDF，
  HTTP 200、1 页、147,374 字节，Mermaid/ECharts 错误数均为 0；
- PDF 渲染为 PNG 后检查通过，中文、公式、表格、代码、图表、页边距和
  页码均正常，无裁切、重叠、黑块或空白；
- Compose 网页真实加载后标题旁显示 `v0.4.0`，主题选择器包含 4 个内置
  主题，多页预览和图表正常，浏览器控制台无错误；
- Forge Squirrel 安装包、NUPKG 和 ZIP 均已生成，安装包约 137.48 MiB，
  当前 Authenticode 状态为未签名。

2026-07-27 已完成 `v0.4.1` 图片资源发布候选验证：

- 用户提供的 `tmp/数据工程规划.md` 成功解析 2 张本地 PNG，生成约
  5.0 MB 内嵌 HTML，图片自然宽度均为 8192px，零资源告警。
- Web 真实选择 Markdown 与 `.assets` 目录后生成 4 页快速预览，两张
  本地图片均完整位于各自页面内容区。
- Wikimedia SVG、NASA JPEG 和 Unsplash JPEG 三种公网图片均完成下载、
  格式识别、Data URL 内嵌和自然尺寸解码。
- 1200×1800 超高网络图在扣除标题高度后缩放；最终图片约 977px 高，
  图加标题约 1001px 高，完整位于同一页且未复制、裁切或跨页。
- 默认示例的快速预览和精确预览均为 7 页，两个图片标题可见；容器
  Playwright PDF 的精确预览同样为 7 页。
- Electron 目录版显示 `v0.4.1`，使用 Electron 内置 Chromium 成功渲染
  两张默认网络图片；Windows 主程序仍为 `morphdoc.exe`。
- 最终 Squirrel 安装包为
  `Markdown PDF 导出器-0.4.1 Setup.exe`，144,166,400 字节，SHA-256
  为 `FC6687494255EE21224B65C1CA2D520316D568CCE8EB99A608A0DEF160611F4E`，
  Authenticode 状态为未签名。
- 本地镜像 `morphdoc:v0.4.1` 内容 ID 为
  `sha256:1ded8a8a11ecb8b69eaa116bb9129dd4ec039e9918b047169fe5f8add2af3a80`；
  Compose 容器健康运行在 `http://localhost:8080`。

2026-07-27 已完成 `v0.4.2` 桌面维护版本验证：

- 仅重新构建桌面端及其内嵌 Web 静态资源，没有重新构建或替换
  Web/Compose 发布镜像。
- Windows 目录版视觉检查通过：默认原生菜单栏已经移除，应用内容直接
  位于系统标题栏下方，版本徽标显示 `v0.4.2`。
- Windows 主程序继续使用英文文件名 `morphdoc.exe`。
- Squirrel 安装包为 `Markdown PDF 导出器-0.4.2 Setup.exe`，
  144,166,400 字节，SHA-256 为
  `59DA57522C99EB6B16A9591AFDEC349B785BF9B76950504B314273520152D41B`，
  Authenticode 状态为未签名。

2026-07-27 已完成 `v0.4.3` 标准安装向导验证：

- NSIS 中文辅助安装向导正确显示安装范围和安装目录选择，版本显示为
  `0.4.3`。
- 当前用户安装成功，安装目录为
  `%LOCALAPPDATA%\Programs\morphdoc`，卸载项版本为 `0.4.3`。
- 桌面和开始菜单快捷方式均存在，实际目标均为安装目录中的
  `morphdoc.exe`；从开始菜单快捷方式启动成功。
- 静默卸载返回 0，安装目录、桌面快捷方式和开始菜单目录全部清理；
  随后重新安装成功，最终本机保持已安装状态。
- 正式安装包为 `morphdoc-0.4.3-x86_64-Setup.exe`，
  103,346,230 字节，SHA-256 为
  `C027B4AC604889C7E7E00BA3CE08A12616312BC9250268775B1B7B578A7C4817`，
  Authenticode 状态为未签名。
- 免安装包为 `morphdoc-0.4.3-x86_64.zip`，143,784,617 字节，
  SHA-256 为
  `91BED88A7CB623B98383408D5553D80A6135FB94F7FE2D77A5FCED339CCF5BC6`。

2026-07-27 已完成 `v0.4.4` 桌面语言包精简验证：

- 目录版只包含 `zh-CN.pak` 和 `en-US.pak`，语言资源从 55 个、
  48,911,653 字节降为 2 个、1,137,843 字节。
- 目录版总大小从 378,084,454 字节降为 330,310,644 字节，减少
  47,773,810 字节；Chromium 图形与软件渲染后备组件均保持完整。
- Windows 主程序版本为 `0.4.4`，目录版成功启动并保持应用、GPU、
  渲染器等 4 个 Electron 进程正常运行。
- 正式安装包为 `morphdoc-0.4.4-x86_64-Setup.exe`，94,991,759 字节，
  SHA-256 为
  `0827FD87A8EEC8B034DF738909CB6A20231245B507AE4A0BAA579AFA03A942DE`，
  Authenticode 状态为未签名。
- 免安装包为 `morphdoc-0.4.4-x86_64.zip`，132,470,241 字节，
  SHA-256 为
  `D6CDB8DAE30676BAB6B2A037567164476AD294588B102A6FBBE9458ABCE5CCC0`。

## 5. 当前注意事项

- `output/` 可能包含本地 PDF 验证产物，已被 Git 忽略，不得提交。
- `apps/web/src/App.tsx` 负责分页 iframe 生命周期和父页面消息处理。
- `apps/web/src/use-markdown-render.ts` 负责 Markdown 防抖请求、取消和
  渲染错误状态。
- `apps/web/src/use-theme-resources.ts` 负责主题清单、主题 CSS 和请求取消。
- `apps/web/src/paged-preview-frame.ts` 负责 iframe 消息协议和运行目标选择。
- `packages/preview-engine/src/paged-document-runtime.ts` 是连续预览、
  快速预览和 PDF 共用的媒体渲染、资源等待和 Paged.js 运行时。
- `packages/preview-engine/src/continuous-preview.ts` 与
  `incremental-pagination.ts` 分别负责无分页 DOM 更新和后缀分页缓存。
- `packages/preview-engine/src/paged-preview.ts` 负责分页协议、共享文档
  CSS、页眉页码和代码围栏结构兼容。
- Mermaid、ECharts、图片适配、媒体回填及跨页表格实现均位于
  `packages/preview-engine/src/`，不得在 Web 或 Desktop 复制第二套。
- `apps/web/src/PrecisePdfPreview.tsx` 和 `pdf-render-queue.ts` 负责 PDF.js 精确预览和 Canvas 生命周期。
- `apps/web/src/document-link.ts` 与 `pdf-annotation-links.ts` 负责 Web
  链接动作和精确 PDF 注释层适配。
- `apps/web/src/PreviewPageControl.tsx` 和 `preview-page.ts` 负责当前页输入、
  页码边界、滚动页识别和快速跳转。
- `apps/web/src/preview-zoom.ts` 和 `PreviewZoomControl.tsx` 负责预览缩放缓存、边界和控制界面。
- `apps/web/src/MarkdownEditor.tsx` 负责 CodeMirror 受控状态、文档历史
  重建、快捷键、焦点和滚动容器适配；`MarkdownToolbar.tsx` 与
  `markdown-editor-commands.ts` 负责可扩展命令注册和基础工具栏。
- `packages/markdown-echarts` 负责 ECharts YAML 协议、验证、安全过滤、
  Markdown-it 插件、浏览器 SVG 渲染和分页样式。
- `apps/server/src/pdf-engine.ts` 负责 Chromium 生命周期、并发、网络限制、分页调用和 PDF 输出。
- `apps/web/src/ExportSettingsDrawer.tsx` 是导出设置界面。
- `apps/web/src/export-settings.ts` 负责版本化浏览器缓存。
- `packages/core/src/export-config.ts` 是纸张、页边距、页眉页脚和页码的共享模型。
- `packages/core/src/document.ts` 是渲染文档、分页载荷、运行结果和耗时的
  共享模型。
- `apps/server/src/app.ts` 是新增的可测试 Fastify 应用。
- `packages/application` 负责共享 Markdown 渲染和主题应用服务；
  `apps/server` 与 `apps/desktop` 分别提供 HTTP 和 IPC 适配。
- `packages/docx-engine` 负责安全读取 Pandoc 默认模板、解析主题 DOCX
  样式、发现并校验固定 Pandoc、生成动态 OOXML、执行静态 Lua 媒体替换、
  请求级临时转换和最终结构校验。
- `packages/document-visual-diff` 负责 Word/WPS/PDF 页面快照、文本与
  栅格差异、可配置视觉门限以及 JSON/HTML 验收报告；该包仅用于开发和
  发布验收，不进入应用运行时。
- `packages/font-pack-registry` 负责可选字体包协议、版本兼容、安全发现、
  资源哈希与容量门禁、确定性版本选择和逻辑字体面匹配；应用层已将同一
  解析结果用于主题 CSS 的 WOFF2 和 DOCX 的静态 TrueType，发行资产与
  安装逻辑留在 FP3。
- `packages/font-pack-builder` 负责从仓库内冻结资源构建版本化字体包，
  校验输入哈希、字体格式、内部元数据、嵌入权限、同版本不可变性并生成
  可供注册器再次验证的构建报告；正式字体二进制直接入库，构建产物、门禁
  报告和 `release/` 均不进入 Git。
- `packages/application/src/docx-export-service.ts` 负责 DOCX capability、
  并发排队、总超时、取消、跨端转换编排、错误码和耗时诊断。
- `apps/desktop/src/desktop-application-controller.ts` 负责 Electron
  多窗口、同文件单例、文件变化检测和平台链接动作；`main.ts` 负责启动
  组装、协议和生命周期。
- `apps/desktop/src/desktop-document-link.ts` 负责本地链接解析和
  Markdown 目标识别。
- `apps/desktop/src/electron-pdf-generator.ts` 负责隐藏 PDF 窗口、分页
  调度、网络限制、打印和窗口复用。
- `apps/desktop/src/app-preload.ts` 与 `pdf-preload.ts` 分别定义应用
  窗口和 PDF 运行窗口的最小 IPC 能力。
- `.local/themes/` 只用于外挂自定义主题；四套发布主题已经内置，无需
  重复挂载。历史副本保存在 `.local/theme-backups`，均被 Git 忽略。
- 三套第三方导入主题随项目内置，来源与作者登记于 `themes/THEME_NOTICE.md`。
- 快速预览会受到客户端 Windows 显示缩放、浏览器缩放和设备像素比影响；
  对页数和分页边界有严格要求时，以精确预览和最终 PDF 为准。
- 图片资源不落盘：Web 使用当前请求内 Base64 资源，Desktop 从受限文档
  目录读取；远程图片仅保留有界内存缓存。
- 桌面端已通过进程内共享服务实现离线 Markdown 渲染、主题读取和 PDF
  导出，不依赖 Fastify 或本地 HTTP Server。
- `v0.5.0` AIO 正式镜像已经通过 Docker Desktop 构建、PDF 冒烟和
  Compose 健康检查，当前 Compose 容器保持运行。
- Desktop `package` 和 `make` 必须经过 `build:embedded-web`；禁止直接
  调用 electron-builder 复制未经本轮编译的 `apps/web/dist`。

## 6. 推荐接手顺序

### 阶段一：v0.6.0 分阶段开发

- 阶段 1：已冻结架构、能力边界和 Word/WPS 验收门禁；
- 阶段 2：已冻结 Pandoc `3.9.0.2`、许可证、Docker 与 Desktop
  分发方式；
- 阶段 3：已实现 DOCX 共享模型和跨端导出协议；
- 阶段 4：已实现 CodeMirror 6 与可扩展基础 Markdown 工具栏；
- 阶段 5：已实现 DOCX 资源预处理和跨端 Chromium PNG 捕获适配器；
- 阶段 6：已实现动态 reference.docx、主题样式映射和真实 Pandoc 验证；
- 阶段 7：已实现 Pandoc 运行时、Lua 媒体映射和共享转换服务；
- 阶段 8：已实现 Web/Desktop DOCX 导出交互；
- 阶段 9：已完成 DOCX 自动化结构、真实 Pandoc、Server HTTP 与
  Desktop 保存验收；
- 阶段 10：已完成 Word 原生页眉页脚和第一轮全主题视觉审计；完整主题
  映射门禁未通过；
- 阶段 11：已建立独立 `packages/docx-theme-engine`、标准语义槽位及
  快照、令牌、来源、置信度、诊断协议、标准探针 DOM 和平台无关采集器；
  Playwright/Electron 真实采集、主题指纹缓存和双引擎一致性矩阵已通过；
  CSS 计算值到 Word 样式令牌的通用归一化、清单覆盖、预设降级和结构
  近似诊断已通过 14 主题双引擎矩阵；下一步由统一语义文档模型消费令牌；
- 阶段 12A：已建立独立统一语义文档模型，Renderer 与 DOCX 准备结果
  共用同一语义树，现有 HTML DOM 保持兼容；
- 阶段 12B：已将跨端主题令牌接入动态 `reference.docx`，14 主题双引擎
  令牌和真实 Pandoc 模板矩阵通过；
- 阶段 12C：已完成通用 Pandoc 结构映射、封面真实分节、标题去重、
    表格内容区全宽、分页控制、OOXML 严格性和 14 主题真实 Word/WPS
    无修复打开门禁；
- 阶段 12D-R2：已完成可分发字体嵌入和三套代表主题真实 Word/WPS
  编辑互存；
- 阶段 12D-R3：已完成独立 PDF/DOCX 视觉差异引擎、精确行距、字体
  字重规范化及通用 SFNT 到 Word 字体元数据映射，并通过 Word/WPS
  原生视觉与可编辑性验收；
- 阶段 12D-FP1：已完成可选字体包协议、安全注册器、版本/根目录优先级、
  资源双重校验和字体候选匹配；
- 阶段 12D-FP2：已完成 Preview/PDF WOFF2 与 DOCX 静态 TrueType 的
  同源字体解析、跨端受限资源入口、缓存指纹、降级诊断和真实字体包验证；
- 阶段 12D-FP3-A：已完成独立字体包构建器、冻结配方、许可证与来源追踪、
  同版本不可变门禁和真实资产构建；
- 阶段 12D-FP3-B：已完成独立用户级 NSIS 字体包、原子安装/升级/卸载、
  主安装器同目录哈希校验和显式静默开关；
- 阶段 12D-FP3-C：已完成 Docker v0.6.0 DOCX/Pandoc 运行链和早期可选
  字体挂载门禁；发布收口阶段 C 已进一步改为镜像内置字体并移除运行时卷；
- 阶段 12D-R4-2：已完成 14 套主题的标准结构基线、可选字体包、真实
  Server HTTP、Chromium PDF 与生产 DOCX 矩阵；
- 阶段 12D-R4 媒体专项：已完成稳定 PNG 布局、严格 DrawingML、五媒体
  Word/WPS 编辑互存、隔离逐页视觉比较和题注居中门禁；
- 阶段 12D-R4 布局视觉矩阵：曾记录为完成六组 Chromium/Word/WPS
  元素级严格门禁；`v0.6.1` 发布后复核确认该矩阵只覆盖五套主题，且外层
  过滤了像素、墨迹 IoU 和边缘 IoU failure，因此不构成有效严格门禁；
- 发布收口阶段 A：已完成 v0.6.0 版本、墨呈/MorphDoc 品牌、NSIS 名称、
  文件关联兼容和旧版用户数据迁移；
- 发布收口阶段 B：已完成 Desktop 固定 Pandoc 最小运行时的清单、下载
  哈希门禁、许可证保留、打包接入、离线复验和真实 DOCX 冒烟；
- 发布收口阶段 C：已完成确定性字体 ZIP、MorphDoc 字体安装器命名、
  Desktop 同目录可选附件、Docker 镜像内置字体和真实 DOCX 发行门禁；
- 发布收口阶段 D：已完成统一 `release/v<version>` 产物目录、Docker 离线
  镜像封包、部署 ZIP、清单与校验和规则，并将正式字体纳入仓库固定目录（后续公开版已取消 Git LFS）；
- 阶段 13：完成 Word/WPS 双向互存、外部主题兼容、体积和正式发布验收。

### 阶段二：v0.6.1 DOCX 视觉一致性修复

- 阶段 A：已完成。修复所有 failure 的发布阻断聚合，补齐四套独立封面
  场景，并禁止正文回流封面页；四套封面真实 Word/WPS 复验均已被现有
  视觉差异正确阻断；
- 阶段 B：已完成。正文段落按内容顺序映射为与物理页号无关的视觉块，
  保留实际行坐标和 PDF.js 字体分类诊断，逐行裁剪局部栅格并输出叠加图、
  热力图；正文整页栅格降为诊断，封面仍为整页硬门禁。单元测试 47 项、
  全项目类型检查和生产构建通过；真实 GitHub 紧凑 Letter 纵向场景观测
  22 个正文块、输出 102 张失败局部热力图并正确阻断。PDF.js 泛化字体名
  不作为字体硬门禁，真实字体解析留在阶段 D；
- 阶段 C：已完成。矩阵生成器从 14 套内置主题清单生成纵横两个方向 ×
  主题默认、标准、紧凑、宽松、非对称装订五组页边距，共 140 个唯一
  排版场景；主题默认链路保持 `marginMode: theme`，即使与显式数值相同
  也不去重。机器报告记录定义、执行完整度以及主题、方向、边距分层汇总，
  HTML 报告固定显示 14 行 × 10 列并链接三份引擎详细报告。5 项矩阵结构
  测试通过；真实 `red-briefing--portrait--theme-default` 验证解析为主题
  默认 25mm 四边距，14 个正文块中 Word 有 13 个失败、字体部件仍为 0，
  总计 76 个阻断问题；`formal-feasibility--landscape--binding` 验证 A4
  横向、非对称装订边距和独立封面整页 strict 门禁，封面因墨迹与边缘
  IoU 不达标被阻断；全仓库测试、类型检查、生产构建和差异检查通过；
- 阶段 D：已完成。D1/D2 将字体门禁扩展到 PDF 实际字体解析、DOCX
  声明与嵌入数量，以及 Word/WPS 是否真正采用 Office 嵌入别名；新增
  `morphdoc-sans-sc@1.0.0` 和 `morphdoc-mono@1.0.0`，与
  `morphdoc-serif-sc@1.0.0` 组成确定性三字体包。D3 重建四套独立封面整页
  门禁，40 个封面方向/边距组合全部通过。D4 完成正文语义块视觉收口：
  通用翻译层统一处理字体、中文标点字距、精确行距、段落、列表、表格、
  引用、代码块和行内代码连续性；最终 140 个 Chromium、Word、WPS
  真实场景全部执行并通过，阻断失败和诊断失败均为 0；
- 阶段 E：已完成。源码服务、正式 Docker Web API 和实际安装 Desktop
  使用同一 `red-briefing` 复验，三份 DOCX 均约 24.17 MB、包含 5 个字体
  部件和 40,731,432 字节嵌入字体；安装版产物经 Word/WPS 渲染均为 2 页
  A4，逐页视觉通过；
- 阶段 F：已完成最终发行重构。Desktop 的 Serif、Sans、Mono 三套字体包
  直接内置于安装器和免安装 ZIP，NSIS 不再显示字体选择页，正式发行不再
  拆分字体安装器或字体 ZIP。正式安装包为 185,578,422 字节，免安装 ZIP
  为 242,513,118 字节；安装版默认媒体示例真实导出 10,931,974 字节的
  DOCX，包含 7 个字体部件和 12 个媒体部件。Docker 使用 `--pull`、
  `--no-cache` 且禁用运行层复用的完整路径正式构建，镜像内容 ID 为
  `sha256:f81dbce5857a0a5496851e149936d1fd7da52b76c035187be1079fa1fd5a4717`。
  `release/v0.6.1` 只归集 Desktop 安装器与 ZIP、Docker 离线镜像、Web
  部署包和发行说明五个主附件，并生成机器清单与包含六项的 SHA-256 校验
  文件；发布引用由本轮 `release:` 提交和重新创建的 annotated `v0.6.1`
  标签统一指向最终发行状态。

### 阶段三：v0.6.2 DOCX 真实文档门禁修复

- 发布门禁已由一次性 560 拆分为四套独立 140：标准合成基线优先，随后
  按 `tmp` 三份真实 Markdown 的文件字节数升序逐套执行。每套独立保存
  `progress.json`、`aggregate.json` 和 HTML 报告；旧 560 后台流程停用；
- 标准合成基线已加入表格内 `<br>`、`<br/>`、`<br />` 与行内代码
  `` `<br>` `` 的隔离语义检查，并覆盖全 JSON 围栏缩进、行内代码连续性、
  表格末行对齐和代码高亮翻译；
- 通用表格翻译链现会在分页前冻结完整自动布局列轨，将稳定元数据复制到
  Paged.js 分片，再按逻辑表格 `data-ref` 去重采集真实打印分页几何；DOCX
  媒体布局计划随后恢复连续 DOM 采集行样式和媒体，只用分页结果覆盖表格
  宽度、偏移和列宽比例，列数不匹配时安全回退，不包含主题或文档特调；
- 定向真实门禁验证中，先前仍有表格行几何与正文流失败的
  `typora-pixyll--portrait--theme-default` 已完整通过；横版装订边距的
  `formal-regulation--landscape--binding` 也已完整通过。Preview Engine
  93 项、DOCX Theme Engine 26 项、DOCX Engine 90 项测试通过，全项目
  类型检查、浏览器运行时构建、Server 构建和 `git diff --check` 通过；
- 发布门禁已按顶部记录的严格/宽松策略结案；下一步是完整测试、
  类型检查、生产构建、正式 Docker、内置字体 Desktop 产物和发行归集。

每个阶段验收通过后创建一个独立提交，再进入下一阶段。当前阶段不得混入
后续阶段的功能实现。

### 阶段四：后续版本扩展

- Front Matter 可视化编辑工具；
- ECharts YAML 可视化配置工具；
- 更完整的自定义主题 DOCX 显式样式清单；
- 浏览器本地配置预设及配置 JSON 导入和导出。

## 7. 首版验收目标

- 可以选择或粘贴 Markdown；
- 网页正确预览常用 Markdown、公式、Mermaid 和 ECharts；
- 可以下载真实 PDF；
- PDF 文本可搜索；
- 预览与 PDF 基本一致；
- 支持 A4、Letter、方向和边距；
- 支持基础页眉、页脚和页码；
- 支持主题切换扩展；
- 相对图片可用；
- 转换后不保留用户文档；
- Docker Compose 可在内网启动。
