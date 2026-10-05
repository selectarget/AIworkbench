import React, { useEffect, useState } from 'react';
import {
  browserProfileSchema,
  fingerprintSchema,
  proxySchema,
  type Account,
  type AccountInput,
  type AppSettings,
  type DolaAspectRatio,
  type DolaClickProfile,
  type DolaClickTarget,
  type DolaLoginStep,
  type DolaReferenceKind,
  type ExternalBrowserLayout,
  type ProxyConfig
} from '@shared/contracts';
import { unwrap } from '../../../utils/formatters';
import {
  externalBrowserGridLayout,
  parseDolaAspectRatio,
  runWithConcurrency,
  splitIntoBatches
} from '../../../utils/rendererState';

const emptyProxy: ProxyConfig = proxySchema.parse({});
const emptyInput: AccountInput = {
  name: '',
  platform: 'doubao',
  group: '',
  remark: '',
  customUrl: '',
  proxy: emptyProxy,
  browser: browserProfileSchema.parse({}),
  fingerprint: fingerprintSchema.parse({})
};
const defaultDolaClickProfile: DolaClickProfile = {
  login: { xRatio: 0.93, yRatio: 0.035 },
  google: { xRatio: 0.345, yRatio: 0.61 }
};
const MAX_STANDARD_ACCOUNT_CREATION = 100;
const MAX_EMBEDDED_BATCH_WORKSPACE_ACCOUNTS = 20;
const dolaAspectRatioOptions: ReadonlyArray<{ value: DolaAspectRatio; label: string }> = [
  { value: '1:1', label: '1:1 方形' },
  { value: '3:4', label: '3:4 竖幅' },
  { value: '4:3', label: '4:3 横幅' },
  { value: '9:16', label: '9:16 竖屏' },
  { value: '16:9', label: '16:9 横屏' },
  { value: '21:9', label: '21:9 超宽' }
];

export interface DolaBatchProps {
  accounts: Account[];
  initialAccountId?: string;
  dolaAspectRatio: AppSettings['dolaAspectRatio'];
  onSettingsChange: (patch: Partial<AppSettings>) => Promise<void>;
  onAccountsChanged: () => Promise<void>;
  onStatus: (value: string) => void;
}

export function DolaBatchModal({
  accounts,
  initialAccountId,
  dolaAspectRatio,
  onSettingsChange,
  onAccountsChanged,
  onStatus
}: DolaBatchProps): React.JSX.Element {
  type Row = { email: string; password: string; status: string; busy: boolean };
  type Credential = {
    email: string;
    password: string;
    backupEmail: string;
    note: string;
    name: string;
  };
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      accounts.map((account) => [account.id, { email: '', password: '', status: '等待', busy: false }])
    )
  );
  const [batchText, setBatchText] = useState('');
  const [batchGroup, setBatchGroup] = useState('Dola批量');
  const [createBusy, setCreateBusy] = useState(false);
  const preferredTaskAccountId =
    initialAccountId && accounts.some((account) => account.id === initialAccountId)
      ? initialAccountId
      : '';
  const [taskAccountMode, setTaskAccountMode] = useState<'all' | 'single'>(() =>
    preferredTaskAccountId ? 'single' : accounts.length > 1 ? 'all' : 'single'
  );
  const [taskAccountId, setTaskAccountId] = useState(
    preferredTaskAccountId || accounts[0]?.id || ''
  );
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<DolaAspectRatio>(
    () => parseDolaAspectRatio(localStorage.getItem('dola-video-ratio')) ?? dolaAspectRatio
  );
  const [duration, setDuration] = useState<15 | 30>(15);
  const [references, setReferences] = useState<string[]>([]);
  const [audioReferences, setAudioReferences] = useState<string[]>([]);
  const [videoReferences, setVideoReferences] = useState<string[]>([]);
  const [taskBusy, setTaskBusy] = useState(false);
  const [batchLoginBusy, setBatchLoginBusy] = useState(false);
  const [batchLoginMode, setBatchLoginMode] = useState<'embedded' | 'external'>('embedded');
  const [calibrationAccountId, setCalibrationAccountId] = useState(accounts[0]?.id ?? '');
  const [clickProfile, setClickProfile] = useState<DolaClickProfile>(defaultDolaClickProfile);
  const [calibrationBusy, setCalibrationBusy] = useState(false);

  const patch = (id: string, value: Partial<Row>): void =>
    setRows((current) => ({ ...current, [id]: { ...current[id]!, ...value } }));

  useEffect(() => {
    localStorage.setItem('dola-video-ratio', aspectRatio);
  }, [aspectRatio]);

  useEffect(() => {
    const saved = parseDolaAspectRatio(localStorage.getItem('dola-video-ratio'));
    if (saved) {
      if (saved !== dolaAspectRatio) void onSettingsChange({ dolaAspectRatio: saved });
      return;
    }
    if (dolaAspectRatio !== aspectRatio) setAspectRatio(dolaAspectRatio);
  }, []);

  const changeAspectRatio = (value: DolaAspectRatio): void => {
    setAspectRatio(value);
    void onSettingsChange({ dolaAspectRatio: value });
  };

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
    if (!accounts.length) {
      setTaskAccountId('');
      setTaskAccountMode('single');
      return;
    }
    if (!accounts.some((account) => account.id === taskAccountId))
      setTaskAccountId(accounts[0]!.id);
    if (accounts.length <= 1) setTaskAccountMode('single');
  }, [accounts, taskAccountId]);

  useEffect(() => {
    if (!accounts.some((account) => account.id === calibrationAccountId))
      setCalibrationAccountId(accounts[0]?.id ?? '');
  }, [accounts, calibrationAccountId]);

  useEffect(() => {
    void window.workbench.settings
      .get()
      .then(unwrap)
      .then((value) => setClickProfile(value.dolaClickProfile))
      .catch(() => undefined);
  }, []);

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

  const waitForExternalDolaLogin = async (account: Account): Promise<boolean> => {
    const deadline = Date.now() + 15 * 60 * 1000;
    let lastMessage = '';
    while (Date.now() < deadline) {
      const state = unwrap(await window.workbench.browser.externalDolaLoginState(account.id));
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

  const addReferences = (paths: string[]): void => {
    setReferences((current) => [...new Set([...current, ...paths])].slice(0, 9));
  };

  const chooseReferences = async (): Promise<void> => {
    try {
      addReferences(unwrap(await window.workbench.files.chooseImages()));
      onStatus('已选择 Dola 参考图');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const dropReferences = (event: React.DragEvent<HTMLElement>): void => {
    event.preventDefault();
    const paths: string[] = [];
    for (const file of Array.from(event.dataTransfer.files)) {
      try {
        const path = window.workbench.files.getPathForFile(file);
        if (path) paths.push(path);
      } catch {
        /* Ignore browser-internal drops. */
      }
    }
    if (paths.length) {
      addReferences(paths);
      onStatus(`已添加 ${paths.length} 张参考图`);
    }
  };

  const addMediaReferences = (kind: DolaReferenceKind, paths: string[]): void => {
    const setter = kind === 'audio' ? setAudioReferences : setVideoReferences;
    setter((current) => [...new Set([...current, ...paths])].slice(0, 10));
  };

  const chooseMediaReferences = async (kind: DolaReferenceKind): Promise<void> => {
    try {
      const paths = unwrap(await window.workbench.files.chooseDolaReferences(kind));
      addMediaReferences(kind, paths);
      onStatus(`已选择 ${paths.length} 个参考${kind === 'audio' ? '音频' : '视频'}`);
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
      const backupEmail = note.split(/\s+/).find((item) => /@/.test(item)) ?? '';
      if (!email || !password || !/@/.test(email) || seen.has(email.toLowerCase())) continue;
      seen.add(email.toLowerCase());
      result.push({
        email,
        password,
        backupEmail,
        note,
        name: `Dola_${email.split('@')[0]!.replace(/[^\w.-]+/g, '_').slice(0, 60)}`
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
        `一次最多创建 ${MAX_STANDARD_ACCOUNT_CREATION} 个 Dola 账号，请分批处理`
      );
    if (
      credentials.length > MAX_EMBEDDED_BATCH_WORKSPACE_ACCOUNTS &&
      !confirm(
        `本次将创建 ${credentials.length} 个 Dola 账号，内置登录会按每批 ${MAX_EMBEDDED_BATCH_WORKSPACE_ACCOUNTS} 个分批处理，继续吗？`
      )
    )
      return;
    if (
      !confirm(
        `将创建 ${credentials.length} 个 Dola 账号，并把凭据仅保存在本窗口内存中，继续吗？`
      )
    )
      return;
    setCreateBusy(true);
    let created = 0;
    const credentialRows: Record<string, Row> = {};
    try {
      for (const credential of credentials) {
        try {
          const remark = credential.backupEmail
            ? `${credential.email} 备用邮箱:${credential.backupEmail}`
            : credential.note || credential.email;
          const account = unwrap(
            await window.workbench.accounts.create({
              ...emptyInput,
              platform: 'dola',
              name: credential.name,
              group: batchGroup.trim(),
              remark
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
      onStatus(`已创建 ${created}/${credentials.length} 个 Dola 账号`);
    } finally {
      setCreateBusy(false);
    }
  };

  const calibrate = async (account: Account): Promise<void> => {
    try {
      patch(account.id, { busy: true, status: '正在识别登录入口…' });
      let step: DolaLoginStep;
      if (batchLoginMode === 'embedded') {
        await ensureEmbeddedWorkspace([account.id]);
        unwrap(await window.workbench.browser.open(account.id));
        await new Promise((resolve) => setTimeout(resolve, 1200));
        step = unwrap(await window.workbench.browser.dolaCalibrateEmbedded(account.id));
      } else {
        unwrap(await window.workbench.browser.externalLoginStart(account.id));
        await new Promise((resolve) => setTimeout(resolve, 1200));
        step = unwrap(await window.workbench.browser.dolaCalibrate(account.id));
      }
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
      for (let attempt = 0; attempt < 40; attempt++) {
        const step =
          batchLoginMode === 'embedded'
            ? unwrap(
                await window.workbench.browser.dolaBatchFillEmbedded(
                  account.id,
                  row.email,
                  row.password
                )
              )
            : unwrap(
                await window.workbench.browser.dolaBatchFill(
                  account.id,
                  row.email,
                  row.password
                )
              );
        patch(account.id, { status: step.message });
        if (step.manual) {
          if (batchLoginMode === 'external') {
            const ready = await waitForExternalDolaLogin(account);
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
    if (!accounts.length) return onStatus('当前没有 Dola 账号');
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
        batchLoginMode === 'embedded'
          ? 'Dola 内置批量填入流程已执行（每批最多 20 个、最多 4 个并发）；遇到验证码或 2FA 的账号请人工完成'
          : 'Dola 批量自动填入流程已执行（最多 10 个外部浏览器并发）；遇到验证码或 2FA 的账号请人工完成后再同步'
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
      onStatus(`已同步 ${synced} 个 Dola 外部登录窗口`);
    } finally {
      setBatchLoginBusy(false);
    }
  };

  const copyCredential = async (account: Account, kind: 'email' | 'password'): Promise<void> => {
    const value = rows[account.id]?.[kind] ?? '';
    if (!value)
      return patch(account.id, { status: `请先填写${kind === 'email' ? '邮箱' : '密码'}` });
    try {
      unwrap(await window.workbench.files.copyText(value));
      patch(account.id, { status: `${kind === 'email' ? '邮箱' : '密码'}已复制到剪贴板` });
    } catch (error) {
      patch(account.id, { status: error instanceof Error ? error.message : String(error) });
    }
  };

  const syncExternalRow = async (account: Account): Promise<void> => {
    patch(account.id, { busy: true, status: '正在同步外部登录态…' });
    try {
      const state = unwrap(await window.workbench.browser.externalLoginStatus(account.id));
      if (!state.running) return patch(account.id, { status: '外部浏览器未运行' });
      const synced = unwrap(await window.workbench.browser.externalLoginSync(account.id));
      await window.workbench.browser.externalLoginClose(account.id);
      patch(account.id, { status: `已同步 · ${synced.cookies} Cookies` });
    } catch (error) {
      patch(account.id, { status: error instanceof Error ? error.message : String(error) });
    } finally {
      patch(account.id, { busy: false });
    }
  };

  const checkLoginState = async (account: Account): Promise<void> => {
    patch(account.id, { busy: true, status: '正在检查 Dola 登录态…' });
    try {
      const state = unwrap(await window.workbench.browser.dolaLoginState(account.id));
      patch(account.id, {
        status: `${state.message} · ${state.cookieCount} 个目标 Cookie`
      });
    } catch (error) {
      patch(account.id, { status: error instanceof Error ? error.message : String(error) });
    } finally {
      patch(account.id, { busy: false });
    }
  };

  const captureClickPoint = async (target: DolaClickTarget): Promise<void> => {
    const account =
      accounts.find((item) => item.id === calibrationAccountId) ?? accounts[0];
    if (!account) return onStatus('请先创建一个 Dola 账号');
    setCalibrationBusy(true);
    try {
      unwrap(await window.workbench.browser.open(account.id));
      unwrap(await window.workbench.browser.activate(account.id, null));
      onStatus(
        `请在“${account.name}”页面中点击${
          target === 'login' ? '登录入口' : 'Google 登录入口'
        }；按 Esc 可取消`
      );
      const point = unwrap(
        await window.workbench.browser.dolaCaptureClickPoint(account.id, target)
      );
      const saved = unwrap(await window.workbench.settings.get());
      setClickProfile(saved.dolaClickProfile);
      onStatus(
        `已保存${target === 'login' ? '登录' : 'Google'}点位（${Math.round(
          point.xRatio * 100
        )}%, ${Math.round(point.yRatio * 100)}%）`
      );
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCalibrationBusy(false);
    }
  };

  const testClickPoint = async (target: DolaClickTarget): Promise<void> => {
    const account =
      accounts.find((item) => item.id === calibrationAccountId) ?? accounts[0];
    if (!account) return onStatus('请先创建一个 Dola 账号');
    setCalibrationBusy(true);
    try {
      unwrap(await window.workbench.browser.open(account.id));
      unwrap(await window.workbench.browser.activate(account.id, null));
      const result = unwrap(
        await window.workbench.browser.dolaTestClickPoint(account.id, target)
      );
      onStatus(result.message);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCalibrationBusy(false);
    }
  };

  const resetClickProfile = async (): Promise<void> => {
    try {
      const saved = unwrap(
        await window.workbench.settings.update({
          dolaClickProfile: defaultDolaClickProfile
        })
      );
      setClickProfile(saved.dolaClickProfile);
      onStatus('Dola 登录点位已恢复默认');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const taskAccounts =
    taskAccountMode === 'all'
      ? accounts
      : accounts.filter((account) => account.id === taskAccountId);

  const submitTask = async (account: Account): Promise<boolean> => {
    if (!prompt.trim()) {
      patch(account.id, { status: '请先填写视频提示词' });
      return false;
    }
    patch(account.id, { busy: true, status: `正在准备 ${duration} 秒视频…` });
    try {
      unwrap(await window.workbench.browser.open(account.id));
      await new Promise((resolve) => setTimeout(resolve, 900));
      for (const [kind, paths] of [
        ['audio', audioReferences],
        ['video', videoReferences]
      ] as const) {
        if (!paths.length) continue;
        const uploaded = unwrap(
          await window.workbench.browser.dolaUploadReferences(
            account.id,
            kind,
            paths,
            aspectRatio,
            duration
          )
        );
        patch(account.id, { status: uploaded.message });
        if (!uploaded.ok) return false;
        if (!uploaded.readyForSubmit) {
          patch(account.id, { status: `${uploaded.message}；上传完成后再提交任务` });
          return false;
        }
        await new Promise((resolve) => setTimeout(resolve, 1300));
      }
      const result = unwrap(
        await window.workbench.browser.dolaSubmitVideo(
          account.id,
          prompt,
          aspectRatio,
          duration,
          references
        )
      );
      patch(account.id, { status: result.message });
      return result.ok;
    } catch (error) {
      patch(account.id, { status: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      patch(account.id, { busy: false });
    }
  };

  const submitAll = async (): Promise<void> => {
    if (!taskAccounts.length) return onStatus('请先选择一个 Dola 账号');
    if (!prompt.trim()) return onStatus('请先填写 Dola 视频提示词');
    setTaskBusy(true);
    try {
      let succeeded = 0;
      let failed = 0;
      for (const account of taskAccounts) {
        if (await submitTask(account)) succeeded += 1;
        else failed += 1;
      }
      onStatus(`Dola ${duration} 秒视频提交完成：成功 ${succeeded}，失败 ${failed}`);
    } finally {
      setTaskBusy(false);
    }
  };

  return (
    <div className="dola-batch">
      <p>
        凭据仅保存在当前窗口内存中；“校准入口”会按当前页面 DOM
        自动识别登录按钮。验证码、两步验证和通行密钥需要人工完成。
      </p>
      <div className="dola-create-box">
        <div className="section-heading">
          <strong>批量创建 Dola 账号</strong>
          <small>
            兼容旧版“邮箱----密码----备用邮箱”格式；创建后密码只用于本次登录辅助，不写入账号配置。
          </small>
        </div>
        <textarea
          value={batchText}
          onChange={(event) => setBatchText(event.target.value)}
          rows={4}
          placeholder={
            'email1@example.com----password1----backup@example.com\nemail2@example.com----password2'
          }
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
              ? '使用应用内每个账号自己的 WebContentsView，不会为每个账号启动系统 Chrome。Google 弹窗也在 Electron 子窗口中打开。'
              : '使用系统 Chrome/Edge 独立辅助窗口，适合站点要求外部浏览器或内置页面兼容性不足的情况。'}
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
          <strong>登录点位校准</strong>
          <small>
            旧版兼容的人工校准：先选择一个 Dola
            账号，在页面覆盖层中点击实际按钮位置；点位只保存为窗口比例，跨分辨率更稳定。
          </small>
        </div>
        <div className="dola-calibration-controls">
          <label>
            校准账号
            <select
              disabled={calibrationBusy || batchLoginBusy}
              value={calibrationAccountId}
              onChange={(event) => setCalibrationAccountId(event.target.value)}
            >
              {accounts.map((account) => (
                <option value={account.id} key={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <span className="dola-point-status">
            登录 {Math.round(clickProfile.login.xRatio * 100)}% /{' '}
            {Math.round(clickProfile.login.yRatio * 100)}% · Google{' '}
            {Math.round(clickProfile.google.xRatio * 100)}% /{' '}
            {Math.round(clickProfile.google.yRatio * 100)}%
          </span>
          <button
            type="button"
            disabled={calibrationBusy || batchLoginBusy || !accounts.length}
            onClick={() => void captureClickPoint('login')}
          >
            记录登录点
          </button>
          <button
            type="button"
            disabled={calibrationBusy || batchLoginBusy || !accounts.length}
            onClick={() => void testClickPoint('login')}
          >
            测试登录点
          </button>
          <button
            type="button"
            disabled={calibrationBusy || batchLoginBusy || !accounts.length}
            onClick={() => void captureClickPoint('google')}
          >
            记录 Google 点
          </button>
          <button
            type="button"
            disabled={calibrationBusy || batchLoginBusy || !accounts.length}
            onClick={() => void testClickPoint('google')}
          >
            测试 Google 点
          </button>
          <button
            type="button"
            disabled={calibrationBusy || batchLoginBusy}
            onClick={() => void resetClickProfile()}
          >
            恢复默认
          </button>
        </div>
        <p className="form-hint">
          建议顺序：记录登录点 → 测试登录点打开弹窗 → 记录 Google 点。Google
          点校准需要先出现 Google 登录子窗口。
        </p>
      </div>
      <div className="dola-task-box">
        <div className="section-heading">
          <strong>Dola 视频任务</strong>
          <small>
            只驱动当前已登录页面的正常 UI；平台未开放的时长或权限不会被强制绕过。Ctrl/⌘ + Enter
            快速提交
          </small>
        </div>
        <div className="dola-task-account">
          <div className="section-heading">
            <strong>任务账号</strong>
            <small>可选择单个账号，也可选择全部账号批量提交。</small>
          </div>
          <select
            aria-label="Dola 任务账号"
            value={taskAccountMode === 'all' ? '__all__' : taskAccountId}
            onChange={(event) => {
              const value = event.target.value;
              if (value === '__all__') setTaskAccountMode('all');
              else {
                setTaskAccountMode('single');
                setTaskAccountId(value);
              }
            }}
          >
            {accounts.length > 1 && (
              <option value="__all__">全部 Dola 账号（批量提交）</option>
            )}
            {accounts.map((account) => (
              <option value={account.id} key={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <span className="dola-task-account-count">已选 {taskAccounts.length} 个</span>
        </div>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              void submitAll();
            }
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={dropReferences}
          placeholder="输入视频生成提示词（也可把参考图拖到这里）"
          rows={4}
        />
        <div className="form-grid">
          <label>
            视频时长
            <select
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value) as 15 | 30)}
            >
              <option value={15}>15 秒</option>
              <option value={30}>30 秒</option>
            </select>
          </label>
          <label>
            画幅
            <select
              value={aspectRatio}
              onChange={(event) => {
                const next = parseDolaAspectRatio(event.target.value);
                if (next) changeAspectRatio(next);
              }}
            >
              {dolaAspectRatioOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div
          className="reference-picker"
          onDragOver={(event) => event.preventDefault()}
          onDrop={dropReferences}
        >
          <div className="account-tools">
            <button
              type="button"
              disabled={taskBusy}
              onClick={() => void chooseReferences()}
            >
              选择参考图
            </button>
            <button
              type="button"
              disabled={taskBusy || references.length === 0}
              onClick={() => setReferences([])}
            >
              清除
            </button>
            <span className="form-hint">
              可选，最多 9 张 JPG / PNG / WEBP · 也可拖入
            </span>
          </div>
          <div className="reference-list">
            {references.length ? (
              references.map((path) => (
                <span key={path} title={path}>
                  {path.split(/[\\/]/).pop()}
                </span>
              ))
            ) : (
              <span className="form-hint">未选择参考图</span>
            )}
          </div>
        </div>
        <div className="reference-picker media-reference-picker">
          <div className="account-tools">
            <button
              type="button"
              disabled={taskBusy}
              onClick={() => void chooseMediaReferences('audio')}
            >
              选择参考音频
            </button>
            <button
              type="button"
              disabled={taskBusy || audioReferences.length === 0}
              onClick={() => setAudioReferences([])}
            >
              清除
            </button>
            <span className="form-hint">
              MP3 / WAV，最多 10 个；提交时通过 Dola 官方上传管线处理
            </span>
          </div>
          <div className="reference-list">
            {audioReferences.length ? (
              audioReferences.map((path) => (
                <span key={path} title={path}>
                  {path.split(/[\\/]/).pop()}
                </span>
              ))
            ) : (
              <span className="form-hint">未选择参考音频</span>
            )}
          </div>
          <div className="account-tools">
            <button
              type="button"
              disabled={taskBusy}
              onClick={() => void chooseMediaReferences('video')}
            >
              选择参考视频
            </button>
            <button
              type="button"
              disabled={taskBusy || videoReferences.length === 0}
              onClick={() => setVideoReferences([])}
            >
              清除
            </button>
            <span className="form-hint">
              MP4 / MOV，最多 10 个；提交时通过 Dola 官方上传管线处理
            </span>
          </div>
          <div className="reference-list">
            {videoReferences.length ? (
              videoReferences.map((path) => (
                <span key={path} title={path}>
                  {path.split(/[\\/]/).pop()}
                </span>
              ))
            ) : (
              <span className="form-hint">未选择参考视频</span>
            )}
          </div>
        </div>
        <div className="account-tools">
          <button
            type="button"
            disabled={taskBusy || !prompt.trim() || !taskAccounts[0]}
            onClick={() => taskAccounts[0] && void submitTask(taskAccounts[0])}
          >
            提交选中账号
          </button>
          <button
            type="button"
            className="primary"
            disabled={taskBusy || !prompt.trim() || !taskAccounts.length}
            onClick={() => void submitAll()}
          >
            依次提交选中账号
          </button>
        </div>
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
                disabled={rows[account.id]?.busy || taskBusy || batchLoginBusy}
                onClick={() => void copyCredential(account, 'email')}
              >
                复制邮箱
              </button>
              <button
                type="button"
                disabled={rows[account.id]?.busy || taskBusy || batchLoginBusy}
                onClick={() => void copyCredential(account, 'password')}
              >
                复制密码
              </button>
              {batchLoginMode === 'external' && (
                <button
                  type="button"
                  disabled={rows[account.id]?.busy || taskBusy || batchLoginBusy}
                  onClick={() => void syncExternalRow(account)}
                >
                  同步
                </button>
              )}
              <button
                type="button"
                disabled={rows[account.id]?.busy || taskBusy || batchLoginBusy}
                onClick={() => void checkLoginState(account)}
              >
                检查登录态
              </button>
              <button
                type="button"
                disabled={rows[account.id]?.busy || taskBusy || batchLoginBusy}
                onClick={() => calibrate(account)}
              >
                校准入口
              </button>
              <button
                type="button"
                disabled={rows[account.id]?.busy || taskBusy || batchLoginBusy}
                onClick={() => run(account)}
              >
                开始/继续登录
              </button>
              <button
                type="button"
                disabled={rows[account.id]?.busy || taskBusy || batchLoginBusy || !prompt.trim()}
                onClick={() => void submitTask(account)}
              >
                提交视频
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="account-tools dola-batch-actions">
        <button
          type="button"
          className="primary"
          disabled={batchLoginBusy || taskBusy}
          onClick={() => void runAll()}
        >
          {batchLoginMode === 'embedded'
            ? '并行填入内置页面（最多4）'
            : '并行自动填入（最多10）'}
        </button>
        <button
          type="button"
          disabled={batchLoginBusy || taskBusy || batchLoginMode === 'embedded'}
          onClick={() => void syncAll()}
        >
          同步全部外部窗口
        </button>
        {batchLoginMode === 'embedded' && (
          <button
            type="button"
            disabled={batchLoginBusy || taskBusy}
            onClick={() => void closeEmbeddedWorkspace()}
          >
            关闭内置窗口
          </button>
        )}
      </div>
    </div>
  );
}
