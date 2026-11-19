# 无效 ECharts 配置

下面的图表缺少系列数据，应转为局部错误占位，而不是让整篇文档失败。

```echarts
option:
  xAxis:
    type: category
  series:
    - type: bar
```

这段正文必须仍然出现。
