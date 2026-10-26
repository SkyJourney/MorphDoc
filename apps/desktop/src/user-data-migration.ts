import { cp, lstat, mkdir } from "node:fs/promises";
import path from "node:path";

const MIGRATED_ENTRIES = [
  "window-state.json",
  "save-location.json",
  "themes",
  "Local Storage",
  "Session Storage",
  "IndexedDB"
] as const;

async function readOrdinaryStatus(target: string) {
  try {
    const status = await lstat(target);
    return status.isSymbolicLink() ? undefined : status;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export interface LegacyUserDataMigrationResult {
  migrated: boolean;
  sourceDirectory?: string;
  copiedEntries: string[];
}

export async function migrateLegacyUserData(
  legacyDirectories: readonly string[],
  targetDirectory: string
): Promise<LegacyUserDataMigrationResult> {
  if (await readOrdinaryStatus(targetDirectory)) {
    return { migrated: false, copiedEntries: [] };
  }

  for (const legacyDirectory of legacyDirectories) {
    if (path.resolve(legacyDirectory) === path.resolve(targetDirectory)) {
      continue;
    }
    const legacyStatus = await readOrdinaryStatus(legacyDirectory);
    if (!legacyStatus?.isDirectory()) {
      continue;
    }

    await mkdir(targetDirectory, { recursive: true });
    const copiedEntries: string[] = [];
    for (const entry of MIGRATED_ENTRIES) {
      const source = path.join(legacyDirectory, entry);
      if (!(await readOrdinaryStatus(source))) {
        continue;
      }
      await cp(source, path.join(targetDirectory, entry), {
        recursive: true,
        errorOnExist: true,
        force: false
      });
      copiedEntries.push(entry);
    }
    return {
      migrated: true,
      sourceDirectory: legacyDirectory,
      copiedEntries
    };
  }

  return { migrated: false, copiedEntries: [] };
}
