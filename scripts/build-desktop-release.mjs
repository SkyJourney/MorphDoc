import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = join(repositoryRoot, "apps", "desktop");
const desktopManifest = JSON.parse(
  await readFile(join(desktopRoot, "package.json"), "utf8")
);
await new Promise((resolvePromise, reject) => {
  // Windows 下 pnpm 是 .cmd 包装脚本，需要经由 shell 启动；参数均为固定常量。
  const child = spawn(
    "pnpm",
    ["--filter", "@morphdoc/desktop", "run", "make"],
    {
      cwd: repositoryRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
      shell: process.platform === "win32"
    }
  );
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code === 0) {
      resolvePromise();
    } else {
      reject(
        new Error(
          `桌面安装器构建失败：${signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`}`
        )
      );
    }
  });
});

process.stdout.write(
  `已生成字体直接内置的主安装器与便携 ZIP：${join(desktopRoot, "out", `v${desktopManifest.version}`)}\n`
);
