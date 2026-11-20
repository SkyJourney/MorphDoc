# 特性关键字只出现在文字里

这段正文谈论 footnote、mermaid、katex 和 md-echarts 这几个词，还提到 md-task-list-item 与 footnotes。
文档并没有真正使用这些能力，渲染器不应据此启用对应特性。

## footnote

## [mermaid 链接](https://example.com)

| 名称 | 说明 |
| --- | --- |
| katex | 公式库 |
| mermaid | 图表库 |

下面的代码块只是展示标记，并不是真实元素：

```html
<span class="katex">x</span>
<div class="mermaid" data-mermaid-pending="true">graph TD</div>
<sup class="footnote-ref">1</sup>
<section class="footnotes"></section>
<figure class="md-echarts"></figure>
<li class="md-task-list-item">任务</li>
```

```text
class="katex" class="mermaid" class="footnote-ref" class="md-echarts"
```
