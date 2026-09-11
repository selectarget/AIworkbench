# AI 创作工作台：Mac 重建源码

本目录是从 `D:\GitProject\test` 和 `D:\GitProject\test\analysis` 整理出的独立副本。功能对照已切到 **V5.2**（2026-09-05），差量见 [`V52_DELTA.md`](V52_DELTA.md)；反编译材料在 `reference/v52/`，不进入构建。原始 EXE、分析目录和现有工程均未修改。

## 当前迁移状态

这是可运行的 Electron 跨平台重建基线，不应标记为“原软件全部功能已经 1:1 验收完成”。当前 Windows x64 的本地工程、账号隔离、代理运行时、迁移导入、素材队列和 GUI 已有自动化证据；macOS 真机打包/签名/启动，以及真实账号登录和站点版本兼容仍需在对应环境验收。逐项结论见 [`FUNCTION_MATRIX.md`](FUNCTION_MATRIX.md)。

最近一次本机回归基线：36 个测试文件、267 个单元/集成测试通过；新增覆盖 Dola 备用解析按账号 Session 使用平台匹配的 User-Agent（并去除 Electron 标识）、紧凑 SSE、NDJSON、有界嵌套 JSON 响应中的媒体资源解析、素材候选地址标注/选择，以及 HTTP 200 错误页和流中断后的候选回退/失败记录。插件导入回归还覆盖 CRX2/CRX3 头部剥离后加载 Manifest V3；远程媒体、视频提醒和 Dola 令牌三条事件链现在统一尊重平台适配器禁用设置。下载队列还会登记程序化下载 URL，并在旧版兼容窗口内取消同 URL 的重复 Chromium 原生下载；已打开的素材库会在普通文件或媒体任务完成后自动防抖刷新。通用捕获还覆盖响应式 `srcset`、`<picture><source>`、受限 CSS 背景图和媒体类型优先级；sandboxed remote preload 也有独立兜底 smoke，验证页面脚本缺席时仍能安全捕获可见图片、响应式来源、CSS 背景和 `<video><source>`，并拒绝空地址回退为当前页面 URL；GUI 预览验证了普通文件下载完成通知、候选地址详情弹窗、失败候选状态，以及账号卡片/标签页“新视频”提醒，并补回旧 V4.4 的固定 HTTPS“作者店铺”入口。旧版 API 表面审计 59 项（44 项已映射、12 项内部实现、3 项明确移除）；外部登录新增平台无关的目标站点 Cookie 登录态轮询，Dola/Higgsfield 在人工完成验证码、2FA 或 Passkey 后可自动检测并同步；旧版代理订阅转换新增 VMess WebSocket/gRPC/HTTP-H2、TLS SNI/证书校验/ALPN/客户端指纹，以及 hysteria2 带宽和混淆参数保留；同时限制订阅大小并拒绝不严格的 Base64 输入。媒体资源入口（包括 Dola 页面桥）现在还共享安全 URL 归一化，兼容旧版 JSON/HTML 中的转义斜杠、Unicode 转义、外层引号和 HTML 实体，并在主进程去重与下载前统一校验协议。Windows x64 目录包和 portable 包已完成本机启动与原生资源审计；portable 最新大小为 195,931,887 字节，SHA-256 为 `C825BA3EB3DA72B561B2368555272CBEBF506A4BF0FA8FECC24E4C8D0832D86F`。10 个真实公开平台入口也已在 Electron `WebContentsView` 中逐一通过公开页面导航/适配器注入检查，但不代表真实登录、任务、下载权限或 macOS 已完成。

## 目录

- [`ARCHITECTURE.md`](ARCHITECTURE.md)：全面技术架构分析、数据隔离说明、V4.4 对照、跨平台边界、测试策略和迁移路线图。
- [`FINAL_ACCEPTANCE.md`](FINAL_ACCEPTANCE.md)：当前回归证据、已完成范围、未完成验收项和 macOS/真实站点执行入口。
- `app/`：Mac 版本的主要开发工程。基于 Electron + React + TypeScript，使用本地账号会话、浏览器视图、代理、素材捕获和下载库；应用级卡密/激活流程不在此工程中。
- `reference-original/electron-source/`：旧版 Electron/JavaScript 的完整恢复材料，保留原始结构，仅作功能对照，不直接作为 Mac 构建入口。
- `reference-original/v44-dotnet/`：V4.4 `DolaMultiBrowser.dll` 的 ILSpy 项目级反编译结果。
- `reference-original/v44-dotnet-helpers/`：V4.4 辅助程序集的反编译结果。
- `reference-original/v44-launcher/`：外层启动器的反编译结果；其中未复制 187 MB 的内置 payload 二进制。

## 构建与验证

在 `app/` 目录执行：

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run smoke:task-workflows
npm run smoke:all
```

`smoke:all` 会串联本地隔离、会话重启、指纹、代理、素材解析、任务工作流、GUI、打包资源和公开入口检查；其中真实第三方登录、macOS 构建以及需要站点账号权限的流程不会被夹具测试冒充为已完成。

Mac 打包建议在 macOS 主机执行。仓库根目录的 `.github/workflows/release-macos.yml` 提供 x64（macos-13）和 arm64（macos-14）的独立构建、签名、公证、DMG 验证和发布流程；本地执行时在 `package.json` 中配置 `electron-builder` 的 `mac` 目标、签名和公证信息。当前 `app/` 是跨平台 Electron 基线，Windows 专属 WPF/WebView2/Win32 代码没有作为 Mac 运行时依赖引入。

生成 macOS `.app` 或 DMG 后，可在 `app/` 中执行 `npm run verify:mac-release -- <app路径> <x64|arm64> --dmg <dmg路径>`，检查 Bundle、原生资源架构/权限和哈希；正式签名验收可追加 `--signed`。

## 恢复边界

反编译结果可以恢复主要逻辑，但无法恢复原始注释、变量名、构建环境和完整 Git 历史。WPF、WebView2、注册表、Win32 热键以及 Windows 外壳需要在 Mac 端以 Electron/Chromium 或原生 macOS API 重写。
