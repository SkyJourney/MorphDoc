# 内置字体包集合构建

本目录保存字体包配方、许可证、来源说明和正式冻结字体资产。字体二进制
位于固定的 `font-packs/assets/`，直接以普通 Git 对象入库，不使用 Git LFS。
Desktop 安装版、便携版和 Docker 镜像都直接包含本次受校验的
完整字体包集合，不再依赖用户另行安装字体附件。

## 源目录

正式发布字体必须先完成许可证、来源、内部字族名、嵌入权限和哈希审查，
随后固定存放在以下版本化仓库目录：

```text
font-packs/assets/morphdoc-serif-sc/1.0.0/
├── MorphDocSerifSC-Regular.ttf
├── MorphDocSerifSC-Regular.woff2
├── MorphDocSerifSC-Bold.ttf
└── MorphDocSerifSC-Bold.woff2

font-packs/assets/morphdoc-sans-sc/1.0.0/
├── MorphDocSansSC-Regular.ttf
├── MorphDocSansSC-Regular.woff2
├── MorphDocSansSC-Bold.ttf
└── MorphDocSansSC-Bold.woff2

font-packs/assets/morphdoc-mono/1.0.0/
├── MorphDocMono-Regular.ttf
├── MorphDocMono-Regular.woff2
├── MorphDocMono-Bold.ttf
└── MorphDocMono-Bold.woff2
```

该目录中的 `ttf/otf/woff/woff2` 以普通 Git 对象入库。
构建器不会联网下载或自动替换字体。派生字体通过
`font-packs/scripts/build-noto-static.py` 从来源说明固定的 Noto CJK
可变字体生成；每个发行输入文件都必须与配方声明的
字节数和 SHA-256 完全一致；TTF 还必须是无需运行时规范化的原生静态
TrueType，并具有可安装或可编辑的文档嵌入权限。

## 构建与验证

```powershell
pnpm run build:font-pack
pnpm run verify:font-pack
```

字体资产缺失或损坏时，字体构建会因文件大小
或 SHA-256 不匹配而拒绝继续，不允许使用系统字体或相近字体静默替代。

受版本控制的 `font-packs/bundle.json` 是正式字体包集合清单。构建命令会
逐包构建、验证，并拒绝 `output/font-packs/root` 中出现清单外字体包，
避免本地残留进入发行产物。各包报告写入
`output/font-packs/<pack-id>-build-report.json`。输出布局为：

```text
root/<pack-id>/<semver>/font-pack.json
```

同一 ID 和版本的内容完全相同时，重复构建保持幂等；只要任一文件发生
变化，构建器就会拒绝覆盖。发行内容变化必须提升字体包 SemVer。

当前 `morphdoc-serif-sc@1.0.0` 只替换 `FandolSong` 与
`MorphDoc Fandol Song` 的 400/700 字重，不匹配 `SimSun` 等通用别名，避免
错误替换仿宋、黑体、楷体或普通外部主题字体。

`morphdoc-sans-sc@1.0.0` 提供 `MorphDoc Sans SC`、`FandolHei`、
`Microsoft YaHei`、`PingFang SC`、`Noto Sans CJK SC` 和
`Source Han Sans SC` 的 400/700 字重映射。主题仍需明确声明所需字体面，
注册器不会对未声明字体进行静默替换。

`morphdoc-mono@1.0.0` 提供内部字族 `MorphDoc Mono`，并覆盖主题代码样式常用的
Cascadia、Consolas、SFMono、Menlo、Monaco 与 Courier 等候选名称。
应用层将它作为代码语义槽位的引擎级可选能力统一注入，因此新主题无需
增加主题 ID 分支；字体包缺失时仍保留主题原有候选链并输出缺失诊断。

## Desktop 内置发行

组合构建命令为：

```powershell
pnpm run desktop:make
```

该命令先重建完整字体包集合，再构建主安装器和便携 ZIP。electron-builder
把 `output/font-packs/root` 复制到 `resources/font-packs`；Desktop 生产
运行时优先读取该只读内置根目录，再读取用户目录中的额外字体包。内置包
因此不会被缺失、旧版或同 ID 用户包替换。NSIS 不安装系统字体、不显示
字体选择页，正式发行也不再拆分独立字体安装器或字体 ZIP。

## Docker 内置发行

Docker 构建前必须先执行 `pnpm run build:font-pack`。构建上下文只放行
`output/font-packs/root`，Dockerfile 将其复制到
`/app/.local/font-packs`；Compose 不再挂载宿主机字体目录。字体因此随
镜像离线分发，同时仍由运行时注册器校验版本、路径、容量和 SHA-256。
