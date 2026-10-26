import { build } from "esbuild";
import { copyFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const productBrand = JSON.parse(
  await readFile(
    fileURLToPath(new URL("../../../product.json", import.meta.url)),
    "utf8"
  )
);

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["electron"],
  outfile: "dist/main.js",
  define: {
    __APP_ID__: JSON.stringify(productBrand.appId),
    __APP_ENGLISH_NAME__: JSON.stringify(productBrand.englishName),
    __APP_DISPLAY_NAME__: JSON.stringify(productBrand.displayName),
    __APP_WINDOW_TITLE__: JSON.stringify(productBrand.windowTitle),
    __APP_LEGACY_DISPLAY_NAME__: JSON.stringify(
      productBrand.legacyDisplayName
    )
  },
  banner: {
    js: [
      'import { createRequire as __morphDocCreateRequire } from "node:module";',
      'import { dirname as __morphDocDirname } from "node:path";',
      'import { fileURLToPath as __morphDocFileURLToPath } from "node:url";',
      "const require = __morphDocCreateRequire(import.meta.url);",
      "const __dirname = __morphDocDirname(__morphDocFileURLToPath(import.meta.url));"
    ].join("\n")
  }
});

await copyFile(
  fileURLToPath(
    new URL(
      "../../../packages/docx-engine/assets/docx-media-filter.lua",
      import.meta.url
    )
  ),
  fileURLToPath(
    new URL("../dist/docx-media-filter.lua", import.meta.url)
  )
);
