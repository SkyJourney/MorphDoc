import { DOCX_PANDOC_VERSION } from "@morphdoc/core";
import runtimeManifest from "./pandoc-runtime.json" with { type: "json" };

export interface PandocRuntimeArtifact {
  platform: "win32" | "linux" | "darwin";
  architecture: "x64" | "arm64";
  archiveType: "zip" | "tar.gz";
  downloadUrl: string;
  sha256: string;
  executableRelativePath: string;
  licenseFiles: readonly string[];
  /**
   * 部分平台的官方归档不随附许可证文件（如 macOS zip），需要单独声明
   * 每个许可证文件的独立下载来源；缺省时许可证文件从归档内部提取。
   */
  licenseSource?: Readonly<Record<string, { downloadUrl: string }>>;
  files?: Readonly<
    Record<string, { bytes: number; sha256: string }>
  >;
}

if (runtimeManifest.version !== DOCX_PANDOC_VERSION) {
  throw new Error(
    `Pandoc 运行时清单版本 ${runtimeManifest.version} 与 DOCX 协议版本 ${DOCX_PANDOC_VERSION} 不一致`
  );
}

export const pandocRuntimeManifest = runtimeManifest as Omit<
  typeof runtimeManifest,
  "artifacts"
> & {
  artifacts: readonly PandocRuntimeArtifact[];
};

export function findPandocRuntimeArtifact(
  platform: NodeJS.Platform,
  architecture: string
) {
  return pandocRuntimeManifest.artifacts.find(
    (artifact) =>
      artifact.platform === platform &&
      artifact.architecture === architecture
  );
}
