# 测试

项目测试分为：

- 导出配置与主题清单单元测试；
- Markdown、代码围栏和链接分类测试；
- HTML 预览接口测试；
- 连续预览、增量分页、媒体回填和 PDF 链接测试；
- Desktop 多窗口、同文件单例、文件变化和发行构建链测试；
- PDF 生成、临时文件和路径安全测试。

完整验证：

```powershell
pnpm test
pnpm run typecheck
pnpm run build
git diff --check
```

浏览器与 Electron 端到端验收结果记录在 `docs/PROGRESS.md`。
