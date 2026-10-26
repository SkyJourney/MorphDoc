import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";

const SAVE_LOCATION_STATE_VERSION = 1;

export interface SaveLocationState {
  version: 1;
  directory: string;
}

export interface ResolveDefaultSavePathOptions {
  sourceFilePath?: string;
  lastSaveDirectory?: string;
  documentsDirectory: string;
  suggestedFileName: string;
}

export function parseSaveLocationState(
  value: unknown
): SaveLocationState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const state = value as Partial<SaveLocationState>;
  if (
    state.version !== SAVE_LOCATION_STATE_VERSION ||
    typeof state.directory !== "string" ||
    !path.isAbsolute(state.directory)
  ) {
    return undefined;
  }
  return {
    version: SAVE_LOCATION_STATE_VERSION,
    directory: path.resolve(state.directory)
  };
}

async function isAvailableDirectory(directory: string | undefined) {
  if (!directory || !path.isAbsolute(directory)) {
    return false;
  }
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

function assertSuggestedFileName(value: string) {
  const fileName = path.basename(value.trim());
  if (!fileName || fileName === ".") {
    throw new Error("默认保存文件名无效");
  }
  return fileName;
}

export async function resolveDefaultSavePath(
  options: ResolveDefaultSavePathOptions
) {
  const fileName = assertSuggestedFileName(
    options.suggestedFileName
  );
  const sourceDirectory = options.sourceFilePath
    ? path.dirname(path.resolve(options.sourceFilePath))
    : undefined;
  if (await isAvailableDirectory(sourceDirectory)) {
    return path.join(sourceDirectory!, fileName);
  }
  if (await isAvailableDirectory(options.lastSaveDirectory)) {
    return path.join(options.lastSaveDirectory!, fileName);
  }
  return path.join(
    path.resolve(options.documentsDirectory),
    fileName
  );
}

export async function loadSaveLocationState(filePath: string) {
  try {
    return parseSaveLocationState(
      JSON.parse(await readFile(filePath, "utf8")) as unknown
    );
  } catch {
    return undefined;
  }
}

export async function saveSaveLocationState(
  filePath: string,
  directory: string
) {
  const state = parseSaveLocationState({
    version: SAVE_LOCATION_STATE_VERSION,
    directory
  });
  if (!state) {
    throw new Error("最近保存目录无效");
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8"
    );
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return state;
}

export class SaveLocationStore {
  readonly #statePath: string;
  readonly #documentsDirectory: string;
  #lastSaveDirectory: string | undefined;
  #pendingWrite = Promise.resolve();

  constructor(statePath: string, documentsDirectory: string) {
    this.#statePath = statePath;
    this.#documentsDirectory = documentsDirectory;
  }

  async initialize() {
    this.#lastSaveDirectory = (
      await loadSaveLocationState(this.#statePath)
    )?.directory;
  }

  resolveDefaultPath(
    sourceFilePath: string | undefined,
    suggestedFileName: string
  ) {
    return resolveDefaultSavePath({
      documentsDirectory: this.#documentsDirectory,
      suggestedFileName,
      ...(sourceFilePath ? { sourceFilePath } : {}),
      ...(this.#lastSaveDirectory
        ? { lastSaveDirectory: this.#lastSaveDirectory }
        : {})
    });
  }

  async recordSuccessfulFile(filePath: string) {
    const directory = path.dirname(path.resolve(filePath));
    this.#lastSaveDirectory = directory;
    const write = this.#pendingWrite
      .catch(() => undefined)
      .then(() =>
        saveSaveLocationState(this.#statePath, directory)
      );
    this.#pendingWrite = write.then(() => undefined);
    await write;
  }
}
