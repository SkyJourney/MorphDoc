# 图表

## Mermaid 流程图

```mermaid
flowchart LR
    A[Markdown] --> B[渲染]
    B --> C{输出}
    C --> D[PDF]
    C --> E[DOCX]
```

## Mermaid 时序图（带配置）

```mermaid
---
config:
  theme: neutral
---
sequenceDiagram
    participant U as 用户
    participant S as 服务
    U->>S: 请求渲染
    S-->>U: 返回 HTML
```

## ECharts 柱状图

```echarts
caption: 季度销量
height: 80mm
option:
  xAxis:
    type: category
    data: [Q1, Q2, Q3, Q4]
  yAxis:
    type: value
  series:
    - type: bar
      data: [120, 200, 150, 180]
```
