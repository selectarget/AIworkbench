# V6.8 .NET 下载实现对照

核对时间：2026-10-02。用 ILSpy 重新反编译 `D:\GitProject\test\analysis\_v68_diff\v68\DolaMultiBrowser.dll`，没有执行该程序集。

程序集 SHA-256：`107A7006CB639ED0C1FE8812C9D932E404442F9381468CA52BE58B8B5671FB6B`。
反编译产物：`app/.verification/net68-main/DolaMultiBrowser.decompiled.cs`，不参与应用构建。

| .NET 实际方法 | 核实的行为 | 当前实现 |
|---|---|---|
| `LocalVideoResolver.BuildRequestUri` | 覆盖 channel=no、codec_type=8、logo_type=unwatermarked；保留其他参数原始编码 | `dola-resolver.ts` 的共用解析器；已修复查询参数重新编码差异 |
| `LocalVideoResolver.ParseResponse` / `PickMainUrlToken` | 展开 video_info/data/video_list，按码率+宽×高选流，解码 HTTP/Base64/qAAB | 共用解析器与固定样本回归 |
| `ExtractResourcesFromChainResponse` / `ResolveFallbackApiResourceAsync` | 豆包和 Dola 都从消息中的 fallback_api 请求下载流 | 原先只接 Dola；本轮补上豆包，并保留账号会话隔离 |
| `DownloadResourceAsync` | 根站点 Referer，流式读取、视频连续编号、Images/Videos 分目录 | Electron 下载队列已有对应路径模式、流式写入和根站点 Referer；仍保留暂停、校验、重试能力 |
| `WatermarkChannelDownloadButton_Click` | 三个渠道按钮传入同一个 resource，调用同一个 DownloadResourceAsync；channel 只用于状态文案 | 不虚构三个独立下载源，使用真实候选地址 |
| `ConvertVideoForPreviewAsync` | 使用 FFmpeg 生成兼容播放文件 | 保留下载原文件，生成本地 H.264 预览副本 |

本轮还修复了已解析下载流在网页重新捕获播放地址后丢失来源的问题，并增加解析成功/失败日志（隐藏签名地址）。

验证范围：参数保留、Base64/qAAB 解码、高清流选择、豆包 fallback 链路、资源来源保留的本地测试。真实作品的无水印结果仍须由站点解析响应和实际下载画面验证；不能仅凭 URL 中的 no_watermark 文本保证。

只参考业务解析与下载实现，不引入激活、设备绑定或运行缓存。

## 剩余网络报错核对（2026-10-02）

- .NET `CreateWebViewEnvironmentOptions` 未发现忽略证书或绕过 TLS 的开关；禁用代理时仍使用系统网络。Electron 当前账号也未启用独立代理。
- 用全新、无登录态的 Electron Session 实测：豆包和 Dola 首页返回 200；`mssdk.bytedance.com`、`mon.zijieapi.com`、`vcs.zijieapi.com`、`opt.doubao.com`、`mon-sg.byteintlapi.com` 在约 10–25 ms 内返回 `ERR_CONNECTION_CLOSED`。系统代理/直连和 TLS 1.2 对照结果一致。
- 已只读核实 Clash Verge 的运行配置启用 TUN/fake-ip，五个失败域名均在 `ruleset/reject.yaml` 内，并通过 `RULE-SET,reject,REJECT` 拦截。用户明确选择保留拦截，因此不修改 Clash；这些域名的底层 SSL 断连消息仍可能出现。
- 公开 Dola 页面在没有工作台脚本和账号登录态的测试中，仍请求 `wss://www.dola.com/security/Create%20WebSocket`，返回 404。此记录属于安全页面探测路径，不能据此断定视频任务实时连接失败。新增 WebSocket 握手日志，普通业务连接失败仍记为警告。
- 正常预览取消记为 INFO；同类网络错误每 30 秒合并重复次数，保留首条错误及汇总，不改变请求行为。
- 修正 Electron 43 控制台事件使用的旧参数签名，消除启动时 `console-message arguments are deprecated` 提示。
- 同一账号并发捕获同一 fallback API 时只解析一次；关闭账号或工作台后不回写过时解析结果；失败请求仍可重新解析。

真实下载记录：最新文件约 51.4 MiB，H.264、1280×720、约 15 秒；生成视频帧已核对未出现先前播放器流中的豆包角标。此结论仅针对已检查的作品，不保证站点未来返回的每一条流。

## Electron 下载链路优化（不引入 .NET 组件）

- 网页、解析和媒体请求保留原账号 Session 与代理；媒体默认使用账号 UA。已识别的 HTTPS 签名 CDN 地址不带 Cookie/Authorization/Origin；API 与其他需要会话的地址继续使用账号鉴权。三个已捕获豆包地址的生产代码只读测试均返回 206/video/mp4，读取 4096 字节后取消。
- 主进程媒体请求显式按原账号响应代理鉴权；不使用“同一代理地址匹配到第一个账号”的兜底凭据，不向源站 Basic Auth 挑战发送代理密码。
- 每账号同时下载最多两个文件，全局仍遵循用户设置；解析、预览及下载共用每 Session 四个流式请求名额，响应读取或取消后释放连接和名额。
- 429 停止当前任务的候选回退与自动重试，按 Retry-After（缺省 60 秒）暂停该账号的新媒体请求。队列保留等待任务及截止时间；其他账号继续运行。下载记录保留时，重启会恢复冷却截止时间。
- 网络中断、超时及可重试服务错误使用带抖动的指数退避；鉴权、证书、磁盘和错误页面不盲目重试。失效地址允许一次重新解析，同一次下载不再重复请求已明确失效的旧地址。
- 取消失败响应体；暂停/取消打断退避等待；检查 206 的总文件大小和起点，拒绝伪装为视频的 HTML 错误响应；API 响应流读取限制 10 MiB。
