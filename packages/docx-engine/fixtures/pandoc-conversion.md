---
title: Pandoc 媒体转换验收
author: 墨呈研发组
---

# 可编辑正文

这段中文正文在 DOCX 中必须继续作为标准文本编辑。

![普通图片](ignored-original-image.png)

```mermaid
flowchart LR
    A[开始] --> B[结束]
```

```echarts
version: 1
option:
  xAxis:
    type: category
    data: [一月, 二月]
  yAxis:
    type: value
  series:
    - type: bar
      data: [10, 20]
```

| 项目 | 结果 |
| --- | --- |
| 文本 | 可编辑 |
| 媒体 | PNG |

```typescript
export const editable = true;
```
