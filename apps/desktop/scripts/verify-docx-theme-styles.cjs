void import("./verify-docx-theme-styles.mjs").catch((error) => {
  console.error(error);
  process.exitCode = 1;
  const { app } = require("electron");
  if (app.isReady()) {
    app.quit();
  }
});
