# macOS 构建与验收清单

适用目录：`D:\GitProject\test\mac-source-rebuilt\app`。当前工程只生成 macOS x64 和 arm64 两个独立包，不生成 Universal 包。

## 构建机准备

- 使用对应架构的 macOS 真机或 CI runner，安装 Xcode Command Line Tools、Node.js 和 npm。
- 在 `app/` 执行 `npm ci`，再执行 `npm run typecheck` 和 `npm test -- --run`。
- 确认 `sing-box/native-resources.json` 中的 darwin-x64/darwin-arm64 文件存在、SHA-256 正确；`prepare-native-resources.mjs` 会重新设置可执行权限。
- 视频兼容预览的静态 FFmpeg 已随工程提供：`media-tools/darwin-x64/ffmpeg` 和 `media-tools/darwin-arm64/ffmpeg`。`prepare-media-resources.mjs` 会校验固定版本和 SHA-256，缺失时从固定发布地址补齐；设置路径和系统 `PATH` 仍保留为兜底。
- FFmpeg 使用 GPL 构建时，随发布物保留 `media-tools/licenses/ffmpeg-gpl.txt`，同时提供与实际二进制版本对应的源代码获取方式和再分发说明。

## 构建命令

```bash
cd /path/to/mac-source-rebuilt/app
npm ci
npm run typecheck
npm test -- --run
npm run build
npm run pack:mac
npm run dist:mac:unsigned   # 仅生成未签名 DMG，供 CI/安装测试
```

`pack:mac` 会校验两个 sing-box 核心并生成目录包。准备正式 DMG 前设置签名身份后执行：

```bash
export CSC_NAME="Developer ID Application: Example (TEAMID)"
npm run dist:mac
```

不应在 Windows 上伪造 macOS 构建结果；当前 Windows 主机只能完成源码构建和资源校验，不能替代 macOS DMG、签名、公证和 Gatekeeper 验收。

当前已在 Windows 完成 darwin-x64/arm64 sing-box 与 FFmpeg 文件的 Mach-O 架构、大小和 SHA-256 校验；没有把这项校验当作 macOS 包已构建或已启动的证据。

仓库根目录的 `.github/workflows/build-macos.yml` 会在 macOS runner 上执行类型检查、单元测试、`pack:mac`、`dist:mac:unsigned`，并按 `.app` 主程序架构运行 `audit-package.mjs`；该 workflow 上传未签名目录包和 DMG，不替代正式签名、公证和 Gatekeeper 验收。

## 安装后冒烟

1. 在 Intel Mac 和 Apple Silicon Mac 分别安装对应 DMG，确认应用启动不依赖 .NET、WebView2 或外部 Chrome。安装后的账号配置、Session、日志和下载数据应位于 `~/Library/Application Support/AI创作工作台/data/`，不能写入只读的 `.app/Contents`；设置中选择的浏览器数据目录需在重启后生效，且不能位于 `.app` 包内。Windows 安装版同样应使用用户 AppData，而 Windows 便携版才使用程序旁的 `data/`。
   构建前可运行 `npm run smoke:isolation` 和 `npm run smoke:video-notice`；前者验证 Chromium Session 分区，后者验证 Dola 视频生成提醒的页面桥和 IPC 去重，两者都不需要真实登录态。
2. 创建账号 A/B，分别打开站点，写入不同 Cookie、LocalStorage 和 IndexedDB，关闭并重启后确认状态互不可见且分别恢复。
3. 为 A/B 设置不同直连代理或订阅节点，验证每个账号的 Session、回环端口、认证和 sing-box 进程互不串用；模拟 sing-box 退出时确认不会自动降级直连。
4. 在设置中检测 FFmpeg；对一个已捕获视频执行“转为 MP4 兼容播放”，确认原文件不变、`.part` 文件被清理、输出可播放。
5. 使用人脸网格工具分别执行“网格”和“脸部重组”，确认模型加载、旋转图片检测、保存路径和中文文件名正常。
6. 逐站人工冒烟：豆包、Dola、千问、云雀、Higgsfield、即梦，以及当前平台列表中的其他站点。记录登录、媒体捕获、下载、15/30 秒任务和页面改版情况。
7. 验证 Boss Key、Command 快捷键、文件选择、下载目录、系统打开/定位、辅助功能权限提示以及应用退出时的子进程回收；macOS 还要关闭主窗口后重新点击 Dock 图标，确认工作台能重新创建且不会复用已销毁的 View、登录辅助浏览器或 sing-box 进程。

## 签名、公证与升级

- 使用 `codesign --verify --deep --strict` 检查 `.app`，确认主程序、sing-box 和 FFmpeg 均被正确签名或按发布策略排除并说明原因。
- 使用 `spctl --assess --type execute` 在干净系统检查 Gatekeeper。
- 用 `xcrun notarytool submit ... --wait` 完成公证，并使用 `stapler` 检查票据。
- 在没有 Node.js、.NET、Homebrew 和开发目录的干净系统安装测试；系统仅应要求 macOS 自身权限和应用声明的网络/文件访问权限。
- 分别记录 x64、arm64 的 DMG SHA-256、版本号、sing-box/FFmpeg 版本和已知站点兼容性，不把一次真实站点登录结果当作永久保证。
