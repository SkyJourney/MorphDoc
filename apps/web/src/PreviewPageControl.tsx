import { useEffect, useRef, useState } from "react";
import { normalizePreviewPageNumber } from "./preview-page";

interface PreviewPageControlProps {
  current: number;
  total: number;
  onNavigate: (pageNumber: number) => void;
}

export function PreviewPageControl({
  current,
  total,
  onNavigate
}: PreviewPageControlProps) {
  const [draft, setDraft] = useState(String(current));
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) {
      setDraft(String(current));
    }
  }, [current, total]);

  function commitPageNumber() {
    const pageNumber = normalizePreviewPageNumber(draft, current, total);
    setDraft(String(pageNumber));
    if (pageNumber !== current) {
      onNavigate(pageNumber);
    }
  }

  return (
    <label className="preview-page-control">
      <span>第</span>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={total}
        step={1}
        value={draft}
        aria-label="跳转页码"
        onBlur={() => {
          editingRef.current = false;
          commitPageNumber();
        }}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => {
          editingRef.current = true;
          event.currentTarget.select();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      <span aria-live="polite">/ {total} 页</span>
    </label>
  );
}
