import { resolve } from "node:path";
import { buildFontPackArchive } from "./archive.js";
import { buildFontPack, verifyFontPack } from "./builder.js";
import { buildWindowsFontPackInstaller } from "./windows-installer.js";

function argumentsMap(values: string[]) {
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`无效命令参数：${key ?? ""}`);
    }
    result.set(key.slice(2), value);
  }
  return result;
}

function option(
  values: Map<string, string>,
  name: string,
  fallback?: string
) {
  const value = values.get(name) ?? fallback;
  if (!value) {
    throw new Error(`缺少参数 --${name}`);
  }
  return value;
}

async function main() {
  const command = process.argv[2];
  const values = argumentsMap(process.argv.slice(3));
  if (command === "build") {
    return buildFontPack({
      recipePath: resolve(
        option(
          values,
          "recipe",
          "font-packs/recipes/morphdoc-serif-sc/recipe.json"
        )
      ),
      sourceRoot: resolve(
        option(
          values,
          "source-root",
          "font-packs/assets/morphdoc-serif-sc/1.0.0"
        )
      ),
      outputRoot: resolve(
        option(values, "output-root", "output/font-packs/root")
      ),
      reportPath: resolve(
        option(values, "report", "output/font-packs/build-report.json")
      )
    });
  }
  if (command === "verify") {
    return verifyFontPack({
      root: resolve(option(values, "root", "output/font-packs/root")),
      appVersion: option(values, "app-version", "0.6.0"),
      packId: option(values, "pack-id", "morphdoc-serif-sc"),
      packVersion: option(values, "pack-version", "1.0.0")
    });
  }
  if (command === "windows-installer") {
    return buildWindowsFontPackInstaller({
      packRoot: resolve(option(values, "root", "output/font-packs/root")),
      appVersion: option(values, "app-version", "0.6.0"),
      packId: option(values, "pack-id", "morphdoc-serif-sc"),
      packVersion: option(values, "pack-version", "1.0.0"),
      scriptPath: resolve(
        option(values, "script", "font-packs/windows/font-pack-installer.nsi")
      ),
      outputDirectory: resolve(
        option(values, "output", "output/font-packs/windows")
      ),
      iconPath: resolve(
        option(values, "icon", "logos/desktop/windows/app.ico")
      ),
      reportPath: resolve(
        option(
          values,
          "report",
          "output/font-packs/windows-installer-report.json"
        )
      )
    });
  }
  if (command === "archive") {
    return buildFontPackArchive({
      packRoot: resolve(option(values, "root", "output/font-packs/root")),
      appVersion: option(values, "app-version", "0.6.0"),
      packId: option(values, "pack-id", "morphdoc-serif-sc"),
      packVersion: option(values, "pack-version", "1.0.0"),
      outputDirectory: resolve(
        option(values, "output", "output/font-packs/release")
      ),
      reportPath: resolve(
        option(
          values,
          "report",
          "output/font-packs/archive-report.json"
        )
      )
    });
  }
  throw new Error("命令必须是 build、verify、archive 或 windows-installer");
}

main()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
