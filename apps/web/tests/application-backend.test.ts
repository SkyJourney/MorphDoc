import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import {
  getThemeCss,
  listThemes,
  renderMarkdownDocument
} from "../src/application-backend";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("应用后端适配器", () => {
  it("在桌面环境通过窄 IPC 调用共享服务", async () => {
    const rendered = {
      rendererVersion: 1 as const,
      articleHtml: '<article id="write">测试</article>',
      bodyHtml: "测试",
      metadata: {
        title: "测试",
        author: "",
        subject: "",
        keywords: [],
        language: "zh-CN"
      },
      features: [],
      warnings: []
    };
    const renderMarkdown = vi.fn(async () => rendered);
    const listDesktopThemes = vi.fn(async () => ({
      themes: [
        {
          id: "test",
          name: "测试",
          version: "1",
          description: "",
          bundled: true,
          source: "bundled" as const
        }
      ]
    }));
    const getDesktopThemeCss = vi.fn(async () => "#write {}");
    vi.stubGlobal("window", {
      morphDocDesktop: {
        renderMarkdown,
        listThemes: listDesktopThemes,
        getThemeCss: getDesktopThemeCss
      }
    });

    await expect(
      renderMarkdownDocument({
        markdown: "# 测试",
        language: "zh-CN"
      })
    ).resolves.toBe(rendered);
    await expect(listThemes()).resolves.toEqual({
      themes: [expect.objectContaining({ id: "test" })]
    });
    await expect(getThemeCss("test")).resolves.toBe("#write {}");
    expect(renderMarkdown).toHaveBeenCalledWith({
      markdown: "# 测试",
      language: "zh-CN"
    });
    expect(getDesktopThemeCss).toHaveBeenCalledWith("test");
  });

  it("在浏览器环境保持现有 HTTP 协议", async () => {
    vi.stubGlobal("window", {});
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          rendererVersion: 1,
          articleHtml: '<article id="write">测试</article>',
          bodyHtml: "测试",
          metadata: {
            title: "测试",
            author: "",
            subject: "",
            keywords: [],
            language: "zh-CN"
          },
          features: [],
          warnings: []
        })
      )
      .mockResolvedValueOnce(
        Response.json({ themes: [] })
      )
      .mockResolvedValueOnce(
        new Response("#write {}", { status: 200 })
      );
    vi.stubGlobal("fetch", fetcher);

    await renderMarkdownDocument({
      markdown: "# 测试",
      language: "zh-CN"
    });
    await listThemes();
    await getThemeCss("typora-like");

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/render",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/themes",
      {}
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "/api/themes/typora-like/css",
      {}
    );
  });
});
