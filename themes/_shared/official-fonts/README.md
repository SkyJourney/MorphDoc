# Fandol 公文字体资源

本目录提供内置正式文档主题共用的中文字体资源，不会作为独立主题出现在
主题列表中。

## 字体与用途

| 文件 | CSS 字体族 | 主题用途 |
| --- | --- | --- |
| `FandolSong-Regular.woff2` | `MorphDoc Fandol Song` | 表格、一般宋体角色 |
| `FandolSong-Bold.woff2` | `MorphDoc Fandol Song` | 公文红头、主标题的小标宋近似角色 |
| `FandolFang-Regular.woff2` | `MorphDoc Fandol Fang` | 公文正文仿宋角色 |
| `FandolHei-Regular.woff2` | `MorphDoc Fandol Hei` | 黑体角色、强调文字 |
| `FandolKai-Regular.woff2` | `MorphDoc Fandol Kai` | 楷体角色、说明文字 |

## 来源与转换

- 上游项目：Fandol 0.3
- 官方发布源：<https://ctan.org/pkg/fandol>
- 原始文件：CTAN 发布的 OpenType 字体
- 转换工具：fontTools 4.60.1 与 Brotli 1.2.0
- 转换方式：`python -m fontTools.ttLib.woff2 compress <input.otf> -o <output.woff2>`

WOFF2 文件是对上游 OTF 的 Web 字体格式转换，没有删减字符或修改字形。
上游说明保存在 `UPSTREAM-README.txt`，完整许可证保存在 `LICENSE.txt`。
FandolSong Bold 是许可证允许内置的宋体粗体，并非方正小标宋；主题将其作为
跨平台一致的小标宋近似字体使用。

## SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `FandolSong-Regular.woff2` | `9AC0EBCAA93C655CD5A35AB6CE3F24EE0624F5F694211CB05C45C930352D15FB` |
| `FandolSong-Bold.woff2` | `1CBAEBABC3506B1DE0A9C10DC502EF1720957939DCFB7EDF33443CD93FB6269C` |
| `FandolFang-Regular.woff2` | `854765A9F95C33C5CEB7D78B221EB1746C789E50A911A878E35932E85031E5EC` |
| `FandolHei-Regular.woff2` | `431AE0CA6CF79BCFDB4A9B7BE3B0B38AF97450795E4CEBB97F15E2D5DA24F42F` |
| `FandolKai-Regular.woff2` | `F3BCA64D93ADB4AB69860354E6C0E080515B060331BD2A6B5621EC88EC2CB0BD` |

## 许可证

Fandol 字体采用 GNU GPL，并附带字体例外条款。分发这些字体资源时必须一并
保留本目录中的许可证和来源说明；使用字体生成的文档不会因此自动受 GPL
约束。
