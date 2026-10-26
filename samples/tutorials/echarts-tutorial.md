---
title: Markdown ECharts 图表教程
author: 墨呈
keywords: [ECharts, Markdown, 图表, 教程]
---

# Markdown ECharts 图表教程

本教程介绍如何在 Markdown 中通过 `echarts` 围栏插入可打印的 ECharts
图表。围栏内容使用 YAML，图表会以 SVG 渲染，并与正文一起进入快速
预览、精确预览和最终 PDF。

> `echarts` 围栏不是普通的 `yaml` 代码块。请保留开头和结尾的三个反引号，
> 并将开头写成 `echarts`。

## 一、最小可用示例

下面的内容可以直接复制到 Markdown 正文中：

````markdown
```echarts
version: 1
caption: 各部门季度完成量
height: 58mm
theme: document
option:
  xAxis:
    type: category
    data: [研发, 产品, 设计, 运营]
  yAxis:
    type: value
  series:
    - name: 完成量
      type: bar
      data: [28, 22, 17, 25]
```
````

实际渲染效果如下：

```echarts
version: 1
caption: 各部门季度完成量
height: 58mm
theme: document
option:
  xAxis:
    type: category
    data: [研发, 产品, 设计, 运营]
  yAxis:
    type: value
  series:
    - name: 完成量
      type: bar
      data: [28, 22, 17, 25]
```

## 二、围栏外层字段

围栏最外层只支持下表中的字段，其他字段必须放入 `option`。

| 字段 | 类型 | 必填 | 功能 | 默认值 | 示例 |
| --- | --- | --- | --- | --- | --- |
| `version` | 整数 | 否 | ECharts 围栏协议版本，目前只能是 `1` | `1` | `version: 1` |
| `height` | 长度字符串 | 否 | 固定图表高度，支持 `mm`、`cm`、`in`、`px` | `80mm` | `height: 65mm` |
| `aspectRatio` | 正数 | 否 | 按内容宽度计算宽高比，最大为 `10` | 无 | `aspectRatio: 1.6` |
| `theme` | 枚举 | 否 | 图表配色，可选 `document`、`light`、`dark` | `document` | `theme: light` |
| `caption` | 字符串 | 否 | 显示在图表下方的图注，最长 500 个字符 | 无 | `caption: 图1 月度趋势` |
| `option` | 对象 | 是 | ECharts 的纯数据配置对象 | 无 | `option: { ... }` |

尺寸规则：

- 未设置 `height` 和 `aspectRatio` 时，高度默认为 `80mm`；
- 同时设置两者时，以显式 `height` 作为固定高度；
- 普通统计图建议使用 `50mm`～`85mm`；
- 关系图或层级图可使用 `80mm`～`120mm`；
- 图表超过单页内容区时，系统会等比例缩小到一页内。

## 三、`option` 常用字段

`option` 使用 ECharts 官方的纯数据结构。下表列出正式文档最常用的字段，
不是 ECharts 全部能力的穷举。

| 字段 | 类型 | 功能 | 示例 |
| --- | --- | --- | --- |
| `title` | 对象 | 图内标题、副标题及位置 | `title: { text: 月度趋势, left: center }` |
| `legend` | 对象 | 系列图例、方向和位置 | `legend: { top: 0 }` |
| `tooltip` | 对象 | 浏览器预览中的提示方式 | `tooltip: { trigger: axis }` |
| `grid` | 对象 | 直角坐标图的绘图区边距 | `grid: { left: 48, right: 24 }` |
| `xAxis` | 对象或数组 | 横轴类型、类目和标签 | `xAxis: { type: category }` |
| `yAxis` | 对象或数组 | 纵轴类型、范围和名称 | `yAxis: { type: value }` |
| `dataset` | 对象或数组 | 多系列共享的表格型数据源 | `dataset: { source: [...] }` |
| `series` | 数组 | 图表系列；每项必须有受支持的 `type` | `series: [{ type: line, data: [...] }]` |
| `radar` | 对象 | 雷达图指标名称和最大值 | `radar: { indicator: [...] }` |
| `visualMap` | 对象 | 热力图等数值到颜色的映射 | `visualMap: { min: 0, max: 100 }` |

建议用 `caption` 表示“图 1、数据来源、统计口径”等打印说明；`title`
适合需要在图形内部显示的标题。两者同时使用时会分别显示。

### 三种标题不要混用

| 位置 | 写法 | 用途 |
| --- | --- | --- |
| 文档章节标题 | Markdown 的 `## 标题` | 组织整篇文档的章节层级 |
| 图表内部标题 | `option.title.text` | 显示在 SVG 图形内部，可带副标题 |
| 图表下方图注 | 围栏外层的 `caption` | 图号、数据来源、统计口径和补充说明 |

`option.title` 常用字段：

| 字段 | 功能 | 示例 |
| --- | --- | --- |
| `text` | 图内主标题 | `text: 上半年项目交付趋势` |
| `subtext` | 主标题下方的副标题 | `subtext: 统计周期：2026年1—6月` |
| `left` | 水平位置，可用像素、百分比、`left`、`center`、`right` | `left: center` |
| `top` | 垂直位置，可用像素、百分比、`top`、`middle`、`bottom` | `top: 4` |
| `textStyle` | 主标题字体样式 | `textStyle: { fontSize: 18 }` |
| `subtextStyle` | 副标题字体样式 | `subtextStyle: { fontSize: 12 }` |

`option.legend` 会从 `series[].name` 或 `dataset` 列名生成图例。多系列
图表应为每个系列设置清晰的 `name`，并给标题、图例和绘图区留出互不
重叠的空间。

## 四、图表标题与顶部图例：折线图

````markdown
```echarts
version: 1
caption: 图1 项目交付统计；数据来源：项目管理系统
height: 76mm
option:
  title:
    text: 上半年项目交付趋势
    subtext: 统计周期：2026年1—6月
    left: center
    top: 4
    textStyle:
      fontSize: 18
    subtextStyle:
      fontSize: 12
  tooltip:
    trigger: axis
  legend:
    data: [计划, 实际]
    top: 48
  grid:
    left: 48
    right: 24
    bottom: 32
    top: 82
    containLabel: true
  xAxis:
    type: category
    boundaryGap: false
    data: [一月, 二月, 三月, 四月, 五月, 六月]
  yAxis:
    type: value
    name: 项目数
  series:
    - name: 计划
      type: line
      smooth: true
      data: [12, 15, 18, 20, 24, 28]
    - name: 实际
      type: line
      smooth: true
      data: [10, 16, 17, 22, 23, 31]
```
````

```echarts
version: 1
caption: 图1 项目交付统计；数据来源：项目管理系统
height: 76mm
option:
  title:
    text: 上半年项目交付趋势
    subtext: 统计周期：2026年1—6月
    left: center
    top: 4
    textStyle:
      fontSize: 18
    subtextStyle:
      fontSize: 12
  tooltip:
    trigger: axis
  legend:
    data: [计划, 实际]
    top: 48
  grid:
    left: 48
    right: 24
    bottom: 32
    top: 82
    containLabel: true
  xAxis:
    type: category
    boundaryGap: false
    data: [一月, 二月, 三月, 四月, 五月, 六月]
  yAxis:
    type: value
    name: 项目数
  series:
    - name: 计划
      type: line
      smooth: true
      data: [12, 15, 18, 20, 24, 28]
    - name: 实际
      type: line
      smooth: true
      data: [10, 16, 17, 22, 23, 31]
```

## 五、底部图例：使用 `dataset` 的柱状图

`dataset.source` 适合把数据集中写成一张表，多个系列再按列读取。

````markdown
```echarts
version: 1
caption: 图2 分区域合同额与回款额（单位：万元）
height: 70mm
option:
  title:
    text: 分区域合同执行情况
    left: center
    top: 4
  legend:
    bottom: 2
  tooltip:
    trigger: axis
  grid:
    left: 48
    right: 24
    top: 48
    bottom: 52
    containLabel: true
  dataset:
    source:
      - [区域, 合同额, 回款额]
      - [东区, 820, 690]
      - [南区, 760, 610]
      - [西区, 540, 480]
      - [北区, 680, 570]
  xAxis:
    type: category
  yAxis:
    type: value
  series:
    - type: bar
    - type: bar
```
````

```echarts
version: 1
caption: 图2 分区域合同额与回款额（单位：万元）
height: 70mm
option:
  title:
    text: 分区域合同执行情况
    left: center
    top: 4
  legend:
    bottom: 2
  tooltip:
    trigger: axis
  grid:
    left: 48
    right: 24
    top: 48
    bottom: 52
    containLabel: true
  dataset:
    source:
      - [区域, 合同额, 回款额]
      - [东区, 820, 690]
      - [南区, 760, 610]
      - [西区, 540, 480]
      - [北区, 680, 570]
  xAxis:
    type: category
  yAxis:
    type: value
  series:
    - type: bar
    - type: bar
```

## 六、饼图：名称与数值

饼图数据项使用 `{ name, value }` 结构。正式文档中建议控制分类数量，
避免标签过密。

````markdown
```echarts
version: 1
caption: 图3 年度预算构成
height: 68mm
option:
  title:
    text: 年度预算构成
    subtext: 单位：%
    left: "62%"
    top: 6
    textAlign: center
  tooltip:
    trigger: item
  legend:
    orient: vertical
    left: left
  series:
    - name: 预算
      type: pie
      radius: ["35%", "68%"]
      center: ["62%", "50%"]
      data:
        - { name: 软件采购, value: 36 }
        - { name: 基础设施, value: 28 }
        - { name: 运维服务, value: 22 }
        - { name: 培训推广, value: 14 }
```
````

```echarts
version: 1
caption: 图3 年度预算构成
height: 68mm
option:
  title:
    text: 年度预算构成
    subtext: 单位：%
    left: "62%"
    top: 6
    textAlign: center
  tooltip:
    trigger: item
  legend:
    orient: vertical
    left: left
  series:
    - name: 预算
      type: pie
      radius: ["35%", "68%"]
      center: ["62%", "50%"]
      data:
        - { name: 软件采购, value: 36 }
        - { name: 基础设施, value: 28 }
        - { name: 运维服务, value: 22 }
        - { name: 培训推广, value: 14 }
```

## 七、雷达图：指标与最大值

雷达图必须提供非空的 `radar.indicator`。每组 `series.data[].value`
至少要包含与指标数量相同的数值。

````markdown
```echarts
version: 1
caption: 图4 项目综合评价
height: 72mm
option:
  legend:
    data: [项目甲, 项目乙]
  radar:
    indicator:
      - { name: 进度, max: 100 }
      - { name: 质量, max: 100 }
      - { name: 成本, max: 100 }
      - { name: 风险, max: 100 }
      - { name: 满意度, max: 100 }
  series:
    - type: radar
      data:
        - name: 项目甲
          value: [86, 92, 78, 81, 90]
        - name: 项目乙
          value: [91, 84, 88, 76, 85]
```
````

## 八、关系图：节点与连线

关系图使用 `data` 或 `nodes` 描述节点，使用 `links` 或 `edges` 描述关系。
连线的 `source`、`target` 必须引用已存在的节点名称或 ID。

````markdown
```echarts
version: 1
caption: 图5 项目协同关系
height: 78mm
option:
  series:
    - type: graph
      layout: force
      roam: false
      label:
        show: true
      force:
        repulsion: 260
        edgeLength: 90
      data:
        - { id: pm, name: 项目经理, symbolSize: 58 }
        - { id: dev, name: 研发组, symbolSize: 48 }
        - { id: test, name: 测试组, symbolSize: 48 }
        - { id: ops, name: 运维组, symbolSize: 48 }
      links:
        - { source: pm, target: dev, value: 3 }
        - { source: pm, target: test, value: 2 }
        - { source: dev, target: ops, value: 1 }
        - { source: test, target: ops, value: 2 }
```
````

## 九、系列类型与数据形状

当前支持 17 种系列。下表重点说明每种系列最容易写错的数据结构。

| `series[].type` | 主要数据结构 | 示例或要求 |
| --- | --- | --- |
| `line`、`bar` | 数值数组或 `dataset.source` | `data: [12, 18, 24]` |
| `scatter` | 坐标二元数组 | `data: [[12, 18], [16, 25]]` |
| `pie`、`funnel`、`gauge` | 名称和有限数值 | `{ name: 已完成, value: 72 }` |
| `radar` | 指标值数组 | `{ name: 项目甲, value: [86, 92, 78] }` |
| `heatmap` | x、y、值三元数组 | `data: [[0, 0, 32], [1, 0, 48]]` |
| `boxplot` | 最小值、Q1、中位数、Q3、最大值 | `data: [[5, 12, 18, 24, 36]]` |
| `candlestick` | 开盘、收盘、最低、最高 | `data: [[20, 24, 18, 28]]` |
| `tree` | 递归 `children` 节点 | `data: [{ name: 总部, children: [...] }]` |
| `treemap`、`sunburst` | 带数值的递归叶节点 | `{ name: 产品线A, value: 36 }` |
| `graph` | 节点和关系边 | `data: [...]` 配合 `links: [...]` |
| `sankey`、`chord` | 节点和带权关系边 | 关系边需要有限数值 `value` |
| `pictorialBar` | 与柱状图相同 | 可使用安全的内嵌 `path://` 矢量路径 |

每个系列必须直接提供非空 `series[].data`，或者通过有效的
`dataset.source` 提供数据。部分关系图使用 `nodes` 和 `links`，不采用
普通 `data` 数组。

## 十、安全与错误处理

为了确保离线、可复现和安全渲染，配置只能包含纯数据：

- 不支持 JavaScript 函数、自定义脚本或 HTML formatter；
- 不允许外部图片、跳转链接和远程资源；
- 不支持 `custom` 系列；
- YAML 锚点、别名和自定义标签会被拒绝；
- `option` 中的原型污染属性会被拒绝；
- 单个围栏 YAML 不能超过 512 KiB；
- 配置错误只会显示局部错误占位，不会中断整篇文档。

下面是一个会产生局部错误提示的示例，请勿在正式文档中使用：

````markdown
```echarts
version: 1
option:
  series:
    - type: pie
      data: []
```
````

错误信息会指出类似 `option.series.0.data` 的配置路径，便于定位问题。

## 十一、排版建议

1. `caption` 用于图号、数据来源和统计口径，正文标题用于章节结构。
2. 正式报告优先使用少量稳定颜色，并确保黑白打印仍能区分系列。
3. 横轴类目过多时，优先拆图、旋转标签或改用横向柱状图。
4. 图表、图注会作为一个不可拆分媒体块参与分页。
5. 导出前使用“精确”预览检查最终分页、图例和标签。
