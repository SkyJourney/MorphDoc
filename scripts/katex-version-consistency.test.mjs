import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * 守卫：生成公式标记的 KaTeX 与提供样式表的 KaTeX 必须是同一个版本。
 *
 * 渲染器经由 @mdit/plugin-katex 使用它自带依赖的 KaTeX 生成标记；预览、服务端 PDF 与
 * 桌面端显示公式用的样式表则来自 apps/web 打包的 katex/dist/katex.min.css。两者版本
 * 错开时不会有任何报错：KaTeX 0.19 给 19 个 class 加了 katex- 前缀（sizing、strut、
 * base、rule、hline 等），旧样式表不认识新名字，上标、下标、分式和上下限的字号全部
 * 偏大、数组的 \hline 不显示，而单元测试与类型检查都发现不了。
 *
 * 比较的是实际解析到的版本，而不是 package.json 里声明的范围：渲染器的 katex 版本由
 * 插件决定，不由渲染器自己的声明决定。
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readVersion(directory) {
  return JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).version;
}

/** apps/web 打包样式表所用的 katex 目录。 */
function webKatexDirectory() {
  return realpathSync(join(root, "apps", "web", "node_modules", "katex"));
}

/**
 * 渲染器生成标记所用的 katex 目录。
 *
 * pnpm 把 @mdit/plugin-katex 放在 .pnpm/<包名@版本>/node_modules/@mdit/plugin-katex，
 * 它依赖的 katex 是同一个 node_modules 下的兄弟目录。
 */
function pluginKatexDirectory() {
  const plugin = realpathSync(
    join(root, "packages", "renderer", "node_modules", "@mdit", "plugin-katex")
  );
  return join(dirname(dirname(plugin)), "katex");
}

test("web 打包的 KaTeX 样式表与渲染器生成标记的 KaTeX 版本一致", () => {
  const stylesheet = readVersion(webKatexDirectory());
  const markup = readVersion(pluginKatexDirectory());

  assert.equal(
    stylesheet,
    markup,
    `apps/web 的 katex 为 ${stylesheet}，渲染器经 @mdit/plugin-katex 使用的 katex 为 ${markup}。` +
      "两者版本错开会让公式的字号与排版悄悄显示错误；请让 apps/web 的 katex 与插件依赖的版本保持一致。"
  );
});

test("样式表定义了渲染器标记中会用到的结构性 class", () => {
  // 0.19 起使用带 katex- 前缀的新名字；样式表缺少它们说明版本错开或样式表被替换
  const css = readFileSync(join(webKatexDirectory(), "dist", "katex.css"), "utf8");
  for (const name of ["katex-sizing", "katex-strut", "katex-base", "katex-rule", "katex-hline"]) {
    assert.match(css, new RegExp(`\\.${name}\\b`, "u"), `样式表应包含 .${name}`);
  }
});
