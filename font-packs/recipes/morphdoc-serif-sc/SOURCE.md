# MorphDoc Serif SC 字体来源说明

本字体包的 Regular 400 与 Bold 700 字形面派生自 Noto Serif SC 可变字体。

- 上游项目：Noto CJK
- 上游仓库：<https://github.com/notofonts/noto-cjk>
- Google Fonts 源提交：`985fa52c81c1d6692ccdd82bc3656e8fb932fd89`
- 上游源文件：`google-fonts/NotoSerifSC[wght].ttf`
- 上游源 SHA-256：`050080d9255a86808f2945bffac582b31ef32bc36411ce29563b4961670c66f9`
- 许可证：SIL Open Font License 1.1

发行字形面使用 fontTools 4.60.1 从 `wght` 轴固定生成，并将主字体家族改名
为 `MorphDoc Serif SC`、PostScript 前缀改名为 `MorphDocSerifSC`。改名用于明确
标识派生版本，并避免派生字体占用上游字体名称。字形轮廓与字符覆盖未做
删减；`OS/2.fsType` 为 0，允许安装和文档嵌入。

字体包构建器不从网络下载字体，也不在主程序安装包中包含这些二进制。
发布人员必须将配方声明的四个冻结资源放入受信任源目录；构建器会同时
校验文件大小、SHA-256、格式、字体内部家族、字重与嵌入权限。
