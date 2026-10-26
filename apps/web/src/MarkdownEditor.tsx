import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef
} from "react";
import CodeMirror, {
  type ReactCodeMirrorRef
} from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import {
  EditorView,
  keymap,
  type KeyBinding
} from "@codemirror/view";
import {
  executeMarkdownEditorCommand,
  markdownEditorCommands
} from "./markdown-editor-commands";

export interface MarkdownEditorHandle {
  focus: () => void;
  getScrollElement: () => HTMLElement | null;
  getView: () => EditorView | null;
}

interface MarkdownEditorProps {
  value: string;
  documentVersion: number;
  onChange: (value: string) => void;
  onEditorReady?: (view: EditorView | null) => void;
  onScroll?: () => void;
}

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "#f6f7f5",
    color: "#26312d",
    fontSize: "0.86rem"
  },
  "&.cm-focused": {
    outline: "none",
    boxShadow: "inset 3px 0 #74a88f"
  },
  ".cm-scroller": {
    fontFamily:
      '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
    lineHeight: "1.72",
    tabSize: "2",
    overflow: "auto"
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "24px"
  },
  ".cm-line": {
    padding: "0"
  },
  ".cm-gutters": {
    border: "0",
    backgroundColor: "#eef1ef",
    color: "#8a9690"
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "rgb(116 168 143 / 9%)"
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgb(89 135 113 / 24%)"
  }
});

export const MarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  MarkdownEditorProps
>(function MarkdownEditor(
  {
    value,
    documentVersion,
    onChange,
    onEditorReady,
    onScroll
  },
  forwardedRef
) {
  const codeMirrorRef = useRef<ReactCodeMirrorRef>(null);
  const viewRef = useRef<EditorView | null>(null);
  const shortcutBindings = useMemo(
    () =>
      markdownEditorCommands.flatMap<KeyBinding>((command) =>
        command.shortcut
          ? [
              {
                key: command.shortcut,
                run: (view) =>
                  executeMarkdownEditorCommand(command.id, { view })
              }
            ]
          : []
      ),
    []
  );
  const extensions = useMemo(
    () => [markdown(), keymap.of(shortcutBindings)],
    [shortcutBindings]
  );

  useImperativeHandle(
    forwardedRef,
    () => ({
      focus: () => viewRef.current?.focus(),
      getScrollElement: () => viewRef.current?.scrollDOM ?? null,
      getView: () => viewRef.current
    }),
    []
  );

  useEffect(
    () => () => {
      onEditorReady?.(null);
      viewRef.current = null;
    },
    [documentVersion, onEditorReady]
  );

  return (
    <div
      className="markdown-editor"
      onScrollCapture={onScroll}
    >
      <CodeMirror
        key={documentVersion}
        ref={codeMirrorRef}
        value={value}
        height="100%"
        basicSetup={{
          autocompletion: false,
          bracketMatching: true,
          closeBrackets: true,
          foldGutter: false,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          lineNumbers: true,
          searchKeymap: true
        }}
        extensions={extensions}
        theme={editorTheme}
        aria-label="Markdown 内容"
        onChange={onChange}
        onCreateEditor={(view) => {
          viewRef.current = view;
          onEditorReady?.(view);
        }}
      />
    </div>
  );
});
