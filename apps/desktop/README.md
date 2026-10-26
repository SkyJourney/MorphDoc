# Desktop 桌面端

`apps/desktop` 是 Electron 桌面应用。当前已经完成 Electron 壳、受限
preload、进程内应用服务、原生 Markdown 打开与保存、同目录图片解析、
本地主题目录、隐藏分页窗口、Electron Chromium PDF 输出和 Windows
安装包。

桌面端会记住上次窗口的位置、尺寸和最大化状态；窗口变化后延迟写入，
异常退出后也能恢复。恢复时会按当前显示器工作区修正位置与尺寸，避免窗口
落在屏幕外。Windows 安装包会注册 `.md` 和 `.markdown` 文件关联，
双击文件或使用“打开方式”会在对应文档窗口中加载文件；同一文件只保留
一个窗口，其他文件可以同时使用多个窗口。

窗口每次获得焦点时会检查源文件是否被其他程序修改。检测到变化后提示
重新加载，避免阅读或导出磁盘旧版本。

“打开 Markdown”是顶部独立主操作；新建、保存、另存为、教程、主题示例
和自定义主题目录统一收纳在“更多”分区菜单中。新建文档未保存时显示“未命名文档”，
首次保存默认使用一级标题作为文件名；没有一级标题时使用首行文本，并会
自动清理 Windows 非法文件名字符。“另存为”完成后当前窗口会追踪新文件，
行为与常见办公软件一致。新文档无需先保存即可直接导出 PDF。

## 开发

从仓库根目录运行：

```powershell
pnpm run desktop:dev
```

桌面端不启动 Fastify，也不占用本地 HTTP 端口。React 界面通过受限 IPC
调用 `packages/application` 中的 Markdown 渲染和主题服务，PDF 由
Electron 自带 Chromium 生成。Web 与 Docker 继续通过 Fastify HTTP
适配器使用同一套应用服务。

## 构建与打包

```powershell
pnpm --filter @morphdoc/desktop run build
pnpm run desktop:package
pnpm --filter @morphdoc/desktop run make
```

`package` 和 `make` 会先调用根级 `build:web-runtime`，完整重建
Markdown ECharts、Core、Renderer、Application、Preview Engine 和 Web，
再按固定清单下载或复用 Pandoc `3.9.0.2` 缓存、校验官方 ZIP 的
SHA-256，并执行版本与最小 DOCX 冒烟，最后才调用 electron-builder。
不得绕过该链路直接调用 electron-builder。

Pandoc 构建缓存位于被 Git 忽略的 `apps/desktop/.runtime/`。发行目录只
包含 `pandoc.exe`、`COPYING.rtf`、`COPYRIGHT.txt` 和生成的审计清单，
不会携带官方 MSI、手册、下载缓存或用户级 Pandoc 配置。已准备运行时可用
以下命令离线复验：

```powershell
pnpm --filter @morphdoc/desktop run verify:pandoc-runtime
```

版本化目录包、NSIS `Setup.exe` 和 ZIP 输出到
`apps/desktop/out/v0.6.4/`。该目录被 Git 忽略。正式安装包为
`MorphDoc-0.6.4-x86_64-Setup.exe`，ZIP 作为免安装
辅助包；当前未配置代码签名，Windows 首次运行可能显示“未知发布者”
提示。

Serif、Sans、Mono 三套正式字体随 NSIS 安装包和便携 ZIP 直接进入
`resources/font-packs`，由应用私有加载，不写入 Windows 系统字体目录。
安装向导不再提供字体选择页，正式发行也不附带独立字体安装器或字体 ZIP。

NSIS 使用标准辅助安装模式，支持选择当前用户/所有用户安装和自定义安装
目录，并创建桌面及开始菜单快捷方式。正式安装包作为 Gitea Release 附件
发布，不提交进 Git 历史。

桌面和开始菜单快捷方式由 `build/installer.nsh` 显式创建，安装完成后的
“运行”操作直接启动 `MorphDoc.exe`，不依赖快捷方式文件。

界面、快捷方式与卸载项使用中文名“墨呈”，窗口标题为
“墨呈 · MorphDoc”，默认安装目录和 Windows 主程序分别为 `MorphDoc`
和 `MorphDoc.exe`。NSIS appId 保持 `com.morphdoc.desktop`，确保
v0.5.1 覆盖升级沿用原卸载身份；v0.6.0 使用独立的安装位置注册表键，
升级时由旧版卸载器清理 `morphdoc` 目录，再安装到 `MorphDoc` 目录，
避免产品改名后继续继承旧目录名。

当前目录包只包含一套 Electron Chromium，不携带 Playwright Chromium；
Pandoc 作为未修改的独立程序随 Desktop 内置，通过受控子进程执行。
Web 静态资源作为只读资源放在 Electron `resources/dist` 下，生产环境通过
`morphdoc://bundle/` 自定义协议加载。

## 链接与窗口行为

- 当前文档 `#anchor` 在当前预览中定位；
- HTTP/HTTPS 链接交给系统默认浏览器；
- `mailto:` 等系统协议交给操作系统处理；
- 上级相对路径、本地绝对路径和 `file:` URI 均可尝试通过系统打开；
- Markdown 文件会提示在当前窗口或新窗口打开；
- 同一规范化文件路径只允许一个窗口，重复打开时聚焦已有窗口；
- 本地目标不存在时显示明确错误，不允许链接替换预览 iframe。

发行包只保留 Electron 的简体中文和英文语言包，其他 Chromium 运行时
组件保持完整，以兼顾安装体积和不同 Windows 图形环境下的运行可靠性。

## 安全边界

- 应用窗口和 PDF 窗口均关闭 Node Integration；
- 启用 Context Isolation 和 Chromium Sandbox；
- preload 只暴露打开 Markdown、渲染、主题、生成 PDF 和保存 PDF 所需
  的窄接口；
- 本地图片只能从当前 Markdown 所在目录内读取，并拒绝路径穿越和符号
  链接越界；
- 主进程校验 IPC 发送者和分页载荷；
- PDF 窗口使用独立内存 Session，并阻止外部网络资源；
- 应用页面使用自定义协议，不使用 `file://`。
