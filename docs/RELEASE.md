# 发版规则

## 变更日志与发布说明

根目录 [`CHANGELOG.md`](../CHANGELOG.md) 是版本变更摘要的单一事实来源。
每项面向用户或部署方的重要新增、修复、行为变化和兼容性变化应先记录在
`Unreleased`；冻结版本时将相关内容移动到带发布日期的版本章节。

Gitea Release 页面正文应以 `CHANGELOG.md` 对应版本章节为基础生成，可按发布
场景补充下载提示，但不得与变更日志中的功能、兼容性和验证结论冲突。
`docs/releases/v<version>.md` 用于保存更详细的发布门禁、验证结论和发行说明，
不单独维护另一份相互矛盾的版本摘要。

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

1. 完成全量测试、类型检查、生产构建和视觉门禁。
2. 构建字体直接内置的 Desktop 安装包和便携 ZIP。
3. 构建并验证版本化 Docker 镜像。
4. 将 `CHANGELOG.md` 中本版本变更从 `Unreleased` 冻结为带日期的版本章节，
   并以该章节为基础准备 `docs/releases/v<version>.md` 与 Gitea Release 正文。
5. 执行：

   ```powershell
   pnpm run release:stage -- --version <version> --image morphdoc:v<version>
   ```

6. 逐项核验 `SHA256SUMS.txt`，并从离线归档重新加载 Docker 镜像。
7. 创建内容完整的 `release:` 提交。
8. 重新生成 release 清单，确保 `gitCommit` 指向该发布提交。
9. 创建 annotated `v<version>` 标签，标签说明与发布提交正文一致。
10. 发布 Gitea Release，正文以 `CHANGELOG.md` 对应版本章节为基础，并附上
    本轮正式分发文件。

安装器公开分发前应完成 Authenticode 签名；未签名产物只能按发布风险规则分发。
