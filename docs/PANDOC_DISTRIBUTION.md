# Pandoc 运行时与分发规范

状态：`v0.6.0` 阶段 2 冻结，Desktop 内置运行时已实现。

## 1. 固定版本

`v0.6.0` 固定使用 Pandoc `3.9.0.2`。

选择依据：

- 这是阶段冻结时的官方稳定版本；
- 本地 DOCX 探查和 Word/WPS 往返实验使用同一版本；
- 官方 Windows 和 Linux 静态发行包均包含 Lua 支持；
- 默认 `reference.docx` 已嵌入可执行文件；
- Windows 便携程序和 Linux 静态程序均不需要 Python。

不得在构建时自动下载“latest”。升级 Pandoc 必须作为显式变更，重新执行
DOCX OOXML、Word/WPS 互操作和包体回归。

## 2. 官方发行文件

### 2.1 Windows Desktop

```text
文件：pandoc-3.9.0.2-windows-x86_64.zip
SHA-256：C97542F2800F446E788D9F74237856D995421AD1BB3CC8324286840C5F272D3A
压缩大小：41,250,425 字节
pandoc.exe：231,056,136 字节
pandoc.exe SHA-256：E83F8354C0F507222B5684797B9C5AE766F03889785995D14AAC27816EC456BA
```

发行包来源：

<https://github.com/jgm/pandoc/releases/download/3.9.0.2/pandoc-3.9.0.2-windows-x86_64.zip>

Desktop 只将解压后的以下内容放入应用资源目录，不嵌入 MSI 安装器：

```text
resources/pandoc/3.9.0.2/windows-x86_64/
├── pandoc.exe
├── COPYING.rtf
└── COPYRIGHT.txt
```

`MANUAL.html` 可以放入发行文档或第三方说明，不是运行必需文件。

### 2.2 Docker amd64

```text
文件：pandoc-3.9.0.2-linux-amd64.tar.gz
SHA-256：A69ABFABABDA8A56969A254B09F9553A7BE89DDEC00D4E0FE9FD585D71A67508
压缩大小：34,520,947 字节
pandoc：161,618,224 字节
```

发行包来源：

<https://github.com/jgm/pandoc/releases/download/3.9.0.2/pandoc-3.9.0.2-linux-amd64.tar.gz>

该程序已在 `node:22-bookworm-slim` 中验证：

```text
pandoc 3.9.0.2
Features: +server +lua
not a dynamic executable
```

Docker 安装目标：

```text
/opt/pandoc/3.9.0.2/bin/pandoc
/usr/local/bin/pandoc -> /opt/pandoc/3.9.0.2/bin/pandoc
```

官方 Linux 二进制 tarball 实际只包含 `bin/pandoc`，不包含许可证和版权
文件。Docker 构建会从同一个不可变版本标签 `3.9.0.2` 取得以下文件，并
分别执行 SHA-256 校验后放入相同运行目录：

```text
COPYING.md
SHA-256：9D56CAC92294E206AF026A5502BEE0FED77200B08B51EC28AA63C9EFDA4DCFDD

COPYRIGHT
SHA-256：842E33EF01625E93F85BEBB8BAC83AA570186B7AA77A09971257CC29F8F60740
```

二进制归档、许可证和版权文件均在独立下载阶段获取与校验，最终镜像只
复制 `/opt/pandoc/3.9.0.2/`，不保留下载缓存、Curl 或下载阶段依赖。

`v0.6.0` 正式验证范围为 Linux amd64。官方同时提供 arm64 包，但在完成
Playwright、Pandoc 和 DOCX 全链路验证前，不宣称 arm64 发布支持。

## 3. 路径发现与版本校验

应用服务采用以下优先级：

1. 服务端或开发环境显式配置的 `DOCX_PANDOC_PATH`；
2. Desktop 的 `process.resourcesPath` 固定资源路径；
3. Docker 的 `/opt/pandoc/3.9.0.2/bin/pandoc`；
4. 开发环境 `PATH` 中的 `pandoc`。

约束：

- Web 页面、Markdown 和导出请求不能指定可执行路径；
- Desktop 渲染进程不能直接启动或选择 Pandoc；
- 显式路径只允许由受信任的服务端环境或开发者配置；
- 调用必须使用 Node `spawn`/`execFile` 的参数数组，不经过 Shell；
- 路径解析后执行 `pandoc --version`，首行必须精确匹配
  `pandoc 3.9.0.2`；
- 不接受不同补丁版本静默降级；
- 能力检测失败时 DOCX capability 返回不可用原因，PDF 能力继续可用。

正式实现中的能力状态至少区分：

```text
available
not-found
version-mismatch
not-executable
probe-timeout
```

## 4. 许可证与源码义务

Pandoc 采用 GNU GPL version 2 or later。项目将其作为未修改的独立程序，
通过命令行参数和临时文件通信，不链接或导入 Pandoc 代码。

每个包含 Pandoc 的二进制发行必须：

- 保留 Pandoc `COPYING`、`COPYRIGHT` 和版本信息；
- 在第三方声明中标明 Pandoc 名称、版权、许可证和项目地址；
- 提供与所分发二进制精确对应的源码获取方式；
- 将对应源码归档与应用二进制放在同一版本的发布位置；
- 保证离线或内部转交发布产物时，许可证说明和源码获取信息同时转交；
- 不对 Pandoc 施加禁止再分发、禁止逆向或额外保密限制。

项目发布资产计划至少包含：

```text
MorphDoc-0.6.1-x86_64-Setup.exe
MorphDoc-0.6.1-x86_64.zip
pandoc-3.9.0.2-source.tar.gz
THIRD_PARTY_NOTICES.md
```

Docker 镜像必须包含许可证、版权声明和源码归档位置说明，并通过 OCI
`org.opencontainers.image.source`、版本和文档标签指向项目发布位置。

若未来修改 Pandoc 源码或构建方式，必须重新审查 GPL 对完整对应源码和
构建脚本的要求。公开或商业发布前应由项目权利人完成最终法律审查；本
规范是工程合规约束，不构成法律意见。

## 5. 包体实测

基线为本机已有 `v0.5.1` 正式产物。以下数值使用官方压缩包和解压程序
实测，NSIS 与 ZIP 最终值仍以 `v0.6.0` 构建结果为准。

| 产物 | v0.5.1 基线 | v0.6.0 实测/估算 | 增量 |
| --- | ---: | ---: | ---: |
| Desktop 运行目录 | 333.98 MiB | 556.94 MiB | 222.96 MiB |
| NSIS 安装包 | 109.38 MiB | 133.78 MiB | 24.40 MiB |
| Desktop ZIP | 145.13 MiB | 183.38 MiB | 38.25 MiB |
| Docker 内容大小 | 615.91 MiB | 约 770.05 MiB | 154.13 MiB |
| Docker 压缩拉取层 | — | — | 约 32.92 MiB |

结论：

- Desktop 解压目录增长明显；实测安装包增加 24.40 MiB，ZIP 增加
  38.25 MiB；
- Docker 运行时内容增长约 154 MiB，镜像传输增量约 33 MiB；
- 不采用首次使用时联网下载，以保持内网和离线 Desktop 能力；
- 不使用 UPX 或二次修改官方二进制，避免兼容性、杀毒误报和合规风险；
- 不为了减小包体引入 Python 或另一个文档转换运行时。

## 6. 构建与更新规则

后续实现应增加受版本控制的运行时清单，至少记录：

- Pandoc 版本；
- 平台和架构；
- 官方下载地址；
- SHA-256；
- 解压后的相对可执行路径；
- 许可证和版权文件；
- 对应源码归档地址。

Desktop 清单位于
`packages/docx-engine/src/pandoc-runtime.json`；准备脚本位于
`apps/desktop/scripts/prepare-pandoc-runtime.mjs`。下载缓存和解压目录
位于被 Git 忽略的 `apps/desktop/.runtime/`，不会进入源码提交。

构建流程必须：

1. 根据清单下载或读取缓存；
2. 校验 SHA-256；
3. 拒绝未知平台和架构；
4. 将运行所需文件复制到固定目录；
5. 生成或复制第三方声明；
6. 构建后执行 `pandoc --version`；
7. 用最小 Markdown 生成 DOCX 冒烟文件；
8. 检查发行包中不存在用户级 Pandoc 配置或缓存。

运行时不得读取用户 Pandoc 数据目录。DOCX 转换应通过隔离环境变量或显式
参数使用项目控制的模板、Lua Filter 和临时资源目录，确保不同设备输出
可复现。
