import type { MouseEvent } from "react";
import type { EditorView } from "@codemirror/view";
import {
  executeMarkdownEditorCommand,
  getMarkdownEditorCommand
} from "./markdown-editor-commands";
import { MarkdownTableTool } from "./MarkdownTableTool";

interface MarkdownToolbarProps {
  editorView: EditorView | null;
}

const toolbarGroups = [
  ["undo", "redo"],
  ["bold", "italic", "strikethrough", "inline-code"],
  [
    "code-block",
    "quote",
    "unordered-list",
    "ordered-list",
    "task-list"
  ],
  ["table", "horizontal-rule"]
] as const;

function preserveEditorSelection(event: MouseEvent<HTMLElement>) {
  event.preventDefault();
}

export function MarkdownToolbar({
  editorView
}: MarkdownToolbarProps) {
  function execute(commandId: string) {
    if (!editorView) {
      return;
    }
    executeMarkdownEditorCommand(commandId, { view: editorView });
  }

  return (
    <div
      className="markdown-toolbar"
      role="toolbar"
      aria-label="Markdown 格式工具栏"
    >
      <label className="markdown-toolbar-heading">
        <span className="sr-only">标题级别</span>
        <select
          aria-label="设置标题级别"
          defaultValue=""
          disabled={!editorView}
          onChange={(event) => {
            if (event.target.value) {
              execute(event.target.value);
              event.target.value = "";
            }
          }}
        >
          <option value="">标题</option>
          {Array.from({ length: 6 }, (_, index) => (
            <option
              key={index + 1}
              value={`heading-${index + 1}`}
            >
              H{index + 1}
            </option>
          ))}
        </select>
      </label>
      {toolbarGroups.map((group, groupIndex) => (
        <div
          className="markdown-toolbar-group"
          key={group.join("-")}
          aria-label={`工具组 ${groupIndex + 1}`}
        >
          {group.map((commandId) => {
            if (commandId === "table") {
              return (
                <MarkdownTableTool
                  key={commandId}
                  editorView={editorView}
                />
              );
            }
            const command = getMarkdownEditorCommand(commandId);
            if (!command) {
              return null;
            }
            const disabled =
              !editorView ||
              (command.isEnabled?.({ view: editorView }) === false);
            return (
              <button
                key={command.id}
                type="button"
                className={`markdown-toolbar-button command-${command.id}`}
                aria-label={command.label}
                title={
                  command.shortcut
                    ? `${command.label}（${command.shortcut}）`
                    : command.label
                }
                disabled={disabled}
                onMouseDown={preserveEditorSelection}
                onClick={() => execute(command.id)}
              >
                {command.toolbarLabel}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
