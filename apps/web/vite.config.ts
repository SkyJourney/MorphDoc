import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const rootPackage = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../package.json", import.meta.url)),
    "utf8"
  )
) as { version: string };
const productBrand = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../product.json", import.meta.url)),
    "utf8"
  )
) as {
  displayName: string;
  windowTitle: string;
  slogan: string;
  description: string;
};

export default defineConfig({
  plugins: [react()],
  publicDir: fileURLToPath(
    new URL("../../logos/web", import.meta.url)
  ),
  define: {
    __APP_VERSION__: JSON.stringify(rootPackage.version),
    __APP_DISPLAY_NAME__: JSON.stringify(productBrand.displayName),
    __APP_WINDOW_TITLE__: JSON.stringify(productBrand.windowTitle),
    __APP_SLOGAN__: JSON.stringify(productBrand.slogan),
    __APP_DESCRIPTION__: JSON.stringify(productBrand.description)
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        previewFrame: fileURLToPath(
          new URL("./preview-frame.html", import.meta.url)
        )
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001"
    }
  }
});
