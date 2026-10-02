# V6.8 差量清单与迁移对齐

对照日期：2026-10-02

源：`D:\GitProject\test\analysis\AI创作工作台V6,8.exe`（payload 提取物与自用便携版）

实现宿主：`app/`（Electron 跨平台基线，支持 Windows / macOS）

反编译对照：`reference/v68/`（只读，不参与构建）

---

## 1. 功能与架构分类决策

| 模块 / 特性 | 原始位置 | 判定 | 说明 |
|---|---|---|---|
| **批量添加账号** | `DolaAccountBrowserWindowHelper.dll` (`ShowBatchAddDialog` / `RunBatchAdd` / `TryParseBatchCount`) | **移植到 `app/`** | 允许用户一次性新建 1–50 个账号，按所选平台与前缀自动编号（如 `账号 01`），自动派生独立指纹种子与存储记录。 |
| **孤儿 Profile 缓存清理** | `DolaMultiBrowser.dll` (`ScheduleOrphanProfileFolderCleanup` / `IsSafeToDeleteProfileResidue`) | **移植到 `app/`** | 定期/在清理时扫描 Profile 根目录，安全清除已不存在于账号配置中的孤儿数据目录。 |
| **浏览器渲染自愈** | `DolaMultiBrowser.dll` (`ProbeRendererAndReload` / `TrySelfHealBrowserContent` / `NudgeWebViewFirstPaint`) | **已覆盖并对齐** | `app/src/main/browser-manager.ts` 通过 `render-process-gone` 与延迟重新激活提供跨平台自愈能力。 |
| **CK 批量导入增强** | `DolaMultiBrowser.dll` (导入 Cookie 时预创账号并在首次打开时静默注入) | **已覆盖** | `storage-import.ts` 结合 `accounts.ts` 具备同等且兼容的数据导入能力。 |
| **扩展宿主绑定 (WZ host-bind)** | `DolaPluginManagerHelper.dll` + 三个扩展 JS (`data-wz-host-bind`) | **跨平台架构跳过** | 原版为防插件被复制到外部 Chrome 使用而加入设备指纹加签校验；`app/` 内置受控 WebContentsView，通过原生脚本注入，无外部盗用风险。 |
| **账号浏览器面板门禁** | `DolaAccountBrowserWindowHelper.dll` (`EnsureBrowserFeatureAllowed`) | **授权，禁止** | 原版用于强制校验泡椒云 Session 是否在线，无激活即锁死网页。跨平台重建工程不包含该授权逻辑。 |
| **泡椒双验证** | `DolaDualVerifyHelper.dll` | **授权，禁止** | 涉及双 AppKey 远程卡密鉴权与心跳，严禁引入 `app/`。 |
| **启动器 Ed25519 自校验** | 外层 Launcher PE (`VerifyLauncherSelfSignature`) | **Windows 专属，跳过** | 官方 Windows 单文件壳防止逆向修改的自签名校验。跨平台 Electron 打包原生无此限制。 |
| **AI画布工作台** | `normal\Tools\AI画布工作台\` (244.7 MB 独立 Electron 产品) | **独立外部工具，不入主包** | 具有独立 UI（React + antd + codemirror + face-mask wasm）与独立卡密校验，不塞入工作台主工程，保持主应用体积轻盈。 |

---

## 2. 核心程序集代码差异（相对 V5.2 / V6.4）

### 2.1 `DolaAccountBrowserWindowHelper.dll`（变动最大，+25 KB）
- **新增批量创建链路**：
  ```csharp
  // V6.8 新增批量建号逻辑
  public void ShowBatchAddDialog(string platform) { ... }
  private void RunBatchAdd(string platform, int count, string prefix) { ... }
  ```
- **标签栏重构与状态管理**：
  - `AccountBrowserTabState.EnsureBrowserFeatureAllowed()`（原版门禁点）
  - 标签横向平滑滚动、标签数量指示器、关闭与复位逻辑增强。

### 2.2 `DolaMultiBrowser.dll`
- **后台清扫与稳定性**：
  - `ScheduleOrphanProfileFolderCleanup()`：定时轮询清理无主 profile 目录。
  - `CleanupPersistedTabName()` / `PruneStalePersistedTabNames()`：清理残留标签。
  - 渲染崩溃自愈：`ProbeRendererAndReload()`、`ForceRepaintAfterReattach()`。

### 2.3 扩展层插件
- `ip-display-extension`、`豆包Dola30秒助手`、`豆包自动发送提示词插件` 核心业务逻辑不变，最外层均被 `window.__wzPluginGate` / `self.wzAccept` 包装（`data-wz-host-bind` 校验）。

---

## 3. `app/` 落地实现清单

1. **`app/src/shared/contracts.ts`**：
   - 增加 `batchCreateAccountsSchema` 与 `BatchCreateAccountsInput` 接口定义，约束单次添加上限为 50，支持自定义前缀、起始序号、代理和分组。
2. **`app/src/shared/channels.ts`**：
   - 新增 IPC 频道 `ACCOUNT_BATCH_CREATE = 'account:batch-create'`。
3. **`app/src/main/accounts.ts`**：
   - 在 `AccountService` 增加 `batchCreate()` 方法，为每个账号生成专属安全 ID、生成唯一设备指纹（`createFingerprintProfile`），并执行单次原子保存。
4. **`app/src/main/ipc.ts`**：
   - 挂载 `ACCOUNT_BATCH_CREATE` 处理器，实现严格参数校验与主渲染进程响应。
5. **`app/src/main/session-cleanup.ts`**：
   - 增加 `purgeOrphanProfiles`，实现对已删除账号残留磁盘目录的安全回收。
6. **`app/tests/batch-accounts.test.ts`**：
   - 添加完整的单元测试集，验证批量创建逻辑、数量边界、名称生成、指纹独立性及孤儿目录清除。
