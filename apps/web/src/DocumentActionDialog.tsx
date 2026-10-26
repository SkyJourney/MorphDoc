import { useEffect } from "react";

type DocumentActionDialogProps =
  | {
      type: "new-location";
      busy?: false;
      onCurrentWindow: () => void;
      onNewWindow: () => void;
      onCancel: () => void;
    }
  | {
      type: "unsaved";
      busy: boolean;
      onSave: () => void;
      onDiscard: () => void;
      onCancel: () => void;
    };

export function DocumentActionDialog(
  props: DocumentActionDialogProps
) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !props.busy) {
        event.preventDefault();
        props.onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [props]);

  const isNewLocation = props.type === "new-location";
  return (
    <div className="document-dialog-layer">
      <div className="document-dialog-backdrop" />
      <section
        className="document-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-dialog-title"
        aria-describedby="document-dialog-description"
      >
        <span className="panel-kicker">文档操作</span>
        <h2 id="document-dialog-title">
          {isNewLocation ? "新建 Markdown" : "保存当前修改？"}
        </h2>
        <p id="document-dialog-description">
          {isNewLocation
            ? "请选择在当前窗口新建，或者保留当前文档并打开一个新窗口。"
            : "当前文档包含尚未保存的修改。继续操作前，可以先保存这些内容。"}
        </p>
        <div className="document-dialog-actions">
          <button
            type="button"
            disabled={props.busy}
            onClick={props.onCancel}
          >
            取消
          </button>
          {isNewLocation ? (
            <>
              <button
                type="button"
                onClick={props.onNewWindow}
              >
                新窗口新建
              </button>
              <button
                type="button"
                className="is-primary"
                autoFocus
                onClick={props.onCurrentWindow}
              >
                当前窗口新建
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={props.busy}
                onClick={props.onDiscard}
              >
                不保存
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={props.busy}
                autoFocus
                onClick={props.onSave}
              >
                {props.busy ? "正在保存…" : "保存"}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
