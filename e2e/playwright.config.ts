import { defineConfig, devices } from "@playwright/test";

const isCi = Boolean(process.env.CI);

/**
 * 端到端与视觉回归配置。
 *
 * 启动真实应用栈：Fastify 服务（渲染 API）+ `vite preview` 托管已构建的前端，
 * 后者通过 vite.config.ts 中已有的代理把 /api 转发到服务。运行前需要先构建：
 *   pnpm run build:web-runtime && pnpm --filter @morphdoc/server run build
 *
 * 视觉基线只在 Linux 上生成与比对：不同操作系统的字体栅格化不同，跨平台比较会持续
 * 误报。基线更新流程见 docs/WORKFLOW.md。
 */
export default defineConfig({
  testDir: "./tests",
  snapshotDir: "./__screenshots__",
  outputDir: "./test-results",
  // 分页计算较重，串行执行以保证结果稳定
  fullyParallel: false,
  workers: 1,
  // 不用重试掩盖不稳定：失败就应当暴露并修复
  retries: 0,
  forbidOnly: isCi,
  timeout: 90_000,
  reporter: isCi
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"]],
  expect: {
    toHaveScreenshot: {
      // 允许 1% 以内的像素差异，吸收抗锯齿级别的细微波动
      maxDiffPixelRatio: 0.01,
      animations: "disabled"
    }
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: "node apps/server/dist/index.js",
      cwd: "..",
      env: { PORT: "3001", HOST: "127.0.0.1" },
      url: "http://127.0.0.1:3001/api/health",
      reuseExistingServer: !isCi,
      timeout: 60_000
    },
    {
      command:
        "pnpm --filter @morphdoc/web exec vite preview --host 127.0.0.1 --port 5173 --strictPort",
      cwd: "..",
      url: "http://127.0.0.1:5173/",
      reuseExistingServer: !isCi,
      timeout: 60_000
    }
  ]
});
