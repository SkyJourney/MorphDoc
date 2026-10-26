# @morphdoc/markdown-echarts

为 Markdown 增加安全、可验证、可复用的 ECharts YAML 围栏，
并在浏览器中渲染为 SVG。

该包不依赖 React、Paged.js 或特定 PDF 引擎。宿主可以将生成的
HTML 用于网页预览，也可以在图表完成渲染后交给 Chromium 输出 PDF。
本项目由 `@morphdoc/renderer` 接入围栏插件，再由
`@morphdoc/preview-engine` 统一完成连续预览、分页适配和 SVG 冻结。

## 目录结构

```text
src/
  markdown-it-plugin.ts  ECharts YAML 围栏与错误占位
  parse-yaml.ts          受限 YAML 解析
  protocol.ts            围栏协议与基础校验
  security-policy.ts     URL、函数、原型和规模安全策略
  semantic-validator.ts  系列数据与坐标系语义校验
  dom-contract.ts        宿主与浏览器运行时共用的 DOM 协议
  browser.ts             浏览器入口
  browser/               ECharts 按需加载、渲染和 SVG 冻结
  index.ts               Markdown 侧公共导出
styles/
  echarts.css            图表、标题和错误占位样式
tests/                   解析、安全、语义、插件和真实 SVG 测试
```

## 基本语法

````markdown
```echarts
height: 80mm
caption: 年度收入
option:
  xAxis:
    type: category
    data: [2023, 2024]
  yAxis:
    type: value
  series:
    - type: bar
      data: [120, 180]
```
````

围栏内容必须使用 YAML，并包含一个 ECharts `option` 对象。YAML
会先转换为安全的纯数据对象，再交给 ECharts；不能使用函数、
YAML 锚点、别名或自定义标签。

## 围栏字段

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `version` | `1` | `1` | 围栏协议版本 |
| `height` | CSS 长度 | `80mm` | 支持 `mm`、`cm`、`in`、`px` |
| `aspectRatio` | 正数 | 无 | 与 `height` 二选一；指定后不补默认高度 |
| `theme` | `document`、`light`、`dark` | `document` | ECharts 主题 |
| `caption` | 字符串 | 无 | 图表标题说明 |
| `option` | 对象 | 必填 | 经过安全和语义验证的 ECharts 配置 |

## 数据来源

每个系列必须从以下任一位置获得有效数据：

- 非空的 `series[].data`；
- 非空的 `dataset.source`；
- 引用具有有效上游数据源的内置 `filter` 或 `sort` transform。

只有表头的二维数组、所有列均为空的对象以及空数组不属于有效
数据。使用 `dataset` 时保留 ECharts 的默认维度映射，也可以通过
`series.encode` 显式声明映射。

```yaml
option:
  dataset:
    source:
      - [year, sales]
      - [2025, 120]
      - [2026, 180]
  series:
    - type: line
      encode:
        x: year
        y: sales
```

## 系列验证规则

当前支持以下系列：

| 系列 | 主要规则 |
| --- | --- |
| `line` | 需要有效数据；支持直角坐标系和极坐标系 |
| `bar` | 需要有效数据；支持直角坐标系和极坐标系 |
| `scatter` | 直接数据至少包含两个坐标值 |
| `pie` | 直接数据项的 `value` 必须是有限数值 |
| `radar` | 必须提供非空 `radar.indicator`；数据维数不得少于指标数 |
| `heatmap` | 直角坐标数据为 `[x, y, value]`；日历数据为 `[date, value]` |
| `boxplot` | 直接数据为 `[min, Q1, median, Q3, max]` |
| `candlestick` | 直接数据为 `[open, close, lowest, highest]` |
| `tree` | 必须提供非空层级 `data`；递归校验 `children` |
| `treemap` | 必须提供非空层级 `data`；叶节点必须具有有限数值 |
| `sunburst` | 必须提供非空层级 `data`；叶节点必须具有有限数值 |
| `graph` | 必须提供 `data` 或 `nodes`；校验边引用；缺少坐标时默认 `force` 布局 |
| `sankey` | 必须提供节点和关系边；边权重必须是非负有限数值 |
| `chord` | 使用 ECharts 6 和弦图；必须提供节点、关系边和非负权重 |
| `funnel` | 数据项必须是有限数值，或使用有效 `dataset` |
| `gauge` | 数据项必须是有限数值，或使用有效 `dataset` |
| `pictorialBar` | 需要有效数据和直角坐标系；允许安全的 `path://` 内嵌矢量符号 |

直角坐标系列缺少 `xAxis` 或 `yAxis` 时会补充空对象，让 ECharts
使用自身的轴默认值。极坐标、雷达和日历坐标系表达了明确语义，
因此不会猜测配置，缺少对应组件时会报告错误。

使用 `dataset` 时，验证器只验证数据源是否存在，不重复实现
ECharts 的维度推断和 `encode` 映射规则。

## 第二阶段系列示例

### 层级图

```yaml
height: 60mm
option:
  series:
    - type: treemap
      nodeClick: false
      breadcrumb:
        show: false
      label:
        show: true
        formatter: "{b}"
        color: "#1f2937"
        fontWeight: bold
        backgroundColor: "rgba(255, 255, 255, 0.88)"
        borderRadius: 3
        padding: [3, 6]
      itemStyle:
        borderColor: "#ffffff"
        borderWidth: 2
        gapWidth: 2
      levels:
        - itemStyle:
            borderWidth: 0
            gapWidth: 2
        - upperLabel:
            show: true
            height: 28
            color: "#1f2937"
            fontWeight: bold
            backgroundColor: "rgba(255, 255, 255, 0.88)"
            padding: [3, 6]
          itemStyle:
            borderColor: "#ffffff"
            borderWidth: 2
            gapWidth: 2
        - label:
            show: true
            formatter: "{b}"
            color: "#1f2937"
            fontWeight: bold
            backgroundColor: "rgba(255, 255, 255, 0.88)"
            borderRadius: 3
            padding: [3, 6]
          itemStyle:
            borderColor: "#ffffff"
            borderWidth: 2
            gapWidth: 2
      data:
        - name: 渲染
          children:
            - { name: Markdown, value: 32 }
            - { name: ECharts, value: 24 }
        - name: 导出
          children:
            - { name: PDF, value: 28 }
```

`tree`、`treemap` 和 `sunburst` 共用递归 `children` 结构。
`treemap` 与 `sunburst` 的叶节点需要数值；父节点可以省略数值，
由 ECharts 根据子节点汇总。

### 关系图

```yaml
height: 60mm
option:
  series:
    - type: sankey
      data:
        - { name: Markdown }
        - { name: HTML }
        - { name: PDF }
      links:
        - { source: Markdown, target: HTML, value: 100 }
        - { source: HTML, target: PDF, value: 40 }
```

`graph` 的关系边可以省略；`sankey` 和 ECharts 6 `chord` 必须
具有非空 `links` 或 `edges`。`source`、`target` 必须引用节点
名称、ID 或数组索引。

### 业务图表

```yaml
height: 60mm
option:
  series:
    - type: gauge
      min: 0
      max: 100
      progress:
        show: true
      detail:
        formatter: "{value}%"
      data:
        - { name: 完成率, value: 78 }
```

`funnel` 和 `gauge` 使用有限数值数据；`pictorialBar` 复用柱图
坐标系和数据规则，并允许不加载外部资源的 `path://` SVG 路径。

## 错误行为

配置错误不会中断整篇 Markdown。对应围栏会变成局部错误占位：

```html
<div class="md-echarts-error" role="alert">
  ECharts 图表配置无效：option.series.0.data 必须是非空数组……
</div>
```

错误消息包含配置路径，便于用户或 AI Agent 定位并修正 YAML。
宿主还可以通过 `onError` 收集结构化错误。

```ts
markdown.use(markdownItECharts, {
  onError(error, context) {
    console.warn(error.code, error.message, context.tokenIndex);
  }
});
```

## Markdown-it 接入

```ts
import MarkdownIt from "markdown-it";
import {
  markdownItECharts
} from "@morphdoc/markdown-echarts";

const markdown = new MarkdownIt().use(markdownItECharts);
const html = markdown.render(source);
```

如果宿主还会对 HTML 做安全过滤，需要保留包生成的 `figure`、
`figcaption`、隐藏配置节点及 `data-echarts-*` 属性。

## 浏览器渲染

```ts
import {
  renderEChartsBlocks
} from "@morphdoc/markdown-echarts/browser";
import "@morphdoc/markdown-echarts/styles.css";

const outcomes = await renderEChartsBlocks(document, {
  outputMode: "inline-svg",
  concurrency: 2,
  timeoutMs: 5000
});
```

输出模式：

- `interactive`：保留 ECharts 实例和响应式尺寸监听；
- `inline-svg`：冻结为内联 SVG，适合打印和 PDF；
- `svg-image`：冻结为 SVG Data URL 图片。

PDF 输出前应等待所有图表、字体和图片完成，再开始分页或调用
Chromium `page.pdf()`。

浏览器引擎会强制关闭全局及各系列动画，Markdown 中的动画参数不会改变
静态 SVG、快速预览、精确预览或 PDF，避免输出停留在动画中间帧。
ECharts 围栏使用专用 `figure.md-echarts` DOM，不会套用普通代码围栏的
`pre.md-fences` 样式。

## 安全边界

默认策略会拒绝：

- `custom` 系列及 `renderItem`；
- JavaScript、HTTP、文件和 Data URL 外部资源；
- HTML formatter；
- 原型污染属性；
- 未允许的 toolbox 功能；
- 非内置数据转换；
- 超过节点数、深度、字符串、数组、系列、层级节点或关系边数量
  上限的配置。

这些限制适用于不受信任的 Markdown。宿主如需扩大能力，应在明确
风险后扩展验证器，而不是直接执行 YAML 中的 JavaScript。

## 扩展系列验证

各系列规则注册在 `echartsSeriesValidators`。新增图形时需要同步：

1. 将系列类型加入协议支持列表；
2. 在浏览器引擎中注册对应 ECharts Chart；
3. 注册该系列的语义验证器；
4. 增加有效、缺少数据、错误数据结构和真实 SVG 渲染测试。

## 开发与验证

```powershell
pnpm --filter @morphdoc/markdown-echarts run dev
pnpm --filter @morphdoc/markdown-echarts run test
pnpm --filter @morphdoc/markdown-echarts run typecheck
pnpm --filter @morphdoc/markdown-echarts run build
```

参考：

- [ECharts 配置参考](https://echarts.apache.org/en/option.html)
- [ECharts Dataset](https://echarts.apache.org/handbook/en/concepts/dataset/)
- [ECharts Data Transform](https://echarts.apache.org/handbook/en/concepts/data-transform/)
