---
title: 阶段六动态模板验收
author: 墨呈研发组
---

# 一级标题

这是一段可编辑的中文正文，包含 **加粗**、*斜体*、`inline code` 和
[内部链接](https://example.invalid/)。

## 二级标题

> 引用段落用于检查字体、颜色、缩进和段落间距。

| 验收项 | 预期结果 |
| --- | --- |
| 纸张 | 继承动态 reference.docx |
| 样式 | 保留标题、正文和表格样式 |

```typescript
export function editableDocument(value: string) {
  return `DOCX 内容仍可编辑：${value}`;
}
```

最后一段用于确认 Pandoc 输出仍由标准 Word 段落和文本 Run 组成。
