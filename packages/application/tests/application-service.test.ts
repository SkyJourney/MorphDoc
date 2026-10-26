import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  ApplicationRequestError,
  createApplicationService
} from "../src/index.js";
import {
  MAXIMUM_DOCX_MARKDOWN_LENGTH,
  defaultExportConfig
} from "@morphdoc/core";

let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, {
      recursive: true,
      force: true
    });
  }
  temporaryDirectory = undefined;
});

async function createThemeFixture() {
  temporaryDirectory = await mkdtemp(
    join(tmpdir(), "morphdoc-application-")
  );
  const bundledRoot = join(temporaryDirectory, "bundled");
  const localRoot = join(temporaryDirectory, "local");
  const themeRoot = join(bundledRoot, "test-theme");
  const sharedFontRoot = join(
    bundledRoot,
    "_shared",
    "official-fonts"
  );
  await mkdir(join(themeRoot, "fonts"), { recursive: true });
  await mkdir(sharedFontRoot, { recursive: true });
  await mkdir(localRoot, { recursive: true });
  await writeFile(
    join(themeRoot, "theme.json"),
    JSON.stringify({
      manifestVersion: 1,
      id: "test-theme",
      name: "测试主题",
      version: "1.0.0",
      description: "共享应用服务测试主题",
      author: "test",
      license: "MIT",
      entry: "theme.css",
      domPreset: "typora",
      defaultFontSize: "16px",
      supportedFeatures: ["code", "table"],
      docxFonts: {
        faces: [
          {
            family: "Test",
            source: "fonts/test.woff2",
            license: "OFL-1.1"
          },
          {
            family: "SharedTest",
            source:
              "theme-shared:official-fonts/shared.woff2",
            license: "GPL-3.0-with-font-exception"
          }
        ]
      },
      pageDefaults: {
        margins: {
          top: "37mm",
          right: "26mm",
          bottom: "35mm",
          left: "28mm"
        }
      },
      bundled: true
    }),
    "utf8"
  );
  await writeFile(
    join(themeRoot, "theme.css"),
    [
      "@font-face {",
      "  font-family: Test;",
      "  src: url('./fonts/test.woff2') format('woff2');",
      "}",
      "@font-face {",
      "  font-family: SharedTest;",
      "  src: url('theme-shared:official-fonts/shared.woff2') format('woff2');",
      "}",
      "#write { font-family: Test; }"
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(themeRoot, "fonts", "test.woff2"),
    Buffer.from([0, 1, 2, 3])
  );
  await writeFile(
    join(sharedFontRoot, "shared.woff2"),
    Buffer.from([4, 5, 6, 7])
  );
  await writeFile(
    join(sharedFontRoot, "fonts.css"),
    [
      "@font-face {",
      "  font-family: SharedTest;",
      "  src: url('./shared.woff2') format('woff2');",
      "}"
    ].join("\n"),
    "utf8"
  );
  return { bundledRoot, localRoot };
}

function sha256(content: Uint8Array | string) {
  return createHash("sha256").update(content).digest("hex");
}

async function createFontPackFixture(
  options: {
    corruptWebHash?: boolean;
    minimumAppVersion?: string;
    targets?: string[];
  } = {}
) {
  const root = join(temporaryDirectory!, "font-packs");
  const directory = join(root, "test-font-pack", "1.0.0");
  const web = Buffer.from([10, 11, 12, 13, 14]);
  const docx = Buffer.from([20, 21, 22, 23, 24, 25]);
  const license = "SIL Open Font License 1.1";
  await mkdir(join(directory, "fonts"), { recursive: true });
  await writeFile(join(directory, "fonts", "test.woff2"), web);
  await writeFile(join(directory, "fonts", "test.ttf"), docx);
  await writeFile(join(directory, "OFL.txt"), license, "utf8");
  await writeFile(
    join(directory, "font-pack.json"),
    JSON.stringify({
      manifestVersion: 1,
      id: "test-font-pack",
      version: "1.0.0",
      name: "测试字体包",
      description: "应用服务字体包测试",
      license: "OFL-1.1",
      licenseFile: "OFL.txt",
      licenseSha256: sha256(license),
      licenseBytes: Buffer.byteLength(license),
      compatibility: {
        minimumAppVersion: options.minimumAppVersion ?? "0.6.0",
        maximumAppVersionExclusive: "0.7.0"
      },
      faces: [
        {
          id: "test-regular",
          targets: options.targets ?? ["Test"],
          weight: 400,
          style: "normal",
          web: {
            path: "fonts/test.woff2",
            format: "woff2",
            bytes: web.byteLength,
            sha256: options.corruptWebHash ? "0".repeat(64) : sha256(web)
          },
          docx: {
            path: "fonts/test.ttf",
            format: "truetype",
            bytes: docx.byteLength,
            sha256: sha256(docx)
          }
        }
      ]
    }),
    "utf8"
  );
  return { root, web, docx };
}

describe("共享应用服务", () => {
  it("渲染安全 Markdown 文档", async () => {
    const roots = await createThemeFixture();
    const service = createApplicationService(roots);

    const document = await service.render({
      markdown: "# 文档\n\n<script>alert('xss')</script>",
      language: "zh-CN"
    });

    expect(document.articleHtml).toContain('id="write"');
    expect(document.articleHtml).not.toContain("<script");
    expect(document.metadata.title).toBe("文档");
  });

  it("以稳定错误协议拒绝非法请求", async () => {
    const roots = await createThemeFixture();
    const service = createApplicationService(roots);

    await expect(service.render({ markdown: 42 })).rejects.toEqual(
      expect.objectContaining<ApplicationRequestError>({
        statusCode: 400,
        code: "INVALID_MARKDOWN"
      })
    );
  });

  it("解析上传素材与桌面文档目录中的相对图片", async () => {
    const roots = await createThemeFixture();
    const service = createApplicationService(roots);
    const image = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
    ]);
    const assetRoot = join(temporaryDirectory!, "document");
    await mkdir(join(assetRoot, "文档.assets"), { recursive: true });
    await writeFile(join(assetRoot, "文档.assets", "本地.png"), image);

    const local = await service.render(
      {
        markdown:
          "![本地](./%E6%96%87%E6%A1%A3.assets/%E6%9C%AC%E5%9C%B0.png)"
      },
      { localRoot: assetRoot }
    );
    const uploaded = await service.render({
      markdown: "![网页](文档.assets/网页.png)",
      resources: [
        {
          path: "文档.assets/网页.png",
          data: image.toString("base64")
        }
      ]
    });

    expect(local.articleHtml).toContain("data:image/png;base64,");
    expect(uploaded.articleHtml).toContain("data:image/png;base64,");
    expect(local.articleHtml).toContain("md-document-image");
    expect(uploaded.warnings).toEqual([]);
  });

  it("列出主题并使用调用方提供的资源 URL", async () => {
    const roots = await createThemeFixture();
    const service = createApplicationService({
      ...roots,
      createAssetUrl: (themeId, assetPath) =>
        `morphdoc://theme/${themeId}/${assetPath}`
    });

    await expect(service.listThemes()).resolves.toEqual({
      themes: [
        expect.objectContaining({
          id: "test-theme",
          category: "general",
          compatibleProfiles: [],
          pageDefaults: {
            margins: {
              top: "37mm",
              right: "26mm",
              bottom: "35mm",
              left: "28mm"
            }
          },
          bundled: true,
          source: "bundled"
        })
      ]
    });
    await expect(
      service.getThemeCss("test-theme")
    ).resolves.toContain(
      "morphdoc://theme/test-theme/fonts/test.woff2"
    );
    await expect(
      service.getThemeCss("test-theme")
    ).resolves.toContain(
      "morphdoc://theme/_shared/official-fonts/shared.woff2"
    );
    await expect(
      service.getThemeCss("test-theme")
    ).resolves.toContain("font-family: SharedTest");
  });

  it("安全读取主题二进制资源", async () => {
    const roots = await createThemeFixture();
    const service = createApplicationService(roots);

    await expect(
      service.getThemeAsset("test-theme", "fonts/test.woff2")
    ).resolves.toEqual({
      contentType: "font/woff2",
      content: Buffer.from([0, 1, 2, 3])
    });
    await expect(
      service.getThemeAsset("test-theme", "../test.woff2")
    ).rejects.toThrow("主题资源路径不安全");
    await expect(
      service.getThemeAsset(
        "_shared",
        "official-fonts/shared.woff2"
      )
    ).resolves.toEqual({
      contentType: "font/woff2",
      content: Buffer.from([4, 5, 6, 7])
    });
    await expect(
      service.getThemeAsset("_shared", "../shared.woff2")
    ).rejects.toThrow("主题资源路径不安全");
  });

  it("内置主题优先于同 ID 的旧本地副本", async () => {
    const roots = await createThemeFixture();
    const localThemeRoot = join(roots.localRoot, "test-theme");
    await mkdir(localThemeRoot, { recursive: true });
    await writeFile(
      join(localThemeRoot, "theme.json"),
      JSON.stringify({
        manifestVersion: 1,
        id: "test-theme",
        name: "旧本地主题",
        version: "local",
        description: "迁移前的本地副本",
        author: "test",
        license: "local-only",
        entry: "theme.css",
        domPreset: "typora",
        defaultFontSize: "16px",
        supportedFeatures: ["code", "table"],
        bundled: false
      }),
      "utf8"
    );
    await writeFile(
      join(localThemeRoot, "theme.css"),
      "#write { color: red; }",
      "utf8"
    );
    const onWarning = vi.fn();
    const service = createApplicationService({
      ...roots,
      onWarning
    });

    await expect(service.listThemes()).resolves.toEqual({
      themes: [
        expect.objectContaining({
          id: "test-theme",
          name: "测试主题",
          bundled: true
        })
      ]
    });
    expect(onWarning).toHaveBeenCalledWith(
      "已忽略与内置主题同 ID 的本地主题 test-theme"
    );
  });

  it("为 DOCX 引擎准备统一文档、主题和源请求", async () => {
    const roots = await createThemeFixture();
    const service = createApplicationService(roots);

    const prepared = await service.prepareDocxExport({
      markdown: "# DOCX 文档",
      fileName: "报告.md",
      language: "zh-CN",
      exportConfig: {
        ...defaultExportConfig,
        themeId: "test-theme"
      }
    });

    expect(prepared.request).toMatchObject({
      markdown: "# DOCX 文档",
      fileName: "报告.md",
      language: "zh-CN",
      resources: []
    });
    expect(prepared.document.metadata.title).toBe("DOCX 文档");
    expect(prepared.document.semanticDocument).toEqual({
      schemaVersion: 1,
      titlePolicy: {
        metadataTitle: "suppress",
        firstBodyHeading: "keep"
      },
      regions: []
    });
    expect(prepared.theme.manifest.id).toBe("test-theme");
    expect(prepared.theme.source).toBe("bundled");
    expect(prepared.theme.css).toContain(
      "#write { font-family: Test; }"
    );
    expect(prepared.theme.fonts).toEqual([
      expect.objectContaining({
        family: "Test",
        source: "fonts/test.woff2",
        content: Buffer.from([0, 1, 2, 3])
      }),
      expect.objectContaining({
        family: "SharedTest",
        source: "theme-shared:official-fonts/shared.woff2",
        content: Buffer.from([4, 5, 6, 7])
      })
    ]);
  });

  it("为主题 CSS 与 DOCX 选择同一字体包的双资源", async () => {
    const roots = await createThemeFixture();
    const fontPack = await createFontPackFixture();
    const service = createApplicationService({
      ...roots,
      fontPacks: {
        roots: [fontPack.root],
        appVersion: "0.6.0",
        createAssetUrl: (packId, version, faceId, kind, hash) =>
          `morphdoc://font-pack/${packId}/${version}/${faceId}/${kind}?v=${hash}`
      }
    });

    const css = await service.getThemeCss("test-theme");
    expect(css).toContain("morphdoc-font-packs:test-font-pack@1.0.0");
    expect(css).toContain(
      "morphdoc://font-pack/test-font-pack/1.0.0/test-regular/web?v="
    );
    const prepared = await service.prepareDocxExport({
      markdown: "# 字体包",
      fileName: "字体包.md",
      exportConfig: {
        ...defaultExportConfig,
        themeId: "test-theme"
      }
    });
    expect(prepared.theme.fonts[0]).toEqual(
      expect.objectContaining({
        family: "Test",
        source: "font-pack:test-font-pack/1.0.0/test-regular/docx",
        license: "OFL-1.1",
        content: new Uint8Array(fontPack.docx)
      })
    );
    expect(prepared.theme.fontPack?.appliedFaces).toEqual([
      expect.objectContaining({
        family: "Test",
        packId: "test-font-pack",
        faceId: "test-regular"
      })
    ]);
    await expect(
      service.getFontPackAsset(
        "test-font-pack",
        "1.0.0",
        "test-regular",
        "web"
      )
    ).resolves.toEqual({
      contentType: "font/woff2",
      content: new Uint8Array(fontPack.web),
      sha256: sha256(fontPack.web)
    });
  });

  it("以引擎级代码字体请求为新主题注入同源等宽字体", async () => {
    const roots = await createThemeFixture();
    const fontPack = await createFontPackFixture({
      targets: ["MorphDoc Mono", "Cascadia Code", "Consolas"]
    });
    const service = createApplicationService({
      ...roots,
      fontPacks: {
        roots: [fontPack.root],
        appVersion: "0.6.0",
        createAssetUrl: (packId, version, faceId, kind, hash) =>
          `morphdoc://font-pack/${packId}/${version}/${faceId}/${kind}?v=${hash}`
      }
    });

    const css = await service.getThemeCss("test-theme");
    expect(css).toContain('font-family: "Cascadia Code";');
    expect(css).toContain('font-family: "Consolas";');
    const prepared = await service.prepareDocxExport({
      markdown: "`inline()`",
      fileName: "代码.md",
      exportConfig: {
        ...defaultExportConfig,
        themeId: "test-theme"
      }
    });
    expect(prepared.theme.fonts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "MorphDoc Mono",
          aliases: expect.arrayContaining(["Cascadia Code", "Consolas"]),
          source: "font-pack:test-font-pack/1.0.0/test-regular/docx",
          content: new Uint8Array(fontPack.docx)
        })
      ])
    );
    expect(prepared.theme.fontPack?.appliedFaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "MorphDoc Mono",
          packId: "test-font-pack",
          faceId: "test-regular"
        })
      ])
    );
  });

  it("字体包损坏时记录诊断并回退到主题字体", async () => {
    const roots = await createThemeFixture();
    const fontPack = await createFontPackFixture({ corruptWebHash: true });
    const onWarning = vi.fn();
    const service = createApplicationService({
      ...roots,
      onWarning,
      fontPacks: {
        roots: [fontPack.root],
        appVersion: "0.6.0"
      }
    });

    const prepared = await service.prepareDocxExport({
      markdown: "# 回退",
      fileName: "回退.md",
      exportConfig: {
        ...defaultExportConfig,
        themeId: "test-theme"
      }
    });
    expect(prepared.theme.css).not.toContain("morphdoc-font-packs:");
    expect(prepared.theme.fonts[0]).toEqual(
      expect.objectContaining({
        family: "Test",
        source: "fonts/test.woff2",
        content: Buffer.from([0, 1, 2, 3])
      })
    );
    expect(prepared.theme.fontPack?.diagnostics[0]?.code).toBe(
      "MANIFEST_INVALID"
    );
    expect(onWarning).toHaveBeenCalledWith(
      expect.stringContaining("字体包 MANIFEST_INVALID")
    );
  });

  it("以稳定错误码拒绝非法 DOCX 配置和缺失主题", async () => {
    const roots = await createThemeFixture();
    const service = createApplicationService(roots);

    await expect(
      service.prepareDocxExport({
        markdown: "# 文档",
        exportConfig: {}
      })
    ).rejects.toEqual(
      expect.objectContaining<ApplicationRequestError>({
        statusCode: 400,
        code: "INVALID_EXPORT_CONFIG"
      })
    );

    await expect(
      service.prepareDocxExport({
        markdown: "# 文档",
        exportConfig: {
          ...defaultExportConfig,
          themeId: "missing-theme"
        }
      })
    ).rejects.toEqual(
      expect.objectContaining<ApplicationRequestError>({
        statusCode: 404,
        code: "THEME_NOT_FOUND"
      })
    );

    await expect(
      service.prepareDocxExport({
        markdown: 42,
        exportConfig: {
          ...defaultExportConfig,
          themeId: "test-theme"
        }
      })
    ).rejects.toEqual(
      expect.objectContaining<ApplicationRequestError>({
        statusCode: 400,
        code: "INVALID_MARKDOWN"
      })
    );

    await expect(
      service.prepareDocxExport({
        markdown: "x".repeat(MAXIMUM_DOCX_MARKDOWN_LENGTH + 1),
        exportConfig: {
          ...defaultExportConfig,
          themeId: "test-theme"
        }
      })
    ).rejects.toEqual(
      expect.objectContaining<ApplicationRequestError>({
        statusCode: 413,
        code: "MARKDOWN_TOO_LARGE"
      })
    );

    await expect(
      service.prepareDocxExport({
        markdown: "# 文档",
        resources: [{ path: "", data: "" }],
        exportConfig: {
          ...defaultExportConfig,
          themeId: "test-theme"
        }
      })
    ).rejects.toEqual(
      expect.objectContaining<ApplicationRequestError>({
        statusCode: 400,
        code: "INVALID_IMAGE_RESOURCES"
      })
    );
  });
});
