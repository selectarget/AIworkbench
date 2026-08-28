# V4.4 / 旧 Electron 功能迁移验收矩阵

文档日期：2026-08-28  
正式构建入口：`D:\GitProject\test\mac-source-rebuilt\app`  
参考材料：`reference-original/electron-source/`、`reference-original/v44-dotnet/`

## 读法

- **代码完成**：当前 `app/` 已有实现，并有单元测试或打包审计支撑；仍需真实站点冒烟时，不代表线上兼容性已经保证。
- **部分迁移**：主链路已重建，但旧版本还有站点专用分支、数据格式或交互未完全复现。
- **待平台/真实站点验收**：实现已存在，当前主机不能提供相同的登录态、站点环境或 macOS 构建链路。
- **明确不支持**：不是遗漏，而是跨平台方案的安全或范围边界。

统计校准（2026-08-28）：本轮新增旧版代理订阅转换字段保留、严格 Base64/大小边界、媒体 URL 归一化及回归测试后，当前本机测试总数为 267 项（36 个测试文件）；下方历史追加段落中的旧测试数量仅保留执行记录，当前验收以本条和最新回归结果为准。

当前单元测试：267 项（36 个测试文件）；另有 Electron 集成冒烟覆盖账号隔离、结构化存储导入、目标导航前脚本注册和首个 Fetch 捕获、实际浏览器兼容脚本的首段执行及 `chrome.runtime`/插件/mimeTypes/connection/窗口尺寸兼容项、生成式指纹脚本在真实页面中的前置注入/UA/UA-CH/屏幕/时区/Canvas/WebRTC 运行时行为、Dola 视频生成提醒的页面桥链路，以及同账号 sing-box 并发启动复用验证。平台 fixture 还覆盖全部 11 个注册平台的安全主机匹配和旧版专用响应入口；`smoke:platform-pages` 进一步在真实 Electron `WebContentsView` 中验证 Kimi 通用图片/视频捕获、响应式 `srcset`、`<picture><source>`、受限 CSS 背景图、图片/视频类型优先级，以及不加载通用页面脚本时 sandboxed remote preload 的 DOM 兜底捕获；同时验证 Dola 视频资源、生成完成提醒和逐视频浮层；`smoke:site-adapters` 验证 Dola 30 秒请求改写、豆包创作页资源扫描、Higgsfield 课程跳转和即梦原图按钮桥接；`smoke:task-workflows` 还验证豆包账号级 15/30 秒页面设置和桥接事件；新增 `smoke:session-restart` 跨两个独立 Electron 进程复核持久 Session 的 Cookie、LocalStorage、IndexedDB、CacheStorage 和账号隔离。媒体解析单测另外覆盖 Dola 备用解析沿用账号 Session 的平台 User-Agent 并去除 Electron 标识、Dola fallback 实际请求 Header、紧凑 SSE、NDJSON 和有大小/深度边界的嵌套 JSON 字符串；插件导入单测覆盖目录、ZIP、CRX2、CRX3 和路径穿越防护；renderer/service 回归还覆盖已观察媒体候选的角色标注和主进程选择校验、HTTP 200 错误页/响应流中断后的候选回退以及失败候选状态推送；平台适配器关闭时，普通媒体、视频提醒和 Dola 令牌事件链均在主进程入口统一拒绝；新增发布配置回归确认 macOS x64/arm64 的签名、公证、审计和启动步骤仍在工作流中；程序化下载 URL 与 Chromium `will-download` 事件的账号级/默认 Session 短窗口去重也有单测覆盖；共享媒体 URL 工具还覆盖旧版 JSON/HTML 中的转义斜杠、Unicode 转义、外层引号和 HTML 实体，并在主进程去重与下载前统一校验 HTTP(S)/Blob 协议；订阅单测还覆盖旧版 VMess WebSocket/gRPC/HTTP-H2、TLS SNI/证书校验/ALPN/客户端指纹、hysteria2 带宽/混淆、严格 Base64 和 10 MB 大小边界。

最新本机回归（2026-08-28）：`npm run smoke:all` 通过，36 个测试文件共 267 项测试全部通过；Dola 解析器的跨平台 User-Agent 兼容测试、实际 fallback 请求 Header 测试、CRX2/CRX3 插件导入测试、平台适配器禁用状态统一门禁测试、程序化下载重复事件保护测试、媒体 URL 归一化测试以及旧版代理订阅字段保留测试均已纳入该统计。前文追加段落中的较低测试数属于历史基线，当前数量以本段和“当前单元测试”行为准。

下方“本轮 Windows 主机复核”及其后的追加段落保留历史执行时的测试数量和产物记录；最新数量、哈希和验收结论以本节上方的当前统计为准。

本轮 Windows 主机复核（2026-08-28）：`typecheck`、251 项单元测试、账号隔离、文档脚本时序、Storage/IndexedDB 导入、双 sing-box 运行时、人脸网格模型加载、Dola 视频生成提醒页面桥、Dola 登录态 Cookie 检查、Dola 定位信息待解析/升级、Dola/ciciai 页面入口兼容、`electronDownload` 进入统一队列、通用 performance 媒体资源兜底、独立 Storage 导出别名/数组解析、V4.4 多账号 fingerprint_config 唯一匹配/平局不猜、目录-only ProfileRoot 账号发现、跨平台更新目标选择/架构包拒绝、GitHub 发布页安全打开、ProfileRoot 迁移提示和安装版数据目录解析、通用页面与响应中带显式 MIME/媒体类型的无扩展名 CDN 资源解析、启动时只保留成功打开标签并记录失败账号、账号 View 打开取消后立即重试、外部登录旧进程延迟关闭不会删除替代进程、外部 Chrome/Edge 关闭时按平台清理进程树、实验响应补丁开关按需即时重建、普通/视频下载目录分离与素材库双目录扫描、V4.4 `Videos`/`Images` 目录兼容、sing-box 真实运行时崩溃/显式重启恢复、嵌套/转义 JSON 中的 Dola `fallback_api` 提取、无扩展名 `image_ori_raw` 原图识别、严格 Base64 边界和 malformed URI 容错、窗口重建时 Session 下载监听器卸载、账号平台/自定义地址变更触发 View 重建、Dola 回退解析沿用实际响应 URL 作为 Referer 且失败后可重试、批量登录超过 20 个账号时按内置工作区上限分批、普通非媒体原生下载沿用工作台目录/账号子目录/重名避让、Dola 无水印令牌解码、素材候选数量展示/角色选择、HTTP 200 错误页和响应流中断回退、失败候选状态推送、参考音视频上传状态探针、千问扩展主机权限覆盖、豆包显式无水印字段候选保留和账号拖拽前后落点排序和视频素材卡片预览类型选择、后加载适配器脚本的单文档去重、指纹脚本先于网络 User-Agent 覆盖的时序、即梦极早新文档 DOM 初始化、旧版临时缓存扫描和活动目录保护均通过；Windows x64 目录包构建、952 个 asar 条目/30 个站点资源/3 个原生核心审计通过，`smoke-packaged` 打包版启动并保持运行 6 秒后清理进程。`smoke:platform-pages` 和 `smoke:site-adapters` 的失败码现在会可靠传递到总检查，避免出现“打印错误但总流程返回成功”。已启动打包后的 GUI 验证 25 个账号卡片、工作台按钮、Dola 批量面板及 15/30 秒、音频/视频参考素材入口。账号编辑时，已打开账号的代理、指纹和浏览器配置会即时应用；闭合账号不会因配置操作被自动打开。新增内置批量登录窗口会把多个账号 WebContentsView 临时放入可见网格，关闭后还原主工作台。删除账号时会额外清理该账号的外部登录辅助浏览器目录，普通关闭登录辅助仍保留目录以便继续登录。公开平台入口检查为 10/10 HTTP 可达，但该检查不代表登录、捕获、下载或任务权限已经通过。Windows 主机还校验了 darwin-x64/arm64 sing-box 与 FFmpeg 的 Mach-O 架构和 SHA-256，但这不等价于 macOS 执行权限、DMG、签名、公证或真实站点验收。另尝试执行 `pack:mac`，前置构建和资源校验通过后被 electron-builder 明确拒绝（Windows 不能生成 macOS 包），因此 macOS 产物仍未产生。

追加回归（2026-08-28）：`smoke:isolation`、`smoke:document-scripts`、`smoke:storage-import`、`smoke:batch-workspace`、`smoke:video-notice`、`smoke:proxy-runtime`、`smoke:face-grid`、`smoke:public-sites` 和 `smoke:packaged` 均退出码为 0；234 项单元测试还实际启动并终止 SingBoxRuntimeManager 管理的核心，确认崩溃上报为 `failed`、不会切换直连，只有显式 `restart` 才恢复；其中视频提醒 fixture 还验证动态视频卡片上的逐视频操作浮层，并实际点击“当前地址”确认消息经过 sandboxed remote preload 进入 `remote:media`；代理 smoke 验证两个独立回环端口/PID，公开站点 smoke 验证 10/10 入口可达，打包 smoke 验证 Windows 目录包实际存活 6 秒并清理。另修复同一账号并发打开时的 View 合并和失败清理竞态、旧版嵌套/转义 `fallback_api` 与 `image_ori_raw` 资源兼容、严格 Base64/URI 容错、窗口重建时持久 Session 下载监听器的可卸载生命周期，以及编辑账号平台/自定义地址后旧 View 适配器残留的问题；删除账号时会同时移除其外部登录辅助浏览器目录，避免已删除账号的 Cookie/授权状态残留；Dola 回退解析改为沿用实际响应 URL 作为 Referer，且只有成功解析后才抑制同一 API，瞬时网络/token 失败可重新尝试。内置豆包扩展的弹窗状态已改为本地捕获统计，移除版本过期/激活门控并有静态回归保护。顶栏深浅主题一键切换已补齐，并在打包 GUI 中实际切换浅色后恢复深色；窄栏账号批量操作改为可读网格布局，素材无地址时不再渲染空图片元素；普通账号批量创建上限恢复为 100，Dola/Higgsfield 超过 20 个时会确认后分批运行内置工作区；Dola 30 秒提交必须观察到明确的 `ability_type=17` 视频请求；连接状态会区分直连、订阅运行中、启动中和失败阻断。普通 PDF/ZIP/JSON 等非媒体原生下载现在也会沿用工作台配置的普通下载目录、账号子目录和重名避让规则，同时保留 Electron 原生 `DownloadItem` 生命周期。追加了豆包页面/下载扩展对 `no_watermark_url`、`watermark_free_url`、`unwatermarked_url` 及 camelCase 别名的候选保留，并补齐千问 qwen.ai/tongyi.aliyun.com 的扩展主机权限；这些变更只消费页面已公开的 HTTP(S) 候选，不新增 DRM、授权或像素擦除逻辑；账号拖拽排序已恢复旧版按卡片上下半区决定 before/after 的行为；资源面板已补回“打开链接”，由 Main Process 仅允许无凭据的 HTTP/HTTPS 地址交给系统默认浏览器；后加载适配器脚本按文档去重，指纹 Hook 与网络 User-Agent 覆盖的安装顺序有时序回归保护。
追加回归（2026-08-28）：`smoke:document-scripts` 还实际注册并执行 `site-assets/scripts/browser-compat.js`，页面首段读取到兼容标记，并确认 `chrome.runtime`、`navigator.plugins`、`navigator.mimeTypes`、`navigator.connection`、外层窗口尺寸及 `Document.hasFocus` 包装均已安装；隐藏测试窗口不会被错误断言为真实获得焦点。新增 `smoke:legacy-config`，对本机旧版 `C:\Users\selec\AppData\Local\DolaMultiBrowser\config.json` 做只读预览：6 个账号（4 豆包、2 Dola）、6/6 指纹文件匹配、2 个区域代理配置、旧下载目录和 Boss Key 均识别成功；`--sandbox-import` 进一步验证 6/6 账号通过 schema 导入并生成临时备份；原配置未改写，未复制 WebView2 数据库。

追加回归（2026-08-28）：`smoke:platform-pages` 发现并修复通用媒体脚本在 `documentElement` 尚未创建时提前安装观察器，以及带 `data-image-url` 的 CDN 路径因包含 `media` 关键词而被误判为视频的问题；当前 fixture 已验证 Kimi 图片/视频两类消息和 Dola 生成完成通知、视频浮层、统一 `remote:media` 路由。新增 `smoke:fingerprint` 使用构建产物中的 `FingerprintService` 脚本创建真实 `WebContentsView`，确认脚本在页面首段之前生效，UA/UA-CH、屏幕、时区、Canvas 噪声和 relay WebRTC 策略按账号配置呈现；禁用 GPU 的自动化环境没有 WebGL 上下文，因此真实 GPU/字体/TLS 指纹仍不在此证据范围内。新增 `smoke:site-adapters`，在真实 Electron `WebContentsView` 中验证 Dola 30 秒能力请求改写、豆包创作页公开下载信息扫描、Higgsfield 课程页有界跳转，以及即梦资产页原图按钮到 `remote:media` 的完整链路；同时修复即梦适配器在极早新文档阶段访问空 `documentElement` 导致正式注入失败的问题。

追加回归（2026-08-28）：`smoke:real-sites:public` 已将豆包、千问、Dola、云雀、Higgsfield、Kimi、oiioii、nano、Lovart、即梦 10 个公开入口逐一加载到真实 Electron `WebContentsView`，10/10 页面完成导航并观察到 `browser-compat.js` 与通用捕获桥；Dola 的公开入口在当前网络环境跳转到地区限制页，仍确认 Dola 专用桥已注册；Higgsfield 课程桥和即梦原图桥均在真实页面观察到。该结果只证明公开页面导航和脚本注入，不代表登录、生成、下载或账号权限已验收。

追加回归（2026-08-28）：Windows x64 portable 单文件包 `release/AI创作工作台-1.0.0-win-x64-portable.exe` 已按最新源码重新封装完成，大小 195,932,634 字节，SHA-256 为 `FD3AA73E04B77DC03CAD6FEF603DC034BA490BF3931CA53410A405C7ED4CF379`；它覆盖后的目录包再次通过 952 个 asar 条目/30 个站点资源/3 个原生核心审计和 6 秒启动 smoke，portable 文件本轮只做封装完整性校验，未重复启动以避免写入用户环境。

追加回归补充（2026-08-28）：对照 V4.4 Dola 任务对话框补齐六种画幅 `1:1`、`3:4`、`4:3`、`9:16`、`16:9`、`21:9`，并在共享契约、旧配置迁移、页面任务脚本和真实 Electron GUI/task fixture 中通过回归；非法画幅会在 schema/IPC 边界拒绝。

追加回归补充（2026-08-28）：新增 `smoke:session-restart`，先在两个 `persist:restart-*` Session 写入带持久期限的 Cookie、LocalStorage、IndexedDB 和 CacheStorage，再完全退出并启动新的 Electron 进程读取；两个账号均读回自己的数据且没有串号。该用例证明的是 Electron 持久 Session 的存储生命周期，不代表真实第三方登录态、网站服务端会话或所有临时 Cookie 都能跨浏览器重启保留。

追加回归补充（2026-08-28）：Dola 页面桥兼容旧版 `AIAM_DOLA_RESOURCE_DOWNLOAD` 的 URL-only 事件；当旧面板只提供 `thirdVideoUrl`、没有 `messageId`/作品 ID 时，归一化提示仍会把地址作为记录身份并进入统一下载队列。该地址仍按普通公开候选处理，不会仅因旧事件名称被标记为“已确认无水印”。`smoke:video-notice` 已同时覆盖带 ID 与 URL-only 两种事件。

## 功能矩阵

最新构建产物校准（2026-08-28）：Windows x64 portable 已按当前源码重新封装，大小 195,931,887 字节，SHA-256 为 `C825BA3EB3DA72B561B2368555272CBEBF506A4BF0FA8FECC24E4C8D0832D86F`；目录包审计、原生资源校验、目录包 6 秒启动 smoke 和 portable 6 秒启动 smoke 均通过。最新 GUI 回归同时确认“作者店铺”入口可见并能调用安全外部 URL 流程，以及 Dola 任务面板的单账号/全部账号选择和快捷提交提示；平台适配器禁用设置也已覆盖三条远程事件入口，素材库自动刷新监听器的开启/关闭生命周期也已覆盖。 本轮 Dola 页面桥还补齐了有界的 Unicode、HTML 实体、转义斜杠和多层外层引号归一化；真实 Electron 页面夹具已确认编码地址能进入统一媒体消息链路。

最新回归补充（2026-08-28）：修复豆包 `maowang-doubao` 与 `doubao-download` 同时加载时的重复图片操作按钮；两套解析/回退路径继续保留，使用共享 `data-aiam-doubao-image-action` 标记协调可见 UI。Dola 批量登录弹窗的校准区和账号操作区也改为可收缩/换行布局，并由 GUI smoke 断言弹窗和内容区无横向溢出。修改后 `smoke:all` 通过 36 个测试文件、250 项单元测试；新增的发布配置回归也确认 macOS x64/arm64 签名、公证、审计和启动步骤仍保留；Windows x64 portable 已重新封装并通过包审计、原生资源校验和 6 秒启动 smoke。此前同日记录中的旧包大小/hash 仅作历史记录。

回归基线记录（2026-08-28）：本轮新增 HTTP 200 HTML/JSON 错误页、空响应和响应流中断后的候选回退验证，并确认失败候选会写回资源状态、通过 `media:updated` 推送到 GUI 候选详情；修复测试流取消后的生命周期清理。该记录当时为 248 项单元测试（36 个测试文件）；当前数量和包校验以本节上方的最新校准为准。通用媒体捕获新增响应式 `srcset`、`<picture><source>`、受限 CSS 背景图扫描，并用图片/视频扩展名和语义提示避免 CDN 路径误分类；sandboxed remote preload 另有独立 smoke，验证不加载通用页面脚本时仍可捕获可见媒体，并拒绝空地址回退为当前页面 URL；GUI 为 Dola 生成提醒补回账号卡片徽标和打开标签页圆点，激活账号后清除对应提醒；Dola/Higgsfield 外部批量登录新增平台无关的目标站点 Cookie 登录态轮询，人工验证完成后可自动同步。

说明：本文件前面的历史追加回归段落保留了当时的 230 项基线记录；随后新增豆包 15/30 秒页面设置的 2 项单元测试、旧版临时缓存清理的 2 项单元测试、外部登录进程清理的 1 项单元测试、普通非媒体下载完成通知的 1 项单元测试、action-bar 唯一 ID/文本和缺失 Content-Type 的 2 项单元测试、本轮紧凑 SSE/NDJSON/嵌套 JSON 媒体响应的 4 项单元测试、候选地址服务和 renderer 标注的 2 项单元测试、HTTP 200 错误页回退和响应流中断回退的 2 项单元测试，以及通用捕获 `srcset`/`<picture><source>`/CSS 背景图/媒体类型优先级的 1 项单元测试、sandboxed remote preload 空地址归一化与 DOM 兜底边界的 1 项单元测试、豆包扩展共存标记的 1 项单元测试、macOS 签名发布工作流完整性检查的 1 项单元测试、仓库工作流布局保护的 1 项单元测试、Dola fallback 实际请求 Header 的 1 项单元测试和 CRX2/CRX3 插件导入的 2 项单元测试后，当时总数已更新为 256 项；随后新增平台适配器禁用状态统一门禁的 1 项回归，当前总数为 257 项，以“当前单元测试”行和最新构建结果为准。
本条历史统计之后又新增 4 项程序化下载/Chromium 原生下载重复事件保护测试、4 项旧版代理订阅转换字段/输入边界测试，以及 2 项媒体 URL 归一化/去重测试（当前实现总数以文档上方的 267 项为准）。

本轮 `smoke:all` 实际通过 15 个 Electron/站点 smoke，并另行通过 Windows `smoke:packaged`；旧版 API 表面审计、跨进程 Session 重启、平台页面、站点适配器、任务流程和 GUI renderer 夹具也已纳入总检查，子进程失败会可靠返回非零退出码。

新增 `smoke:gui` 使用临时用户目录和模拟账号/素材，在真实 Electron renderer 中检查 18 个账号卡片、素材卡片、三栏工作区、地址栏、状态栏、豆包 15/30 秒工具入口、设置/素材库/登录辅助/Dola/Higgsfield/FaceGrid/迁移/诊断 8 个核心面板、设置中的旧版临时缓存区块及深浅主题往返；它验证的是 GUI 渲染和交互骨架，不代替真实账号页面验收。

| 功能域 | 旧版依据 | 当前实现 | 状态 | 仍需验收/限制 |
|---|---|---|---|---|
| Electron 主窗口、React/TypeScript UI | 旧 Electron `preload.js`、V4.4 `MainWindow` | `src/main/index.ts`、`src/renderer/src/App.tsx`；支持深浅主题、双窗口和右侧素材栏收起；Windows 关闭最后窗口退出，macOS 关闭窗口后可由 Dock/单实例事件重新创建并清理旧运行时 | 代码完成 | 视觉细节可继续迭代；macOS 真机仍需验证 Dock 生命周期 |
| Windows x64 打包 | 旧 Electron `package.json` | electron-builder portable/目录包，使用构建入口自有 `build-assets/app.ico` | 代码完成 | 当前无正式代码签名证书 |
| macOS Intel / Apple Silicon 打包 | 迁移计划 | `package.json` mac x64/arm64、`build-assets/app.png` 图标输入、Electron hardened runtime entitlements、原生资源准备脚本、`dist:mac:unsigned`、`.github/workflows/build-macos.yml` 未签名验收工作流、`.github/workflows/release-macos.yml` 签名/公证发布工作流、`.app`/DMG 审计与 `verify:mac-release` Bundle 验收；CI 会逐个启动 `.app` 并复核 DMG | 部分迁移 | 必须在 macOS 主机完成实际 DMG、`.icns`、签名、公证和启动验收；当前 Windows 主机不能执行该验证，CI 需实际跑通并配置 Apple/证书 Secrets |
| .NET / WebView2 运行时依赖 | V4.4 启动器和 WebView2 程序集 | 新版本只依赖 Electron 自带 Chromium | 代码完成 | 不需要终端用户安装 .NET；不复制 WebView2 数据库 |
| 账号增删改、排序、分组、平台筛选、分组/平台/全部批量删除、备注 | V4.4 `AppConfig`/账号类 | `AccountService` + Renderer 账号面板；支持按分组/平台筛选，并可删除当前分组、平台或全部账号；删除时同步清理独立 Session 和代理运行时；新增账号支持数量创建和“添加后启动” | 代码完成 | 已用本机 V4.4 配置确认账号类型/数量字段可被迁移预览识别 |
| 账号工具区折叠 | 旧 Electron `accountToolsCollapsed` | 左侧导入/导出、筛选、批量操作工具可折叠，状态保存在当前工作台 Renderer 偏好中 | 代码完成 | — |
| 账号导入/导出 | 旧 Electron metadata IPC、V4.4 配置 | JSON 导入/导出，导出时不带代理密码；浏览器、指纹和订阅节点元数据在导入导出间保留 | 代码完成 | 密码字段不导出，旧版特殊字段仍需样本回归 |
| V4.4 配置迁移预览、备份、冲突提示 | `AppConfig`、实例/代理/指纹配置 | `LegacyMigrationService`；兼容旧版中文及 `Kind=1..6` 数字平台类型；预览/导入会映射 `VideoDownloadRoot` 到普通下载目录并同步保留为独立视频目录、映射 `BossKey` 和安全的 HTTP/HTTPS `HomeUrl`，并识别配置目录旁的 `dola-video-ratio.txt` 写入统一 `AppSettings.dolaAspectRatio`，同时明确展示 `ProfileRoot` 仅供参考；`smoke:legacy-config` 已对本机真实配置完成只读预览 | 部分迁移 | 旧登录态不能直接复制 WebView2 数据库；结构化导出文件中的 IndexedDB 会按数据库/对象仓库/索引/记录恢复；旧 `ProfileRoot` 需在新设置中另选 Electron 数据目录；真实导入仍需用户确认并建议先做备份 |
| Cookie JSON/CSV、LocalStorage/SessionStorage/IndexedDB 导入 | `CookieStorageImportBundle`、`ImportStructuredStorageScript` | 受限结构化导入 + 当前账号页面写入 Storage；支持 IndexedDB schema、记录、索引和 Date/ArrayBuffer/TypedArray/Blob 标记 | 代码完成 | Cookie 加密数据库、未导出的 Service Worker 状态、站点自定义序列化仍需重新登录或专用适配 |
| 每账号独立浏览器环境 | V4.4 `BrowserInstance` / WebView2 环境 | `persist:account_<id>` + `WebContentsView` | 代码完成 | 这是应用内 Profile 隔离，不是 VM/系统用户隔离 |
| 浏览器数据目录选择 | V4.4 `ProfileRoot`、`ChooseDataFolder` | 设置面板可选择账号 Session 根目录；可写性检查、默认目录恢复、重启生效；配置与下载目录保持独立。Windows 便携版仍可把数据放在程序旁，安装版默认放用户 AppData，macOS 放 Application Support | 代码完成 | 切换不会自动复制旧 WebView2 Cookie/缓存数据库；需重启后使用新目录 |
| Cookie、LocalStorage、IndexedDB、Cache、扩展存储隔离 | V4.4 每实例目录 | Electron persistent Session；`smoke:isolation` 已用两个真实 WebContentsView 在本地验证 Cookie、LocalStorage、IndexedDB、CacheStorage；账号编辑面板提供按 Cookie、缓存、Storage 或全部会话清理；删除账号会关闭 View、停止代理并清理该账号持久 Session | 代码完成 | 真实站点双账号 E2E 仍需登录态 |
| 旧版启动临时缓存清理 | V4.4 `StartupCacheCleaner` | 设置面板新增“扫描旧版缓存 / 确认清理”：仅检查 `DolaMultiBrowser_FullSingle*`、`DolaMultiBrowserFullFolder`、`DolaMultiBrowserNormal/*` 和 `DolaMultiBrowser/*` 四类明确路径，分别按 30 分钟或 1 天目录修改时间筛选，清理前重新扫描并保护活动目录；不会自动清理，也不接收 Renderer 任意路径 | 代码完成 | 只处理旧版临时运行目录；不等同于清理 Windows/macOS 所有“3 个月未访问”文件 |
| 页面后退、前进、刷新、缩放 | 旧窗口导航控件 | `BrowserManager` + 顶栏控件 | 代码完成 | — |
| 地址栏、手动 HTTP/HTTPS 导航、当前地址恢复 | 旧版 `AddressBox`、`GoButton_Click`、回车导航 | `browser:navigate` + `browser:navigation-updated`；主进程限制为 HTTP/HTTPS、拒绝内嵌账号密码，导航前后同步当前账号 `lastUrl` | 代码完成 | 真实站点重定向和外链策略需平台验收 |
| 双窗口、批量打开/关闭/刷新 | V4.4 多实例布局 | `WebContentsView` 布局与批量 IPC | 代码完成 | — |
| 页面地址恢复、崩溃恢复、手动页面修复 | V4.4 实例状态、`WhiteScreenFixButton` | 账号级 `lastUrl`、`render-process-gone` 自动重建；工具栏“修复页面”会重建当前账号的 WebContentsView、CDP 文档脚本和代理绑定而不删除会话数据 | 代码完成 | Electron 不需要旧版的 WebView2 Runtime 重命名；仍需真实崩溃注入测试 |
| 权限弹窗和外链策略 | WebView2 权限事件 | Main Process 统一权限询问，仅允许 HTTPS 页面 | 代码完成 | 各平台系统权限文案需验收 |
| 直连 HTTP/HTTPS/SOCKS5 代理 | V4.4 `BrowserProxyConfig` | Electron Session `setProxy`、代理认证 | 代码完成 | 需不同代理服务商回归 |
| 订阅导入（sing-box JSON / Clash YAML / V2Ray） | V4.4 `SubscriptionParser` | `SubscriptionService` + Zod 归一化节点；保留旧版 VMess WebSocket/gRPC/HTTP-H2、TLS SNI/证书校验/ALPN/客户端指纹、hysteria2 带宽/混淆参数，并限制 10 MB/严格 Base64 | 代码完成 | 需使用真实订阅样本验收 |
| 每账号独立 sing-box 进程、回环端口、节点切换 | 迁移计划 | `SingBoxRuntimeManager` / `ProxyService`；`smoke:proxy-runtime` 已实际启动两个官方核心并验证端口/PID/单独停止；支持单节点和全部节点测速/出口 IP，批量测速使用临时 selector + Clash API（延迟最多 8 路并发、出口 IP 逐节点切换），结束后恢复原节点和账号 Session | 代码完成 | macOS 需真机执行权限验收，真实订阅出口仍需验收 |
| sing-box 崩溃不自动降级直连 | 迁移计划 | 运行失败状态和错误提示；单元集成测试实际终止受管核心并验证失败状态，再通过显式 `restart` 恢复 | 代码完成 | macOS 需真机执行权限验收；仍需真实订阅和端口占用场景验收 |
| TUN/系统级全局代理 | 旧版未形成稳定跨平台契约 | 当前未启用 TUN，仅 Session 代理 | 明确不支持 | 需要另行设计系统权限与恢复策略 |
| 账号级稳定随机指纹 | V4.4 `FingerprintConfig`/旧 preload | `FingerprintService` + CDP 注入；账号种子稳定，跨 Windows/macOS 迁移时按当前系统重建 UA、平台、UA-CH、WebGL 和屏幕族；创建/编辑界面可修改 UA、平台、语言、时区、硬件、内存、触控点、屏幕、DPR、WebGL、UA-CH、WebRTC 和 Canvas/Audio 噪声；`smoke:fingerprint` 已在真实 Electron 页面验证前置注入和可观测运行时属性 | 部分迁移 | 仅修改浏览器可见特征；不承诺真实 GPU、字体、TLS、网络指纹；需真实站点检测 |
| 指纹重生成、修改、恢复默认 | 迁移计划 | GUI + `fingerprint:*` IPC | 代码完成 | 重启稳定性已有单测，跨平台浏览器特征需实机回归 |
| 内置 MV3 扩展加载 | 旧 Electron extensions | 每账号 Session 加载 `site-assets/extensions`；豆包下载扩展状态弹窗只显示本地捕获统计，不含版本过期/激活门控 | 代码完成 | 各平台站点 DOM 变化需回归 |
| 自定义 ZIP/CRX/目录插件 | 旧插件管理器 | `PluginService` 安全解包、启停、移除 | 代码完成 | CRX/权限组合需用更多样本验证 |
| 豆包图片/视频捕获与作品下载 | 旧 `maowang-doubao`、`doubao-creation-download.js` | 专用扩展 + 页面脚本 + CDP + 主进程队列；支持从“我的创作”扫描平台明确的原视频下载流 | 部分迁移 | 真实登录、作品页、流式响应和下载地址需冒烟 |
| 豆包 15 秒/30 秒任务能力 | 旧 `doubao-15s-patch.js`、V4.4 15 秒 Hook、Dola 工具 duration-main | 响应适配、页面时长选项、“豆包 15s 增强”可见提示词发送入口，以及 Seedance 2.5 的 30 秒页面/请求桥；顶栏提供账号级 15/30 秒页面设置，写入当前持久 Session 并派发桥接事件 | 部分迁移 | 平台实际能力、账号权限和接口版本需验收；30 秒仍以平台当前页面能力为准，页面设置不绕过权限 |
| Dola 视频页面资源面板 | 旧 `dola-nowatermark` content/page hook | 新 `dola-resource-bridge.js` + remote preload + MediaService；定位信息不足时先进入主素材流，支持“解析并下载 / 解析原始 / 解析并打开 / 打开链接 / 复制链接”；每个可见视频还提供逐视频“解析并下载 / 打开原始 / 当前地址 / 复制地址”浮层，下载统一进入主队列，通过账号页面正常登录态走公开 play-info/share/thread 回退链；兼容旧版 `AIAM_ALT_ORIGINAL_MEDIA_FOUND` 公开资源事件和 `AIAM_DOLA_RESOURCE_DOWNLOAD` 下载事件 | 部分迁移 | 真实作品页、fplay/qAAB 样本和页面版本需验收；“当前地址”仅代表页面播放器地址；旧事件地址只有页面明确提供证据时才标记为原始，不承诺无水印 |
| Dola fallback API / Base64 / qAAB 令牌解析 | V4.4 `LocalVideoResolver` | `dola-resolver.ts` + 页面令牌通道 | 代码完成 | 只有平台当前仍返回兼容格式时有效，不能保证所有账号都返回原始资源 |
| Dola 15 秒/30 秒任务提交 | V4.4 主窗口任务流程、Dola 工具 duration-main、反编译 `DoubaoAccountManager.dll` | 当前登录页面正常 UI 驱动 + GUI；任务面板已恢复“当前单个账号 / 全部 Dola 账号”选择，批量提交只作用于选定账号；30 秒先确认 Seedance 2.5 和可见时长选项，点击后由 CDP 观察 `/chat/completion`；参考图最多 9 张；参考音频/视频最多各 10 个，通过 CDP 标准文件输入交给 Dola 官方上传管线；提交前由页面状态探针区分 input 已设置、附件已绑定、上传中和失败；画幅选择写入统一设置文件，并兼容迁移旧渲染层 `localStorage` 值；画幅选项已补齐旧版六项：`1:1`、`3:4`、`4:3`、`9:16`、`16:9`、`21:9` | 部分迁移 | 旧版低层提交还依赖健康/配额/活动租约和签名桥，未直接复制；真实登录、当前模型规则、页面控件和文件上传管线变更需验收；状态探针不可见时只能确认文件已交给页面，不能保证服务端上传完成；不绕过权限 |
| 千问、云雀、Higgsfield、即梦专用资源 | V4.4 MainWindow/旧页面脚本 | 千问扩展已覆盖 qianwen.com、qwen.ai、tongyi.aliyun.com，CDP 还恢复 `chat2-api.qianwen.com/api/v1/session/msg/list` 的 `thumbnail_url`/`src+poster` 字段；云雀解析、Higgsfield 脚本、即梦图片脚本；全部平台主机匹配和云雀/千问旧响应入口已有 fixture 回归 | 部分迁移 | 需要逐站真实账号冒烟；其余为通用捕获兜底 |
| Kimi、oiioii、nano、Lovart、自定义站点 | V4.4 平台列表 | 平台注册表 + 通用 DOM/性能/网络捕获；DOM 数据属性、响应式 `srcset`/`<picture><source>`、受限 CSS 背景图或 JSON/SSE 中带 `mime_type`、`media_type`、`resource_url` 等明确提示的无扩展名 CDN 资源会进入统一媒体队列；图片/视频语义提示和明确扩展名优先于宽泛 CDN 路径 | 部分迁移 | 没有站点专用协议时无法承诺 1:1 下载或任务操作 |
| Fetch/XHR/SSE/CDP 网络捕获 | 旧 Electron/WebView2 response event | 页面脚本 + CDP Network/Fetch；适配器脚本在目标导航前注册，远程页面桥接按所属 WebContents 主帧校验；通用脚本另有受限 `performance` 媒体资源兜底捕获；运行中切换实验响应补丁会只重建受影响的已打开账号 | 代码完成 | 各站点响应体大小、流式和签名变化需回归 |
| 捕获模式：全部 / 图片 / 视频 | 旧版资源类型下拉框及捕获分支 | `captureMode` 持久化到设置；Renderer 列表筛选、Main `media`/原生下载桥、远程页面媒体消息和 Dola 视频令牌入口统一按模式过滤 | 代码完成 | 需真实站点确认切换后不会误捕获另一类资源；已补单元回归 |
| 视频生成完成提醒 | 旧 Electron `AIAM_VIDEO_GENERATED_NOTICE` / `video-generated-notice` | Dola 页面在生成态之后检测新的可见视频，经主帧和账号归属校验后由工作台显示“查看/关闭”通知；主进程按账号和 key 去重；账号卡片和已打开标签页同步显示未读徽标，激活账号后清除 | 部分迁移 | 当前只对 Dola 页面实现；真实页面生成态文案和组件结构仍需站点版本回归 |
| 去水印下载 | 旧平台原始资源/地址变体链路 | 平台返回原始字段、已知 URL 变体、Dola 解码/回退接口；普通 DOM 图片不再伪标为无水印 | 部分迁移 | 不保证未授权资源；需以 HTTP/平台字段为准 |
| 本地像素擦除、DRM 解密、HLS/DASH 转码 | 原版未形成可安全跨平台实现 | 未加入 | 明确不支持 | 不做本地修复、DRM 破解、权限绕过或强制转码 |
| 统一下载队列、重试、取消、并发、`.part`、原子重命名、普通资源文件名前缀 | 旧下载器 + 旧 Electron `videoFilenamePrefix` + 迁移计划 | `MediaService`；普通下载目录与可选独立视频下载目录分开管理，Dola/豆包视频可选平台目录与 `1.mp4`…`1000.mp4` 编号布局；另有显式 V4.4 兼容开关恢复根目录下的 `Videos/`、`Images/` 和旧版图片时间戳命名；普通图片/视频支持设置前缀，兼容编号视频保持纯数字文件名；页面 `electronDownload` 也统一进入主进程队列，定位信息未解析的素材不会被批量下载误提交 | 代码完成 | 需大文件/断网/过期签名 E2E |
| 图片/视频预览、素材库筛选和文件操作 | V4.4 资源面板/预览窗口 | `workbench-media:`、Library、打开/定位/拖拽/删除；账号页面 Blob 会先生成本地临时预览映射；素材库打开期间会监听普通文件和媒体任务完成事件并防抖刷新 | 代码完成 | 需各平台媒体 MIME 和 macOS 文件权限验收 |
| 人脸网格工具（网格 / 脸部重组） | V4.4 `FaceGridToolWindow.cs` + `FaceGridAssets` OpenCV DNN 模型 | `face-grid-assets` + OpenCV WASM DNN/Caffe + 本地处理面板 | 代码完成 | 已完成模型加载、旋转检测、NMS、网格/脸部重组、缩放和原子保存；真实人像样本及 macOS 包仍需验收 |
| 视频预览 FFmpeg 转换 | V4.4 `ConvertVideoForPreviewAsync` + 随包 `ffmpeg.exe` | `MediaService.convertForPreview` + Windows x64、macOS x64/arm64 随包 FFmpeg；`prepare-media-resources.mjs` 固定版本、SHA-256 和 Mach-O/PE 架构校验；V4.4 目录兼容模式写入 `Videos/转码_<SHA256(url)>.mp4` | 代码完成 | 已完成缓存、`.part` 原子替换、兼容 MP4 转码和失败清理；macOS 仍需真机验证执行权限、签名和实际转码 |
| 外部 Chrome/Edge 登录辅助、Cookie 同步 | 旧 `webview-preload`/登录流程 | `ExternalLoginService`；支持空白辅助登录和从当前隔离 Session 显式带入 Cookie 后打开外部浏览器；设置面板可填写自定义 Chrome/Edge 可执行文件路径，留空自动探测；Dola/Higgsfield 共用平台无关的目标站点登录态轮询，人工验证完成后自动同步；内置兼容脚本不拦截 Passkey/WebAuthn | 部分迁移 | 已实现路径探测、会话同步和 Dola/Higgsfield 登录态轮询；真实 Google、目标站点登录、验证码、Passkey 和 2FA 必须人工验收 |
| Dola 批量登录 | 旧 Electron 内置半自动 / 外部浏览器流程 | GUI + 内置批量 `WebContentsView` 可见网格或系统 Chrome/Edge 辅助；支持按 `邮箱----密码` 等格式批量创建本地 Dola 账号（最多 100 个）、最多 4 个内置并发或 10 个外部并发自动填入，内置超过 20 个时分批处理，外部窗口网格定位/批量同步、人工验证后按目标 Cookie 自动同步、逐行复制邮箱/密码和外置单行同步，以及登录/Google 点位的可视化比例校准和 CDP 鼠标测试 | 部分迁移 | 内置单个窗口最多显示 20 个账号；不保存密码，不自动处理验证码/通行密钥；真实 Google/Dola 页面仍需人工验收 |
| Higgsfield 批量登录 | V4.4 `Dola/Higgsfield` 批量半自动登录流程 | 共用受限 DOM 登录辅助；支持按 `邮箱----密码` 等格式批量创建 Higgsfield 账号（最多 100 个）、内置 `WebContentsView` 可见网格、最多 4 个内置并发或 10 个外部并发，内置超过 20 个时分批处理，外部窗口网格定位/Cookie 同步、人工验证后的通用登录态轮询自动同步及课程页跳转 | 部分迁移 | 内置单个窗口最多显示 20 个账号；不自动处理验证码/2FA/通行密钥；不复用 Dola 固定点位；真实 Google/Higgsfield 页面仍需验收 |
| 即梦原图选择 | 旧 Electron `btnJimengOriginal` / 图片下载脚本 | 即梦账号页面提供显式“即梦原图”按钮，通过页面正常资产选择入口获取原图候选 | 部分迁移 | 需要真实资产页和当前页面脚本版本验收 |
| 系统诊断面板 | 旧 Electron `btnDiagnostics` / `getWebviewMap` | `diagnostics:snapshot` 显示账号 Session、页面、适配器、显式能力合同（通用捕获/专用下载器/任务时长）、指纹、代理、插件和下载任务状态，不显示凭据 | 代码完成 | 真实站点兼容性仍需通过诊断信息定位 |
| 文件夹选择、普通/视频下载目录、系统打开/定位 | 旧 Electron IPC、V4.4 `VideoDownloadRoot` | Main Process 文件 API；设置面板可分别选择普通下载目录和视频下载目录，视频目录留空时回退到普通目录；素材库同时扫描两处目录并统一做路径边界校验 | 代码完成 | macOS 沙盒/权限和 Windows 杀毒软件需验收 |
| Boss Key / 全局快捷键 | V4.4 `BossKeyConfig` | `globalShortcut` + 设置面板 | 代码完成 | macOS 辅助功能权限、快捷键冲突需验收 |
| 公开更新检查 | 旧更新入口 | `UpdateService` 独立于授权；按 `win32-x64`、`darwin-x64`、`darwin-arm64` 选择签名更新清单，拒绝跨平台/跨架构包并保留旧 Windows 清单兼容 | 代码完成 | 需配置公开 Release 源和真实签名发布；当前未绑定授权状态 |
| 作者店铺 | V4.4 `AuthorShopButton_Click` / 固定 `ShopUrl` | “更多工具 → 作者店铺”；使用固定 HTTPS 地址，通过 Main Process 的外部 URL 校验交给系统默认浏览器 | 代码完成 | 属于非核心外部链接；店铺本身的可用性不由应用保证 |
| 授权、激活、机器 ID、自锁、异常删除 | V4.4 `ActivationWindow`、`Paojiao*` | 已移除，包审计禁止相关路径/字符串 | 明确移除 | 不得从旧目录复制回构建入口 |

## 当前结论

截至本矩阵日期，新 `app/` 已达到“可编译、可运行、可继续验收的跨平台重建基线”，但还没有达到“原软件所有站点功能在三种目标平台上逐项 1:1 验收”。最主要的未完成项是：真实登录站点 E2E、Dola/ciciai 当前页面版本上的兼容性、macOS 真机打包/签名/公证，以及没有站点专用适配器的平台行为。平台 fixture 只能证明边界和解析入口，不等于真实账号功能已经完成。

追加回归补充（2026-08-28）：Dola 参考音频/视频上传现在有页面状态探针和最多 8 秒的有界等待。主进程会区分文件已进入 input、附件已绑定、仍在上传、失败和页面状态不可观测；Renderer 遇到 `pending` 或 `failed` 不会继续提交任务，状态不可观测时只报告“已交给页面”，不冒充服务端上传成功。

追加回归补充（2026-08-28）：豆包页面规则、下载扩展和创作页脚本现在都会保留公开响应中的显式无水印字段别名，并继续执行 HTTP(S) 协议过滤和候选数量上限；千问扩展的 `host_permissions` 已覆盖其 manifest 声明的 qianwen.com、qwen.ai 和 tongyi.aliyun.com 页面。两项修复均有静态/fixture 回归，但仍需真实登录站点验证当前页面版本。

追加回归补充（2026-08-28）：新增 opt-in `smoke:real-sites`，使用 `persist:account_<id>` 复用指定 Electron Session，加载与生产版本相同的适配器脚本、远程媒体 preload 和内置扩展；不接收/保存密码，不复制 Cookie，不处理验证码、2FA 或 Passkey。配套 `smoke:real-sites:public` 会先构建，再在临时目录依次检查豆包、千问、Dola、小云雀、Higgsfield、Kimi、oiioii、nano、Lovart、即梦 10 个公开入口；本轮脚本统计 10/10 通过，另有 `custom + example.com` 单独通过。需要注意：Dola 在本机网络中被重定向到 `security/region-restricted`，脚本将其作为外部地区可达性限制记录而不是代码失败，因此 Dola 仍不能视为真实功能已验收。输出只包含页面状态、Cookie 数量、脚本标记和媒体类型统计；它不能把未登录页面结果计为真实功能完成。

追加回归补充（2026-08-28）：在最新页面桥和 Windows 构建之后再次运行 `smoke:real-sites:public`，10/10 公开入口均在真实 Electron `WebContentsView` 中完成导航并通过适配器检查；其中豆包扩展、即梦原图桥、Higgsfield 课程桥和 Dola 资源桥均有运行时标记，Dola 仍跳转地区限制页。该结果继续只证明公开页面脚本注入与通用捕获边界，不证明真实账号登录、任务、下载或权限。

## 验收命令

```powershell
cd D:\GitProject\test\mac-source-rebuilt\app
npm run typecheck
npm test -- --run
npm run smoke:all
npm run smoke:isolation
npm run smoke:session-restart
npm run smoke:storage-import
npm run smoke:document-scripts
npm run smoke:fingerprint
npm run smoke:platform-pages
npm run smoke:site-adapters
npm run smoke:task-workflows
npm run smoke:batch-workspace
npm run smoke:gui
npm run smoke:proxy-runtime
npm run smoke:video-notice
npm run smoke:public-sites
npm run smoke:real-sites -- --platform <id> [--account-id <账号ID>] [--user-data <Electron Session根目录>] [--show]
npm run pack:win
npm run audit:package -- release\win-unpacked
npm run smoke:packaged -- release\win-unpacked win32 x64 6
```

macOS 构建必须在 macOS 主机执行：

```bash
npm run dist:mac
```

追加回归补充：新增 `src/main/lifecycle.ts` 的代理清理队列测试，覆盖窗口关闭后再退出、前一次清理失败仍继续后一次清理，以及后续清理失败可观测；对应代码保证 macOS 关闭窗口后不会因退出竞态遗留 sing-box 子进程。

追加回归补充（2026-08-28）：原生 Chromium 下载现在先读取文件名、URL 和 MIME 类型，仅明确识别为图片或视频时才进入统一媒体队列；PDF、ZIP、JSON 等非媒体下载保留 Electron 的 `DownloadItem` 生命周期，同时沿用工作台配置的普通下载目录、账号子目录和重名避让规则，避免被误当作图片或静默落到系统默认目录。

追加回归补充（2026-08-28）：新增共享 `media-formats.ts`，恢复 V4.4 的 JPEG/PNG/APNG/WEBP/GIF/BMP/TIFF/AVIF/HEIC/HEIF/SVG/ICO/JXL 与 MP4/WebM/MOV/M4V/Matroska 等格式的 MIME、URL 后缀和文件头识别；无扩展名 CDN 下载会优先按图片签名、再按 MIME/URL 修正最终扩展名，素材库也能识别新增格式。页面通用捕获同步扩展安全的媒体后缀集合，仍不把通用 SVG/ICO UI 资源作为页面自动捕获素材。

追加回归补充（2026-08-28）：Dola 页面桥现在会为同一作品保留最多 8 个经过安全过滤的媒体候选地址（主地址、备用地址及当前已登录页面公开响应中的其他地址），通过 IPC 传给 `MediaService`；主进程按候选顺序复用账号 Session 下载或预览，前序 CDN 地址失败时继续尝试后续地址。该回退不复制旧版 `chrome.downloads` 直写、授权桥或隐藏校验。

追加回归补充（2026-08-28）：公开 Dola 响应中的 `main_url`、`backup_url`、`backup_url_1/2/3`、`man_url`、`fplay_url`、`download_url`、`third_url` 等无扩展名候选现在统一进入同一作品的备用地址集合；解析器会优先保留明确的 `backup_url`，其余地址按顺序作为 `alternateUrls`，并由主进程继续执行安全过滤和最多 8 条的上限控制。

追加回归补充（2026-08-28）：豆包旧 `get_play_info` 公开响应中的 `original_media_info` 与全部 `play_infos` 现在合并保留主地址、备用地址及最多 8 条候选地址；每条候选仅接受 HTTP(S)，并对旧路由参数做同一无水印变体归一化。`maowang-doubao` 与旧 `doubao-download` 桥均继续把这些候选交给主进程下载队列。

追加回归补充（2026-08-28）：Dola fallback 的 `video_list` 会按码率/分辨率选择最高质量主地址，并把其余公开解码地址保留为候选；下载/预览在 HTTP(S) 候选失败后可通过对应账号页面的 Blob 解析器处理 `blob:` 候选，不会把页面 Blob 误交给 Session 网络请求。

追加回归补充（2026-08-28）：素材流的视频卡片现在在存在可播放地址时使用静音视频元素进行真实预览；只有海报/缩略图时回退到图片，未解析地址时保留占位提示，避免把视频地址误当作普通图片加载。

追加回归补充（2026-08-28）：新增 `smoke:task-workflows`，在真实 Electron `WebContentsView` 中加载本地正常页面 fixture，验证 Dola 15 秒页面流程（画幅、时长、提示词和生成按钮）、Dola 30 秒页面流程（Seedance 2.5、画幅、时长和 30 秒状态）以及豆包 15 秒提示词发送脚本。该回归还修复了 Dola 页面脚本运行时未注入 `escapeRegExp` 的真实缺陷；它证明的是页面 UI 自动化和脚本状态，不等于真实账号生成、配额、上传、下载或无水印能力已经验收。

追加回归补充（2026-08-28）：V4.4 本机配置迁移 smoke 已读取配置目录旁的 `dola-video-ratio.txt`（当前值 `16:9`），并在临时沙盒导入中验证画幅设置随迁移写回，同时保持原配置不变。

追加回归补充（2026-08-28）：GUI renderer smoke 现在会在真实 Electron 渲染进程中打开 Dola 批量面板，并检查 15/30 秒、旧版六种画幅（1:1/3:4/4:3/9:16/16:9/21:9）、参考图/音频/视频入口以及单账号/全部账号提交按钮；同一回归还覆盖设置、素材库、登录辅助、Higgsfield 批量登录、人脸网格、V4.4 迁移和诊断等 8 个核心面板。

追加回归补充（2026-08-28）：新增 `audit:legacy-surface`，静态读取旧 Electron `preload.js` 的 59 个公开入口，逐项登记为当前分组 IPC、主进程内部替代或按计划移除，并检查当前 IPC 的基础域仍存在。它用于防止平面 API 重组时漏掉旧入口，不把“入口已登记”夸大为真实站点登录、任务或 macOS 实机验收。

追加回归补充（2026-08-28）：在上一条 portable 记录之后重新执行了 `smoke:all`（36 个测试文件、235 项单元测试、全部本地 Electron smoke）并通过；随后按最新源码重建 Windows x64 目录包和 portable 单文件包。当前 portable 文件大小为 195,926,117 字节，SHA-256 为 `5CD3E63B03F3FD6F472A7E35CCD54A132F99FA6E490D2807F1FB217DA7FB3A3D`；目录包再次通过 952 个 asar 条目、30 个站点资源、3 个原生核心审计和 6 秒启动 smoke。

追加回归补充（2026-08-28）：为避免只验证目录包，`smoke-packaged.mjs` 现支持 Windows portable `.exe`，会使用临时 `--user-data-dir` 启动并在结束后清理进程树和临时目录；最新 portable 文件大小为 195,926,113 字节，SHA-256 为 `E84251AF4E60055D9D5BD668DC408CC22B112437C65FF9489F2AFD25253FE230`，portable 启动 smoke、Windows 目录包审计、目录包 6 秒启动 smoke 和 TypeScript 类型检查均通过。

追加回归补充（2026-08-28）：普通 PDF/ZIP/JSON 等非媒体下载在保留 Electron `DownloadItem` 生命周期、工作台普通下载目录、账号子目录和重名避让规则的同时，下载完成后通过 `files:downloaded` 通知 Renderer，GUI 会显示完成状态；只有 Electron 报告 `completed` 才发送完成事件，失败或中断不会误报为成功。

追加回归补充（2026-08-28）：在普通非媒体下载事件接入后重新执行 `smoke:all`，36 个测试文件、236 项单元测试及全部本地 Electron smoke 均通过；随后重新封装 Windows x64 portable，最新文件大小为 195,913,839 字节，SHA-256 为 `00228E475EE3080EA975DA18B0618CDA6E15E724615979EC60DA05625A8B38F4`，并通过 portable 临时用户目录 6 秒启动 smoke、Windows x64 目录包审计和目录包 6 秒启动 smoke。

追加回归补充（2026-08-28）：V4.4 action-bar 时长选项补丁现在为克隆的 15/30 秒选项分配唯一 ID，并同步更新可提交的选项文本；响应被重新填充且原响应缺少类型时会补上 JSON Content-Type。新增 2 项适配器回归后，`smoke:all` 通过 36 个测试文件、238 项单元测试及全部本地 Electron smoke；随后按最新源码重新封装 Windows x64 目录包和 portable，目录包审计通过，目录包与 portable 均在临时用户目录保持运行 6 秒。portable 文件大小为 195,911,486 字节，SHA-256 为 `957CE3591AE228FE503E72E80B27E263A89219702F7D4015FFA3C5255F314760`。

追加回归补充（2026-08-28）：媒体解析器新增紧凑 SSE（连续 `data:` 事件无空行）、NDJSON 和有界嵌套 JSON 字符串支持，仍只接受完整 JSON 对象/数组并沿用现有媒体字段、HTTP(S) 地址、深度和响应大小限制；Dola 嵌套响应中的公开 qAAB 令牌也会沿用已有种子解码路径。新增 4 项单元测试后，`smoke:all` 通过 36 个测试文件、242 项单元测试及全部本地 Electron smoke。该修复只扩大对页面已公开响应格式的读取，不新增私有接口、授权、DRM 或水印擦除能力。

追加回归补充（2026-08-28）：最新源码下 `smoke:real-sites:public` 已在真实 Electron `WebContentsView` 中逐一加载豆包、千问、Dola、云雀、Higgsfield、Kimi、oiioii、nano、Lovart、即梦 10 个公开入口，结果 10/10 通过公开页面导航、生产适配器脚本注册和页面状态/媒体消息观察；Dola 在当前网络环境进入地区限制页，但 Dola 专用桥仍已注册。该检查不包含人工登录、生成任务、下载权限或验证码/2FA/Passkey 流程。Windows x64 portable 已按同一源码重新封装，文件大小 195,909,449 字节，SHA-256 为 `8C8CDA417303105E092427D108645A1D5123CFFD118D384CBA6ACC7F5FC3AC78`；portable 临时用户目录启动 6 秒、目录包审计和目录包启动 smoke 均通过。

追加回归补充（2026-08-28）：素材流新增“候选地址”详情选择器。页面公开响应或 Blob 观察到的主地址、备用地址和候选地址会在资源面板中去重显示；用户可复制/打开已观察的 HTTP(S) 地址，或将某个已观察候选提升为首选。主进程只允许当前素材候选集合内的 HTTP(S)/Blob 地址，并继续由账号 Session 与统一下载队列完成实际下载；不存在候选集合外 URL 注入。新增 2 项 renderer/service 回归后，`smoke:all` 通过 36 个测试文件、244 项单元测试；GUI smoke 实际打开并检查候选详情弹窗。随后 Windows x64 目录包审计、目录包 6 秒启动 smoke、portable 6 秒启动 smoke 均通过；portable 大小 195,934,419 字节，SHA-256 为 `AEB7E8349370D1E2D169E9C6225C39F04A234D12BB50F792ADFDCDEEEB573395`。
