import {
  type KeyboardEvent,
  useEffect,
  useRef,
  useState
} from "react";
import type { EditorView } from "@codemirror/view";
import { insertMarkdownTable } from "./markdown-editor-commands";

interface MarkdownTableToolProps {
  editorView: EditorView | null;
}

const maximumColumns = 10;
const maximumRows = 10;
const minimumRows = 2;

interface TableSize {
  columns: number;
  rows: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function MarkdownTableTool({
  editorView
}: MarkdownTableToolProps) {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState<TableSize>({
    columns: 3,
    rows: 3
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function focusSize(nextSize: TableSize) {
    window.requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector<HTMLButtonElement>(
          `[data-table-size="${nextSize.columns}x${nextSize.rows}"]`
        )
        ?.focus();
    });
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    focusSize(size);
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!editorView) {
      setOpen(false);
    }
  }, [editorView]);

  function moveSelection(
    event: KeyboardEvent<HTMLButtonElement>,
    columnsDelta: number,
    rowsDelta: number
  ) {
    event.preventDefault();
    const nextSize = {
      columns: clamp(
        size.columns + columnsDelta,
        1,
        maximumColumns
      ),
      rows: clamp(
        size.rows + rowsDelta,
        minimumRows,
        maximumRows
      )
    };
    setSize(nextSize);
    focusSize(nextSize);
  }

  function insertTable(selectedSize: TableSize) {
    if (!editorView) {
      return;
    }
    insertMarkdownTable(
      editorView,
      selectedSize.columns,
      selectedSize.rows
    );
    setOpen(false);
  }

  return (
    <div className="markdown-table-tool" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="markdown-toolbar-button"
        aria-label="插入表格"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="插入表格"
        disabled={!editorView}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((current) => !current)}
      >
        表格
      </button>
      {open ? (
        <div
          className="markdown-table-popover"
          role="dialog"
          aria-label="选择表格尺寸"
        >
          <strong>
            {size.columns} 列 × {size.rows} 行
          </strong>
          <span>首行为表头</span>
          <div
            className="markdown-table-grid"
            role="grid"
            aria-label="表格尺寸"
            aria-rowcount={maximumRows - minimumRows + 1}
            aria-colcount={maximumColumns}
          >
            {Array.from(
              {
                length:
                  maximumColumns *
                  (maximumRows - minimumRows + 1)
              },
              (_, index) => {
                const columns = (index % maximumColumns) + 1;
                const rows =
                  Math.floor(index / maximumColumns) + minimumRows;
                const selected =
                  columns <= size.columns && rows <= size.rows;
                const active =
                  columns === size.columns && rows === size.rows;
                return (
                  <button
                    key={`${columns}x${rows}`}
                    type="button"
                    role="gridcell"
                    className={
                      selected
                        ? "markdown-table-cell is-selected"
                        : "markdown-table-cell"
                    }
                    data-table-size={`${columns}x${rows}`}
                    aria-label={`插入 ${columns} 列 × ${rows} 行表格`}
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    onPointerEnter={() =>
                      setSize({ columns, rows })
                    }
                    onFocus={() => setSize({ columns, rows })}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowLeft") {
                        moveSelection(event, -1, 0);
                      } else if (event.key === "ArrowRight") {
                        moveSelection(event, 1, 0);
                      } else if (event.key === "ArrowUp") {
                        moveSelection(event, 0, -1);
                      } else if (event.key === "ArrowDown") {
                        moveSelection(event, 0, 1);
                      } else if (
                        event.key === "Enter" ||
                        event.key === " "
                      ) {
                        event.preventDefault();
                        insertTable({ columns, rows });
                      }
                    }}
                    onClick={() => insertTable({ columns, rows })}
                  />
                );
              }
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
