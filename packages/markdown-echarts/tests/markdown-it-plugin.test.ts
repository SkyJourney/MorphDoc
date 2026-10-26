import MarkdownIt from "markdown-it";
import { describe, expect, it, vi } from "vitest";
import {
  markdownItECharts
} from "../src/index.js";

describe("markdownItECharts", () => {
  it("将 echarts 围栏转换为安全占位 DOM", () => {
    const markdown = new MarkdownIt().use(markdownItECharts);
    const html = markdown.render(`
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

    expect(html).toContain('class="md-echarts"');
    expect(html).toContain('data-echarts-pending="true"');
    expect(html).toContain('class="md-echarts-host"');
    expect(html).toContain(
      'class="md-echarts-definition" hidden="hidden"'
    );
    expect(html).toContain("<figcaption>年度收入</figcaption>");
    expect(html).toContain("&quot;type&quot;:&quot;bar&quot;");
  });

  it("保留其他代码围栏的默认行为", () => {
    const markdown = new MarkdownIt().use(markdownItECharts);
    expect(markdown.render("```ts\nconst answer = 42;\n```")).toContain(
      '<code class="language-ts">'
    );
  });

  it("错误配置产生安全错误节点并通知宿主", () => {
    const onError = vi.fn();
    const markdown = new MarkdownIt().use(markdownItECharts, {
      onError
    });
    const environment = { requestId: "render-1" };
    const html = markdown.render(`
\`\`\`echarts
version: 1
height: 80mm
option:
  series:
    - type: custom
\`\`\`
`, environment);

    expect(html).toContain('class="md-echarts-error"');
    expect(html).not.toContain("<script");
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ environment })
    );
  });

  it("缺少数据时输出包含配置路径的局部错误", () => {
    const markdown = new MarkdownIt().use(markdownItECharts);
    const html = markdown.render(`
\`\`\`echarts
option:
  series:
    - type: bar
\`\`\`
`);

    expect(html).toContain('class="md-echarts-error"');
    expect(html).toContain("option.series.0.data");
    expect(html).not.toContain("data-echarts-pending");
  });
});
