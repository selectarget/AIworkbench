# AI 创作工作台技术架构分析与跨平台重建方案

> 文档状态：2026-08-28  
> 适用目录：`D:\GitProject\test\mac-source-rebuilt`  
> 目标：在不依赖原始 Git 历史的情况下，基于现有恢复材料重建 Windows/macOS 共用版本。

## 1. 结论摘要

最新校准（2026-08-28）：共享豆包扩展协同标记已加入，`maowang-doubao` 与 `doubao-download` 保留各自解析/回退职责，但同一图片卡片只允许一个可见下载操作；Dola 批量登录弹窗的校准区和账号操作区已改为可收缩/换行布局，GUI smoke 已断言弹窗和内容区无横向溢出；发布配置测试还锁定了 macOS x64/arm64 签名、公证、审计和启动步骤；插件导入回归新增 CRX2/CRX3 头部剥离与 Manifest V3 加载验证；平台适配器禁用设置现在统一覆盖普通媒体、视频提醒和 Dola 令牌事件入口；程序化下载 URL 与 Chromium `will-download` 的短窗口重复下载也由主进程统一拦截；已打开的素材库会在普通文件或媒体任务完成后自动防抖刷新；旧版代理订阅转换还原了 VMess WebSocket/gRPC/HTTP-H2、TLS SNI/证书校验/ALPN/客户端指纹及 hysteria2 带宽/混淆参数，并加入严格 Base64/10 MB 边界；Dola 页面桥与其他媒体入口还共享安全 URL 归一化，兼容旧版 JSON/HTML 中的转义斜杠、Unicode 转义、外层引号和 HTML 实体。当前 `smoke:all` 为 36 个测试文件、267 项单元测试。Windows x64 portable 最新大小为 195,931,887 字节，SHA-256 为 `C825BA3EB3DA72B561B2368555272CBEBF506A4BF0FA8FECC24E4C8D0832D86F`，包审计、原生资源校验和 6 秒启动 smoke 均通过。

本项目应该采用“Electron 主程序 + React/TypeScript 界面 + 每账号独立 Chromium Session”的统一跨平台架构。

当前目录包含两类代码：

1. `app/`：面向后续开发的干净 Electron 基线，应用级卡密、激活码和到期校验不在启动链路中。
2. `reference-original/`：V4.4 及旧版程序的完整恢复参考，包含原始授权相关类、WPF/WebView2 代码和 Windows 启动器，不直接参与 Mac 构建。

逐项功能状态以根目录 [`FUNCTION_MATRIX.md`](FUNCTION_MATRIX.md) 为准。

最新回归补充（2026-08-28）：媒体下载候选现在会在 HTTP 200 错误页、空响应或响应流中断时继续尝试后续已观察地址，并把失败地址记录到资源状态，经 `media:updated` 推送到 GUI 候选详情；程序化下载候选会登记到主进程去重保护，避免与同 URL 的 Chromium 原生 `will-download` 重复落盘；Dola 页面桥与其他媒体入口还统一归一化旧版 JSON/HTML 中的转义斜杠、Unicode 转义、外层引号和 HTML 实体，并在去重与下载前限制为 HTTP(S)/Blob 协议；通用捕获还覆盖响应式 `srcset`、`<picture><source>`、受限 CSS 背景图及图片/视频类型优先级，sandboxed remote preload 另有独立兜底 smoke，验证没有页面适配器脚本时仍能安全捕获可见图片、响应式来源、CSS 背景和 `<video><source>`，且空地址不会归一化为当前页面 URL；Dola 生成提醒同步显示在账号卡片和已打开标签页；外部登录新增平台无关的目标站点 Cookie 登录态轮询，Higgsfield 人工完成验证后可自动同步；平台适配器禁用时，主进程会统一拒绝普通媒体、视频提醒和 Dola 令牌三类远程事件；素材库打开期间会在普通文件或媒体任务完成后自动防抖刷新。当前总数为 267 项单元测试（36 个测试文件）；Windows x64 目录包审计、目录包 6 秒启动 smoke、portable 6 秒启动 smoke 和 `smoke:all` 均通过。portable 当前大小为 195,931,887 字节，SHA-256 为 `C825BA3EB3DA72B561B2368555272CBEBF506A4BF0FA8FECC24E4C8D0832D86F`。

当前 `app/` 已落地：

- TypeScript 类型检查通过。
- 下面的长功能清单沿用 257 项历史基线编写；随后新增下载去重、旧版代理订阅字段和媒体 URL 归一化回归后，当前权威计数为文档上方的 267 项。
- 长清单对应的历史 257 项回归仍全部通过；当前 `smoke:all` 的完整统计为 267 项，新增 4 项覆盖程序化下载与 Chromium 原生下载重复事件保护、4 项覆盖旧版代理订阅转换字段和输入边界，另有 2 项覆盖媒体 URL 归一化与去重。
- 257 项测试全部通过（包含订阅、指纹、跨平台迁移指纹适配、Dola/Higgsfield 登录脚本和 Dola 点位校准脚本、旧配置代理/Storage 归一化、旧版数字账号类型映射、旧版下载目录/Boss Key/主页设置映射、旧版 ProfileRoot 映射、Yunque 原始资源、任务脚本、豆包 15 秒可见提示词脚本、豆包账号级 15/30 秒页面设置脚本、Dola 30 秒/音视频参考素材桥、Dola 参考素材路径校验、标准文件输入上传状态探针、插件导入、代理认证隔离、媒体响应、捕获模式过滤、通用适配器 JSON/SSE 响应捕获、通用 API 图片在缺少宽高时的保守保留和 UI 头像排除、通用 performance 图片兜底保留和普通资源排除、旧豆包扩展原视频来源保留、旧豆包 play-info fixture 与 watermark 路由升级、豆包显式无水印字段候选保留、旧版千问 message-list 的 `thumbnail_url`/`src+poster` 解析、千问 API 图片无尺寸保留、千问扩展主机权限覆盖、无扩展名 CDN 资源的显式 MIME/媒体类型提示解析、Blob 预览映射、FFmpeg 预览转码、FaceGrid 模型资源、网页地址安全校验、远程页面主帧边界、页面桥接脚本安全校验、账号元数据导入导出保留测试、不包含凭据的诊断快照测试、豆包创作脚本入口校验、按 Windows/macOS 动态适配且不覆盖账号指纹的浏览器兼容脚本校验、IndexedDB 归一化和存储脚本测试、旧版 Cookie 别名/日期过期时间解析、独立 LocalStorage/SessionStorage 导出别名和 key/value 数组解析、更新目标平台选择和跨架构包拒绝、GitHub 发布页安全打开、Dola 目标站点 Cookie 域和稳定登录标志检查、同账号 sing-box 并发启动只复用一个运行时、sing-box 核心崩溃状态与显式重启恢复、单节点测速后的原节点和 Session 恢复、全部节点测速后的节点结果和原节点恢复、删除账号前持久 Session 清理、普通资源文件名前缀，以及 Windows/macOS 用户数据路径选择、浏览器数据目录切换和重启生效、Dola/豆包旧版视频目录编号与新布局开关校验、V4.4 `Videos`/`Images` 目录兼容、视频生成提醒协议边界、全部平台安全主机匹配和旧版专用响应入口 fixture、Shadowsocks 常见 Base64/明文 URI 解析、账号配置重载不意外打开闭合账号且并发重载只复用一个任务、网页地址归一化及危险 scheme/账号密码拒绝、内置批量登录 WebContentsView 网格迁移与关闭还原、Dola 定位信息待解析后升级、Dola/ciciai 页面入口兼容、页面 `electronDownload` 进入统一下载队列、macOS/Windows FFmpeg 资源哈希和架构校验、窗口绑定任务监听可撤销、V4.4 多账号 `fingerprint_config.json` 显式目录优先/ID-名称唯一匹配/平局保护、目录-only ProfileRoot 账号发现、同一账号并发打开请求合并、启动恢复时只保留成功打开标签并记录失败账号、账号 View 打开取消后立即重试、外部登录旧进程延迟关闭不会删除替代进程、外部 Chrome/Edge 关闭时按平台清理进程树、内置豆包扩展无过期/激活门控、实验响应补丁开关按需即时重建、普通/视频下载目录分离和素材库双目录扫描、嵌套/转义 Dola `fallback_api`、无扩展名 `image_ori_raw` 原图识别、严格 Base64 输入边界与 malformed URI 容错、持久 Session 下载监听器卸载、账号平台/自定义地址变更后 View 适配器重建、删除账号时外部登录辅助浏览器目录清理、Dola fallback 使用实际响应 URL 作为 Referer 且失败解析不会永久抑制重试、普通账号批量创建上限和超过 20 个内置批量登录的分批边界、Dola 30 秒提交前模型/时长选择及 CDP `/chat/completion` 视频请求确认、普通非媒体原生下载目录解析和重名避让、Dola 无水印令牌解码、素材面板候选地址数量显示/角色选择、HTTP 200 错误页回退、响应流中断回退、失败候选状态推送、后加载适配器脚本的单文档去重、指纹文档钩子先于网络 User-Agent 覆盖的时序、即梦适配器在极早新文档阶段延迟 DOM 初始化、旧版 Dola/Doubao `AIAM_ALT_ORIGINAL_MEDIA_FOUND` 公开资源事件安全转入统一素材队列、通用捕获 `srcset`/`<picture><source>`/受限 CSS 背景图和媒体类型优先级静态回归、sandboxed remote preload 的空地址归一化与独立 DOM 兜底 smoke、豆包扩展共存标记、Dola 批量登录弹窗无横向溢出、平台适配器禁用状态对远程媒体/视频提醒/Dola 令牌的统一门禁，以及 macOS 签名发布工作流完整性检查）。
- `smoke:session-restart` 还会在两个独立 Electron 进程之间关闭并重新打开同一组持久 Session，验证 Cookie、LocalStorage、IndexedDB、CacheStorage 可以跨进程读回，且 `persist:restart-a` 与 `persist:restart-b` 的数据仍保持隔离；真实第三方登录态和会话 Cookie 的保留规则仍以站点为准。
- Electron production build 通过。
- 账号管理、版本化数据模型、V4.4 迁移预览/备份（包括下载目录、Boss Key 和安全主页地址映射）、独立浏览器 Session、直接代理、订阅代理管理、指纹配置、内置/自定义扩展加载、媒体捕获、按全部/图片/视频持久化筛选捕获、Dola 视频生成完成提醒、Dola 任务 UI（含参考图文件输入附加）、下载队列、素材预览和素材库已有实现；Dola 定位信息不完整时会先进入主素材流，页面中的公开解析请求由账号页面正常登录态完成，解析出的地址或页面 `electronDownload` 再进入统一主进程下载队列；普通下载目录与可选独立视频下载目录均由 Main Process 管理，素材库可合并扫描且所有文件操作统一做路径边界校验；账号编辑面板提供独立的 Cookie、缓存、Storage 和全部会话清理入口，且不依赖账号是否启用代理；删除账号时会清理其持久 Session，避免元数据删除后遗留登录缓存继续占用空间。
- Cookie/Storage 导入现在支持 Cookie JSON/CSV、独立 LocalStorage/SessionStorage 常见别名和 key/value 数组，以及旧版结构化 IndexedDB 导出：按数据库、对象仓库、keyPath、索引和记录恢复，并处理 Date、ArrayBuffer、TypedArray 与 Blob 标记；导入文件经过大小、数量、深度和字段限制，错误按数据库返回，不会把原始 JSON 当脚本执行；未带包装层的 JSON 对象会按 LocalStorage 处理并给出提示。
- 账号面板支持按分组/平台筛选、重命名和移除分组，并可一次删除当前分组或平台下全部账号；批量删除会同步关闭对应 View、清理标签并重新选择活动账号。左侧账号工具区可折叠，偏好保存在当前 Renderer 的 `localStorage` 中以保持旧版使用习惯。
- 账号面板支持一次创建多个账号；Dola 面板兼容旧版凭据文本格式批量创建账号、依次自动填入和批量同步外部登录窗口，并提供登录/Google 点位的可视化比例校准与测试点击，凭据只用于当前窗口内的登录辅助，不写入账号 JSON。账号 JSON 往返导入会保留浏览器、稳定指纹和订阅节点等行为配置，但有意不导出代理密码。
- 删除账号时先关闭对应的 WebContentsView 和外部 Chrome/Edge 辅助进程，并移除该账号专属的外部登录辅助目录；删除当前活动账号后会重新选择活动标签，避免残留视图状态。应用退出时会等待 sing-box 运行时统一停止并清理，避免窗口关闭后留下代理子进程。豆包账号提供“豆包原视频”创作页扫描入口，即梦账号提供显式原图选择入口，二者都通过页面标准交互完成。
- 豆包账号还提供“豆包 15s 增强”入口：把旧版固定提示词填入当前可见的豆包输入框并点击可见发送按钮；它与时长选项扩展配合，但不调用私有任务接口，也不绕过账号权限。
- 系统诊断面板通过受信任主界面的 IPC 生成快照，展示每个账号的 `persist:account_<id>`、当前页面、适配器开关、指纹应用状态、代理运行状态和下载任务统计；快照结构不包含 Cookie、密码、订阅正文或代理凭据。编辑已打开账号的浏览器/指纹配置会通过 `browser:reconfigure` 重建该账号 View，使新文档脚本、UA 和 Session 配置生效；闭合账号只保存配置，不会被后台操作意外打开。
- 旧版“解决白屏闪退”是停用内置 WebView2 Runtime、改用系统 Runtime；Electron 版本不复制这套运行时，也不需要修改应用目录。当前等价能力由 `render-process-gone` 自动重建和工具栏“修复页面”操作提供：重建当前账号的 `WebContentsView`、CDP 文档脚本、扩展和代理绑定，保留账号元数据与持久 Session。
- `browser-compat.js` 只提供 Chromium 页面兼容性和当前操作系统形态适配，不拦截 Google 的 Passkey/WebAuthn，也不修改第三方验证结果；登录辅助脚本遇到验证码、2FA、通行密钥或手机验证时会停止并交给用户完成。
- `browser-compat.js` 的注入覆盖旧版页面可能读取的浏览器可见兼容面：`chrome.runtime` 旧接口、Chrome `csi/loadTimes`、PDF `plugins/mimeTypes`、`navigator.connection`、通知权限查询、窗口外部尺寸、页面焦点和 Screen 基本属性，并移除页面级 `cdc_` 残留。真实 Electron 文档 smoke 已验证它在目标页面首段脚本和首个 Fetch 之前执行；这仍然不改变真实 GPU、字体、TLS、网络层或第三方验证结果。
- `FingerprintService` 的构建脚本现在也有真实页面级回归：`smoke:fingerprint` 从构建产物加载同一份脚本，通过 CDP 在导航前注册后检查 UA/UA-CH、Screen、DPR、时区、Canvas 噪声和 relay WebRTC 策略。自动化 smoke 会显式记录 WebGL 上下文是否可用；禁用 GPU 时没有上下文不被误报为“已经修改真实 GPU”。
- Windows x64 目录包已生成并通过 `audit:package`，随包包含三个官方 sing-box 核心；macOS DMG、签名、公证和真实站点验收仍需在 macOS 主机完成。
- Windows 打包已接入构建入口自有的 `app/build-assets/app.ico`，不再使用 electron-builder 默认图标；macOS 已配置 `app/build-assets/app.png` 作为图标输入，并为 Electron/Chromium JIT 与随包原生模块配置 `app/build-assets/entitlements.mac.plist`；发布机仍需确认生成的 `.icns`、签名和 Gatekeeper 结果。macOS 未签名 CI 会逐个启动生成的 `.app`，再用 `verify-macos-release` 验证 `.app` 和 DMG；新增的 `release-macos.yml` 在配置 Apple/证书 Secrets 后负责签名、公证、审计、启动验证并发布架构独立 DMG。
- 外部登录辅助支持 Windows/macOS 标准路径自动探测，也可在设置面板通过 `externalBrowserPath` 指定自定义 Chrome/Edge 可执行文件路径。
- 原生资源清单同时校验 SHA-256 与 PE/Mach-O 架构头，避免将错误架构的核心打进目标包；Windows checkout 无法保存 POSIX 执行位，macOS 构建前由准备脚本重新设置。
- FaceGrid 已恢复原版 SSD Caffe 模型：OpenCV DNN WASM 在 Electron 渲染进程完成初始化、虚拟文件系统加载模型和前向推理；视频预览已接入 FFmpeg 兼容转码，Windows x64、macOS x64/arm64 均有固定版本的随包核心，Windows 已通过实际转码测试。

这并不代表已经达到 V4.4 的全部功能等价。V4.4 的专有 donor 程序集提交链路、真实站点兼容性、macOS 签名/公证和端到端双账号测试仍需要逐项验收。当前没有实现本地像素擦除水印、DRM 解密或复制 WebView2 数据库。

## 2. 恢复材料与可信度

| 材料 | 位置 | 用途 | 状态 |
|---|---|---|---|
| 跨平台主工程 | `app/src/` | Windows/macOS 后续开发入口 | 可编译基线 |
| 旧 Electron 源码 | `reference-original/electron-source/` | 页面脚本、旧 UI、旧 IPC 和平台适配参考 | 原始恢复材料 |
| V4.4 主程序集 | `reference-original/v44-dotnet/` | WPF 主窗口、浏览器实例、资源捕获等逻辑参考 | ILSpy 项目级反编译 |
| V4.4 辅助程序集 | `reference-original/v44-dotnet-helpers/` | 账号管理、主题、插件等逻辑参考 | ILSpy 项目级反编译 |
| 外层启动器 | `reference-original/v44-launcher/` | WebView2 检查、缓存选择、payload 解包参考 | C# 反编译 |

反编译只能恢复程序行为的近似实现，不能恢复原始注释、变量命名、完整构建参数、签名证书和 Git 历史。异步状态机、匿名类、编译器生成代码和混淆代码需要人工整理后才能作为长期维护源码。

## 3. 总体架构

```text
┌──────────────────────────────────────────────────────────┐
│ Electron BrowserWindow                                   │
│                                                          │
│  ┌──────────────────────┐      ┌──────────────────────┐  │
│  │ React Renderer       │      │ WebContentsView      │  │
│  │ App.tsx              │      │ 账号 A / 账号 B      │  │
│  │ 账号、设置、素材库    │      │ Chromium 页面         │  │
│  └──────────┬───────────┘      └──────────┬───────────┘  │
│             │ contextBridge               │ preload/CDP  │
│  ┌──────────▼───────────┐      ┌──────────▼───────────┐  │
│  │ preload/index.ts     │      │ preload/remote.ts    │  │
│  │ 类型化 IPC API        │      │ 页面媒体捕获          │  │
│  └──────────┬───────────┘      └──────────┬───────────┘  │
│             │ IPC                         │ IPC           │
│  ┌──────────▼─────────────────────────────▼───────────┐  │
│  │ Main Process                                       │  │
│  │ AccountService / BrowserManager / MediaService     │  │
│  │ SettingsService / ExternalLoginService / Updates   │  │
│  └──────────┬──────────────────────┬───────────────────┘  │
│             │                      │                      │
│  ┌──────────▼──────────┐  ┌────────▼─────────┐           │
│  │ data/config/session │  │ site-assets       │           │
│  │ JSON、账号目录、日志 │  │ 扩展、页面脚本     │           │
│  └─────────────────────┘  └──────────────────┘           │
└──────────────────────────────────────────────────────────┘
```

核心原则：

- Renderer 只负责界面和用户操作，不直接访问 Node.js 文件系统。
- 所有敏感操作由 Main Process 执行，并通过 Zod schema 校验 IPC 参数。
- 外部网站页面只获得最小化的 remote preload 能力。
- 每个账号的网页状态绑定到独立的 Electron `Session`，而不是使用全局默认 Session。
- 平台差异集中在 `adapters.ts`、路径/打包配置和少量原生能力中，避免散落在 UI 代码里。

## 4. 进程与安全边界

### 4.1 Main Process

入口是 [`app/src/main/index.ts`](app/src/main/index.ts)。主要职责：

- 创建主窗口。
- 初始化数据目录和日志。
- 创建账号、浏览器、媒体、设置、外部登录和更新服务。
- 注册自定义 `workbench-media:` 资源协议。
- 注册 IPC。
- 处理代理认证、单实例和异常退出。

### 4.2 Renderer

入口是 [`app/src/renderer/src/main.tsx`](app/src/renderer/src/main.tsx)，界面组件主要在 [`app/src/renderer/src/App.tsx`](app/src/renderer/src/App.tsx)。Renderer 通过 `window.workbench` 调用受限 API，不应出现 `fs`、`child_process`、`shell` 等 Node 能力。

### 4.3 Preload

- [`app/src/preload/index.ts`](app/src/preload/index.ts)：给本地 UI 暴露类型化 API。
- [`app/src/preload/remote.ts`](app/src/preload/remote.ts)：给外部网站页面提供媒体捕获桥接。

主窗口和外部页面均使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。这属于 Electron 的进程和权限隔离，不等于把账号放进独立虚拟机。

`BrowserManager` 创建账号 `WebContentsView` 后，会先加载一个不可见的 `about:blank` 文档，再附加 CDP、启用 `Page` 域并注册账号指纹和平台适配器的 `Page.addScriptToEvaluateOnNewDocument` 脚本，最后才导航到目标网站。这样能覆盖目标页面首段内联脚本和首个 Fetch/XHR；页面加载完成事件仍保留一次受限的补注入作为兼容兜底。`about:blank` 只用于建立 Electron 43 所需的 renderer/CDP 生命周期，不会显示给用户，也不会成为账号的最终地址。

设置中的平台适配器开关会比较变更前后的禁用列表；对已经打开且属于受影响平台的账号，`BrowserManager` 会关闭并重新创建对应 `WebContentsView`，从而同时清理旧的 CDP 文档脚本、扩展和代理绑定，再按新状态启动。未受影响的账号不会被重载，活动主/副窗口角色会恢复。

### 4.4 IPC

[`app/src/main/ipc.ts`](app/src/main/ipc.ts) 统一注册 IPC handler，并使用 Zod 对账号 ID、代理、布局、媒体任务和文件路径等参数进行校验。`ipc-security.ts` 用于确认调用方是否是预期的主框架。

所有新增 IPC 都应遵循：

1. 在 `shared/channels.ts` 增加频道名。
2. 在 `shared/contracts.ts` 增加输入/输出类型和 schema。
3. 在 preload 暴露最小方法。
4. 在 Main Process 校验参数并执行操作。
5. 对路径、账号归属和 WebContents 所属账号再次校验。

## 5. 账号与浏览器数据隔离

### 5.1 Session 隔离

[`app/src/main/browser-manager.ts`](app/src/main/browser-manager.ts) 对每个账号执行：

```ts
const ses = session.fromPartition(`persist:account_${accountId}`);
const view = new WebContentsView({
  webPreferences: {
    session: ses,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  }
});
```

`persist:account_<id>` 是持久化 Session。不同账号使用不同 partition，因此以下状态在正常情况下不会互相读取：

- Cookie 和登录状态。
- LocalStorage、SessionStorage、IndexedDB。
- HTTP cache、CacheStorage、Service Worker。
- 页面网络连接和该 Session 的代理配置。
- 该 Session 中加载的扩展运行环境及其存储。
- 账号上次页面地址和启动恢复开关（页面导航完成后节流写入账号配置）。

Electron 官方文档将 `session.fromPartition()` 用于管理独立的浏览器 Session、Cookie、缓存和代理：[Session API](https://www.electronjs.org/docs/latest/api/session)。

本机还通过 `smoke:session-restart` 做了跨进程回归：第一进程向两个持久 partition 写入带有效期的 Cookie、LocalStorage、IndexedDB 和 CacheStorage，退出后由第二个全新 Electron 进程读取，两个账号均读回自己的值且没有串号。这个证据说明 `WebContentsView` 不需要为每个实例启动一个外部 Chrome；Session 数据由 Electron 自带 Chromium 持久化。需要区分的是，带有效期的持久 Cookie 与仅在当前浏览器生命周期有效的 Session Cookie 不是同一类，第三方网站的登录续期、服务端会话和安全设备校验仍可能要求重新登录。

### 5.2 共享内容

以下内容并非账号级浏览器隔离：

- `accounts.json`、`settings.json` 和日志属于应用公共数据。
- 下载库是公共目录，但文件路径和媒体记录带有 `accountId`，默认可按账号创建子目录。
- Main Process 内存是共享的。
- 未配置代理时，多个账号仍然使用本机出口 IP。
- User-Agent、浏览器版本和部分硬件特征如果不做账号级配置，可能相同。

因此本项目实现的是“应用内逻辑浏览器 Profile 隔离”，不是操作系统用户、虚拟机或物理网络级隔离。

### 5.3 数据目录

[`app/src/main/data.ts`](app/src/main/data.ts) 的路径逻辑如下：

```text
开发：项目目录/data-dev/
Windows 便携打包：程序目录/data/
Windows 安装版或无便携目录环境：`%APPDATA%/AI创作工作台/data/`（不写入 Program Files）
macOS 打包：`~/Library/Application Support/AI创作工作台/data/`（不写入 `.app` 包）

data/
├── config/       账号、设置、下载任务
├── sessions/     默认的 Electron userData 和各账号持久化 Session
├── logs/         应用日志
├── downloads/    素材下载库
├── updates/      更新文件
└── external-login/ 外部浏览器登录辅助数据
```

设置面板还支持选择独立的“浏览器数据目录”。它对应旧版 `ProfileRoot`，只替换 Electron 的 `userData`/Session 根目录，应用配置、日志、下载库和更新目录仍留在应用数据目录中。选择后先写入默认配置目录下的 `profile-location.json`，检查目标可写并提示重启；当前进程不会热切换 Session，也不会把旧 WebView2 Cookie、缓存或数据库文件直接复制过去。macOS 会拒绝位于 `.app` 包内的路径。旧版迁移预览会展示 `ProfileRoot` 并给出提示，但不会把它直接设为新 Session 目录。

旧 WebView2 用户目录不能直接当作 Electron Session 目录使用。迁移时建议先迁移账号元数据，再对 Cookie、IndexedDB 和 LocalStorage 做逐项导入验证；不能假定两个浏览器内核的数据库格式、加密方式和锁文件兼容。

旧版 `StartupCacheCleaner` 已在新版本重建为显式维护功能：`LegacyCacheCleaner` 只允许扫描四类旧版临时路径（`DolaMultiBrowser_FullSingle*`、`DolaMultiBrowserFullFolder`、`DolaMultiBrowserNormal/*`、`DolaMultiBrowser/*`），分别使用 30 分钟和 1 天的目录修改时间阈值。用户必须先扫描、查看目录和大小，再确认清理；清理动作会重新扫描并跳过活动目录、符号链接和非目录项。它不接受 Renderer 传入的任意路径，不自动删除，也不会触碰账号 Session、下载库、应用安装目录或普通临时文件。因此它不是“删除所有 3 个月未访问文件”的通用清理器。

## 6. 浏览器实例生命周期

账号打开流程：

1. `BrowserManager.open(accountId)` 校验账号。
2. 创建或取得该账号的 persistent Session。
3. 应用该账号代理、权限策略和下载监听器。
4. 创建绑定 Session 的 `WebContentsView`。
5. 加载目标扩展和页面脚本。
6. 注册调试器，按适配器规则监听网络响应。
7. 加载平台主页。
8. 页面加载完成后再次注入页面脚本。

账号关闭时只关闭对应的 View；账号数据和持久化 Session 默认保留。Renderer 只请求“打开/关闭/激活/刷新”，View 的创建、销毁、布局和恢复由 Main Process 管理。

主窗口生命周期按平台处理：Windows 关闭最后一个窗口会退出应用；macOS 关闭窗口后应用保持运行，点击 Dock 图标或再次触发单实例事件会重新创建工作台。重新创建时会先清理旧窗口的 View、登录辅助浏览器、Boss Key 和 sing-box 进程，再挂载新的账号工作台，避免把旧窗口的运行时状态泄漏到新窗口。

窗口关闭触发的代理清理通过 `src/main/lifecycle.ts` 串行排队；macOS 随后显式退出应用时会等待同一清理 Promise，前一次清理失败也不会阻塞后续清理。这样窗口生命周期和子进程生命周期不会因连续关闭/退出操作产生竞态。

`WebContentsView` 是 Electron API，不是 .NET 控件；它承载 Electron 自带 Chromium 页面。Electron 官方建议使用它替代旧的 `<webview>` 标签：[Web Embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds)。

## 7. 平台适配与扩展体系

[`app/src/main/adapters.ts`](app/src/main/adapters.ts) 为每个平台定义：

- 平台 ID、名称和主页。
- URL 匹配规则。
- 需要加载的 Chromium 扩展。
- 需要注入的页面脚本。
- CDP `Fetch` 拦截规则。
- 可选的响应体修补器。

当前平台包括：豆包、千问、Dola、云雀、Higgsfield、Kimi、oiioii、nano、Lovart、即梦和自定义网站。豆包/Dola/云雀/即梦使用专门适配器，其余平台主要使用通用媒体捕获或页面脚本。

资源目录：

```text
app/site-assets/
├── extensions/       Chromium 扩展
└── scripts/          browser-compat、媒体捕获、平台脚本
```

扩展和页面脚本的职责应保持清晰：

- 页面脚本负责 DOM 观察、站内下载入口和页面事件。
- remote preload 负责安全地把媒体事件送回 Main Process。
- CDP 负责网络响应观察和需要的响应解析。
- `media-parser.ts` 负责把不同平台的 JSON/SSE/URL 统一为 `MediaResource`。

## 8. 媒体捕获与下载链路

```text
网页 DOM / 页面下载 / XHR / Fetch / SSE
          │
          ├── remote preload → remote:media
          └── CDP Network → parseMediaPayload()
                              │
                              ▼
                         MediaService.add()
                              │
                    去重、补充缩略图和过期时间
                              │
                              ▼
                         Renderer 媒体列表
                              │
                        用户点击下载
                              ▼
                     DownloadTask 队列
                              │
               对应账号 Session 发起下载请求
                              ▼
                    .part 临时文件 → 最终文件
```

`MediaService` 负责：

- 资源规范化和稳定 ID。
- 账号归属检查。
- 下载并发、重试、取消和断点临时文件。
- 下载路径安全检查。
- 图片/视频预览协议。
- 下载库分页、筛选和文件操作。

通用页面捕获脚本在专用适配器之外提供保守兜底：扫描用户内容区域内的 `video`、`img`、数据属性、响应式 `srcset`/`<picture><source>` 和受限尺寸的 CSS 背景图，并读取一小段页面 performance 资源作为补充。sandboxed remote preload 还保留独立的 DOM 兜底扫描，因此即使某个平台适配器脚本没有加载，也能捕获可见媒体；其空地址会被拒绝，不会归一化为当前页面 URL。图片/视频的明确语义提示和文件扩展名优先于宽泛的 CDN 路径关键词，避免把 `/media/result.webp` 误报成视频；装饰性背景、头像、图标和小尺寸页面 chrome 会被过滤。通用捕获只能证明页面公开观察到了资源，不会把普通 DOM 地址标记为“已确认无水印”。

Dola 页面桥检测到生成完成的视频后，经 Main Process 按账号、主帧和资源 key 去重，再由 Renderer 显示通知卡片；未激活账号的卡片和已打开标签页会显示未读数量/圆点，用户打开对应账号后清除提醒。这个 UI 状态不改变资源的可信等级，也不替代真实站点生成任务验收。

资源捕获还受设置中的 `captureMode` 控制。`all` 接收图片和视频；`image` 或 `video` 会在三个边界同时过滤：主进程的页面媒体/原生下载入口、远程页面 Preload 的媒体 IPC，以及 Dola 视频令牌入口。Renderer 的素材栏继续做同样的列表筛选，因此切换模式既不会把不需要的资源加入后端队列，也不会只隐藏已经捕获的资源。该设置持久化保存，应用重启后仍然生效；它只控制后续捕获，不会删除已存在的素材。

不要把媒体 URL 当作永久资源。很多平台的 URL 带有过期时间或签名，资源列表中保留 `expiresAt`，过期后应提示重新打开页面捕获。

### 8.1 “插件”在本项目中的准确含义

这里的插件不是一个独立的 npm 包，而是针对目标网站的一组适配代码。当前工程大致分为五层：

| 层 | 主要文件 | 运行位置 | 主要职责 |
|---|---|---|---|
| 平台适配器 | [`app/src/main/adapters.ts`](app/src/main/adapters.ts) | Main Process | 根据域名选择脚本、扩展、CDP 拦截规则和响应修补器 |
| 页面脚本 | `app/site-assets/scripts/*.js` | 目标网页的页面环境 | 观察 DOM、读取站点公开状态、识别媒体、注入按钮和调用站内接口 |
| Chromium 扩展 | `app/site-assets/extensions/*` | Extension service worker、content world、page world | 提供浮动控制台、批量下载、Fetch/XHR 桥接和站点专用 UI |
| 远程页 Preload | [`app/src/preload/remote.ts`](app/src/preload/remote.ts) | 每个 `WebContentsView` 的隔离 Preload | 读取 DOM 兜底、接收 `window.postMessage`、通过 `remote:media` 汇报给 Main |
| Main/CDP 层 | [`app/src/main/browser-manager.ts`](app/src/main/browser-manager.ts)、`media-parser.ts` | Main Process | 绑定账号 Session、监听网络响应、解析 JSON/SSE、接管下载和写文件 |

因此，“安装插件”在当前 Electron 方案里通常表现为：打开某个平台账号时，由 `BrowserManager.loadExtensions()` 将对应扩展加载到该账号的 Session，再由 `did-finish-load` 触发页面脚本注入。插件的生命周期跟随账号的 `persist:account_<id>` Session，而不是跟随整个 Renderer 全局共享。

`PlatformAdapter` 还提供显式 `capabilities` 合同，记录 DOM、Fetch/XHR/SSE、CDP 网络捕获，是否能修改请求/响应，图片/视频解析、专用下载器、登录辅助以及 15/30 秒任务入口。诊断面板会显示“专用下载器 / 通用捕获”和任务时长，避免仅凭平台已注册或主页可打开就误判为完整 1:1 迁移。当前 Kimi、oiioii、nano、Lovart 和自定义站点仍属于通用捕获能力；它们没有被标记为站点专用下载或任务协议。

### 8.2 插件加载和消息流

```text
账号打开
   │
   ├─ session.fromPartition("persist:account_<id>")
   │       ├─ loadExtension() → MV3 扩展
   │       ├─ WebContentsView → 远程页 preload
   │       └─ did-finish-load → executeJavaScript() → 页面脚本
   │
   ├─ 页面脚本 / page-world bridge
   │       └─ window.postMessage(...)
   │
   ├─ content script / remote preload
   │       ├─ chrome.runtime.sendMessage(...)
   │       └─ ipcRenderer.send("remote:media", ...)
   │
   ├─ BrowserManager / IPC 安全校验
   │       └─ MediaService.add(accountId, resource)
   │
   └─ Renderer 媒体栏 → MediaService.enqueue() → 下载队列
```

各消息通道的含义不同：

- `window.postMessage` 只是在同一网页的 page world 和 content/preload 之间传递数据，不能当成可信边界。消息中的 URL、标题、ID 都必须继续校验。
- `chrome.runtime.sendMessage` 用于扩展内部的 content script、page bridge 和 service worker 通信。
- `remote:media` 是远程页 Preload 到 Main 的单向媒体汇报通道。它不能按本地 React 主界面的 sender 校验；Main 会先确认消息来自已登记的账号 `WebContents`，再确认是该页面的主帧和 HTTP/HTTPS 页面，最后用专用 schema 限制媒体字段，并通过 `browser.ownsWebContents()` 将事件绑定到对应账号。
- `media:*` 是 Renderer 到 Main 的业务 IPC，由 [`app/src/main/ipc.ts`](app/src/main/ipc.ts) 做发送方、参数和路径校验。

当前内置扩展不再直接调用 `chrome.downloads.download()`，其下载请求通过 `chrome.tabs.sendMessage()` 转交当前账号页面，再由 `electronDownload` 进入 remote preload 和 `MediaService` 队列。页面原生下载仍由 `BrowserManager` 的 `will-download` 事件阻止默认行为并转成 `siteDownloadSink`。这样统一了账号 Session、代理、Referer、重试、`.part` 临时文件、文件路径安全和任务状态；扩展 manifest 也不再申请 `downloads` 权限。

设置面板支持导入 ZIP/CRX/目录形式的 MV2/MV3 自定义插件。插件文件会复制到应用配置目录，按账号 Session 独立加载；启用/禁用会同步到已打开的账号页面，删除前会校验路径必须位于插件根目录内。

### 8.3 当前插件功能清单

#### `maowang-doubao`

这是当前豆包/千问适配中最完整的一组 MV3 扩展，包含 service worker、content script、page-world bridge、弹窗和共享平台规则。

- `page/doubao-bridge.js` 在页面环境包装 `fetch` 和 `XMLHttpRequest`，观察豆包对话完成请求、SSE 流和会话链数据。
- 它把 `messageId`、`videoKey`、视频地址和图片地址建立映射，向 content script 发布 `MW_DOUBAO_MEDIA`。
- 它还承担豆包 15 秒时长请求的前端兼容处理：在用户选择 15 秒时，修补提交给站点的能力参数，并同步页面上的选项显示。这是请求参数适配，不是本地生成视频。
- `content/doubao.js` 负责扫描页面、识别图片/视频、注入下载按钮和浮动控制台；点击视频下载时先向 page bridge 请求解析，再通过 `MW_DOWNLOAD` 交给 service worker。
- `content/qianwen.js` 主要按 DOM 和平台规则识别千问生成图片/视频，注入单个下载和批量下载按钮。
- `background.js` 负责单个/批量下载、备用 URL、页面健康状态、数量统计和豆包视频解析回退。

这组扩展的核心价值是“站点协议和页面结构适配”，不是账号管理，也不是独立的文件库。它不应自己保存跨账号的 Cookie 或账号列表。

#### `doubao-download`

这是一组更偏“解析器/下载器”的豆包扩展：

- `content.js` 在页面环境包装 Fetch/XHR，读取 `_ROUTER_DATA`、会话链、SSE 和接口响应，寻找 `vid`、`messageId`、作品节点 ID 等关联信息。
- 它优先调用站内 `get_download_info` 获取作品下载信息；无法直接拿到节点 ID 时，会尝试从会话链、当前页面状态或旧的分享链路补齐上下文。
- `forwarder.js` 负责把解析结果和按钮放到可见的图片/视频卡片上，避免解析逻辑和页面 UI 完全耦合。
- `background.js` 负责下载和备用 URL；它还保留了 `share_save` 等历史回退链路。

这个扩展与 `maowang-doubao` 有部分能力重叠，但当前迁移保留两者是有意的：`maowang-doubao` 负责现代页面桥接、控制台和主解析路径，`doubao-download` 保留旧版 `get_download_info`、会话链和 `share_save` 回退路径。两者虽然可能分别包装 `fetch`/XHR，但都只在页面环境内读取当前账号已有响应，不保存跨账号状态；主进程资源库还会按账号和候选地址合并重复资源。可见图片操作使用共享的 `data-aiam-doubao-image-action` 标记，先注入的一方拥有该卡片的唯一按钮，另一方只继续提供解析/回退能力，避免重复 UI。视频按钮则由当前猫王控制台负责，旧 forwarder 的聊天视频按钮开关保持关闭。

#### `doubao-creation-download.js`

这是页面脚本，不是 MV3 扩展。它面向豆包“我的创作”页面：

1. 从 React Fiber、DOM 卡片和页面状态中找作品节点、消息 ID 和封面关联。
2. 必要时调用 `message_node_info` 将消息 ID 转成可下载的作品节点 ID。
3. 调用 `get_download_info` 获取原视频主地址和备用地址。
4. 只接受符合下载接口特征的地址，再以 `videoDataExtracted` 或 `electronDownload` 发布给应用。

它解决的是“创作列表卡片没有直接把原视频 URL 放在 `<video>` 节点上”的问题，因此不能只靠通用 DOM 扫描替代。

#### `jimeng-image-download.js`

这是即梦的图片专用脚本：

- 从页面 React 记录中取得 `itemId`。
- 请求 `/mweb/v1/get_local_item_list`，场景参数为 `Download`。
- 先尝试带有 `use_commerce_benefits_type = 'rwm'` 的原图/去水印权益请求，失败时回退到普通详情请求。最终能否返回无水印图由站点服务端决定。
- 在 `large_images`、封面和尺寸映射中收集候选，根据尺寸、原图/大图关键词和水印标记进行排序。
- 选择最高评分地址后，通过 `electronDownload` 交给应用。

它的“原图”判断是字段和 URL 选择策略，不是对图片内容做修复。

#### `generic-video-capture.js`

这是通用兜底脚本，适用于没有专用适配器的平台：

- 扫描 `<video>` 的 `currentSrc`、`src`、`<source>` 和 poster。
- 扫描 `<img>` 的 `currentSrc`、`src`、`data-src`、`data-original`、`data-origin` 等属性。
- 扫描用户内容卡片上的 `data-video-url`、`data-play-url`、`data-image-url` 等属性。
- 对浏览器 `performance` 资源条目做受限兜底：只接受 `video/source/img/image` 发起类型或明确的媒体 URL 特征，并继续排除 logo、脚本、样式和占位资源。
- 使用 MutationObserver、`loadedmetadata`、`play`、`load` 和定时扫描应对 SPA 动态渲染。
- 通过 `imageDataExtracted`/`videoDownloadResult` 发布候选资源。

通用脚本不能证明 URL 是无水印原始资源。当前代码会把普通 DOM 地址标记为 `dom-direct` 或 `unknown`，不会仅因为历史字段名是 `no_watermark_url` 就给出平台确认语义；只有平台字段、令牌解析或已知下载链路才会提高证据等级。

#### `doubao-video-15s`

该目录还保留了独立的 15 秒扩展和 Dola 工具的 duration/main 页面脚本。当前 `app/` 已将安全页面脚本加入豆包和 Dola 适配器：15 秒能力通过响应适配和可见 UI 入口提供，Seedance 2.5 的 30 秒开关、提交参数桥以及 Dola 音视频参考素材支持由 `dola-duration-bridge.js` 提供。Dola 任务提交本身仍通过当前登录页面的正常 UI 完成；主进程校验最多 9 张参考图，并通过 Chromium 的 `DOM.setFileInputFiles` 或拦截文件选择器附加到标准上传控件；音频/视频参考分别校验 MP3/WAV、MP4/MOV，最多各 10 个，再通过同一账号页面的标准文件输入交给 Dola 官方上传管线。旧版 content-panel/service-worker 中的授权、自锁、`chrome.runtime` 和直接下载逻辑没有复制。

#### Dola 页面资源桥

`reference-original/electron-source/extensions/dola-nowatermark/` 仍只作为恢复参考，当前 `app/` 不直接加载旧版扩展。其安全的页面侧功能由 [`site-assets/scripts/dola-resource-bridge.js`](app/site-assets/scripts/dola-resource-bridge.js) 重建，并覆盖当前 Dola/ciciai 页面入口：捕获当前已登录页面的 DOM 视频、Fetch/XHR 文本响应、性能资源、页面状态和公开媒体字段，保留请求中的 `vid`/消息 ID/分享 ID 上下文，显示轻量资源面板，并在每个可见视频卡片上提供逐视频“解析并下载 / 打开原始 / 当前地址 / 复制地址”操作浮层；下载请求统一发给 `remote.ts` 和 Main Process 队列。资源没有直接地址时，面板或视频浮层的“解析原始”会在当前登录页面内按 `play-info → share-save/video-share-info → thread/share/info → 分享页` 的顺序尝试公开接口，并把返回地址重新关联到同一作品；解析后可以下载、复制地址或在当前登录态下打开原始地址；这不是后台凭据注入或权限绕过。“当前地址”按钮只下载页面播放器已经暴露的地址，证据等级保持 `dom-direct`，不会冒充平台原始资源。`media-parser.ts` 还会处理公开 play-info/share/chain 响应中的 `main_url`/`man_url` Base64 或 qAAB 令牌，`dola-resolver.ts` 继续负责 CDP 看到的 `fplay`、`key_seed`、回退接口和平台 URL 变体解析。旧版 `chrome.downloads` 直写、授权桥和隐藏校验没有移植；页面脚本不能把普通候选地址承诺为必然无水印。

#### Dola 30 秒与音视频参考素材桥

恢复目录中的 `Dola工具/duration-main.js` 是页面侧能力脚本，不包含旧应用授权流程。当前工程将它复制为 [`app/site-assets/scripts/dola-duration-bridge.js`](app/site-assets/scripts/dola-duration-bridge.js)，只在 Dola/ciciai/豆包目标页面中以 `Page.addScriptToEvaluateOnNewDocument` 方式注册。它负责 Seedance 2.5 的 30 秒菜单和提交参数同步，并在 Dola 页面接收站点自己的模型规则、上传服务和附件状态；应用主进程不读取或伪造第三方 Token。

音频和视频参考素材从工作台选择后，由 `BrowserManager.uploadDolaReferences()` 进行扩展名、数量、大小校验，使用 Chromium CDP `DOM.setFileInputFiles` 设置当前账号页面的标准文件输入，再触发页面原生 `input/change` 事件。页面桥会通过 `__WATERMARK_FREE_DOLA_REFERENCE_STATUS__` 暴露不含文件内容/Token 的附件状态摘要，主进程在有界时间内区分“文件已设置、附件已绑定、仍在上传、失败或页面状态不可观测”；Renderer 遇到未完成绑定时不会继续提交任务。后续 metadata、模型限制、转码兼容、上传和附件绑定仍由 Dola 页面自己的上传管线完成；应用不把本地文件直接上传到第三方接口，也不把上传失败误报为成功。带旧授权、自锁或直接下载的 content-panel/service-worker 没有纳入构建入口。

### 8.4 “去水印下载”的实际原理

本项目中“去水印”应严格分成两类：

| 类型 | 含义 | 当前工程是否实现 |
|---|---|---|
| 平台提供的无水印/原始变体 | 站点接口或已授权下载接口返回另一条 CDN 地址，客户端选择这条地址下载 | 已接入通用候选、Dola URL/Token/回退 API 和 Yunque 原始字段，仍需真实站点验收 |
| 本地像素级去水印 | 下载带水印图片/视频后，用修复、裁剪、重编码或 AI inpainting 去掉画面内容 | 当前没有实现 |

因此，当前代码的主要原理是“资源定位 + 变体选择 + 授权 Session 下载”，不是“下载后擦除水印”。典型链路如下：

```text
页面上看到预览图/播放器
          │
          ├─ DOM、React 状态、Router 数据、Fetch/XHR、SSE 或 CDP 响应
          │                     ↓
          │             得到作品关联 ID
          │       (messageId / vid / nodeId / itemId)
          │                     ↓
          ├─ 调用当前账号可访问的站内详情/播放/下载接口
          │                     ↓
          ├─ 收集 main/original/download/large 等候选 URL
          │                     ↓
          ├─ 排除 preview/thumb/watermark 标记并按质量评分
          │                     ↓
          ├─ 只有满足平台地址规则时标记 confirmedNoWatermark
          │                     ↓
          └─ 使用同一账号 Session、Referer 和代理流式保存
```

#### A. 豆包：作品 ID → 下载接口 → 原视频地址

豆包的创作卡片经常只显示播放器或封面，真正的原视频地址要通过上下文关联取得。代码会从页面状态、会话链、React Fiber 或已捕获接口中寻找 `vid`、`messageId`、`nodeId`，然后优先调用 `get_download_info`。

当前脚本中的确认条件主要包括：

- 接口返回 `download_infos[0].main_url`。
- 地址属于预期的豆包视频下载域名或下载路径。
- 地址具有下载请求特征，例如 `download=true`。
- 地址没有明显的 `with_watermark`、`watermark`、`aigc_*_mark` 等水印变体信号。

如果只有播放信息，旧路径会读取 `get_play_info` 或分享信息，再从 `play_infos`/`play_info` 中选择主地址和备用地址。某些历史代码会把 URL 中的水印播放标记替换为 no-watermark 标记，但替换字符串本身并不等于服务端一定接受；最终必须以 HTTP 响应和平台字段为准。

#### B. Dola：已知 URL 变体或编码主地址

当前 [`app/src/main/media-parser.ts`](app/src/main/media-parser.ts) 对 Dola 做了有限的 URL 变体升级：

- 将查询参数中的 `lr=video_gen_watermark` 或 `video_gen_watermark_dyn` 变为 `video_gen_no_watermark`。
- 在已有 `logo_type` 参数且不是无水印值时，改为 `logo_type=no_watermark`。
- 只有 URL 确实发生了受支持的变更，且仍被识别为视频，才返回升级地址。

这只是“已知地址格式的候选升级”，不是万能规则。如果平台不接受该变体、签名绑定了原始查询串，或者资源本来只有带水印版本，下载仍会失败或得到带水印文件。

V4.4 的 [`LocalVideoResolver.cs`](reference-original/v44-dotnet/DolaMultiBrowser/LocalVideoResolver.cs) 还展示了更完整的旧链路：

1. 向配置的 `fallback_api` 追加无水印相关请求参数。
2. 读取返回 JSON 中的 `video_info`/`video_list`，按码率和分辨率选择主视频地址。
3. 如果 `main_url` 是普通 URL，直接使用；如果是 Base64/URL-safe Base64 形式，先解码。
4. 如果是带 `key_seed` 的特殊编码令牌，再按旧版协议进行密钥派生和 AES-CBC 解码，验证结果确实是 HTTP 视频地址。

这说明旧版的“无水印”有一部分是“服务端返回的编码地址解析”，不是下载后处理。当前 `app/` 已迁移 `LocalVideoResolver` 的主要 fallback API、Base64/URL-safe Base64、`key_seed` AES-CBC 令牌解析和多码率选择，并在 CDP 收到 Dola 响应时尝试回退解析；站点接口变更或未授权时仍会失败，不应把候选地址承诺为必然无水印。

#### C. 即梦：itemId → 本地作品详情 → 大图候选

即梦脚本会根据页面卡片得到 `itemId`，请求本地作品详情，并优先读取 `large_images` 等大图字段。候选评分会偏向：

- 更大的宽高乘积。
- `origin`、`original`、`source`、`raw`、`large` 等原图语义。
- PNG 或明确的大图格式。
- 避开 `aigc_*_mark`、`busi_mark`、`watermark`、`wm_` 等缩略图/标记语义。

`rwm` 请求参数只是“尝试向站点申请相应权益/变体”的业务参数，不能保证所有账号、地区、套餐或作品都能返回无水印地址。代码必须把接口返回结果视为服务端授权结果，而不是客户端可以强制获得的权利。

#### D. 通用 DOM/网络捕获：只能得到“当前页面正在使用的资源”

通用捕获可以发现：

- `<video>` 当前播放地址。
- `<img>` 当前图片地址。
- `data-*` 属性中的原图/播放地址。
- 业务 JSON、SSE 或 CDP 响应中的媒体 URL。
- 页面生成的 `blob:` 地址，再由对应账号的 View 内执行 `fetch(blob:)` 读取二进制。

但预览 URL 可能是缩略图、带水印版本、临时转码版本或受限播放流。`generic-video-capture.js` 的 URL 关键词评分只能帮助排序，不能代替平台字段确认。对于没有专用适配器的平台，媒体栏应显示“直接捕获/未确认原图”，而不是直接显示“无水印”。

### 8.5 下载器本身如何保存文件

解析和保存是两个独立阶段。解析阶段只产生 `MediaResource`，保存阶段由 [`MediaService`](app/src/main/media.ts) 统一完成：

1. `MediaService.add()` 校验账号存在、URL 必须是 `http(s)` 或 `blob:`，并按账号、媒体类型和语义 URL 去重。
2. 资源保存 `backupUrl`、`thumbUrl`、尺寸、过期时间、作品 ID 和 `confirmedNoWatermark` 等元数据。
3. `enqueue()` 生成 `DownloadTask`，按并发数进入队列；重复点击不会重复创建仍有效的任务。
4. `blob:` 资源必须回到原账号 View 中执行 `fetch(blob:)`，读取 ArrayBuffer 后写入文件，当前有 500 MB 上限。
5. HTTP 资源使用 `session.fromPartition('persist:account_<id>')` 发起请求，附带站点 Referer/Origin，使 Cookie、代理和账号上下文保持一致；主地址失败时尝试 `backupUrl`。
6. 数据先写入同名 `.part` 文件，成功后原子改名为最终文件；失败、取消和重试会清理临时文件。页面捕获到的 `blob:` 地址只属于对应账号的 WebContents，工作台会异步把它复制到系统临时目录并映射为 `workbench-media://preview/...` 供主界面预览；下载仍使用原始 Blob 地址回到对应账号页面读取。
7. 下载过程中记录字节数、总大小、进度、尝试次数和错误，并通过 IPC 通知 Renderer。

默认设置保留当前 Electron 的视频文件布局：Dola 和豆包视频分别保存到 `Dola/`、`豆包/` 目录，并从 `1.mp4`、`2.mp4` 等编号中选择第一个未占用的名称，同时检查 `.mp4`、`.webm`、`.mov` 和 `.m4v` 的同编号冲突。设置中的“视频下载目录”可以独立于普通下载目录；留空时回退到普通目录，素材库会同时扫描两处目录并对打开、定位、复制、删除和预览统一执行路径边界校验。设置中的“Dola / 豆包视频使用平台目录与编号”可以关闭该兼容行为，关闭后回到视频目录下的通用目录规则；编号选择还会考虑并发任务和 `.part` 临时文件，避免同一批下载重名。关闭编号兼容后，设置中的“普通资源文件名前缀”会应用到统一队列生成的普通图片/视频名称；保留编号兼容时，Dola/豆包视频仍使用 `1.mp4`、`2.mp4` 等旧版名称。

为保证旧 V4.4 资源目录的 1:1 可读性，另有显式的“V4.4 素材目录兼容”开关。开启后，视频写入对应视频根目录下的 `Videos/`，图片写入普通资源根目录下的 `Images/`；视频沿用 `1.mp4`…`1000.mp4`，图片使用 `图片_yyyyMMdd_HHmmss_fff.ext`。V4.4 迁移只在发现有效 `VideoDownloadRoot` 时自动开启，并同时填充普通/视频目录；新安装默认关闭，用户可在设置中手动切换，不会静默改变新项目的目录规则。

这条链路只下载服务器返回的字节，不会自动识别或修改视频帧中的水印。另有独立的“兼容播放”路径：用户在预览窗口主动点击后，`MediaService.convertForPreview` 使用 FFmpeg 将已取得的媒体转为 H.264/AAC fast-start MP4，默认输出写入系统临时缓存，不改变原始下载文件；V4.4 目录兼容模式则按旧版规则写入 `Videos/转码_<SHA256(url)>.mp4`，并可被素材库扫描。Windows x64 使用随包核心，macOS 使用对应随包核心或用户指定/PATH 中的 FFmpeg。它不是 HLS/DASH 分片合并、DRM 解密或去水印流程，m3u8、加密分片和受限播放器资源仍需平台专用下载实现。

### 8.5.1 人脸网格工具

旧版 `FaceGridToolWindow` 使用 `deploy.prototxt` 与 `res10_300x300_ssd_iter_140000.caffemodel`，先把最长边限制到 2500 像素，再以 0/90/180/270 度旋转输入执行 SSD 人脸检测，置信度和 NMS 阈值均为 0.3。新版本将模型作为本地 `face-grid-assets` 资源打包，主进程通过受校验的 IPC 提供模型字节，渲染进程把字节写入 OpenCV WASM 虚拟文件系统后按路径调用 Caffe importer，避免把模型路径或文件读写权限暴露给页面。

网格模式在检测到的脸部椭圆区域绘制菱形网格；脸部重组模式生成上下布局的结果图，并按旧版参数保留线宽、透明度、颜色和最大边缩放。保存由主进程完成：校验输入路径、图片 MIME、数据 URL 大小，使用临时文件和不覆盖的目标文件名。该工具仅做本地几何绘制，不做人脸识别、身份推断或云端上传。

### 8.6 去水印能力的可信度分级

建议把当前布尔字段 `confirmedNoWatermark` 逐步升级为可解释的质量来源：

| 等级 | 建议值 | 证据 | UI 文案 |
|---|---|---|---|
| A | `platform-download` | 站内下载接口返回，域名/路径/字段均符合平台规则 | 平台原视频/原图 |
| B | `explicit-original` | JSON 明确字段为 `original_media_info`、`no_watermark_url`、`large_images` 等 | 接口原图 |
| C | `decoded-token` | 旧版编码地址解析后得到合法媒体地址，且关联了当前作品 | 已解析原视频 |
| D | `direct-media` | DOM、网络或播放器直接捕获到的地址，但没有无水印字段证据 | 直接捕获 |
| E | `preview-or-unknown` | 缩略图、封面、poster 或无法建立作品关联 | 预览/未确认 |

目前代码仍把部分不同证据压缩成 `confirmedNoWatermark: boolean`，但通用 DOM 捕获不会再把普通页面地址伪装成 `no_watermark_url`；只有平台字段、令牌解析或已知下载链路才会给出更强的原始资源证据。迁移时应保留 `source`、`resolutionMethod`、`qualityEvidence` 和 `rejectedCandidates`，这样用户能知道“为什么被判断为原图”，排查站点改版时也有证据。

### 8.7 当前缺口、风险和实现边界

- 当前 `app/` 的 Dola 是“通用捕获 + 页面状态/React 关联 + 手动公开接口解析 + URL 变体 + fallback API/令牌解析 + Main 统一下载”；15/30 秒提交改为当前页面 UI 自动化，并在点击后由 CDP 观察 `/chat/completion` 请求，只有观察到实际请求且时长参数没有冲突才报告为已确认。
- 目录中的 `DoubaoAccountManager.dll` 反编译材料确实包含 `_2022` 低层 HTTP 提交、`/chat/completion`、`/im/chain/single`、文件上传和运行时指纹参数构造，但旧版调用链同时依赖 `DolaHealthStatus`、视频配额、活动租约、签名桥和授权程序集。它不能作为无依赖的跨平台实现直接复制；当前只迁移了可验证的页面协议、媒体解析和标准上传行为，不把旧租约/授权/机器绑定逻辑带入 `app/`。
- 豆包的两组扩展都有 Fetch/XHR 包装、按钮注入和下载能力，存在重复捕获、重复按钮和重复请求风险；需要统一适配器生命周期和去重键。
- 页面 `postMessage` 可以被页面自身脚本伪造，因此 `confirmedNoWatermark` 不能只由消息字段决定，必须由平台适配器在 Main 侧复核来源和字段。
- 内置扩展的下载按钮已经统一通过页面消息进入 `remote:media`/Main 队列，不再申请或调用 `chrome.downloads`；外部导入的第三方扩展仍需按扩展自身实现单独审计。
- 内置豆包下载扩展的弹窗只展示本地捕获统计，后台使用 `GET_STATUS`，已移除版本过期/激活门控；图片、视频转发链路不依赖该状态。
- 带签名的 CDN 地址有过期时间；不能把捕获到的 URL 长期缓存为永久下载链接。
- 站点接口、React Fiber 字段、播放器域名和 URL 标记会变化；专用插件需要 fixtures、真实站点回归和健康状态，而不能只靠字符串正则。
- 本文分析的是用户已登录且有权访问的内容，以及平台本身提供的原图/原视频接口。不会把“修改第三方鉴权、绕过 DRM、伪造服务端权限或删除他人作品的必要标识”作为产品能力。

推荐后续实施顺序：

1. 继续为豆包、Dola、千问、云雀、Higgsfield 和即梦收集经授权的真实站点 JSON/SSE/媒体 fixture，并按站点版本回归。
2. 在 Windows x64、macOS Intel、macOS Apple Silicon 分别执行双账号的 Cookie、Storage、代理、指纹、下载和文件权限端到端验收。
3. 在 macOS runner/真机生成两个独立 DMG，完成原生资源执行权限、签名、公证、Gatekeeper 和升级验收。
4. 为没有专用协议的 Kimi、oiioii、nano、Lovart 和自定义站点补充站点专用适配器；在有明确平台原始资源字段前，继续显示“未确认原图”而不是过度承诺。
5. 持续维护扩展下载路由、Dola URL/令牌解析和媒体质量证据的静态回归，跟随平台接口变化更新。

## 9. 代理与外部登录

代理配置挂在账号对象上，由该账号的 Session 调用 `setProxy()`。代理用户名密码使用 Electron `safeStorage` 加密后写入账号配置；未启用代理时使用系统网络。

代理认证事件在 Main Process 中根据 WebContents 所属账号匹配凭据，不能只根据目标主机匹配，否则多个账号使用同一代理地址时可能发生凭据串用。

外部登录服务使用本地临时端口和 Chrome DevTools Protocol 辅助登录，再把 Cookie 同步回对应账号。它属于登录辅助工具，不应使用全局默认 Session，也不应把不同账号的 Cookie 写入同一个临时目录。用户还可以从账号卡片显式执行“在外部浏览器打开”：服务先读取该账号的 `persist:account_<id>` Cookie，通过 `Network.setCookies` 注入外部浏览器，再导航到账号主页；这不是应用启动时的自动动作。批量外部模式通过平台无关的 `externalLoginState` 读取目标站点 Cookie：Dola/Higgsfield 在人工完成验证码、2FA 或页面点击后，检测到稳定登录标志才同步回对应 Electron Session 并关闭该辅助浏览器，不读取密码，也不绕过第三方验证。

Dola 批量登录另外提供内置模式：直接复用对应账号的 `WebContentsView` 和 `persist:account_<id>` Session，临时移动到独立的 Electron 批量窗口并按网格可见，按当前页面可见的登录控件填入邮箱和密码，不启动系统 Chrome。关闭批量窗口后，View 会重新挂回主工作台并恢复原来的主/副窗口布局。内置模式还支持在账号页面上记录登录/Google 控件的比例点位，并用 CDP `Input.dispatchMouseEvent` 测试点击；DOM 无法识别时可将已保存点位作为人工可见控件的后备入口。内置与外置模式共用“遇到验证码、2FA、通行密钥即停止并交给人工”的边界；密码只在 Renderer 当前窗口和一次 IPC 调用期间存在，不写入账号配置或日志。

批量登录不会把每个账号都强制拉起外部浏览器：内置模式在一个批量 Electron 窗口中最多显示 20 个独立 `WebContentsView`，超过 20 个时按批次复用该窗口，自动填入仍最多 4 个并发；外部模式最多 10 个独立 Chrome/Edge 辅助进程并发。外部批量模式会按当前屏幕可用区域计算窗口网格，通过 `--window-position`/`--window-size` 传给 Chrome/Edge；这些参数是跨平台的尽力布局，macOS 窗口管理器可能调整最终位置。单账号“打开登录浏览器”不传布局参数，仍只启动用户主动选择的一个外部浏览器进程。

Higgsfield 批量登录复用同一套受限 DOM 辅助，但使用独立的 `higgsfield.ai` 入口识别和账号 Session，不复用 Dola 的固定点位。登录成功后保留旧版课程页行为：`/quiz` → introduction → set-up-your-project；这只是正常页面导航，不代表绕过平台验证。Dola/Higgsfield 的 Google 账号输入、密码输入和继续按钮都通过页面可见控件完成；遇到验证码、2FA、通行密钥或手机号验证时交给用户，外部模式会轮询目标站点 Cookie，检测到稳定登录态后自动同步回对应账号并关闭辅助浏览器。

### 9.1 sing-box 在 V4.4 中的作用

`sing-box` 是 V4.4 使用的外部代理核心，不是浏览器插件、不是账号 Session，也不是指纹生成器。它负责把代理订阅中的节点协议转换成实际的网络转发，并在本机开启一个只监听回环地址的代理端口。

V4.4 的实际链路是：

```text
订阅 URL / sing-box JSON / Clash YAML / V2Ray Base64
                         │
                         ▼
              SubscriptionParser.Parse()
                         │
        解析节点名称、协议、服务器、端口、TLS、传输参数
                         │
                         ▼
        生成 sing-box config.json，保留 outbounds 节点
                         │
                         ▼
       启动 sing-box.exe run -c config.json
                         │
       127.0.0.1:<动态端口>（本地 SOCKS5 入站）
                         │
                         ▼
    WebView2 --proxy-server=socks5://127.0.0.1:<端口>
                         │
                         ▼
            选择的 VMess/Hysteria2/其他出口节点
```

#### 它具体解决什么问题

- 将一条订阅 URL 转为可选择的节点列表。
- 支持 V4.4 代码识别的 sing-box JSON、Clash YAML，以及包含 VMess/Hysteria2 的 V2Ray URI/Base64 订阅。
- 统一处理 VMess、Hysteria2、TLS、SNI、WebSocket、gRPC、HTTP transport 等节点参数。
- 为浏览器提供一个本地 SOCKS5 入口，浏览器不需要理解 VMess/Hysteria2 等上游协议。
- 通过 sing-box 的 selector 和 Clash API 在本地切换节点、测试延迟、获取出口 IP。
- 将 DNS 解析配置到 sing-box 的本地 DNS resolver，再把流量路由到所选 outbound。

#### V4.4 的启动模式

V4.4 不是把系统所有网络直接改成 VPN，而是给 WebView2 传入 `--proxy-server`，所以其主要作用范围是应用内浏览器。反编译结果中普通运行配置使用 `socks` 入站，测速/出口 IP 检测配置使用 `mixed` 入站；没有看到把系统网卡改成 TUN 的主运行链路。

V4.4 按“国内/海外”两个代理区域管理进程：

- 启动时分别检查两个区域的订阅配置。
- 每个区域启动一个 `sing-box.exe`，使用动态本地端口。
- 生成 `process.pid` 等状态文件，避免多个程序实例重复占用同一代理服务。
- 关闭程序或切换配置时终止对应进程并清理临时工作目录。
- WebView2 根据实例所属区域，使用该区域的本地 SOCKS5 端口。

这里有一个对多账号项目很重要的边界：V4.4 的 sing-box 代理主要是“区域级共享”，不是天然的“每账号一个出口”。同一区域的多个浏览器实例可能使用同一个本地代理进程和同一个选中节点；而 Cookie、LocalStorage、Cache 等仍由每个账号自己的 WebView2 用户目录隔离。网络出口隔离和浏览器数据隔离是两件独立的事。

#### 节点测速和出口 IP 检测

测速不是直接让每个 WebView2 页面去访问节点，而是启动一个临时 sing-box 配置：

1. 给候选节点建立 selector。
2. 开启临时 Clash API。
3. 通过 `/proxies/<tag>/delay` 请求固定的连通性测试地址，记录延迟。
4. 逐个切换 selector，再通过本地代理请求出口 IP 检测服务，记录 `RealIp`。
5. 测试完成后关闭临时核心并删除临时目录。

这类测试会产生真实的网络请求，也会把订阅中保存的节点凭据交给 sing-box 使用。生产实现应避免把完整配置、UUID、密码和订阅响应写入普通日志。

#### 当前 Electron 工程的状态

`app/` 已实现 `ProxyService`、`SingBoxRuntimeManager` 和订阅解析器：

- 账号可以保存直连、HTTP/HTTPS/SOCKS5 或订阅模式。
- 订阅支持 sing-box JSON、Clash YAML、V2Ray Base64/URI，并把节点和原始配置保存到该账号。
- 每个订阅账号分配独立回环 SOCKS5 端口、独立配置目录和独立 sing-box 子进程；账号 Session 只连接自己的回环端口。
- 支持刷新订阅、选择节点、节点测速/出口 IP、运行状态和明确失败原因；核心崩溃或缺失时不会自动切换到直连。
- “全部测速 / 出口 IP”会启动一次临时 selector + Clash API 运行时：延迟请求最多并发 8 条，出口 IP 逐节点切换 selector；完成后销毁临时进程，并把账号 Session 恢复到原来的正式 sing-box 端口，避免把打开的页面留在测试端口上。
- `app/sing-box/` 已放入官方 sing-box v1.13.19 的 Windows x64、macOS x64 和 macOS arm64 核心，并用 `native-resources.json` 固定来源与 SHA-256；正式发布仍必须在对应平台通过执行权限、签名、公证和运行时验证。

因此开发环境可以使用直接 HTTP/HTTPS/SOCKS5 代理，当前三个目标架构也已经具备订阅代理所需的原生文件；启用订阅模式前仍要用真实订阅在 Windows/macOS 上验证节点协议和网络权限。

#### 跨平台迁移建议

如果继续使用 sing-box，建议把它拆成独立的 `ProxyService`：

1. `SubscriptionService`：下载并解析订阅，限制大小，校验格式，保存节点元数据。
2. `SingBoxProcessManager`：按平台和 CPU 架构选择核心，生成临时配置，启动/停止进程，监控端口和退出状态。
3. `NodeTestService`：通过本地控制 API 测速、切换节点和查询出口 IP。
4. `ProxyRoutingService`：把账号或区域映射到本地端口，并向 BrowserManager 提供代理 URI。
5. `ProxySecretStore`：使用 Electron `safeStorage` 或系统钥匙串保护订阅凭据和节点密码。

Windows/macOS 需要分别随应用提供经过验证的 sing-box 核心（Windows x64、macOS x64/arm64），并纳入代码签名、公证、杀毒误报和升级测试。核心二进制不应由 Renderer 下载或直接执行；应由 Main Process 校验路径、权限和版本后启动。

如果目标是“每个账号独立网络身份”，不能直接照搬 V4.4 的区域级共享模型，应为每个账号建立独立本地入站/端口和明确的 outbound 选择，或至少为共享代理模式在 UI 中明确显示“同区域共享出口”。无论采用哪种模式，都不能把 sing-box 的共享出口误认为已经实现了账号数据隔离。

## 10. 指纹配置现状

V4.4 反编译代码中有独立的 `fingerprint_config.json` 机制：

- 每个实例的配置保存在实例自己的 `UserDataFolder`。
- “随机生成”实际是从几套固定的 Windows Edge 模板中随机选择，再随机选择少量 CPU/内存字段。
- 配置覆盖 UA、Client Hints、语言、时区、平台、硬件并发数、屏幕、DPR、WebGL、WebRTC 策略，以及 Canvas/Audio 噪声开关。
- 启动时设置 WebView2 UA，并注入 JavaScript getter。

这不是完整的“随机硬件”，也不能改变操作系统真实 GPU、字体、TLS 栈、网络出口或所有浏览器特征。随机指纹应当在账号创建时生成一次，之后持久化；每次启动都更换会让同一账号表现为新设备。

当前 `app/` 已有 `FingerprintService` 和账号级 `fingerprint` 配置：

1. `Account` schema 版本为 2，账号创建时生成稳定种子，启动时复用。
2. Windows 和 macOS 使用与自身平台一致的 UA、平台、Client Hints、尺寸和 WebGL 模板。
3. 指纹脚本通过 CDP `Page.addScriptToEvaluateOnNewDocument` 在页面文档创建前注入，并同时调用 `Network.setUserAgentOverride`。
4. Canvas/Audio 噪声、WebRTC 策略、屏幕、DPR、语言、时区、硬件并发和内存都可独立配置。
5. `disable_non_proxied_udp` 会在文档创建前包装 `RTCPeerConnection`，将 ICE 策略限制为 `relay` 且不注入非代理 UDP 候选；这能降低本地地址泄漏风险，但不等于把任意 WebRTC 流量转换为 sing-box 代理流量。真实 GPU、字体、TLS 和网络层指纹不在承诺范围。

## 11. V4.4 .NET 架构与跨平台边界

V4.4 主工程项目文件使用：

```text
Microsoft.NET.Sdk.WindowsDesktop
UseWPF = true
TargetFramework = netcoreapp8.0
Microsoft.Web.WebView2.Wpf
OpenCvSharp
```

主窗口还使用了 `System.Windows`、Win32 P/Invoke、Windows 注册表、WebView2 环境参数和 Windows 文件属性。外层启动器使用 Windows Forms、注册表和 WebView2 Runtime 检查。

因此：

- 这些程序集可以作为功能参考和 Windows 旧版维护参考。
- 不能把 WPF/WebView2.Wpf 主窗口直接编译成 Mac 应用。
- Mac 端应由 Electron 的 Chromium/WebContentsView 替代 WPF/WebView2 容器。
- 如果未来确实需要复用 .NET 业务逻辑，应拆成不依赖 UI、Win32、注册表和 WebView2 的 `net8.0` 类库；但当前浏览器主链路没有必要引入 .NET 运行时。

## 12. 功能等价矩阵

| 功能 | `app/` 当前情况 | V4.4 参考情况 | Mac 迁移工作 |
|---|---|---|---|
| 账号元数据 | 已有 | 已有 | 补充迁移兼容 |
| Cookie/缓存/存储隔离 | Electron Session 已有 | WebView2 实例目录已有 | 做双账号自动化测试 |
| 双视图/多账号 View | 已有基础实现 | WPF 多实例 | 做性能和生命周期回归 |
| 直接代理 | 已有 | 已有 | 验证 macOS 网络权限 |
| sing-box 订阅代理 | ProxyService/运行时/解析器和 v1.13.19 三架构核心已实现 | V4.4 已有 | 在三目标平台做真实订阅、协议和权限回归 |
| 通用媒体捕获 | 已有 | 已有 | 以真实站点测试 |
| 平台专用资源解析 | 豆包、Dola、云雀、即梦已有专用链路，其余为通用捕获 | V4.4 更完整 | 按平台真实站点继续补适配器 |
| 内置/自定义插件 | 内置扩展按账号 Session 加载；ZIP/CRX/目录导入、启停、删除和热同步已有 | V4.4 有插件管理器 | 做跨平台扩展兼容回归 |
| 下载队列/素材库 | 已有 | 已有 | 验证文件权限和路径 |
| 外部浏览器登录 | 已有基础实现；支持登录辅助和当前 Session Cookie 带入 | 已有 | 验证 Chrome 路径和 CDP |
| Dola 批量登录 | 内置 WebContentsView 与外部 Chrome/Edge 两种辅助模式；凭据仅内存使用 | 已有 | 做站点回归 |
| Higgsfield 批量登录 | 内置 WebContentsView 与外部 Chrome/Edge 两种辅助模式；课程页跳转保留 | 已有 | 做站点回归 |
| Dola 视频任务 | 15/30 秒页面 UI 提交 IPC 已有；支持最多 9 张参考图、最多各 10 个音频/视频参考素材通过标准文件输入附加；30 秒页面桥已接入；donor 签名桥未复制 | V4.4 有 | 真实站点回归并根据公开页面能力调整 |
| 随机指纹 | 账号级稳定模板和前置注入已实现 | 已有 | 在三种目标打包环境验证 |
| 水印渠道/视频预览 | 平台原始资源候选、Dola resolver、统一预览/下载和素材预览已实现 | 已有 | 补齐站点专用接口，禁止像素擦除/DRM 绕过 |
| 授权/卡密启动门槛 | 新工程已移除 | 参考代码中存在 | 不进入 clean app |
| 外层自解压启动器 | 不需要 | Windows 专属 | 用 electron-builder 打包 |

## 13. Windows/macOS 构建方案

`app/package.json` 已加入：

```text
npm run pack:mac   # macOS 未签名目录包，调试用
npm run dist:mac   # macOS DMG
npm run pack:win   # Windows 目录包
npm run dist:win   # Windows portable
```

目标架构：

- Windows：优先 x64，后续可评估 arm64。
- macOS：x64 + arm64，配置生成两个独立 DMG，不生成 Universal 包。

Electron 会把 Chromium 和 Node.js 随应用分发，因此最终用户不需要预装 .NET、Node 或独立 Chromium。Electron 官方说明：[Electron 文档](https://www.electronjs.org/docs/latest)。

建议构建矩阵：

```text
Windows runner → npm ci → typecheck → test → build → dist:win
macOS runner   → npm ci → typecheck → test → build → Electron smoke（含站点适配器/任务流程） → .app/DMG → audit-package → verify:mac-release → smoke-packaged
```

macOS 签名和公证需要在 macOS 环境完成；electron-builder 也明确说明 macOS code signing 不能在普通 Windows 环境替代完成：[Multi Platform Build](https://www.electron.build/docs/features/multi-platform-build/)。

当前工程锁定 Electron 43.1.1。功能稳定后应单独建立 Electron 升级分支，逐项回归 `WebContentsView`、CDP、扩展、媒体捕获、代理和 macOS 权限，不要在功能迁移过程中同时大版本升级。

## 14. 测试策略

### 14.1 已有测试

现有 235 项测试覆盖：

本轮 `smoke:all` 实际包含并通过 15 个 Electron/站点 smoke：旧版 API 表面审计、账号隔离、跨进程 Session 重启、文档脚本、指纹运行时、平台页面适配、站点适配器夹具、任务流程夹具、结构化存储、批量工作区、视频提醒、sing-box、人脸网格、GUI renderer 预览和公开站点入口；另有 Windows 目录包 `smoke:packaged`。平台页面夹具验证 Kimi/Dola 通用捕获，站点适配器夹具验证 Dola 30 秒请求、豆包创作扫描、Higgsfield 课程跳转和即梦原图按钮桥接，任务流程夹具验证 Dola 15/30 秒页面操作、豆包 15 秒提示词发送和豆包账号级 15/30 秒页面设置。各 Electron smoke 的异常都会以非零退出码传递，避免总检查误报成功。

`smoke:gui` 另外使用临时用户目录和模拟数据，在真实 Electron renderer 中渲染 18 个账号、素材卡片和三栏工作区，点击“更多工具”，依次挂载设置、素材库、登录辅助、Dola/Higgsfield 批量登录、人脸网格、V4.4 迁移和诊断 8 个核心面板，再切换深浅主题后截图；该检查用于 GUI 布局/交互骨架回归，不把模拟数据当作真实站点验收。

- IPC 安全。
- Renderer 连接状态可视化：直连、订阅代理运行中、启动中和失败阻断状态映射。
- 账号拖拽排序按目标卡片上下半区恢复旧版 before/after 落点行为。
- 视频素材卡片优先使用真实视频预览，有海报时回退到图片，无地址时保留占位状态。
- 公开更新目标选择、平台/架构兼容性校验和跨平台更新包拒绝。
- 代理规则。
- 路径安全。
- 媒体解析和去重。
- 平台适配器。
- 数据目录和设置。
- 浏览器数据目录选择、默认目录恢复、可写性检查和 macOS 应用包路径保护。
- 账号服务。
- 下载任务服务。
- 插件目录/ZIP 导入、Manifest 校验、启停、删除和压缩包路径穿越防护。
- 订阅格式转换、账号级指纹稳定性、跨 Windows/macOS 迁移时保持种子并重建系统相关指纹、Dola URL/Token 解析、Dola 任务脚本语法和 Yunque 原始资源过滤。
- Dola 页面桥接脚本语法/安全边界、公开 play-info/chain 响应中的 Base64/qAAB 令牌解析，以及旧版 duration/action-bar 响应形态。
- Dola 30 秒/音视频页面桥接脚本安全边界、参考素材扩展名/数量/大小校验，以及标准文件输入准备和 change 事件脚本。
- Dola 参考音视频上传状态探针在“页面状态可观测且仍上传”时不会误报为可提交。
- 账号页面恢复地址校验、代理认证的账号归属隔离，以及 WebRTC 限制脚本生成。
- 媒体下载响应类型纠正和 HTTP 200 错误页拒绝。
- 旧版豆包消息/播放信息 fixture 解析，以及 `lr=watermark` 到 `video_gen_no_watermark` 的受限路由升级。
- 豆包页面规则和下载扩展对 `no_watermark_url`、`watermark_free_url`、`unwatermarked_url` 及 camelCase 别名的候选保留，以及千问扩展主机权限与页面声明一致性。
- 单节点和全部订阅节点测速后的延迟/出口 IP 保存，以及批量测试完成后的原节点和 Session 恢复。
- 旧版千问 message-list 的 `thumbnail_url` 和 `src + poster` 字段解析。
- 千问 API 图片缺少尺寸时的 endpoint 证据保留规则。
- 主页、恢复页和自定义网站地址仅允许 HTTP/HTTPS。
- FaceGrid 模型文件 SHA-256/大小/结构资源校验、OpenCV DNN 浏览器构建 smoke，以及 Windows FFmpeg 实际兼容转码和缓存复用；macOS FFmpeg 资源有固定版本、SHA-256 与 Mach-O 架构校验。
- 账号 JSON 导入导出往返时浏览器、指纹、订阅地址和节点元数据的保留，以及代理密码不落盘。
- 诊断快照的任务统计、账号 Session/代理/指纹状态映射，以及敏感代理密码不会进入快照。
- 豆包创作脚本入口、平台下载信息调用和统一主进程资源桥接入口。
- 结构化 IndexedDB 导入归一化、特殊值标记和脚本边界。
- V4.4 多账号 `fingerprint_config.json` 的显式目录优先、ID/名称唯一匹配和平局保护。
- Electron 43 `WebContentsView` 的空白 renderer bootstrap、目标导航前平台脚本注册，以及首个 Fetch 捕获时序。
- 通用平台适配器对 JSON/SSE 网络响应中的图片和视频资源解析。
- `captureMode` 的默认值以及全部/图片/视频三种模式的资源过滤。
- Dola 视频生成提醒脚本、通知元数据边界和主进程消息通道约束。
- `smoke:platform-pages` 在真实 Electron `WebContentsView` 中加载本地 Kimi/Dola 页面 fixture，验证通用脚本的图片/视频捕获、Dola 生成完成通知、视频浮层和 sandboxed remote preload 到主进程的消息路由；另以不加载通用页面脚本的独立 View 验证 remote preload 的 DOM 兜底捕获；同时覆盖页面 DOM 尚未完成时的延迟观察器启动和显式图片 MIME 提示优先级。
- `smoke:legacy-config -- --source <V4.4 config.json>` 会在 Electron 环境中只读调用迁移预览，对旧版 `AppConfig` 的账号类型、指纹文件、区域代理、下载目录和 Boss Key 做结构化验收；追加 `--sandbox-import` 会将导入目标替换为临时目录和内存假服务，验证 schema 导入与备份生成，但不会写入原配置或账号目录。它不会复制 WebView2 数据库，也不会输出账号凭据。当前已对本机真实 V4.4 配置验证 6 个账号、6 个指纹和两个区域代理配置，沙盒导入 6/6 成功。
- 通用 API/网站下载图片在缺少宽高时的来源校验、UI 头像过滤和资源面板保留规则。
- 实验性响应补丁开关变化时，仅重建实际启用 CDP 响应拦截的已打开账号，普通平台不被无谓刷新。
- SingBoxRuntimeManager 管理的核心进程被终止后会上报 `failed` 且不自动降级到直连，只有显式 `restart` 才重新建立运行时。
- Dola 嵌套/转义 JSON 与 SSE 片段中的 `fallback_api` 提取、malformed URI 的容错和严格 Base64 输入边界；CDP 回退解析沿用实际响应 URL 作为 Referer，且只有成功解析后才抑制重复 API，瞬时失败可以重试。
- 旧版 `image_ori_raw.url` 无扩展名平台原图字段的高可信资源识别，以及窗口销毁/重建时持久 Session `will-download` 监听器的卸载。
- 主窗口关闭/应用退出时的代理子进程清理队列：macOS 关闭窗口后再显式退出会等待同一 Promise，前一次清理失败也不会阻塞后续清理。

另有 Electron 集成 smoke：`npm run smoke:isolation` 创建两个真实 `WebContentsView` 和两个 `persist:account_*` Session，在本地页面交叉验证 Cookie、LocalStorage、IndexedDB、CacheStorage 不可互见；它证明的是 Session 分区，不代替真实网站双账号验收。

`npm run smoke:proxy-runtime` 还会直接启动项目携带的官方 sing-box 核心两次，验证两个回环 SOCKS 端口和 PID 独立、停止 A 不影响 B，并清理测试进程；这是进程生命周期证据，不代替真实订阅节点和 macOS 执行权限验收。

`npm run smoke:storage-import` 在两个真实 `WebContentsView` 的持久化 Session 中执行结构化导入，验证 LocalStorage、IndexedDB 记录、索引和 ArrayBuffer 标记可以读回，同时第二个 partition 不可见；这是迁移脚本和 Session 隔离证据，不代替旧版完整 WebView2 数据库复制。

`npm run smoke:batch-workspace` 直接用 Electron 创建两个真实 `WebContentsView`，验证它们可以从主工作台挂到批量登录窗口、设置可见网格 bounds，再挂回主工作台；它验证容器生命周期，不代替 Dola/Higgsfield 的真实站点登录验收。

`npm run smoke:document-scripts` 使用本地页面的首段内联脚本和首个 Fetch 验证：适配器脚本在真实目标导航前已经注册并能捕获首个请求；它证明的是 Electron 43 的脚本注入时序，不代替真实站点兼容性验收。

`npm run smoke:fingerprint` 先构建 `src/main/fingerprint-runtime.ts` 这个仅供 smoke 使用的导出入口，再用真实 Electron `WebContentsView` 注册生产构建中的 `buildFingerprintScript`。本地页面首段会读取前置注入标记，随后检查 UA/UA-CH、屏幕/DPR、时区、Canvas 噪声和 `RTCPeerConnection` 的 relay 策略；它证明的是脚本在 Chromium 文档中的实际运行效果，不证明真实 GPU、字体、TLS 或第三方反指纹检测结果。

`npm run smoke:video-notice` 使用本地页面模拟 Dola 的生成状态和新视频卡片，加载真实构建的 `remote.js` 与页面资源桥，验证生成提醒经 `window.postMessage` 到达远程 Preload 的 IPC 通道且同一 key 不重复通知；同时点击视频浮层的“当前地址”，并派发旧版 `AIAM_ALT_ORIGINAL_MEDIA_FOUND` 公开资源事件，确认两条路径都进入 `remote:media` 且旧事件不会凭字段名被标记为无水印；它证明的是桥接时序和去重边界，不代替真实 Dola 页面版本验收。

新增的 `npm run smoke:real-sites -- --platform <id> [--account-id <id>] [--user-data <目录>] [--show]` 是显式 opt-in 的真实站点验收入口。它复用生产适配器脚本、远程媒体 preload、内置扩展和 `persist:account_<id>` Session；不传 `--user-data` 时使用临时目录并在退出时清理，传入已有工作台 Session 根目录时只读取页面状态和媒体消息统计，不输出 Cookie、密码或签名 URL。`--show` 允许测试人员手动完成登录、验证码、2FA 或 Passkey，`--expect-capture` 可把等待期间无媒体消息视为失败。配套的 `npm run smoke:real-sites:public` 会自动构建并在临时目录依次检查 10 个公开入口；本轮已全部实际通过，另有 `custom + example.com` 通过。它仍不能替代真实登录、任务提交、下载和 macOS 真机验收。

2026-08-28 追加回归中，`smoke:all` 实际包含并通过 15 个 Electron/站点 smoke（旧版 API 表面审计、账号隔离、跨进程 Session 重启、文档脚本、生成式指纹运行时、结构化存储、批量工作区、视频提醒、sing-box、人脸网格、GUI renderer 预览、公开站点入口、站点适配器夹具、Dola/豆包任务流程夹具等）以及 Windows `smoke:packaged`；另用 opt-in `smoke:real-sites` 在临时 Session 对 10 个公开平台入口逐个通过页面加载、适配器注入和媒体消息统计。视频提醒 fixture 还验证逐视频浮层到 `remote:media` 的真实消息路径，指纹 fixture 还验证生产构建脚本在页面首段前注入并生效，站点适配器夹具还验证 Dola 30 秒请求、豆包创作扫描、Higgsfield 课程跳转和即梦原图按钮桥接，任务流程夹具还验证 Dola 15/30 秒页面操作和豆包 15 秒提示词发送。公开站点结果仅证明入口可达、脚本可注入和部分公开媒体可捕获，不能证明登录、捕获、下载或任务权限。打包 smoke 实际启动目录包并保持 6 秒后清理进程；macOS runner 会对 `.app` 使用同一脚本。新增 `verify:mac-release` 只在 macOS 执行：读取 `Info.plist`，检查 Bundle identifier、图标、主程序执行权限、目标 Mach-O 架构、随包 sing-box/FFmpeg 的执行权限与 SHA-256，并以只读方式挂载 DMG 后复核其中的 `.app`；传入 `--signed` 时还会执行 `codesign --verify` 和 `spctl --assess`。另增加了同一账号并发打开请求合并及初始化失败清理，避免重复创建或残留失效的 `WebContentsView`；内置豆包扩展的版本/激活门控静态回归也已通过。顶栏深浅主题一键切换已在打包 GUI 中实际切换浅色后恢复深色，窄栏批量操作改为可读网格，素材无地址时不再渲染空图片元素；实验响应补丁开关现在会即时重建需要该拦截的已打开账号；普通/视频下载目录分离已在单测和打包版设置 GUI 中回归。

### 14.2 必须补充的端到端测试

文档口径校正：上一条追加回归说明中的“10/11 个 Electron/站点 smoke”沿用了旧统计；当前 `smoke:all` 实际包含 15 个，另外单独运行 Windows `smoke:packaged`。这两类本地检查都不等同于真实登录站点或 macOS 真机验收。

2026-08-28 最新媒体响应回归：解析器支持连续 `data:` SSE、NDJSON 和有界嵌套 JSON 字符串，Dola 嵌套响应中的公开 qAAB 令牌也会进入现有种子解码流程；新增 4 项测试后总数为 242 项（36 个测试文件），`smoke:all` 全部通过。所有地址仍需通过现有媒体字段、HTTP(S) 和安全过滤，不扩展到授权、DRM 或本地像素擦除。

2026-08-28 任务流程回归：`npm run smoke:task-workflows` 在真实 Electron `WebContentsView` 中验证 Dola 15 秒和 30 秒页面 UI（时长、画幅、Seedance 2.5、提示词和生成按钮）、豆包 15 秒提示词发送，以及豆包账号级 15/30 秒页面设置（localStorage、桥接事件、Seedance 2.5 检测）。测试使用本地正常页面 fixture，不接触真实账号，不代表真实生成、配额、文件上传或下载已完成。

1. 创建账号 A/B，分别写入测试 Cookie 和 LocalStorage，确认互不可见。
2. 关闭应用后重启，确认两个 Session 状态仍分别恢复（本地 `smoke:session-restart` 已验证 Cookie、LocalStorage、IndexedDB、CacheStorage；真实第三方登录态仍需站点验收）。
3. 为 A/B 设置不同代理，确认请求出口和认证凭据不串号。
4. 让 A/B 同时加载页面，确认媒体资源的 `accountId` 始终正确。
5. 测试扩展在多个 Session 中重复加载不会污染其他账号。
6. 测试浏览器崩溃恢复不会把 A 的 View 替换成 B 的 View。
7. 在 Windows x64、macOS Intel、macOS Apple Silicon 上分别测试下载、文件选择、外部登录和权限弹窗。
8. 对指纹配置做“账号创建、重启、修改、清除”四个生命周期测试。

### 14.3 发布前验收标准

- 两个账号可以同时保持不同网站登录状态。
- 任意账号清除 Cookie 不影响其他账号。
- 下载文件不会跨账号归档。
- 页面捕获资源不会显示在错误账号下。
- 未设置代理时功能正常，设置代理后认证不串号。
- Mac 无需安装 .NET 即可启动基础功能。
- Windows 版与 Mac 版的 IPC 合约和数据格式保持一致。

## 15. 推荐实施顺序

### 当前实现进度

- 保持 `app/` 为唯一构建入口。
- 不直接修改 `reference-original/`。
- 统一数据模型、IPC、双账号 Session 生命周期和迁移向导已落地。
- Windows x64 目录包和 portable 单文件包均已在本机重新构建并验证，随包携带官方 sing-box v1.13.19 三架构核心；正式发布仍需正式代码签名证书和更新渠道配置。

### 下一阶段

- 在 Windows x64、macOS Intel、macOS Apple Silicon 做双账号代理/指纹/下载端到端测试。
- 逐个平台用真实登录态回归媒体解析、Dola 15/30 秒页面提交和登录辅助。
- 内置扩展已收口到主进程下载队列；继续补齐真实站点适配、公开更新发布链路和 macOS 签名/公证。

### 阶段三：Mac 适配

- 处理 macOS 文件权限、外部 Chrome 路径、快捷键和窗口行为。
- 在 macOS x64/arm64 真机上确认原生资源执行权限、签名和公证。
- 在真实 Mac 上做登录、媒体捕获、下载和多账号压力测试。
- 配置签名、公证、DMG 和更新渠道。

### 阶段四：发布与维护

- Windows/macOS 分开构建、分开签名。
- 保留旧 Windows 版本作为回滚和对照，不与新版本共用 Session 目录。
- Electron 升级单独走回归流程。
- 所有平台专用代码通过 adapter 或 platform service 隔离。

## 16. 开发约束

- 不运行或修改原始 EXE；原分析材料只读保存。
- `app/` 不引入授权启动门槛，不复制旧授权 API。
- 不使用全局默认 Session 承载账号页面。
- 不把旧 WebView2 用户目录直接复制成 Electron Session。
- 不在 Renderer 中增加 Node 权限。
- 所有外部页面输入、媒体 URL、文件路径和 IPC 参数都必须校验。
- 任何指纹配置必须按账号持久化，不能每次启动随机变化。
- 平台网站规则、页面结构和下载接口可能变化，必须以端到端测试结果为准，不能只依赖静态单元测试。

原生下载兼容性：`BrowserManager` 对 `will-download` 使用文件名、URL 和 MIME 类型进行保守分类。图片/视频进入统一 `MediaService` 队列；非媒体文件不拦截，继续由 Electron 默认 `DownloadItem` 完成传输，同时沿用工作台配置的普通下载目录、账号子目录和重名避让规则；没有路径服务时才回退到 Electron 平台默认目录，不会取消下载。

媒体格式兼容性：`src/main/media-formats.ts` 是下载、素材库、CDP/API 解析和原生下载分类共用的格式边界。它按 MIME、URL 后缀和已读文件头识别旧版支持的 JPEG/PNG/APNG/WEBP/GIF/BMP/TIFF/AVIF/HEIC/HEIF/SVG/ICO/JXL 与常见视频容器；图片响应优先使用文件头，避免扩展名缺失或错误的 CDN 地址导致保存格式错误。页面通用捕获只扩展到低误报的媒体后缀，不自动扫描 SVG/ICO UI 图标；用户明确触发的 SVG/ICO 原生下载仍可进入主队列。

Dola 多候选资源回退：页面桥将同一作品在当前登录页面公开暴露的主地址、备用地址和其他视频候选归一化为 `alternateUrls`，最多保留 8 条且排除流媒体清单、脚本、头像和明显 UI 资源。`MediaResource`、sandboxed remote preload、IPC schema、`MediaService` 下载与预览链路均传递该字段；主进程按照主地址 → 备用地址 → 候选地址的顺序，在对应账号的持久 Session 中复用 Cookie、Referer、Origin 和代理尝试下载。候选地址只改善页面公开资源的 CDN 失败回退，不代表地址必然无水印，也不引入旧版直接扩展下载或授权路径。

Dola 旧响应字段兼容：`media-parser.ts` 对公开响应中的 `main_url`、`backup_url`、编号备用地址、`man_url`、`fplay_url`、`download_url`、`third_url` 等字段统一做 URL/媒体语义过滤。明确的 `backup_url` 作为首选备用地址，其余可用地址进入 `alternateUrls`，再由 IPC schema 和 `MediaService` 的候选上限、重复项及协议边界继续约束；这只恢复公开响应字段的候选保留，不复制旧版直接下载或授权逻辑。

豆包旧 `play-info` 候选兼容：`maowang-doubao/shared/platform-rules.js` 会合并 `original_media_info` 和全部 `play_infos`/`play_info` 中的主地址、备用地址及明确媒体字段，按主地址 → 显式备用地址 → 其他公开候选的顺序返回，最多 8 条候选并拒绝非 HTTP(S) 协议；旧 `doubao-download` 内容桥也保留这些候选后交给 `electronDownload`，最终仍由远程 Preload 和 `MediaService` 做 schema、账号 Session、路径和下载重试控制。

Dola fallback 多码率与 Blob 回退：`dola-resolver.ts` 按 `bitrate`/分辨率选择 `video_list` 中的最高质量地址，剩余最多 8 条已解码 HTTP(S) 地址进入 `alternateUrls`；`MediaService` 对候选地址按顺序尝试，若页面只保留 `blob:` 候选，则通过当前账号的 Blob 解析回调落盘或生成预览，避免把 Blob URL 当成可由 Session 直接请求的网络地址。

Dola 旧字段与候选可见性：解析器也接受公开响应中的 `no_watermark_url`、`watermark_free_url` 和 `unwatermarked_url` 令牌字段，并仅在页面已经提供解码种子/公开令牌时解码；素材面板会显示去重后的候选地址数量，便于用户判断是否存在 CDN 回退路径。候选数量不等于无水印保证，下载仍由主进程按地址顺序和账号 Session 执行。

Dola 旧事件兼容：旧版主进程/扩展可能通过 `AIAM_ALT_ORIGINAL_MEDIA_FOUND` 把页面已暴露的候选地址交给内容层，也可能通过 `AIAM_DOLA_RESOURCE_DOWNLOAD` 请求下载旧面板资源。当前 `dola-resource-bridge.js` 仅接受明确的 HTTP(S) 视频地址，统一归一化、保留备用地址和来源证据，再转成 `videoDataExtracted`/`electronDownload` 进入远程 Preload 与主进程下载队列；即使旧面板只提供 `thirdVideoUrl` 而没有作品 ID，也会以 URL 作为记录身份继续处理。旧事件的字段名不会单独提升为“已确认无水印”，资源定位无匹配时也不会回退到另一条任意视频记录，更不会重新启用旧版直接扩展下载、伪造 skill 响应或授权路径。

Dola 参考音视频上传状态：标准文件输入设置和页面原生 `change` 事件只代表文件已交给网页，不能直接代表服务端附件已完成。`dola-duration-bridge.js` 在页面已有附件 Store 时只返回文件名匹配、绑定数、待上传数和失败数等摘要；`BrowserManager` 轮询最多 8 秒，状态为 `pending` 或 `failed` 时不让 Renderer 继续提交，Store 不可观测时则明确返回 `unavailable`，只确认页面接收了文件，不伪造服务端成功。

Dola 画幅设置：统一保存在 `AppSettings.dolaAspectRatio`，旧版本 Renderer 使用的 `dola-video-ratio` 会在首次打开批量面板时兼容读取并写回统一设置，避免不同渲染上下文之间出现画幅偏好分裂。当前选项与旧版任务对话框一致，为 `1:1`、`3:4`、`4:3`、`9:16`、`16:9`、`21:9` 六种；IPC、迁移校验和 GUI 共同使用同一枚举，非法画幅不会进入页面脚本。



