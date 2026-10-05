import React, { useState } from 'react';
import type { LegacyImportPreview, LegacyImportReport } from '@shared/contracts';
import { unwrap } from '../../../utils/formatters';

type LegacyAccountPreview = LegacyImportPreview['accounts'][number];

export interface MigrationPanelProps {
  activeAccountId: string | null;
  onImported: () => Promise<void>;
  onStatus: (value: string) => void;
}

export function MigrationPanel({
  activeAccountId,
  onImported,
  onStatus
}: MigrationPanelProps): React.JSX.Element {
  const [preview, setPreview] = useState<LegacyImportPreview | null>(null);
  const [report, setReport] = useState<LegacyImportReport | null>(null);
  const [busy, setBusy] = useState(false);

  const runPreview = async (): Promise<void> => {
    try {
      setBusy(true);
      setReport(null);
      const value = unwrap(await window.workbench.migration.preview());
      setPreview(value);
      if (value) onStatus(`已读取 V4.4 配置：${value.accountCount} 个账号`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const runImport = async (): Promise<void> => {
    if (!preview) return onStatus('请先选择配置并预览');
    if (
      !confirm(
        `将导入 ${preview.accountCount} 个账号，应用会先自动备份当前账号配置，继续吗？`
      )
    )
      return;
    try {
      setBusy(true);
      const value = unwrap(await window.workbench.migration.import());
      if (value) {
        setReport(value);
        await onImported();
        onStatus(`迁移完成：导入 ${value.imported} 个，跳过 ${value.skipped} 个`);
      }
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const importStorage = async (): Promise<void> => {
    if (!activeAccountId) return onStatus('请先打开或选择一个账号');
    try {
      setBusy(true);
      const value = unwrap(await window.workbench.migration.importStorage(activeAccountId));
      onStatus(
        `Storage 导入完成：Cookie ${value.cookies}，LocalStorage ${value.localStorage}，SessionStorage ${
          value.sessionStorage
        }，IndexedDB ${value.indexedDb} 个数据库${
          value.errors.length ? `；${value.errors.join('；')}` : ''
        }`
      );
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="migration-panel">
      <p>
        导入 V4.4 的 AppConfig、账号、区域代理、fingerprint_config.json 和 Dola
        画幅偏好。不会直接复制 WebView2 Cookie、缓存或数据库；登录态请用 Cookie/Storage
        文件或重新登录恢复。Cookie/Storage 文件中的结构化
        IndexedDB（数据库、对象仓库、索引和记录）会在账号页面打开后尝试恢复。
      </p>
      <div className="account-tools">
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => void runPreview()}
        >
          选择并预览 V4.4
        </button>
        <button
          type="button"
          disabled={busy || !preview}
          onClick={() => void runImport()}
        >
          确认导入
        </button>
        <button
          type="button"
          disabled={busy || !activeAccountId}
          onClick={() => void importStorage()}
        >
          导入当前账号 Cookie/Storage
        </button>
      </div>
      {preview && (
        <div className="migration-preview">
          <div className="metric-row">
            <span>配置文件</span>
            <strong>{preview.sourcePath}</strong>
          </div>
          <div className="metric-row">
            <span>账号</span>
            <strong>{preview.accountCount}</strong>
          </div>
          <div className="metric-row">
            <span>指纹</span>
            <strong>{preview.fingerprintCount}</strong>
          </div>
          <div className="metric-row">
            <span>代理配置</span>
            <strong>{preview.proxyProfileCount}</strong>
          </div>
          <div className="metric-row">
            <span>旧版浏览器数据目录</span>
            <strong>
              {preview.settings.hasProfileRoot
                ? preview.settings.profileRoot
                : '未发现；保持当前目录'}
            </strong>
          </div>
          <div className="metric-row">
            <span>普通下载目录</span>
            <strong>
              {preview.settings.hasDownloadDir
                ? preview.settings.downloadDir
                : '保持当前设置'}
            </strong>
          </div>
          <div className="metric-row">
            <span>视频下载目录</span>
            <strong>
              {preview.settings.hasVideoDownloadDir
                ? preview.settings.videoDownloadDir
                : '跟随普通下载目录'}
            </strong>
          </div>
          <div className="metric-row">
            <span>V4.4 素材目录</span>
            <strong>
              {preview.settings.hasLegacyV44MediaFolders
                ? '导入后使用根目录/Videos 与根目录/Images'
                : '保持当前目录规则'}
            </strong>
          </div>
          <div className="metric-row">
            <span>Boss Key</span>
            <strong>
              {preview.settings.hasBossKey
                ? `${preview.settings.bossKey.ctrl ? 'Ctrl+' : ''}${
                    preview.settings.bossKey.alt ? 'Alt+' : ''
                  }${preview.settings.bossKey.shift ? 'Shift+' : ''}${
                    preview.settings.bossKey.meta ? 'Command/Super+' : ''
                  }${preview.settings.bossKey.key}`
                : '保持当前设置'}
            </strong>
          </div>
          <div className="metric-row">
            <span>Dola 画幅</span>
            <strong>
              {preview.settings.hasDolaAspectRatio
                ? preview.settings.dolaAspectRatio
                : '保持当前设置'}
            </strong>
          </div>
          <div className="metric-row">
            <span>旧版主页</span>
            <strong>{preview.settings.homeUrlCount} 个可恢复地址</strong>
          </div>
          <div className="migration-accounts">
            {preview.accounts.map((account: LegacyAccountPreview) => (
              <div key={`${account.legacyId}-${account.name}`}>
                <span>
                  {account.name}
                  {account.conflict ? (
                    <em className="migration-conflict">名称冲突 · 导入时自动改名</em>
                  ) : null}
                </span>
                <small>
                  {account.platform} ·{' '}
                  {account.proxyMode === 'subscription' ? '订阅代理' : '直连代理'}
                  {account.hasFingerprint ? ' · 有指纹' : ''}
                </small>
              </div>
            ))}
          </div>
          {preview.warnings.map((warning: string) => (
            <p className="form-warning" key={warning}>
              {warning}
            </p>
          ))}
        </div>
      )}
      {report && (
        <div className="migration-report">
          <strong>导入结果</strong>
          <span>
            成功 {report.imported} · 跳过 {report.skipped} · 备份：{report.backupPath}
          </span>
          {report.errors.map((error: string) => (
            <p className="form-warning" key={error}>
              {error}
            </p>
          ))}
        </div>
      )}
      <p className="form-hint">
        激活缓存、机器 ID、自锁和授权数据会被忽略。IndexedDB
        只按导入文件提供的结构恢复；站点升级、加密值、Service Worker
        内部状态和未导出的数据库仍需重新登录或重新初始化。
      </p>
    </div>
  );
}
