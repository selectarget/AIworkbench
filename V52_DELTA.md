# V5.2 差量清单

对照日期：2026-09-05  
源：`D:\GitProject\test\release\AI创作工作台V5.2-自用便携版\normal`  
实现宿主：`app/`（Electron 跨平台基线）  
反编译：`reference/v52/`（只读，不进包）

## 分类

| 项 | 判定 | 说明 |
|---|---|---|
| 免费 30 秒插件 `duration-main.js` | 已有更强实现，只对齐行为 | completion 补丁与 V5.2 相同；本仓库额外保留参考音视频。应对齐：`duration30Enabled` 为 `localStorage !== "0"`（缺省视为开启） |
| `dola_video_click_capture.js` + `PopupPreviewHook` | 移植 | 拦截 Dola 视频链接点击/`window.open`，按 `/video/tos/` 匹配 `fallback_api`，解析后入工作台队列；新窗口不丢到系统浏览器 |
| `WatermarkChannel2` 豆包早退 | 移植 | `doubao.com` 不再注入 15 秒 completion 改写；Dola/ciciai 仍保留 |
| `WatermarkChannel1` | 已有更强实现 | 与 V4.4 哈希相同；继续用 `dola-resource-bridge.js` |
| `DolaPluginManagerHelper` / `PluginManagerNativeDialog` | Windows 壳，跳过 | 仅 WinForms 插件卡片 UI；现有 ZIP/CRX/目录导入已覆盖 |
| `DolaAccountBrowserWindowHelper` | Windows 壳，跳过 | WPF 圆角 clip |
| `App.cs` / WebView2 兼容参数 | Windows 壳，跳过 | Electron 用 `render-process-gone` + 修复页面 |
| DualVerify / SafeUnlock / Activation / AppSelfLockGuard | 授权，禁止 | 不得进入 `app/` |
| 主 DLL 其它类型 | 已覆盖 | 与 V4.4 类型列表相同；`MainWindow.cs` +4.3KB 即点击解析/预览拦截 |

## 主程序集文件差（相对 V4.4 反编译）

- `MainWindow.cs` +4361：原生视频点击、`dola-native-video-*` 消息、注入 `dola_video_click_capture.js`
- `App.cs` +1978：WebView2 启动兼容（跳过）
- `AppSelfLockGuard.cs`：授权（禁止）
- `AccountNameDialog.cs` / `InfoDialog.cs` / `PaojiaoActivationSession.cs`：可忽略

## 站点脚本差

V5.2 默认 30 秒：`getItem(DURATION_KEY) !== "0"`，且只在 `model === seedance_v2.5` 时改 `duration`。  
当前仓库补丁逻辑相同，但开关是 `=== "1"`（缺省关闭）。按 V5.2 改为缺省开启。
