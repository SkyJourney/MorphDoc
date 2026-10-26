import {
  defaultExportConfig,
  getPaperDimensionsMm,
  lengthToMillimeters,
  paperFormatLabels,
  supportedMermaidLayouts,
  supportedMermaidLooks,
  supportedMermaidThemes,
  supportedPaperFormats,
  type ExportConfig,
  type FooterConfig,
  type HeaderConfig,
  type MermaidExportConfig
} from "@morphdoc/core";
import { useEffect, useState } from "react";
import type { ThemeSummary } from "./application-backend";

interface ExportSettingsDrawerProps {
  config: ExportConfig;
  theme: ThemeSummary | undefined;
  onChange: (config: ExportConfig) => void;
  onClose: () => void;
  onReset: () => void;
}

interface LengthInputProps {
  label: string;
  value: string;
  maximum: number;
  disabled?: boolean;
  precision?: number;
  step?: number;
  onChange: (value: string) => void;
}

const pageNumberFormatLabels: Record<FooterConfig["format"], string> = {
  page: "1",
  "page-total": "1 / 10",
  "chinese-page-total": "第 1 页 / 共 10 页",
  "dash-page": "- 1 -",
  "official-page": "— 1 —（标准公文）",
  custom: "自定义模板"
};

const mermaidLayoutLabels: Record<
  MermaidExportConfig["layout"],
  string
> = {
  dagre: "Dagre",
  elk: "ELK"
};

const mermaidThemeLabels: Record<
  MermaidExportConfig["theme"],
  string
> = {
  default: "Default",
  base: "Base（可定制基础主题）",
  dark: "Dark",
  forest: "Forest",
  neutral: "Neutral",
  neo: "Neo",
  "neo-dark": "Neo Dark",
  redux: "Redux",
  "redux-dark": "Redux Dark",
  "redux-color": "Redux Color",
  "redux-dark-color": "Redux Dark Color"
};

const mermaidLookLabels: Record<
  MermaidExportConfig["look"],
  string
> = {
  classic: "Classic",
  handDrawn: "Hand-drawn",
  neo: "Neo"
};

const mermaidFontFamilies = [
  "Segoe UI, Microsoft YaHei, sans-serif",
  "Microsoft YaHei, sans-serif",
  "Arial, Helvetica, sans-serif",
  "Georgia, Times New Roman, serif",
  "Consolas, Microsoft YaHei, monospace"
] as const;

function fitMarginPair(
  first: number,
  second: number,
  available: number
) {
  const total = first + second;
  if (total <= available || total === 0) {
    return [first, second] as const;
  }
  const scale = available / total;
  const scaledFirst = Math.floor(first * scale * 10) / 10;
  return [
    scaledFirst,
    Math.floor((available - scaledFirst) * 10) / 10
  ] as const;
}

function LengthInput({
  label,
  value,
  maximum,
  disabled = false,
  precision = 1,
  step = 0.1,
  onChange
}: LengthInputProps) {
  const [draft, setDraft] = useState(
    String(lengthToMillimeters(value))
  );

  useEffect(() => {
    setDraft(String(lengthToMillimeters(value)));
  }, [value]);

  function commit() {
    const number = Number.parseFloat(draft);
    if (!Number.isFinite(number)) {
      setDraft(String(lengthToMillimeters(value)));
      return;
    }
    const normalized = Math.min(Math.max(number, 0), maximum);
    const factor = 10 ** precision;
    const rounded = Math.round(normalized * factor) / factor;
    setDraft(String(rounded));
    onChange(`${rounded}mm`);
  }

  return (
    <label className="setting-field">
      <span>{label}</span>
      <span className="length-input">
        <input
          type="number"
          min="0"
          max={maximum}
          step={step}
          value={draft}
          disabled={disabled}
          onBlur={commit}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        <span>mm</span>
      </span>
    </label>
  );
}

function PageDecorationFontInput({
  label,
  value,
  disabled,
  onChange
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit() {
    const normalized = draft.trim();
    if (
      !normalized ||
      !/^[\p{L}\p{N}\s,"'-]+$/u.test(normalized)
    ) {
      setDraft(value);
      return;
    }
    setDraft(normalized);
    onChange(normalized);
  }

  return (
    <label className="setting-field stacked">
      <span>{label}</span>
      <input
        type="text"
        maxLength={300}
        value={draft}
        disabled={disabled}
        placeholder='"Segoe UI", "Microsoft YaHei", sans-serif'
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function MermaidFontInput({
  value,
  onChange
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit() {
    const normalized = draft.trim();
    if (!normalized) {
      setDraft(value);
      return;
    }
    setDraft(normalized);
    onChange(normalized);
  }

  return (
    <label className="setting-field stacked">
      <span>图表字体</span>
      <input
        type="text"
        list="mermaid-font-family-options"
        maxLength={300}
        value={draft}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
      <datalist id="mermaid-font-family-options">
        {mermaidFontFamilies.map((fontFamily) => (
          <option key={fontFamily} value={fontFamily} />
        ))}
      </datalist>
    </label>
  );
}

function updateHeaderSlot(
  header: HeaderConfig,
  slot: "left" | "center" | "right",
  value: Partial<HeaderConfig[typeof slot]>
) {
  return {
    ...header,
    [slot]: {
      ...header[slot],
      ...value
    }
  };
}

export function ExportSettingsDrawer({
  config,
  theme,
  onChange,
  onClose,
  onReset
}: ExportSettingsDrawerProps) {
  const dimensions = getPaperDimensionsMm(
    config.paper.format,
    config.paper.orientation
  );
  const margins = config.paper.margins;
  const horizontalGap = 1;
  const verticalGap = 1;

  function updatePaper(paper: Partial<ExportConfig["paper"]>) {
    const nextPaper = {
      ...config.paper,
      ...paper
    };
    const nextDimensions = getPaperDimensionsMm(
      nextPaper.format,
      nextPaper.orientation
    );
    const [left, right] = fitMarginPair(
      lengthToMillimeters(nextPaper.margins.left),
      lengthToMillimeters(nextPaper.margins.right),
      nextDimensions.width - 1
    );
    const [top, bottom] = fitMarginPair(
      lengthToMillimeters(nextPaper.margins.top),
      lengthToMillimeters(nextPaper.margins.bottom),
      nextDimensions.height - 1
    );

    onChange({
      ...config,
      paper: {
        ...nextPaper,
        margins: {
          top: `${top}mm`,
          right: `${right}mm`,
          bottom: `${bottom}mm`,
          left: `${left}mm`
        }
      }
    });
  }

  function updateMargin(
    side: keyof ExportConfig["paper"]["margins"],
    value: string
  ) {
    updatePaper({
      marginMode: "custom",
      margins: {
        ...margins,
        [side]: value
      }
    });
  }

  function followThemeMargins() {
    updatePaper({
      marginMode: "theme",
      margins: theme?.pageDefaults?.margins ?? {
        top: "16mm",
        right: "16mm",
        bottom: "16mm",
        left: "16mm"
      }
    });
  }

  function updateHeader(header: Partial<HeaderConfig>) {
    onChange({
      ...config,
      pageDecorationsMode: "custom",
      header: {
        ...config.header,
        ...header
      }
    });
  }

  function updateFooter(footer: Partial<FooterConfig>) {
    onChange({
      ...config,
      pageDecorationsMode: "custom",
      footer: {
        ...config.footer,
        ...footer
      }
    });
  }

  function followThemePageDecorations() {
    onChange({
      ...config,
      pageDecorationsMode: "theme",
      header: structuredClone(
        theme?.pageDefaults?.header ?? defaultExportConfig.header
      ),
      footer: structuredClone(
        theme?.pageDefaults?.footer ?? defaultExportConfig.footer
      )
    });
  }

  function updateMermaid(mermaid: Partial<MermaidExportConfig>) {
    onChange({
      ...config,
      mermaid: {
        ...config.mermaid,
        ...mermaid
      }
    });
  }

  return (
    <div className="settings-layer">
      <button
        type="button"
        className="settings-backdrop"
        aria-label="关闭导出设置"
        onClick={onClose}
      />
      <aside
        className="settings-drawer"
        aria-label="导出设置"
        aria-modal="true"
        role="dialog"
      >
        <div className="settings-heading">
          <div>
            <span className="panel-kicker">预览与未来 PDF 共用</span>
            <h2>导出设置</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭导出设置"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="settings-content">
          <section className="settings-section">
            <h3>纸张</h3>
            <label className="setting-field">
              <span>尺寸</span>
              <select
                value={config.paper.format}
                onChange={(event) =>
                  updatePaper({
                    format: event.target
                      .value as ExportConfig["paper"]["format"]
                  })
                }
              >
                {supportedPaperFormats.map((format) => (
                  <option key={format} value={format}>
                    {paperFormatLabels[format]}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="segmented-control">
              <legend>方向</legend>
              <label>
                <input
                  type="radio"
                  name="paper-orientation"
                  checked={config.paper.orientation === "portrait"}
                  onChange={() => updatePaper({ orientation: "portrait" })}
                />
                纵向
              </label>
              <label>
                <input
                  type="radio"
                  name="paper-orientation"
                  checked={config.paper.orientation === "landscape"}
                  onChange={() => updatePaper({ orientation: "landscape" })}
                />
                横向
              </label>
            </fieldset>
            <p className="setting-hint">
              当前纸张：{dimensions.width} × {dimensions.height}mm
            </p>
          </section>

          <section className="settings-section">
            <h3>页边距</h3>
            <fieldset className="segmented-control margin-mode-control">
              <legend>页边距来源</legend>
              <label>
                <input
                  type="radio"
                  name="margin-mode"
                  checked={config.paper.marginMode === "theme"}
                  onChange={followThemeMargins}
                />
                跟随主题
              </label>
              <label>
                <input
                  type="radio"
                  name="margin-mode"
                  checked={config.paper.marginMode === "custom"}
                  onChange={() => updatePaper({ marginMode: "custom" })}
                />
                自定义
              </label>
            </fieldset>
            <p className="setting-hint margin-source-hint">
              {config.paper.marginMode === "theme"
                ? theme?.pageDefaults
                  ? `当前采用“${theme.name}”推荐值`
                  : "当前主题未设置推荐值，采用全局默认 16mm"
                : "当前采用自定义值；修改任意页边距会自动进入此模式"}
            </p>
            <div className="margin-grid">
              <LengthInput
                label="上"
                value={margins.top}
                maximum={
                  dimensions.height -
                  lengthToMillimeters(margins.bottom) -
                  verticalGap
                }
                onChange={(value) => updateMargin("top", value)}
              />
              <LengthInput
                label="右"
                value={margins.right}
                maximum={
                  dimensions.width -
                  lengthToMillimeters(margins.left) -
                  horizontalGap
                }
                onChange={(value) => updateMargin("right", value)}
              />
              <LengthInput
                label="下"
                value={margins.bottom}
                maximum={
                  dimensions.height -
                  lengthToMillimeters(margins.top) -
                  verticalGap
                }
                onChange={(value) => updateMargin("bottom", value)}
              />
              <LengthInput
                label="左"
                value={margins.left}
                maximum={
                  dimensions.width -
                  lengthToMillimeters(margins.right) -
                  horizontalGap
                }
                onChange={(value) => updateMargin("left", value)}
              />
            </div>
            {config.paper.marginMode === "custom" ? (
              <button
                type="button"
                className="secondary-action margin-reset-action"
                onClick={followThemeMargins}
              >
                恢复主题推荐值
              </button>
            ) : null}
          </section>

          <section className="settings-section">
            <h3>Mermaid 图表</h3>
            <label className="setting-field">
              <span>布局算法</span>
              <select
                value={config.mermaid.layout}
                onChange={(event) =>
                  updateMermaid({
                    layout: event.target
                      .value as MermaidExportConfig["layout"]
                  })
                }
              >
                {supportedMermaidLayouts.map((layout) => (
                  <option key={layout} value={layout}>
                    {mermaidLayoutLabels[layout]}
                  </option>
                ))}
              </select>
            </label>
            <label className="setting-field">
              <span>图表主题</span>
              <select
                value={config.mermaid.theme}
                onChange={(event) =>
                  updateMermaid({
                    theme: event.target
                      .value as MermaidExportConfig["theme"]
                  })
                }
              >
                {supportedMermaidThemes.map((theme) => (
                  <option key={theme} value={theme}>
                    {mermaidThemeLabels[theme]}
                  </option>
                ))}
              </select>
            </label>
            <label className="setting-field">
              <span>图表外观</span>
              <select
                value={config.mermaid.look}
                onChange={(event) =>
                  updateMermaid({
                    look: event.target
                      .value as MermaidExportConfig["look"]
                  })
                }
              >
                {supportedMermaidLooks.map((look) => (
                  <option key={look} value={look}>
                    {mermaidLookLabels[look]}
                  </option>
                ))}
              </select>
            </label>
            <MermaidFontInput
              value={config.mermaid.fontFamily}
              onChange={(fontFamily) => updateMermaid({ fontFamily })}
            />
            <p className="setting-hint">
              单个 Mermaid 代码块中的 config frontmatter
              优先于这里的全局设置；style、classDef 和 themeVariables
              会继续按 Mermaid 原生语法生效。
            </p>
          </section>

          <section className="settings-section">
            <h3>页眉与页码来源</h3>
            <fieldset className="segmented-control margin-mode-control">
              <legend>页面装饰来源</legend>
              <label>
                <input
                  type="radio"
                  name="page-decorations-mode"
                  checked={config.pageDecorationsMode === "theme"}
                  onChange={followThemePageDecorations}
                />
                跟随主题
              </label>
              <label>
                <input
                  type="radio"
                  name="page-decorations-mode"
                  checked={config.pageDecorationsMode === "custom"}
                  onChange={() =>
                    onChange({
                      ...config,
                      pageDecorationsMode: "custom"
                    })
                  }
                />
                自定义
              </label>
            </fieldset>
            <p className="setting-hint margin-source-hint">
              {config.pageDecorationsMode === "theme"
                ? theme?.pageDefaults?.header ||
                  theme?.pageDefaults?.footer
                  ? `当前采用“${theme.name}”推荐的页眉与页码`
                  : "当前主题未设置推荐值，采用全局默认配置"
                : "当前采用自定义配置；修改页眉或页码会自动进入此模式"}
            </p>
            {config.pageDecorationsMode === "custom" ? (
              <button
                type="button"
                className="secondary-action margin-reset-action"
                onClick={followThemePageDecorations}
              >
                恢复主题推荐值
              </button>
            ) : null}
          </section>

          <section className="settings-section">
            <div className="setting-section-title">
              <h3>页眉</h3>
              <label className="switch-control">
                <input
                  type="checkbox"
                  checked={config.header.enabled}
                  onChange={(event) =>
                    updateHeader({ enabled: event.target.checked })
                  }
                />
                <span>{config.header.enabled ? "开启" : "关闭"}</span>
              </label>
            </div>
            <p className="setting-hint">
              支持 {"${title}"}、{"${author}"} 和 {"${filename}"}。
            </p>
            <PageDecorationFontInput
              label="页眉字体"
              value={config.header.fontFamily}
              disabled={!config.header.enabled}
              onChange={(fontFamily) => updateHeader({ fontFamily })}
            />
            <LengthInput
              label="页眉字号"
              value={config.header.fontSize}
              maximum={20}
              disabled={!config.header.enabled}
              precision={2}
              step={0.01}
              onChange={(fontSize) => updateHeader({ fontSize })}
            />
            {(["left", "center", "right"] as const).map((slot) => {
              const labels = { left: "左侧", center: "中间", right: "右侧" };
              return (
                <div className="header-slot" key={slot}>
                  <label className="switch-control compact">
                    <input
                      type="checkbox"
                      checked={config.header[slot].enabled}
                      disabled={!config.header.enabled}
                      onChange={(event) =>
                        updateHeader(
                          updateHeaderSlot(config.header, slot, {
                            enabled: event.target.checked
                          })
                        )
                      }
                    />
                    <span>{labels[slot]}</span>
                  </label>
                  <input
                    type="text"
                    value={config.header[slot].content}
                    disabled={
                      !config.header.enabled ||
                      !config.header[slot].enabled
                    }
                    placeholder={`页眉${labels[slot]}内容`}
                    onChange={(event) =>
                      updateHeader(
                        updateHeaderSlot(config.header, slot, {
                          content: event.target.value
                        })
                      )
                    }
                  />
                </div>
              );
            })}
            <label className="switch-control divider-control">
              <input
                type="checkbox"
                checked={config.header.showOnFirstPage}
                disabled={!config.header.enabled}
                onChange={(event) =>
                  updateHeader({
                    showOnFirstPage: event.target.checked
                  })
                }
              />
              <span>正文首页显示页眉</span>
            </label>
            <label className="switch-control divider-control">
              <input
                type="checkbox"
                checked={config.header.showDivider}
                disabled={!config.header.enabled}
                onChange={(event) =>
                  updateHeader({ showDivider: event.target.checked })
                }
              />
              <span>显示页眉分隔线</span>
            </label>
          </section>

          <section className="settings-section">
            <div className="setting-section-title">
              <h3>页脚页码</h3>
              <label className="switch-control">
                <input
                  type="checkbox"
                  checked={config.footer.enabled}
                  onChange={(event) =>
                    updateFooter({ enabled: event.target.checked })
                  }
                />
                <span>{config.footer.enabled ? "开启" : "关闭"}</span>
              </label>
            </div>
            <PageDecorationFontInput
              label="页码字体"
              value={config.footer.fontFamily}
              disabled={!config.footer.enabled}
              onChange={(fontFamily) => updateFooter({ fontFamily })}
            />
            <LengthInput
              label="页码字号"
              value={config.footer.fontSize}
              maximum={20}
              disabled={!config.footer.enabled}
              precision={2}
              step={0.01}
              onChange={(fontSize) => updateFooter({ fontSize })}
            />
            <label className="setting-field">
              <span>样式</span>
              <select
                value={config.footer.format}
                disabled={!config.footer.enabled}
                onChange={(event) =>
                  updateFooter({
                    format: event.target.value as FooterConfig["format"]
                  })
                }
              >
                {Object.entries(pageNumberFormatLabels).map(
                  ([format, label]) => (
                    <option key={format} value={format}>
                      {label}
                    </option>
                  )
                )}
              </select>
            </label>
            {config.footer.format === "custom" ? (
              <label className="setting-field stacked">
                <span>模板</span>
                <input
                  type="text"
                  value={config.footer.template ?? ""}
                  disabled={!config.footer.enabled}
                  placeholder="${page} / ${pages}"
                  onChange={(event) =>
                    updateFooter({ template: event.target.value })
                  }
                />
              </label>
            ) : null}
            <label className="setting-field">
              <span>位置</span>
              <select
                value={config.footer.alignment}
                disabled={!config.footer.enabled}
                onChange={(event) =>
                  updateFooter({
                    alignment: event.target
                      .value as FooterConfig["alignment"]
                  })
                }
              >
                <option value="left">左侧</option>
                <option value="center">居中</option>
                <option value="right">右侧</option>
                <option value="outer">外侧（奇数页右、偶数页左）</option>
              </select>
            </label>
            <label className="setting-field">
              <span>起始页码</span>
              <input
                type="number"
                min="1"
                step="1"
                value={config.footer.startFrom}
                disabled={!config.footer.enabled}
                onChange={(event) =>
                  updateFooter({
                    startFrom: Math.max(
                      1,
                      Number.parseInt(event.target.value, 10) || 1
                    )
                  })
                }
              />
            </label>
            <label className="switch-control divider-control">
              <input
                type="checkbox"
                checked={config.footer.showOnFirstPage}
                disabled={!config.footer.enabled}
                onChange={(event) =>
                  updateFooter({
                    showOnFirstPage: event.target.checked
                  })
                }
              />
              <span>正文首页显示页码</span>
            </label>
            <label className="switch-control divider-control">
              <input
                type="checkbox"
                checked={config.footer.showDivider}
                disabled={!config.footer.enabled}
                onChange={(event) =>
                  updateFooter({ showDivider: event.target.checked })
                }
              />
              <span>显示页脚分隔线</span>
            </label>
            <p className="setting-hint">
              页眉和页码会实时显示在分页预览中。
            </p>
          </section>
        </div>

        <div className="settings-actions">
          <button type="button" className="secondary-button" onClick={onReset}>
            恢复默认
          </button>
          <button type="button" onClick={onClose}>
            完成
          </button>
        </div>
      </aside>
    </div>
  );
}
