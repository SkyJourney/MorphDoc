import { buildApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const host = process.env.HOST ?? "0.0.0.0";
const fontPackRoot = process.env.FONT_PACK_ROOT?.trim();
const app = buildApp({
  prewarmPdfBrowser: true,
  prewarmDocxRuntime: true,
  ...(fontPackRoot
    ? {
        fontPacks: {
          roots: [fontPackRoot],
          appVersion: process.env.APP_VERSION ?? "0.6.4"
        }
      }
    : {})
});

async function start() {
  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

void start();
