import { useEffect } from "react";

export interface ExportToastState {
  kind: "progress" | "success" | "error";
  title: string;
  message?: string;
}

export interface ExportToastProps {
  toast: ExportToastState;
  onDismiss(): void;
}

export function ExportToast({
  toast,
  onDismiss
}: ExportToastProps) {
  useEffect(() => {
    if (toast.kind !== "success") {
      return;
    }
    const timeout = window.setTimeout(onDismiss, 3_500);
    return () => window.clearTimeout(timeout);
  }, [onDismiss, toast]);

  return (
    <aside
      className={`export-toast is-${toast.kind}`}
      role={toast.kind === "error" ? "alert" : "status"}
      aria-live={toast.kind === "error" ? "assertive" : "polite"}
    >
      <div className="export-toast-content">
        <strong>{toast.title}</strong>
        {toast.message ? <span>{toast.message}</span> : null}
      </div>
      {toast.kind !== "progress" ? (
        <button
          type="button"
          className="export-toast-close"
          aria-label="关闭导出提示"
          onClick={onDismiss}
        >
          ×
        </button>
      ) : null}
      {toast.kind === "progress" ? (
        <div className="export-toast-progress" aria-hidden="true">
          <span />
        </div>
      ) : null}
    </aside>
  );
}
