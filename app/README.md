# AI 创作工作台 · 应用工程

这是 AI 创作工作台的 Electron 工程目录。项目概览、功能、架构、数据目录和发布流程请先阅读仓库根目录的 [`../README.md`](../README.md)。

## 快速开始

```bash
npm ci
npm run dev
```

要求 Node.js 22 LTS 和 Git LFS。`sing-box/`、`media-tools/` 中的原生二进制通过 LFS 存储，克隆后确认已执行 `git lfs install`。

## 目录

- `src/main/`：主进程（账号、浏览器、代理、媒体、下载、插件、更新）
- `src/preload/`：沙箱 preload
- `src/renderer/`：React 界面
- `src/shared/`：Zod schema、IPC 通道、平台定义
- `scripts/`：打包、资源校验、冒烟测试
- `tests/`：Vitest 测试
- `sing-box/`、`media-tools/`、`face-grid-assets/`：运行时原生资源

## 验证与打包

```bash
npm run typecheck
npm test
npm run build
npm run smoke:all
```

Windows：

```bash
npm run pack:win
npm run dist:win
npm run smoke:portable
```

macOS：

```bash
npm run pack:mac
npm run dist:mac:unsigned
npm run verify:mac-release -- <app路径> <x64|arm64> --dmg <dmg路径>
```

## 说明

- 数据隔离使用 `persist:account_<id>` Session；账号配置、代理密码、下载任务都由主进程管理。
- 真实站点登录、生成和下载需要在对应环境用自有账号人工验收。
- 发布工作流见 `.github/workflows/release.yml`（Windows + macOS 自动发布）和 `release-macos.yml`（签名/公证发布）。
- 旧版 API 表面审计依赖本地 `reference-original/`，该目录不进入仓库；缺失时脚本会明确跳过。
