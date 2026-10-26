import {
  EditorSelection,
  type EditorState,
  type SelectionRange
} from "@codemirror/state";
import {
  redo,
  redoDepth,
  undo,
  undoDepth
} from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";

export type MarkdownEditorCommandGroup =
  | "history"
  | "text"
  | "block"
  | "insert"
  | "document";

export interface EditorCommandContext {
  view: EditorView;
  openPanel?: (panelId: string) => void;
}

export interface MarkdownEditorCommand {
  id: string;
  group: MarkdownEditorCommandGroup;
  label: string;
  toolbarLabel: string;
  shortcut?: string;
  isEnabled?: (context: EditorCommandContext) => boolean;
  execute: (
    context: EditorCommandContext
  ) => void | Promise<void>;
}

export interface MarkdownTextEdit {
  insert: string;
  selectionFrom: number;
  selectionTo: number;
}

type SelectionEditor = (
  selectedText: string,
  range: SelectionRange,
  state: EditorState
) => MarkdownTextEdit;

export function wrapMarkdownSelection(
  selectedText: string,
  prefix: string,
  suffix = prefix,
  placeholder = "文本"
): MarkdownTextEdit {
  if (
    selectedText.length >= prefix.length + suffix.length &&
    selectedText.startsWith(prefix) &&
    selectedText.endsWith(suffix)
  ) {
    const insert = selectedText.slice(
      prefix.length,
      selectedText.length - suffix.length
    );
    return {
      insert,
      selectionFrom: 0,
      selectionTo: insert.length
    };
  }

  const content = selectedText || placeholder;
  return {
    insert: `${prefix}${content}${suffix}`,
    selectionFrom: prefix.length,
    selectionTo: prefix.length + content.length
  };
}

function mapNonBlankLines(
  text: string,
  mapper: (line: string, index: number) => string
) {
  let contentLineIndex = 0;
  return text
    .split("\n")
    .map((line) => {
      if (!line.trim()) {
        return line;
      }
      const mapped = mapper(line, contentLineIndex);
      contentLineIndex += 1;
      return mapped;
    })
    .join("\n");
}

export type MarkdownLinePrefix =
  | "quote"
  | "unordered-list"
  | "ordered-list"
  | "task-list";

const linePrefixPatterns: Record<MarkdownLinePrefix, RegExp> = {
  quote: /^>\s?/u,
  "unordered-list": /^[-*+]\s+/u,
  "ordered-list": /^\d+[.)]\s+/u,
  "task-list": /^[-*+]\s+\[[ xX]\]\s+/u
};

export function toggleMarkdownLinePrefix(
  text: string,
  kind: MarkdownLinePrefix
) {
  const pattern = linePrefixPatterns[kind];
  const nonBlankLines = text
    .split("\n")
    .filter((line) => line.trim());
  const shouldRemove =
    nonBlankLines.length > 0 &&
    nonBlankLines.every((line) => pattern.test(line));

  return mapNonBlankLines(text, (line, index) => {
    if (shouldRemove) {
      return line.replace(pattern, "");
    }
    if (kind === "quote") {
      return `> ${line.replace(linePrefixPatterns.quote, "")}`;
    }
    if (kind === "ordered-list") {
      return `${index + 1}. ${line.replace(
        /^(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/u,
        ""
      )}`;
    }
    if (kind === "task-list") {
      return `- [ ] ${line.replace(
        /^(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/u,
        ""
      )}`;
    }
    return `- ${line.replace(
      /^(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/u,
      ""
    )}`;
  });
}

export function setMarkdownHeading(text: string, level: number) {
  const prefix = level > 0 ? `${"#".repeat(level)} ` : "";
  return mapNonBlankLines(
    text,
    (line) => `${prefix}${line.replace(/^#{1,6}\s+/u, "")}`
  );
}

export function createMarkdownTable(
  columnCount: number,
  rowCount: number
): MarkdownTextEdit {
  const columns = Math.trunc(columnCount);
  const rows = Math.trunc(rowCount);
  if (columns < 1 || columns > 10 || rows < 2 || rows > 10) {
    throw new RangeError("表格尺寸必须为 1～10 列、2～10 行");
  }

  const headerCells = Array.from(
    { length: columns },
    (_, index) => `列 ${index + 1}`
  );
  const separatorCells = Array.from(
    { length: columns },
    () => "---"
  );
  const contentRow = `| ${Array.from(
    { length: columns },
    () => "内容"
  ).join(" | ")} |`;
  const insert = [
    `| ${headerCells.join(" | ")} |`,
    `| ${separatorCells.join(" | ")} |`,
    ...Array.from({ length: rows - 1 }, () => contentRow)
  ].join("\n");
  return {
    insert,
    selectionFrom: 2,
    selectionTo: 5
  };
}

function replaceSelections(
  view: EditorView,
  createEdit: SelectionEditor
) {
  const transaction = view.state.changeByRange((range) => {
    const selectedText = view.state.sliceDoc(range.from, range.to);
    const edit = createEdit(selectedText, range, view.state);
    return {
      changes: {
        from: range.from,
        to: range.to,
        insert: edit.insert
      },
      range: EditorSelection.range(
        range.from + edit.selectionFrom,
        range.from + edit.selectionTo
      )
    };
  });
  view.dispatch(transaction);
  view.focus();
}

function editSelectedLines(
  view: EditorView,
  transform: (text: string) => string
) {
  const transaction = view.state.changeByRange((range) => {
    const startLine = view.state.doc.lineAt(range.from);
    const endProbe =
      range.to > range.from &&
      view.state.doc.lineAt(range.to).from === range.to
        ? range.to - 1
        : range.to;
    const endLine = view.state.doc.lineAt(endProbe);
    const selectedLines = view.state.sliceDoc(
      startLine.from,
      endLine.to
    );
    const insert = transform(selectedLines);
    return {
      changes: {
        from: startLine.from,
        to: endLine.to,
        insert
      },
      range: EditorSelection.range(
        startLine.from,
        startLine.from + insert.length
      )
    };
  });
  view.dispatch(transaction);
  view.focus();
}

function insertMarkdownBlock(
  block: string,
  range?: SelectionRange,
  state?: EditorState
): MarkdownTextEdit {
  const before =
    range && state ? state.sliceDoc(0, range.from) : "";
  const after = range && state ? state.sliceDoc(range.to) : "";
  const leading =
    !before || before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
  const trailing =
    !after || after.startsWith("\n\n")
      ? ""
      : after.startsWith("\n")
        ? "\n"
        : "\n\n";
  const insert = `${leading}${block}${trailing}`;
  return {
    insert,
    selectionFrom: leading.length,
    selectionTo: leading.length + block.length
  };
}

export function insertMarkdownTable(
  view: EditorView,
  columnCount: number,
  rowCount: number
) {
  replaceSelections(view, (_, range, state) => {
    const table = createMarkdownTable(columnCount, rowCount);
    const block = insertMarkdownBlock(
      table.insert,
      range,
      state
    );
    return {
      insert: block.insert,
      selectionFrom: block.selectionFrom + table.selectionFrom,
      selectionTo: block.selectionFrom + table.selectionTo
    };
  });
}

function createInlineCommand(
  id: string,
  label: string,
  toolbarLabel: string,
  prefix: string,
  suffix = prefix,
  placeholder = "文本",
  shortcut?: string
): MarkdownEditorCommand {
  return {
    id,
    group: "text",
    label,
    toolbarLabel,
    ...(shortcut ? { shortcut } : {}),
    execute: ({ view }) =>
      replaceSelections(view, (selectedText) =>
        wrapMarkdownSelection(
          selectedText,
          prefix,
          suffix,
          placeholder
        )
      )
  };
}

function createLineCommand(
  id: string,
  label: string,
  toolbarLabel: string,
  kind: MarkdownLinePrefix,
  shortcut?: string
): MarkdownEditorCommand {
  return {
    id,
    group: "block",
    label,
    toolbarLabel,
    ...(shortcut ? { shortcut } : {}),
    execute: ({ view }) =>
      editSelectedLines(view, (text) =>
        toggleMarkdownLinePrefix(text, kind)
      )
  };
}

const historyCommands: MarkdownEditorCommand[] = [
  {
    id: "undo",
    group: "history",
    label: "撤销",
    toolbarLabel: "↶",
    shortcut: "Mod-z",
    isEnabled: ({ view }) => undoDepth(view.state) > 0,
    execute: ({ view }) => {
      undo(view);
      view.focus();
    }
  },
  {
    id: "redo",
    group: "history",
    label: "重做",
    toolbarLabel: "↷",
    shortcut: "Mod-Shift-z",
    isEnabled: ({ view }) => redoDepth(view.state) > 0,
    execute: ({ view }) => {
      redo(view);
      view.focus();
    }
  }
];

const textCommands: MarkdownEditorCommand[] = [
  createInlineCommand(
    "bold",
    "加粗",
    "B",
    "**",
    "**",
    "粗体文本",
    "Mod-b"
  ),
  createInlineCommand(
    "italic",
    "斜体",
    "I",
    "*",
    "*",
    "斜体文本",
    "Mod-i"
  ),
  createInlineCommand(
    "strikethrough",
    "删除线",
    "S",
    "~~",
    "~~",
    "删除线文本",
    "Mod-Shift-x"
  ),
  createInlineCommand(
    "inline-code",
    "行内代码",
    "</>",
    "`",
    "`",
    "code"
  )
];

const blockCommands: MarkdownEditorCommand[] = [
  {
    id: "code-block",
    group: "block",
    label: "代码块",
    toolbarLabel: "代码块",
    execute: ({ view }) =>
      replaceSelections(view, (selectedText) =>
        wrapMarkdownSelection(
          selectedText,
          "```\n",
          "\n```",
          "code"
        )
      )
  },
  createLineCommand("quote", "引用", "❞", "quote"),
  createLineCommand(
    "unordered-list",
    "无序列表",
    "• 列表",
    "unordered-list",
    "Mod-Shift-8"
  ),
  createLineCommand(
    "ordered-list",
    "有序列表",
    "1. 列表",
    "ordered-list",
    "Mod-Shift-7"
  ),
  createLineCommand("task-list", "任务列表", "☑", "task-list")
];

const insertCommands: MarkdownEditorCommand[] = [
  {
    id: "table",
    group: "insert",
    label: "插入表格",
    toolbarLabel: "表格",
    execute: ({ view, openPanel }) => {
      if (openPanel) {
        openPanel("table");
        return;
      }
      insertMarkdownTable(view, 3, 3);
    }
  },
  {
    id: "horizontal-rule",
    group: "insert",
    label: "插入分隔线",
    toolbarLabel: "—",
    execute: ({ view }) =>
      replaceSelections(view, (_, range, state) =>
        insertMarkdownBlock("---", range, state)
      )
  }
];

const headingCommands = Array.from(
  { length: 6 },
  (_, index): MarkdownEditorCommand => {
    const level = index + 1;
    return {
      id: `heading-${level}`,
      group: "block",
      label: `${level} 级标题`,
      toolbarLabel: `H${level}`,
      execute: ({ view }) =>
        editSelectedLines(view, (text) =>
          setMarkdownHeading(text, level)
        )
    };
  }
);

export const markdownEditorCommands: readonly MarkdownEditorCommand[] =
  [
    ...historyCommands,
    ...headingCommands,
    ...textCommands,
    ...blockCommands,
    ...insertCommands
  ];

const markdownEditorCommandMap = new Map(
  markdownEditorCommands.map((command) => [command.id, command])
);

export function getMarkdownEditorCommand(commandId: string) {
  return markdownEditorCommandMap.get(commandId);
}

export function executeMarkdownEditorCommand(
  commandId: string,
  context: EditorCommandContext
) {
  const command = getMarkdownEditorCommand(commandId);
  if (
    !command ||
    (command.isEnabled && !command.isEnabled(context))
  ) {
    return false;
  }
  void command.execute(context);
  return true;
}
