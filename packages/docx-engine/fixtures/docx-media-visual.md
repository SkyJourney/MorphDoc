---
title: DOCX 媒体视觉专项验收
author: 墨呈研发组
lang: zh-CN
---

# DOCX 媒体视觉专项验收

本样例验证普通图片、宽图、高图、Mermaid 与 ECharts 在 Chromium、
Microsoft Word 和 WPS Writer 中的物理尺寸、宽高比与水平对齐。

## 普通图片

![普通图片：蓝色 4:3](media/normal.png)

## 宽图

![宽图：橙色 8:3](media/wide.png)

## 高图

![高图：绿色 3:8](media/tall.png)

## Mermaid

```mermaid
%%{init: {"theme":"base","themeVariables":{"primaryColor":"#C4B5FD","primaryBorderColor":"#6D28D9","lineColor":"#6D28D9","fontFamily":"Microsoft YaHei"}}}%%
flowchart LR
    A[Markdown] --> B[高分辨率 PNG]
    B --> C[可编辑 DOCX]
```

## ECharts

```echarts
version: 1
caption: ECharts 紫色柱状图
option:
  backgroundColor: "#F9A8D4"
  xAxis:
    type: category
    data: [一月, 二月, 三月, 四月]
  yAxis:
    type: value
  series:
    - type: bar
      itemStyle:
        color: "#7C3AED"
      data: [12, 20, 16, 24]
```

最后一段用于确认媒体周围的正文仍保持 Word 原生段落，可以继续编辑。
