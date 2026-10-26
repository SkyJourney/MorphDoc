const path = require("node:path");
const { version } = require("./package.json");
const brand = require("../../product.json");
const pandocRuntime = require(
  "../../packages/docx-engine/src/pandoc-runtime.json"
);

const windowsIcon = path.resolve(
  __dirname,
  "../../logos/desktop/windows/app.ico"
);
const macIcon = path.resolve(
  __dirname,
  "../../logos/desktop/macos/app.icns"
);
const nsisInclude = process.env.MORPHDOC_NSIS_INCLUDE?.trim() ||
  "build/installer.nsh";

// macOS 每次只构建一个架构的 dmg（arm64 或 x64），不产出 universal 包——
// 项目内置完整 Chromium/Electron 运行时和固定版本 Pandoc，合并双架构会让单个
// 安装包体积翻倍。目标架构通过环境变量显式声明，用于挑选对应的内置 Pandoc
// 资源目录；不依赖 electron-builder 的 `${arch}` 路径宏（该宏在 extraResources
// 场景下有已知的可靠性问题）。
const macTargetArch = process.env.MORPHDOC_MAC_TARGET_ARCH?.trim() || "";
if (macTargetArch && macTargetArch !== "arm64" && macTargetArch !== "x64") {
  throw new Error(
    `未知 macOS 目标架构：${macTargetArch}（仅支持 arm64 或 x64）`
  );
}

module.exports = {
  appId: brand.appId,
  productName: brand.englishName,
  copyright: "Copyright © YIXIONG Tech.ltd",
  asar: true,
  electronLanguages: ["zh-CN", "en-US"],
  directories: {
    output: `out/v${version}`
  },
  files: [
    "dist/**/*",
    "package.json"
  ],
  extraResources: [
    {
      from: "../web/dist",
      to: "dist",
      filter: ["**/*"]
    },
    {
      from: "../../themes",
      to: "themes",
      filter: ["**/*"]
    },
    {
      from: "../../samples",
      to: "samples",
      filter: ["**/*"]
    },
    {
      from: "../../output/font-packs/root",
      to: "font-packs",
      filter: ["**/*"]
    },
    {
      from: windowsIcon,
      to: "app.ico"
    },
    {
      from: macIcon,
      to: "app.icns"
    }
  ],
  win: {
    target: [
      {
        target: "nsis",
        arch: ["x64"]
      },
      {
        target: "zip",
        arch: ["x64"]
      }
    ],
    icon: windowsIcon,
    executableName: brand.executableName,
    artifactName: `${brand.artifactPrefix}-${version}-x86_64.\${ext}`,
    extraResources: [
      {
        from: `.runtime/pandoc/${pandocRuntime.version}/windows-x86_64`,
        to: `pandoc/${pandocRuntime.version}/windows-x86_64`,
        filter: [
          "pandoc.exe",
          "COPYING.rtf",
          "COPYRIGHT.txt",
          "runtime-manifest.json"
        ]
      }
    ]
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    allowElevation: true,
    createDesktopShortcut: false,
    createStartMenuShortcut: false,
    shortcutName: brand.displayName,
    uninstallDisplayName: brand.displayName,
    installerIcon: windowsIcon,
    uninstallerIcon: windowsIcon,
    installerLanguages: ["zh_CN"],
    include: nsisInclude,
    artifactName: `${brand.artifactPrefix}-${version}-x86_64-Setup.\${ext}`
  },
  mac: {
    category: "public.app-category.productivity",
    icon: macIcon,
    executableName: brand.executableName,
    // 项目当前没有 Apple Developer 证书，显式声明不签名，与 Windows 侧
    // 一贯记录在案的"未签名"状态保持一致；后续如需公证再补齐。
    identity: null,
    target: [
      {
        target: "dmg"
      }
    ],
    extraResources: macTargetArch
      ? [
          {
            from: `.runtime/pandoc/${pandocRuntime.version}/darwin-${macTargetArch}`,
            to: `pandoc/${pandocRuntime.version}/darwin-${macTargetArch}`,
            filter: [
              "pandoc",
              "COPYING.md",
              "COPYRIGHT",
              "runtime-manifest.json"
            ]
          }
        ]
      : []
  },
  dmg: {
    title: brand.displayName,
    artifactName: `${brand.artifactPrefix}-${version}-\${arch}.\${ext}`
  }
};
