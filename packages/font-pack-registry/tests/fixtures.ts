import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function hash(content: Uint8Array | string) {
  return createHash("sha256").update(content).digest("hex");
}

export async function writeFontPack(
  root: string,
  options: {
    id?: string;
    version?: string;
    minimumAppVersion?: string;
    maximumAppVersionExclusive?: string;
    target?: string;
    web?: Uint8Array;
    docx?: Uint8Array;
    corruptWebHash?: boolean;
  } = {}
) {
  const id = options.id ?? "official-cjk";
  const version = options.version ?? "1.0.0";
  const directory = join(root, id, version);
  const web = options.web ?? new Uint8Array([1, 2, 3]);
  const docx = options.docx ?? new Uint8Array([4, 5, 6, 7]);
  const license = "SIL Open Font License 1.1";
  await mkdir(join(directory, "fonts"), { recursive: true });
  await writeFile(join(directory, "fonts", "serif.woff2"), web);
  await writeFile(join(directory, "fonts", "serif.ttf"), docx);
  await writeFile(join(directory, "OFL.txt"), license, "utf8");
  const maximum = options.maximumAppVersionExclusive
    ? { maximumAppVersionExclusive: options.maximumAppVersionExclusive }
    : {};
  await writeFile(
    join(directory, "font-pack.json"),
    JSON.stringify({
      manifestVersion: 1,
      id,
      version,
      name: "原生中文字体包",
      description: "测试字体包",
      license: "OFL-1.1",
      licenseFile: "OFL.txt",
      licenseSha256: hash(license),
      licenseBytes: Buffer.byteLength(license),
      compatibility: {
        minimumAppVersion: options.minimumAppVersion ?? "0.6.0",
        ...maximum
      },
      faces: [
        {
          id: "serif-regular",
          targets: [options.target ?? "MorphDoc Fandol Song", "FandolSong"],
          weight: 400,
          style: "normal",
          web: {
            path: "fonts/serif.woff2",
            format: "woff2",
            bytes: web.byteLength,
            sha256: options.corruptWebHash ? "0".repeat(64) : hash(web)
          },
          docx: {
            path: "fonts/serif.ttf",
            format: "truetype",
            bytes: docx.byteLength,
            sha256: hash(docx)
          }
        }
      ]
    }),
    "utf8"
  );
  return directory;
}
