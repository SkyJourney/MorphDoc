# 发版规则

## 变更日志与发布说明

根目录 [`CHANGELOG.md`](../CHANGELOG.md) 是版本变更摘要的单一事实来源。
每项面向用户或部署方的重要新增、修复、行为变化和兼容性变化应先记录在
`Unreleased`。发版时运行 `pnpm run version:set <version>`，由 git 提交生成版本章节，
并插在 `[Unreleased]` 之后；`[Unreleased]` 下的人工条目不会被自动移动，需要手动并入新章节。

GitHub Release 正文取自 `docs/releases/v<version>.md`。该文件由 `version:set` 生成骨架，
人工补全概述、验证结果与迁移说明后随发布提交提交。它与 `CHANGELOG.md` 对应章节的功能、
兼容性和验证结论不得相互矛盾，不单独维护第二份版本摘要。

## 唯一产物目录

所有正式分发文件必须统一归集到仓库根目录下的：

```text
release/v<semver>/
```

`release/`、`output/`、`apps/desktop/out/`、`apps/desktop/.runtime/`、
`tmp/` 以及门禁报告均是本地中间产物或发布产物，必须保持 Git 忽略。
大型二进制不得直接提交到普通 Git 历史。

正式目录只能由 `pnpm run release:stage` 生成。脚本先写入同一文件系统中的
`.stage-*` 临时目录，完成镜像封包、清单和校验和后再原子改名；目标版本
目录已经存在时必须拒绝覆盖。

## 标准目录内容

每个版本至少包含：

```text
release/v<version>/
├── MorphDoc-<version>-x86_64-Setup.exe
├── MorphDoc-<version>-x86_64.zip
├── MorphDoc-<version>-arm64.dmg
├── MorphDoc-<version>-x64.dmg
├── MorphDoc-Web-<version>-image.tar.gz
├── MorphDoc-Web-<version>-deploy.zip
├── manifest.json
├── SHA256SUMS.txt
└── RELEASE-NOTES.md
```

Docker 镜像必须通过 `docker save` 导出并使用 gzip 压缩。Web 部署 ZIP 必须
包含 Compose、Nginx、环境变量示例和离线加载说明。`manifest.json` 记录
版本、Git 提交、镜像 ID、文件大小和 SHA-256；`SHA256SUMS.txt` 用于分发后
独立校验。

## 正式字体资产

正式字体固定存放于：

```text
font-packs/assets/<font-pack-id>/<semver>/
```

TTF、OTF、WOFF 和 WOFF2 资产直接以普通 Git 对象入库，不使用 Git LFS。新增或升级字体前必须完成
许可证、来源、内部字族名、文档嵌入权限、字节数和 SHA-256 审查；任何内容
变化都必须提升字体包 SemVer。构建器不会下载或使用系统字体代替缺失资产。

## 发版步骤

完整的 PR、演练、标签与发布流程见 [开发工作流文档](WORKFLOW.md) 第 5 节。
本节只列与版本和产物直接相关的规则：

1. 运行 `pnpm run version:set <version>`，同步两处 `package.json`，并生成 CHANGELOG 版本章节与 `docs/releases/v<version>.md` 骨架。
2. 补全骨架中的 `【待补充】` 标记（概述、验证结果、迁移说明），并确认 `node scripts/version.mjs check --release` 通过。
3. 以 `release:` 前缀提交发布提交，通过 Pull Request 以 Squash 合并到 `main`。
4. 在发布分支上手动运行一次演练。演练中的镜像冒烟验收与归集必须通过，并核对演练产物的 `SHA256SUMS.txt`。
5. 在合并后的发布提交上创建 annotated tag `v<version>`，说明与该提交正文一致，然后推送。Prepare 发布门禁通过后，Release 工作流构建、归集并发布。
6. 核对已发布的 Release：资产与 `SHA256SUMS.txt`、`manifest.json` 中的提交与镜像 ID，并加载离线镜像执行冒烟验收。

需要在本地归集核对时，可以执行下面的命令。正式产物由 Release 工作流生成，本地归集结果不发布：

```text
pnpm run release:stage -- --version <version> --image morphdoc:v<version>
```

安装器公开分发前应完成 Authenticode 签名；未签名产物只能按发布风险规则分发。
