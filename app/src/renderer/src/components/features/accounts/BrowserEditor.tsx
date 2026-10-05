import React from 'react';
import type { AccountInput } from '@shared/contracts';

export interface BrowserEditorProps {
  value: AccountInput['browser'];
  onChange: (value: AccountInput['browser']) => void;
}

export function BrowserEditor({ value, onChange }: BrowserEditorProps): React.JSX.Element {
  const patch = (next: Partial<AccountInput['browser']>): void => onChange({ ...value, ...next });

  return (
    <div className="browser-settings-box">
      <div className="section-heading">
        <strong>浏览器页面</strong>
        <small>每个账号保存自己的页面位置和缩放；恢复地址只接受 HTTP/HTTPS。</small>
      </div>
      <label className="wide">
        主页地址
        <input
          value={value.homeUrl}
          onChange={(event) => patch({ homeUrl: event.target.value })}
          placeholder="留空使用平台默认主页"
        />
      </label>
      <label className="wide">
        上次页面地址
        <input
          value={value.lastUrl}
          onChange={(event) => patch({ lastUrl: event.target.value })}
          placeholder="打开页面后自动保存"
        />
      </label>
      <div className="account-tools">
        <label className="switch-row">
          <input
            type="checkbox"
            checked={value.restoreOnStart}
            onChange={(event) => patch({ restoreOnStart: event.target.checked })}
          />
          启动时恢复上次页面
        </label>
        <button type="button" disabled={!value.lastUrl} onClick={() => patch({ lastUrl: '' })}>
          清除上次页面
        </button>
      </div>
    </div>
  );
}
