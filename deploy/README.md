# AIO 容器部署

本目录提供单容器部署：Nginx 在 `8080` 端口提供前端，并将
`/api/` 代理到同容器内的 Fastify；Fastify 复用固定版本
Playwright Chromium 生成 PDF，并使用固定 Pandoc `3.9.0.2` 生成
可编辑 DOCX。发行镜像固定内置受校验字体包，不依赖宿主机字体挂载。

## 启动

要求已经安装并启动 Docker Desktop。

```powershell
docker compose -f deploy\compose.yaml up --build -d
docker compose -f deploy\compose.yaml ps
```

打开：

```text
http://localhost:8080
```

健康检查：

```powershell
Invoke-RestMethod -Uri 'http://localhost:8080/api/health'
```

查看日志和停止：

```powershell
docker compose -f deploy\compose.yaml logs -f
docker compose -f deploy\compose.yaml down
```

## 构建发布标签

可以直接指定版本化镜像名称构建：

```powershell
$env:MORPHDOC_IMAGE = 'morphdoc:v0.6.4'
docker compose -f deploy\compose.yaml build
```

该命令只生成本地镜像，不会自动推送到镜像仓库。

默认构建会安装项目锁定版本的 Playwright Chromium 及系统依赖。如果本机
已经保留同版本系列的已验证镜像，可在内网或软件源较慢时复用其运行层：

```powershell
$env:MORPHDOC_IMAGE = 'morphdoc:v0.6.4'
$env:MORPHDOC_RUNTIME_BASE_IMAGE = 'morphdoc:v0.6.0'
$env:MORPHDOC_REUSE_PLAYWRIGHT_RUNTIME = '1'
docker compose -f deploy\compose.yaml build
```

复用模式会校验基础镜像中存在 Chromium，再覆盖 v0.6.4 应用代码和生产
依赖。正式跨机器构建仍建议使用默认完整路径。

## 主题挂载

Compose 默认将项目的 `.local/themes` 只读挂载到容器中的
`/app/.local/themes`。可以通过环境变量指定其他目录：

```powershell
$env:MORPHDOC_THEME_DIR = 'D:\morphdoc-themes'
docker compose -f deploy\compose.yaml up -d
```

目录下每套主题都应包含 `theme.json`。主题规范详见
[`docs/THEMES.md`](../docs/THEMES.md)。

当前内置 4 套 Markdown 排版风格主题、4 套红头主题、3 套正式文档主题和
3 套标书主题；挂载目录只用于额外的本机扩展主题，无需重复
放置内置主题。内置主题与挂载主题 ID 重复时以内置版本为准。

## 内置字体包

v0.6.4 的发行镜像固定将受校验字体包内置到
`/app/.local/font-packs`。Compose 不挂载宿主机字体目录，因此部署端
无需额外复制字体，Preview、PDF 和 DOCX 可以离线使用同一套原生资产。

字体包使用固定目录结构：

```text
<字体包根目录>/
├── morphdoc-serif-sc/1.0.0/
├── morphdoc-sans-sc/1.0.0/
└── morphdoc-mono/1.0.0/
```

从源码构建镜像前，先从仓库外冻结源生成字体包，再构建镜像：

```powershell
pnpm run build:font-pack
docker compose -f deploy\compose.yaml up -d
```

字体二进制直接以普通 Git 对象固定在仓库中。Docker 构建上下文只放行构建所需
源码与本次生成的 `output/font-packs/root`，镜像构建会在缺少清单时立即失败。运行时注册器
仍会复核许可证、文件类型、路径边界、容量和 SHA-256。更换字体包内容时
必须提升字体包 SemVer 并重新构建镜像，不能覆盖同一个版本。

发布前执行真实内置字体门禁：

```powershell
$env:MORPHDOC_IMAGE = 'morphdoc:v0.6.4'
pnpm run verify:docker-font-pack
```

该命令要求本机 Docker 引擎已经启动，并且冻结字体源可供
`pnpm run build:font-pack` 生成。验收会重建指定镜像，核对镜像内清单哈希、
确认不存在字体运行时挂载，并检查健康状态、Pandoc capability、WOFF2
资源和 DOCX 字体部件；所有临时容器、网络和目录会在结束时清理。

## 运行参数

| 环境变量 | 默认值 | 说明 |
| --- | ---: | --- |
| `MORPHDOC_IMAGE` | `morphdoc:local` | 构建和运行的镜像标签 |
| `MORPHDOC_RUNTIME_BASE_IMAGE` | `node:22-bookworm-slim` | 可选运行时基础镜像 |
| `MORPHDOC_REUSE_PLAYWRIGHT_RUNTIME` | `0` | 是否复用基础镜像中的 Chromium |
| `MORPHDOC_PORT` | `8080` | 宿主机监听端口 |
| `MORPHDOC_THEME_DIR` | `../.local/themes` | 宿主机主题目录 |
| `MORPHDOC_APP_VERSION` | `0.6.4` | 字体包兼容性判断使用的应用版本 |
| `PDF_CONCURRENCY` | `1` | 同时执行的 PDF 任务数 |
| `PDF_MAX_QUEUE` | `4` | 等待队列上限 |
| `PDF_TIMEOUT_MS` | `120000` | 单次 PDF 生成超时 |

增加 PDF 并发会显著增加 Chromium 内存占用。单机部署建议先保持默认值，
再根据文档复杂度和可用内存调整。

容器为 Chromium 提供 1 GiB 共享内存，并以非 root `pwuser` 运行。
构建阶段使用项目锁定的 Playwright `1.62.0` 安装精确匹配的 Chromium
及系统依赖，不依赖版本可能滞后的预制浏览器镜像标签。DOCX 运行时仅
支持 Linux amd64，Pandoc 二进制、许可证和版权文件均在构建阶段执行
固定版本与 SHA-256 校验。
