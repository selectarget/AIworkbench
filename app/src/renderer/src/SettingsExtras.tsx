import { useState } from 'react';
import type { AppSettings } from '../../shared/contracts';

export function SettingsExtras({ settings, onChange, onStatus }: { settings: AppSettings; onChange(patch: Partial<AppSettings>): Promise<void>; onStatus(message: string): void }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  async function backup(action: 'export' | 'restore' | 'folder'): Promise<void> {
    setBusy(true);
    try {
      if (action === 'export') {
        const result = await window.workbench.configuration.exportBackup();
        if (!result.ok) throw new Error(result.error.message);
        if (result.data) onStatus(`配置已备份：${result.data}`);
      } else if (action === 'restore') {
        const result = await window.workbench.configuration.restoreBackup();
        if (!result.ok) throw new Error(result.error.message);
        if (result.data.restored) window.location.reload();
      } else {
        const result = await window.workbench.configuration.openBackups();
        if (!result.ok) throw new Error(result.error.message);
      }
    } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <div className="tool-box" data-settings-section="backup">
    <div className="section-heading"><strong>配置备份与恢复</strong><small>启动时每天自动备份一次，保留最近 30 份。备份包含账号配置、指纹、代理配置和工作台设置；登录会话及视频文件保存在各自目录中。</small></div>
    <p className="form-hint">备份可能包含代理配置，请保存在自己的电脑。跨电脑恢复后，代理凭据可能需要重新填写。</p>
    <div className="account-tools"><button disabled={busy} onClick={() => void backup('export')}>导出配置</button><button disabled={busy} onClick={() => void backup('restore')}>恢复配置</button><button disabled={busy} onClick={() => void backup('folder')}>自动备份目录</button></div>
  </div>;
}
