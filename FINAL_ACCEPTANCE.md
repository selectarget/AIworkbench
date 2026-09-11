# AI 创作工作台迁移验收报告

日期：2026-09-05  
正式构建入口：`D:\\GitProject\\AIworkbench\\app`  
对照源：V5.2（见 `V52_DELTA.md`）

## 结论

当前版本是“核心功能已重建、Windows x64 本地验证通过、macOS 与真实账号验收待完成”的 Electron 跨平台基线，不能标记为原软件全部功能已经 1:1 验收完成。

按当前 `FUNCTION_MATRIX.md` 统计，53 个功能域中有 35 个代码完成、15 个部分迁移、2 个明确不支持、1 个明确移除。因此当前完成度应表述为“核心功能基线完成”，而不是“原软件全部功能完成”。

## 已有证据

- 本轮重新执行 `npm run smoke:all` 通过（退出码 0）：36 个测试文件、267/267 单元/集成测试通过，并完成全部本地 Electron smoke。
- 账号 `persist:account_<id>` 的 Cookie、LocalStorage、IndexedDB、CacheStorage 已通过双账号隔离和跨进程重启验证。
- V4.4 配置、指纹、代理、下载目录、Dola 画幅和结构化 Storage/IndexedDB 导入已有预览、备份、冲突和沙盒回归。
- Dola 任务面板已按旧版恢复“当前单个账号 / 全部账号”选择，批量提交范围由用户明确选择。
- Dola 备用解析请求优先沿用当前账号 Session 的平台 User-Agent，并移除 Electron 标识；无可用 Session UA 时按当前主机平台回退。
- 旧版代理订阅转换已保留 VMess WebSocket/gRPC/HTTP-H2、TLS SNI/证书校验/ALPN/客户端指纹，以及 hysteria2 带宽和混淆参数；解析入口限制 10 MB 并采用严格 Base64 边界。
- 每个账号的代理运行时、sing-box 端口回收、崩溃状态、显式重启恢复和“不自动降级直连”已有 smoke。
- 豆包、Dola、千问、云雀、Higgsfield、即梦专用桥，以及 Kimi、oiioii、nano、Lovart、自定义站点的通用捕获入口已有页面夹具。
- 统一下载队列覆盖重试、取消、并发、`.part`、原子重命名、普通非媒体下载、Blob 预览和 FFmpeg 兼容预览。
- 程序化下载 URL 与 Chromium `will-download` 事件已有旧版兼容去重保护：同账号/默认 Session 的短时间重复下载会被取消，下载队列候选回退也会逐项登记。
- Dola 页面桥与其他媒体入口共享安全 URL 归一化，兼容旧版 JSON/HTML 中的转义斜杠、Unicode 转义、外层引号和 HTML 实体，并在主进程去重与下载前统一校验协议。
- 已打开的素材库会在普通文件或媒体任务完成后自动防抖刷新，保持旧版下载库的即时可见行为。
- 插件导入回归覆盖目录、ZIP、CRX2、CRX3、Manifest V2/V3 和路径穿越防护。
- GUI 已在真实 Electron renderer 中验证三栏工作台、账号卡片、素材库、主题切换、Dola 15/30 秒面板、批量登录、人脸网格、迁移和诊断面板。
- GUI 冒烟还验证了旧 V4.4 固定 HTTPS“作者店铺”入口可见并能通过安全外部 URL 流程调用系统浏览器。
- 旧 Electron preload 的 59 个公开 API 已完成表面审计：44 个映射、12 个内部替代、3 个按计划移除（授权/激活）。
- `npm run smoke:real-sites:public` 已在真实 Electron `WebContentsView` 中检查 10/10 个公开站点入口；Dola 当前网络跳转地区限制页，但专用桥仍成功加载。
- Windows x64 portable：195,931,887 字节；SHA-256：`C825BA3EB3DA72B561B2368555272CBEBF506A4BF0FA8FECC24E4C8D0832D86F`；portable 启动 smoke 通过。

## 尚未达到最终验收的项目

1. macOS Intel 和 Apple Silicon 的真实 `.app`/DMG 构建、启动、原生 sing-box/FFmpeg 执行权限、代码签名和公证。
2. 豆包、Dola、千问、云雀、Higgsfield、即梦等真实登录账号的任务提交、生成、资源捕获和下载权限。
3. Dola 当前线上页面、地区限制、登录/验证码/2FA/Passkey 和上传状态的人工验收。
4. Kimi、oiioii、nano、Lovart、自定义站点没有站点专用协议时，只能保证通用媒体捕获，不能承诺旧版不存在的专用任务或下载协议。
5. 浏览器可见指纹已实现，但真实 GPU、字体、TLS 和网络层指纹不由 Electron 页面脚本控制。

以下边界是有意保留的，不属于遗漏：不复制 WebView2 数据库，不绕过第三方账号验证，不做 DRM 解密、HLS/DASH 破解或本地像素擦除；应用授权、激活、机器绑定和自锁逻辑已移除。

## macOS 验收入口

仓库根目录提供两个工作流：

- `.github/workflows/build-macos.yml`：无签名 x64/arm64 构建、`.app`/DMG 审计和启动 smoke。
- `.github/workflows/release-macos.yml`：macos-13 x64 与 macos-14 arm64 独立签名、公证和可选发布。

本地 macOS 可执行：

```bash
cd /path/to/mac-source-rebuilt/app
npm ci
npm run dist:mac:unsigned
# 配置 Developer ID / Apple Notary 凭据后：
npm run dist:mac
```

## 真实站点验收入口

真实站点检查是显式 opt-in，不接收或输出密码：

```bash
npm run smoke:real-sites -- --platform <id> --show
npm run smoke:real-sites -- --platform <id> --account-id <id> --user-data <工作台Session目录> --show --expect-capture
```

`--show` 允许人工完成登录、验证码、2FA 或 Passkey；脚本只记录页面状态、Cookie 数量和媒体类型统计，不将未登录页面结果冒充为完整功能验收。
