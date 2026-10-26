export type DocumentShortcut =
  | "new"
  | "save"
  | "save-as"
  | "close";

export interface DocumentShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
  repeat: boolean;
}

export function getDocumentShortcut(
  event: DocumentShortcutEvent,
  desktop: boolean
): DocumentShortcut | undefined {
  if (
    event.isComposing ||
    event.repeat ||
    event.altKey ||
    (!event.ctrlKey && !event.metaKey)
  ) {
    return undefined;
  }

  const key = event.key.toLowerCase();
  if (event.shiftKey) {
    return desktop && key === "s" ? "save-as" : undefined;
  }

  switch (key) {
    case "s":
      return "save";
    case "n":
      return desktop ? "new" : undefined;
    case "w":
      return desktop ? "close" : undefined;
    default:
      return undefined;
  }
}
