import path from "node:path";
import { writeFile } from "node:fs/promises";

export function resolveDesktopDocxTargetPath(selectedPath: string) {
  return selectedPath.toLowerCase().endsWith(".docx")
    ? selectedPath
    : `${selectedPath}.docx`;
}

export async function saveDesktopDocx(
  selectedPath: string,
  content: Uint8Array
) {
  if (!selectedPath || content.byteLength === 0) {
    throw new Error("DOCX 保存参数无效");
  }
  const targetPath = resolveDesktopDocxTargetPath(selectedPath);
  await writeFile(targetPath, content);
  return {
    targetPath,
    fileName: path.basename(targetPath)
  };
}
