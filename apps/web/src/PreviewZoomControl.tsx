import { useEffect, useState } from "react";
import {
  DEFAULT_PREVIEW_ZOOM,
  MAXIMUM_PREVIEW_ZOOM,
  MINIMUM_PREVIEW_ZOOM,
  normalizePreviewZoom,
  parsePreviewZoom,
  PREVIEW_ZOOM_SLIDER_STEP
} from "./preview-zoom";

interface PreviewZoomControlProps {
  value: number;
  onChange: (value: number) => void;
}

export function PreviewZoomControl({
  value,
  onChange
}: PreviewZoomControlProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commitDraft() {
    const normalized = parsePreviewZoom(draft, value);
    setDraft(String(normalized));
    onChange(normalized);
  }

  return (
    <div
      className="preview-zoom-control"
      role="group"
      aria-label="预览缩放"
    >
      <span>缩放</span>
      <input
        className="preview-zoom-slider"
        type="range"
        aria-label="预览缩放滑块"
        min={MINIMUM_PREVIEW_ZOOM}
        max={MAXIMUM_PREVIEW_ZOOM}
        step={PREVIEW_ZOOM_SLIDER_STEP}
        value={value}
        onChange={(event) =>
          onChange(normalizePreviewZoom(Number(event.target.value)))
        }
      />
      <label className="preview-zoom-number">
        <span className="sr-only">预览缩放百分比</span>
        <input
          type="number"
          aria-label="预览缩放百分比"
          min={MINIMUM_PREVIEW_ZOOM}
          max={MAXIMUM_PREVIEW_ZOOM}
          step="1"
          value={draft}
          onBlur={commitDraft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        <span>%</span>
      </label>
      <button
        type="button"
        className="preview-zoom-reset"
        disabled={value === DEFAULT_PREVIEW_ZOOM}
        onClick={() => onChange(DEFAULT_PREVIEW_ZOOM)}
      >
        100%
      </button>
    </div>
  );
}
