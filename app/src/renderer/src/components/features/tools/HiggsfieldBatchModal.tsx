import React, { useEffect, useState } from 'react';
import {
  browserProfileSchema,
  fingerprintSchema,
  proxySchema,
  type Account,
  type AccountInput,
  type BatchLoginPlatform,
  type ExternalBrowserLayout,
  type ProxyConfig
} from '@shared/contracts';
import { unwrap } from '../../../utils/formatters';
import {
  externalBrowserGridLayout,
  runWithConcurrency,
  splitIntoBatches
} from '../../../utils/rendererState';

const emptyProxy: ProxyConfig = proxySchema.parse({});
const emptyInput: AccountInput = {
  name: '',
  platform: 'higgsfield',
  group: '',
  remark: '',
  customUrl: '',
  proxy: emptyProxy,
  browser: browserProfileSchema.parse({}),
  fingerprint: fingerprintSchema.parse({})
};
const MAX_STANDARD_ACCOUNT_CREATION = 100;
const MAX_EMBEDDED_BATCH_WORKSPACE_ACCOUNTS = 20;

export interface HiggsfieldBatchProps {
  accounts: Account[];
  onAccountsChanged: () => Promise<void>;
  onStatus: (value: string) => void;
}

export function HiggsfieldBatchModal({
  accounts,
  onAccountsChanged,
  onStatus
}: HiggsfieldBatchProps): React.JSX.Element {
  type Row = { email: string; password: string; status: string; busy: boolean };
  type Credential = { email: string; password: string; note: string; name: string };
  const platform: BatchLoginPlatform = 'higgsfield';
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      accounts.map((account) => [account.id, { email: '', password: '', status: '等待', busy: false }])
    )
  );
  const [batchText, setBatchText] = useState('');
  const [batchGroup, setBatchGroup] = useState('Higgsfield批量');
  const [createBusy, setCreateBusy] = useState(false);
  const [batchLoginBusy, setBatchLoginBusy] = useState(false);
  const [batchLoginMode, setBatchLoginMode] = useState<'embedded' | 'external'>('embedded');

  const patch = (id: string, value: Partial<Row>): void =>
    setRows((current) => ({ ...current, [id]: { ...current[id]!, ...value } }));

  useEffect(() => {
    setRows((current) =>
      Object.fromEntries(
        accounts.map((account) => [
          account.id,
          current[account.id] ?? { email: '', password: '', status: '等待', busy: false }
        ])
      )
    );
  }, [accounts]);

  useEffect(() => {
    if (batchLoginMode === 'external') void window.workbench.browser.closeBatchWorkspace();
  }, [batchLoginMode]);

  useEffect(
    () => () => {
      void window.workbench.browser.closeBatchWorkspace();
    },
    []
  );

  const ensureEmbeddedWorkspace = async (
    ids: string[] = accounts.map((account) => account.id)
  ): Promise<void> => {
    if (batchLoginMode === 'embedded')
      unwrap(await window.workbench.browser.openBatchWorkspace(ids));
  };

  const waitForExternalLogin = async (account: Account): Promise<boolean> => {
    const deadline = Date.now() + 15 * 60 * 1000;
    let lastMessage = '';
    while (Date.now() < deadline) {
      const state = unwrap(await window.workbench.browser.externalLoginState(account.id));
      if (state.loggedIn) return true;
      if (state.message !== lastMessage) {
        lastMessage = state.message;
        patch(account.id, { status: `${state.message} · 完成后将自动同步` });
      }
      if (!state.running) return false;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    patch(account.id, { status: '外部登录等待超时，可手动同步或重试' });
    return false;
  };

  const closeEmbeddedWorkspace = async (): Promise<void> => {
    try {
      unwrap(await window.workbench.browser.closeBatchWorkspace());
      onStatus('已关闭内置批量登录窗口，账号页面已还原到主工作台');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const parseCredentials = (raw: string): Credential[] => {
    const seen = new Set<string>();
    const result: Credential[] = [];
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const parts = line.includes('----')
        ? line.split('----')
        : line.includes('|')
        ? line.split('|')
        : line.includes(',')
        ? line.split(',')
        : line.includes('\t')
        ? line.split('\t')
        : line.split(/\s+/);
      const email = String(parts[0] ?? '').trim();
      const password = String(parts[1] ?? '').trim();
      const note = parts.slice(2).join(' ').trim();
      if (!email || !password || !/@/.test(email) || seen.has(email.toLowerCase())) continue;
      seen.add(email.toLowerCase());
      result.push({
        email,
        password,
        note,
        name: `Higgsfield_${email.split('@')[0]!.replace(/[^\w.-]+/g, '_').slice(0, 60)}`
      });
    }
    return result;
  };

  const createBatchAccounts = async (): Promise<void> => {
    const credentials = parseCredentials(batchText);
    if (!credentials.length)
      return onStatus('没有识别到账号，请按“邮箱----密码”一行一个填写');
    if (credentials.length > MAX_STANDARD_ACCOUNT_CREATION)
      return onStatus(
        `一次最多创建 ${MAX_STANDARD_ACCOUNT_CREATION} 个 Higgsfield 账号，请分批处理`
      );
    if (
      credentials.length > MAX_EMBEDDED_BATCH_WORKSPACE_ACCOUNTS &&
      !confirm(
        `本次将创建 ${credentials.length} 个 Higgsfield 账号，内置登录会按每批 ${MAX_EMBEDDED_BATCH_WORKSPACE_ACCOUNTS} 个分批处理，继续吗？`
      )
    )
      return;
    if (
      !confirm(
        `将创建 ${credentials.length} 个 Higgsfield 账号，并把凭据仅保存在本窗口内存中，继续吗？`
      )
    )
      return;
    setCreateBusy(true);
    let created = 0;
    const credentialRows: Record<string, Row> = {};
    try {
      for (const credential of credentials) {
        try {
          const account = unwrap(
            await window.workbench.accounts.create({
              ...emptyInput,
              platform,
              name: credential.name,
              group: batchGroup.trim(),
              remark: credential.note || credential.email
            })
          );
          credentialRows[account.id] = {
            email: credential.email,
            password: credential.password,
            status: '已创建，等待登录',
            busy: false
          };
          created += 1;
        } catch (error) {
          onStatus(
            `${credential.email} 创建失败：${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
      setRows((current) => ({ ...current, ...credentialRows }));
      await onAccountsChanged();
      setBatchText('');
      onStatus(`已创建 ${created}/${credentials.length} 个 Higgsfield 账号`);
    } finally {
      setCreateBusy(false);
    }
  };

  const calibrate = async (account: Account): Promise<void> => {
    try {
      patch(account.id, { busy: true, status: '正在识别登录入口…' });
      const step =
        batchLoginMode === 'embedded'
          ? (await ensureEmbeddedWorkspace([account.id]),
            unwrap(await window.workbench.browser.open(account.id)),
            await new Promise((resolve) => setTimeout(resolve, 1200)),
            unwrap(await window.workbench.browser.batchLoginCalibrateEmbedded(account.id, platform)))
          : (unwrap(await window.workbench.browser.externalLoginStart(account.id)),
            await new Promise((resolve) => setTimeout(resolve, 1200)),
            unwrap(await window.workbench.browser.batchLoginCalibrate(account.id, platform)));
      patch(account.id, { status: step.message });
    } catch (error) {
      patch(account.id, { status: error instanceof Error ? error.message : String(error) });
    } finally {
      patch(account.id, { busy: false });
    }
  };

  const run = async (
    account: Account,
    externalLayout?: ExternalBrowserLayout,
    ensureWorkspace = true
  ): Promise<void> => {
    const row = rows[account.id]!;
    if (!row.email || !row.password) return patch(account.id, { status: '请填写邮箱和密码' });
    patch(account.id, {
      busy: true,
      status: batchLoginMode === 'embedded' ? '打开内置页面…' : '启动外部浏览器…'
    });
    try {
      if (batchLoginMode === 'embedded') {
        if (ensureWorkspace) await ensureEmbeddedWorkspace([account.id]);
        unwrap(await window.workbench.browser.open(account.id));
      } else unwrap(await window.workbench.browser.externalLoginStart(account.id, externalLayout));
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const step =
          batchLoginMode === 'embedded'
            ? unwrap(
                await window.workbench.browser.batchLoginFillEmbedded(
                  account.id,
                  row.email,
                  row.password,
                  platform
                )
              )
            : unwrap(
                await window.workbench.browser.batchLoginFill(
                  account.id,
                  row.email,
                  row.password,
                  platform
                )
              );
        patch(account.id, { status: step.message });
        if (step.manual) {
          if (batchLoginMode === 'external') {
            const ready = await waitForExternalLogin(account);
            if (ready) {
              const synced = unwrap(
                await window.workbench.browser.externalLoginSync(account.id)
              );
              await window.workbench.browser.externalLoginClose(account.id);
              patch(account.id, { status: `完成 · ${synced.cookies} Cookies` });
              return;
            }
          }
          break;
        }
        if (step.readyToSync) {
          if (batchLoginMode === 'external') {
            const synced = unwrap(
              await window.workbench.browser.externalLoginSync(account.id)
            );
            await window.workbench.browser.externalLoginClose(account.id);
            patch(account.id, { status: `完成 · ${synced.cookies} Cookies` });
          } else patch(account.id, { status: '内置页面已显示登录态' });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    } catch (error) {
      patch(account.id, { status: error instanceof Error ? error.message : String(error) });
    } finally {
      patch(account.id, { busy: false });
    }
  };

  const runAll = async (): Promise<void> => {
    if (!accounts.length) return onStatus('当前没有 Higgsfield 账号');
    setBatchLoginBusy(true);
    try {
      const concurrency = batchLoginMode === 'external' ? 10 : 4;
      if (batchLoginMode === 'embedded') {
        const batches = splitIntoBatches(accounts, MAX_EMBEDDED_BATCH_WORKSPACE_ACCOUNTS);
        for (const [batchIndex, batch] of batches.entries()) {
          await ensureEmbeddedWorkspace(batch.map((account) => account.id));
          await runWithConcurrency(batch, concurrency, async (account, index) => {
            if (index > 0)
              await new Promise((resolve) => setTimeout(resolve, Math.min(index * 800, 8000)));
            await run(account, undefined, false);
          });
          if (batchIndex < batches.length - 1)
            await window.workbench.browser.closeBatchWorkspace();
        }
      } else {
        await runWithConcurrency(accounts, concurrency, async (account, index) => {
          await run(account, externalBrowserGridLayout(index, accounts.length), false);
        });
      }
      onStatus(
        `Higgsfield ${
          batchLoginMode === 'embedded' ? '内置' : '外部'
        }批量填入流程已执行（${
          batchLoginMode === 'embedded' ? '每批最多 20 个、' : ''
        }最多 ${concurrency} 个并发）；遇到验证码或 2FA 的账号请人工完成`
      );
    } finally {
      setBatchLoginBusy(false);
    }
  };

  const syncAll = async (): Promise<void> => {
    if (batchLoginMode === 'embedded')
      return onStatus(
        '内置 WebContentsView 模式会直接使用当前账号 Session，无需同步外部浏览器'
      );
    setBatchLoginBusy(true);
    let synced = 0;
    try {
      for (const account of accounts) {
        try {
          const state = unwrap(
            await window.workbench.browser.externalLoginStatus(account.id)
          );
          if (!state.running) continue;
          const value = unwrap(await window.workbench.browser.externalLoginSync(account.id));
          await window.workbench.browser.externalLoginClose(account.id);
          patch(account.id, { status: `已同步 · ${value.cookies} Cookies` });
          synced += 1;
        } catch (error) {
          patch(account.id, {
            status: `同步失败：${error instanceof Error ? error.message : String(error)}`
          });
        }
      }
      onStatus(`已同步 ${synced} 个 Higgsfield 外部登录窗口`);
    } finally {
      setBatchLoginBusy(false);
    }
  };

  return (
    <div className="dola-batch">
      <p>
        Higgsfield 批量登录复用账号独立 Session；内置模式不启动系统
        Chrome。凭据只在当前窗口内存中使用，验证码、两步验证和通行密钥需要人工完成。
      </p>
      <div className="dola-create-box">
        <div className="section-heading">
          <strong>批量创建 Higgsfield 账号</strong>
          <small>兼容“邮箱----密码”等格式；密码不写入账号配置。</small>
        </div>
        <textarea
          value={batchText}
          onChange={(event) => setBatchText(event.target.value)}
          rows={4}
          placeholder={'email1@example.com----password1\nemail2@example.com----password2'}
        />
        <div className="form-grid">
          <label>
            默认分组
            <input
              value={batchGroup}
              onChange={(event) => setBatchGroup(event.target.value)}
            />
          </label>
          <label>
            安全提示
            <span className="inline-status">
              最多 100 个；内置登录超过 20 个时分批处理；验证码/2FA 需人工完成
            </span>
          </label>
        </div>
        <button
          type="button"
          className="primary"
          disabled={createBusy || !batchText.trim()}
          onClick={() => void createBatchAccounts()}
        >
          {createBusy ? '正在创建…' : '创建并加入登录列表'}
        </button>
      </div>
      <div className="dola-login-mode">
        <div className="section-heading">
          <strong>批量登录方式</strong>
          <small>
            {batchLoginMode === 'embedded'
              ? '使用应用内每个账号自己的 WebContentsView；Google 弹窗也在 Electron 子窗口中打开。'
              : '使用系统 Chrome/Edge 独立辅助窗口，完成后可把 Cookie 同步回账号 Session。'}
          </small>
        </div>
        <label>
          方式
          <select
            disabled={batchLoginBusy}
            value={batchLoginMode}
            onChange={(event) =>
              setBatchLoginMode(event.target.value as 'embedded' | 'external')
            }
          >
            <option value="embedded">内置 WebContentsView（推荐）</option>
            <option value="external">系统 Chrome / Edge</option>
          </select>
        </label>
      </div>
      <div className="dola-calibration-box">
        <div className="section-heading">
          <strong>登录入口检查</strong>
          <small>按当前页面 DOM 识别可见登录控件，不调用私有登录接口。</small>
        </div>
        <p className="form-hint">
          Higgsfield 不复用 Dola 的固定点位；如果页面改版导致 DOM 无法识别，请在页面中手动点击入口后继续。
        </p>
      </div>
      <div className="dola-table">
        {accounts.map((account) => (
          <div className="dola-row" key={account.id}>
            <strong>{account.name}</strong>
            <input
              type="email"
              placeholder="Google 邮箱"
              value={rows[account.id]?.email ?? ''}
              onChange={(event) => patch(account.id, { email: event.target.value })}
            />
            <input
              type="password"
              placeholder="密码"
              value={rows[account.id]?.password ?? ''}
              onChange={(event) => patch(account.id, { password: event.target.value })}
            />
            <span>{rows[account.id]?.status}</span>
            <div className="dola-row-actions">
              <button
                type="button"
                disabled={rows[account.id]?.busy || batchLoginBusy}
                onClick={() => void calibrate(account)}
              >
                校准入口
              </button>
              <button
                type="button"
                disabled={rows[account.id]?.busy || batchLoginBusy}
                onClick={() => void run(account)}
              >
                开始/继续登录
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="account-tools dola-batch-actions">
        <button
          type="button"
          className="primary"
          disabled={batchLoginBusy}
          onClick={() => void runAll()}
        >
          {batchLoginMode === 'embedded'
            ? '并行填入内置页面（最多4）'
            : '并行自动填入（最多10）'}
        </button>
        <button
          type="button"
          disabled={batchLoginBusy || batchLoginMode === 'embedded'}
          onClick={() => void syncAll()}
        >
          同步全部外部窗口
        </button>
        {batchLoginMode === 'embedded' && (
          <button
            type="button"
            disabled={batchLoginBusy}
            onClick={() => void closeEmbeddedWorkspace()}
          >
            关闭内置窗口
          </button>
        )}
      </div>
    </div>
  );
}
