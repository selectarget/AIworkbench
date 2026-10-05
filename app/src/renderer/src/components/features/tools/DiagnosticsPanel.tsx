import React, { useCallback, useEffect, useState } from 'react';
import type { DiagnosticsAccount, DiagnosticsSnapshot } from '@shared/contracts';
import { unwrap } from '../../../utils/formatters';

export interface DiagnosticsPanelProps {
  onStatus: (value: string) => void;
}

export function DiagnosticsPanel({ onStatus }: DiagnosticsPanelProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setBusy(true);
      setSnapshot(unwrap(await window.workbench.diagnostics()));
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [onStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!snapshot) {
    return (
      <div className="diagnostics-panel">
        <p className="form-hint">正在读取诊断信息…</p>
        <button type="button" disabled={busy} onClick={() => void load()}>
          重新读取
        </button>
      </div>
    );
  }

  const taskTotal = (Object.values(snapshot.taskCounts) as number[]).reduce(
    (sum: number, value: number) => sum + (value || 0),
    0
  );

  const runtimeLabel = (account: DiagnosticsAccount): string => {
    if (!account.proxy.enabled) return '未启用';
    if (account.proxy.mode === 'direct') return '直连代理';
    return account.proxy.status === 'running'
      ? `sing-box 运行中 · ${account.proxy.localPort ?? '—'}`
      : `sing-box ${account.proxy.status}`;
  };

  return (
    <div className="diagnostics-panel">
      <div className="diagnostics-toolbar">
        <span className="form-hint">
          诊断导出会移除账号名称、作品标题、登录数据及地址参数。
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void window.workbench
              .exportDiagnostics()
              .then(unwrap)
              .then((path) => {
                if (path) onStatus(`诊断已导出：${path}`);
              })
              .catch((error) => onStatus(String(error)))
          }
        >
          导出诊断
        </button>
        <button type="button" disabled={busy} onClick={() => void load()}>
          {busy ? '读取中…' : '刷新'}
        </button>
      </div>
      <div className="diagnostic-metrics">
        <div>
          <strong>{snapshot.accountCount}</strong>
          <span>账号</span>
        </div>
        <div>
          <strong>{snapshot.openTabCount}</strong>
          <span>已打开</span>
        </div>
        <div>
          <strong>{snapshot.resourceCount}</strong>
          <span>捕获素材</span>
        </div>
        <div>
          <strong>{taskTotal}</strong>
          <span>下载任务</span>
        </div>
        <div>
          <strong>{snapshot.pluginCount}</strong>
          <span>自定义插件</span>
        </div>
      </div>
      <div className="diagnostic-runtime">
        <div className="section-heading">
          <strong>运行环境</strong>
          <small>快照时间：{new Date(snapshot.generatedAt).toLocaleString()}</small>
        </div>
        <div className="metric-row">
          <span>应用 / Electron</span>
          <strong>
            {snapshot.appVersion} / {snapshot.electronVersion}
          </strong>
        </div>
        <div className="metric-row">
          <span>平台 / 架构</span>
          <strong>
            {snapshot.platform} / {snapshot.arch}
            {snapshot.packaged ? ' · 已打包' : ' · 开发模式'}
          </strong>
        </div>
        <div className="metric-row">
          <span>下载任务</span>
          <strong>
            排队 {snapshot.taskCounts.queued ?? 0} · 运行 {snapshot.taskCounts.running ?? 0} · 完成{' '}
            {snapshot.taskCounts.completed ?? 0} · 失败 {snapshot.taskCounts.failed ?? 0}
          </strong>
        </div>
      </div>
      <div className="diagnostic-accounts">
        <div className="section-heading">
          <strong>账号状态</strong>
          <small>每行对应一个独立的 persist Session。</small>
        </div>
        {snapshot.accounts.length ? (
          snapshot.accounts.map((account: DiagnosticsAccount) => (
            <article key={account.id} className="diagnostic-account">
              <div className="diagnostic-account-head">
                <strong>{account.name}</strong>
                <span className={account.open ? 'diagnostic-good' : 'diagnostic-muted'}>
                  {account.open ? '已打开' : '未打开'}
                </span>
              </div>
              <small>
                {account.platform} · {account.sessionPartition}
              </small>
              <small className="diagnostic-url" title={account.url || '无页面地址'}>
                {account.url || '暂无页面地址'}
              </small>
              <div className="diagnostic-tags">
                <span>{account.adapterEnabled ? '适配器开启' : '适配器关闭'}</span>
                <span>
                  {account.adapterCapabilities.dedicatedDownloader ? '专用下载器' : '通用捕获'}
                </span>
                {account.adapterCapabilities.taskDurations.length > 0 && (
                  <span>
                    任务{' '}
                    {account.adapterCapabilities.taskDurations
                      .map((duration: number) => `${duration}s`)
                      .join('/')}
                  </span>
                )}
                <span>
                  {account.fingerprint.enabled
                    ? `指纹${account.fingerprint.seedPresent ? '已生成' : '缺少种子'}`
                    : '默认指纹'}
                </span>
                <span>{runtimeLabel(account)}</span>
                {account.proxy.nodeCount > 0 && <span>{account.proxy.nodeCount} 节点</span>}
              </div>
              {(account.fingerprint.lastError || account.proxy.error) && (
                <p className="form-warning">{account.fingerprint.lastError || account.proxy.error}</p>
              )}
            </article>
          ))
        ) : (
          <p className="form-hint">暂无账号。</p>
        )}
      </div>
    </div>
  );
}
