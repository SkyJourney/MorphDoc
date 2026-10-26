const wideImageBase64 =
  "iVBORw0KGgoAAAANSUhEUgAABkAAAAOEAQMAAADDg2/hAAAABlBMVEVPRuUOpntYb4NEAAAB+klEQVR42u3bAQEAMAiAMPuXvjm4WwMCMAMAAAAAAAAAAAAAAHHvE0KECBEiRIgQIUKECBEiRIgQIUKECBEiRIgQIUKECBEiRIgQIUKECBEiRIgQIUKECBEi5G4IAAAAAAAAAAAAAADUuRWECBEiRIgQIUKECBEiRIgQIUKECBEiRIgQIUKECBEiRIgQIUKECBEiRIgQIUKECBEiREg9BAAAAAAAAAAAAAAA6twKQoQIESJEiBAhQoQIESJEiBAhQoQIESJEiBAhQoQIESJEiBAhQoQIESJEiBAhQoQIESKkHgIAAAAAAAAAAAAAAHVuBSFChAgRIkSIECFChAgRIkSIECFChAgRIkSIECFChAgRIkSIECFChAgRIkSIECFChAgRUg8BAAAAAAAAAAAAAIA6t4IQIUKECBEiRIgQIUKECBEiRIgQIUKECBEiRIgQIUKECBEiRIgQIUKECBEiRIgQIUKECKmHAAAAAAAAAAAAAABAnVtBiBAhQoQIESJEiBAhQoQIESJEiBAhQoQIESJEiBAhQoQIESJEiBAhQoQIESJEiBAhQoTUQwAAAAAAAAAAAAAAoM6tIESIECFChAgRIkSIECFChAgRIkSIECFChAgRIkSIECFChAgRIkSIECFChAgRIkSIECFC6iEAAAAAAAAAAAAAABC3woXq+yBn0OwAAAAASUVORK5CYII=";
const portraitImageBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAA4QAAAcIAQMAAABevZ3IAAAABlBMVEUPdm5e6tS6V5BUAAAB3ElEQVR42u3NMQ0AAAgDsPk3DQ52cpDWQBMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACo5prRaDQajUaj0Wg0Go1Go9FoNBqNRqPRaDQajUaj0Wg0Go1Go9FoNBqNRqPRaDQajUaj0Wg0Go1Go9FoNBqNRqPRaDQajUaj0Wg0Go1Go9FoNBqNRqPRaDQajUaj0Wg0Go1Go9FoNBqNRqPRaDQajUaj0Wg0Go1Go9FoNBqNRqPRaDQajUaj0Wg0Go1Go9FoNBqNRqPRaDQajUaj0Wg0Go1Go9FoNBqNRqPRaDQajUaj0Wg0Go1Go9FoNBqNRqPRaDQajUaj0Wg0Go1Go9FoNBqNRqPRaDQajUaj0Wg0Go1Go9FoNBqNRqPRaDQajUaj0Wg0Go1Go9FoNBqNRqPRaDQajUaj0Wg0Go1Go9FoNBqNRqPRaDQajUaj0Wg0Go1Go9FoNBqNRqPRaDQajUaj0Wg0Go1Go9FoNBqNRqPRaDQajUaj0Wg0Go1Go9FoNBqNRqPRaDQajUaj0Wg0fhoXJUddU5DUXZIAAAAASUVORK5CYII=";
const boundaryImageBase64 =
  "iVBORw0KGgoAAAANSUhEUgAABLAAAANwAQMAAAAFoAG2AAAABlBMVEXCQQz7vyQwzQKmAAACUElEQVR42u3aoREAQAgDQZr8JqnyDXhkxOJwqzNXb67nMv7CwsLCwsLCwsLCwsLCwsLCwsI6sbI4+2NhYWFhYWFhYWFhYWFhYWFhYd1Y1kAsLCwsLCwsLCwsLCwsLCwsLP2WkRILCwsLCwsLCwsLCwsLCwsLS79lpMTCwsLCwsLCwsLCwsLCwsLC0m9hYWFhYWFhYWFhYWFhYWFhYem3rIFYWFhYWFhYWFhYWFhYWFhYWPotIyUWFhYWFhYWFhYWFhYWFhYWln4LCwsLCwsLCwsLCwsLCwsLCwtLv4WFhYWFhYWFhYWFhYWFhYWFpd+yBmJhYWFhYWFhYWFhYWFhYWFh6beMlFhYWFhYWFhYWFhYWFhYWFhY+i0sLCwsLCwsLCwsLCwsLCwsLCz9FhYWFhYWFhYWFhYWFhYWFhaWfstIiYWFhYWFhYWFhYWFhYWFhYWl3zJSYmFhYWFhYWFhYWFhYWFhYWHpt7CwsLCwsLCwsLCwsLCwsLCw9FvWQCwsLCwsLCwsLCwsLCwsLCws/ZaREgsLCwsLCwsLCwsLCwsLCwtLv4WFhYWFhYWFhYWFhYWFhYWFhaXfwsLCwsLCwsLCwsLCwsLCwsLSb1kDsbCwsLCwsLCwsLCwsLCwsLD0W0ZKLCwsLCwsLCwsLCwsLCwsLCz9FhYWFhYWFhYWFhYWFhYWFhYWln4LCwsLCwsLCwsLCwsLCwsLC0u/ZaTEwsLCwsLCwsLCwsLCwsLCwtJvGSmxsLCwsLCwsLCwsLCwsLCwsPRbWFhYWFhYWFiRrA8Rs81BfKlBmwAAAABJRU5ErkJggg==";

export const sampleMarkdown = `---
title: Markdown PDF 媒体分页示例
author: 内网文档团队
keywords:
  - Markdown
  - PDF
  - 媒体分页
---

# Markdown PDF 媒体分页示例

这份文档集中展示常用排版、不同尺寸图片、Mermaid 与 ECharts 的渲染和分页效果。

## 基础排版

- [x] Markdown 实时预览
- [x] 图片、Mermaid 与 ECharts
- [x] 快速预览和精确 PDF 预览
- [ ] 根据实际文档继续扩展主题

| 能力 | 示例用途 |
| --- | --- |
| 表格与任务列表 | 验证主题基础样式 |
| 数学公式 | 验证字体和基线 |
| 媒体块 | 验证限宽、缩放与分页 |

行内公式：$E = mc^2$。

> 预览与 PDF 共用相同的渲染结果、主题 CSS 和分页结构。

## 网络图片

下面只保留一张网络图片，用于验证远程资源获取与离线失败提示。

![NASA 地球网络图片](https://images-assets.nasa.gov/image/PIA18033/PIA18033~medium.jpg)

## Base64 图片块

### 横向图片：限宽基准

1600 × 900 的横图会先按正文宽度等比例收缩，收缩后的高度才是分页算法使用的基准高度。

![Base64 横向图片 1600×900][base64-wide]

### 边界图片：上一页空白回填

这一段用于形成稳定的分页边界。分页算法会保留标题、图注和间距的原始尺寸，只计算图片主体还能使用的高度。如果主体只需轻微缩小，并且缩放率仍在允许范围内，就尝试回填到上一页空白区域。

为了覆盖长文档场景，这里继续补充少量正文，使媒体块靠近默认 A4 页面底部。媒体元素必须按照源文档顺序串行处理，前一个媒体完成重排以后，后一个媒体才基于新的版面重新计算。

![Base64 边界图片 1200×880][base64-boundary]

### 纵向图片：单页高度适配

900 × 1800 的纵图在限宽后仍可能超过单页内容区，此时应继续等比例缩小并完整放在一页内。

![Base64 纵向图片 900×1800][base64-portrait]

## Mermaid 尺寸示例

### 横向流程图：限宽

\`\`\`mermaid
flowchart LR
  A["Markdown"] --> B["统一 HTML"]
  B --> C["主题 CSS"]
  C --> D["网页预览"]
  C --> E["PDF 导出"]
\`\`\`

### 纵向流程图：高度和分页

\`\`\`mermaid
flowchart TB
  A["读取文档"] --> B["解析 Front Matter"]
  B --> C["渲染 Markdown"]
  C --> D["渲染 Mermaid"]
  D --> E["渲染 ECharts"]
  E --> F["等待图片与字体"]
  F --> G["首次分页"]
  G --> H["串行检查媒体块"]
  H --> I["必要时重新分页"]
  I --> J["生成 PDF"]
\`\`\`

## ECharts 尺寸示例

### 紧凑图表：40mm

\`\`\`echarts
caption: 紧凑柱状图（40mm）
height: 40mm
option:
  xAxis:
    type: category
    data: [研发, 产品, 设计, 运营]
  yAxis:
    type: value
  series:
    - type: bar
      data: [28, 18, 15, 22]
\`\`\`

### 标准图表：58mm

\`\`\`echarts
caption: 产品能力树（58mm）
height: 58mm
option:
  series:
    - type: tree
      orient: LR
      label:
        position: left
      data:
        - name: 文档平台
          children:
            - name: Markdown
              children:
                - name: Mermaid
                - name: ECharts
            - name: PDF
              children:
                - name: 快速预览
                - name: 精确预览
\`\`\`

大型图表的 caption 保持原尺寸，仅缩放图表主体。

### 大型图表：85mm

\`\`\`echarts
caption: 模块工作量占比（85mm）
height: 85mm
option:
  series:
    - type: treemap
      roam: false
      nodeClick: false
      breadcrumb:
        show: false
      label:
        show: true
        formatter: "{b}"
      data:
        - name: 渲染
          children:
            - { name: Markdown, value: 32 }
            - { name: ECharts, value: 24 }
            - { name: Mermaid, value: 18 }
        - name: 导出
          children:
            - { name: PDF, value: 28 }
            - { name: 主题, value: 12 }
\`\`\`

## 串行媒体块

下面连续放置图片、Mermaid 和 ECharts，用于观察长文档中多个媒体元素是否始终按源文档顺序计算。

![Base64 串行边界图片][base64-boundary]

\`\`\`mermaid
flowchart LR
  A["图片完成"] --> B["Mermaid 计算"]
  B --> C["ECharts 计算"]
\`\`\`

\`\`\`echarts
caption: 串行媒体收尾图（58mm）
height: 58mm
option:
  series:
    - type: pie
      radius: [35%, 70%]
      data:
        - { name: 图片, value: 36 }
        - { name: Mermaid, value: 28 }
        - { name: ECharts, value: 36 }
\`\`\`

> 所有媒体仅在额外缩放不超过阈值时回填；否则保持完整媒体块并移动到下一页。

[base64-wide]: data:image/png;base64,${wideImageBase64}
[base64-portrait]: data:image/png;base64,${portraitImageBase64}
[base64-boundary]: data:image/png;base64,${boundaryImageBase64}
`;
