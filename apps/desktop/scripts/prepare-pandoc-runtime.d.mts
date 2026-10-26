export interface MinimalPandocArtifact {
  executableRelativePath: string;
  licenseFiles: string[];
}

export function sha256(content: Uint8Array): string;

export function extractRequiredFiles(
  archive: Uint8Array,
  artifact: MinimalPandocArtifact
): Map<string, Uint8Array>;

export function verifyPandocVersion(
  executablePath: string,
  expectedVersion: string
): void;

export function preparePandocRuntime(options?: {
  checkOnly?: boolean;
}): Promise<string>;
