# 安全输入

<script>window.__pwned = true;</script>

<img src="x" onerror="window.__pwned = true">

<iframe src="https://example.com"></iframe>

<style>body { display: none; }</style>

<svg onload="window.__pwned = true"><circle r="5" /></svg>

<a href="javascript:window.__pwned = true">点击</a>

[Markdown 形式的 JS 链接](javascript:alert(1))

[大小写混淆](JaVaScRiPt:alert(1))

[data 链接](data:text/html,<script>alert(1)</script>)

<div onclick="window.__pwned = true">带事件处理器的块</div>

<!-- 注释不应泄漏 -->

正常段落必须保留。
