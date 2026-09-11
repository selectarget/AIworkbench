# AI 创作工作台跨平台开发基线

> 当前校准（2026-08-28）：源码回归为 36 个测试文件、267/267 项通过；Windows x64 portable 已重新封装，大小 195,931,887 字节，SHA-256 为 `C825BA3EB3DA72B561B2368555272CBEBF506A4BF0FA8FECC24E4C8D0832D86F`，并通过包审计、原生资源校验和 6 秒启动 smoke；GUI smoke 还确认 Dola 批量登录弹窗无横向溢出，Dola 页面桥的编码媒体地址已进入统一媒体消息链路，发布配置回归确认 macOS x64/arm64 签名发布步骤完整。

> 本轮界面与下载对齐回归：36 个测试文件、273/273 项通过；另有 1080/1440 GUI smoke 和原生 WebContentsView 遮挡 smoke。

这是 Electron + React + TypeScript 的跨平台重建工程，目标平台为 Windows x64、macOS Intel 和 macOS Apple Silicon。终端用户不需要安装 .NET；Electron 会携带 Chromium 和 Node.js 运行时。应用级卡密、激活码、机器绑定和到期校验不属于本工程的启动链路；账号登录仍由各目标网站自己的登录流程处理。

完整的技术架构、数据隔离、V4.4 对照和迁移路线请先阅读：[`../ARCHITECTURE.md`](../ARCHITECTURE.md)。

## 开发与验证

```bash
npm ci
npm run dev
npm run typecheck
npm test
npm run build
```

Windows x64 目录包和便携包：

```bash
npm run pack:win
npm run audit:package -- release/win-unpacked
npm run dist:win
```

macOS 必须在 macOS 主机上分别构建 x64 与 arm64：

```bash
npm run pack:mac
npm run dist:mac
```

正式签名/公证发布可手动触发 `.github/workflows/release-macos.yml`。仓库需要配置 `MACOS_CERTIFICATE_P12_BASE64`、`MACOS_CERTIFICATE_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD` 和 `APPLE_TEAM_ID`；工作流会按 x64/arm64 分别构建、签名、公证、审计、启动验证并可发布到 GitHub Release。没有这些密钥时仍可使用 `build-macos.yml` 生成未签名验收包。

CI 或本地只需要验证未签名 DMG 时可执行 `npm run dist:mac:unsigned`；它不会伪造签名，也不要求发布仓库配置。生成 `.app` 和 DMG 后，可在 macOS 上用 `npm run verify:mac-release -- <app路径> <x64|arm64> --dmg <dmg路径>` 检查 Bundle、Info.plist、图标、主程序执行权限、原生核心/FFmpeg 架构与 SHA-256；正式签名发布可追加 `--signed`，再使用 `npm run dist:mac` 配置签名、公证和公开更新所需环境。

启用订阅代理前，工程已随附官方 sing-box v1.13.19 的 Windows x64、macOS Intel 和 macOS Apple Silicon 核心，分别位于 `sing-box/win32-x64/`、`sing-box/darwin-x64/` 和 `sing-box/darwin-arm64/`；`native-resources.json` 固定来源与 SHA-256，发布脚本会继续检查文件、架构目录、大小和 macOS 可执行权限。正式发布前仍需在对应平台验证签名、公证和运行时行为。

视频兼容预览所需的 FFmpeg 也随工程提供 Windows x64、macOS Intel 和 macOS Apple Silicon 版本；`scripts/prepare-media-resources.mjs` 会固定版本、校验 SHA-256 和目标架构，缺失时自动补齐。发布物需保留 `media-tools/licenses/ffmpeg-gpl.txt` 及对应再分发说明。

`pack:*` 用于开发目录包，但也会校验所选平台的 sing-box 核心；`dist:*` 是发布流程，会额外检查发布环境。macOS 签名、公证、权限弹窗和真实站点冒烟测试必须在对应 Mac 环境完成。

需要在已有人工登录态上做真实站点验收时，可显式指定工作台的 Session 根目录和账号 ID。该 smoke 不接收或保存密码，不复制 Cookie，也不会自动处理验证码、2FA 或 Passkey；省略 `--user-data` 时只使用临时 Session：

```bash
npm run smoke:real-sites -- --platform dola --account-id <账号ID> --user-data <Electron Session根目录> --show
```

`--expect-capture` 可要求等待期间至少捕获一条媒体消息，`--require-auth` 只提供启发式登录门控检查。真实站点 smoke 不会替代人工完成第三方登录、任务提交和下载验收。

如只想检查公开入口、适配器注入和临时 Session，可运行 `npm run smoke:real-sites:public`。它会依次检查 10 个公开平台页面，不读取真实登录目录，也不接收密码；该命令是外部网络验收，不纳入默认 `smoke:all`。

如果本机保留旧版 V4.4 配置，可运行 `npm run smoke:legacy-config -- --source "C:\\Users\\<用户名>\\AppData\\Local\\DolaMultiBrowser\\config.json"` 做只读迁移预览验收；追加 `--sandbox-import` 会把导入目标放到临时目录和内存服务中，验证实际 schema 导入与备份生成，但仍不改写原配置/账号目录。命令只输出账号/平台/指纹/代理和旧设置的计数，不复制 WebView2 数据库，也不输出 Cookie 或密码。

数据使用 Electron 的用户数据目录和应用配置目录，账号会话按 `persist:account_<id>` 隔离。Windows 便携包默认将 `data/` 放在程序目录旁；macOS 放在用户的 `~/Library/Application Support/AI创作工作台/data/`，不会写入 `.app` 包。Cookie/LocalStorage/SessionStorage 可通过迁移向导导入；结构化导出文件中的 IndexedDB 会按 schema、记录和索引恢复。WebView2 加密数据库、未导出的 Service Worker 状态和站点私有缓存仍需要重新登录或重新生成。
