# MorphDoc Sans SC 字体来源说明

本字体包的 Regular 400 与 Bold 700 字形面派生自 Noto Sans SC 可变字体。

- 上游项目：Noto CJK
- 上游仓库：<https://github.com/notofonts/noto-cjk>
- Google Fonts 源提交：`985fa52c81c1d6692ccdd82bc3656e8fb932fd89`
- 上游源文件：`google-fonts/NotoSansSC[wght].ttf`
- 上游源 SHA-256：`b1736bb633392cfc59b50d97c353d234111bd1721c9c83eaf643eaab9392e7f9`
- 许可证：SIL Open Font License 1.1

发行字形面使用 fontTools 4.60.1 从 `wght` 轴固定生成，并将主字体家族改名
为 `MorphDoc Sans SC`、PostScript 前缀改名为 `MorphDocSansSC`。改名用于明确
标识派生版本，并避免派生字体占用上游字体名称。字形轮廓与字符覆盖未做
删减；`OS/2.fsType` 为 0，允许安装和文档嵌入。

可复现生成命令：

```powershell
python font-packs/scripts/build-noto-static.py `
  --source .local/font-pack-upstream/NotoSansSC-wght.ttf `
  --output font-packs/assets/morphdoc-sans-sc/1.0.0 `
  --family "MorphDoc Sans SC" `
  --postscript-family MorphDocSansSC
```

字体包构建器不从网络下载字体。发布人员必须先核对固定上游文件的
SHA-256，再生成配方声明的四个冻结资源；构建器会继续校验文件大小、
SHA-256、格式、字体内部家族、字重与嵌入权限。
