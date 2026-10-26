import { describe, expect, it } from "vitest";
import {
  extractMarkdownImageSources,
  MarkdownDocumentParseError,
  renderMarkdown
} from "../src/render-markdown.js";

describe("renderMarkdown", () => {
  it("将 GFM Alert 渲染为与 Pandoc 一致的独立标题引用块", () => {
    const result = renderMarkdown(
      "> [!CAUTION]\n> **关键约束**：必须执行。",
    );

    expect(result.bodyHtml).toContain(
      '<blockquote class="md-alert md-alert-caution">',
    );
    expect(result.bodyHtml).toContain(
      '<p><span class="md-alert-text md-alert-text-caution">Caution</span></p>\n<p><strong>关键约束</strong>：必须执行。</p>',
    );
    expect(result.bodyHtml).not.toContain("[!CAUTION]");
  });

  it("为含行内代码的普通段落标记分页保护类", () => {
    const result = renderMarkdown("段落前 `inline_code` 段落后");

    expect(result.articleHtml).toContain(
      '<p class="md-inline-code-paragraph">段落前 <code>inline_code</code> 段落后</p>',
    );
  });

  it("向下游暴露已剥离文首 Front Matter 的正文 Markdown", () => {
    const rendered = renderMarkdown(
      "---\ntitle: 测试标题\n---\n# 正文\n\n---\n\n后续内容"
    );

    expect(rendered.markdownBody).toBe(
      "# 正文\n\n---\n\n后续内容"
    );
    expect(rendered.metadata.title).toBe("测试标题");
  });
  it("渲染常用 Markdown 扩展并识别能力", () => {
    const result = renderMarkdown(`
# 示例文档

| 名称 | 状态 |
| --- | --- |
| PDF | 可用 |

- [x] 已完成
- [ ] 待处理

\`\`\`ts
const answer = 42;
\`\`\`

脚注引用[^note]。

[^note]: 脚注正文。
`);

    expect(result.articleHtml).toContain('id="write"');
    expect(result.bodyHtml).toContain("<table>");
    expect(result.bodyHtml).toContain("md-task-list-item");
    expect(result.bodyHtml).toContain("hljs-keyword");
    expect(result.bodyHtml).toContain("footnote");
    expect(result.metadata.title).toBe("示例文档");
    expect(result.semanticDocument).toEqual({
      schemaVersion: 1,
      titlePolicy: {
        metadataTitle: "suppress",
        firstBodyHeading: "keep"
      },
      regions: []
    });
    expect(result.features).toEqual(
      expect.arrayContaining(["code", "table", "task-list", "footnote"])
    );
  });

  it("为围栏代码块输出主题兼容容器", () => {
    const result = renderMarkdown(`
\`\`\`
无语言代码块
\`\`\`

\`\`\`ts
const answer = 42;
\`\`\`
`);

    expect(result.bodyHtml).toContain(
      '<pre class="md-fences"><code>无语言代码块\n</code></pre>'
    );
    expect(result.bodyHtml).toContain(
      '<pre class="md-fences" lang="ts"><code class="language-ts">'
    );
    expect(result.bodyHtml).toContain("hljs-keyword");
  });

  it("保留 Markdown 表格的列对齐语义", () => {
    const result = renderMarkdown(`
| 左对齐 | 居中 | 右对齐 |
| :--- | :---: | ---: |
| A | B | C |
`);

    expect(result.bodyHtml).toContain('<th style="text-align:left">左对齐</th>');
    expect(result.bodyHtml).toContain('<th style="text-align:center">居中</th>');
    expect(result.bodyHtml).toContain('<th style="text-align:right">右对齐</th>');
    expect(result.bodyHtml).toContain('<td style="text-align:left">A</td>');
    expect(result.bodyHtml).toContain('<td style="text-align:center">B</td>');
    expect(result.bodyHtml).toContain('<td style="text-align:right">C</td>');
  });

  it("只在 GFM 表格单元格内解释无属性 br 换行", () => {
    const result = renderMarkdown(`
| 场景 | 内容 |
| --- | --- |
| 标准 | 第一行<br>第二行<BR/>第三行<br />第四行 |

正文中的 <br>、<br/> 和 <br /> 保持文本。

| 转义与代码 | 内容 |
| --- | --- |
| 转义 | \\<br> 与 &lt;br&gt; |
| 代码 | \`<br>\` |
| 属性 | <br class="unsafe"> |

\`\`\`html
<br>
\`\`\`
`);

    expect(result.bodyHtml).toContain(
      "第一行<br />第二行<br />第三行<br />第四行"
    );
    expect(result.bodyHtml).toContain(
      "正文中的 &lt;br&gt;、&lt;br/&gt; 和 &lt;br /&gt; 保持文本"
    );
    expect(result.bodyHtml).toContain("&lt;br&gt; 与 &lt;br&gt;");
    expect(result.bodyHtml).toContain("<code>&lt;br&gt;</code>");
    expect(result.bodyHtml).toContain("&lt;br class=\"unsafe\"&gt;");
    expect(result.bodyHtml).toContain(
      '<pre class="md-fences" lang="html"><code class="language-html">'
    );
  });

  it("读取并规范化 Front Matter 元数据", () => {
    const result = renderMarkdown(`---
title: 项目报告
author: 张三
subject: 技术方案
keywords:
  - Markdown
  - PDF
lang: zh-CN
---

# 不作为标题
`);

    expect(result.metadata).toEqual({
      title: "项目报告",
      author: "张三",
      subject: "技术方案",
      keywords: ["Markdown", "PDF"],
      language: "zh-CN"
    });
  });

  it("使用稳定错误类型报告无效 Front Matter", () => {
    expect(() =>
      renderMarkdown(`---
title: [未闭合
---

# 文档
`)
    ).toThrow(MarkdownDocumentParseError);
  });

  it("生成政企公文的语义化版头、落款和版记", () => {
    const result = renderMarkdown(`---
title: 关于推进示范项目建设的通知
document:
  profile: official
  issuer: 示例市人民政府办公室
  number: 示例办发〔2026〕12号
  secrecy: 内部
  urgency: 加急
  signatory: 张三
  date: 2026年7月29日
  copyTo: 市发展改革委, 市财政局
  printingOffice: 示例市人民政府办公室
---

## 工作要求

正文内容。
`);

    expect(result.metadata.document).toEqual({
      profile: "official",
      issuer: "示例市人民政府办公室",
      number: "示例办发〔2026〕12号",
      secrecy: "内部",
      urgency: "加急",
      signatory: "张三",
      date: "2026年7月29日",
      copyTo: ["市发展改革委", "市财政局"],
      printingOffice: "示例市人民政府办公室"
    });
    expect(result.articleHtml).toContain(
      'data-document-profile="official"'
    );
    expect(result.articleHtml).toContain(
      '<header class="doc-masthead doc-masthead-official">'
    );
    expect(result.articleHtml).toContain(
      '<h1 class="doc-title">关于推进示范项目建设的通知</h1>'
    );
    expect(result.articleHtml).toContain(
      '<section class="doc-signature">'
    );
    expect(result.articleHtml).toContain(
      '<footer class="doc-edition">'
    );
    expect(result.semanticDocument.profile).toBe("official");
    expect(result.semanticDocument.regions).toHaveLength(2);
    expect(result.bodyHtml).not.toContain("doc-masthead");
  });

  it("生成项目报告和标书封面的稳定语义节点", () => {
    const projectReport = renderMarkdown(`---
title: 可行性研究报告
document:
  profile: project-report
  projectName: 智慧园区建设项目
  documentType: 可行性研究报告
  owner: 示例建设集团
  preparedBy: 示例咨询有限公司
  version: V1.0
  date: 2026年7月
---

# 编制说明
`);
    const tender = renderMarkdown(`---
title: 投标文件
document:
  profile: tender
  copyMark: 正本
  projectName: 数据中心建设项目
  projectNumber: ZB-2026-001
  volume: 技术标
  bidder: 示例科技有限公司
  representative: 李四
  date: 2026年7月29日
---

# 技术方案
`);

    expect(projectReport.articleHtml).toContain(
      'class="doc-cover doc-cover-project-report"'
    );
    expect(projectReport.articleHtml).toContain(
      'data-semantic-region="cover"'
    );
    expect(projectReport.articleHtml).toContain(
      'data-semantic-break-after="next-page"'
    );
    expect(tender.articleHtml).toContain(
      'class="doc-cover doc-cover-tender"'
    );
    expect(tender.articleHtml).toContain(
      '<p class="doc-cover-copy-mark">正本</p>'
    );
  });

  it("拒绝未知结构字段并转义语义节点内容", () => {
    expect(() =>
      renderMarkdown(`---
document:
  profile: official
  unknown: value
---
正文`)
    ).toThrow(MarkdownDocumentParseError);

    const result = renderMarkdown(`---
title: "<img src=x onerror=alert(1)>"
document:
  profile: briefing
  masthead: "<script>alert(1)</script>"
---
正文`);

    expect(result.articleHtml).not.toContain("<script>");
    expect(result.articleHtml).not.toContain("<img");
    expect(result.articleHtml).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
  });

  it("服务端渲染公式并保留 Mermaid 安全占位", () => {
    const result = renderMarkdown(`
内联公式 $E=mc^2$。

\`\`\`mermaid
flowchart LR
  A[开始] --> B[结束]
\`\`\`
`);

    expect(result.bodyHtml).toContain("katex");
    expect(result.bodyHtml).toContain('class="mermaid"');
    expect(result.bodyHtml).toContain("data-mermaid-pending");
    expect(result.features).toEqual(
      expect.arrayContaining(["katex", "mermaid"])
    );
  });

  it("完整保留 Mermaid 区块内的 config frontmatter", () => {
    const result = renderMarkdown(`
\`\`\`mermaid
---
title: Frontmatter 示例
config:
  layout: elk
  theme: forest
  look: handDrawn
  fontFamily: Microsoft YaHei
  themeVariables:
    primaryColor: "#dbeafe"
  flowchart:
    curve: basis
---
flowchart LR
  classDef important fill:#fee2e2,stroke:#dc2626
  A[开始] --> B[结束]
  style A fill:#dcfce7,stroke:#16a34a
  class B important
\`\`\`
`);

    expect(result.bodyHtml).toContain("title: Frontmatter 示例");
    expect(result.bodyHtml).toContain("layout: elk");
    expect(result.bodyHtml).toContain("theme: forest");
    expect(result.bodyHtml).toContain("look: handDrawn");
    expect(result.bodyHtml).toContain("fontFamily: Microsoft YaHei");
    expect(result.bodyHtml).toContain("primaryColor:");
    expect(result.bodyHtml).toContain("curve: basis");
    expect(result.bodyHtml).toContain("flowchart LR");
    expect(result.bodyHtml).toContain("classDef important");
    expect(result.bodyHtml).toContain("style A fill:");
    expect(result.bodyHtml).toContain("class B important");
  });

  it("将 ECharts YAML 围栏转换为安全占位并识别能力", () => {
    const result = renderMarkdown(`
\`\`\`echarts
version: 1
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
\`\`\`
`);

    expect(result.bodyHtml).toContain('class="md-echarts"');
    expect(result.bodyHtml).toContain(
      'data-echarts-pending="true"'
    );
    expect(result.bodyHtml).toContain(
      'data-echarts-protocol="1"'
    );
    expect(result.bodyHtml).toContain(
      'class="md-echarts-definition" hidden="hidden"'
    );
    expect(result.bodyHtml).toContain(
      "<figcaption>年度收入</figcaption>"
    );
    expect(result.features).toContain("echarts");
    expect(result.warnings).toEqual([]);
  });

  it("将无效 ECharts 配置转为局部错误和文档告警", () => {
    const result = renderMarkdown(`
\`\`\`echarts
version: 1
height: 80mm
option:
  series:
    - type: custom
\`\`\`
`);

    expect(result.bodyHtml).toContain(
      'class="md-echarts-error"'
    );
    expect(result.bodyHtml).not.toContain(
      "data-echarts-pending"
    );
    expect(result.features).toContain("echarts");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(
      "ECharts 图表配置无效"
    );
  });

  it("阻止原始 HTML 和危险链接形成可执行内容", () => {
    const result = renderMarkdown(`
<script>alert("xss")</script>

[危险链接](javascript:alert("xss"))
`);

    expect(result.bodyHtml).not.toContain("<script");
    expect(result.bodyHtml).not.toMatch(/href=["']javascript:/u);
    expect(result.bodyHtml).toContain("&lt;script&gt;");
  });

  it("保留平台适配器可处理的文档链接", () => {
    const result = renderMarkdown(`
[锚点](#章节一)
[网络](https://example.com/a)
[协议相对](//example.com/a)
[邮件](mailto:a@example.com)
[电话](tel:+8612345)
[上级目录](../docs/a.md)
[绝对路径](C:/docs/a.md)
[本地 URI](<file:///C:/docs/a.md>)
[自定义协议](obsidian://open?vault=x)
`);

    expect(result.bodyHtml).toContain('href="#%E7%AB%A0%E8%8A%82%E4%B8%80"');
    expect(result.bodyHtml).toContain(
      'href="https://example.com/a"'
    );
    expect(result.bodyHtml).toContain('href="//example.com/a"');
    expect(result.bodyHtml).toContain(
      'href="mailto:a@example.com"'
    );
    expect(result.bodyHtml).toContain('href="tel:+8612345"');
    expect(result.bodyHtml).toContain('href="../docs/a.md"');
    expect(result.bodyHtml).toContain('href="C:/docs/a.md"');
    expect(result.bodyHtml).toContain(
      'href="file:///C:/docs/a.md"'
    );
    expect(result.bodyHtml).toContain(
      'href="obsidian://open?vault=x"'
    );
  });

  it("提取图片引用并使用受控资源地址替换", () => {
    const source =
      "![本地](./文档.assets/a%20b.png)\n\n![远程](https://example.com/a.png)";
    expect(extractMarkdownImageSources(source)).toEqual([
      "./%E6%96%87%E6%A1%A3.assets/a%20b.png",
      "https://example.com/a.png"
    ]);

    const result = renderMarkdown(source, {
      imageSourceMap: new Map([
        [
          "./%E6%96%87%E6%A1%A3.assets/a%20b.png",
          "data:image/png;base64,iVBORw0KGgo="
        ]
      ]),
      warnings: ["远程图片下载失败"]
    });

    expect(result.bodyHtml).toContain(
      'class="md-document-image"'
    );
    expect(result.bodyHtml).toContain(
      '<figure class="md-document-image-block">'
    );
    expect(result.bodyHtml).toContain(
      '<figcaption class="md-document-image-caption">本地</figcaption>'
    );
    expect(result.bodyHtml).toContain(
      'src="data:image/png;base64,iVBORw0KGgo="'
    );
    expect(result.warnings).toContain("远程图片下载失败");
  });

  it("只为独立图片块生成可见标题，行内图片保持段落语义", () => {
    const result = renderMarkdown(
      "文字 ![行内图](inline.png) 继续\n\n![独立标题](block.png)"
    );

    expect(result.bodyHtml).toContain(
      '<p>文字 <img src="inline.png" alt="行内图" class="md-document-image" /> 继续</p>'
    );
    expect(result.bodyHtml).not.toContain(
      "md-document-image-caption\">行内图"
    );
    expect(result.bodyHtml).toContain(
      '<figcaption class="md-document-image-caption">独立标题</figcaption>'
    );
  });

  it("为重复中文标题生成唯一锚点", () => {
    const result = renderMarkdown(`
# 章节

## 章节

## 章节
`);

    expect(result.bodyHtml).toContain('id="%E7%AB%A0%E8%8A%82"');
    expect(result.bodyHtml).toContain('id="%E7%AB%A0%E8%8A%82-2"');
    expect(result.bodyHtml).toContain('id="%E7%AB%A0%E8%8A%82-3"');
  });
});
