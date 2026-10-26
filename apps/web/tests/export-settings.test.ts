import { describe, expect, it } from "vitest";
import { defaultExportConfig } from "@morphdoc/core";
import {
  EXPORT_CONFIG_STORAGE_KEY,
  LEGACY_EXPORT_CONFIG_V2_STORAGE_KEY,
  LEGACY_EXPORT_CONFIG_V3_STORAGE_KEY,
  loadExportConfig,
  parseStoredExportConfig,
  saveExportConfig
} from "../src/export-settings";

function createMemoryStorage(
  initialValue: string | null = null,
  legacyValue: string | null = null,
  legacyKey = LEGACY_EXPORT_CONFIG_V3_STORAGE_KEY
) {
  const values = new Map<string, string>();
  if (initialValue) {
    values.set(EXPORT_CONFIG_STORAGE_KEY, initialValue);
  }
  if (legacyValue) {
    values.set(legacyKey, legacyValue);
  }
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, nextValue: string) {
      values.set(key, nextValue);
    },
    read() {
      return values.get(EXPORT_CONFIG_STORAGE_KEY) ?? null;
    }
  };
}

describe("导出设置缓存", () => {
  it("在没有缓存时返回独立的默认配置", () => {
    const first = parseStoredExportConfig(null);
    const second = parseStoredExportConfig(null);
    expect(first).toEqual(defaultExportConfig);
    expect(first).not.toBe(second);
  });

  it("缓存损坏或版本过期时恢复默认配置", () => {
    expect(parseStoredExportConfig("{")).toEqual(defaultExportConfig);
    expect(
      parseStoredExportConfig(
        JSON.stringify({
          ...defaultExportConfig,
          version: 1
        })
      )
    ).toEqual(defaultExportConfig);
  });

  it("将 v2 缓存迁移为 v4 并让默认页边距跟随主题", () => {
    const legacyConfig = {
      ...defaultExportConfig,
      version: 2,
      mermaid: undefined,
      paper: {
        ...defaultExportConfig.paper,
        marginMode: undefined,
        format: "A5"
      }
    };
    const storage = createMemoryStorage(
      null,
      JSON.stringify(legacyConfig),
      LEGACY_EXPORT_CONFIG_V2_STORAGE_KEY
    );

    const migrated = loadExportConfig(storage);
    expect(migrated.version).toBe(4);
    expect(migrated.paper.format).toBe("A5");
    expect(migrated.paper.marginMode).toBe("theme");
    expect(migrated.mermaid).toEqual(defaultExportConfig.mermaid);
    expect(storage.read()).toContain('"version":4');
  });

  it("将改过页边距的 v3 缓存迁移为自定义模式", () => {
    const legacyConfig = {
      ...defaultExportConfig,
      version: 3,
      paper: {
        ...defaultExportConfig.paper,
        marginMode: undefined,
        margins: {
          top: "20mm",
          right: "18mm",
          bottom: "20mm",
          left: "18mm"
        }
      }
    };
    const migrated = parseStoredExportConfig(
      JSON.stringify(legacyConfig)
    );

    expect(migrated.version).toBe(4);
    expect(migrated.paper.marginMode).toBe("custom");
    expect(migrated.paper.margins).toEqual(legacyConfig.paper.margins);
  });

  it("将未改页眉页码的旧 v4 缓存迁移为跟随主题", () => {
    const legacyConfig = {
      ...defaultExportConfig,
      pageDecorationsMode: undefined,
      header: {
        ...defaultExportConfig.header,
        fontFamily: undefined,
        showOnFirstPage: undefined
      },
      footer: {
        ...defaultExportConfig.footer,
        fontFamily: undefined,
        showOnFirstPage: undefined
      }
    };
    const migrated = parseStoredExportConfig(
      JSON.stringify(legacyConfig)
    );

    expect(migrated.pageDecorationsMode).toBe("theme");
    expect(migrated.header.fontFamily).toContain("Microsoft YaHei");
    expect(migrated.header.showOnFirstPage).toBe(true);
    expect(migrated.footer.showOnFirstPage).toBe(true);
  });

  it("保留旧 v4 缓存中用户修改过的页眉页码", () => {
    const legacyConfig = {
      ...defaultExportConfig,
      pageDecorationsMode: undefined,
      header: {
        ...defaultExportConfig.header,
        enabled: true,
        fontFamily: undefined,
        center: {
          enabled: true,
          content: "${title}"
        }
      },
      footer: {
        ...defaultExportConfig.footer,
        alignment: "right",
        fontFamily: undefined,
        showOnFirstPage: undefined
      }
    };
    const migrated = parseStoredExportConfig(
      JSON.stringify(legacyConfig)
    );

    expect(migrated.pageDecorationsMode).toBe("custom");
    expect(migrated.header.enabled).toBe(true);
    expect(migrated.header.center.content).toBe("${title}");
    expect(migrated.footer.alignment).toBe("right");
  });

  it("保存并恢复经过校验的配置", () => {
    const storage = createMemoryStorage();
    const config = {
      ...defaultExportConfig,
      paper: {
        ...defaultExportConfig.paper,
        format: "A3" as const,
        orientation: "landscape" as const
      }
    };

    saveExportConfig(config, storage);
    expect(storage.read()).toContain('"format":"A3"');
    expect(loadExportConfig(storage)).toEqual(config);
  });
});
