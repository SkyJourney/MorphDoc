# MorphDoc Mono 字体来源说明

本字体包的 Regular 400 与 Bold 700 字形面派生自 Microsoft Cascadia Mono
可变字体。

- 上游项目：Cascadia Code
- 上游仓库：https://github.com/microsoft/cascadia-code
- 上游版本：`v2102.25`
- 上游提交：`56bcca3f2c1e4cb19458954f0e2bb4635960df91`
- 官方归档：`CascadiaCode-2102.25.zip`
- 官方归档 SHA-256：`a64e8834f06ec9acca4a5307cb6cf35922021d4fd0ca19096f8bf6a3e2515ad3`
- 上游源文件：`ttf/CascadiaMono.ttf`
- 上游源 SHA-256：`bd893a00f500dc46ed181cd422a04c91d71720072f30a6dd369f0d9d26c54761`
- 许可证：SIL Open Font License 1.1

发行字形面使用 fontTools 4.60.1 从 `wght` 轴固定生成，并将主字体家族改名
为 `MorphDoc Mono`、PostScript 前缀改名为 `MorphDocMono`。改名遵守上游保留
字体名称要求，也避免派生字体占用系统 Cascadia 字族。字形轮廓与字符
覆盖未做删减；`OS/2.fsType` 为 0，允许安装和文档嵌入。

可复现生成命令：

```powershell
python font-packs/scripts/build-noto-static.py `
  --source .local/font-pack-upstream/cascadia-2102.25/ttf/CascadiaMono.ttf `
  --output font-packs/assets/morphdoc-mono/1.0.0 `
  --family "MorphDoc Mono" `
  --postscript-family MorphDocMono
```

字体包构建器不从网络下载字体。发布人员必须先核对固定上游文件的
SHA-256，再生成配方声明的四个冻结资源；构建器会继续校验文件大小、
SHA-256、格式、字体内部家族、字重与嵌入权限。
