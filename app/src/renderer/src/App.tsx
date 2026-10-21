import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  browserProfileSchema,
  fingerprintSchema,
  proxySchema,
  type Account,
  type AccountInput,
  type AccountVideoGeneratedNotice,
  type AppSettings,
  type DownloadTask,
  type MediaResource,
  type PlatformDefinition,
  type PlatformId,
  type ProxyConfig,
  type ProxyRuntimeState,
  type SessionDataKind
} from '../../shared/contracts';
import { mediaBelongsToPage } from '../../shared/media-scope';
import { unwrap } from './utils/formatters';
import { isWindowsPlatform } from './utils/dom';
import {
  accountViewNeedsReconfigure,
  connectionVisualState,
  mediaCandidateCount,
  mediaCandidates,
  mediaFormatToken,
  mediaPreviewKind,
  moveAccountIds,
  restoreOpenTabs,
  splitIntoBatches
} from './utils/rendererState';

// Re-export helpers for test suite compatibility
export {
  accountViewNeedsReconfigure,
  connectionVisualState,
  mediaCandidateCount,
  mediaCandidates,
  mediaFormatToken,
  mediaPreviewKind,
  moveAccountIds,
  restoreOpenTabs,
  splitIntoBatches
};

import { AppHeader } from './components/layout/AppHeader';
import { AccountsSidebar } from './components/layout/AccountsSidebar';
import { BrowserWorkspace } from './components/layout/BrowserWorkspace';
import { MediaPanel } from './MediaPanel';
import { useStableHandlers } from './utils/useStableHandlers';

import { Modal } from './components/ui/Modal';
import { ToastContainer, type ToastMessage } from './components/ui/Toast';

// Dialogs and tool panels are loaded when first shown, keeping them out of the
// startup bundle and the first Vite dev-server load.
const AccountModal = lazy(() => import('./components/features/accounts/AccountModal').then((m) => ({ default: m.AccountModal })));
const BulkProxyModal = lazy(() => import('./components/features/accounts/BulkProxyModal').then((m) => ({ default: m.BulkProxyModal })));
const SettingsPanel = lazy(() => import('./components/features/settings/SettingsPanel').then((m) => ({ default: m.SettingsPanel })));
const LibraryModal = lazy(() => import('./components/features/library/LibraryModal').then((m) => ({ default: m.LibraryModal })));
const LoginAssistModal = lazy(() => import('./components/features/tools/LoginAssistModal').then((m) => ({ default: m.LoginAssistModal })));
const DolaBatchModal = lazy(() => import('./components/features/tools/DolaBatchModal').then((m) => ({ default: m.DolaBatchModal })));
const HiggsfieldBatchModal = lazy(() => import('./components/features/tools/HiggsfieldBatchModal').then((m) => ({ default: m.HiggsfieldBatchModal })));
const FaceGridPanel = lazy(() => import('./components/features/tools/FaceGridPanel').then((m) => ({ default: m.FaceGridPanel })));
const MigrationPanel = lazy(() => import('./components/features/tools/MigrationPanel').then((m) => ({ default: m.MigrationPanel })));
const DiagnosticsPanel = lazy(() => import('./components/features/tools/DiagnosticsPanel').then((m) => ({ default: m.DiagnosticsPanel })));
const HelpPanel = lazy(() => import('./components/features/tools/HelpPanel').then((m) => ({ default: m.HelpPanel })));
const MediaPreviewModal = lazy(() => import('./components/features/media/MediaPreviewModal').then((m) => ({ default: m.MediaPreviewModal })));
const CandidateModal = lazy(() => import('./components/features/media/CandidateModal').then((m) => ({ default: m.CandidateModal })));

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
const MAX_STANDARD_ACCOUNT_CREATION = 100;

// The three main panels re-render only when their data props change; their
// callbacks come from useStableHandlers. Download progress therefore updates
// the media panel without re-rendering the account list and tab bar.
const MemoAccountsSidebar = memo(AccountsSidebar);
const MemoBrowserWorkspace = memo(BrowserWorkspace);
const MemoMediaPanel = memo(MediaPanel);

export function App(): React.JSX.Element {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [platforms, setPlatforms] = useState<PlatformDefinition[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [resources, setResources] = useState<MediaResource[]>([]);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sleepingTabs, setSleepingTabs] = useState<string[]>([]);
  const sleepingTabsRef = useRef(sleepingTabs);
  sleepingTabsRef.current = sleepingTabs;
  const [secondaryId, setSecondaryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState<PlatformId | ''>('');
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [accountToolsCollapsed, setAccountToolsCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('accountToolsCollapsed') !== '0';
    } catch {
      return true;
    }
  });
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<string[]>([]);
  const [, setVideoNotices] = useState<AccountVideoGeneratedNotice[]>([]);
  const [videoNoticeByAccount, setVideoNoticeByAccount] = useState<Record<string, number>>({});
  const [previewResource, setPreviewResource] = useState<MediaResource | null>(null);
  const [candidateResource, setCandidateResource] = useState<MediaResource | null>(null);
  const [convertedPreviewUrl, setConvertedPreviewUrl] = useState<string | null>(null);
  const [conversionBusy, setConversionBusy] = useState(false);
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [modal, setModal] = useState<
    | 'account'
    | 'bulkProxy'
    | 'settings'
    | 'library'
    | 'login'
    | 'dola'
    | 'higgsfield'
    | 'migration'
    | 'faceGrid'
    | 'diagnostics'
    | 'help'
    | null
  >(null);
  const [form, setForm] = useState<AccountInput>(emptyInput);
  const [bulkProxy, setBulkProxy] = useState<ProxyConfig>({ ...emptyProxy });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newAccountCount, setNewAccountCount] = useState(1);
  const [startAfterCreate, setStartAfterCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, _setStatus] = useState('就绪');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const setStatus = useCallback((message: string | ((prev: string) => string)) => {
    _setStatus((prev) => {
      const next = typeof message === 'function' ? message(prev) : message;
      if (next && next !== '就绪' && next !== '等待中' && next !== prev) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setToasts((t) => [...t.slice(-2), { id, message: next }]);
        setTimeout(() => {
          setToasts((t) => t.filter((item) => item.id !== id));
        }, 3000);
      }
      return next;
    });
  }, []);

  const [runtimeState, setRuntimeState] = useState<ProxyRuntimeState | null>(null);
  const [address, setAddress] = useState('');
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [tabOverviewOpen, setTabOverviewOpen] = useState(false);

  const primaryRef = useRef<HTMLDivElement>(null);
  const secondaryRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const activeIdRef = useRef<string | null>(null);

  const report = useCallback(
    (error: unknown): void => setStatus(error instanceof Error ? error.message : String(error)),
    []
  );

  const persistTabs = useCallback(
    async (tabs: string[], active: string | null, secondary: string | null, dual: boolean) => {
      const result = await window.workbench.settings.update({
        openTabs: tabs,
        activeTabId: active,
        secondaryTabId: secondary,
        dualView: dual
      });
      if (result.ok) setSettings(result.data);
    },
    []
  );

  useEffect(() => {
    void Promise.all([
      window.workbench.accounts.list(),
      window.workbench.platforms(),
      window.workbench.settings.get(),
      window.workbench.media.list(),
      window.workbench.media.tasks()
    ])
      .then(async ([a, p, s, m, t]) => {
        const accountRows = unwrap(a);
        const config = unwrap(s);
        setAccounts(accountRows);
        setPlatforms(unwrap(p));
        setSettings(config);
        setResources(unwrap(m));
        setTasks(unwrap(t));
        // Start with no account sessions. Each site page, proxy runtime and
        // extension set is created only when the user opens that account, so
        // the workbench is usable immediately after launch.
        setOpenTabs([]);
        setActiveId(null);
        setSecondaryId(null);
        await window.workbench.browser.activate(null, null);
        if (config.openTabs.length || config.activeTabId || config.secondaryTabId)
          await persistTabs([], null, null, config.dualView);
      })
      .catch(report);

    const offMedia = window.workbench.media.onUpdated((next) => {
      setResources(next);
      if (!next.length) setVideoNoticeByAccount({});
    });
    const offTasks = window.workbench.media.onTasks(setTasks);
    const offFileDownloaded = window.workbench.files.onDownloaded((notice) =>
      setStatus(`文件下载完成：${notice.filename}`)
    );
    const offVideoGenerated = window.workbench.media.onVideoGenerated((notice) => {
      setVideoNotices((current) => [
        ...current.filter((item) => `${item.accountId}:${item.key}` !== `${notice.accountId}:${notice.key}`),
        notice
      ].slice(-4));
      setVideoNoticeByAccount((current) => ({
        ...current,
        [notice.accountId]: Math.min(99, (current[notice.accountId] ?? 0) + 1)
      }));
      setStatus(`${notice.accountId} 有新视频生成`);
      window.setTimeout(
        () =>
          setVideoNotices((current) =>
            current.filter((item) => `${item.accountId}:${item.key}` !== `${notice.accountId}:${notice.key}`)
          ),
        9000
      );
    });
    const offProxy = window.workbench.proxy.onState((state) => {
      if (state.accountId === activeIdRef.current || !activeIdRef.current) setRuntimeState(state);
    });
    const offSlept = window.workbench.browser.onSlept(({ accountId }) => {
      setSleepingTabs((current) => (current.includes(accountId) ? current : [...current, accountId]));
    });
    const offNavigation = window.workbench.browser.onNavigation((state) => {
      setAccounts((current) =>
        current.map((account) =>
          account.id === state.accountId
            ? { ...account, browser: { ...account.browser, lastUrl: state.url } }
            : account
        )
      );
      if (state.accountId === activeIdRef.current) setAddress(state.url);
    });

    return () => {
      offMedia();
      offTasks();
      offFileDownloaded();
      offVideoGenerated();
      offProxy();
      offSlept();
      offNavigation();
    };
  }, [report, persistTabs]);

  useEffect(() => {
    document.documentElement.dataset.theme = 'light';
  }, []);

  useEffect(() => {
    const activeEl = document.querySelector('.tab.active');
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }, [activeId, openTabs.length]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    setSleepingTabs((current) => {
      const next = current.filter((id) => openTabs.includes(id));
      return next.length === current.length ? current : next;
    });
  }, [openTabs]);

  useEffect(() => {
    const account = accounts.find((item) => item.id === activeId);
    setAddress(account?.browser.lastUrl || account?.browser.homeUrl || '');
  }, [activeId, accounts]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (tabMenu) setTabMenu(null);
        else if (tabOverviewOpen) setTabOverviewOpen(false);
        else if (candidateResource) setCandidateResource(null);
        else if (previewResource) {
          setPreviewResource(null);
          setConvertedPreviewUrl(null);
        } else if (modal) setModal(null);
        else return;
        event.preventDefault();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }
      if ((event.shiftKey || event.altKey) && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        if (settings) {
          void window.workbench.settings
            .update({ resourcesCollapsed: !settings.resourcesCollapsed })
            .then(unwrap)
            .then(setSettings);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [candidateResource, modal, previewResource, tabMenu, tabOverviewOpen, settings]);

  useEffect(() => {
    if (!tabOverviewOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Element && !target.closest('.tab-overview-anchor'))
        setTabOverviewOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [tabOverviewOpen]);

  useEffect(() => {
    if (!tabMenu) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Element && !target.closest('.tab-context-menu')) setTabMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [tabMenu]);

  useEffect(() => {
    let disposed = false;
    if (!activeId) {
      setRuntimeState(null);
      return () => {
        disposed = true;
      };
    }
    setRuntimeState(null);
    void window.workbench.proxy
      .runtimeStatus(activeId)
      .then((result) => {
        if (!disposed && result.ok) setRuntimeState(result.data);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [activeId]);

  const previewId = previewResource?.id;
  useEffect(() => {
    if (!previewId) return;
    const current = resources.find((resource) => resource.id === previewId);
    if (current) setPreviewResource(current);
    else {
      setPreviewResource(null);
      setConvertedPreviewUrl(null);
    }
  }, [previewId, resources]);

  const candidateId = candidateResource?.id;
  useEffect(() => {
    if (!candidateId) return;
    const current = resources.find((resource) => resource.id === candidateId);
    if (current) setCandidateResource(current);
    else setCandidateResource(null);
  }, [candidateId, resources]);

  const browserOccluded = Boolean(
    modal || previewResource || candidateResource || tabOverviewOpen || tabMenu
  );

  useEffect(() => {
    const send = (): void => {
      const primary = primaryRef.current?.getBoundingClientRect();
      if (!primary) return;
      const secondary = settings?.dualView
        ? secondaryRef.current?.getBoundingClientRect()
        : undefined;
      void window.workbench.browser.setLayout({
        occluded: browserOccluded,
        primary: { x: primary.x, y: primary.y, width: primary.width, height: primary.height },
        secondary: secondary
          ? { x: secondary.x, y: secondary.y, width: secondary.width, height: secondary.height }
          : undefined
      });
    };
    const observer = new ResizeObserver(send);
    if (primaryRef.current) observer.observe(primaryRef.current);
    if (secondaryRef.current) observer.observe(secondaryRef.current);
    const workspace = workspaceRef.current;
    workspace?.addEventListener('scroll', send, { passive: true });
    window.addEventListener('resize', send);
    send();
    return () => {
      observer.disconnect();
      workspace?.removeEventListener('scroll', send);
      window.removeEventListener('resize', send);
    };
  }, [settings?.dualView, activeId, secondaryId, browserOccluded]);

  const groups = useMemo(
    () =>
      [...new Set(accounts.map((account) => account.group).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'zh-CN')
      ),
    [accounts]
  );

  const filteredAccounts = useMemo(
    () =>
      accounts.filter(
        (account) =>
          (!groupFilter || account.group === groupFilter) &&
          (!platformFilter || account.platform === platformFilter) &&
          `${account.name} ${account.group} ${account.remark}`
            .toLowerCase()
            .includes(search.toLowerCase())
      ),
    [accounts, search, groupFilter, platformFilter]
  );

  const groupedAccounts = useMemo(
    () =>
      [...new Set(filteredAccounts.map((account) => account.group || '未分组'))].map((name) => ({
        name,
        accounts: filteredAccounts.filter((account) => (account.group || '未分组') === name)
      })),
    [filteredAccounts]
  );

  const accountName = useCallback(
    (id: string | null): string => accounts.find((account) => account.id === id)?.name ?? '未选择',
    [accounts]
  );
  const activeAccount = accounts.find((account) => account.id === activeId);

  async function openAccount(id: string): Promise<void> {
    try {
      setBusy(true);
      unwrap(await window.workbench.browser.open(id));
      setSleepingTabs((current) => current.filter((item) => item !== id));
      const tabs = openTabsRef.current.includes(id)
        ? openTabsRef.current
        : [...openTabsRef.current, id];
      openTabsRef.current = tabs;
      setOpenTabs(tabs);
      setActiveId(id);
      setVideoNoticeByAccount((current) => {
        if (!(id in current)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      });
      const account = accounts.find((item) => item.id === id);
      setAddress(account?.browser.lastUrl || account?.browser.homeUrl || '');
      await window.workbench.browser.activate(id, secondaryId);
      await persistTabs(tabs, id, secondaryId, settings?.dualView ?? false);
      setStatus(`已打开 ${accountName(id)}`);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function clearDoubaoHistory(): Promise<void> {
    if (!activeAccount || activeAccount.platform !== 'doubao')
      return setStatus('请先打开一个豆包账号');
    if (busy) return;
    const account = activeAccount;
    try {
      setBusy(true);
      setStatus(`正在核对 ${account.name} 的全部历史会话，删除前会显示数量供你确认`);
      const result = unwrap(await window.workbench.browser.clearDoubaoHistory(account.id));
      setStatus(result.message);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  function toggleAccountTools(): void {
    setAccountToolsCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem('accountToolsCollapsed', next ? '1' : '0');
      } catch {
        /* best effort */
      }
      return next;
    });
  }

  async function openExternalBrowser(account: Account): Promise<void> {
    try {
      setBusy(true);
      const result = unwrap(await window.workbench.browser.externalBrowserOpen(account.id));
      setStatus(`已在系统 Chrome/Edge 打开 ${account.name} · 同步 ${result.cookies} 个 Cookie`);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function closeTab(id: string): Promise<void> {
    unwrap(await window.workbench.browser.close(id));
    const tabs = openTabsRef.current.filter((item) => item !== id);
    const next = activeId === id ? tabs.at(-1) ?? null : activeId;
    const second = secondaryId === id ? null : secondaryId;
    openTabsRef.current = tabs;
    setOpenTabs(tabs);
    setActiveId(next);
    setSecondaryId(second);
    setTabMenu(null);
    await window.workbench.browser.activate(next, second);
    await persistTabs(tabs, next, second, settings?.dualView ?? false);
  }

  /** Reopens a tab whose page was released by the idle-sleep policy. */
  async function wakeTab(id: string): Promise<void> {
    if (!sleepingTabsRef.current.includes(id)) return;
    unwrap(await window.workbench.browser.open(id));
    setSleepingTabs((current) => current.filter((item) => item !== id));
  }

  async function selectTab(id: string): Promise<void> {
    setTabMenu(null);
    try {
      await wakeTab(id);
    } catch (error) {
      report(error);
      return;
    }
    setActiveId(id);
    setVideoNoticeByAccount((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (id === secondaryId) setSecondaryId(null);
    await window.workbench.browser.activate(id, id === secondaryId ? null : secondaryId);
    await persistTabs(
      openTabsRef.current,
      id,
      id === secondaryId ? null : secondaryId,
      settings?.dualView ?? false
    );
  }

  async function closeOtherTabs(id: string): Promise<void> {
    const others = openTabsRef.current.filter((item) => item !== id);
    setTabMenu(null);
    if (!others.length) return setStatus('当前没有其他标签');
    try {
      setBusy(true);
      unwrap(await window.workbench.browser.closeMany(others));
      const tabs = [id];
      openTabsRef.current = tabs;
      setOpenTabs(tabs);
      setActiveId(id);
      setSecondaryId(null);
      await window.workbench.browser.activate(id, null);
      await persistTabs(tabs, id, null, settings?.dualView ?? false);
      setStatus(`已关闭 ${others.length} 个其他标签`);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  function reorderOpenTabs(
    draggedId: string,
    targetId: string,
    side: 'before' | 'after' = 'before'
  ): void {
    const tabs = moveAccountIds(openTabsRef.current, draggedId, targetId, side);
    if (tabs.join('|') === openTabsRef.current.join('|')) return;
    openTabsRef.current = tabs;
    setOpenTabs(tabs);
    setTabMenu(null);
    void persistTabs(tabs, activeId, secondaryId, settings?.dualView ?? false).catch(report);
  }

  function newAccount(): void {
    setEditingId(null);
    setNewAccountCount(1);
    setStartAfterCreate(false);
    setForm({
      ...emptyInput,
      proxy: { ...emptyProxy, subscriptionNodes: [] },
      browser: { ...emptyInput.browser },
      fingerprint: { ...emptyInput.fingerprint, languages: [...emptyInput.fingerprint.languages] }
    });
    setModal('account');
  }

  function editAccount(account: Account): void {
    setEditingId(account.id);
    setForm({
      name: account.name,
      platform: account.platform,
      group: account.group,
      remark: account.remark,
      customUrl: account.customUrl ?? '',
      proxy: {
        ...account.proxy,
        subscriptionNodes: account.proxy.subscriptionNodes.map((node) => ({ ...node }))
      },
      browser: { ...account.browser },
      fingerprint: {
        ...account.fingerprint,
        languages: [...account.fingerprint.languages]
      }
    });
    void window.workbench.proxy
      .runtimeStatus(account.id)
      .then((result) => result.ok && setRuntimeState(result.data));
    setModal('account');
  }

  async function saveAccount(): Promise<void> {
    try {
      setBusy(true);
      if (editingId) {
        const previous = accounts.find((account) => account.id === editingId);
        const proxyChanged = JSON.stringify(previous?.proxy) !== JSON.stringify(form.proxy);
        const viewNeedsReconfigure = accountViewNeedsReconfigure(previous, form);
        unwrap(await window.workbench.accounts.update(editingId, form));
        if (openTabs.includes(editingId)) {
          if (viewNeedsReconfigure) unwrap(await window.workbench.browser.reconfigure(editingId));
          else if (proxyChanged) unwrap(await window.workbench.browser.applyProxy(editingId));
        }
        setAccounts(unwrap(await window.workbench.accounts.list()));
        setStatus(viewNeedsReconfigure ? '账号已更新，已重载当前页面' : '账号已更新');
        setModal(null);
        return;
      }
      const count = Math.max(
        1,
        Math.min(MAX_STANDARD_ACCOUNT_CREATION, Math.trunc(Number(newAccountCount) || 1))
      );
      const platformName =
        platforms.find((item) => item.id === form.platform)?.name ?? form.platform;
      const baseName = form.name.trim() || `${platformName}账号`;
      const creatingSubscription =
        form.proxy.enabled &&
        form.proxy.mode === 'subscription' &&
        !form.proxy.subscriptionNodes.length;
      const created: Account[] = [];
      for (let index = 0; index < count; index += 1) {
        const name = count === 1 ? baseName : `${baseName} ${index + 1}`;
        const input = creatingSubscription
          ? { ...form, name, proxy: { ...form.proxy, enabled: false } }
          : { ...form, name };
        const saved = unwrap(await window.workbench.accounts.create(input));
        created.push(saved);
        if (creatingSubscription && form.proxy.subscriptionUrl) {
          setStatus(`正在为第 ${index + 1}/${count} 个账号导入订阅…`);
          unwrap(
            await window.workbench.proxy.importSubscription(
              saved.id,
              form.proxy.subscriptionUrl
            )
          );
        }
      }
      setAccounts(unwrap(await window.workbench.accounts.list()));
      if (startAfterCreate && created.length) {
        const opened = unwrap(
          await window.workbench.browser.openMany(created.map((account) => account.id))
        );
        const tabs = [...new Set([...openTabs, ...opened.succeeded])];
        const next = opened.succeeded[0] ?? activeId ?? tabs[0] ?? null;
        const nextSecondary =
          settings?.dualView &&
          secondaryId &&
          tabs.includes(secondaryId) &&
          secondaryId !== next
            ? secondaryId
            : null;
        setOpenTabs(tabs);
        setActiveId(next);
        setSecondaryId(nextSecondary);
        await window.workbench.browser.activate(next, nextSecondary);
        await persistTabs(tabs, next, nextSecondary, settings?.dualView ?? false);
        setStatus(
          `已添加 ${created.length} 个账号并打开 ${opened.succeeded.length} 个${
            opened.failed.length ? `，失败 ${opened.failed.length} 个` : ''
          }`
        );
      } else {
        setStatus(
          created.length === 1
            ? `已添加账号 ${created[0]!.name}`
            : `已添加 ${created.length} 个账号`
        );
      }
      setModal(null);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount(account: Account): Promise<void> {
    if (
      !confirm(
        `确定删除“${account.name}”？该账号的登录会话、缓存和本地存储也会一并清理，且不可恢复。`
      )
    )
      return;
    unwrap(await window.workbench.accounts.remove(account.id));
    const nextAccounts = unwrap(await window.workbench.accounts.list());
    const tabs = openTabs.filter((id) => id !== account.id);
    const nextActive = activeId === account.id ? tabs.at(-1) ?? null : activeId;
    const nextSecondary = secondaryId === account.id ? null : secondaryId;
    setAccounts(nextAccounts);
    setOpenTabs(tabs);
    setActiveId(nextActive);
    setSecondaryId(nextSecondary);
    setVideoNoticeByAccount((current) => {
      if (!(account.id in current)) return current;
      const next = { ...current };
      delete next[account.id];
      return next;
    });
    await window.workbench.browser.activate(nextActive, nextSecondary);
    await persistTabs(tabs, nextActive, nextSecondary, settings?.dualView ?? false);
  }

  async function download(resource: MediaResource): Promise<void> {
    if (!resource.url) {
      const account = accounts.find((item) => item.id === resource.accountId);
      if (account?.platform !== 'dola')
        return setStatus('该素材没有可用的 Dola 作品定位信息');
      try {
        unwrap(
          await window.workbench.browser.resolveDolaResource(
            resource.accountId,
            {
              url: resource.url || undefined,
              messageId: resource.messageId,
              conversationId: resource.conversationId,
              shareId: resource.shareId,
              shareUrl: resource.shareUrl,
              threadUrl: resource.threadUrl,
              vid: resource.vid,
              keySeed: resource.keySeed,
              fplayUrl: resource.fplayUrl,
              dolaRecordKey: resource.dolaRecordKey,
              dolaCardId: resource.dolaCardId,
              dolaVideoElementId: resource.dolaVideoElementId,
              title: resource.title
            },
            true
          )
        );
        setStatus('已请求 Dola 页面解析并下载原始资源');
      } catch (error) {
        report(error);
      }
      return;
    }
    try {
      const task = unwrap(await window.workbench.media.download(resource.id));
      setStatus(`已加入下载队列：${task.title}`);
    } catch (error) {
      report(error);
    }
  }

  async function openResourceUrl(resource: MediaResource): Promise<void> {
    if (!/^https?:\/\//i.test(resource.url))
      return setStatus('当前素材不是可在系统浏览器打开的 HTTP/HTTPS 地址');
    try {
      unwrap(await window.workbench.files.openUrl(resource.url));
      setStatus('已在系统浏览器打开素材链接');
    } catch (error) {
      report(error);
    }
  }

  async function copyCandidateUrl(url: string): Promise<void> {
    try {
      unwrap(await window.workbench.files.copyText(url));
      setStatus('候选地址已复制');
    } catch (error) {
      report(error);
    }
  }

  async function openCandidateUrl(url: string): Promise<void> {
    if (!/^https?:\/\//i.test(url))
      return setStatus('只有 HTTP/HTTPS 候选地址可以在系统浏览器打开');
    try {
      unwrap(await window.workbench.files.openUrl(url));
      setStatus('已在系统浏览器打开候选地址');
    } catch (error) {
      report(error);
    }
  }

  async function selectMediaCandidate(resource: MediaResource, url: string): Promise<void> {
    try {
      const updated = unwrap(await window.workbench.media.selectCandidate(resource.id, url));
      setResources((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
      setCandidateResource(updated);
      if (previewResource?.id === updated.id) {
        setPreviewResource(updated);
        setConvertedPreviewUrl(null);
      }
      setStatus('已将该候选地址设为首选，下载会按新顺序尝试');
    } catch (error) {
      report(error);
    }
  }

  async function downloadManyResources(items: MediaResource[], label: string): Promise<void> {
    if (!items.length) return setStatus(`当前没有可下载的${label}`);
    const downloadable = items.filter((item) => Boolean(item.url));
    if (!downloadable.length)
      return setStatus(`当前${label}都还没有可下载地址，请先解析原始资源`);
    try {
      const tasksResult = unwrap(
        await window.workbench.media.downloadMany(downloadable.map((item) => item.id))
      );
      const skipped = items.length - downloadable.length;
      setStatus(
        `已加入 ${tasksResult.length} 个${label}下载任务${
          skipped ? `，跳过 ${skipped} 个待解析素材` : ''
        }`
      );
    } catch (error) {
      report(error);
    }
  }

  function openPreview(resource: MediaResource): void {
    setPreviewResource(resource);
    setConvertedPreviewUrl(null);
    void prepareResourcePreview(resource);
  }

  async function prepareResourcePreview(resource: MediaResource): Promise<void> {
    try {
      const updated = unwrap(await window.workbench.media.preparePreview(resource.id));
      setPreviewResource((current) => (current?.id === updated.id ? updated : current));
    } catch (error) {
      report(error);
    }
  }

  async function refreshMediaResource(resource: MediaResource): Promise<void> {
    setStatus('正在重新解析素材地址…');
    try {
      unwrap(await window.workbench.media.refresh(resource.id));
      setStatus('素材地址已更新');
    } catch (error) {
      report(error);
    }
  }

  async function convertPreview(resource: MediaResource): Promise<void> {
    try {
      setConversionBusy(true);
      setStatus('正在准备兼容播放文件…');
      const result = unwrap(await window.workbench.media.convertForPreview(resource.id));
      setConvertedPreviewUrl(result.url);
      setStatus(result.cached ? '已切换到缓存的 MP4 预览' : 'MP4 预览转换完成');
    } catch (error) {
      report(error);
    } finally {
      setConversionBusy(false);
    }
  }

  async function batchAccounts(action: 'open' | 'refresh' | 'close'): Promise<void> {
    if (!selectedAccounts.length) return setStatus('请先选择账号');
    try {
      if (action === 'open') {
        const result = unwrap(await window.workbench.browser.openMany(selectedAccounts));
        const tabs = [...new Set([...openTabs, ...result.succeeded])];
        const next = activeId ?? tabs[0] ?? null;
        setOpenTabs(tabs);
        setActiveId(next);
        await window.workbench.browser.activate(next, secondaryId);
        await persistTabs(tabs, next, secondaryId, settings?.dualView ?? false);
        setStatus(
          `已打开 ${result.succeeded.length} 个账号${
            result.failed.length ? `，失败 ${result.failed.length} 个` : ''
          }`
        );
      } else if (action === 'refresh') {
        const opened = selectedAccounts.filter((id) => openTabs.includes(id));
        if (!opened.length) return setStatus('所选账号尚未打开');
        unwrap(await window.workbench.browser.refreshMany(opened));
        setStatus('已批量刷新');
      } else {
        unwrap(await window.workbench.browser.closeMany(selectedAccounts));
        const tabs = openTabs.filter((id) => !selectedAccounts.includes(id));
        setOpenTabs(tabs);
        setActiveId(tabs[0] ?? null);
        await window.workbench.browser.activate(tabs[0] ?? null, null);
        await persistTabs(tabs, tabs[0] ?? null, null, settings?.dualView ?? false);
      }
    } catch (error) {
      report(error);
    }
  }

  async function openFilteredAccounts(): Promise<void> {
    const ids = filteredAccounts.slice(0, 12).map((account) => account.id);
    if (!ids.length) return setStatus('当前筛选下没有账号可打开');
    try {
      setBusy(true);
      const result = unwrap(await window.workbench.browser.openMany(ids));
      const tabs = [...new Set([...openTabs, ...result.succeeded])];
      const next = activeId && tabs.includes(activeId) ? activeId : tabs[0] ?? null;
      const nextSecondary =
        settings?.dualView && secondaryId && tabs.includes(secondaryId) && secondaryId !== next
          ? secondaryId
          : null;
      setOpenTabs(tabs);
      setActiveId(next);
      setSecondaryId(nextSecondary);
      await window.workbench.browser.activate(next, nextSecondary);
      await persistTabs(tabs, next, nextSecondary, settings?.dualView ?? false);
      setStatus(
        `已打开 ${result.succeeded.length} 个筛选账号${
          result.failed.length ? `，失败 ${result.failed.length} 个` : ''
        }${filteredAccounts.length > ids.length ? '（最多 12 个）' : ''}`
      );
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function refreshOpenTabs(): Promise<void> {
    if (!openTabs.length) return setStatus('当前没有已打开的账号');
    try {
      setBusy(true);
      unwrap(await window.workbench.browser.refreshMany(openTabs));
      setStatus(`已刷新 ${openTabs.length} 个已打开页面`);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function closeAllOpenTabs(): Promise<void> {
    if (!openTabs.length) return setStatus('当前没有已打开的账号');
    if (!confirm(`确定关闭全部 ${openTabs.length} 个浏览器实例？账号数据不会删除。`)) return;
    try {
      setBusy(true);
      unwrap(await window.workbench.browser.closeMany(openTabs));
      setOpenTabs([]);
      setActiveId(null);
      setSecondaryId(null);
      await window.workbench.browser.activate(null, null);
      await persistTabs([], null, null, settings?.dualView ?? false);
      setStatus(`已关闭全部 ${openTabs.length} 个浏览器实例`);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function openDownloadDir(): Promise<void> {
    try {
      unwrap(await window.workbench.files.openDownloadDir());
      setStatus('已打开下载目录');
    } catch (error) {
      report(error);
    }
  }

  async function openVideoDownloadDir(): Promise<void> {
    try {
      unwrap(await window.workbench.files.openVideoDownloadDir());
      setStatus('已打开视频目录');
    } catch (error) {
      report(error);
    }
  }

  function clearMediaList(): void {
    if (!resources.length) return setStatus('素材列表已经为空');
    if (!confirm('确定清空当前素材流吗？下载队列不会受影响。')) return;
    void window.workbench.media.clear().then(() => {
      setResources([]);
      setSelectedMedia([]);
      setStatus('素材列表已清空');
    });
  }

  async function batchAssignGroup(): Promise<void> {
    if (!selectedAccounts.length) return setStatus('请先选择账号');
    const group = prompt('移动到分组（留空表示未分组）', groupFilter);
    if (group == null) return;
    setAccounts(unwrap(await window.workbench.accounts.bulkUpdate(selectedAccounts, { group })));
    setStatus(`已更新 ${selectedAccounts.length} 个账号的分组`);
  }

  async function deleteSelectedAccounts(): Promise<void> {
    if (!selectedAccounts.length) return setStatus('请先选择账号');
    if (
      !confirm(
        `确定删除所选 ${selectedAccounts.length} 个账号？对应登录会话、缓存和本地存储也会一并清理，且不可恢复。`
      )
    )
      return;
    const deletedIds = [...selectedAccounts];
    unwrap(await window.workbench.accounts.removeMany(deletedIds));
    const tabs = openTabs.filter((id) => !deletedIds.includes(id));
    setAccounts(unwrap(await window.workbench.accounts.list()));
    setSelectedAccounts([]);
    setVideoNoticeByAccount((current) => {
      const next = { ...current };
      deletedIds.forEach((id) => delete next[id]);
      return next;
    });
    setOpenTabs(tabs);
    setActiveId(tabs[0] ?? null);
    await window.workbench.browser.activate(tabs[0] ?? null, null);
    await persistTabs(tabs, tabs[0] ?? null, null, settings?.dualView ?? false);
  }

  async function deleteAllAccounts(): Promise<void> {
    if (!accounts.length) return setStatus('当前没有账号');
    const total = accounts.length;
    if (
      !confirm(
        `确定删除全部 ${total} 个账号及其登录会话、缓存和本地存储吗？该操作不可恢复。`
      )
    )
      return;
    try {
      setBusy(true);
      unwrap(
        await window.workbench.accounts.removeMany(accounts.map((account) => account.id))
      );
      setAccounts([]);
      setSelectedAccounts([]);
      setVideoNoticeByAccount({});
      setOpenTabs([]);
      setActiveId(null);
      setSecondaryId(null);
      setAddress('');
      await window.workbench.browser.activate(null, null);
      await persistTabs([], null, null, settings?.dualView ?? false);
      setStatus(`已删除全部 ${total} 个账号`);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroupAccounts(): Promise<void> {
    if (!groupFilter) return setStatus('请先选择分组');
    const ids = accounts
      .filter((account) => account.group === groupFilter)
      .map((account) => account.id);
    if (!ids.length) return setStatus('当前分组没有账号');
    if (
      !confirm(
        `确定删除分组“${groupFilter}”下的 ${ids.length} 个账号？对应登录会话、缓存和本地存储也会一并清理，且不可恢复。`
      )
    )
      return;
    unwrap(await window.workbench.accounts.removeMany(ids));
    const tabs = openTabs.filter((id) => !ids.includes(id));
    const next = tabs[0] ?? null;
    setAccounts(unwrap(await window.workbench.accounts.list()));
    setSelectedAccounts((current) => current.filter((id) => !ids.includes(id)));
    setVideoNoticeByAccount((current) => {
      const next = { ...current };
      ids.forEach((id) => delete next[id]);
      return next;
    });
    setOpenTabs(tabs);
    setActiveId(next);
    setSecondaryId(null);
    setGroupFilter('');
    await window.workbench.browser.activate(next, null);
    await persistTabs(tabs, next, null, settings?.dualView ?? false);
    setStatus(`已删除分组“${groupFilter}”下 ${ids.length} 个账号`);
  }

  async function deletePlatformAccounts(): Promise<void> {
    if (!platformFilter) return setStatus('请先选择平台');
    const ids = accounts
      .filter((account) => account.platform === platformFilter)
      .map((account) => account.id);
    const platformName =
      platforms.find((platform) => platform.id === platformFilter)?.name ?? platformFilter;
    if (!ids.length) return setStatus(`“${platformName}”分类下没有账号`);
    if (
      !confirm(
        `确定删除“${platformName}”分类下的 ${ids.length} 个账号？对应登录会话、缓存和本地存储也会一并清理，且不可恢复。`
      )
    )
      return;
    unwrap(await window.workbench.accounts.removeMany(ids));
    const tabs = openTabs.filter((id) => !ids.includes(id));
    const next = tabs[0] ?? null;
    setAccounts(unwrap(await window.workbench.accounts.list()));
    setSelectedAccounts((current) => current.filter((id) => !ids.includes(id)));
    setVideoNoticeByAccount((current) => {
      const next = { ...current };
      ids.forEach((id) => delete next[id]);
      return next;
    });
    setOpenTabs(tabs);
    setActiveId(next);
    setSecondaryId(null);
    setPlatformFilter('');
    await window.workbench.browser.activate(next, null);
    await persistTabs(tabs, next, null, settings?.dualView ?? false);
    setStatus(`已删除“${platformName}”分类下 ${ids.length} 个账号`);
  }

  async function applyBulkProxy(): Promise<void> {
    try {
      setBusy(true);
      setAccounts(
        unwrap(
          await window.workbench.accounts.bulkUpdate(selectedAccounts, { proxy: bulkProxy })
        )
      );
      for (const id of selectedAccounts.filter((id) => openTabs.includes(id)))
        unwrap(await window.workbench.browser.applyProxy(id));
      setModal(null);
      setStatus(`已为 ${selectedAccounts.length} 个账号应用代理`);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function manageGroup(kind: 'rename' | 'remove'): Promise<void> {
    if (!groupFilter) return setStatus('请先选择分组');
    if (kind === 'rename') {
      const name = prompt('新的分组名称', groupFilter);
      if (name == null || name === groupFilter) return;
      setAccounts(unwrap(await window.workbench.accounts.renameGroup(groupFilter, name)));
      setGroupFilter(name);
    } else if (confirm(`移除分组“${groupFilter}”？账号会移动到未分组。`)) {
      setAccounts(unwrap(await window.workbench.accounts.removeGroup(groupFilter)));
      setGroupFilter('');
    }
  }

  async function clearAccountSession(kind: SessionDataKind): Promise<void> {
    if (!editingId) return;
    const label =
      kind === 'cookies'
        ? 'Cookie'
        : kind === 'cache'
        ? '缓存'
        : kind === 'storage'
        ? 'LocalStorage / IndexedDB / 扩展存储'
        : '全部会话数据';
    if (!confirm(`将清理当前账号的${label}，可能需要重新登录，是否继续？`)) return;
    try {
      setBusy(true);
      unwrap(await window.workbench.browser.clearSession(editingId, kind));
      setStatus(`账号${label}已清理`);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function testAccountProxy(): Promise<void> {
    if (!editingId) return;
    const result = unwrap(await window.workbench.browser.testProxy(editingId));
    const runtime = unwrap(await window.workbench.proxy.runtimeStatus(editingId));
    setRuntimeState(runtime);
    setStatus(`${result.message} · ${result.latencyMs}ms${result.ip ? ` · ${result.ip}` : ''}`);
  }

  async function importFormSubscription(): Promise<void> {
    if (!editingId) return setStatus('请先保存账号，再导入订阅');
    if (!form.proxy.subscriptionUrl) return setStatus('请先填写订阅地址');
    try {
      setBusy(true);
      const profile = unwrap(
        await window.workbench.proxy.importSubscription(
          editingId,
          form.proxy.subscriptionUrl
        )
      );
      const first = profile.nodes[0];
      setForm((current) => ({
        ...current,
        proxy: {
          ...current.proxy,
          enabled: true,
          mode: 'subscription',
          type: 'socks5',
          subscriptionConfigJson: profile.configJson,
          subscriptionNodes: profile.nodes,
          selectedNodeName: first?.name ?? '',
          selectedNodeTag: first?.tag ?? '',
          lastRuntimeError: ''
        }
      }));
      setAccounts(unwrap(await window.workbench.accounts.list()));
      setStatus(
        `订阅已导入：${profile.nodes.length} 个节点${
          profile.skippedNodeCount ? `，跳过 ${profile.skippedNodeCount} 个` : ''
        }`
      );
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function refreshFormSubscription(): Promise<void> {
    if (!editingId) return importFormSubscription();
    try {
      setBusy(true);
      const profile = unwrap(
        await window.workbench.proxy.refreshSubscription(editingId)
      );
      const currentTag = form.proxy.selectedNodeTag;
      const selected =
        profile.nodes.find((node) => node.tag === currentTag) ?? profile.nodes[0];
      setForm((current) => ({
        ...current,
        proxy: {
          ...current.proxy,
          subscriptionConfigJson: profile.configJson,
          subscriptionNodes: profile.nodes,
          selectedNodeName: selected?.name ?? '',
          selectedNodeTag: selected?.tag ?? '',
          lastRuntimeError: ''
        }
      }));
      setAccounts(unwrap(await window.workbench.accounts.list()));
      setStatus(`订阅已刷新：${profile.nodes.length} 个节点`);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function selectFormNode(tag: string): Promise<void> {
    const node = form.proxy.subscriptionNodes.find((item) => item.tag === tag);
    if (!node) return;
    setForm((current) => ({
      ...current,
      proxy: {
        ...current.proxy,
        selectedNodeTag: node.tag,
        selectedNodeName: node.name,
        lastRuntimeError: ''
      }
    }));
    if (!editingId) return;
    try {
      const state = unwrap(await window.workbench.proxy.selectNode(editingId, tag));
      setRuntimeState(state);
      setAccounts(unwrap(await window.workbench.accounts.list()));
      setStatus(`已切换节点：${node.name}`);
    } catch (error) {
      report(error);
    }
  }

  async function testFormNode(tag?: string): Promise<void> {
    if (!editingId) return setStatus('请先保存账号，再测试节点');
    try {
      const result = unwrap(await window.workbench.proxy.testNode(editingId, tag));
      setRuntimeState(unwrap(await window.workbench.proxy.runtimeStatus(editingId)));
      setStatus(`${result.message} · ${result.latencyMs}ms${result.ip ? ` · ${result.ip}` : ''}`);
    } catch (error) {
      report(error);
    }
  }

  async function testAllFormNodes(): Promise<void> {
    if (!editingId) return setStatus('请先保存账号，再测试全部节点');
    try {
      setBusy(true);
      const result = unwrap(await window.workbench.proxy.testAllNodes(editingId));
      setForm((current) => ({
        ...current,
        proxy: { ...current.proxy, subscriptionNodes: result.nodes }
      }));
      setAccounts(unwrap(await window.workbench.accounts.list()));
      setRuntimeState(unwrap(await window.workbench.proxy.runtimeStatus(editingId)));
      setStatus(`${result.message}；节点延迟和出口 IP 已更新`);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function regenerateFormFingerprint(): Promise<void> {
    if (!editingId) return setStatus('保存账号后才能重新生成指纹');
    try {
      const profile = unwrap(await window.workbench.fingerprint.regenerate(editingId));
      setForm((current) => ({ ...current, fingerprint: profile }));
      setAccounts(unwrap(await window.workbench.accounts.list()));
      setStatus('已重新生成账号指纹，页面将刷新');
    } catch (error) {
      report(error);
    }
  }

  async function resetFormFingerprint(): Promise<void> {
    if (!editingId) {
      const fallback = fingerprintSchema.parse({});
      return setForm((current) => ({
        ...current,
        fingerprint: { ...fallback, languages: [...fallback.languages] }
      }));
    }
    try {
      const profile = unwrap(await window.workbench.fingerprint.reset(editingId));
      setForm((current) => ({ ...current, fingerprint: profile }));
      setAccounts(unwrap(await window.workbench.accounts.list()));
      setStatus('已恢复默认浏览器指纹，页面将刷新');
    } catch (error) {
      report(error);
    }
  }

  async function refreshAccountsAfterMigration(): Promise<void> {
    setAccounts(unwrap(await window.workbench.accounts.list()));
    setSettings(unwrap(await window.workbench.settings.get()));
  }

  async function reorderAccount(
    draggedId: string,
    targetId: string,
    side: 'before' | 'after' = 'before'
  ): Promise<void> {
    if (draggedId === targetId) return;
    const ids = moveAccountIds(
      accounts.map((account) => account.id),
      draggedId,
      targetId,
      side
    );
    setAccounts(unwrap(await window.workbench.accounts.reorder(ids)));
  }

  const activeResources = useMemo(() => {
    const active = accounts.find((account) => account.id === activeId);
    if (!active) return [];
    return resources.filter(
      (resource) =>
        resource.accountId === active.id &&
        (!['doubao', 'dola'].includes(active.platform) ||
          mediaBelongsToPage(resource, active.browser.lastUrl))
    );
  }, [accounts, activeId, resources]);

  const sidebarHandlers = useStableHandlers({
    onSearchChange: setSearch,
    onGroupFilterChange: setGroupFilter,
    onPlatformFilterChange: setPlatformFilter,
    onToggleAccountTools: toggleAccountTools,
    onToggleGroupCollapse: (groupName: string) =>
      setCollapsedGroups((current) =>
        current.includes(groupName)
          ? current.filter((name) => name !== groupName)
          : [...current, groupName]
      ),
    onOpenSettings: () => setModal('settings'),
    onNewAccount: newAccount,
    onManageGroup: manageGroup,
    onDeleteGroupAccounts: () => void deleteGroupAccounts(),
    onDeletePlatformAccounts: () => void deletePlatformAccounts(),
    onImportAccounts: () =>
      window.workbench.accounts
        .import()
        .then(() => window.workbench.accounts.list())
        .then(unwrap)
        .then(setAccounts)
        .catch(report),
    onExportAccounts: () =>
      window.workbench.accounts
        .export()
        .then(unwrap)
        .then((x) => setStatus(`已导出：${x.path}`))
        .catch(report),
    onOpenFilteredAccounts: () => void openFilteredAccounts(),
    onRefreshOpenTabs: () => void refreshOpenTabs(),
    onCloseAllOpenTabs: () => void closeAllOpenTabs(),
    onDeleteAllAccounts: () => void deleteAllAccounts(),
    onOpenDownloadDir: () => void openDownloadDir(),
    onToggleSelectAll: () =>
      setSelectedAccounts(
        selectedAccounts.length === filteredAccounts.length && filteredAccounts.length > 0
          ? []
          : filteredAccounts.map((item) => item.id)
      ),
    onBatchAccounts: (action: Parameters<typeof batchAccounts>[0]) => void batchAccounts(action),
    onBatchAssignGroup: () => void batchAssignGroup(),
    onBatchProxy: () =>
      selectedAccounts.length
        ? (setBulkProxy({ ...emptyProxy }), setModal('bulkProxy'))
        : setStatus('请先选择账号'),
    onDeleteSelectedAccounts: () => void deleteSelectedAccounts(),
    onSelectAccount: (accId: string, checked: boolean) =>
      setSelectedAccounts(
        checked ? [...selectedAccounts, accId] : selectedAccounts.filter((id) => id !== accId)
      ),
    onOpenAccount: (accId: string) => void openAccount(accId),
    onEditAccount: editAccount,
    onDeleteAccount: (acc: Account) => void deleteAccount(acc),
    onExternalOpenAccount: (acc: Account) => void openExternalBrowser(acc),
    onReorderAccount: (dragged: string, target: string, side: 'before' | 'after') =>
      void reorderAccount(dragged, target, side),
    onClearFilters: () => {
      setSearch('');
      setGroupFilter('');
      setPlatformFilter('');
    }
  });

  const workspaceHandlers = useStableHandlers({
    onSelectTab: (id: string) => void selectTab(id),
    onCloseTab: (id: string) => void closeTab(id),
    onCloseOtherTabs: (id: string) => void closeOtherTabs(id),
    onReorderOpenTabs: reorderOpenTabs,
    onToggleTabOverview: () => setTabOverviewOpen((open) => !open),
    onCloseTabOverview: () => setTabOverviewOpen(false),
    onSetTabMenu: setTabMenu,
    onSecondaryChange: (id: string | null) =>
      void (async () => {
        try {
          if (id) await wakeTab(id);
        } catch (error) {
          report(error);
          return;
        }
        setSecondaryId(id);
        await window.workbench.browser.activate(activeId, id);
      })(),
    onClearDoubaoHistory: () => void clearDoubaoHistory(),
    onNewAccount: newAccount,
    onToggleResources: () =>
      settings &&
      void window.workbench.settings
        .update({ resourcesCollapsed: !settings.resourcesCollapsed })
        .then(unwrap)
        .then(setSettings),
    onOpenLibrary: () => setModal('library')
  });

  const mediaHandlers = useStableHandlers({
    onSelect: setSelectedMedia,
    onPreview: openPreview,
    onDownload: (resource: MediaResource) => void download(resource),
    onDownloadMany: (items: MediaResource[]) => void downloadManyResources(items, '素材'),
    onCandidates: setCandidateResource,
    onRefresh: (resource: MediaResource) => void refreshMediaResource(resource),
    onOpenFolder: () => void openVideoDownloadDir(),
    onLibrary: () => setModal('library'),
    onCollapse: () =>
      settings &&
      void window.workbench.settings
        .update({ resourcesCollapsed: true })
        .then(unwrap)
        .then(setSettings),
    onClear: clearMediaList,
    onStatus: setStatus
  });

  return (
    <div className="app-shell">
      <AppHeader status={status} />
      <main
        ref={workspaceRef}
        className={`workspace ${settings?.resourcesCollapsed ? 'resources-collapsed' : ''}`}
      >
        <MemoAccountsSidebar
          accounts={accounts}
          filteredAccounts={filteredAccounts}
          groupedAccounts={groupedAccounts}
          groups={groups}
          platforms={platforms}
          openTabs={openTabs}
          activeId={activeId}
          selectedAccounts={selectedAccounts}
          search={search}
          groupFilter={groupFilter}
          platformFilter={platformFilter}
          collapsedGroups={collapsedGroups}
          accountToolsCollapsed={accountToolsCollapsed}
          videoNoticeByAccount={videoNoticeByAccount}
          busy={busy}
          searchRef={searchRef}
          {...sidebarHandlers}
        />

        <MemoBrowserWorkspace
          accounts={accounts}
          platforms={platforms}
          openTabs={openTabs}
          sleepingTabs={sleepingTabs}
          activeId={activeId}
          secondaryId={secondaryId}
          settings={settings}
          activeAccount={activeAccount}
          tabOverviewOpen={tabOverviewOpen}
          tabMenu={tabMenu}
          busy={busy}
          videoNoticeByAccount={videoNoticeByAccount}
          primaryRef={primaryRef}
          secondaryRef={secondaryRef}
          accountName={accountName}
          {...workspaceHandlers}
        />

        <MemoMediaPanel
          resources={activeResources}
          tasks={tasks}
          selected={selectedMedia}
          parseImages={settings?.parseImages ?? false}
          accountName={accountName}
          {...mediaHandlers}
        />
      </main>

      <Suspense fallback={null}>
        {modal === 'account' && (
          <AccountModal
            editingId={editingId}
            form={form}
            platforms={platforms}
            busy={busy}
            runtimeState={runtimeState}
            newAccountCount={newAccountCount}
            startAfterCreate={startAfterCreate}
            onFormChange={setForm}
            onNewAccountCountChange={setNewAccountCount}
            onStartAfterCreateChange={setStartAfterCreate}
            onSave={() => void saveAccount()}
            onClose={() => setModal(null)}
            onImportSubscription={() => void importFormSubscription()}
            onRefreshSubscription={() => void refreshFormSubscription()}
            onSelectNode={(tag) => void selectFormNode(tag)}
            onTestNode={(tag) => void testFormNode(tag)}
            onTestAllNodes={() => void testAllFormNodes()}
            onTestProxy={() => void testAccountProxy()}
            onClearSession={(kind) => void clearAccountSession(kind)}
            onRegenerateFingerprint={() => void regenerateFormFingerprint()}
            onResetFingerprint={() => void resetFormFingerprint()}
          />
        )}

        {modal === 'bulkProxy' && (
          <BulkProxyModal
            selectedCount={selectedAccounts.length}
            bulkProxy={bulkProxy}
            busy={busy}
            onChange={setBulkProxy}
            onApply={() => void applyBulkProxy()}
            onClose={() => setModal(null)}
          />
        )}

        {modal === 'settings' && settings && (
          <Modal
            title="工作台设置"
            className="settings-modal"
            onClose={() => setModal(null)}
          >
            <SettingsPanel
              settings={settings}
              platforms={platforms}
              onChange={async (patch) =>
                setSettings(unwrap(await window.workbench.settings.update(patch)))
              }
              onStatus={setStatus}
            />
          </Modal>
        )}

        {modal === 'library' && (
          <Modal title="下载素材库" wide onClose={() => setModal(null)}>
            <LibraryModal
              accounts={accounts}
              platforms={platforms}
              onStatus={setStatus}
            />
          </Modal>
        )}

        {modal === 'login' && activeId && (
          <Modal
            title={`登录辅助 · ${accountName(activeId)}`}
            onClose={() => setModal(null)}
          >
            <LoginAssistModal accountId={activeId} onStatus={setStatus} />
          </Modal>
        )}

        {modal === 'dola' && settings && (
          <Modal title="Dola 批量登录" wide onClose={() => setModal(null)}>
            <DolaBatchModal
              accounts={accounts.filter((account) => account.platform === 'dola')}
              initialAccountId={activeId ?? undefined}
              dolaAspectRatio={settings.dolaAspectRatio}
              onSettingsChange={async (patch) =>
                setSettings(unwrap(await window.workbench.settings.update(patch)))
              }
              onAccountsChanged={async () => {
                setAccounts(unwrap(await window.workbench.accounts.list()));
              }}
              onStatus={setStatus}
            />
          </Modal>
        )}

        {modal === 'higgsfield' && (
          <Modal title="Higgsfield 批量登录" wide onClose={() => setModal(null)}>
            <HiggsfieldBatchModal
              accounts={accounts.filter((account) => account.platform === 'higgsfield')}
              onAccountsChanged={async () => {
                setAccounts(unwrap(await window.workbench.accounts.list()));
              }}
              onStatus={setStatus}
            />
          </Modal>
        )}

        {modal === 'faceGrid' && (
          <Modal title="人脸网格工具" wide onClose={() => setModal(null)}>
            <FaceGridPanel onStatus={setStatus} />
          </Modal>
        )}

        {modal === 'migration' && (
          <Modal title="V4.4 数据迁移" wide onClose={() => setModal(null)}>
            <MigrationPanel
              activeAccountId={activeId}
              onImported={refreshAccountsAfterMigration}
              onStatus={setStatus}
            />
          </Modal>
        )}

        {modal === 'diagnostics' && (
          <Modal title="系统诊断" wide onClose={() => setModal(null)}>
            <DiagnosticsPanel onStatus={setStatus} />
          </Modal>
        )}

        {modal === 'help' && (
          <Modal title="使用指南与快捷键" wide onClose={() => setModal(null)}>
            <HelpPanel />
          </Modal>
        )}

        {previewResource && (
          <MediaPreviewModal
            resource={previewResource}
            convertedUrl={convertedPreviewUrl}
            busy={conversionBusy}
            onPrepare={() => void prepareResourcePreview(previewResource)}
            onConvert={() => void convertPreview(previewResource)}
            onRestore={() => setConvertedPreviewUrl(null)}
            onDownload={(resource) => void download(resource)}
            onOpenUrl={(resource) => void openResourceUrl(resource)}
            onClose={() => {
              setPreviewResource(null);
              setConvertedPreviewUrl(null);
            }}
          />
        )}

        {candidateResource && (
          <CandidateModal
            resource={candidateResource}
            onSelectCandidate={(res, url) => void selectMediaCandidate(res, url)}
            onCopyUrl={(url) => void copyCandidateUrl(url)}
            onOpenUrl={(url) => void openCandidateUrl(url)}
            onClose={() => setCandidateResource(null)}
          />
        )}

      </Suspense>

      <ToastContainer
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
    </div>
  );
}
