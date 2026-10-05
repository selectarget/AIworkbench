import React, { useCallback, useEffect, useState } from 'react';
import type {
  AppSettings,
  LegacyCacheCleanReport,
  LegacyCacheScan,
  MediaToolStatus,
  PlatformDefinition,
  PlatformId,
  PluginRecord,
  ProfileLocationInfo
} from '@shared/contracts';
import { formatBytes, unwrap } from '../../../utils/formatters';
import { SettingsExtras } from '../../../SettingsExtras';
import { LegacyCachePanel } from './LegacyCachePanel';

export interface SettingsPanelProps {
  settings: AppSettings;
  platforms: PlatformDefinition[];
  onChange: (patch: Partial<AppSettings>) => Promise<void>;
  onStatus: (value: string) => void;
}

export function SettingsPanel({
  settings,
  platforms,
  onChange,
  onStatus
}: SettingsPanelProps): React.JSX.Element {
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);
  const [pluginBusy, setPluginBusy] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{
    enabled: boolean;
    hasUpdate: boolean;
    latestVersion?: string;
    releaseUrl?: string;
    reason?: string;
  } | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [toolStatus, setToolStatus] = useState<MediaToolStatus | null>(null);
  const [toolBusy, setToolBusy] = useState(false);
  const [cacheScan, setCacheScan] = useState<LegacyCacheScan | null>(null);
  const [cacheCleanReport, setCacheCleanReport] = useState<LegacyCacheCleanReport | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [profileLocation, setProfileLocation] = useState<ProfileLocationInfo | null>(null);

  const toggleAdapter = (id: PlatformId, enabled: boolean): void => {
    const disabled = enabled
      ? settings.disabledAdapters.filter((item: PlatformId) => item !== id)
      : [...new Set([...settings.disabledAdapters, id])];
    void onChange({ disabledAdapters: disabled });
  };

  const patchBossKey = (patch: Partial<AppSettings['bossKey']>): void => {
    void onChange({ bossKey: { ...settings.bossKey, ...patch } });
  };

  const checkUpdate = async (): Promise<void> => {
    try {
      const info = unwrap(await window.workbench.updates.check());
      setUpdateInfo(info);
      onStatus(
        !info.enabled
          ? info.reason || '未配置公开更新仓库'
          : info.hasUpdate
          ? `发现新版本 ${info.latestVersion}`
          : '当前已是最新版本'
      );
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const downloadUpdate = async (): Promise<void> => {
    try {
      setUpdateBusy(true);
      const path = unwrap(await window.workbench.updates.download());
      onStatus(`更新包已下载：${path}`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setUpdateBusy(false);
    }
  };

  const openRelease = async (): Promise<void> => {
    try {
      unwrap(await window.workbench.updates.openRelease());
      onStatus('已打开 GitHub 发布页');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const checkFfmpeg = async (): Promise<void> => {
    try {
      setToolBusy(true);
      const value = unwrap(await window.workbench.media.toolStatus());
      setToolStatus(value);
      onStatus(value.message);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setToolBusy(false);
    }
  };

  const loadPlugins = useCallback(async (): Promise<void> => {
    try {
      setPlugins(unwrap(await window.workbench.plugins.list()));
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  }, [onStatus]);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  const loadProfileLocation = useCallback(async (): Promise<void> => {
    try {
      setProfileLocation(unwrap(await window.workbench.data.profileLocation()));
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  }, [onStatus]);

  useEffect(() => {
    void loadProfileLocation();
  }, [loadProfileLocation]);

  const importPlugin = async (kind: 'package' | 'directory'): Promise<void> => {
    try {
      setPluginBusy(true);
      const plugin = unwrap(
        await (kind === 'package'
          ? window.workbench.plugins.importPackage()
          : window.workbench.plugins.importDirectory())
      );
      await loadPlugins();
      onStatus(`已导入插件：${plugin.name}`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setPluginBusy(false);
    }
  };

  const togglePlugin = async (plugin: PluginRecord): Promise<void> => {
    try {
      setPluginBusy(true);
      setPlugins(
        unwrap(await window.workbench.plugins.setEnabled(plugin.id, !plugin.enabled))
      );
      onStatus(`${plugin.enabled ? '已禁用' : '已启用'}插件：${plugin.name}`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setPluginBusy(false);
    }
  };

  const removePlugin = async (plugin: PluginRecord): Promise<void> => {
    if (!confirm(`确定移除插件“${plugin.name}”？`)) return;
    try {
      setPluginBusy(true);
      unwrap(await window.workbench.plugins.remove(plugin.id));
      await loadPlugins();
      onStatus(`已移除插件：${plugin.name}`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setPluginBusy(false);
    }
  };

  const chooseProfileLocation = async (): Promise<void> => {
    try {
      setProfileLocation(unwrap(await window.workbench.data.chooseProfileLocation()));
      onStatus('浏览器数据目录已更新；重启应用后生效');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const resetProfileLocation = async (): Promise<void> => {
    try {
      setProfileLocation(unwrap(await window.workbench.data.resetProfileLocation()));
      onStatus('已恢复默认浏览器数据目录；重启应用后生效');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const restartForProfileLocation = (): void => {
    onStatus('正在重启应用以应用浏览器数据目录…');
    void window.workbench.data
      .restart()
      .catch((error: unknown) =>
        onStatus(error instanceof Error ? error.message : String(error))
      );
  };

  const scanLegacyCache = async (): Promise<void> => {
    try {
      setCacheBusy(true);
      setCacheCleanReport(null);
      const value = unwrap(await window.workbench.maintenance.scanLegacyCache());
      setCacheScan(value);
      onStatus(
        value.candidates.length
          ? `发现 ${value.candidates.length} 个旧版临时目录，可释放 ${formatBytes(
              value.totalBytes
            )}`
          : '未发现符合条件的旧版临时目录'
      );
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCacheBusy(false);
    }
  };

  const cleanLegacyCache = async (): Promise<void> => {
    if (!cacheScan?.candidates.length) return onStatus('没有可清理的旧版临时目录');
    if (
      !confirm(
        `将删除 ${cacheScan.candidates.length} 个旧版临时目录，预计释放 ${formatBytes(
          cacheScan.totalBytes
        )}。只会处理旧版 DolaMultiBrowser 临时目录，继续吗？`
      )
    )
      return;
    try {
      setCacheBusy(true);
      const value = unwrap(await window.workbench.maintenance.cleanLegacyCache());
      setCacheCleanReport(value);
      setCacheScan(value.remaining);
      onStatus(
        `旧版临时缓存清理完成：释放 ${formatBytes(value.freedBytes)}${
          value.failed.length ? `，失败 ${value.failed.length} 个` : ''
        }`
      );
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCacheBusy(false);
    }
  };

  const chooseDownloadDir = async (): Promise<void> => {
    try {
      const path = unwrap(await window.workbench.files.chooseDownloadDir());
      onStatus(`普通下载目录：${path}`);
      await onChange({ downloadDir: path });
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const chooseVideoDownloadDir = async (): Promise<void> => {
    try {
      const path = unwrap(await window.workbench.files.chooseVideoDownloadDir());
      onStatus(`视频下载目录：${path}`);
      await onChange({ videoDownloadDir: path });
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const openVideoDownloadDir = async (): Promise<void> => {
    try {
      unwrap(await window.workbench.files.openVideoDownloadDir());
      onStatus('已打开视频下载目录');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="settings-list">
      <div className="section-header-banner" data-settings-section="general">
        <div className="section-heading">
          <strong>常规设置</strong>
          <small>工作台基础外观与素材解析选项</small>
        </div>
      </div>
      <div className="setting-row" data-settings-section="general">
        <span>
          <strong>工作台外观</strong>
          <small>统一白色界面风格</small>
        </span>
        <span className="setting-tag">浅色模式</span>
      </div>
      <div className="setting-row" data-settings-section="general">
        <span>
          <strong>解析图片素材</strong>
          <small>
            默认关闭，只解析视频；开启后素材区会同时捕获图片，并提供图片类型筛选。
          </small>
        </span>
        <button
          type="button"
          className="capture-switch"
          role="switch"
          aria-label="图片解析"
          aria-checked={settings.parseImages}
          onClick={() => void onChange({ parseImages: !settings.parseImages })}
        >
          <span />
        </button>
      </div>
      <div className="setting-row" data-settings-section="general">
        <span>
          <strong>域名拦截兼容</strong>
          <small>
            适用于已拦截相关域名的网络环境：提前取消五个固定域名的后台请求，减少重复 SSL
            握手错误。关闭立即恢复请求；此选项不会恢复被拦截接口。
          </small>
        </span>
        <button
          type="button"
          className="capture-switch"
          role="switch"
          aria-label="域名拦截兼容"
          aria-checked={settings.blockedSiteRequestCompatibility}
          onClick={() =>
            void onChange({
              blockedSiteRequestCompatibility: !settings.blockedSiteRequestCompatibility
            })
          }
        >
          <span />
        </button>
      </div>

      <div className="section-header-banner" data-settings-section="downloads">
        <div className="section-heading">
          <strong>下载设置</strong>
          <small>文件保存路径、文件命名规则与队列并发</small>
        </div>
      </div>
      <div className="tool-box" data-settings-section="downloads">
        <div className="section-heading">
          <strong>下载目录</strong>
          <small>普通资源和视频可以分别保存；视频目录留空时跟随普通下载目录。</small>
        </div>
        <div className="directory-setting">
          <div>
            <strong>普通下载目录</strong>
            <small>{settings.downloadDir}</small>
          </div>
          <div className="account-tools">
            <button type="button" onClick={() => void chooseDownloadDir()}>
              更改
            </button>
            <button
              type="button"
              onClick={() =>
                window.workbench.files
                  .openDownloadDir()
                  .then(unwrap)
                  .then(() => onStatus('已打开普通下载目录'))
                  .catch((error) =>
                    onStatus(error instanceof Error ? error.message : String(error))
                  )
              }
            >
              打开
            </button>
          </div>
        </div>
        <div className="directory-setting">
          <div>
            <strong>视频下载目录</strong>
            <small>{settings.videoDownloadDir || '跟随普通下载目录'}</small>
          </div>
          <div className="account-tools">
            <button type="button" onClick={() => void chooseVideoDownloadDir()}>
              更改
            </button>
            <button type="button" onClick={() => void openVideoDownloadDir()}>
              打开
            </button>
          </div>
        </div>
      </div>
      <label className="wide" data-settings-section="downloads">
        <span>
          <strong>普通资源文件名前缀</strong>
          <small>
            应用到统一下载队列的普通图片/视频；Dola/豆包平台编号视频仍保持 1.mp4、2.mp4…
          </small>
        </span>
        <input
          value={settings.videoFilenamePrefix}
          onChange={(event) => void onChange({ videoFilenamePrefix: event.target.value })}
          placeholder="例如：项目A"
        />
      </label>
      <label data-settings-section="downloads">
        <span>
          <strong>目录规则</strong>
          <small>选择新建下载文件夹的组织结构</small>
        </span>
        <select
          value={settings.downloadFolderPattern}
          onChange={(event) =>
            void onChange({
              downloadFolderPattern: event.target.value as AppSettings['downloadFolderPattern']
            })
          }
        >
          <option value="account">账号</option>
          <option value="platform">平台</option>
          <option value="platform-account">平台 / 账号</option>
          <option value="date">日期 / 账号</option>
        </select>
      </label>
      <label className="setting-row" data-settings-section="downloads">
        <span>
          <strong>按规则创建下载目录</strong>
          <small>{settings.downloadDir}</small>
        </span>
        <input
          type="checkbox"
          checked={settings.useAccountDownloadSubfolders}
          onChange={(event) =>
            void onChange({ useAccountDownloadSubfolders: event.target.checked })
          }
        />
      </label>
      <label className="setting-row" data-settings-section="downloads">
        <span>
          <strong>Dola / 豆包视频使用平台目录与编号</strong>
          <small>
            视频保存到独立平台目录，并按 1.mp4、2.mp4… 连续编号；关闭后使用上面的目录规则。
          </small>
        </span>
        <input
          type="checkbox"
          checked={settings.legacyVideoLayout}
          onChange={(event) => void onChange({ legacyVideoLayout: event.target.checked })}
        />
      </label>
      <label data-settings-section="downloads">
        <span>
          <strong>同时下载数</strong>
          <small>并发下载任务数（建议 2～4）</small>
        </span>
        <input
          type="number"
          min="1"
          max="6"
          value={settings.downloadConcurrency}
          onChange={(event) => void onChange({ downloadConcurrency: Number(event.target.value) })}
        />
      </label>
      <label data-settings-section="downloads">
        <span>
          <strong>失败重试次数</strong>
          <small>网络错误或超时时的重试次数</small>
        </span>
        <input
          type="number"
          min="0"
          max="5"
          value={settings.downloadRetryCount}
          onChange={(event) => void onChange({ downloadRetryCount: Number(event.target.value) })}
        />
      </label>

      <div className="section-header-banner" data-settings-section="browser">
        <div className="section-heading">
          <strong>浏览器环境</strong>
          <small>多账号 Session 隔离、数据目录与外部登录辅助</small>
        </div>
      </div>
      <div className="tool-box" data-settings-section="browser">
        <div className="section-heading">
          <strong>账号运行管理</strong>
          <small>限制同时打开的账号数量，减少内存占用。关闭闲置标签后，登录数据仍会保留。</small>
        </div>
        <label className="setting-row">
          <span>
            同时运行账号上限
            <small>建议日常使用 10～20 个</small>
          </span>
          <select
            value={settings.maxOpenAccounts ?? 20}
            onChange={(event) =>
              void onChange({ maxOpenAccounts: Number(event.target.value) }).catch((error) =>
                onStatus(String(error))
              )
            }
          >
            {[5, 10, 12, 20, 30, 50, 100].map((count) => (
              <option key={count} value={count}>
                {count} 个
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="tool-box" data-settings-section="browser">
        <div className="section-heading">
          <strong>浏览器数据目录</strong>
          <small>
            每个账号的 Cookie、LocalStorage、IndexedDB、缓存和扩展存储都在这里；切换只对
            Electron Session 生效，不复制旧版 WebView2 数据库，需重启应用。
          </small>
        </div>
        <small className="form-hint">
          {profileLocation
            ? `配置目录：${profileLocation.path}${
                profileLocation.restartRequired
                  ? `（当前仍使用：${profileLocation.activePath}）`
                  : ''
              }`
            : '正在读取目录…'}
        </small>
        <div className="account-tools">
          <button type="button" onClick={() => void chooseProfileLocation()}>
            更改目录
          </button>
          <button type="button" onClick={() => void resetProfileLocation()}>
            恢复默认
          </button>
          {profileLocation?.restartRequired && (
            <button
              type="button"
              className="primary"
              onClick={restartForProfileLocation}
            >
              立即重启
            </button>
          )}
        </div>
      </div>
      <div className="tool-box" data-settings-section="browser">
        <div className="section-heading">
          <strong>外部登录浏览器</strong>
          <small>留空会自动查找 Chrome/Edge；macOS 可填写自定义安装路径。</small>
        </div>
        <label className="wide">
          Chrome / Edge 可执行文件路径
          <input
            value={settings.externalBrowserPath}
            onChange={(event) => void onChange({ externalBrowserPath: event.target.value })}
            placeholder="例如：/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
          />
        </label>
      </div>

      <div className="section-header-banner" data-settings-section="compatibility">
        <div className="section-heading">
          <strong>兼容性与维护</strong>
          <small>媒体工具检测、旧版格式兼容及临时缓存清理</small>
        </div>
      </div>
      <div className="tool-box" data-settings-section="compatibility">
        <div className="section-heading">
          <strong>兼容播放工具</strong>
          <small>
            视频预览转换只使用你指定或随应用携带的 FFmpeg，不影响原文件下载。
          </small>
        </div>
        <label className="wide">
          FFmpeg 路径（留空自动检测）
          <input
            value={settings.ffmpegPath}
            onChange={(event) => void onChange({ ffmpegPath: event.target.value })}
            placeholder="例如：/opt/homebrew/bin/ffmpeg"
          />
        </label>
        <div className="account-tools">
          <button type="button" disabled={toolBusy} onClick={() => void checkFfmpeg()}>
            检测 FFmpeg
          </button>
          {toolStatus && (
            <span
              className={
                toolStatus.available ? 'inline-status success' : 'inline-status error'
              }
            >
              {toolStatus.message}
            </span>
          )}
        </div>
      </div>
      <label className="setting-row" data-settings-section="compatibility">
        <span>
          <strong>实验性 15 秒响应适配</strong>
          <small>默认启用；页面变化时可以关闭</small>
        </span>
        <input
          type="checkbox"
          checked={settings.experimentalResponsePatchEnabled}
          onChange={(event) =>
            void onChange({ experimentalResponsePatchEnabled: event.target.checked })
          }
        />
      </label>
      <label className="setting-row" data-settings-section="compatibility">
        <span>
          <strong>V5.2 素材目录兼容</strong>
          <small>
            保存到根目录/Videos 与根目录/Images；视频使用 1.mp4、2.mp4…，图片使用时间戳命名；保留当前配置，按需开启。
          </small>
        </span>
        <input
          type="checkbox"
          checked={settings.legacyV44MediaFolders}
          onChange={(event) => void onChange({ legacyV44MediaFolders: event.target.checked })}
        />
      </label>
      <LegacyCachePanel
        scan={cacheScan}
        report={cacheCleanReport}
        busy={cacheBusy}
        onScan={() => void scanLegacyCache()}
        onClean={() => void cleanLegacyCache()}
      />

      <div className="section-header-banner" data-settings-section="updates">
        <div className="section-heading">
          <strong>软件更新</strong>
          <small>检查应用新版本与发布动态</small>
        </div>
      </div>
      <div className="update-box" data-settings-section="updates">
        <div>
          <strong>公开更新</strong>
          <small>
            {updateInfo
              ? updateInfo.enabled
                ? updateInfo.hasUpdate
                  ? `发现 ${updateInfo.latestVersion}`
                  : '当前已是最新版本'
                : '未配置更新仓库'
              : '未检查'}
          </small>
        </div>
        <div className="account-tools">
          <button type="button" onClick={() => void checkUpdate()}>
            检查更新
          </button>
          {updateInfo?.releaseUrl && (
            <button type="button" onClick={() => void openRelease()}>
              打开发布页
            </button>
          )}
          {updateInfo?.hasUpdate && (
            <button
              type="button"
              className="primary"
              disabled={updateBusy}
              onClick={() => void downloadUpdate()}
            >
              下载更新
            </button>
          )}
        </div>
      </div>

      <div className="section-header-banner" data-settings-section="shortcuts">
        <div className="section-heading">
          <strong>全局快捷键</strong>
          <small>快速隐藏工作台窗口（Boss Key）及快捷按键</small>
        </div>
      </div>
      <div className="boss-key" data-settings-section="shortcuts">
        <strong>Boss Key / 快速隐藏</strong>
        <label className="setting-row">
          <span>
            <small>全局按键仅在应用运行时生效</small>
          </span>
          <input
            type="checkbox"
            checked={settings.bossKey.enabled}
            onChange={(event) => patchBossKey({ enabled: event.target.checked })}
          />
        </label>
        <div className="form-grid">
          <label>
            按键
            <input
              maxLength={1}
              value={settings.bossKey.key}
              onChange={(event) =>
                patchBossKey({
                  key: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'H'
                })
              }
            />
          </label>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={settings.bossKey.ctrl}
              onChange={(event) => patchBossKey({ ctrl: event.target.checked })}
            />
            Ctrl
          </label>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={settings.bossKey.alt}
              onChange={(event) => patchBossKey({ alt: event.target.checked })}
            />
            Alt
          </label>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={settings.bossKey.shift}
              onChange={(event) => patchBossKey({ shift: event.target.checked })}
            />
            Shift
          </label>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={settings.bossKey.meta}
              onChange={(event) => patchBossKey({ meta: event.target.checked })}
            />
            Command / Super
          </label>
        </div>
      </div>

      <div className="section-header-banner" data-settings-section="platforms">
        <div className="section-heading">
          <strong>平台适配器</strong>
          <small>开启或停用各个内置平台的解析与支持模块</small>
        </div>
      </div>
      <div className="adapter-switches" data-settings-section="platforms">
        <strong>平台适配器列表</strong>
        {platforms
          .filter((item) => item.id !== 'custom')
          .map((platform) => (
            <label key={platform.id}>
              <span>{platform.name}</span>
              <input
                type="checkbox"
                checked={!settings.disabledAdapters.includes(platform.id)}
                onChange={(event) => toggleAdapter(platform.id, event.target.checked)}
              />
            </label>
          ))}
      </div>

      <div className="section-header-banner" data-settings-section="plugins">
        <div className="section-heading">
          <strong>浏览器插件</strong>
          <small>导入 Chrome 扩展（CRX / ZIP）以增强浏览器功能</small>
        </div>
      </div>
      <div className="plugin-manager" data-settings-section="plugins">
        <div className="section-heading">
          <strong>浏览器插件管理</strong>
          <small>
            导入 ZIP / CRX 后安装到每个账号自己的 Session；插件下载会统一进入工作台队列。
          </small>
        </div>
        <div className="account-tools">
          <button
            type="button"
            disabled={pluginBusy}
            onClick={() => void importPlugin('package')}
          >
            导入 ZIP / CRX
          </button>
          <button
            type="button"
            disabled={pluginBusy}
            onClick={() => void importPlugin('directory')}
          >
            导入目录
          </button>
          <button
            type="button"
            disabled={pluginBusy}
            onClick={() =>
              window.workbench.plugins.openFolder().then(unwrap).catch(onStatus)
            }
          >
            打开插件目录
          </button>
        </div>
        {plugins.length ? (
          <div className="plugin-list">
            {plugins.map((plugin) => (
              <div className="plugin-row" key={plugin.id}>
                <span>
                  <strong>{plugin.name}</strong>
                  <small>
                    v{plugin.version || '未声明'} · Manifest V{plugin.manifestVersion}
                    {plugin.description ? ` · ${plugin.description}` : ''}
                  </small>
                </span>
                <label className="switch-row">
                  <input
                    type="checkbox"
                    disabled={pluginBusy}
                    checked={plugin.enabled}
                    onChange={() => void togglePlugin(plugin)}
                  />
                  启用
                </label>
                <button
                  type="button"
                  disabled={pluginBusy}
                  onClick={() => void removePlugin(plugin)}
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="form-hint">
            尚未导入自定义插件。内置平台适配器仍按平台自动加载。
          </p>
        )}
      </div>

      <div className="section-header-banner" data-settings-section="backup">
        <div className="section-heading">
          <strong>配置备份与恢复</strong>
          <small>工作台全局配置与账号灾备管理</small>
        </div>
      </div>
      <SettingsExtras settings={settings} onChange={onChange} onStatus={onStatus} />
    </div>
  );
}
