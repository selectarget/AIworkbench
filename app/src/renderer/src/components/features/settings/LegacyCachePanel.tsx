import React from 'react';
import type {
  LegacyCacheCandidate,
  LegacyCacheCleanReport,
  LegacyCacheScan
} from '@shared/contracts';
import { formatBytes } from '../../../utils/formatters';

export interface LegacyCachePanelProps {
  scan: LegacyCacheScan | null;
  report: LegacyCacheCleanReport | null;
  busy: boolean;
  onScan: () => void;
  onClean: () => void;
}

export function LegacyCachePanel({
  scan,
  report,
  busy,
  onScan,
  onClean
}: LegacyCachePanelProps): React.JSX.Element {
  return (
    <div className="tool-box" data-settings-section="compatibility">
      <div className="section-heading">
        <strong>旧版临时缓存</strong>
        <small>
          只扫描旧版 DolaMultiBrowser
          明确使用的临时目录；不会清理账号浏览器数据、下载文件或普通临时文件。按目录最后修改时间筛选，清理前会重新扫描。
        </small>
      </div>
      <div className="account-tools">
        <button type="button" disabled={busy} onClick={onScan}>
          扫描旧版缓存
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || !scan?.candidates.length}
          onClick={onClean}
        >
          确认清理
        </button>
        {scan && (
          <span className="inline-status">
            {scan.candidates.length
              ? `${scan.candidates.length} 个目录 · ${formatBytes(scan.totalBytes)}`
              : '没有符合条件的目录'}
          </span>
        )}
      </div>
      {scan?.candidates.length ? (
        <div className="cache-cleanup-list">
          {scan.candidates.map((candidate: LegacyCacheCandidate) => (
            <div className="directory-setting" key={candidate.path}>
              <div>
                <strong>
                  {candidate.source === 'local-appdata'
                    ? 'LocalAppData'
                    : candidate.source === 'temp-full'
                    ? '临时运行目录'
                    : candidate.source === 'temp-normal'
                    ? '普通临时目录'
                    : '旧版临时缓存'}
                </strong>
                <small>
                  {candidate.path} · {candidate.ageHours} 小时未修改 ·{' '}
                  {formatBytes(candidate.sizeBytes)}
                </small>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {report?.failed.length ? (
        <p className="form-warning">
          有 {report.failed.length} 个目录未能清理：
          {report.failed
            .map((item: { candidate: LegacyCacheCandidate; error: string }) => `${item.candidate.path}（${item.error}）`)
            .join('；')}
        </p>
      ) : null}
    </div>
  );
}
