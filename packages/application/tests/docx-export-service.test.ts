import { describe, expect, it, vi } from "vitest";
import {
  defaultExportConfig,
  type DocxCapability,
  type PreparedDocxMedia,
  type ThemeManifest
} from "@morphdoc/core";
import type {
  PandocDocxConversionInput,
  PandocDocxConversionResult,
  PandocRuntimeResolution
} from "@morphdoc/docx-engine";
import type { DocxThemeTokenSet } from "@morphdoc/docx-theme-engine";
import {
  DocxExportService,
  readDocxExportRuntimeLimits,
  type DocxMediaCaptureAdapter,
  type PreparedDocxExport
} from "../src/index.js";

function theme(): ThemeManifest {
  return {
    manifestVersion: 1,
    id: "test-theme",
    name: "测试主题",
    version: "1.0.0",
    description: "测试",
    author: "测试",
    license: "内部许可",
    entry: "theme.css",
    domPreset: "generic",
    defaultFontSize: "16px",
    supportedFeatures: [],
    category: "general",
    compatibleProfiles: [],
    docxStyle: { preset: "technical" },
    bundled: true
  };
}

const prepared: PreparedDocxExport = {
  request: {
    markdown: "# 测试",
    fileName: "报告?.md",
    language: "zh-CN",
    resources: [],
    exportConfig: {
      ...defaultExportConfig,
      themeId: "test-theme"
    }
  },
  document: {
    rendererVersion: 1,
    articleHtml: '<article id="write"><h1>测试</h1></article>',
    bodyHtml: "<h1>测试</h1>",
    metadata: {
      title: "测试",
      author: "测试人",
      subject: "",
      keywords: [],
      language: "zh-CN"
    },
    semanticDocument: {
      schemaVersion: 1,
      titlePolicy: {
        metadataTitle: "suppress",
        firstBodyHeading: "keep"
      },
      regions: []
    },
    features: [],
    warnings: []
  },
  theme: {
    manifest: theme(),
    source: "bundled",
    css: "",
    fonts: []
  }
};

const availableCapability: DocxCapability = {
  format: "docx",
  status: "available",
  expectedVersion: "3.9.0.2",
  detectedVersion: "3.9.0.2"
};

const themeTokens: DocxThemeTokenSet = {
  schemaVersion: 1,
  themeId: "test-theme",
  themeFingerprint: "c".repeat(64),
  mode: "auto-with-overrides",
  basePreset: "technical",
  slots: [],
  diagnostics: []
};

function resolution(
  capability: DocxCapability = availableCapability
): PandocRuntimeResolution {
  return capability.status === "available"
    ? { capability, executablePath: "pandoc" }
    : { capability };
}

const emptyAdapter: DocxMediaCaptureAdapter = {
  async capture() {
    return {
      plan: {
        targets: [],
        echartsErrors: [],
        mermaidErrors: []
      },
      captures: []
    };
  }
};

function conversionResult(): PandocDocxConversionResult {
  return {
    docx: new Uint8Array([1, 2, 3]),
    templateFingerprint: "a".repeat(64),
    templateCacheKey: "b".repeat(64),
    validation: {
      partCount: 10,
      xmlPartCount: 9,
      relationshipCount: 3,
      headerCount: 0,
      footerCount: 1,
      embeddedFontCount: 0
    },
    timings: {
      referenceMs: 3,
      pandocMs: 4,
      validationMs: 5
    }
  };
}

function createService(options: {
  convert?: (
    input: PandocDocxConversionInput,
    signal?: AbortSignal
  ) => Promise<PandocDocxConversionResult>;
  capability?: DocxCapability;
  limits?: {
    concurrency: number;
    maxQueue: number;
    timeoutMs: number;
  };
}) {
  return new DocxExportService({
    application: {
      prepareDocxExport: vi.fn().mockResolvedValue(prepared)
    },
    runtime: {
      probe: vi
        .fn()
        .mockResolvedValue(resolution(options.capability))
    },
    converter: {
      convert:
        options.convert ??
        vi.fn().mockResolvedValue(conversionResult())
    },
    themeTokens: {
      prepare: vi.fn().mockResolvedValue({
        tokens: themeTokens,
        warnings: []
      })
    },
    limits: options.limits
  });
}

describe("DOCX 共享导出服务", () => {
  it("串联准备、媒体和转换并返回完整耗时", async () => {
    const convert = vi
      .fn()
      .mockResolvedValue(conversionResult());
    const service = createService({ convert });
    const result = await service.generate(
      { markdown: "# 测试" },
      { mediaAdapter: emptyAdapter }
    );

    expect(result.docx).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.fileName).toBe("报告_.docx");
    expect(convert).toHaveBeenCalledWith(
      expect.objectContaining({
        semanticDocument: prepared.document.semanticDocument
      }),
      expect.any(AbortSignal)
    );
    expect(result.diagnostics).toEqual({
      warnings: [],
      echartsErrors: [],
      mermaidErrors: []
    });
    expect(convert).toHaveBeenCalledWith(
      expect.objectContaining({
        themeTokens
      }),
      expect.any(AbortSignal)
    );
    expect(result.timings).toMatchObject({
      themeStyleMs: expect.any(Number),
      referenceMs: 3,
      pandocMs: 4,
      validationMs: 5
    });
    for (const value of Object.values(result.timings)) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
    await service.close();
  });

  it("限制并发和排队长度", async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let active = 0;
    let maximumActive = 0;
    let calls = 0;
    const service = createService({
      limits: {
        concurrency: 1,
        maxQueue: 1,
        timeoutMs: 5_000
      },
      convert: async () => {
        calls += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (calls === 1) {
          await firstBlocked;
        }
        active -= 1;
        return conversionResult();
      }
    });

    const first = service.generate({}, { mediaAdapter: emptyAdapter });
    await vi.waitFor(() => expect(calls).toBe(1));
    const second = service.generate({}, { mediaAdapter: emptyAdapter });
    const third = service.generate({}, { mediaAdapter: emptyAdapter });
    await expect(third).rejects.toMatchObject({
      code: "DOCX_QUEUE_FULL",
      retryable: true
    });
    releaseFirst();
    await Promise.all([first, second]);

    expect(maximumActive).toBe(1);
    expect(calls).toBe(2);
    await service.close();
  });

  it("总超时会传播取消信号并释放任务", async () => {
    const abortAwareAdapter: DocxMediaCaptureAdapter = {
      capture(_request, signal) {
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true }
          );
        });
      }
    };
    const service = createService({
      limits: {
        concurrency: 1,
        maxQueue: 0,
        timeoutMs: 30
      }
    });

    await expect(
      service.generate({}, { mediaAdapter: abortAwareAdapter })
    ).rejects.toMatchObject({
      code: "DOCX_RENDER_TIMEOUT",
      retryable: true
    });
    await service.close();
  });

  it("映射 capability 错误并解析运行限制", async () => {
    const unavailable: DocxCapability = {
      format: "docx",
      status: "version-mismatch",
      expectedVersion: "3.9.0.2",
      detectedVersion: "3.9.0.1",
      message: "版本不匹配"
    };
    const service = createService({ capability: unavailable });
    await expect(
      service.generate({}, { mediaAdapter: emptyAdapter })
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "DOCX_RUNTIME_VERSION_MISMATCH"
    });
    await service.close();

    expect(
      readDocxExportRuntimeLimits({
        DOCX_CONCURRENCY: "2",
        DOCX_MAX_QUEUE: "6",
        DOCX_TIMEOUT_MS: "120000"
      })
    ).toEqual({
      concurrency: 2,
      maxQueue: 6,
      timeoutMs: 120_000
    });
    expect(() =>
      readDocxExportRuntimeLimits({ DOCX_CONCURRENCY: "0" })
    ).toThrow("不能小于 1");
  });
});
