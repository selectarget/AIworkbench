import React from 'react';
import type { ProxyConfig } from '@shared/contracts';
import { Modal } from '../../ui/Modal';

export interface BulkProxyModalProps {
  selectedCount: number;
  bulkProxy: ProxyConfig;
  busy: boolean;
  onChange: (proxy: ProxyConfig) => void;
  onApply: () => void;
  onClose: () => void;
}

export function BulkProxyModal({
  selectedCount,
  bulkProxy,
  busy,
  onChange,
  onApply,
  onClose
}: BulkProxyModalProps): React.JSX.Element {
  return (
    <Modal
      title={`批量代理 · ${selectedCount} 个账号`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={onApply}
          >
            应用
          </button>
        </>
      }
    >
      <div className="proxy-box">
        <label className="switch-row">
          <input
            type="checkbox"
            checked={bulkProxy.enabled}
            onChange={(event) => onChange({ ...bulkProxy, enabled: event.target.checked })}
          />
          启用代理（关闭可批量恢复系统网络）
        </label>
        {bulkProxy.enabled && (
          <div className="form-grid proxy">
            <select
              value={bulkProxy.type}
              onChange={(event) =>
                onChange({ ...bulkProxy, type: event.target.value as ProxyConfig['type'] })
              }
            >
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
              <option value="socks5">SOCKS5</option>
            </select>
            <input
              placeholder="主机"
              value={bulkProxy.host}
              onChange={(event) => onChange({ ...bulkProxy, host: event.target.value })}
            />
            <input
              placeholder="端口"
              type="number"
              value={bulkProxy.port ?? ''}
              onChange={(event) =>
                onChange({
                  ...bulkProxy,
                  port: Number(event.target.value) || undefined
                })
              }
            />
            <input
              placeholder="用户名"
              value={bulkProxy.username}
              onChange={(event) => onChange({ ...bulkProxy, username: event.target.value })}
            />
            <input
              placeholder="密码"
              type="password"
              value={bulkProxy.password}
              onChange={(event) => onChange({ ...bulkProxy, password: event.target.value })}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
