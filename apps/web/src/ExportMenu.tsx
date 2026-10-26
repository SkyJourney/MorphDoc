import { useEffect, useRef, useState } from "react";

export interface ExportCommand {
  id: string;
  label: string;
  description: string;
  disabled?: boolean;
  disabledReason?: string | undefined;
  busy?: boolean;
  onSelect(): void | Promise<void>;
}

export interface ExportMenuProps {
  commands: ExportCommand[];
}

export function ExportMenu({ commands }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="export-menu more-menu" ref={menuRef}>
      <button
        type="button"
        aria-controls="export-actions-menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        导出 ▾
      </button>
      {open ? (
        <div
          id="export-actions-menu"
          className="export-menu-popover more-menu-popover"
          role="menu"
          aria-label="导出格式"
        >
          {commands.map((command) => (
            <button
              type="button"
              className="export-menu-command"
              role="menuitem"
              key={command.id}
              disabled={command.disabled}
              title={command.disabledReason}
              onClick={() => {
                setOpen(false);
                void command.onSelect();
              }}
            >
              <span>
                <strong>
                  {command.busy
                    ? `正在生成 ${command.label}…`
                    : `导出 ${command.label}`}
                </strong>
                <small>
                  {command.disabledReason ?? command.description}
                </small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
