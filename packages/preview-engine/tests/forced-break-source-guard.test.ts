import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 源码守卫：不得再用内联样式表达“强制分页”。
 *
 * Paged.js 只从 CSS 规则解析 `break-before` / `break-after`，元素上的内联样式会被完全
 * 忽略（见 e2e/tests/pagination-contract.spec.ts 的契约测试）。此前多处代码写了
 * `element.style.setProperty("break-after", "page")` 并以为它生效，其实只是被页面
 * 恰好撑满而掩盖的死代码。强制分页必须通过 `paged-break-control.ts` 的
 * `forceBreakBefore` / `forceBreakAfter` 表达。
 *
 * 下面的白名单列出了仍然保留内联写法的位置，并如实写明各自的状态：有的是对的（分页完成后
 * 交给浏览器打印引擎），有的是已知无效、但经评估暂不迁移的死代码。新增条目需要同样给出理由；
 * 白名单项的写入次数变化也会让测试失败，避免白名单腐烂。
 */

const sourceDirectory = new URL("../src/", import.meta.url);

/** 匹配对 break-* 属性的内联写入。 */
const inlineBreakWrite =
  /setProperty\(\s*["'`](?:page-)?break-(?:before|after)["'`]/gu;

interface AllowedInlineBreak {
  file: string;
  /** 该文件中允许出现的内联写入次数（每次 setProperty 调用算一处）。 */
  count: number;
  reason: string;
}

const allowed: AllowedInlineBreak[] = [
  {
    file: "diagram-page-fit.ts",
    count: 6,
    reason:
      "标题 avoid-page（2 处）：只是“避免分页”，共享 CSS 已对 h1–h6 声明同样的规则，重复且无副作用；" +
      "整页图表的内联 break-after 与零高度占位标记（4 处）：对 Paged.js 无效，分页靠撑满一页后自然溢出。" +
      "曾评估改用 forceBreakAfter：单个标题时输出逐页一致，但连续标题紧接整页图表时会让流程图额外重复渲染，" +
      "当时据此暂不迁移。该重复的根因（整页缩放只扣除紧邻的一个标题）已在 getPrecedingHeadingChain 中修复，" +
      "迁移的前提已经具备，需要用修复后的构建重新评估（见 heading-chain-media.md）"
  },
  {
    file: "document-image-fit.ts",
    count: 2,
    reason:
      "整页图片块的内联 break-after：对 Paged.js 无效，同上，暂不迁移"
  },
  {
    file: "semantic-cover-fit.ts",
    count: 2,
    reason:
      "约束后的封面锚点：内联 break-after 对 Paged.js 无效，分页靠封面撑满一页后自然溢出。" +
      "改成强制换页会让零高度锚点被挤到下一页并多出空白页（见 media-fit.spec.ts）"
  },
  {
    file: "paged-document-runtime.ts",
    count: 1,
    reason:
      "removeTrailingPdfPageBreak：作用于分页完成后的 .pagedjs_page，由浏览器自己的打印引擎处理，" +
      "那时内联样式是有效的，与 Paged.js 的解析无关"
  }
];

/** 去掉块注释和行注释：注释里讲解背景时会举例写出这类调用，不应被当成真实调用。 */
function stripComments(text: string) {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:"'`])\/\/.*$/gmu, "$1");
}

function countInlineBreakWrites(text: string) {
  return Array.from(stripComments(text).matchAll(inlineBreakWrite)).length;
}

function inlineBreakWrites(file: string) {
  return countInlineBreakWrites(
    readFileSync(new URL(file, sourceDirectory), "utf8")
  );
}

const sourceFiles = readdirSync(sourceDirectory).filter((file) =>
  file.endsWith(".ts")
);

describe("强制分页源码守卫", () => {
  it("源码目录非空，守卫确实扫描到了文件", () => {
    expect(sourceFiles.length).toBeGreaterThan(20);
    expect(sourceFiles).toContain("paged-break-control.ts");
  });

  it("没有任何文件在白名单之外用内联样式写 break-before / break-after", () => {
    const allowedFiles = new Set(allowed.map((entry) => entry.file));
    const offenders = sourceFiles
      .filter((file) => !allowedFiles.has(file))
      .map((file) => [file, inlineBreakWrites(file)] as const)
      .filter(([, count]) => count > 0);

    expect(
      offenders,
      "这些文件用内联样式表达强制分页，Paged.js 不会识别；请改用 forceBreakBefore / forceBreakAfter"
    ).toEqual([]);
  });

  it.each(allowed)(
    "白名单项仍然存在且次数不变：$file（$reason）",
    ({ file, count }) => {
      // 写入次数变多说明有人在白名单文件里新增了内联强制分页；变少说明白名单该更新了
      expect(inlineBreakWrites(file)).toBe(count);
    }
  );

  it("分页意图 API 自己不写内联样式", () => {
    expect(inlineBreakWrites("paged-break-control.ts")).toBe(0);
  });

  it("守卫的匹配规则确实能识别各种写法，避免正则失效后形同虚设", () => {
    const samples = [
      'el.style.setProperty("break-after", "page", "important")',
      "el.style.setProperty('break-before', 'page')",
      'el.style.setProperty( "page-break-after", "always" )',
      "el.style.setProperty(`page-break-before`, `always`)"
    ];
    for (const sample of samples) {
      expect(countInlineBreakWrites(sample), sample).toBe(1);
    }
    // 注释里举例写出的调用不算：块注释、文档注释、行注释都要被剥掉
    expect(
      countInlineBreakWrites(
        '/** 例如 el.style.setProperty("break-after", "page") 不会生效 */\n' +
          '// el.style.setProperty("break-before", "page")\n' +
          'const x = 1; // el.style.setProperty("page-break-after", "always")'
      )
    ).toBe(0);
    // 真实调用与注释混在一起时，只计真实调用
    expect(
      countInlineBreakWrites(
        '/* 说明 */ el.style.setProperty("break-after", "page"); // 备注'
      )
    ).toBe(1);
    // 不相关的属性不应被误判
    expect(
      countInlineBreakWrites('el.style.setProperty("break-inside", "avoid")')
    ).toBe(0);
  });
});
