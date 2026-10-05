import React from 'react';
import type {
  ProxyConfig,
  ProxyNode,
  ProxyRuntimeState,
  SessionDataKind
} from '@shared/contracts';

export interface ProxyEditorProps {
  value: ProxyConfig;
  onChange: (value: ProxyConfig) => void;
  editingId: string | null;
  runtimeState: ProxyRuntimeState | null;
  busy: boolean;
  onImport: () => void;
  onRefresh: () => void;
  onSelect: (tag: string) => void;
  onTest: (tag?: string) => void;
  onTestAll: () => void;
  onTestProxy: () => void;
  onClearSession: (kind: SessionDataKind) => void;
}

export function ProxyEditor({
  value,
  onChange,
  editingId,
  runtimeState,
  busy,
  onImport,
  onRefresh,
  onSelect,
  onTest,
  onTestAll,
  onTestProxy: _onTestProxy,
  onClearSession
}: ProxyEditorProps): React.JSX.Element {
  const patch = (next: Partial<ProxyConfig>): void => onChange({ ...value, ...next });
  const runtimeLabel =
    runtimeState?.status === 'running'
      ? `运行中 · 端口 ${runtimeState.localPort ?? '—'}`
      : runtimeState?.status === 'starting'
      ? '正在启动 sing-box…'
      : runtimeState?.status === 'failed'
      ? `运行失败：${runtimeState.error ?? '未知原因'}`
      : '未启动';

  return (
    <div className="proxy-box">
      <div className="section-heading">
        <strong>账号独立代理</strong>
        <small>每个账号使用独立 Session、回环端口和路由；同一节点仍可能共享公网出口。</small>
      </div>
      <label className="switch-row">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => patch({ enabled: event.target.checked })}
        />
        启用代理
      </label>
      {value.enabled && (
        <>
          <div className="form-grid proxy-mode">
            <label>
              代理模式
              <select
                value={value.mode}
                onChange={(event) =>
                  patch({
                    mode: event.target.value as ProxyConfig['mode'],
                    type: event.target.value === 'subscription' ? 'socks5' : value.directScheme
                  })
                }
              >
                <option value="direct">直连服务器</option>
                <option value="subscription">订阅 / sing-box</option>
              </select>
            </label>
            <label>
              当前状态
              <span className="inline-status">{runtimeLabel}</span>
            </label>
          </div>
          {value.mode === 'direct' ? (
            <div className="form-grid proxy">
              <select
                value={value.directScheme}
                onChange={(event) =>
                  patch({
                    type: event.target.value as ProxyConfig['type'],
                    directScheme: event.target.value as ProxyConfig['directScheme']
                  })
                }
              >
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
                <option value="socks5">SOCKS5</option>
              </select>
              <input
                placeholder="主机"
                value={value.host}
                onChange={(event) =>
                  patch({
                    host: event.target.value,
                    directAddressText: `${event.target.value}:${value.port ?? ''}`
                  })
                }
              />
              <input
                placeholder="端口"
                type="number"
                value={value.port ?? ''}
                onChange={(event) =>
                  patch({
                    port: Number(event.target.value) || undefined,
                    directAddressText: `${value.host}:${event.target.value}`
                  })
                }
              />
              <input
                placeholder="用户名（可选）"
                value={value.username}
                onChange={(event) => patch({ username: event.target.value })}
              />
              <input
                placeholder="密码（可选）"
                type="password"
                value={value.password}
                onChange={(event) => patch({ password: event.target.value })}
              />
            </div>
          ) : (
            <div className="subscription-editor">
              <label className="wide">
                订阅地址
                <input
                  value={value.subscriptionUrl}
                  onChange={(event) => patch({ subscriptionUrl: event.target.value })}
                  placeholder="https://example.com/subscribe"
                />
              </label>
              <label className="wide">
                请求 User-Agent
                <input
                  value={value.subscriptionUserAgent}
                  onChange={(event) => patch({ subscriptionUserAgent: event.target.value })}
                  placeholder="sing-box"
                />
              </label>
              <div className="account-tools">
                <button type="button" disabled={!editingId || busy} onClick={onImport}>
                  导入订阅
                </button>
                <button type="button" disabled={!editingId || busy} onClick={onRefresh}>
                  刷新订阅
                </button>
                <button
                  type="button"
                  disabled={!editingId || busy || !value.subscriptionNodes.length}
                  onClick={() => onTest(value.selectedNodeTag || undefined)}
                >
                  测试节点
                </button>
                <button
                  type="button"
                  disabled={!editingId || busy || !value.subscriptionNodes.length}
                  onClick={onTestAll}
                >
                  {busy ? '正在测试全部…' : '全部测速 / 出口 IP'}
                </button>
                <span className="inline-status">
                  {value.subscriptionNodes.length
                    ? `${value.subscriptionNodes.length} 个节点`
                    : '尚未导入节点'}
                </span>
              </div>
              {value.subscriptionNodes.length > 0 && (
                <div className="node-picker">
                  <select
                    value={value.selectedNodeTag || value.subscriptionNodes[0]?.tag || ''}
                    onChange={(event) => onSelect(event.target.value)}
                  >
                    {value.subscriptionNodes.map((node: ProxyNode) => (
                      <option value={node.tag} key={node.tag}>
                        {node.name || node.tag}
                        {node.latencyMs ? ` · ${node.latencyMs}ms` : ''}
                        {node.realIp ? ` · ${node.realIp}` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!editingId || busy}
                    onClick={() =>
                      onTest(value.selectedNodeTag || value.subscriptionNodes[0]?.tag)
                    }
                  >
                    测速 / 出口 IP
                  </button>
                </div>
              )}
              {value.lastRuntimeError && (
                <p className="form-warning">上次运行错误：{value.lastRuntimeError}</p>
              )}
              <p className="form-hint">
                支持 sing-box JSON、Clash YAML、V2Ray Base64/URI。核心进程异常时不会自动降级到直连。
              </p>
            </div>
          )}
        </>
      )}
      <div className="account-tools session-tools">
        <span className="form-hint">账号会话工具</span>
        <button type="button" disabled={!editingId || busy} onClick={() => onClearSession('cookies')}>
          清 Cookie
        </button>
        <button type="button" disabled={!editingId || busy} onClick={() => onClearSession('cache')}>
          清缓存
        </button>
        <button type="button" disabled={!editingId || busy} onClick={() => onClearSession('storage')}>
          清 Storage
        </button>
        <button
          type="button"
          className="danger"
          disabled={!editingId || busy}
          onClick={() => onClearSession('all')}
        >
          退出并清理全部
        </button>
      </div>
    </div>
  );
}
