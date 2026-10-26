import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  APP_DESCRIPTION,
  APP_DISPLAY_NAME,
  APP_SLOGAN,
  APP_WINDOW_TITLE
} from "../src/app-brand";

const webRoot = fileURLToPath(new URL("../", import.meta.url));

describe("产品品牌", () => {
  it("在主界面使用中文名和产品标语", () => {
    expect(APP_DISPLAY_NAME).toBe("墨呈");
    expect(APP_SLOGAN).toBe("一稿多式，即写即呈");
    expect(APP_WINDOW_TITLE).toBe("墨呈 · MorphDoc");
    expect(APP_DESCRIPTION).toBe(
      "面向结构化 Markdown 的主题化文档创作与发布工具"
    );
  });

  it("在静态入口中移除旧工具名称", () => {
    const indexHtml = readFileSync(`${webRoot}/index.html`, "utf8");
    const mainSource = readFileSync(`${webRoot}/src/main.tsx`, "utf8");

    expect(indexHtml).toContain("<title>墨呈 · MorphDoc</title>");
    expect(mainSource).toContain(
      "document.title = `${APP_WINDOW_TITLE} ${APP_VERSION_LABEL}`"
    );
    expect(indexHtml).not.toContain("Markdown PDF 导出器");
    expect(indexHtml).not.toContain("内网文档工具");
  });
});
