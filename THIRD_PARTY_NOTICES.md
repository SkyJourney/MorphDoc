# 第三方许可证说明

根目录 `LICENSE` 为 Apache License 2.0，适用于本项目原创代码、原创主题和原创
文档，不会替换第三方组件、字体、主题或工具各自的许可证。

本文件是发行审查入口，不替代各第三方项目附带的完整许可证。正式发行前还应
根据最终生产依赖生成完整的软件物料清单和许可证清单。

## Pandoc

DOCX 导出使用未经修改的 Pandoc 作为独立可执行程序。

- 项目：Pandoc
- 版权：John MacFarlane 及贡献者
- 许可证：GNU General Public License，version 2 or later
- 交互方式：独立子进程、命令行参数和临时文档文件
- 项目地址：<https://pandoc.org/>
- 源码地址：<https://github.com/jgm/pandoc>

项目不链接、导入或修改 Pandoc 程序代码。发行包必须保留 Pandoc 的 `COPYING`、
`COPYRIGHT` 和版本信息，并提供对应源码获取方式。具体版本、校验值和分发规则见
[`docs/PANDOC_DISTRIBUTION.md`](docs/PANDOC_DISTRIBUTION.md)。

## Fandol 字体

`themes/_shared/official-fonts/` 包含 Fandol 中文字体的 WOFF2 转换版本。Fandol
字体采用 GNU GPL，并附带字体例外条款。完整许可证、上游说明和来源信息保存在该
目录：

- [`LICENSE.txt`](themes/_shared/official-fonts/LICENSE.txt)
- [`README.md`](themes/_shared/official-fonts/README.md)
- [`UPSTREAM-README.txt`](themes/_shared/official-fonts/UPSTREAM-README.txt)

使用字体生成的 PDF、图片或 DOCX 不会仅因为使用该字体而自动受 GPL 约束。重新
分发字体时必须保留上述许可证和来源文件。

## 字体包（SIL Open Font License 1.1）

`font-packs/` 中的字体包派生自 Noto CJK 字体（宋体、黑体）和 Cascadia Code（等宽）。
派生字体按 SIL OFL 1.1 分发，各字体包目录内保留对应的许可证全文与来源说明
（`OFL-*.txt`、`SOURCE.md`）。派生字体不使用上游的保留字体名称。

## 第三方主题资源

`themes/` 中的 `typora-github`、`typora-pixyll`、`typora-whitey` 三套主题及其
字体资源来自第三方上游，作者、来源和许可信息保存在各自的 `theme.json` 中，
说明见 [`themes/THEME_NOTICE.md`](themes/THEME_NOTICE.md)。

## npm 依赖、Electron 与 Chromium 组件

项目直接或间接使用 MIT、Apache-2.0、BSD、ISC、EPL-2.0、MPL-2.0、CC-BY-4.0 等
许可证的软件包。`pnpm-lock.yaml` 固定具体依赖版本；Electron 和 Chromium 发行
目录还包含其自身的第三方许可证文件。

构建产物不得删除 Electron、Chromium 或其他依赖已经附带的许可证文件。正式发布
阶段应基于生产依赖和浏览器 Bundle 生成最终第三方清单，而不能仅以根目录项目
许可证代替。
