import {
  DOCX_STYLE_SLOT_NAMES,
  type DocxStyleSlotName
} from "./slots.js";

function attribute(slot: DocxStyleSlotName) {
  return `data-docx-slot="${slot}"`;
}

const transparentPixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export function createDocxStyleProbeMarkup(): string {
  return `
<article id="write" ${attribute("document")}>
  <h1 ${attribute("heading-1")}>一级标题</h1>
  <header class="doc-metadata">
    <h1 class="doc-metadata-title" ${attribute("document-title")}>文档标题</h1>
    <p class="doc-author" ${attribute("document-author")}>示例作者</p>
  </header>
  <section class="docx-probe-markdown">
    <h2 ${attribute("heading-2")}>二级标题</h2>
    <h3 ${attribute("heading-3")}>三级标题</h3>
    <h4 ${attribute("heading-4")}>四级标题</h4>
    <h5 ${attribute("heading-5")}>五级标题</h5>
    <h6 ${attribute("heading-6")}>六级标题</h6>
    <p ${attribute("paragraph")}>
      正文
      <strong ${attribute("strong")}>粗体</strong>
      <em ${attribute("emphasis")}>斜体</em>
      <del ${attribute("strikethrough")}>删除线</del>
      <code ${attribute("inline-code")}>inline()</code>
      <a href="#probe" ${attribute("hyperlink")}>链接</a>
    </p>
    <ul ${attribute("unordered-list")}><li ${attribute("list-item")}>无序列表</li></ul>
    <ol ${attribute("ordered-list")}><li>有序列表</li></ol>
    <blockquote ${attribute("block-quote")}><p ${attribute("block-quote-text")}>引用内容</p></blockquote>
    <pre class="md-fences" ${attribute("code-block")}><code class="language-javascript" ${attribute("code-block-text")}><span class="hljs-keyword" ${attribute("code-token-keyword")}>const</span> <span class="hljs-attr" ${attribute("code-token-attribute")}>key</span> <span class="hljs-operator" ${attribute("code-token-operator")}>=</span> <span class="hljs-string" ${attribute("code-token-string")}>&quot;value&quot;</span>; <span class="hljs-literal" ${attribute("code-token-literal")}>true</span> <span class="hljs-title" ${attribute("code-token-title")}>title</span> <span class="hljs-number" ${attribute("code-token-number")}>1</span> <span class="hljs-comment" ${attribute("code-token-comment")}>// comment</span> <span class="hljs-built_in" ${attribute("code-token-built-in")}>Array</span> <span class="hljs-meta" ${attribute("code-token-meta")}>@meta</span> <span class="hljs-variable" ${attribute("code-token-variable")}>value</span> <span class="hljs-regexp" ${attribute("code-token-regexp")}>/x/</span> <span class="hljs-punctuation" ${attribute("code-token-punctuation")}>{}</span> <span class="hljs-name" ${attribute("code-token-name")}>section</span></code></pre>
    <table ${attribute("table")}>
      <thead><tr><th ${attribute("table-header")}>表头</th></tr></thead>
      <tbody><tr><td ${attribute("table-cell")}>单元格</td></tr></tbody>
    </table>
    <figure ${attribute("figure")}>
      <img src="${transparentPixel}" alt="样式探针" ${attribute("image")}>
      <figcaption ${attribute("caption")}>图注</figcaption>
    </figure>
    <section class="footnotes" ${attribute("footnotes")}><p>脚注内容</p></section>
  </section>
  <section class="docx-probe-official">
    <header class="doc-masthead doc-masthead-official" ${attribute("official-masthead")}>
      <div class="doc-classification" ${attribute("official-classification")}>秘密　加急</div>
      <p class="doc-issuer" ${attribute("official-issuer")}>示例发文机关</p>
      <div class="doc-issue-row" ${attribute("official-issue-row")}>
        <span class="doc-number" ${attribute("official-number")}>示例发〔2026〕1号</span>
        <span class="doc-signatory" ${attribute("official-signatory")}><span>签发人：</span>张三</span>
      </div>
    </header>
    <h1 class="doc-title" ${attribute("official-title")}>公文标题</h1>
    <section class="doc-signature" ${attribute("official-signature")}><p class="doc-signature-issuer" ${attribute("official-signature-issuer")}>示例发文机关</p><time class="doc-signature-date" ${attribute("official-signature-date")}>2026年7月30日</time></section>
    <footer class="doc-edition" ${attribute("official-edition")}><p class="doc-copy-to" ${attribute("official-copy-to")}>抄送：示例单位</p><div class="doc-printing-row" ${attribute("official-printing-row")}><span>示例办公室</span><time>2026年7月30日印发</time></div></footer>
  </section>
  <section class="docx-probe-briefing">
    <header class="doc-masthead doc-masthead-briefing" ${attribute("briefing-masthead")}>
      <p class="doc-briefing-masthead" ${attribute("briefing-masthead-text")}>工作简报</p>
      <div class="doc-briefing-meta" ${attribute("briefing-meta")}><span>第1期</span><span>示例单位</span><time>2026年7月30日</time></div>
    </header>
    <h1 class="doc-title" ${attribute("briefing-title")}>简报标题</h1>
    <footer class="doc-briefing-contact" ${attribute("briefing-contact")}>联系人：示例</footer>
  </section>
  <header class="doc-cover doc-cover-project-report" ${attribute("project-report-cover")}>
    <p class="doc-cover-project-name" ${attribute("project-report-project-name")}>示例建设项目</p>
    <h1 class="doc-cover-title" ${attribute("project-report-title")}>可行性研究报告</h1>
    <p class="doc-cover-version" ${attribute("project-report-version")}>送审稿 V1.0</p>
    <p class="doc-cover-owner" ${attribute("project-report-owner")}><span>建设单位：</span>示例单位</p>
    <p class="doc-cover-prepared-by" ${attribute("project-report-prepared-by")}><span>编制单位：</span>示例单位</p>
    <time class="doc-cover-date" ${attribute("project-report-date")}>2026年7月</time>
  </header>
  <header class="doc-cover doc-cover-tender" ${attribute("tender-cover")}>
    <p class="doc-cover-copy-mark" ${attribute("tender-copy-mark")}>正本</p>
    <p class="doc-cover-project-name" ${attribute("tender-project-name")}>示例采购项目</p>
    <p class="doc-cover-project-number" ${attribute("tender-project-number")}>ZB-2026-001</p>
    <h1 class="doc-cover-title" ${attribute("tender-title")}>投标文件</h1>
    <p class="doc-cover-volume" ${attribute("tender-volume")}>技术及商务文件</p>
    <p class="doc-cover-bidder" ${attribute("tender-bidder")}><span>投标人：</span>示例公司</p>
    <p class="doc-cover-representative" ${attribute("tender-representative")}><span>法定代表人或授权代表：</span>李四</p>
    <time class="doc-cover-date" ${attribute("tender-date")}>2026年7月30日</time>
  </header>
</article>`.trim();
}

export function listDocxStyleProbeSlots(
  markup = createDocxStyleProbeMarkup()
): DocxStyleSlotName[] {
  const matches = markup.matchAll(
    /data-docx-slot="([^"]+)"/gu
  );
  return [...matches].map(
    (match) => match[1] as DocxStyleSlotName
  );
}

export function validateDocxStyleProbeMarkup(
  markup = createDocxStyleProbeMarkup()
): void {
  const actual = listDocxStyleProbeSlots(markup);
  const duplicates = actual.filter(
    (name, index) => actual.indexOf(name) !== index
  );
  const actualSet = new Set(actual);
  const missing = DOCX_STYLE_SLOT_NAMES.filter(
    (name) => !actualSet.has(name)
  );
  const unexpected = actual.filter(
    (name) =>
      !DOCX_STYLE_SLOT_NAMES.includes(name as DocxStyleSlotName)
  );
  if (duplicates.length || missing.length || unexpected.length) {
    throw new Error(
      [
        duplicates.length
          ? `重复槽位：${[...new Set(duplicates)].join("、")}`
          : "",
        missing.length ? `缺少槽位：${missing.join("、")}` : "",
        unexpected.length
          ? `未知槽位：${[...new Set(unexpected)].join("、")}`
          : ""
      ]
        .filter(Boolean)
        .join("；")
    );
  }
}
