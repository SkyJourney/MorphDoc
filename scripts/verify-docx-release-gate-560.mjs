process.stderr.write(
  "verify-docx-release-gate-560 已改为兼容入口：每次只执行下一套独立 140，不再启动整批 560。\n"
);
await import("./verify-docx-release-gate-suite.mjs");
