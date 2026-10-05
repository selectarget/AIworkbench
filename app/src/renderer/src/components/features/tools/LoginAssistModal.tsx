import React, { useEffect, useState } from 'react';
import { unwrap } from '../../../utils/formatters';

export interface LoginAssistModalProps {
  accountId: string;
  onStatus: (value: string) => void;
}

export function LoginAssistModal({ accountId, onStatus }: LoginAssistModalProps): React.JSX.Element {
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.workbench.browser
      .externalLoginStatus(accountId)
      .then(unwrap)
      .then((value) => setRunning(value.running));
  }, [accountId]);

  const action = async (kind: 'start' | 'sync' | 'close'): Promise<void> => {
    try {
      setBusy(true);
      if (kind === 'start') {
        unwrap(await window.workbench.browser.externalLoginStart(accountId));
        setRunning(true);
        onStatus('已打开 Chrome/Edge，请完成登录');
      } else if (kind === 'sync') {
        const value = unwrap(await window.workbench.browser.externalLoginSync(accountId));
        onStatus(`已同步 ${value.cookies} 个 Cookie，请刷新账号页面`);
      } else {
        unwrap(await window.workbench.browser.externalLoginClose(accountId));
        setRunning(false);
      }
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-assist">
      <p>
        使用系统 Chrome/Edge 完成第三方登录，然后将 Cookie
        同步回当前隔离账号。软件不会读取或保存登录密码。
      </p>
      <div>
        <button
          type="button"
          className="primary"
          disabled={busy || running}
          onClick={() => action('start')}
        >
          打开登录浏览器
        </button>
        <button
          type="button"
          disabled={busy || !running}
          onClick={() => action('sync')}
        >
          同步登录状态
        </button>
        <button
          type="button"
          disabled={busy || !running}
          onClick={() => action('close')}
        >
          关闭辅助浏览器
        </button>
      </div>
    </div>
  );
}
