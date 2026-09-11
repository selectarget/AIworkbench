import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { browserProfileSchema, dolaAspectRatios, fingerprintSchema, proxySchema, type Account, type AccountInput, type AccountVideoGeneratedNotice, type ApiResult, type AppSettings, type BatchLoginPlatform, type CaptureMode, type DiagnosticsSnapshot, type DownloadTask, type DolaAspectRatio, type DolaClickProfile, type DolaClickTarget, type DolaReferenceKind, type DolaResourceReference, type DoubaoDuration, type ExternalBrowserLayout, type FaceGridImage, type FaceGridMode, type FingerprintProfile, type LegacyCacheCleanReport, type LegacyCacheScan, type LegacyImportPreview, type LegacyImportReport, type LibraryPage, type MediaResource, type MediaToolStatus, type PlatformDefinition, type PlatformId, type PluginRecord, type ProfileLocationInfo, type ProxyConfig, type ProxyRuntimeState, type SessionDataKind } from '../../shared/contracts';
import { processFaceGrid } from './face-grid';

const emptyProxy: ProxyConfig = proxySchema.parse({});
const emptyInput: AccountInput = { name: '', platform: 'doubao', group: '', remark: '', customUrl: '', proxy: emptyProxy, browser: browserProfileSchema.parse({}), fingerprint: fingerprintSchema.parse({}) };
const defaultDolaClickProfile: DolaClickProfile = { login: { xRatio: 0.93, yRatio: 0.035 }, google: { xRatio: 0.345, yRatio: 0.61 } };
const MAX_STANDARD_ACCOUNT_CREATION = 100;
const MAX_EMBEDDED_BATCH_WORKSPACE_ACCOUNTS = 20;
// This is the fixed, non-authentication ancillary link exposed by V4.4.
// Keep it as a constant instead of accepting a renderer-provided URL.
const AUTHOR_SHOP_URL = 'https://pay.ldxp.cn/shop/KVMYRWEY';
const dolaAspectRatioOptions: ReadonlyArray<{ value: DolaAspectRatio; label: string }> = [
  { value: '1:1', label: '1:1 方形' },
  { value: '3:4', label: '3:4 竖幅' },
  { value: '4:3', label: '4:3 横幅' },
  { value: '9:16', label: '9:16 竖屏' },
  { value: '16:9', label: '16:9 横屏' },
  { value: '21:9', label: '21:9 超宽' }
];

type IconName =
  | 'arrow-left' | 'arrow-right' | 'refresh' | 'columns' | 'panel-right'
  | 'library' | 'more' | 'settings' | 'plus' | 'chevron-down' | 'chevron-right'
  | 'external' | 'close' | 'link' | 'copy' | 'download' | 'preview'
  | 'candidate' | 'image' | 'video' | 'search' | 'play' | 'check'
  | 'folder' | 'trash' | 'retry' | 'sparkle';

function Icon({ name, size = 16 }: { name: IconName; size?: number }): React.JSX.Element {
  const paths: Record<IconName, React.JSX.Element> = {
    'arrow-left': <path d="M15 18 9 12l6-6" />,
    'arrow-right': <path d="m9 18 6-6-6-6" />,
    refresh: <><path d="M20 11a8 8 0 0 0-14.7-4L4 9" /><path d="M4 4v5h5" /><path d="M4 13a8 8 0 0 0 14.7 4L20 15" /><path d="M20 20v-5h-5" /></>,
    columns: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M12 4v16" /></>,
    'panel-right': <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M9 5v14" /></>,
    library: <><path d="M5 4h14v16H5z" /><path d="M8 4v16M5 9h14" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    settings: <><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /><circle cx="12" cy="12" r="4" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    'chevron-down': <path d="m6 9 6 6 6-6" />,
    'chevron-right': <path d="m9 6 6 6-6 6" />,
    external: <><path d="M14 5h5v5" /><path d="m19 5-8 8" /><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.1.1l1.4-1.4a5 5 0 0 0-7.1-7.1L10.6 5.4" /><path d="M14 11a5 5 0 0 0-7.1-.1l-1.4 1.4a5 5 0 0 0 7.1 7.1l.8-.8" /></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    download: <><path d="M12 4v10" /><path d="m8 11 4 4 4-4" /><path d="M5 20h14" /></>,
    preview: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3z" /></>,
    candidate: <><path d="M5 6h14M5 12h14M5 18h9" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="9" r="1.5" /><path d="m4 17 5-5 3 3 2-2 6 5" /></>,
    video: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3z" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4 4" /></>,
    play: <path d="m9 6 9 6-9 6z" />,
    check: <path d="m5 12 4 4L19 6" />,
    folder: <><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>,
    trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
    retry: <><path d="M20 11a8 8 0 0 0-14.7-4L4 9" /><path d="M4 4v5h5" /><path d="M20 13a8 8 0 0 1-14.7 4L4 15" /><path d="M20 20v-5h-5" /></>,
    sparkle: <><path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4z" /><path d="m19 16 .5 2.5L22 19l-2.5.5L19 22l-.5-2.5L16 19l2.5-.5z" /></>
  };
  return <svg className={`icon icon-${name}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
function parseDolaAspectRatio(value: string | null | undefined): DolaAspectRatio | undefined {
  return dolaAspectRatios.includes(value as DolaAspectRatio) ? value as DolaAspectRatio : undefined;
}

function unwrap<T>(result: ApiResult<T>): T { if (!result.ok) throw new Error(result.error.message); return result.data; }
function formatBytes(value: number): string { if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1024 ** 2).toFixed(1)} MB`; }
// main.tsx stamps data-platform on <html>, but its `import { App }` is hoisted and runs first,
// so this has to be read at render time rather than captured in a module constant.
function isWindowsPlatform(): boolean { return document.documentElement.dataset.platform === 'windows'; }
// Mounted dialogs, innermost last, so the focus trap can tell which one owns Tab when they stack.
const openDialogs: HTMLElement[] = [];
function focusablesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((node) => node.getClientRects().length > 0);
}
export function moveAccountIds(ids: readonly string[], draggedId: string, targetId: string, side: 'before' | 'after' = 'before'): string[] {
  if (!draggedId || !targetId || draggedId === targetId) return [...ids];
  const next = [...ids];
  const fromIndex = next.indexOf(draggedId);
  if (fromIndex < 0) return next;
  const [dragged] = next.splice(fromIndex, 1);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex < 0 || !dragged) return [...ids];
  next.splice(targetIndex + (side === 'after' ? 1 : 0), 0, dragged);
  return next;
}
function externalBrowserGridLayout(index: number, total: number): ExternalBrowserLayout {
  const count = Math.max(1, Math.min(10, Number(total) || 1));
  let columns = 1;
  if (count <= 2) columns = count;
  else if (count <= 4) columns = 2;
  else if (count <= 6) columns = 3;
  else columns = 5;
  const rows = Math.ceil(count / columns);
  const screen = window.screen as Screen & { availLeft?: number; availTop?: number };
  const left = Number(screen?.availLeft || 0);
  const top = Number(screen?.availTop || 0);
  const availableWidth = Math.max(900, Number(screen?.availWidth || window.innerWidth || 1400));
  const availableHeight = Math.max(700, Number(screen?.availHeight || window.innerHeight || 900));
  const gap = 8;
  const width = Math.max(480, Math.floor((availableWidth - gap * (columns - 1)) / columns));
  const height = Math.max(420, Math.floor((availableHeight - gap * (rows - 1)) / rows));
  const slot = Math.max(0, index) % count;
  return { x: left + (slot % columns) * (width + gap), y: top + Math.floor(slot / columns) * (height + gap), width, height };
}
async function runWithConcurrency<T>(items: readonly T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  if (!items.length) return;
  let cursor = 0;
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      if (index >= items.length) return;
      cursor += 1;
      await worker(items[index]!, index);
    }
  }));
}

export function splitIntoBatches<T>(items: readonly T[], size: number): T[][] {
  const batchSize = Math.max(1, Math.floor(size));
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += batchSize) batches.push(items.slice(start, start + batchSize));
  return batches;
}

export type ConnectionVisualState = {
  label: string;
  tone: 'ready' | 'busy' | 'error' | 'idle';
  detail?: string;
};

/**
 * Keep the browser toolbar honest about the route that the active account is
 * actually using. A generic “isolated” label used to hide a failed sing-box
 * runtime even though the page had no usable network path.
 */
export function connectionVisualState(
  account: Pick<Account, 'id' | 'proxy'> | undefined,
  runtime: ProxyRuntimeState | null
): ConnectionVisualState {
  if (!account) return { label: '等待账号', tone: 'idle' };
  if (!account.proxy.enabled) return { label: '直连 · Session 隔离', tone: 'ready' };
  if (account.proxy.mode === 'direct') return { label: '代理已配置 · Session 隔离', tone: 'ready' };
  if (runtime?.accountId !== account.id) {
    return account.proxy.lastRuntimeError
      ? { label: '订阅代理异常', tone: 'error', detail: account.proxy.lastRuntimeError }
      : { label: '订阅代理 · 检查中', tone: 'busy' };
  }
  if (runtime.status === 'running') return { label: `代理已连接 · ${runtime.localPort ?? '回环端口'}`, tone: 'ready' };
  if (runtime.status === 'starting') return { label: '代理启动中', tone: 'busy' };
  if (runtime.status === 'stopping') return { label: '代理停止中', tone: 'busy' };
  if (runtime.status === 'failed') return { label: '代理运行失败 · 网络已阻断', tone: 'error', detail: runtime.error || account.proxy.lastRuntimeError };
  return { label: '订阅代理 · 未启动', tone: 'idle' };
}

export async function restoreOpenTabs(
  accountIds: readonly string[],
  openAccount: (accountId: string) => Promise<{ ok: boolean }>
): Promise<{ restored: string[]; failed: string[] }> {
  const restored: string[] = []; const failed: string[] = [];
  for (const accountId of [...new Set(accountIds)]) {
    try {
      const result = await openAccount(accountId);
      if (result.ok) restored.push(accountId); else failed.push(accountId);
    } catch {
      failed.push(accountId);
    }
  }
  return { restored, failed };
}

function hasDolaResourceLocator(resource: MediaResource): boolean {
  return [resource.messageId, resource.conversationId, resource.shareId, resource.shareUrl, resource.threadUrl, resource.vid, resource.keySeed, resource.fplayUrl, resource.dolaRecordKey, resource.dolaCardId, resource.dolaVideoElementId].some((item) => Boolean(item?.trim()));
}

/**
 * Make CDN failover visible in the resource panel. The first URL is the
 * primary candidate; backup/alternate URLs are still tried by Main Process.
 */
export function mediaCandidateCount(resource: Pick<MediaResource, 'url' | 'backupUrl' | 'alternateUrls'>): number {
  return mediaCandidates(resource).length;
}

export type MediaCandidateRole = 'primary' | 'backup' | 'alternate';
export type MediaCandidate = { url: string; role: MediaCandidateRole; index: number };

/**
 * Expose only the bounded, de-duplicated URLs already observed for a resource.
 * The renderer never invents a download URL; Main Process still validates the
 * selected candidate before it can become the primary download route.
 */
export function mediaCandidates(resource: Pick<MediaResource, 'url' | 'backupUrl' | 'alternateUrls'>): MediaCandidate[] {
  const values = [resource.url, resource.backupUrl, ...(resource.alternateUrls ?? [])]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  return [...new Set(values)].map((url, index) => ({
    url,
    index,
    role: index === 0 ? 'primary' : index === 1 ? 'backup' : 'alternate'
  }));
}

/**
 * Prefer a real video element for video resources. A poster-only resource
 * still falls back to an image, while unresolved resources remain an icon.
 */
export function mediaPreviewKind(
  resource: Pick<MediaResource, 'type' | 'url' | 'previewUrl' | 'thumbUrl' | 'previewThumbUrl'>
): 'video' | 'image' | 'placeholder' {
  const playableUrl = String(resource.previewUrl || resource.url || '').trim();
  const visualUrl = String(resource.previewThumbUrl || resource.thumbUrl || resource.previewUrl || resource.url || '').trim();
  if (resource.type === 'video' && playableUrl) return 'video';
  if (visualUrl) return 'image';
  return 'placeholder';
}

/**
 * Changes that affect the already-created WebContentsView must rebuild it.
 * In particular, the adapter and custom start URL are captured during view
 * initialization; a metadata-only account update must not silently leave the
 * old platform scripts, extensions, or page running.
 */
export function accountViewNeedsReconfigure(
  previous: Pick<Account, 'platform' | 'customUrl' | 'browser' | 'fingerprint'> | undefined,
  next: Pick<AccountInput, 'platform' | 'customUrl' | 'browser' | 'fingerprint'>
): boolean {
  if (!previous) return false;
  return previous.platform !== next.platform
    || (previous.customUrl ?? '') !== (next.customUrl ?? '')
    || JSON.stringify(previous.browser) !== JSON.stringify(next.browser)
    || JSON.stringify(previous.fingerprint) !== JSON.stringify(next.fingerprint);
}

export function App(): React.JSX.Element {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [platforms, setPlatforms] = useState<PlatformDefinition[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [resources, setResources] = useState<MediaResource[]>([]);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [secondaryId, setSecondaryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [mediaType, setMediaType] = useState<CaptureMode>('all');
  const [groupFilter, setGroupFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState<PlatformId | ''>('');
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [accountToolsCollapsed, setAccountToolsCollapsed] = useState<boolean>(() => {
    try { return window.localStorage.getItem('accountToolsCollapsed') !== '0'; } catch { return true; }
  });
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<string[]>([]);
  const [videoNotices, setVideoNotices] = useState<AccountVideoGeneratedNotice[]>([]);
  const [videoNoticeByAccount, setVideoNoticeByAccount] = useState<Record<string, number>>({});
  const [previewResource, setPreviewResource] = useState<MediaResource | null>(null);
  const [candidateResource, setCandidateResource] = useState<MediaResource | null>(null);
  const [convertedPreviewUrl, setConvertedPreviewUrl] = useState<string | null>(null);
  const [conversionBusy, setConversionBusy] = useState(false);
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [modal, setModal] = useState<'account' | 'bulkProxy' | 'settings' | 'library' | 'login' | 'dola' | 'higgsfield' | 'migration' | 'faceGrid' | 'diagnostics' | 'help' | null>(null);
  const [form, setForm] = useState<AccountInput>(emptyInput);
  const [bulkProxy, setBulkProxy] = useState<ProxyConfig>({ ...emptyProxy });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newAccountCount, setNewAccountCount] = useState(1);
  const [startAfterCreate, setStartAfterCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('就绪');
  const [runtimeState, setRuntimeState] = useState<ProxyRuntimeState | null>(null);
  const [address, setAddress] = useState('');
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const primaryRef = useRef<HTMLDivElement>(null); const secondaryRef = useRef<HTMLDivElement>(null); const workspaceRef = useRef<HTMLElement>(null); const searchRef = useRef<HTMLInputElement>(null); const activeIdRef = useRef<string | null>(null);

  const report = useCallback((error: unknown): void => setStatus(error instanceof Error ? error.message : String(error)), []);
  const persistTabs = useCallback(async (tabs: string[], active: string | null, secondary: string | null, dual: boolean) => {
    const result = await window.workbench.settings.update({ openTabs: tabs, activeTabId: active, secondaryTabId: secondary, dualView: dual });
    if (result.ok) setSettings(result.data);
  }, []);

  useEffect(() => {
    void Promise.all([window.workbench.accounts.list(), window.workbench.platforms(), window.workbench.settings.get(), window.workbench.media.list(), window.workbench.media.tasks()]).then(async ([a, p, s, m, t]) => {
      const accountRows = unwrap(a); const config = unwrap(s);
      setAccounts(accountRows); setPlatforms(unwrap(p)); setSettings(config); setMediaType('all'); setResources(unwrap(m)); setTasks(unwrap(t));
      const valid = config.openTabs.filter((id) => accountRows.some((account) => account.id === id));
      const { restored, failed } = await restoreOpenTabs(valid, (id) => window.workbench.browser.open(id));
      const active = restored.includes(config.activeTabId ?? '') ? config.activeTabId : restored[0] ?? null;
      const secondary = config.dualView && restored.includes(config.secondaryTabId ?? '') && config.secondaryTabId !== active ? config.secondaryTabId : null;
      setOpenTabs(restored); setActiveId(active); setSecondaryId(secondary); await window.workbench.browser.activate(active, secondary);
      if (failed.length) {
        setStatus(`已恢复 ${restored.length} 个账号，${failed.length} 个账号打开失败，可稍后重试`);
        await persistTabs(restored, active, secondary, config.dualView);
      }
    }).catch(report);
    const offMedia = window.workbench.media.onUpdated((next) => { setResources(next); if (!next.length) setVideoNoticeByAccount({}); }); const offTasks = window.workbench.media.onTasks(setTasks); const offFileDownloaded = window.workbench.files.onDownloaded((notice) => setStatus(`文件下载完成：${notice.filename}`)); const offVideoGenerated = window.workbench.media.onVideoGenerated((notice) => { setVideoNotices((current) => [...current.filter((item) => `${item.accountId}:${item.key}` !== `${notice.accountId}:${notice.key}`), notice].slice(-4)); setVideoNoticeByAccount((current) => ({ ...current, [notice.accountId]: Math.min(99, (current[notice.accountId] ?? 0) + 1) })); setStatus(`${notice.accountId} 有新视频生成`); window.setTimeout(() => setVideoNotices((current) => current.filter((item) => `${item.accountId}:${item.key}` !== `${notice.accountId}:${item.key}`)), 9000); }); const offProxy = window.workbench.proxy.onState((state) => { if (state.accountId === activeIdRef.current || !activeIdRef.current) setRuntimeState(state); }); const offNavigation = window.workbench.browser.onNavigation((state) => { setAccounts((current) => current.map((account) => account.id === state.accountId ? { ...account, browser: { ...account.browser, lastUrl: state.url } } : account)); if (state.accountId === activeIdRef.current) setAddress(state.url); }); return () => { offMedia(); offTasks(); offFileDownloaded(); offVideoGenerated(); offProxy(); offNavigation(); };
  }, [report]);

  useEffect(() => { document.documentElement.dataset.theme = 'light'; }, []);
  useEffect(() => { document.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [activeId, openTabs.length]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { const account = accounts.find((item) => item.id === activeId); setAddress(account?.browser.lastUrl || account?.browser.homeUrl || ''); }, [activeId]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // Dismiss exactly one layer - the topmost - rather than every open layer at once.
        // Measured stacking order: .tab-context-menu (z 12000) > .toolbar-menu (z 10020) >
        // .modal-backdrop (z 9999); the three Modal-backed layers (modal / previewResource /
        // candidateResource) share the backdrop and stack by render order further down.
        // The old all-at-once version meant one Escape could dismiss a dialog the user was
        // reading plus whatever menu sat behind it.
        if (tabMenu) setTabMenu(null);
        else if (toolsMenuOpen) setToolsMenuOpen(false);
        else if (candidateResource) setCandidateResource(null);
        else if (previewResource) { setPreviewResource(null); setConvertedPreviewUrl(null); }
        else if (modal) setModal(null);
        else return;
        event.preventDefault();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [accountToolsCollapsed, candidateResource, modal, previewResource, tabMenu, toolsMenuOpen]);
  useEffect(() => {
    if (!toolsMenuOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Element && !target.closest('.toolbar-more')) setToolsMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [toolsMenuOpen]);
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
    if (!activeId) { setRuntimeState(null); return () => { disposed = true; }; }
    setRuntimeState(null);
    void window.workbench.proxy.runtimeStatus(activeId).then((result) => {
      if (!disposed && result.ok) setRuntimeState(result.data);
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, [activeId]);
  const previewId = previewResource?.id;
  useEffect(() => {
    if (!previewId) return;
    const current = resources.find((resource) => resource.id === previewId);
    if (current) setPreviewResource(current);
    else { setPreviewResource(null); setConvertedPreviewUrl(null); }
  }, [previewId, resources]);
  const candidateId = candidateResource?.id;
  useEffect(() => {
    if (!candidateId) return;
    const current = resources.find((resource) => resource.id === candidateId);
    if (current) setCandidateResource(current);
    else setCandidateResource(null);
  }, [candidateId, resources]);
  const browserOccluded = Boolean(modal || previewResource || candidateResource || toolsMenuOpen);
  useEffect(() => {
    const send = (): void => {
      const primary = primaryRef.current?.getBoundingClientRect(); if (!primary) return;
      const secondary = settings?.dualView ? secondaryRef.current?.getBoundingClientRect() : undefined;
      void window.workbench.browser.setLayout({ occluded: browserOccluded, primary: { x: primary.x, y: primary.y, width: primary.width, height: primary.height }, secondary: secondary ? { x: secondary.x, y: secondary.y, width: secondary.width, height: secondary.height } : undefined });
    };
     const observer = new ResizeObserver(send); if (primaryRef.current) observer.observe(primaryRef.current); if (secondaryRef.current) observer.observe(secondaryRef.current);
     const workspace = workspaceRef.current; workspace?.addEventListener('scroll', send, { passive: true });
     window.addEventListener('resize', send); send(); return () => { observer.disconnect(); workspace?.removeEventListener('scroll', send); window.removeEventListener('resize', send); };
   }, [settings?.dualView, activeId, secondaryId, browserOccluded]);

  const groups = useMemo(() => [...new Set(accounts.map((account) => account.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')), [accounts]);
  const filteredAccounts = useMemo(() => accounts.filter((account) => (!groupFilter || account.group === groupFilter) && (!platformFilter || account.platform === platformFilter) && `${account.name} ${account.group} ${account.remark}`.toLowerCase().includes(search.toLowerCase())), [accounts, search, groupFilter, platformFilter]);
  const groupedAccounts = useMemo(() => [...new Set(filteredAccounts.map((account) => account.group || '未分组'))].map((name) => ({ name, accounts: filteredAccounts.filter((account) => (account.group || '未分组') === name) })), [filteredAccounts]);
  const filteredMedia = useMemo(() => resources.filter((resource) => mediaType === 'all' || resource.type === mediaType), [resources, mediaType]);
  const accountName = (id: string | null): string => accounts.find((account) => account.id === id)?.name ?? '未选择';
  const activeAccount = accounts.find((account) => account.id === activeId);
  const connection = connectionVisualState(activeAccount, runtimeState);

  async function openAccount(id: string): Promise<void> {
    try { setBusy(true); unwrap(await window.workbench.browser.open(id)); const tabs = openTabsRef.current.includes(id) ? openTabsRef.current : [...openTabsRef.current, id]; openTabsRef.current = tabs; setOpenTabs(tabs); setActiveId(id); setVideoNoticeByAccount((current) => { if (!(id in current)) return current; const next = { ...current }; delete next[id]; return next; }); const account = accounts.find((item) => item.id === id); setAddress(account?.browser.lastUrl || account?.browser.homeUrl || ''); await window.workbench.browser.activate(id, secondaryId); await persistTabs(tabs, id, secondaryId, settings?.dualView ?? false); setStatus(`已打开 ${accountName(id)}`); } catch (error) { report(error); } finally { setBusy(false); }
  }
  async function navigateActive(): Promise<void> {
    if (!activeId) return setStatus('请先打开一个账号');
    const value = address.trim();
    if (!value) return setStatus('请输入网页地址');
    try {
      unwrap(await window.workbench.browser.navigate(activeId, value));
      const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
      setAddress(normalized);
      setStatus(`正在导航到 ${normalized}`);
    } catch (error) { report(error); }
  }
  async function changeCaptureMode(mode: CaptureMode): Promise<void> {
    setMediaType(mode);
  }
  function toggleAccountTools(): void {
    setAccountToolsCollapsed((current) => {
      const next = !current;
      try { window.localStorage.setItem('accountToolsCollapsed', next ? '1' : '0'); } catch { /* best effort preference */ }
      return next;
    });
  }
  async function openExternalBrowser(account: Account): Promise<void> {
    try { setBusy(true); const result = unwrap(await window.workbench.browser.externalBrowserOpen(account.id)); setStatus(`已在系统 Chrome/Edge 打开 ${account.name} · 同步 ${result.cookies} 个 Cookie`); } catch (error) { report(error); } finally { setBusy(false); }
  }
  async function openAuthorShop(): Promise<void> {
    try {
      unwrap(await window.workbench.files.openUrl(AUTHOR_SHOP_URL));
      setStatus('已在系统浏览器打开作者店铺');
    } catch (error) { report(error); }
  }
  async function startJimengOriginal(): Promise<void> {
    if (!activeId) return;
    try { const result = unwrap(await window.workbench.browser.startJimengOriginal(activeId)); setStatus(result.message); } catch (error) { report(error); }
  }
  async function startDoubaoCreationScan(): Promise<void> {
    if (!activeId) return;
    try { const result = unwrap(await window.workbench.browser.startDoubaoCreationScan(activeId)); setStatus(result.message); } catch (error) { report(error); }
  }
  async function sendDoubao15sPrompt(): Promise<void> {
    if (!activeId) return;
    try { setStatus('正在向当前豆包页面填入 15 秒增强提示词…'); const result = unwrap(await window.workbench.browser.sendDoubao15sPrompt(activeId)); setStatus(result.message); } catch (error) { report(error); }
  }
  async function setDoubaoDuration(duration: DoubaoDuration): Promise<void> {
    if (!activeId) return;
    try {
      setStatus(`正在设置豆包 ${duration} 秒模式…`);
      const result = unwrap(await window.workbench.browser.setDoubaoDuration(activeId, duration));
      const modelHint = duration === 30 && !result.modelSupports30 ? '；请先在页面选择 Seedance 2.5' : '';
      const bridgeHint = result.bridgeReady ? '' : '；页面桥尚未就绪，请刷新或修复页面后重试';
      setStatus(`${result.message}${modelHint}${bridgeHint}`);
    } catch (error) { report(error); }
  }
  async function closeTab(id: string): Promise<void> {
    unwrap(await window.workbench.browser.close(id)); const tabs = openTabsRef.current.filter((item) => item !== id); const next = activeId === id ? tabs.at(-1) ?? null : activeId; const second = secondaryId === id ? null : secondaryId;
    openTabsRef.current = tabs; setOpenTabs(tabs); setActiveId(next); setSecondaryId(second); setTabMenu(null); await window.workbench.browser.activate(next, second); await persistTabs(tabs, next, second, settings?.dualView ?? false);
  }
  async function selectTab(id: string): Promise<void> { setTabMenu(null); setActiveId(id); setVideoNoticeByAccount((current) => { if (!(id in current)) return current; const next = { ...current }; delete next[id]; return next; }); if (id === secondaryId) setSecondaryId(null); await window.workbench.browser.activate(id, id === secondaryId ? null : secondaryId); await persistTabs(openTabsRef.current, id, id === secondaryId ? null : secondaryId, settings?.dualView ?? false); }
  async function closeOtherTabs(id: string): Promise<void> {
    const others = openTabsRef.current.filter((item) => item !== id);
    setTabMenu(null);
    if (!others.length) return setStatus('当前没有其他标签');
    try {
      setBusy(true);
      unwrap(await window.workbench.browser.closeMany(others));
      const tabs = [id];
      openTabsRef.current = tabs;
      setOpenTabs(tabs); setActiveId(id); setSecondaryId(null);
      await window.workbench.browser.activate(id, null);
      await persistTabs(tabs, id, null, settings?.dualView ?? false);
      setStatus(`已关闭 ${others.length} 个其他标签`);
    } catch (error) { report(error); } finally { setBusy(false); }
  }
  function reorderOpenTabs(draggedId: string, targetId: string, side: 'before' | 'after' = 'before'): void {
    const tabs = moveAccountIds(openTabsRef.current, draggedId, targetId, side);
    if (tabs.join('|') === openTabsRef.current.join('|')) return;
    openTabsRef.current = tabs;
    setOpenTabs(tabs);
    setTabMenu(null);
    void persistTabs(tabs, activeId, secondaryId, settings?.dualView ?? false).catch(report);
  }
  async function toggleDual(): Promise<void> {
    if (!settings) return; const dual = !settings.dualView; const second = dual ? openTabs.find((id) => id !== activeId) ?? null : null;
    setSecondaryId(second); const updated = unwrap(await window.workbench.settings.update({ dualView: dual, secondaryTabId: second })); setSettings(updated); await window.workbench.browser.activate(activeId, second);
  }
  function newAccount(): void { setEditingId(null); setNewAccountCount(1); setStartAfterCreate(false); setForm({ ...emptyInput, proxy: { ...emptyProxy, subscriptionNodes: [] }, browser: { ...emptyInput.browser }, fingerprint: { ...emptyInput.fingerprint, languages: [...emptyInput.fingerprint.languages] } }); setModal('account'); }
  function editAccount(account: Account): void { setEditingId(account.id); setForm({ name: account.name, platform: account.platform, group: account.group, remark: account.remark, customUrl: account.customUrl ?? '', proxy: { ...account.proxy, subscriptionNodes: account.proxy.subscriptionNodes.map((node) => ({ ...node })) }, browser: { ...account.browser }, fingerprint: { ...account.fingerprint, languages: [...account.fingerprint.languages] } }); void window.workbench.proxy.runtimeStatus(account.id).then((result) => result.ok && setRuntimeState(result.data)); setModal('account'); }
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
      const count = Math.max(1, Math.min(MAX_STANDARD_ACCOUNT_CREATION, Math.trunc(Number(newAccountCount) || 1)));
      const platformName = platforms.find((item) => item.id === form.platform)?.name ?? form.platform;
      const baseName = form.name.trim() || `${platformName}账号`;
      const creatingSubscription = form.proxy.enabled && form.proxy.mode === 'subscription' && !form.proxy.subscriptionNodes.length;
      const created: Account[] = [];
      for (let index = 0; index < count; index += 1) {
        const name = count === 1 ? baseName : `${baseName} ${index + 1}`;
        const input = creatingSubscription ? { ...form, name, proxy: { ...form.proxy, enabled: false } } : { ...form, name };
        const saved = unwrap(await window.workbench.accounts.create(input));
        created.push(saved);
        if (creatingSubscription && form.proxy.subscriptionUrl) {
          setStatus(`正在为第 ${index + 1}/${count} 个账号导入订阅…`);
          unwrap(await window.workbench.proxy.importSubscription(saved.id, form.proxy.subscriptionUrl));
        }
      }
      setAccounts(unwrap(await window.workbench.accounts.list()));
      if (startAfterCreate && created.length) {
        const opened = unwrap(await window.workbench.browser.openMany(created.map((account) => account.id)));
        const tabs = [...new Set([...openTabs, ...opened.succeeded])];
        const next = opened.succeeded[0] ?? activeId ?? tabs[0] ?? null;
        const nextSecondary = settings?.dualView && secondaryId && tabs.includes(secondaryId) && secondaryId !== next ? secondaryId : null;
        setOpenTabs(tabs); setActiveId(next); setSecondaryId(nextSecondary);
        await window.workbench.browser.activate(next, nextSecondary);
        await persistTabs(tabs, next, nextSecondary, settings?.dualView ?? false);
        setStatus(`已添加 ${created.length} 个账号并打开 ${opened.succeeded.length} 个${opened.failed.length ? `，失败 ${opened.failed.length} 个` : ''}`);
      } else {
        setStatus(created.length === 1 ? `已添加账号 ${created[0]!.name}` : `已添加 ${created.length} 个账号`);
      }
      setModal(null);
    } catch (error) { report(error); } finally { setBusy(false); }
  }
  async function deleteAccount(account: Account): Promise<void> {
    if (!confirm(`确定删除“${account.name}”？该账号的登录会话、缓存和本地存储也会一并清理，且不可恢复。`)) return;
    unwrap(await window.workbench.accounts.remove(account.id));
    const nextAccounts = unwrap(await window.workbench.accounts.list());
    const tabs = openTabs.filter((id) => id !== account.id);
    const nextActive = activeId === account.id ? tabs.at(-1) ?? null : activeId;
    const nextSecondary = secondaryId === account.id ? null : secondaryId;
    setAccounts(nextAccounts); setOpenTabs(tabs); setActiveId(nextActive); setSecondaryId(nextSecondary);
    setVideoNoticeByAccount((current) => { if (!(account.id in current)) return current; const next = { ...current }; delete next[account.id]; return next; });
    await window.workbench.browser.activate(nextActive, nextSecondary); await persistTabs(tabs, nextActive, nextSecondary, settings?.dualView ?? false);
  }
  function dolaReference(resource: MediaResource): DolaResourceReference {
    return { url: resource.url || undefined, messageId: resource.messageId, conversationId: resource.conversationId, shareId: resource.shareId, shareUrl: resource.shareUrl, threadUrl: resource.threadUrl, vid: resource.vid, keySeed: resource.keySeed, fplayUrl: resource.fplayUrl, dolaRecordKey: resource.dolaRecordKey, dolaCardId: resource.dolaCardId, dolaVideoElementId: resource.dolaVideoElementId, title: resource.title };
  }
  async function resolveDolaResource(resource: MediaResource, downloadAfterResolve = false): Promise<void> {
    const account = accounts.find((item) => item.id === resource.accountId);
    if (account?.platform !== 'dola' || !hasDolaResourceLocator(resource)) return setStatus('该素材没有可用的 Dola 作品定位信息');
    try { unwrap(await window.workbench.browser.resolveDolaResource(resource.accountId, dolaReference(resource), downloadAfterResolve)); setStatus(downloadAfterResolve ? '已请求 Dola 页面解析并下载原始资源' : '已请求 Dola 页面解析原始资源'); } catch (error) { report(error); }
  }
  async function download(resource: MediaResource): Promise<void> { if (!resource.url) return resolveDolaResource(resource, true); try { const task = unwrap(await window.workbench.media.download(resource.id)); setStatus(`已加入下载队列：${task.title}`); } catch (error) { report(error); } }
  async function copyResourceUrl(resource: MediaResource): Promise<void> { if (!resource.url) return setStatus('当前素材还没有可复制的视频地址'); try { unwrap(await window.workbench.files.copyText(resource.url)); setStatus('素材链接已复制'); } catch (error) { report(error); } }
  async function openResourceUrl(resource: MediaResource): Promise<void> {
    if (!/^https?:\/\//i.test(resource.url)) return setStatus('当前素材不是可在系统浏览器打开的 HTTP/HTTPS 地址');
    try { unwrap(await window.workbench.files.openUrl(resource.url)); setStatus('已在系统浏览器打开素材链接'); } catch (error) { report(error); }
  }
  async function copyCandidateUrl(url: string): Promise<void> {
    try { unwrap(await window.workbench.files.copyText(url)); setStatus('候选地址已复制'); } catch (error) { report(error); }
  }
  async function openCandidateUrl(url: string): Promise<void> {
    if (!/^https?:\/\//i.test(url)) return setStatus('只有 HTTP/HTTPS 候选地址可以在系统浏览器打开');
    try { unwrap(await window.workbench.files.openUrl(url)); setStatus('已在系统浏览器打开候选地址'); } catch (error) { report(error); }
  }
  async function selectMediaCandidate(resource: MediaResource, url: string): Promise<void> {
    try {
      const updated = unwrap(await window.workbench.media.selectCandidate(resource.id, url));
      setResources((current) => current.map((item) => item.id === updated.id ? updated : item));
      setCandidateResource(updated);
      if (previewResource?.id === updated.id) { setPreviewResource(updated); setConvertedPreviewUrl(null); }
      setStatus('已将该候选地址设为首选，下载会按新顺序尝试');
    } catch (error) { report(error); }
  }
  async function downloadSelectedResources(): Promise<void> {
    const items = selectedMedia.map((id) => resources.find((resource) => resource.id === id)).filter((item): item is MediaResource => Boolean(item));
    const downloadable = items.filter((item) => Boolean(item.url));
    if (!items.length) return setStatus('请先选择素材');
    if (!downloadable.length) return setStatus('所选素材都还没有可下载地址，请先解析原始资源');
    try {
      const tasks = unwrap(await window.workbench.media.downloadMany(downloadable.map((item) => item.id)));
      const skipped = items.length - downloadable.length;
      setStatus(`已加入 ${tasks.length} 个下载任务${skipped ? `，跳过 ${skipped} 个待解析素材` : ''}`);
    } catch (error) { report(error); }
  }
  async function downloadManyResources(items: MediaResource[], label: string): Promise<void> {
    if (!items.length) return setStatus(`当前没有可下载的${label}`);
    const downloadable = items.filter((item) => Boolean(item.url));
    if (!downloadable.length) return setStatus(`当前${label}都还没有可下载地址，请先解析原始资源`);
    try {
      const tasks = unwrap(await window.workbench.media.downloadMany(downloadable.map((item) => item.id)));
      const skipped = items.length - downloadable.length;
      setStatus(`已加入 ${tasks.length} 个${label}下载任务${skipped ? `，跳过 ${skipped} 个待解析素材` : ''}`);
    } catch (error) { report(error); }
  }
  function openPreview(resource: MediaResource): void { setPreviewResource(resource); setConvertedPreviewUrl(null); }
  async function convertPreview(resource: MediaResource): Promise<void> { try { setConversionBusy(true); setStatus('正在准备兼容播放文件…'); const result = unwrap(await window.workbench.media.convertForPreview(resource.id)); setConvertedPreviewUrl(result.url); setStatus(result.cached ? '已切换到缓存的 MP4 预览' : 'MP4 预览转换完成'); } catch (error) { report(error); } finally { setConversionBusy(false); } }
  async function batchAccounts(action: 'open' | 'refresh' | 'close'): Promise<void> { if (!selectedAccounts.length) return setStatus('请先选择账号'); try { if (action === 'open') { const result = unwrap(await window.workbench.browser.openMany(selectedAccounts)); const tabs = [...new Set([...openTabs, ...result.succeeded])]; const next = activeId ?? tabs[0] ?? null; setOpenTabs(tabs); setActiveId(next); await window.workbench.browser.activate(next, secondaryId); await persistTabs(tabs, next, secondaryId, settings?.dualView ?? false); setStatus(`已打开 ${result.succeeded.length} 个账号${result.failed.length ? `，失败 ${result.failed.length} 个` : ''}`); } else if (action === 'refresh') { const opened = selectedAccounts.filter((id) => openTabs.includes(id)); if (!opened.length) return setStatus('所选账号尚未打开'); unwrap(await window.workbench.browser.refreshMany(opened)); setStatus('已批量刷新'); } else { unwrap(await window.workbench.browser.closeMany(selectedAccounts)); const tabs = openTabs.filter((id) => !selectedAccounts.includes(id)); setOpenTabs(tabs); setActiveId(tabs[0] ?? null); await window.workbench.browser.activate(tabs[0] ?? null, null); await persistTabs(tabs, tabs[0] ?? null, null, settings?.dualView ?? false); } } catch (error) { report(error); } }
  async function openFilteredAccounts(): Promise<void> {
    const ids = filteredAccounts.slice(0, 12).map((account) => account.id);
    if (!ids.length) return setStatus('当前筛选下没有账号可打开');
    try {
      setBusy(true);
      const result = unwrap(await window.workbench.browser.openMany(ids));
      const tabs = [...new Set([...openTabs, ...result.succeeded])];
      const next = activeId && tabs.includes(activeId) ? activeId : tabs[0] ?? null;
      const nextSecondary = settings?.dualView && secondaryId && tabs.includes(secondaryId) && secondaryId !== next ? secondaryId : null;
      setOpenTabs(tabs); setActiveId(next); setSecondaryId(nextSecondary);
      await window.workbench.browser.activate(next, nextSecondary);
      await persistTabs(tabs, next, nextSecondary, settings?.dualView ?? false);
      setStatus(`已打开 ${result.succeeded.length} 个筛选账号${result.failed.length ? `，失败 ${result.failed.length} 个` : ''}${filteredAccounts.length > ids.length ? '（最多 12 个）' : ''}`);
    } catch (error) { report(error); } finally { setBusy(false); }
  }
  async function refreshOpenTabs(): Promise<void> {
    if (!openTabs.length) return setStatus('当前没有已打开的账号');
    try { setBusy(true); unwrap(await window.workbench.browser.refreshMany(openTabs)); setStatus(`已刷新 ${openTabs.length} 个已打开页面`); } catch (error) { report(error); } finally { setBusy(false); }
  }
  async function repairActivePage(): Promise<void> {
    if (!activeId) return setStatus('请先打开一个账号');
    try {
      setBusy(true);
      setStatus('正在重建当前账号页面并恢复隔离配置…');
      unwrap(await window.workbench.browser.reconfigure(activeId));
      await window.workbench.browser.activate(activeId, secondaryId);
      setStatus('当前页面已重建；账号数据不会被删除');
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  async function closeAllOpenTabs(): Promise<void> {
    if (!openTabs.length) return setStatus('当前没有已打开的账号');
    if (!confirm(`确定关闭全部 ${openTabs.length} 个浏览器实例？账号数据不会删除。`)) return;
    try {
      setBusy(true);
      unwrap(await window.workbench.browser.closeMany(openTabs));
      setOpenTabs([]); setActiveId(null); setSecondaryId(null);
      await window.workbench.browser.activate(null, null);
      await persistTabs([], null, null, settings?.dualView ?? false);
      setStatus(`已关闭全部 ${openTabs.length} 个浏览器实例`);
    } catch (error) { report(error); } finally { setBusy(false); }
  }
  async function openDownloadDir(): Promise<void> {
    try { unwrap(await window.workbench.files.openDownloadDir()); setStatus('已打开下载目录'); } catch (error) { report(error); }
  }
  async function openVideoDownloadDir(): Promise<void> {
    try { unwrap(await window.workbench.files.openVideoDownloadDir()); setStatus('已打开视频目录'); } catch (error) { report(error); }
  }
  async function batchAssignGroup(): Promise<void> { if (!selectedAccounts.length) return setStatus('请先选择账号'); const group = prompt('移动到分组（留空表示未分组）', groupFilter); if (group == null) return; setAccounts(unwrap(await window.workbench.accounts.bulkUpdate(selectedAccounts, { group }))); setStatus(`已更新 ${selectedAccounts.length} 个账号的分组`); }
  async function deleteSelectedAccounts(): Promise<void> { if (!selectedAccounts.length) return setStatus('请先选择账号'); if (!confirm(`确定删除所选 ${selectedAccounts.length} 个账号？对应登录会话、缓存和本地存储也会一并清理，且不可恢复。`)) return; const deletedIds = [...selectedAccounts]; unwrap(await window.workbench.accounts.removeMany(deletedIds)); const tabs = openTabs.filter((id) => !deletedIds.includes(id)); setAccounts(unwrap(await window.workbench.accounts.list())); setSelectedAccounts([]); setVideoNoticeByAccount((current) => { const next = { ...current }; deletedIds.forEach((id) => delete next[id]); return next; }); setOpenTabs(tabs); setActiveId(tabs[0] ?? null); await window.workbench.browser.activate(tabs[0] ?? null, null); await persistTabs(tabs, tabs[0] ?? null, null, settings?.dualView ?? false); }
  async function deleteAllAccounts(): Promise<void> {
    if (!accounts.length) return setStatus('当前没有账号');
    const total = accounts.length;
    if (!confirm(`确定删除全部 ${total} 个账号及其登录会话、缓存和本地存储吗？该操作不可恢复。`)) return;
    try {
      setBusy(true);
      unwrap(await window.workbench.accounts.removeMany(accounts.map((account) => account.id)));
      setAccounts([]); setSelectedAccounts([]); setVideoNoticeByAccount({}); setOpenTabs([]); setActiveId(null); setSecondaryId(null); setAddress('');
      await window.workbench.browser.activate(null, null);
      await persistTabs([], null, null, settings?.dualView ?? false);
      setStatus(`已删除全部 ${total} 个账号`);
    } catch (error) { report(error); } finally { setBusy(false); }
  }
  async function deleteGroupAccounts(): Promise<void> { if (!groupFilter) return setStatus('请先选择分组'); const ids = accounts.filter((account) => account.group === groupFilter).map((account) => account.id); if (!ids.length) return setStatus('当前分组没有账号'); if (!confirm(`确定删除分组“${groupFilter}”下的 ${ids.length} 个账号？对应登录会话、缓存和本地存储也会一并清理，且不可恢复。`)) return; unwrap(await window.workbench.accounts.removeMany(ids)); const tabs = openTabs.filter((id) => !ids.includes(id)); const next = tabs[0] ?? null; setAccounts(unwrap(await window.workbench.accounts.list())); setSelectedAccounts((current) => current.filter((id) => !ids.includes(id))); setVideoNoticeByAccount((current) => { const next = { ...current }; ids.forEach((id) => delete next[id]); return next; }); setOpenTabs(tabs); setActiveId(next); setSecondaryId(null); setGroupFilter(''); await window.workbench.browser.activate(next, null); await persistTabs(tabs, next, null, settings?.dualView ?? false); setStatus(`已删除分组“${groupFilter}”下 ${ids.length} 个账号`); }
  async function deletePlatformAccounts(): Promise<void> { if (!platformFilter) return setStatus('请先选择平台'); const ids = accounts.filter((account) => account.platform === platformFilter).map((account) => account.id); const platformName = platforms.find((platform) => platform.id === platformFilter)?.name ?? platformFilter; if (!ids.length) return setStatus(`“${platformName}”分类下没有账号`); if (!confirm(`确定删除“${platformName}”分类下的 ${ids.length} 个账号？对应登录会话、缓存和本地存储也会一并清理，且不可恢复。`)) return; unwrap(await window.workbench.accounts.removeMany(ids)); const tabs = openTabs.filter((id) => !ids.includes(id)); const next = tabs[0] ?? null; setAccounts(unwrap(await window.workbench.accounts.list())); setSelectedAccounts((current) => current.filter((id) => !ids.includes(id))); setVideoNoticeByAccount((current) => { const next = { ...current }; ids.forEach((id) => delete next[id]); return next; }); setOpenTabs(tabs); setActiveId(next); setSecondaryId(null); setPlatformFilter(''); await window.workbench.browser.activate(next, null); await persistTabs(tabs, next, null, settings?.dualView ?? false); setStatus(`已删除“${platformName}”分类下 ${ids.length} 个账号`); }
  async function applyBulkProxy(): Promise<void> { try { setBusy(true); setAccounts(unwrap(await window.workbench.accounts.bulkUpdate(selectedAccounts, { proxy: bulkProxy }))); for (const id of selectedAccounts.filter((id) => openTabs.includes(id))) unwrap(await window.workbench.browser.applyProxy(id)); setModal(null); setStatus(`已为 ${selectedAccounts.length} 个账号应用代理`); } catch (error) { report(error); } finally { setBusy(false); } }
  async function manageGroup(kind: 'rename' | 'remove'): Promise<void> { if (!groupFilter) return setStatus('请先选择分组'); if (kind === 'rename') { const name = prompt('新的分组名称', groupFilter); if (name == null || name === groupFilter) return; setAccounts(unwrap(await window.workbench.accounts.renameGroup(groupFilter, name))); setGroupFilter(name); } else if (confirm(`移除分组“${groupFilter}”？账号会移动到未分组。`)) { setAccounts(unwrap(await window.workbench.accounts.removeGroup(groupFilter))); setGroupFilter(''); } }
  async function clearAccountSession(kind: SessionDataKind): Promise<void> {
    if (!editingId) return;
    const label = kind === 'cookies' ? 'Cookie' : kind === 'cache' ? '缓存' : kind === 'storage' ? 'LocalStorage / IndexedDB / 扩展存储' : '全部会话数据';
    if (!confirm(`将清理当前账号的${label}，可能需要重新登录，是否继续？`)) return;
    try {
      setBusy(true);
      unwrap(await window.workbench.browser.clearSession(editingId, kind));
      setStatus(`账号${label}已清理`);
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  async function testAccountProxy(): Promise<void> { if (!editingId) return; const result = unwrap(await window.workbench.browser.testProxy(editingId)); const runtime = unwrap(await window.workbench.proxy.runtimeStatus(editingId)); setRuntimeState(runtime); setStatus(`${result.message} · ${result.latencyMs}ms${result.ip ? ` · ${result.ip}` : ''}`); }
  async function importFormSubscription(): Promise<void> {
    if (!editingId) return setStatus('请先保存账号，再导入订阅');
    if (!form.proxy.subscriptionUrl) return setStatus('请先填写订阅地址');
    try {
      setBusy(true);
      const profile = unwrap(await window.workbench.proxy.importSubscription(editingId, form.proxy.subscriptionUrl));
      const first = profile.nodes[0];
      setForm((current) => ({ ...current, proxy: { ...current.proxy, enabled: true, mode: 'subscription', type: 'socks5', subscriptionConfigJson: profile.configJson, subscriptionNodes: profile.nodes, selectedNodeName: first?.name ?? '', selectedNodeTag: first?.tag ?? '', lastRuntimeError: '' } }));
      setAccounts(unwrap(await window.workbench.accounts.list()));
      setStatus(`订阅已导入：${profile.nodes.length} 个节点${profile.skippedNodeCount ? `，跳过 ${profile.skippedNodeCount} 个` : ''}`);
    } catch (error) { report(error); } finally { setBusy(false); }
  }
  async function refreshFormSubscription(): Promise<void> {
    if (!editingId) return importFormSubscription();
    try {
      setBusy(true);
      const profile = unwrap(await window.workbench.proxy.refreshSubscription(editingId));
      const currentTag = form.proxy.selectedNodeTag; const selected = profile.nodes.find((node) => node.tag === currentTag) ?? profile.nodes[0];
      setForm((current) => ({ ...current, proxy: { ...current.proxy, subscriptionConfigJson: profile.configJson, subscriptionNodes: profile.nodes, selectedNodeName: selected?.name ?? '', selectedNodeTag: selected?.tag ?? '', lastRuntimeError: '' } }));
      setAccounts(unwrap(await window.workbench.accounts.list()));
      setStatus(`订阅已刷新：${profile.nodes.length} 个节点`);
    } catch (error) { report(error); } finally { setBusy(false); }
  }
  async function selectFormNode(tag: string): Promise<void> {
    const node = form.proxy.subscriptionNodes.find((item) => item.tag === tag); if (!node) return;
    setForm((current) => ({ ...current, proxy: { ...current.proxy, selectedNodeTag: node.tag, selectedNodeName: node.name, lastRuntimeError: '' } }));
    if (!editingId) return;
    try { const state = unwrap(await window.workbench.proxy.selectNode(editingId, tag)); setRuntimeState(state); setAccounts(unwrap(await window.workbench.accounts.list())); setStatus(`已切换节点：${node.name}`); } catch (error) { report(error); }
  }
  async function testFormNode(tag?: string): Promise<void> {
    if (!editingId) return setStatus('请先保存账号，再测试节点');
    try { const result = unwrap(await window.workbench.proxy.testNode(editingId, tag)); setRuntimeState(unwrap(await window.workbench.proxy.runtimeStatus(editingId))); setStatus(`${result.message} · ${result.latencyMs}ms${result.ip ? ` · ${result.ip}` : ''}`); } catch (error) { report(error); }
  }
  async function testAllFormNodes(): Promise<void> {
    if (!editingId) return setStatus('请先保存账号，再测试全部节点');
    try {
      setBusy(true);
      const result = unwrap(await window.workbench.proxy.testAllNodes(editingId));
      setForm((current) => ({ ...current, proxy: { ...current.proxy, subscriptionNodes: result.nodes } }));
      setAccounts(unwrap(await window.workbench.accounts.list()));
      setRuntimeState(unwrap(await window.workbench.proxy.runtimeStatus(editingId)));
      setStatus(`${result.message}；节点延迟和出口 IP 已更新`);
    } catch (error) { report(error); } finally { setBusy(false); }
  }
  async function regenerateFormFingerprint(): Promise<void> {
    if (!editingId) return setStatus('保存账号后才能重新生成指纹');
    try { const profile = unwrap(await window.workbench.fingerprint.regenerate(editingId)); setForm((current) => ({ ...current, fingerprint: profile })); setAccounts(unwrap(await window.workbench.accounts.list())); setStatus('已重新生成账号指纹，页面将刷新'); } catch (error) { report(error); }
  }
  async function resetFormFingerprint(): Promise<void> {
    // No account saved yet, so there is nothing to reset server-side - clear back to the schema
    // default rather than hand-writing `enabled: false` here, which is how this line used to drift
    // from contracts.ts. The service-side `reset` keeps the user's enable state instead.
    if (!editingId) {
      const fallback = fingerprintSchema.parse({});
      return setForm((current) => ({ ...current, fingerprint: { ...fallback, languages: [...fallback.languages] } }));
    }
    try { const profile = unwrap(await window.workbench.fingerprint.reset(editingId)); setForm((current) => ({ ...current, fingerprint: profile })); setAccounts(unwrap(await window.workbench.accounts.list())); setStatus('已恢复默认浏览器指纹，页面将刷新'); } catch (error) { report(error); }
  }
  async function refreshAccountsAfterMigration(): Promise<void> { setAccounts(unwrap(await window.workbench.accounts.list())); setSettings(unwrap(await window.workbench.settings.get())); }
  async function adjustZoom(delta: number): Promise<void> {
    if (!activeId) return;
    const current = accounts.find((account) => account.id === activeId)?.browser.zoomFactor ?? 1;
    try { const value = unwrap(await window.workbench.browser.setZoom(activeId, Math.round((current + delta) * 4) / 4)); setAccounts((currentAccounts) => currentAccounts.map((account) => account.id === activeId ? { ...account, browser: { ...account.browser, zoomFactor: value } } : account)); setStatus(`页面缩放：${Math.round(value * 100)}%`); } catch (error) { report(error); }
  }
  async function reorderAccount(draggedId: string, targetId: string, side: 'before' | 'after' = 'before'): Promise<void> { if (draggedId === targetId) return; const ids = moveAccountIds(accounts.map((account) => account.id), draggedId, targetId, side); setAccounts(unwrap(await window.workbench.accounts.reorder(ids))); }

  return <div className="app-shell">
    <header className="topbar" aria-label="AI 创作工作台">
      <div className="brand"><div className="brand-mark">AI</div><div><strong>AI创作工作台</strong><span>多账号创作与素材中心</span></div></div>
      <div className="top-actions">
        <div className="toolbar-cluster toolbar-primary">
          <button title="后退（Alt+←）" aria-label="后退" onClick={() => activeId && window.workbench.browser.back(activeId)} disabled={!activeId}><Icon name="arrow-left" /><span className="button-label">后退</span></button>
          <button title="前进（Alt+→）" aria-label="前进" onClick={() => activeId && window.workbench.browser.forward(activeId)} disabled={!activeId}><Icon name="arrow-right" /><span className="button-label">前进</span></button>
          <button title="刷新当前页面" aria-label="刷新页面" onClick={() => activeId && window.workbench.browser.refresh(activeId)} disabled={!activeId}><Icon name="refresh" /><span className="button-label">刷新页面</span></button>
          <button title="并排查看两个账号页面" aria-label="双窗口" aria-pressed={settings?.dualView ?? false} onClick={toggleDual} className={settings?.dualView ? 'active' : ''}><Icon name="columns" /><span className="button-label">双窗口</span></button>
        </div>
        <div className="toolbar-cluster toolbar-utilities">
           <button title="切换右侧素材流面板" aria-pressed={settings?.resourcesCollapsed ?? false} onClick={() => settings && void window.workbench.settings.update({ resourcesCollapsed: !settings.resourcesCollapsed }).then(unwrap).then(setSettings)} className={`toolbar-media-toggle ${settings?.resourcesCollapsed ? 'active' : ''}`}><Icon name="panel-right" /><span className="button-label">{settings?.resourcesCollapsed ? '显示素材栏' : '隐藏素材栏'}</span></button>
           <button className="toolbar-library" title="浏览已下载素材和文件" onClick={() => setModal('library')}><Icon name="library" /><span className="button-label">素材库</span></button>
          <div className="toolbar-more">
            <button className={`toolbar-more-trigger ${toolsMenuOpen ? 'active' : ''}`} aria-expanded={toolsMenuOpen} aria-haspopup="menu" onClick={() => setToolsMenuOpen((current) => !current)}><Icon name="more" /><span className="button-label">更多工具</span><Icon name="chevron-down" size={13} /></button>
            {toolsMenuOpen && <div className="toolbar-menu" role="menu">
          <button role="menuitem" title="重建当前账号的 WebContentsView、页面脚本和代理绑定；不删除账号数据" onClick={() => void repairActivePage()} disabled={!activeId || busy}>修复页面</button>
          <button role="menuitem" title="页面缩放 -25%" aria-label="缩小页面" onClick={() => void adjustZoom(-0.25)} disabled={!activeId}>缩小</button>
          <button role="menuitem" title="页面缩放 +25%" aria-label="放大页面" onClick={() => void adjustZoom(0.25)} disabled={!activeId}>放大</button>
           <button role="menuitem" title={activeId ? '打开当前账号的登录辅助' : '请先打开一个账号'} onClick={() => { setToolsMenuOpen(false); if (activeId) setModal('login'); }} disabled={!activeId}>登录辅助</button>
               <button role="menuitem" onClick={() => { setToolsMenuOpen(false); setModal('help'); }}>使用指南与快捷键</button>
               {activeAccount?.platform === 'doubao' && <>
                <button role="menuitem" onClick={() => { setToolsMenuOpen(false); void sendDoubao15sPrompt(); }}>豆包 15s 增强</button>
                <button role="menuitem" onClick={() => { setToolsMenuOpen(false); void setDoubaoDuration(15); }}>豆包 15s 设置</button>
                <button role="menuitem" onClick={() => { setToolsMenuOpen(false); void setDoubaoDuration(30); }}>豆包 30s 设置</button>
                <button role="menuitem" onClick={() => { setToolsMenuOpen(false); void startDoubaoCreationScan(); }}>豆包原视频</button>
              </>}
              {activeAccount?.platform === 'jimeng' && <button role="menuitem" onClick={() => { setToolsMenuOpen(false); void startJimengOriginal(); }}>即梦原图</button>}
              <button role="menuitem" onClick={() => { setToolsMenuOpen(false); setModal('dola'); }}>Dola 批量登录</button>
              <button role="menuitem" onClick={() => { setToolsMenuOpen(false); setModal('higgsfield'); }}>Higgsfield 批量登录</button>
              <button role="menuitem" onClick={() => { setToolsMenuOpen(false); setModal('faceGrid'); }}>人脸网格</button>
              <button role="menuitem" onClick={() => { setToolsMenuOpen(false); setModal('migration'); }}>迁移 V4.4</button>
              <button role="menuitem" onClick={() => { setToolsMenuOpen(false); setModal('diagnostics'); }}>诊断</button>
              <button role="menuitem" onClick={() => { setToolsMenuOpen(false); void openAuthorShop(); }}>作者店铺</button>
            </div>}
          </div>
           <button className="toolbar-settings" title="工作台、下载、快捷键和平台设置" onClick={() => setModal('settings')}><Icon name="settings" /><span className="button-label">设置</span></button>
        </div>
      </div>
    </header>
    <main ref={workspaceRef} className={`workspace ${settings?.resourcesCollapsed ? 'resources-collapsed' : ''}`}>
      <aside className="sidebar accounts-panel">
        <div className="panel-title"><div><span className="eyebrow">ACCOUNTS</span><h2>账号空间</h2></div><button className="icon-button primary" aria-label="添加账号" title="添加账号" onClick={newAccount}><Icon name="plus" /></button></div>
          <div className="search-box"><input ref={searchRef} className="search" aria-label="搜索账号、分组或备注" placeholder="搜索账号、分组或备注" value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>{isWindowsPlatform() ? 'Ctrl' : '⌘'} K</kbd></div>
        <button className="account-tools-toggle" onClick={toggleAccountTools} aria-expanded={!accountToolsCollapsed} aria-controls="account-tools-panel"><span><Icon name="settings" size={14} />筛选与批量管理</span><Icon name={accountToolsCollapsed ? 'chevron-right' : 'chevron-down'} size={14} /></button>
        {!accountToolsCollapsed && <div id="account-tools-panel" className="account-tools-panel">
          <div className="group-toolbar"><select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="">全部分组</option>{groups.map((group) => <option key={group}>{group}</option>)}</select><select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value as PlatformId | '')}><option value="">全部平台</option>{platforms.map((platform) => <option value={platform.id} key={platform.id}>{platform.name}</option>)}</select><button disabled={!groupFilter} onClick={() => manageGroup('rename')}>重命名</button><button disabled={!groupFilter} onClick={() => manageGroup('remove')}>移除</button><button className="danger" disabled={!groupFilter} onClick={() => void deleteGroupAccounts()}>删分组账号</button><button className="danger" disabled={!platformFilter} onClick={() => void deletePlatformAccounts()}>删平台账号</button></div>
          <div className="account-actions"><button onClick={() => window.workbench.accounts.import().then(() => window.workbench.accounts.list()).then(unwrap).then(setAccounts).catch(report)}>导入</button><button onClick={() => window.workbench.accounts.export().then(unwrap).then((x) => setStatus(`已导出：${x.path}`)).catch(report)}>导出</button></div>
          <div className="account-actions account-quick-actions"><button disabled={busy} onClick={() => void openFilteredAccounts()}>打开筛选</button><button disabled={busy} onClick={() => void refreshOpenTabs()}>刷新已开</button><button disabled={busy} onClick={() => void closeAllOpenTabs()}>关闭全部</button><button className="danger" disabled={busy || !accounts.length} onClick={() => void deleteAllAccounts()}>删除全部</button><button onClick={() => void openDownloadDir()}>下载目录</button></div>
          <div className="batch-toolbar"><button onClick={() => setSelectedAccounts(selectedAccounts.length === filteredAccounts.length && filteredAccounts.length > 0 ? [] : filteredAccounts.map((item) => item.id))}>{selectedAccounts.length ? '取消选择' : '全选'}</button><button onClick={() => batchAccounts('open')}>打开</button><button onClick={() => batchAccounts('refresh')}>刷新</button><button onClick={() => batchAccounts('close')}>关闭</button><button onClick={batchAssignGroup}>分组</button><button onClick={() => selectedAccounts.length ? (setBulkProxy({ ...emptyProxy }), setModal('bulkProxy')) : setStatus('请先选择账号')}>代理</button><button onClick={deleteSelectedAccounts}>删除</button></div>
        </div>}
        <div className="account-list">{groupedAccounts.length ? groupedAccounts.map((group) => <section className="account-group" key={group.name}><button className="account-group-header" aria-expanded={!collapsedGroups.includes(group.name)} onClick={() => setCollapsedGroups((current) => current.includes(group.name) ? current.filter((name) => name !== group.name) : [...current, group.name])}><span><Icon name={collapsedGroups.includes(group.name) ? 'chevron-right' : 'chevron-down'} size={13} />{group.name}</span><small>{group.accounts.length}</small></button>{!collapsedGroups.includes(group.name) && group.accounts.map((account) => { const noticeCount = videoNoticeByAccount[account.id] ?? 0; return <div key={account.id} draggable onDragStart={(event) => event.dataTransfer.setData('text/account-id', account.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); const side = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before'; void reorderAccount(event.dataTransfer.getData('text/account-id'), account.id, side); }} className={`account-card ${activeId === account.id ? 'selected' : ''} ${openTabs.includes(account.id) ? 'open' : ''} ${noticeCount ? 'has-video-notice' : ''}`} onDoubleClick={() => editAccount(account)}>
          <input className="account-check" type="checkbox" checked={selectedAccounts.includes(account.id)} onChange={(event) => setSelectedAccounts(event.target.checked ? [...selectedAccounts, account.id] : selectedAccounts.filter((id) => id !== account.id))} />
          <button className="account-main" aria-label={`打开账号 ${account.name}`} title={openTabs.includes(account.id) ? `切换到 ${account.name}` : `打开 ${account.name}`} onClick={() => openAccount(account.id)}><span className={`platform-dot ${account.platform}`}>{platforms.find((p) => p.id === account.platform)?.name.slice(0, 1)}</span><span><strong>{account.name}</strong><small>{account.group || platforms.find((p) => p.id === account.platform)?.name}{openTabs.includes(account.id) ? ' · 已打开' : ''}{account.proxy.enabled ? ' · 代理' : ''}{noticeCount > 0 && <em className="account-video-notice" title="有新视频">{noticeCount > 9 ? '9+' : noticeCount} 新视频</em>}</small></span></button>
          <div className="card-menu"><button aria-label={`在系统浏览器打开 ${account.name}`} title="在系统 Chrome/Edge 打开并带入当前登录态" onClick={(event) => { event.stopPropagation(); void openExternalBrowser(account); }}><Icon name="external" size={14} /></button><button aria-label={`编辑账号 ${account.name}`} title="编辑账号" onClick={() => editAccount(account)}><Icon name="settings" size={14} /></button><button aria-label={`删除账号 ${account.name}`} title="删除账号" onClick={() => deleteAccount(account)}><Icon name="trash" size={14} /></button></div>
        </div>; })}</section>) : <div className="account-empty"><span aria-hidden="true">⌕</span><strong>{accounts.length ? '没有匹配账号' : '还没有账号'}</strong><p>{accounts.length ? '试试清除搜索条件或切换分组、平台筛选。' : '添加第一个账号后，就可以在独立 Session 中开始创作。'}</p>{accounts.length ? <button onClick={() => { setSearch(''); setGroupFilter(''); setPlatformFilter(''); }}>清除筛选</button> : <button className="primary" onClick={newAccount}>添加账号</button>}</div>}</div>
        <div className="panel-footer"><span>{filteredAccounts.length}/{accounts.length} 个账号</span><span>{openTabs.length} 个已打开</span></div>
      </aside>
      <section className="browser-panel">
         <div className="tabs">
           <div className="tab-scroll" role="tablist" aria-label="已打开的账号">
             {openTabs.map((id) => {
               const noticeCount = videoNoticeByAccount[id] ?? 0;
               // .tab is a wrapper, not the widget: the close control has to be a sibling of the
               // selectable tab rather than a descendant, because role="tab" makes its children
               // presentational and a <button> inside a <button> is invalid HTML. The tab itself
               // stays a real <button>, so Enter/Space and the drag/context-menu handlers are free.
               return <div
                 key={id}
                 className={`tab ${activeId === id ? 'active' : ''} ${noticeCount ? 'has-video-notice' : ''}`}
                 draggable
                 onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/account-id', id); }}
                 onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
                 onDrop={(event) => { event.preventDefault(); const draggedId = event.dataTransfer.getData('text/account-id'); const rect = event.currentTarget.getBoundingClientRect(); const side = event.clientX > rect.left + rect.width / 2 ? 'after' : 'before'; reorderOpenTabs(draggedId, id, side); }}
                 onContextMenu={(event) => { event.preventDefault(); const width = 216; const height = 92; setTabMenu({ id, x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)) }); }}
               >
                 <button type="button" role="tab" aria-selected={activeId === id} className="tab-select" onClick={() => void selectTab(id)}>
                   <span className="tab-label"><span className="tab-platform">{platforms.find((p) => p.id === accounts.find((a) => a.id === id)?.platform)?.name.slice(0, 1)}</span><span className="tab-label-text">{accountName(id)}</span>{noticeCount > 0 && <em className="tab-video-dot" title="有新视频">●</em>}</span>
                 </button>
                 <button type="button" className="tab-close" aria-label={`关闭 ${accountName(id)}`} title={`关闭 ${accountName(id)}`} onClick={() => void closeTab(id)}><Icon name="close" size={13} /></button>
               </div>;
             })}
           </div>
           <span className="tab-count">{openTabs.length} 个标签</span>
           <span className={`connection-state ${busy ? 'busy' : connection.tone}`} title={connection.detail || connection.label} aria-live="polite"><i className={`connection-dot ${busy ? 'busy' : connection.tone}`} aria-hidden="true" />{busy ? '处理中' : connection.label}</span>
         </div>
         {tabMenu && <div className="tab-context-menu" role="menu" style={{ left: tabMenu.x, top: tabMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
           <button role="menuitem" onClick={() => { setTabMenu(null); void selectTab(tabMenu.id); }}><Icon name="preview" size={14} />切换到此标签</button>
           <button role="menuitem" onClick={() => void closeOtherTabs(tabMenu.id)}><Icon name="close" size={14} />关闭其他标签</button>
           <button role="menuitem" onClick={() => { setTabMenu(null); void closeTab(tabMenu.id); }}><Icon name="trash" size={14} />关闭此标签</button>
         </div>}
         <div className="addressbar"><span className="address-lock" title="账号浏览器页面" aria-hidden="true"><Icon name="link" size={15} /></span><input aria-label="网页地址" value={address} onChange={(event) => setAddress(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void navigateActive(); }} placeholder={activeId ? '输入 HTTP/HTTPS 地址并回车' : '打开账号后可输入网页地址'} disabled={!activeId} /><button title="打开当前地址" onClick={() => void navigateActive()} disabled={!activeId || !address.trim()}><Icon name="arrow-right" size={14} /><span className="button-label">打开</span></button></div>
        <div className={`view-grid ${settings?.dualView ? 'dual' : ''}`}>
          <div ref={primaryRef} className="view-slot">{!activeId && <EmptyState onAdd={newAccount} />}</div>
          {settings?.dualView && <div ref={secondaryRef} className="view-slot secondary"><select value={secondaryId ?? ''} onChange={(event) => { const id = event.target.value || null; setSecondaryId(id); void window.workbench.browser.activate(activeId, id); }}><option value="">选择第二账号</option>{openTabs.filter((id) => id !== activeId).map((id) => <option key={id} value={id}>{accountName(id)}</option>)}</select></div>}
        </div>
        <div className="statusbar" aria-live="polite"><span className="status-dot" /><span className="statusbar-label">工作台</span><span className="statusbar-message">{status}</span></div>
      </section>
      <aside className="sidebar media-panel">
        <div className="panel-title media-panel-title"><div><span className="eyebrow">CAPTURED</span><h2>下载区</h2></div><div className="media-panel-metrics"><span className="count-badge" title="当前筛选素材数量">{filteredMedia.length}</span>{tasks.some((task) => ['queued', 'running', 'failed'].includes(task.status)) && <span className="queue-badge" title="当前下载队列任务数">{tasks.filter((task) => ['queued', 'running', 'failed'].includes(task.status)).length}</span>}</div></div>
        <div className="capture-setting"><div><strong>图片解析</strong><small>{settings?.parseImages ? '解析视频与图片' : '仅解析视频'}</small></div><button className="capture-switch" role="switch" aria-label="图片解析" aria-checked={settings?.parseImages ?? false} disabled={!settings} onClick={() => settings && void window.workbench.settings.update({ parseImages: !settings.parseImages }).then(unwrap).then(setSettings).catch(report)}><span /></button></div>
         <div className="segmented" title="仅筛选已捕获素材，不改变解析设置" role="group" aria-label="素材类型筛选">{(['all','image','video'] as const).map((type) => <button key={type} className={mediaType === type ? 'active' : ''} aria-pressed={mediaType === type} onClick={() => void changeCaptureMode(type)}>{type === 'all' ? '全部' : type === 'image' ? '图片' : '视频'}</button>)}</div>
         <div className="media-batch"><button disabled={!selectedMedia.length} onClick={() => void downloadSelectedResources()}>下载所选</button><button onClick={() => void downloadManyResources(resources.filter((item) => item.type === 'image'), '图片')}>下载全部图片</button><button onClick={() => void downloadManyResources(resources.filter((item) => item.type === 'video'), '视频')}>下载全部视频</button><button aria-pressed={selectedMedia.length === filteredMedia.length && filteredMedia.length > 0} onClick={() => setSelectedMedia(selectedMedia.length === filteredMedia.length && filteredMedia.length > 0 ? [] : filteredMedia.map((item) => item.id))}>{selectedMedia.length === filteredMedia.length && filteredMedia.length > 0 ? '取消全选' : '全选'}</button></div>
        <div className="media-list">{filteredMedia.length ? filteredMedia.map((resource) => <article className={`media-card ${resource.type}`} key={resource.id}>
          <input type="checkbox" aria-label={`选择素材 ${resource.title || resource.id}`} checked={selectedMedia.includes(resource.id)} onChange={(event) => setSelectedMedia(event.target.checked ? [...selectedMedia, resource.id] : selectedMedia.filter((id) => id !== resource.id))} />
           <div className={`media-preview ${resource.type}`} role="button" tabIndex={0} onClick={() => resource.url || resource.previewUrl ? openPreview(resource) : setStatus('该素材还没有可预览地址，请先解析原始资源')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (resource.url || resource.previewUrl) openPreview(resource); } }} aria-label={resource.url || resource.previewUrl ? `预览 ${resource.title || '素材'}` : '素材地址待解析'} title={resource.url || resource.previewUrl ? '点击预览' : '等待解析地址'}>{mediaPreviewKind(resource) === 'video' ? <video muted playsInline preload="metadata" poster={resource.previewThumbUrl || resource.thumbUrl || undefined} src={resource.previewUrl || resource.url || undefined} /> : mediaPreviewKind(resource) === 'image' ? <img src={resource.previewThumbUrl || resource.thumbUrl || resource.previewUrl || resource.url} alt={resource.title || '图片素材'} /> : <span>{resource.type === 'video' ? '▶' : '▧'}</span>}<span className="preview-hint">{resource.url || resource.previewUrl ? '预览' : '待解析'}</span></div>
          <div className="media-info"><strong>{resource.title || (resource.type === 'image' ? '图片素材' : '视频素材')}</strong><small>{accountName(resource.accountId)} · {resource.source}{resource.confirmedNoWatermark ? ' · 原始/无水印' : ''}{mediaCandidateCount(resource) > 1 ? ` · 候选 ${mediaCandidateCount(resource)} 条` : ''}{!resource.url ? ' · 等待原始地址' : ''}{resource.expiresAt && new Date(resource.expiresAt) <= new Date() ? ' · 链接已过期，请刷新页面重新捕获' : ''}</small><div className="media-card-actions">{!resource.url && hasDolaResourceLocator(resource) ? <button className="media-download-main" onClick={(event) => { event.stopPropagation(); void download(resource); }}>解析并下载</button> : <button className="media-download-main" disabled={!resource.url} onClick={(event) => { event.stopPropagation(); void download(resource); }}>下载</button>}{resource.type === 'video' && resource.url && <button className="media-preview-action" onClick={(event) => { event.stopPropagation(); openPreview(resource); }}>预览视频</button>}{resource.type === 'video' && resource.url && [1, 2, 3].map((channel) => <button className={`media-channel channel-${channel}`} key={channel} onClick={(event) => { event.stopPropagation(); void download(resource); }}>{channel}渠道下载 · {((resource.url.split('?')[0] || '').match(/\.([a-z0-9]+)$/i)?.[1] || 'mp4').toUpperCase()}</button>)}{resource.url && <button onClick={(event) => { event.stopPropagation(); void openResourceUrl(resource); }}>打开链接</button>}{resource.url && <button onClick={(event) => { event.stopPropagation(); void copyResourceUrl(resource); }}>复制链接</button>}{mediaCandidateCount(resource) > 1 && <button onClick={(event) => { event.stopPropagation(); setCandidateResource(resource); }}>候选地址 {mediaCandidateCount(resource)}</button>}{hasDolaResourceLocator(resource) && <button onClick={(event) => { event.stopPropagation(); void resolveDolaResource(resource); }}>解析原始</button>}</div></div>
        </article>) : <div className="empty-list"><span>◇</span><strong>等待素材</strong><p>运行期间捕获到的创作结果会出现在这里，网页图标、封面和普通资源会自动过滤。</p></div>}</div>
        {tasks.some((task) => ['queued','running','failed'].includes(task.status)) && <div className="task-queue-header"><span>下载队列</span><small>{tasks.filter((task) => ['queued','running','failed'].includes(task.status)).length} 个任务</small></div>}
        <div className="download-tasks">{tasks.filter((task) => ['queued','running','failed'].includes(task.status)).slice(0, 4).map((task) => <div key={task.id}><span title={task.title}>{task.title}</span><small>{task.status === 'running' ? `${task.progress ?? '…'}%` : task.status === 'failed' ? task.error : '排队中'}</small>{['queued','running'].includes(task.status) ? <button aria-label={`取消 ${task.title}`} title="取消任务" onClick={() => window.workbench.media.cancel(task.id)}>×</button> : <button aria-label={`重试 ${task.title}`} title="重试任务" onClick={() => window.workbench.media.retry(task.id)}>重试</button>}</div>)}</div>
         <div className="media-footer"><button title="打开视频下载目录" onClick={() => void openVideoDownloadDir()}><Icon name="folder" size={14} /><span>视频目录</span></button><button title="打开插件管理设置" onClick={() => setModal('settings')}><Icon name="settings" size={14} /><span>插件管理</span></button><button title="清除当前素材流" onClick={() => { if (!resources.length) return setStatus('素材列表已经为空'); if (confirm('确定清空当前素材流吗？下载队列不会受影响。')) void window.workbench.media.clear().then(() => { setResources([]); setSelectedMedia([]); setStatus('素材列表已清空'); }); }}><Icon name="trash" size={14} /><span>清空列表</span></button></div>
      </aside>
    </main>
    {modal === 'account' && <Modal title={editingId ? '编辑账号' : '添加账号'} wide onClose={() => setModal(null)} footer={<><button onClick={() => setModal(null)}>取消</button><button className="primary" disabled={busy} onClick={saveAccount}>保存账号</button></>}>
       <div className="form-grid"><label>平台<select value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value as PlatformId })}>{platforms.map((platform) => <option key={platform.id} value={platform.id}>{platform.name}</option>)}</select></label><label>账号名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="留空自动生成名称" /></label><label>分组<input value={form.group} onChange={(event) => setForm({ ...form, group: event.target.value })} /></label><label>备注<input value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} /></label>{!editingId && <><label>添加数量<input type="number" min="1" max={MAX_STANDARD_ACCOUNT_CREATION} step="1" value={newAccountCount} onChange={(event) => setNewAccountCount(Number(event.target.value) || 1)} /><small className="form-hint">一次最多添加 {MAX_STANDARD_ACCOUNT_CREATION} 个，名称会自动编号。</small></label><label className="switch-row"><input type="checkbox" checked={startAfterCreate} onChange={(event) => setStartAfterCreate(event.target.checked)} />添加后启动<small className="form-hint">批量添加时打开成功的账号</small></label></>}{form.platform === 'custom' && <label className="wide">网站地址<input value={form.customUrl} onChange={(event) => setForm({ ...form, customUrl: event.target.value })} placeholder="https://example.com" /></label>}</div>
      <ProxyEditor value={form.proxy} onChange={(proxy) => setForm((current) => ({ ...current, proxy }))} editingId={editingId} runtimeState={runtimeState} busy={busy} onImport={() => importFormSubscription()} onRefresh={() => refreshFormSubscription()} onSelect={(tag) => void selectFormNode(tag)} onTest={(tag) => void testFormNode(tag)} onTestAll={() => void testAllFormNodes()} onTestProxy={() => void testAccountProxy()} onClearSession={(kind) => void clearAccountSession(kind)} />
      <BrowserEditor value={form.browser} onChange={(browser) => setForm((current) => ({ ...current, browser }))} />
      <FingerprintEditor value={form.fingerprint} onChange={(fingerprint) => setForm((current) => ({ ...current, fingerprint }))} canPersist={Boolean(editingId)} onRegenerate={() => void regenerateFormFingerprint()} onReset={() => void resetFormFingerprint()} />
    </Modal>}
    {modal === 'bulkProxy' && <Modal title={`批量代理 · ${selectedAccounts.length} 个账号`} onClose={() => setModal(null)} footer={<><button onClick={() => setModal(null)}>取消</button><button className="primary" disabled={busy} onClick={applyBulkProxy}>应用</button></>}><div className="proxy-box"><label className="switch-row"><input type="checkbox" checked={bulkProxy.enabled} onChange={(event) => setBulkProxy({ ...bulkProxy, enabled: event.target.checked })} />启用代理（关闭可批量恢复系统网络）</label>{bulkProxy.enabled && <div className="form-grid proxy"><select value={bulkProxy.type} onChange={(event) => setBulkProxy({ ...bulkProxy, type: event.target.value as ProxyConfig['type'] })}><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option></select><input placeholder="主机" value={bulkProxy.host} onChange={(event) => setBulkProxy({ ...bulkProxy, host: event.target.value })} /><input placeholder="端口" type="number" value={bulkProxy.port ?? ''} onChange={(event) => setBulkProxy({ ...bulkProxy, port: Number(event.target.value) || undefined })} /><input placeholder="用户名" value={bulkProxy.username} onChange={(event) => setBulkProxy({ ...bulkProxy, username: event.target.value })} /><input placeholder="密码" type="password" value={bulkProxy.password} onChange={(event) => setBulkProxy({ ...bulkProxy, password: event.target.value })} /></div>}</div></Modal>}
    {modal === 'settings' && settings && <Modal title="工作台设置" className="settings-modal" onClose={() => setModal(null)}><SettingsPanel settings={settings} platforms={platforms} onChange={async (patch) => setSettings(unwrap(await window.workbench.settings.update(patch)))} onStatus={setStatus} /></Modal>}
    {modal === 'library' && <Modal title="下载素材库" wide onClose={() => setModal(null)}><Library accounts={accounts} platforms={platforms} onStatus={setStatus} /></Modal>}
    {modal === 'login' && activeId && <Modal title={`登录辅助 · ${accountName(activeId)}`} onClose={() => setModal(null)}><LoginAssist accountId={activeId} onStatus={setStatus} /></Modal>}
    {modal === 'dola' && settings && <Modal title="Dola 批量登录" wide onClose={() => setModal(null)}><DolaBatch accounts={accounts.filter((account) => account.platform === 'dola')} initialAccountId={activeId ?? undefined} dolaAspectRatio={settings.dolaAspectRatio} onSettingsChange={async (patch) => setSettings(unwrap(await window.workbench.settings.update(patch)))} onAccountsChanged={async () => { setAccounts(unwrap(await window.workbench.accounts.list())); }} onStatus={setStatus} /></Modal>}
    {modal === 'higgsfield' && <Modal title="Higgsfield 批量登录" wide onClose={() => setModal(null)}><HiggsfieldBatch accounts={accounts.filter((account) => account.platform === 'higgsfield')} onAccountsChanged={async () => { setAccounts(unwrap(await window.workbench.accounts.list())); }} onStatus={setStatus} /></Modal>}
    {modal === 'faceGrid' && <Modal title="人脸网格工具" wide onClose={() => setModal(null)}><FaceGridPanel onStatus={setStatus} /></Modal>}
    {modal === 'migration' && <Modal title="V4.4 数据迁移" wide onClose={() => setModal(null)}><MigrationPanel activeAccountId={activeId} onImported={refreshAccountsAfterMigration} onStatus={setStatus} /></Modal>}
    {modal === 'diagnostics' && <Modal title="系统诊断" wide onClose={() => setModal(null)}><DiagnosticsPanel onStatus={setStatus} /></Modal>}
    {modal === 'help' && <Modal title="使用指南与快捷键" wide onClose={() => setModal(null)}><HelpPanel /></Modal>}
    {previewResource && <Modal title={previewResource.title || (previewResource.type === 'image' ? '图片预览' : '视频预览')} wide onClose={() => { setPreviewResource(null); setConvertedPreviewUrl(null); }} footer={<><button onClick={() => { setPreviewResource(null); setConvertedPreviewUrl(null); }}>关闭</button>{/^https?:\/\//i.test(previewResource.url) && <button onClick={() => void openResourceUrl(previewResource)}>打开链接</button>}<button className="primary" onClick={() => void download(previewResource)}>下载原文件</button></>}><div className="resource-preview-view">{previewResource.type === 'image' ? <img alt={previewResource.title || '图片预览'} src={previewResource.previewUrl ?? previewResource.url} /> : <><video controls autoPlay={false} poster={previewResource.previewThumbUrl ?? previewResource.thumbUrl} src={convertedPreviewUrl ?? previewResource.previewUrl ?? previewResource.url} /><div className="preview-actions"><button disabled={conversionBusy} onClick={() => void convertPreview(previewResource)}>{conversionBusy ? '正在转换…' : convertedPreviewUrl ? '重新生成兼容文件' : '转为 MP4 兼容播放'}</button>{convertedPreviewUrl && <button onClick={() => setConvertedPreviewUrl(null)}>恢复原始地址</button>}</div></>}</div><p className="form-hint">来源：{previewResource.source} · 质量证据：{previewResource.qualityEvidence ?? 'unknown'}{previewResource.confirmedNoWatermark ? ' · 平台原始资源标记' : ''}{convertedPreviewUrl ? ' · 当前播放的是本地 MP4 预览副本' : ''}</p></Modal>}
    {candidateResource && <Modal title={`资源候选 · ${candidateResource.title || (candidateResource.type === 'image' ? '图片素材' : '视频素材')}`} wide onClose={() => setCandidateResource(null)} footer={<button onClick={() => setCandidateResource(null)}>关闭</button>}><div className="candidate-summary"><p className="form-hint">只显示该素材从页面公开响应或 Blob 中观察到的地址。选择后会将其设为首选，下载仍由账号 Session 和主进程队列处理。</p>{candidateResource.rejectedCandidates?.length ? <div className="rejected-candidates"><strong>最近失败的候选 · {candidateResource.rejectedCandidates.length}</strong>{candidateResource.rejectedCandidates.slice(-8).reverse().map((url) => <small key={url} title={url}>{url}</small>)}</div> : null}<div className="candidate-list">{mediaCandidates(candidateResource).map((candidate) => { const selected = candidate.url === candidateResource.url; const roleLabel = candidate.role === 'primary' ? '当前首选' : candidate.role === 'backup' ? '备用地址' : `候选地址 ${candidate.index - 1}`; return <article key={candidate.url} className={`candidate-row ${selected ? 'selected' : ''}`}><div className="candidate-copy"><strong>{roleLabel}</strong><small title={candidate.url}>{candidate.url}</small></div><div className="candidate-actions">{!selected && <button onClick={() => void selectMediaCandidate(candidateResource, candidate.url)}>设为首选</button>}<button onClick={() => void copyCandidateUrl(candidate.url)}>复制</button>{/^https?:\/\//i.test(candidate.url) && <button onClick={() => void openCandidateUrl(candidate.url)}>打开</button>}</div></article>; })}</div></div></Modal>}
    {videoNotices.length > 0 && <div className="video-notice-layer" aria-live="polite">{videoNotices.map((notice) => <article className="video-notice-card" key={`${notice.accountId}:${notice.key}`}><div className="video-notice-icon">▶</div><div className="video-notice-content"><strong>新视频已生成</strong><span>{accounts.find((account) => account.id === notice.accountId)?.name ?? notice.accountId}{notice.title ? ` · ${notice.title}` : ''}</span></div><div className="video-notice-actions"><button onClick={() => { void openAccount(notice.accountId); setVideoNotices((current) => current.filter((item) => item !== notice)); }}>查看</button><button aria-label="关闭通知" onClick={() => setVideoNotices((current) => current.filter((item) => item !== notice))}>×</button></div></article>)}</div>}
  </div>;
}

function EmptyState({ onAdd }: { onAdd(): void }): React.JSX.Element { return <div className="empty-browser"><div className="orb"><Icon name="sparkle" size={30} /></div><span className="eyebrow">CREATIVE WORKSPACE</span><h1>一个窗口，管理所有 AI 创作账号</h1><p>独立登录环境、素材自动捕获、原文件下载与多平台工作流。</p><button className="primary" onClick={onAdd}><Icon name="plus" size={15} /><span>添加第一个账号</span></button></div>; }
function Modal({ title, children, footer, onClose, wide, className }: { title: string; children: React.ReactNode; footer?: React.ReactNode; onClose(): void; wide?: boolean; className?: string }): React.JSX.Element {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => { bodyRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' }); closeRef.current?.focus(); });
    return () => {
      window.cancelAnimationFrame(frame);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  // aria-modal="true" promises the rest of the page is inert, but Tab still walked out of the
  // dialog into the toolbar and both panels behind the backdrop.
  //
  // This listens on the document in the capture phase rather than on the dialog section, because
  // a section-scoped handler only runs while focus is ALREADY inside it - which is precisely not
  // the case it needs to fix. Measured: with focus on <body> the first Tab landed on a tab button
  // behind the backdrop and never re-entered the dialog.
  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    openDialogs.push(root);
    const onKeyDown = (event: KeyboardEvent): void => {
      // Dialogs stack (a media preview opened from the library dialog), so only the innermost
      // one may claim Tab - otherwise an outer dialog would steal focus back from an inner one.
      if (event.key !== 'Tab' || openDialogs[openDialogs.length - 1] !== root) return;
      const focusable = focusablesIn(root);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) { event.preventDefault(); return; }
      const active = document.activeElement;
      if (!root.contains(active)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const index = openDialogs.lastIndexOf(root);
      if (index !== -1) openDialogs.splice(index, 1);
    };
  }, []);
  const body = className === 'settings-modal' ? <SettingsModalLayout>{children}</SettingsModalLayout> : children;
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section ref={dialogRef} className={`modal ${wide ? 'wide' : ''}${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><header><h2 id={titleId}>{title}</h2><button ref={closeRef} type="button" aria-label="关闭弹窗" title="关闭（Esc）" onClick={onClose}><Icon name="close" size={18} /></button></header><div className="modal-body" ref={bodyRef}>{body}</div>{footer && <footer>{footer}</footer>}</section></div>;
}

const settingsSections: ReadonlyArray<{ id: string; label: string; icon: IconName }> = [
  { id: 'general', label: '常规', icon: 'settings' },
  { id: 'downloads', label: '下载', icon: 'download' },
  { id: 'browser', label: '浏览器', icon: 'preview' },
  { id: 'compatibility', label: '兼容性', icon: 'check' },
  { id: 'updates', label: '更新', icon: 'refresh' },
  { id: 'shortcuts', label: '快捷键', icon: 'columns' },
  { id: 'platforms', label: '平台', icon: 'panel-right' },
  { id: 'plugins', label: '插件', icon: 'library' }
];

function SettingsModalLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState('general');

  useEffect(() => {
    const root = rootRef.current;
    const list = root?.querySelector<HTMLElement>('.settings-list');
    const scrollRoot = root?.closest<HTMLElement>('.modal-body');
    if (!list || !scrollRoot) return;
    const nodes = Array.from(list.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
    const sectionFor = (node: HTMLElement, index: number): string => {
      if (index < 9) return 'general';
      if (node.classList.contains('update-box')) return 'updates';
      if (node.classList.contains('boss-key')) return 'shortcuts';
      if (node.classList.contains('adapter-switches')) return 'platforms';
      if (node.classList.contains('plugin-manager')) return 'plugins';
      const heading = node.querySelector('.section-heading strong')?.textContent?.trim() ?? '';
      if (heading.includes('下载目录')) return 'downloads';
      if (heading.includes('外部登录浏览器') || heading.includes('浏览器数据目录')) return 'browser';
      return 'compatibility';
    };
    nodes.forEach((node, index) => { node.dataset.settingsSection = sectionFor(node, index); node.style.scrollMarginTop = '16px'; });
    const updateActive = (): void => {
      const rootTop = scrollRoot.getBoundingClientRect().top;
      let current = 'general';
      for (const node of nodes) {
        if (node.getBoundingClientRect().top - rootTop <= 64) current = node.dataset.settingsSection || current;
      }
      setActiveSection(current);
    };
    scrollRoot.addEventListener('scroll', updateActive, { passive: true });
    updateActive();
    return () => scrollRoot.removeEventListener('scroll', updateActive);
  }, []);

  const scrollToSection = (id: string): void => {
    const node = rootRef.current?.querySelector<HTMLElement>(`[data-settings-section="${id}"]`);
    node?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveSection(id);
  };

  return <div className="settings-modal-layout" ref={rootRef}>
    <nav className="settings-nav" aria-label="设置分组">
      <span className="settings-nav-caption">工作台设置</span>
      {settingsSections.map((section) => <button key={section.id} className={activeSection === section.id ? 'active' : ''} aria-current={activeSection === section.id ? 'page' : undefined} onClick={() => scrollToSection(section.id)}><Icon name={section.icon} size={15} /><span>{section.label}</span></button>)}
    </nav>
    <div className="settings-content">{children}</div>
  </div>;
}

function HelpPanel(): React.JSX.Element {
  const modifier = isWindowsPlatform() ? 'Ctrl' : '⌘';
  return <div className="help-panel">
    <section className="help-hero"><div className="help-hero-mark" aria-hidden="true">✦</div><div><span className="eyebrow">QUICK START</span><h3>从账号到成片，只需三步</h3><p>把登录环境、网页操作和素材下载放在一个可恢复的工作台里。</p></div></section>
    <div className="help-grid">
      <article className="help-card"><span className="help-step">01</span><div><strong>创建账号</strong><p>点击左侧“＋”，选择平台并保存。每个账号都会使用独立 Session。</p></div></article>
      <article className="help-card"><span className="help-step">02</span><div><strong>打开并创作</strong><p>双击账号可编辑配置，点击账号名称打开页面；工具栏负责导航、缩放和双窗口。</p></div></article>
      <article className="help-card"><span className="help-step">03</span><div><strong>预览并下载</strong><p>网页捕获的图片和视频会进入右侧素材流，失败任务可以重试，候选地址可单独查看。</p></div></article>
    </div>
    <section className="help-section"><div className="section-heading"><strong>常用快捷键</strong><small>{isWindowsPlatform() ? 'Windows' : 'macOS'}</small></div><div className="help-shortcuts"><div className="help-shortcut"><span>聚焦账号搜索</span><span><kbd>{modifier}</kbd><b>+</b><kbd>K</kbd></span></div><div className="help-shortcut"><span>关闭最上层菜单或弹窗</span><kbd>Esc</kbd></div><div className="help-shortcut"><span>地址栏导航</span><span><kbd>Enter</kbd><small>在地址栏中</small></span></div><div className="help-shortcut"><span>打开账号</span><span><kbd>单击</kbd><small>切换</small><kbd>双击</kbd><small>编辑</small></span></div></div></section>
    <section className="help-section"><div className="section-heading"><strong>工作台提示</strong><small>保持操作可恢复</small></div><div className="help-points"><div><span className="help-badge good">隔离</span><p>账号的 Cookie、LocalStorage、IndexedDB、缓存和扩展环境互不共享。</p></div><div><span className="help-badge info">代理</span><p>订阅代理异常时不会自动降级到直连，需在账号配置中明确切换。</p></div><div><span className="help-badge neutral">边界</span><p>素材下载使用平台公开的原始资源链路，不绕过 DRM、权限或第三方验证。</p></div></div></section>
  </div>;
}

function DiagnosticsPanel({ onStatus }: { onStatus(value: string): void }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(async (): Promise<void> => {
    try { setBusy(true); setSnapshot(unwrap(await window.workbench.diagnostics())); }
    catch (error) { onStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }, [onStatus]);
  useEffect(() => { void load(); }, [load]);
  if (!snapshot) return <div className="diagnostics-panel"><p className="form-hint">正在读取诊断信息…</p><button disabled={busy} onClick={() => void load()}>重新读取</button></div>;
  const taskTotal = Object.values(snapshot.taskCounts).reduce((sum, value) => sum + value, 0);
  const runtimeLabel = (account: DiagnosticsSnapshot['accounts'][number]): string => {
    if (!account.proxy.enabled) return '未启用';
    if (account.proxy.mode === 'direct') return '直连代理';
    return account.proxy.status === 'running' ? `sing-box 运行中 · ${account.proxy.localPort ?? '—'}` : `sing-box ${account.proxy.status}`;
  };
  return <div className="diagnostics-panel">
    <div className="diagnostics-toolbar"><span className="form-hint">只显示运行状态，不包含 Cookie、密码、代理密钥或完整订阅内容。</span><button disabled={busy} onClick={() => void load()}>{busy ? '读取中…' : '刷新'}</button></div>
    <div className="diagnostic-metrics"><div><strong>{snapshot.accountCount}</strong><span>账号</span></div><div><strong>{snapshot.openTabCount}</strong><span>已打开</span></div><div><strong>{snapshot.resourceCount}</strong><span>捕获素材</span></div><div><strong>{taskTotal}</strong><span>下载任务</span></div><div><strong>{snapshot.pluginCount}</strong><span>自定义插件</span></div></div>
    <div className="diagnostic-runtime"><div className="section-heading"><strong>运行环境</strong><small>快照时间：{new Date(snapshot.generatedAt).toLocaleString()}</small></div><div className="metric-row"><span>应用 / Electron</span><strong>{snapshot.appVersion} / {snapshot.electronVersion}</strong></div><div className="metric-row"><span>平台 / 架构</span><strong>{snapshot.platform} / {snapshot.arch}{snapshot.packaged ? ' · 已打包' : ' · 开发模式'}</strong></div><div className="metric-row"><span>下载任务</span><strong>排队 {snapshot.taskCounts.queued} · 运行 {snapshot.taskCounts.running} · 完成 {snapshot.taskCounts.completed} · 失败 {snapshot.taskCounts.failed}</strong></div></div>
    <div className="diagnostic-accounts"><div className="section-heading"><strong>账号状态</strong><small>每行对应一个独立的 persist Session。</small></div>{snapshot.accounts.length ? snapshot.accounts.map((account) => <article key={account.id} className="diagnostic-account"><div className="diagnostic-account-head"><strong>{account.name}</strong><span className={account.open ? 'diagnostic-good' : 'diagnostic-muted'}>{account.open ? '已打开' : '未打开'}</span></div><small>{account.platform} · {account.sessionPartition}</small><small className="diagnostic-url" title={account.url || '无页面地址'}>{account.url || '暂无页面地址'}</small><div className="diagnostic-tags"><span>{account.adapterEnabled ? '适配器开启' : '适配器关闭'}</span><span>{account.adapterCapabilities.dedicatedDownloader ? '专用下载器' : '通用捕获'}</span>{account.adapterCapabilities.taskDurations.length > 0 && <span>任务 {account.adapterCapabilities.taskDurations.map((duration) => `${duration}s`).join('/')}</span>}<span>{account.fingerprint.enabled ? `指纹${account.fingerprint.seedPresent ? '已生成' : '缺少种子'}` : '默认指纹'}</span><span>{runtimeLabel(account)}</span>{account.proxy.nodeCount > 0 && <span>{account.proxy.nodeCount} 节点</span>}</div>{(account.fingerprint.lastError || account.proxy.error) && <p className="form-warning">{account.fingerprint.lastError || account.proxy.error}</p>}</article>) : <p className="form-hint">暂无账号。</p>}</div>
  </div>;
}

function BrowserEditor({ value, onChange }: { value: AccountInput['browser']; onChange(value: AccountInput['browser']): void }): React.JSX.Element {
  const patch = (next: Partial<AccountInput['browser']>): void => onChange({ ...value, ...next });
  return <div className="browser-settings-box"><div className="section-heading"><strong>浏览器页面</strong><small>每个账号保存自己的页面位置和缩放；恢复地址只接受 HTTP/HTTPS。</small></div><label className="wide">主页地址<input value={value.homeUrl} onChange={(event) => patch({ homeUrl: event.target.value })} placeholder="留空使用平台默认主页" /></label><label className="wide">上次页面地址<input value={value.lastUrl} onChange={(event) => patch({ lastUrl: event.target.value })} placeholder="打开页面后自动保存" /></label><div className="account-tools"><label className="switch-row"><input type="checkbox" checked={value.restoreOnStart} onChange={(event) => patch({ restoreOnStart: event.target.checked })} />启动时恢复上次页面</label><button disabled={!value.lastUrl} onClick={() => patch({ lastUrl: '' })}>清除上次页面</button></div></div>;
}

function ProxyEditor({ value, onChange, editingId, runtimeState, busy, onImport, onRefresh, onSelect, onTest, onTestAll, onTestProxy, onClearSession }: { value: ProxyConfig; onChange(value: ProxyConfig): void; editingId: string | null; runtimeState: ProxyRuntimeState | null; busy: boolean; onImport(): void; onRefresh(): void; onSelect(tag: string): void; onTest(tag?: string): void; onTestAll(): void; onTestProxy(): void; onClearSession(kind: SessionDataKind): void }): React.JSX.Element {
  const patch = (next: Partial<ProxyConfig>): void => onChange({ ...value, ...next });
  const runtimeLabel = runtimeState?.status === 'running' ? `运行中 · 端口 ${runtimeState.localPort ?? '—'}` : runtimeState?.status === 'starting' ? '正在启动 sing-box…' : runtimeState?.status === 'failed' ? `运行失败：${runtimeState.error ?? '未知原因'}` : '未启动';
  return <div className="proxy-box">
    <div className="section-heading"><strong>账号独立代理</strong><small>每个账号使用独立 Session、回环端口和路由；同一节点仍可能共享公网出口。</small></div>
    <label className="switch-row"><input type="checkbox" checked={value.enabled} onChange={(event) => patch({ enabled: event.target.checked })} />启用代理</label>
    {value.enabled && <>
      <div className="form-grid proxy-mode"><label>代理模式<select value={value.mode} onChange={(event) => patch({ mode: event.target.value as ProxyConfig['mode'], type: event.target.value === 'subscription' ? 'socks5' : value.directScheme })}><option value="direct">直连服务器</option><option value="subscription">订阅 / sing-box</option></select></label><label>当前状态<span className="inline-status">{runtimeLabel}</span></label></div>
      {value.mode === 'direct' ? <div className="form-grid proxy"><select value={value.directScheme} onChange={(event) => patch({ type: event.target.value as ProxyConfig['type'], directScheme: event.target.value as ProxyConfig['directScheme'] })}><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option></select><input placeholder="主机" value={value.host} onChange={(event) => patch({ host: event.target.value, directAddressText: `${event.target.value}:${value.port ?? ''}` })} /><input placeholder="端口" type="number" value={value.port ?? ''} onChange={(event) => patch({ port: Number(event.target.value) || undefined, directAddressText: `${value.host}:${event.target.value}` })} /><input placeholder="用户名（可选）" value={value.username} onChange={(event) => patch({ username: event.target.value })} /><input placeholder="密码（可选）" type="password" value={value.password} onChange={(event) => patch({ password: event.target.value })} /></div> : <div className="subscription-editor">
        <label className="wide">订阅地址<input value={value.subscriptionUrl} onChange={(event) => patch({ subscriptionUrl: event.target.value })} placeholder="https://example.com/subscribe" /></label>
        <label className="wide">请求 User-Agent<input value={value.subscriptionUserAgent} onChange={(event) => patch({ subscriptionUserAgent: event.target.value })} placeholder="sing-box" /></label>
         <div className="account-tools"><button disabled={!editingId || busy} onClick={onImport}>导入订阅</button><button disabled={!editingId || busy} onClick={onRefresh}>刷新订阅</button><button disabled={!editingId || busy || !value.subscriptionNodes.length} onClick={() => onTest(value.selectedNodeTag || undefined)}>测试节点</button><button disabled={!editingId || busy || !value.subscriptionNodes.length} onClick={onTestAll}>{busy ? '正在测试全部…' : '全部测速 / 出口 IP'}</button><span className="inline-status">{value.subscriptionNodes.length ? `${value.subscriptionNodes.length} 个节点` : '尚未导入节点'}</span></div>
         {value.subscriptionNodes.length > 0 && <div className="node-picker"><select value={value.selectedNodeTag || value.subscriptionNodes[0]?.tag || ''} onChange={(event) => onSelect(event.target.value)}>{value.subscriptionNodes.map((node) => <option value={node.tag} key={node.tag}>{node.name || node.tag}{node.latencyMs ? ` · ${node.latencyMs}ms` : ''}{node.realIp ? ` · ${node.realIp}` : ''}</option>)}</select><button disabled={!editingId || busy} onClick={() => onTest(value.selectedNodeTag || value.subscriptionNodes[0]?.tag)}>测速 / 出口 IP</button></div>}
        {value.lastRuntimeError && <p className="form-warning">上次运行错误：{value.lastRuntimeError}</p>}
        <p className="form-hint">支持 sing-box JSON、Clash YAML、V2Ray Base64/URI。核心进程异常时不会自动降级到直连。</p>
      </div>}
    </>}
    <div className="account-tools session-tools"><span className="form-hint">账号会话工具</span><button disabled={!editingId || busy} onClick={() => onClearSession('cookies')}>清 Cookie</button><button disabled={!editingId || busy} onClick={() => onClearSession('cache')}>清缓存</button><button disabled={!editingId || busy} onClick={() => onClearSession('storage')}>清 Storage</button><button className="danger" disabled={!editingId || busy} onClick={() => onClearSession('all')}>退出并清理全部</button></div>
  </div>;
}

function FingerprintEditor({ value, onChange, canPersist, onRegenerate, onReset }: { value: FingerprintProfile; onChange(value: FingerprintProfile): void; canPersist: boolean; onRegenerate(): void; onReset(): void }): React.JSX.Element {
  const patch = (next: Partial<FingerprintProfile>): void => onChange({ ...value, ...next });
  const platform = value.platform.trim().toLowerCase();
  const ua = value.userAgent;
  const uaPlatform = value.userAgentDataPlatform.trim().toLowerCase();
  const looksWindows = /windows nt/i.test(ua) || platform === 'win32' || uaPlatform === 'windows';
  const looksMac = /macintosh|mac os x/i.test(ua) || platform === 'macintel' || uaPlatform === 'macos';
  const identityWarnings = [
    (platform === 'win32' && /macintosh|mac os x/i.test(ua)) || (platform === 'macintel' && /windows nt/i.test(ua)) ? 'User-Agent 与浏览器平台不一致' : '',
    (uaPlatform === 'windows' && (platform === 'macintel' || /macintosh|mac os x/i.test(ua))) || (uaPlatform === 'macos' && (platform === 'win32' || /windows nt/i.test(ua))) ? 'UA-CH 平台与 User-Agent 不一致' : '',
    !value.userAgent.trim() || !value.platform.trim() || !value.userAgentDataPlatform.trim() ? '身份字段尚未完整生成' : '',
    value.userAgentDataMobile && value.maxTouchPoints === 0 ? '移动 UA-CH 的最大触控点仍为 0' : ''
  ].filter(Boolean);
  const hardwareWarnings = [
    value.screenWidth < 640 || value.screenHeight < 480 ? '屏幕尺寸偏小，请确认是否确实为移动设备' : '',
    value.deviceScaleFactor > 1 && value.screenWidth < 1280 ? '高 DPR 与当前屏幕尺寸组合较少见' : '',
    value.hardwareConcurrency > 32 || value.deviceMemory > 32 ? '硬件参数超过常见桌面档位，请确认来源' : ''
  ].filter(Boolean);
  const hasGeneratedIdentity = Boolean(value.seed || value.platform || value.userAgent || value.userAgentDataPlatform);
  const warnings = !canPersist && !hasGeneratedIdentity ? [] : [...identityWarnings, ...hardwareWarnings];
  const health = !canPersist && !hasGeneratedIdentity ? 'off' : warnings.length ? 'check' : value.enabled ? 'ready' : 'off';
  const healthLabel = !canPersist && !hasGeneratedIdentity ? '保存后生成' : warnings.length ? `${warnings.length} 项待检查` : value.enabled ? '配置一致' : '未启用';
  const appliedLabel = value.lastAppliedAt ? new Date(value.lastAppliedAt).toLocaleString() : canPersist ? '保存账号后应用' : '保存账号后生成';
  const browserFamily = looksMac ? 'macOS 桌面' : looksWindows ? 'Windows 桌面' : '待生成';
  return <div className="fingerprint-box">
    <div className="fingerprint-head"><div className="section-heading"><strong>账号级浏览器指纹</strong><small>稳定种子只属于当前账号；只修改浏览器可见特征，不承诺改变操作系统、TLS 或真实 GPU 指纹。</small></div><span className={`fingerprint-health ${health}`}><i />{healthLabel}</span></div>
    <div className="fingerprint-summary" aria-label="指纹配置摘要"><div><span>运行状态</span><strong>{value.enabled ? '已启用' : '已关闭'}</strong><small>最近应用：{appliedLabel}</small></div><div><span>身份模板</span><strong>{browserFamily}</strong><small>{value.userAgentDataPlatform || value.platform || '等待生成平台信息'}</small></div><div><span>设备尺寸</span><strong>{value.screenWidth} × {value.screenHeight}</strong><small>DPR {value.deviceScaleFactor} · {value.hardwareConcurrency} 核 · {value.deviceMemory} GB</small></div></div>
    <div className="fingerprint-toggle-row"><label className="switch-row"><input type="checkbox" checked={value.enabled} onChange={(event) => patch({ enabled: event.target.checked })} />启用稳定随机指纹</label><span>种子：{value.seed ? `${value.seed.slice(0, 12)}…` : '保存时生成'}</span></div>
    {value.lastError && <p className="form-warning">最近一次指纹注入失败：{value.lastError}</p>}
    {warnings.length ? <div className="fingerprint-warnings"><strong>一致性检查</strong><ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : <div className="fingerprint-ok"><span>✓</span>身份、平台和设备参数暂未发现明显冲突</div>}
    <details className="fingerprint-section" open><summary><span>浏览器身份</span><small>User-Agent、平台、语言和时区</small></summary><div className="form-grid fingerprint-grid"><label>浏览器平台<input value={value.platform} onChange={(event) => patch({ platform: event.target.value })} placeholder="Win32 / MacIntel" /></label><label>浏览器厂商<input value={value.vendor} onChange={(event) => patch({ vendor: event.target.value })} placeholder="Google Inc." /></label><label>语言（逗号分隔）<input value={value.languages.join(', ')} onChange={(event) => patch({ languages: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} /></label><label className="wide">User-Agent<input value={value.userAgent} onChange={(event) => patch({ userAgent: event.target.value })} placeholder="保存账号后自动生成平台原生 UA" /></label><label>时区<input value={value.timezone} onChange={(event) => patch({ timezone: event.target.value })} placeholder="Asia/Shanghai" /></label></div></details>
    <details className="fingerprint-section" open><summary><span>设备与屏幕</span><small>硬件并发、内存、触控、尺寸和 DPR</small></summary><div className="form-grid fingerprint-grid"><label>硬件并发<input type="number" min="1" max="128" value={value.hardwareConcurrency} onChange={(event) => patch({ hardwareConcurrency: Number(event.target.value) })} /></label><label>设备内存 GB<input type="number" min="0.25" max="128" step="0.25" value={value.deviceMemory} onChange={(event) => patch({ deviceMemory: Number(event.target.value) })} /></label><label>最大触控点<input type="number" min="0" max="20" value={value.maxTouchPoints} onChange={(event) => patch({ maxTouchPoints: Number(event.target.value) })} /></label><label>屏幕<input value={`${value.screenWidth} × ${value.screenHeight}`} onChange={(event) => { const match = event.target.value.match(/(\d+)\s*[×x]\s*(\d+)/i); if (match) patch({ screenWidth: Number(match[1]), screenHeight: Number(match[2]) }); }} /></label><label>DPR<input type="number" min="0.5" max="8" step="0.25" value={value.deviceScaleFactor} onChange={(event) => patch({ deviceScaleFactor: Number(event.target.value) })} /></label><label>WebRTC<select value={value.webRtcPolicy} onChange={(event) => patch({ webRtcPolicy: event.target.value as FingerprintProfile['webRtcPolicy'] })}><option value="default">浏览器默认</option><option value="disable_non_proxied_udp">禁止非代理 UDP</option></select></label></div></details>
    <details className="fingerprint-section"><summary><span>渲染与隐私</span><small>WebGL、Canvas、Audio 和高级 UA-CH</small></summary><div className="form-grid fingerprint-grid"><label className="wide">WebGL Vendor<input value={value.webGlVendor} onChange={(event) => patch({ webGlVendor: event.target.value })} placeholder="Google Inc." /></label><label className="wide">WebGL Renderer<input value={value.webGlRenderer} onChange={(event) => patch({ webGlRenderer: event.target.value })} placeholder="ANGLE (Default Renderer)" /></label><label className="wide">UA-CH Brands<input value={value.userAgentDataBrands} onChange={(event) => patch({ userAgentDataBrands: event.target.value })} placeholder={'"Not/A)Brand";v="8", "Chromium";v="128"'} /></label><label className="wide">UA-CH Full Version List<input value={value.userAgentDataFullVersionList} onChange={(event) => patch({ userAgentDataFullVersionList: event.target.value })} placeholder={'"Not/A)Brand";v="8.0.0.0", "Chromium";v="128.0.0.0"'} /></label><label>UA-CH 平台<input value={value.userAgentDataPlatform} onChange={(event) => patch({ userAgentDataPlatform: event.target.value })} placeholder="Windows / macOS" /></label><label>UA-CH 平台版本<input value={value.userAgentDataPlatformVersion} onChange={(event) => patch({ userAgentDataPlatformVersion: event.target.value })} /></label><label>UA-CH 架构<input value={value.userAgentDataArchitecture} onChange={(event) => patch({ userAgentDataArchitecture: event.target.value })} placeholder="x86 / arm" /></label><label>UA-CH 位数<input value={value.userAgentDataBitness} onChange={(event) => patch({ userAgentDataBitness: event.target.value })} placeholder="64" /></label><label className="switch-row"><input type="checkbox" checked={value.userAgentDataMobile} onChange={(event) => patch({ userAgentDataMobile: event.target.checked })} />UA-CH 移动端</label><label className="switch-row"><input type="checkbox" checked={value.canvasNoise} onChange={(event) => patch({ canvasNoise: event.target.checked })} />Canvas 噪声</label><label className="switch-row"><input type="checkbox" checked={value.audioNoise} onChange={(event) => patch({ audioNoise: event.target.checked })} />Audio 噪声</label></div></details>
    <div className="fingerprint-actions"><span className="form-hint">指纹只在打开账号后重新注入；重新生成会保留启用状态并替换稳定种子。</span><button disabled={!canPersist} onClick={onRegenerate}>重新生成</button><button onClick={onReset}>恢复默认</button></div>
  </div>;
}

function MigrationPanel({ activeAccountId, onImported, onStatus }: { activeAccountId: string | null; onImported(): Promise<void>; onStatus(value: string): void }): React.JSX.Element {
  const [preview, setPreview] = useState<LegacyImportPreview | null>(null); const [report, setReport] = useState<LegacyImportReport | null>(null); const [busy, setBusy] = useState(false);
  const runPreview = async (): Promise<void> => { try { setBusy(true); setReport(null); const value = unwrap(await window.workbench.migration.preview()); setPreview(value); if (value) onStatus(`已读取 V4.4 配置：${value.accountCount} 个账号`); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  const runImport = async (): Promise<void> => { if (!preview) return onStatus('请先选择配置并预览'); if (!confirm(`将导入 ${preview.accountCount} 个账号，应用会先自动备份当前账号配置，继续吗？`)) return; try { setBusy(true); const value = unwrap(await window.workbench.migration.import()); if (value) { setReport(value); await onImported(); onStatus(`迁移完成：导入 ${value.imported} 个，跳过 ${value.skipped} 个`); } } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  const importStorage = async (): Promise<void> => { if (!activeAccountId) return onStatus('请先打开或选择一个账号'); try { setBusy(true); const value = unwrap(await window.workbench.migration.importStorage(activeAccountId)); onStatus(`Storage 导入完成：Cookie ${value.cookies}，LocalStorage ${value.localStorage}，SessionStorage ${value.sessionStorage}，IndexedDB ${value.indexedDb} 个数据库${value.errors.length ? `；${value.errors.join('；')}` : ''}`); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  return <div className="migration-panel"><p>导入 V4.4 的 AppConfig、账号、区域代理、fingerprint_config.json 和 Dola 画幅偏好。不会直接复制 WebView2 Cookie、缓存或数据库；登录态请用 Cookie/Storage 文件或重新登录恢复。Cookie/Storage 文件中的结构化 IndexedDB（数据库、对象仓库、索引和记录）会在账号页面打开后尝试恢复。</p><div className="account-tools"><button className="primary" disabled={busy} onClick={() => void runPreview()}>选择并预览 V4.4</button><button disabled={busy || !preview} onClick={() => void runImport()}>确认导入</button><button disabled={busy || !activeAccountId} onClick={() => void importStorage()}>导入当前账号 Cookie/Storage</button></div>{preview && <div className="migration-preview"><div className="metric-row"><span>配置文件</span><strong>{preview.sourcePath}</strong></div><div className="metric-row"><span>账号</span><strong>{preview.accountCount}</strong></div><div className="metric-row"><span>指纹</span><strong>{preview.fingerprintCount}</strong></div><div className="metric-row"><span>代理配置</span><strong>{preview.proxyProfileCount}</strong></div><div className="metric-row"><span>旧版浏览器数据目录</span><strong>{preview.settings.hasProfileRoot ? preview.settings.profileRoot : '未发现；保持当前目录'}</strong></div><div className="metric-row"><span>普通下载目录</span><strong>{preview.settings.hasDownloadDir ? preview.settings.downloadDir : '保持当前设置'}</strong></div><div className="metric-row"><span>视频下载目录</span><strong>{preview.settings.hasVideoDownloadDir ? preview.settings.videoDownloadDir : '跟随普通下载目录'}</strong></div><div className="metric-row"><span>V4.4 素材目录</span><strong>{preview.settings.hasLegacyV44MediaFolders ? '导入后使用根目录/Videos 与根目录/Images' : '保持当前目录规则'}</strong></div><div className="metric-row"><span>Boss Key</span><strong>{preview.settings.hasBossKey ? `${preview.settings.bossKey.ctrl ? 'Ctrl+' : ''}${preview.settings.bossKey.alt ? 'Alt+' : ''}${preview.settings.bossKey.shift ? 'Shift+' : ''}${preview.settings.bossKey.meta ? 'Command/Super+' : ''}${preview.settings.bossKey.key}` : '保持当前设置'}</strong></div><div className="metric-row"><span>Dola 画幅</span><strong>{preview.settings.hasDolaAspectRatio ? preview.settings.dolaAspectRatio : '保持当前设置'}</strong></div><div className="metric-row"><span>旧版主页</span><strong>{preview.settings.homeUrlCount} 个可恢复地址</strong></div><div className="migration-accounts">{preview.accounts.map((account) => <div key={`${account.legacyId}-${account.name}`}><span>{account.name}{account.conflict ? <em className="migration-conflict">名称冲突 · 导入时自动改名</em> : null}</span><small>{account.platform} · {account.proxyMode === 'subscription' ? '订阅代理' : '直连代理'}{account.hasFingerprint ? ' · 有指纹' : ''}</small></div>)}</div>{preview.warnings.map((warning) => <p className="form-warning" key={warning}>{warning}</p>)}</div>}{report && <div className="migration-report"><strong>导入结果</strong><span>成功 {report.imported} · 跳过 {report.skipped} · 备份：{report.backupPath}</span>{report.errors.map((error) => <p className="form-warning" key={error}>{error}</p>)}</div>}<p className="form-hint">激活缓存、机器 ID、自锁和授权数据会被忽略。IndexedDB 只按导入文件提供的结构恢复；站点升级、加密值、Service Worker 内部状态和未导出的数据库仍需重新登录或重新初始化。</p></div>;
}

function FaceGridPanel({ onStatus }: { onStatus(value: string): void }): React.JSX.Element {
  const [image, setImage] = useState<FaceGridImage | null>(null); const [outputDir, setOutputDir] = useState(''); const [mode, setMode] = useState<FaceGridMode>('grid'); const [thickness, setThickness] = useState(2); const [alpha, setAlpha] = useState(0.4); const [color, setColor] = useState('white'); const [busy, setBusy] = useState(false); const [result, setResult] = useState<{ path: string; faceCount: number; scaled: boolean } | null>(null);
  const chooseImage = async (): Promise<void> => { try { const value = unwrap(await window.workbench.faceGrid.chooseImage()); if (value) { setImage(value); setResult(null); onStatus(`已选择图片：${value.path}`); } } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } };
  const chooseOutput = async (): Promise<void> => { try { setOutputDir(unwrap(await window.workbench.faceGrid.chooseOutputDir())); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } };
  const run = async (): Promise<void> => { if (!image) return onStatus('请先选择图片'); try { setBusy(true); onStatus('正在加载人脸模型并检测…'); const model = unwrap(await window.workbench.faceGrid.model()); const safeThickness = Number.isFinite(thickness) ? Math.max(0.5, Math.min(20, thickness)) : 2; const safeAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.4; const processed = await processFaceGrid(image.dataUrl, model, { mode, thickness: safeThickness, alpha: safeAlpha, color: color.trim() || 'white' }); const saved = unwrap(await window.workbench.faceGrid.save({ inputPath: image.path, outputDir: outputDir || undefined, mode, mime: processed.mime, dataUrl: processed.dataUrl, faceCount: processed.faceCount, scaled: processed.scaled })); setResult(saved); onStatus(`处理完成：检测到 ${saved.faceCount} 张人脸，已保存到 ${saved.path}`); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  return <div className="face-grid-panel"><p>使用旧版 OpenCV SSD 模型在本地检测人脸，然后绘制网格或生成脸部重组图。图片不会上传云端。</p><div className="face-grid-toolbar"><button className="primary" disabled={busy} onClick={() => void chooseImage()}>选择图片</button><button disabled={busy || !image} onClick={() => void chooseOutput()}>输出目录</button><span>{image ? image.path : '尚未选择图片'}</span></div>{image && <div className="face-grid-preview"><img src={image.dataUrl} alt="待处理图片" /></div>}<div className="form-grid face-grid-options"><label>处理模式<select value={mode} onChange={(event) => setMode(event.target.value as FaceGridMode)}><option value="grid">网格</option><option value="regroup">脸部重组</option></select></label><label>线宽<input type="number" min="0.5" max="20" step="0.5" value={thickness} onChange={(event) => setThickness(Number(event.target.value))} /></label><label>透明度<input type="number" min="0" max="1" step="0.05" value={alpha} onChange={(event) => setAlpha(Number(event.target.value))} /></label><label>颜色<input value={color} onChange={(event) => setColor(event.target.value)} placeholder="white / #ffffff / 255,255,255" /></label></div><div className="account-tools"><button className="primary" disabled={busy || !image} onClick={() => void run()}>{busy ? '处理中…' : '开始处理'}</button>{result && <span className="inline-status success">{result.faceCount} 张人脸 · {result.scaled ? '已按 2500px 限制缩放 · ' : ''}{result.path}</span>}</div></div>;
}

function LegacyCachePanel({ scan, report, busy, onScan, onClean }: { scan: LegacyCacheScan | null; report: LegacyCacheCleanReport | null; busy: boolean; onScan(): void; onClean(): void }): React.JSX.Element {
  return <div className="tool-box"><div className="section-heading"><strong>旧版临时缓存</strong><small>只扫描旧版 DolaMultiBrowser 明确使用的临时目录；不会清理账号浏览器数据、下载文件或普通临时文件。按目录最后修改时间筛选，清理前会重新扫描。</small></div><div className="account-tools"><button disabled={busy} onClick={onScan}>扫描旧版缓存</button><button className="primary" disabled={busy || !scan?.candidates.length} onClick={onClean}>确认清理</button>{scan && <span className="inline-status">{scan.candidates.length ? `${scan.candidates.length} 个目录 · ${formatBytes(scan.totalBytes)}` : '没有符合条件的目录'}</span>}</div>{scan?.candidates.length ? <div className="cache-cleanup-list">{scan.candidates.map((candidate) => <div className="directory-setting" key={candidate.path}><div><strong>{candidate.source === 'local-appdata' ? 'LocalAppData' : candidate.source === 'temp-full' ? '临时运行目录' : candidate.source === 'temp-normal' ? '普通临时目录' : '旧版临时缓存'}</strong><small>{candidate.path} · {candidate.ageHours} 小时未修改 · {formatBytes(candidate.sizeBytes)}</small></div></div>)}</div> : null}{report?.failed.length ? <p className="form-warning">有 {report.failed.length} 个目录未能清理：{report.failed.map((item) => `${item.candidate.path}（${item.error}）`).join('；')}</p> : null}</div>;
}

function SettingsPanel({ settings, platforms, onChange, onStatus }: { settings: AppSettings; platforms: PlatformDefinition[]; onChange(patch: Partial<AppSettings>): Promise<void>; onStatus(value: string): void }): React.JSX.Element {
  const [plugins, setPlugins] = useState<PluginRecord[]>([]); const [pluginBusy, setPluginBusy] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ enabled: boolean; hasUpdate: boolean; latestVersion?: string; releaseUrl?: string; reason?: string } | null>(null); const [updateBusy, setUpdateBusy] = useState(false);
  const [toolStatus, setToolStatus] = useState<MediaToolStatus | null>(null); const [toolBusy, setToolBusy] = useState(false);
  const [cacheScan, setCacheScan] = useState<LegacyCacheScan | null>(null); const [cacheCleanReport, setCacheCleanReport] = useState<LegacyCacheCleanReport | null>(null); const [cacheBusy, setCacheBusy] = useState(false);
  const [profileLocation, setProfileLocation] = useState<ProfileLocationInfo | null>(null);
  const toggleAdapter = (id: PlatformId, enabled: boolean): void => { const disabled = enabled ? settings.disabledAdapters.filter((item) => item !== id) : [...new Set([...settings.disabledAdapters, id])]; void onChange({ disabledAdapters: disabled }); };
  const patchBossKey = (patch: Partial<AppSettings['bossKey']>): void => { void onChange({ bossKey: { ...settings.bossKey, ...patch } }); };
  const checkUpdate = async (): Promise<void> => { try { const info = unwrap(await window.workbench.updates.check()); setUpdateInfo(info); onStatus(!info.enabled ? (info.reason || '未配置公开更新仓库') : info.hasUpdate ? `发现新版本 ${info.latestVersion}` : '当前已是最新版本'); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } };
  const downloadUpdate = async (): Promise<void> => { try { setUpdateBusy(true); const path = unwrap(await window.workbench.updates.download()); onStatus(`更新包已下载：${path}`); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } finally { setUpdateBusy(false); } };
  const openRelease = async (): Promise<void> => { try { unwrap(await window.workbench.updates.openRelease()); onStatus('已打开 GitHub 发布页'); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } };
  const checkFfmpeg = async (): Promise<void> => { try { setToolBusy(true); const value = unwrap(await window.workbench.media.toolStatus()); setToolStatus(value); onStatus(value.message); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } finally { setToolBusy(false); } };
  const loadPlugins = useCallback(async (): Promise<void> => { try { setPlugins(unwrap(await window.workbench.plugins.list())); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } }, [onStatus]);
  useEffect(() => { void loadPlugins(); }, [loadPlugins]);
  const loadProfileLocation = useCallback(async (): Promise<void> => { try { setProfileLocation(unwrap(await window.workbench.data.profileLocation())); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } }, [onStatus]);
  useEffect(() => { void loadProfileLocation(); }, [loadProfileLocation]);
  const importPlugin = async (kind: 'package' | 'directory'): Promise<void> => { try { setPluginBusy(true); const plugin = unwrap(await (kind === 'package' ? window.workbench.plugins.importPackage() : window.workbench.plugins.importDirectory())); await loadPlugins(); onStatus(`已导入插件：${plugin.name}`); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } finally { setPluginBusy(false); } };
  const togglePlugin = async (plugin: PluginRecord): Promise<void> => { try { setPluginBusy(true); setPlugins(unwrap(await window.workbench.plugins.setEnabled(plugin.id, !plugin.enabled))); onStatus(`${plugin.enabled ? '已禁用' : '已启用'}插件：${plugin.name}`); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } finally { setPluginBusy(false); } };
  const removePlugin = async (plugin: PluginRecord): Promise<void> => { if (!confirm(`确定移除插件“${plugin.name}”？`)) return; try { setPluginBusy(true); unwrap(await window.workbench.plugins.remove(plugin.id)); await loadPlugins(); onStatus(`已移除插件：${plugin.name}`); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } finally { setPluginBusy(false); } };
  const chooseProfileLocation = async (): Promise<void> => { try { setProfileLocation(unwrap(await window.workbench.data.chooseProfileLocation())); onStatus('浏览器数据目录已更新；重启应用后生效'); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } };
  const resetProfileLocation = async (): Promise<void> => { try { setProfileLocation(unwrap(await window.workbench.data.resetProfileLocation())); onStatus('已恢复默认浏览器数据目录；重启应用后生效'); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } };
  const restartForProfileLocation = (): void => { onStatus('正在重启应用以应用浏览器数据目录…'); void window.workbench.data.restart().catch((error: unknown) => onStatus(error instanceof Error ? error.message : String(error))); };
  const scanLegacyCache = async (): Promise<void> => { try { setCacheBusy(true); setCacheCleanReport(null); const value = unwrap(await window.workbench.maintenance.scanLegacyCache()); setCacheScan(value); onStatus(value.candidates.length ? `发现 ${value.candidates.length} 个旧版临时目录，可释放 ${formatBytes(value.totalBytes)}` : '未发现符合条件的旧版临时目录'); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } finally { setCacheBusy(false); } };
  const cleanLegacyCache = async (): Promise<void> => { if (!cacheScan?.candidates.length) return onStatus('没有可清理的旧版临时目录'); if (!confirm(`将删除 ${cacheScan.candidates.length} 个旧版临时目录，预计释放 ${formatBytes(cacheScan.totalBytes)}。只会处理旧版 DolaMultiBrowser 临时目录，继续吗？`)) return; try { setCacheBusy(true); const value = unwrap(await window.workbench.maintenance.cleanLegacyCache()); setCacheCleanReport(value); setCacheScan(value.remaining); onStatus(`旧版临时缓存清理完成：释放 ${formatBytes(value.freedBytes)}${value.failed.length ? `，失败 ${value.failed.length} 个` : ''}`); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } finally { setCacheBusy(false); } };
  const chooseDownloadDir = async (): Promise<void> => { try { const path = unwrap(await window.workbench.files.chooseDownloadDir()); onStatus(`普通下载目录：${path}`); await onChange({ downloadDir: path }); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } };
  const chooseVideoDownloadDir = async (): Promise<void> => { try { const path = unwrap(await window.workbench.files.chooseVideoDownloadDir()); onStatus(`视频下载目录：${path}`); await onChange({ videoDownloadDir: path }); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } };
  const openVideoDownloadDir = async (): Promise<void> => { try { unwrap(await window.workbench.files.openVideoDownloadDir()); onStatus('已打开视频下载目录'); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } };
  return <div className="settings-list"><div className="setting-row"><span><strong>工作台外观</strong><small>统一白色界面</small></span></div><label className="setting-row"><span><strong>实验性 15 秒响应适配</strong><small>默认启用；页面变化时可以关闭</small></span><input type="checkbox" checked={settings.experimentalResponsePatchEnabled} onChange={(event) => void onChange({ experimentalResponsePatchEnabled: event.target.checked })} /></label><label className="setting-row"><span><strong>按规则创建下载目录</strong><small>{settings.downloadDir}</small></span><input type="checkbox" checked={settings.useAccountDownloadSubfolders} onChange={(event) => void onChange({ useAccountDownloadSubfolders: event.target.checked })} /></label><label className="setting-row"><span><strong>Dola / 豆包视频使用平台目录与编号</strong><small>视频保存到独立平台目录，并按 1.mp4、2.mp4… 连续编号；关闭后使用上面的目录规则。</small></span><input type="checkbox" checked={settings.legacyVideoLayout} onChange={(event) => void onChange({ legacyVideoLayout: event.target.checked })} /></label><label className="setting-row"><span><strong>V5.2 素材目录兼容</strong><small>保存到根目录/Videos 与根目录/Images；视频使用 1.mp4、2.mp4…，图片使用时间戳命名；保留当前配置，按需开启。</small></span><input type="checkbox" checked={settings.legacyV44MediaFolders} onChange={(event) => void onChange({ legacyV44MediaFolders: event.target.checked })} /></label><label className="wide"><span><strong>普通资源文件名前缀</strong><small>应用到统一下载队列的普通图片/视频；Dola/豆包平台编号视频仍保持 1.mp4、2.mp4…</small></span><input value={settings.videoFilenamePrefix} onChange={(event) => void onChange({ videoFilenamePrefix: event.target.value })} placeholder="例如：项目A" /></label><label>目录规则<select value={settings.downloadFolderPattern} onChange={(event) => void onChange({ downloadFolderPattern: event.target.value as AppSettings['downloadFolderPattern'] })}><option value="account">账号</option><option value="platform">平台</option><option value="platform-account">平台 / 账号</option><option value="date">日期 / 账号</option></select></label><label>同时下载数<input type="number" min="1" max="6" value={settings.downloadConcurrency} onChange={(event) => void onChange({ downloadConcurrency: Number(event.target.value) })} /></label><label>失败重试次数<input type="number" min="0" max="5" value={settings.downloadRetryCount} onChange={(event) => void onChange({ downloadRetryCount: Number(event.target.value) })} /></label><div className="tool-box"><div className="section-heading"><strong>下载目录</strong><small>普通资源和视频可以分别保存；视频目录留空时跟随普通下载目录。</small></div><div className="directory-setting"><div><strong>普通下载目录</strong><small>{settings.downloadDir}</small></div><div className="account-tools"><button onClick={() => void chooseDownloadDir()}>更改</button><button onClick={() => window.workbench.files.openDownloadDir().then(unwrap).then(() => onStatus('已打开普通下载目录')).catch((error) => onStatus(error instanceof Error ? error.message : String(error)))}>打开</button></div></div><div className="directory-setting"><div><strong>视频下载目录</strong><small>{settings.videoDownloadDir || '跟随普通下载目录'}</small></div><div className="account-tools"><button onClick={() => void chooseVideoDownloadDir()}>更改</button><button onClick={() => void openVideoDownloadDir()}>打开</button></div></div></div><div className="tool-box"><div className="section-heading"><strong>外部登录浏览器</strong><small>留空会自动查找 Chrome/Edge；macOS 可填写自定义安装路径。</small></div><label className="wide">Chrome / Edge 可执行文件路径<input value={settings.externalBrowserPath} onChange={(event) => void onChange({ externalBrowserPath: event.target.value })} placeholder="例如：/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" /></label></div><div className="tool-box"><div className="section-heading"><strong>兼容播放工具</strong><small>视频预览转换只使用你指定或随应用携带的 FFmpeg，不影响原文件下载。</small></div><label className="wide">FFmpeg 路径（留空自动检测）<input value={settings.ffmpegPath} onChange={(event) => void onChange({ ffmpegPath: event.target.value })} placeholder="例如：/opt/homebrew/bin/ffmpeg" /></label><div className="account-tools"><button disabled={toolBusy} onClick={() => void checkFfmpeg()}>检测 FFmpeg</button>{toolStatus && <span className={toolStatus.available ? 'inline-status success' : 'inline-status error'}>{toolStatus.message}</span>}</div></div><div className="tool-box"><div className="section-heading"><strong>浏览器数据目录</strong><small>每个账号的 Cookie、LocalStorage、IndexedDB、缓存和扩展存储都在这里；切换只对 Electron Session 生效，不复制旧版 WebView2 数据库，需重启应用。</small></div><small className="form-hint">{profileLocation ? `配置目录：${profileLocation.path}${profileLocation.restartRequired ? `（当前仍使用：${profileLocation.activePath}）` : ''}` : '正在读取目录…'}</small><div className="account-tools"><button onClick={() => void chooseProfileLocation()}>更改目录</button><button onClick={() => void resetProfileLocation()}>恢复默认</button>{profileLocation?.restartRequired && <button className="primary" onClick={restartForProfileLocation}>立即重启</button>}</div></div><LegacyCachePanel scan={cacheScan} report={cacheCleanReport} busy={cacheBusy} onScan={() => void scanLegacyCache()} onClean={() => void cleanLegacyCache()} /><div className="update-box"><div><strong>公开更新</strong><small>{updateInfo ? (updateInfo.enabled ? (updateInfo.hasUpdate ? `发现 ${updateInfo.latestVersion}` : '当前已是最新版本') : '未配置更新仓库') : '未检查'}</small></div><div className="account-tools"><button onClick={() => void checkUpdate()}>检查更新</button>{updateInfo?.releaseUrl && <button onClick={() => void openRelease()}>打开发布页</button>}{updateInfo?.hasUpdate && <button className="primary" disabled={updateBusy} onClick={() => void downloadUpdate()}>下载更新</button>}</div></div><div className="boss-key"><strong>Boss Key / 快速隐藏</strong><label className="setting-row"><span><small>全局按键仅在应用运行时生效</small></span><input type="checkbox" checked={settings.bossKey.enabled} onChange={(event) => patchBossKey({ enabled: event.target.checked })} /></label><div className="form-grid"><label>按键<input maxLength={1} value={settings.bossKey.key} onChange={(event) => patchBossKey({ key: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'H' })} /></label><label className="switch-row"><input type="checkbox" checked={settings.bossKey.ctrl} onChange={(event) => patchBossKey({ ctrl: event.target.checked })} />Ctrl</label><label className="switch-row"><input type="checkbox" checked={settings.bossKey.alt} onChange={(event) => patchBossKey({ alt: event.target.checked })} />Alt</label><label className="switch-row"><input type="checkbox" checked={settings.bossKey.shift} onChange={(event) => patchBossKey({ shift: event.target.checked })} />Shift</label><label className="switch-row"><input type="checkbox" checked={settings.bossKey.meta} onChange={(event) => patchBossKey({ meta: event.target.checked })} />Command / Super</label></div></div><div className="adapter-switches"><strong>平台适配器</strong>{platforms.filter((item) => item.id !== 'custom').map((platform) => <label key={platform.id}><span>{platform.name}</span><input type="checkbox" checked={!settings.disabledAdapters.includes(platform.id)} onChange={(event) => toggleAdapter(platform.id, event.target.checked)} /></label>)}</div><div className="plugin-manager"><div className="section-heading"><strong>浏览器插件</strong><small>导入 ZIP / CRX 后安装到每个账号自己的 Session；插件下载会统一进入工作台队列。</small></div><div className="account-tools"><button disabled={pluginBusy} onClick={() => void importPlugin('package')}>导入 ZIP / CRX</button><button disabled={pluginBusy} onClick={() => void importPlugin('directory')}>导入目录</button><button disabled={pluginBusy} onClick={() => window.workbench.plugins.openFolder().then(unwrap).catch(onStatus)}>打开插件目录</button></div>{plugins.length ? <div className="plugin-list">{plugins.map((plugin) => <div className="plugin-row" key={plugin.id}><span><strong>{plugin.name}</strong><small>v{plugin.version || '未声明'} · Manifest V{plugin.manifestVersion}{plugin.description ? ` · ${plugin.description}` : ''}</small></span><label className="switch-row"><input type="checkbox" disabled={pluginBusy} checked={plugin.enabled} onChange={() => void togglePlugin(plugin)} />启用</label><button disabled={pluginBusy} onClick={() => void removePlugin(plugin)}>移除</button></div>)}</div> : <p className="form-hint">尚未导入自定义插件。内置平台适配器仍按平台自动加载。</p>}</div></div>;
}
function Library({ accounts, platforms, onStatus }: { accounts: Account[]; platforms: PlatformDefinition[]; onStatus(value: string): void }): React.JSX.Element {
  const empty: LibraryPage = { items: [], total: 0, page: 1, pageSize: 30, pages: 1 }; const [page, setPage] = useState(empty); const [search, setSearch] = useState(''); const [type, setType] = useState<'all'|'image'|'video'|'other'>('all'); const [account, setAccount] = useState(''); const [platform, setPlatform] = useState<PlatformId | ''>(''); const [dateFrom, setDateFrom] = useState(''); const [dateTo, setDateTo] = useState('');
  const refreshTimer = useRef<number | null>(null); const completedTaskIds = useRef(new Set<string>());
  const loadPage = useCallback((number: number) => window.workbench.files.list({ page: number, pageSize: 30, search, type, account, platform: platform || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }).then(unwrap).then(setPage).catch((e) => onStatus(e instanceof Error ? e.message : String(e))), [onStatus, search, type, account, platform, dateFrom, dateTo]);
  const load = useCallback((number = page.page) => loadPage(number), [loadPage, page.page]);
  const scheduleRefresh = useCallback((): void => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => { refreshTimer.current = null; void loadPage(1); }, 700);
  }, [loadPage]);
  useEffect(() => { void loadPage(1); }, [loadPage]);
  useEffect(() => {
    const offNative = window.workbench.files.onDownloaded(() => scheduleRefresh());
    const offTasks = window.workbench.media.onTasks((next) => {
      let completed = false;
      for (const task of next) {
        if (task.status !== 'completed' || completedTaskIds.current.has(task.id)) continue;
        completedTaskIds.current.add(task.id); completed = true;
      }
      if (completed) scheduleRefresh();
    });
    return () => { offNative(); offTasks(); if (refreshTimer.current !== null) { window.clearTimeout(refreshTimer.current); refreshTimer.current = null; } };
  }, [scheduleRefresh]);
  const filtered = Boolean(search) || type !== 'all' || Boolean(account) || Boolean(platform) || Boolean(dateFrom) || Boolean(dateTo);
  return <div className="library"><div className="library-toolbar filters"><input placeholder="搜索文件" value={search} onChange={(event) => setSearch(event.target.value)} /><select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="all">全部类型</option><option value="image">图片</option><option value="video">视频</option><option value="other">其他</option></select><select value={platform} onChange={(event) => setPlatform(event.target.value as PlatformId | '')}><option value="">全部平台</option>{platforms.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select value={account} onChange={(event) => setAccount(event.target.value)}><option value="">全部账号</option>{accounts.map((item) => <option value={item.name} key={item.id}>{item.name}</option>)}</select><input type="date" aria-label="开始日期" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /><input type="date" aria-label="结束日期" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /><button onClick={() => load()}>刷新</button><button onClick={() => window.workbench.files.openDownloadDir()}>打开目录</button><span>{page.total} 个文件</span></div>{page.items.length === 0 ? <div className="empty-list"><span>◇</span><strong>{filtered ? '没有匹配的文件' : '还没有下载文件'}</strong><p>{filtered ? '试试放宽筛选条件，或清空搜索关键词后重试。' : '完成一次下载后，文件会自动出现在这里。也可以直接打开下载目录查看。'}</p></div> : page.items.map((file) => <div className="file-row" draggable onDragStart={() => void window.workbench.files.drag(file.path)} key={file.path}><span className={`file-icon ${file.type}`}>{file.previewUrl && file.type === 'image' ? <img src={file.previewUrl} /> : file.previewUrl && file.type === 'video' ? <video src={file.previewUrl} muted preload="metadata" /> : file.type === 'video' ? '▶' : file.type === 'image' ? '▧' : '·'}</span><span><strong>{file.name}</strong><small>{file.relativePath} · {formatBytes(file.size)} · {new Date(file.modifiedAt).toLocaleString()}</small></span><div><button onClick={() => window.workbench.files.open(file.path)}>打开</button><button onClick={() => window.workbench.files.reveal(file.path)}>定位</button><button onClick={() => window.workbench.files.copyPath(file.path).then(() => onStatus('文件路径已复制'))}>复制路径</button><button onClick={() => { if (confirm(`确定删除“${file.name}”？此操作不可恢复。`)) void window.workbench.files.remove(file.path).then(unwrap).then(() => load()).catch((e) => onStatus(e instanceof Error ? e.message : String(e))); }}>删除</button></div></div>)}<div className="pagination"><button disabled={page.page <= 1} onClick={() => load(page.page - 1)}>上一页</button><span>{page.page} / {page.pages}</span><button disabled={page.page >= page.pages} onClick={() => load(page.page + 1)}>下一页</button></div></div>;
}

function LoginAssist({ accountId, onStatus }: { accountId: string; onStatus(value: string): void }): React.JSX.Element {
  const [running, setRunning] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { void window.workbench.browser.externalLoginStatus(accountId).then(unwrap).then((value) => setRunning(value.running)); }, [accountId]);
  const action = async (kind: 'start' | 'sync' | 'close'): Promise<void> => { try { setBusy(true); if (kind === 'start') { unwrap(await window.workbench.browser.externalLoginStart(accountId)); setRunning(true); onStatus('已打开 Chrome/Edge，请完成登录'); } else if (kind === 'sync') { const value = unwrap(await window.workbench.browser.externalLoginSync(accountId)); onStatus(`已同步 ${value.cookies} 个 Cookie，请刷新账号页面`); } else { unwrap(await window.workbench.browser.externalLoginClose(accountId)); setRunning(false); } } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  return <div className="login-assist"><p>使用系统 Chrome/Edge 完成第三方登录，然后将 Cookie 同步回当前隔离账号。软件不会读取或保存登录密码。</p><div><button className="primary" disabled={busy || running} onClick={() => action('start')}>打开登录浏览器</button><button disabled={busy || !running} onClick={() => action('sync')}>同步登录状态</button><button disabled={busy || !running} onClick={() => action('close')}>关闭辅助浏览器</button></div></div>;
}

function DolaBatch({ accounts, initialAccountId, dolaAspectRatio, onSettingsChange, onAccountsChanged, onStatus }: { accounts: Account[]; initialAccountId?: string; dolaAspectRatio: AppSettings['dolaAspectRatio']; onSettingsChange(patch: Partial<AppSettings>): Promise<void>; onAccountsChanged(): Promise<void>; onStatus(value: string): void }): React.JSX.Element {
  type Row = { email: string; password: string; status: string; busy: boolean };
  type Credential = { email: string; password: string; backupEmail: string; note: string; name: string };
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(accounts.map((account) => [account.id, { email: '', password: '', status: '等待', busy: false }])));
  const [batchText, setBatchText] = useState(''); const [batchGroup, setBatchGroup] = useState('Dola批量'); const [createBusy, setCreateBusy] = useState(false);
  const preferredTaskAccountId = initialAccountId && accounts.some((account) => account.id === initialAccountId) ? initialAccountId : '';
  const [taskAccountMode, setTaskAccountMode] = useState<'all' | 'single'>(() => preferredTaskAccountId ? 'single' : accounts.length > 1 ? 'all' : 'single');
  const [taskAccountId, setTaskAccountId] = useState(preferredTaskAccountId || accounts[0]?.id || '');
  const [prompt, setPrompt] = useState(''); const [aspectRatio, setAspectRatio] = useState<DolaAspectRatio>(() => parseDolaAspectRatio(localStorage.getItem('dola-video-ratio')) ?? dolaAspectRatio); const [duration, setDuration] = useState<15 | 30>(15); const [references, setReferences] = useState<string[]>([]); const [audioReferences, setAudioReferences] = useState<string[]>([]); const [videoReferences, setVideoReferences] = useState<string[]>([]); const [taskBusy, setTaskBusy] = useState(false); const [batchLoginBusy, setBatchLoginBusy] = useState(false); const [batchLoginMode, setBatchLoginMode] = useState<'embedded' | 'external'>('embedded'); const [calibrationAccountId, setCalibrationAccountId] = useState(accounts[0]?.id ?? ''); const [clickProfile, setClickProfile] = useState<DolaClickProfile>(defaultDolaClickProfile); const [calibrationBusy, setCalibrationBusy] = useState(false);
  const patch = (id: string, value: Partial<Row>): void => setRows((current) => ({ ...current, [id]: { ...current[id]!, ...value } }));
  useEffect(() => { localStorage.setItem('dola-video-ratio', aspectRatio); }, [aspectRatio]);
  useEffect(() => {
    const saved = parseDolaAspectRatio(localStorage.getItem('dola-video-ratio'));
    if (saved) {
      if (saved !== dolaAspectRatio) void onSettingsChange({ dolaAspectRatio: saved });
      return;
    }
    if (dolaAspectRatio !== aspectRatio) setAspectRatio(dolaAspectRatio);
  }, []);
  const changeAspectRatio = (value: DolaAspectRatio): void => { setAspectRatio(value); void onSettingsChange({ dolaAspectRatio: value }); };
  useEffect(() => { setRows((current) => Object.fromEntries(accounts.map((account) => [account.id, current[account.id] ?? { email: '', password: '', status: '等待', busy: false }]))); }, [accounts]);
  useEffect(() => {
    if (!accounts.length) { setTaskAccountId(''); setTaskAccountMode('single'); return; }
    if (!accounts.some((account) => account.id === taskAccountId)) setTaskAccountId(accounts[0]!.id);
    if (accounts.length <= 1) setTaskAccountMode('single');
  }, [accounts, taskAccountId]);
  useEffect(() => { if (!accounts.some((account) => account.id === calibrationAccountId)) setCalibrationAccountId(accounts[0]?.id ?? ''); }, [accounts, calibrationAccountId]);
  useEffect(() => { void window.workbench.settings.get().then(unwrap).then((value) => setClickProfile(value.dolaClickProfile)).catch(() => undefined); }, []);
  useEffect(() => { if (batchLoginMode === 'external') void window.workbench.browser.closeBatchWorkspace(); }, [batchLoginMode]);
  useEffect(() => () => { void window.workbench.browser.closeBatchWorkspace(); }, []);
   const ensureEmbeddedWorkspace = async (ids: string[] = accounts.map((account) => account.id)): Promise<void> => { if (batchLoginMode === 'embedded') unwrap(await window.workbench.browser.openBatchWorkspace(ids)); };
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
  const closeEmbeddedWorkspace = async (): Promise<void> => { try { unwrap(await window.workbench.browser.closeBatchWorkspace()); onStatus('已关闭内置批量登录窗口，账号页面已还原到主工作台'); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } };
  const addReferences = (paths: string[]): void => { setReferences((current) => [...new Set([...current, ...paths])].slice(0, 9)); };
  const chooseReferences = async (): Promise<void> => { try { addReferences(unwrap(await window.workbench.files.chooseImages())); onStatus('已选择 Dola 参考图'); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } };
  const dropReferences = (event: React.DragEvent<HTMLElement>): void => { event.preventDefault(); const paths: string[] = []; for (const file of Array.from(event.dataTransfer.files)) { try { const path = window.workbench.files.getPathForFile(file); if (path) paths.push(path); } catch { /* Ignore browser-internal drops. */ } } if (paths.length) { addReferences(paths); onStatus(`已添加 ${paths.length} 张参考图`); } };
  const addMediaReferences = (kind: DolaReferenceKind, paths: string[]): void => { const setter = kind === 'audio' ? setAudioReferences : setVideoReferences; setter((current) => [...new Set([...current, ...paths])].slice(0, 10)); };
  const chooseMediaReferences = async (kind: DolaReferenceKind): Promise<void> => { try { const paths = unwrap(await window.workbench.files.chooseDolaReferences(kind)); addMediaReferences(kind, paths); onStatus(`已选择 ${paths.length} 个参考${kind === 'audio' ? '音频' : '视频'}`); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } };
  const parseCredentials = (raw: string): Credential[] => {
    const seen = new Set<string>(); const result: Credential[] = [];
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim(); if (!line || line.startsWith('#')) continue;
      const parts = line.includes('----') ? line.split('----') : line.includes('|') ? line.split('|') : line.includes(',') ? line.split(',') : line.includes('\t') ? line.split('\t') : line.split(/\s+/);
      const email = String(parts[0] ?? '').trim(); const password = String(parts[1] ?? '').trim(); const note = parts.slice(2).join(' ').trim(); const backupEmail = note.split(/\s+/).find((item) => /@/.test(item)) ?? '';
      if (!email || !password || !/@/.test(email) || seen.has(email.toLowerCase())) continue;
      seen.add(email.toLowerCase()); result.push({ email, password, backupEmail, note, name: `Dola_${email.split('@')[0]!.replace(/[^\w.-]+/g, '_').slice(0, 60)}` });
    }
    return result;
  };
  const createBatchAccounts = async (): Promise<void> => {
    const credentials = parseCredentials(batchText);
    if (!credentials.length) return onStatus('没有识别到账号，请按“邮箱----密码”一行一个填写');
    if (credentials.length > MAX_STANDARD_ACCOUNT_CREATION) return onStatus(`一次最多创建 ${MAX_STANDARD_ACCOUNT_CREATION} 个 Dola 账号，请分批处理`);
    if (credentials.length > MAX_EMBEDDED_BATCH_WORKSPACE_ACCOUNTS && !confirm(`本次将创建 ${credentials.length} 个 Dola 账号，内置登录会按每批 ${MAX_EMBEDDED_BATCH_WORKSPACE_ACCOUNTS} 个分批处理，继续吗？`)) return;
    if (!confirm(`将创建 ${credentials.length} 个 Dola 账号，并把凭据仅保存在本窗口内存中，继续吗？`)) return;
    setCreateBusy(true); let created = 0; const credentialRows: Record<string, Row> = {};
    try {
      for (const credential of credentials) {
        try {
          const remark = credential.backupEmail ? `${credential.email} 备用邮箱:${credential.backupEmail}` : credential.note || credential.email;
          const account = unwrap(await window.workbench.accounts.create({ ...emptyInput, platform: 'dola', name: credential.name, group: batchGroup.trim(), remark }));
          credentialRows[account.id] = { email: credential.email, password: credential.password, status: '已创建，等待登录', busy: false }; created += 1;
        } catch (error) { onStatus(`${credential.email} 创建失败：${error instanceof Error ? error.message : String(error)}`); }
      }
      setRows((current) => ({ ...current, ...credentialRows }));
      await onAccountsChanged();
      setBatchText(''); onStatus(`已创建 ${created}/${credentials.length} 个 Dola 账号`);
    } finally { setCreateBusy(false); }
  };
  const calibrate = async (account: Account): Promise<void> => { try { patch(account.id, { busy: true, status: '正在识别登录入口…' }); let step: import('../../shared/contracts').DolaLoginStep; if (batchLoginMode === 'embedded') { await ensureEmbeddedWorkspace([account.id]); unwrap(await window.workbench.browser.open(account.id)); await new Promise((resolve) => setTimeout(resolve, 1200)); step = unwrap(await window.workbench.browser.dolaCalibrateEmbedded(account.id)); } else { unwrap(await window.workbench.browser.externalLoginStart(account.id)); await new Promise((resolve) => setTimeout(resolve, 1200)); step = unwrap(await window.workbench.browser.dolaCalibrate(account.id)); } patch(account.id, { status: step.message }); } catch (error) { patch(account.id, { status: error instanceof Error ? error.message : String(error) }); } finally { patch(account.id, { busy: false }); } };
  const run = async (account: Account, externalLayout?: ExternalBrowserLayout, ensureWorkspace = true): Promise<void> => { const row = rows[account.id]!; if (!row.email || !row.password) return patch(account.id, { status: '请填写邮箱和密码' }); patch(account.id, { busy: true, status: batchLoginMode === 'embedded' ? '打开内置页面…' : '启动外部浏览器…' }); try { if (batchLoginMode === 'embedded') { if (ensureWorkspace) await ensureEmbeddedWorkspace([account.id]); unwrap(await window.workbench.browser.open(account.id)); } else unwrap(await window.workbench.browser.externalLoginStart(account.id, externalLayout)); for (let attempt = 0; attempt < 40; attempt++) { const step = batchLoginMode === 'embedded' ? unwrap(await window.workbench.browser.dolaBatchFillEmbedded(account.id, row.email, row.password)) : unwrap(await window.workbench.browser.dolaBatchFill(account.id, row.email, row.password)); patch(account.id, { status: step.message }); if (step.manual) { if (batchLoginMode === 'external') { const ready = await waitForExternalDolaLogin(account); if (ready) { const synced = unwrap(await window.workbench.browser.externalLoginSync(account.id)); await window.workbench.browser.externalLoginClose(account.id); patch(account.id, { status: `完成 · ${synced.cookies} Cookies` }); return; } } break; } if (step.readyToSync) { if (batchLoginMode === 'external') { const synced = unwrap(await window.workbench.browser.externalLoginSync(account.id)); await window.workbench.browser.externalLoginClose(account.id); patch(account.id, { status: `完成 · ${synced.cookies} Cookies` }); } else patch(account.id, { status: '内置页面已显示登录态' }); return; } await new Promise((resolve) => setTimeout(resolve, 1500)); } } catch (error) { patch(account.id, { status: error instanceof Error ? error.message : String(error) }); } finally { patch(account.id, { busy: false }); } };
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
            if (index > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(index * 800, 8000)));
            await run(account, undefined, false);
          });
          if (batchIndex < batches.length - 1) await window.workbench.browser.closeBatchWorkspace();
        }
      } else {
        await runWithConcurrency(accounts, concurrency, async (account, index) => {
          await run(account, externalBrowserGridLayout(index, accounts.length), false);
        });
      }
      onStatus(batchLoginMode === 'embedded' ? 'Dola 内置批量填入流程已执行（每批最多 20 个、最多 4 个并发）；遇到验证码或 2FA 的账号请人工完成' : 'Dola 批量自动填入流程已执行（最多 10 个外部浏览器并发）；遇到验证码或 2FA 的账号请人工完成后再同步');
    } finally { setBatchLoginBusy(false); }
  };
  const syncAll = async (): Promise<void> => {
    if (batchLoginMode === 'embedded') return onStatus('内置 WebContentsView 模式会直接使用当前账号 Session，无需同步外部浏览器');
    setBatchLoginBusy(true); let synced = 0;
    try {
      for (const account of accounts) {
        try {
          const state = unwrap(await window.workbench.browser.externalLoginStatus(account.id));
          if (!state.running) continue;
          const value = unwrap(await window.workbench.browser.externalLoginSync(account.id));
          await window.workbench.browser.externalLoginClose(account.id);
          patch(account.id, { status: `已同步 · ${value.cookies} Cookies` }); synced += 1;
        } catch (error) { patch(account.id, { status: `同步失败：${error instanceof Error ? error.message : String(error)}` }); }
      }
      onStatus(`已同步 ${synced} 个 Dola 外部登录窗口`);
    } finally { setBatchLoginBusy(false); }
  };
  const copyCredential = async (account: Account, kind: 'email' | 'password'): Promise<void> => {
    const value = rows[account.id]?.[kind] ?? '';
    if (!value) return patch(account.id, { status: `请先填写${kind === 'email' ? '邮箱' : '密码'}` });
    try { unwrap(await window.workbench.files.copyText(value)); patch(account.id, { status: `${kind === 'email' ? '邮箱' : '密码'}已复制到剪贴板` }); }
    catch (error) { patch(account.id, { status: error instanceof Error ? error.message : String(error) }); }
  };
  const syncExternalRow = async (account: Account): Promise<void> => {
    patch(account.id, { busy: true, status: '正在同步外部登录态…' });
    try {
      const state = unwrap(await window.workbench.browser.externalLoginStatus(account.id));
      if (!state.running) return patch(account.id, { status: '外部浏览器未运行' });
      const synced = unwrap(await window.workbench.browser.externalLoginSync(account.id));
      await window.workbench.browser.externalLoginClose(account.id);
      patch(account.id, { status: `已同步 · ${synced.cookies} Cookies` });
    } catch (error) { patch(account.id, { status: error instanceof Error ? error.message : String(error) }); }
    finally { patch(account.id, { busy: false }); }
  };
  const checkLoginState = async (account: Account): Promise<void> => {
    patch(account.id, { busy: true, status: '正在检查 Dola 登录态…' });
    try {
      const state = unwrap(await window.workbench.browser.dolaLoginState(account.id));
      patch(account.id, { status: `${state.message} · ${state.cookieCount} 个目标 Cookie` });
    } catch (error) { patch(account.id, { status: error instanceof Error ? error.message : String(error) }); }
    finally { patch(account.id, { busy: false }); }
  };
  const captureClickPoint = async (target: DolaClickTarget): Promise<void> => {
    const account = accounts.find((item) => item.id === calibrationAccountId) ?? accounts[0];
    if (!account) return onStatus('请先创建一个 Dola 账号');
    setCalibrationBusy(true);
    try {
      unwrap(await window.workbench.browser.open(account.id));
      unwrap(await window.workbench.browser.activate(account.id, null));
      onStatus(`请在“${account.name}”页面中点击${target === 'login' ? '登录入口' : 'Google 登录入口'}；按 Esc 可取消`);
      const point = unwrap(await window.workbench.browser.dolaCaptureClickPoint(account.id, target));
      const saved = unwrap(await window.workbench.settings.get());
      setClickProfile(saved.dolaClickProfile);
      onStatus(`已保存${target === 'login' ? '登录' : 'Google'}点位（${Math.round(point.xRatio * 100)}%, ${Math.round(point.yRatio * 100)}%）`);
    } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); }
    finally { setCalibrationBusy(false); }
  };
  const testClickPoint = async (target: DolaClickTarget): Promise<void> => {
    const account = accounts.find((item) => item.id === calibrationAccountId) ?? accounts[0];
    if (!account) return onStatus('请先创建一个 Dola 账号');
    setCalibrationBusy(true);
    try {
      unwrap(await window.workbench.browser.open(account.id));
      unwrap(await window.workbench.browser.activate(account.id, null));
      const result = unwrap(await window.workbench.browser.dolaTestClickPoint(account.id, target));
      onStatus(result.message);
    } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); }
    finally { setCalibrationBusy(false); }
  };
  const resetClickProfile = async (): Promise<void> => {
    try {
      const saved = unwrap(await window.workbench.settings.update({ dolaClickProfile: defaultDolaClickProfile }));
      setClickProfile(saved.dolaClickProfile);
      onStatus('Dola 登录点位已恢复默认');
    } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); }
  };
  const taskAccounts = taskAccountMode === 'all' ? accounts : accounts.filter((account) => account.id === taskAccountId);
  const submitTask = async (account: Account): Promise<boolean> => {
    if (!prompt.trim()) { patch(account.id, { status: '请先填写视频提示词' }); return false; }
    patch(account.id, { busy: true, status: `正在准备 ${duration} 秒视频…` });
    try {
      unwrap(await window.workbench.browser.open(account.id));
      await new Promise((resolve) => setTimeout(resolve, 900));
      for (const [kind, paths] of [['audio', audioReferences], ['video', videoReferences]] as const) {
        if (!paths.length) continue;
        const uploaded = unwrap(await window.workbench.browser.dolaUploadReferences(account.id, kind, paths, aspectRatio, duration));
        patch(account.id, { status: uploaded.message });
        if (!uploaded.ok) return false;
        if (!uploaded.readyForSubmit) {
          patch(account.id, { status: `${uploaded.message}；上传完成后再提交任务` });
          return false;
        }
        await new Promise((resolve) => setTimeout(resolve, 1300));
      }
      const result = unwrap(await window.workbench.browser.dolaSubmitVideo(account.id, prompt, aspectRatio, duration, references));
      patch(account.id, { status: result.message });
      return result.ok;
    } catch (error) {
      patch(account.id, { status: error instanceof Error ? error.message : String(error) });
      return false;
    } finally { patch(account.id, { busy: false }); }
  };
  const submitAll = async (): Promise<void> => {
    if (!taskAccounts.length) return onStatus('请先选择一个 Dola 账号');
    if (!prompt.trim()) return onStatus('请先填写 Dola 视频提示词');
    setTaskBusy(true);
    try {
      let succeeded = 0; let failed = 0;
      for (const account of taskAccounts) { if (await submitTask(account)) succeeded += 1; else failed += 1; }
      onStatus(`Dola ${duration} 秒视频提交完成：成功 ${succeeded}，失败 ${failed}`);
    } finally { setTaskBusy(false); }
  };
  return <div className="dola-batch">
    <p>凭据仅保存在当前窗口内存中；“校准入口”会按当前页面 DOM 自动识别登录按钮。验证码、两步验证和通行密钥需要人工完成。</p>
    <div className="dola-create-box"><div className="section-heading"><strong>批量创建 Dola 账号</strong><small>兼容旧版“邮箱----密码----备用邮箱”格式；创建后密码只用于本次登录辅助，不写入账号配置。</small></div><textarea value={batchText} onChange={(event) => setBatchText(event.target.value)} rows={4} placeholder={'email1@example.com----password1----backup@example.com\nemail2@example.com----password2'} /><div className="form-grid"><label>默认分组<input value={batchGroup} onChange={(event) => setBatchGroup(event.target.value)} /></label><label>安全提示<span className="inline-status">最多 100 个；内置登录超过 20 个时分批处理；验证码/2FA 需人工完成</span></label></div><button className="primary" disabled={createBusy || !batchText.trim()} onClick={() => void createBatchAccounts()}>{createBusy ? '正在创建…' : '创建并加入登录列表'}</button></div>
    <div className="dola-login-mode"><div className="section-heading"><strong>批量登录方式</strong><small>{batchLoginMode === 'embedded' ? '使用应用内每个账号自己的 WebContentsView，不会为每个账号启动系统 Chrome。Google 弹窗也在 Electron 子窗口中打开。' : '使用系统 Chrome/Edge 独立辅助窗口，适合站点要求外部浏览器或内置页面兼容性不足的情况。'}</small></div><label>方式<select disabled={batchLoginBusy} value={batchLoginMode} onChange={(event) => setBatchLoginMode(event.target.value as 'embedded' | 'external')}><option value="embedded">内置 WebContentsView（推荐）</option><option value="external">系统 Chrome / Edge</option></select></label></div>
    <div className="dola-calibration-box"><div className="section-heading"><strong>登录点位校准</strong><small>旧版兼容的人工校准：先选择一个 Dola 账号，在页面覆盖层中点击实际按钮位置；点位只保存为窗口比例，跨分辨率更稳定。</small></div><div className="dola-calibration-controls"><label>校准账号<select disabled={calibrationBusy || batchLoginBusy} value={calibrationAccountId} onChange={(event) => setCalibrationAccountId(event.target.value)}>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label><span className="dola-point-status">登录 {Math.round(clickProfile.login.xRatio * 100)}% / {Math.round(clickProfile.login.yRatio * 100)}% · Google {Math.round(clickProfile.google.xRatio * 100)}% / {Math.round(clickProfile.google.yRatio * 100)}%</span><button disabled={calibrationBusy || batchLoginBusy || !accounts.length} onClick={() => void captureClickPoint('login')}>记录登录点</button><button disabled={calibrationBusy || batchLoginBusy || !accounts.length} onClick={() => void testClickPoint('login')}>测试登录点</button><button disabled={calibrationBusy || batchLoginBusy || !accounts.length} onClick={() => void captureClickPoint('google')}>记录 Google 点</button><button disabled={calibrationBusy || batchLoginBusy || !accounts.length} onClick={() => void testClickPoint('google')}>测试 Google 点</button><button disabled={calibrationBusy || batchLoginBusy} onClick={() => void resetClickProfile()}>恢复默认</button></div><p className="form-hint">建议顺序：记录登录点 → 测试登录点打开弹窗 → 记录 Google 点。Google 点校准需要先出现 Google 登录子窗口。</p></div>
    <div className="dola-task-box"><div className="section-heading"><strong>Dola 视频任务</strong><small>只驱动当前已登录页面的正常 UI；平台未开放的时长或权限不会被强制绕过。Ctrl/⌘ + Enter 快速提交</small></div><div className="dola-task-account"><div className="section-heading"><strong>任务账号</strong><small>可选择单个账号，也可选择全部账号批量提交。</small></div><select aria-label="Dola 任务账号" value={taskAccountMode === 'all' ? '__all__' : taskAccountId} onChange={(event) => { const value = event.target.value; if (value === '__all__') setTaskAccountMode('all'); else { setTaskAccountMode('single'); setTaskAccountId(value); } }}>{accounts.length > 1 && <option value="__all__">全部 Dola 账号（批量提交）</option>}{accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select><span className="dola-task-account-count">已选 {taskAccounts.length} 个</span></div><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void submitAll(); } }} onDragOver={(event) => event.preventDefault()} onDrop={dropReferences} placeholder="输入视频生成提示词（也可把参考图拖到这里）" rows={4} /><div className="form-grid"><label>视频时长<select value={duration} onChange={(event) => setDuration(Number(event.target.value) as 15 | 30)}><option value={15}>15 秒</option><option value={30}>30 秒</option></select></label><label>画幅<select value={aspectRatio} onChange={(event) => { const next = parseDolaAspectRatio(event.target.value); if (next) changeAspectRatio(next); }}>{dolaAspectRatioOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label></div><div className="reference-picker" onDragOver={(event) => event.preventDefault()} onDrop={dropReferences}><div className="account-tools"><button disabled={taskBusy} onClick={() => void chooseReferences()}>选择参考图</button><button disabled={taskBusy || references.length === 0} onClick={() => setReferences([])}>清除</button><span className="form-hint">可选，最多 9 张 JPG / PNG / WEBP · 也可拖入</span></div><div className="reference-list">{references.length ? references.map((path) => <span key={path} title={path}>{path.split(/[\\/]/).pop()}</span>) : <span className="form-hint">未选择参考图</span>}</div></div><div className="reference-picker media-reference-picker"><div className="account-tools"><button disabled={taskBusy} onClick={() => void chooseMediaReferences('audio')}>选择参考音频</button><button disabled={taskBusy || audioReferences.length === 0} onClick={() => setAudioReferences([])}>清除</button><span className="form-hint">MP3 / WAV，最多 10 个；提交时通过 Dola 官方上传管线处理</span></div><div className="reference-list">{audioReferences.length ? audioReferences.map((path) => <span key={path} title={path}>{path.split(/[\\/]/).pop()}</span>) : <span className="form-hint">未选择参考音频</span>}</div><div className="account-tools"><button disabled={taskBusy} onClick={() => void chooseMediaReferences('video')}>选择参考视频</button><button disabled={taskBusy || videoReferences.length === 0} onClick={() => setVideoReferences([])}>清除</button><span className="form-hint">MP4 / MOV，最多 10 个；提交时通过 Dola 官方上传管线处理</span></div><div className="reference-list">{videoReferences.length ? videoReferences.map((path) => <span key={path} title={path}>{path.split(/[\\/]/).pop()}</span>) : <span className="form-hint">未选择参考视频</span>}</div></div><div className="account-tools"><button disabled={taskBusy || !prompt.trim() || !taskAccounts[0]} onClick={() => taskAccounts[0] && void submitTask(taskAccounts[0])}>提交选中账号</button><button className="primary" disabled={taskBusy || !prompt.trim() || !taskAccounts.length} onClick={() => void submitAll()}>依次提交选中账号</button></div></div>
    <div className="dola-table">{accounts.map((account) => <div className="dola-row" key={account.id}><strong>{account.name}</strong><input type="email" placeholder="Google 邮箱" value={rows[account.id]?.email ?? ''} onChange={(event) => patch(account.id, { email: event.target.value })} /><input type="password" placeholder="密码" value={rows[account.id]?.password ?? ''} onChange={(event) => patch(account.id, { password: event.target.value })} /><span>{rows[account.id]?.status}</span><div className="dola-row-actions"><button disabled={rows[account.id]?.busy || taskBusy || batchLoginBusy} onClick={() => void copyCredential(account, 'email')}>复制邮箱</button><button disabled={rows[account.id]?.busy || taskBusy || batchLoginBusy} onClick={() => void copyCredential(account, 'password')}>复制密码</button>{batchLoginMode === 'external' && <button disabled={rows[account.id]?.busy || taskBusy || batchLoginBusy} onClick={() => void syncExternalRow(account)}>同步</button>}<button disabled={rows[account.id]?.busy || taskBusy || batchLoginBusy} onClick={() => void checkLoginState(account)}>检查登录态</button><button disabled={rows[account.id]?.busy || taskBusy || batchLoginBusy} onClick={() => calibrate(account)}>校准入口</button><button disabled={rows[account.id]?.busy || taskBusy || batchLoginBusy} onClick={() => run(account)}>开始/继续登录</button><button disabled={rows[account.id]?.busy || taskBusy || batchLoginBusy || !prompt.trim()} onClick={() => void submitTask(account)}>提交视频</button></div></div>)}</div><div className="account-tools dola-batch-actions"><button className="primary" disabled={batchLoginBusy || taskBusy} onClick={() => void runAll()}>{batchLoginMode === 'embedded' ? '并行填入内置页面（最多4）' : '并行自动填入（最多10）'}</button><button disabled={batchLoginBusy || taskBusy || batchLoginMode === 'embedded'} onClick={() => void syncAll()}>同步全部外部窗口</button>{batchLoginMode === 'embedded' && <button disabled={batchLoginBusy || taskBusy} onClick={() => void closeEmbeddedWorkspace()}>关闭内置窗口</button>}</div>
  </div>;
}

function HiggsfieldBatch({ accounts, onAccountsChanged, onStatus }: { accounts: Account[]; onAccountsChanged(): Promise<void>; onStatus(value: string): void }): React.JSX.Element {
  type Row = { email: string; password: string; status: string; busy: boolean };
  type Credential = { email: string; password: string; note: string; name: string };
  const platform: BatchLoginPlatform = 'higgsfield';
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(accounts.map((account) => [account.id, { email: '', password: '', status: '等待', busy: false }])));
  const [batchText, setBatchText] = useState(''); const [batchGroup, setBatchGroup] = useState('Higgsfield批量'); const [createBusy, setCreateBusy] = useState(false);
  const [batchLoginBusy, setBatchLoginBusy] = useState(false); const [batchLoginMode, setBatchLoginMode] = useState<'embedded' | 'external'>('embedded');
  const patch = (id: string, value: Partial<Row>): void => setRows((current) => ({ ...current, [id]: { ...current[id]!, ...value } }));
  useEffect(() => { setRows((current) => Object.fromEntries(accounts.map((account) => [account.id, current[account.id] ?? { email: '', password: '', status: '等待', busy: false }]))); }, [accounts]);
  useEffect(() => { if (batchLoginMode === 'external') void window.workbench.browser.closeBatchWorkspace(); }, [batchLoginMode]);
  useEffect(() => () => { void window.workbench.browser.closeBatchWorkspace(); }, []);
  const ensureEmbeddedWorkspace = async (ids: string[] = accounts.map((account) => account.id)): Promise<void> => { if (batchLoginMode === 'embedded') unwrap(await window.workbench.browser.openBatchWorkspace(ids)); };
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
  const closeEmbeddedWorkspace = async (): Promise<void> => { try { unwrap(await window.workbench.browser.closeBatchWorkspace()); onStatus('已关闭内置批量登录窗口，账号页面已还原到主工作台'); } catch (error) { onStatus(error instanceof Error ? error.message : String(error)); } };
  const parseCredentials = (raw: string): Credential[] => {
    const seen = new Set<string>(); const result: Credential[] = [];
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim(); if (!line || line.startsWith('#')) continue;
      const parts = line.includes('----') ? line.split('----') : line.includes('|') ? line.split('|') : line.includes(',') ? line.split(',') : line.includes('\t') ? line.split('\t') : line.split(/\s+/);
      const email = String(parts[0] ?? '').trim(); const password = String(parts[1] ?? '').trim(); const note = parts.slice(2).join(' ').trim();
      if (!email || !password || !/@/.test(email) || seen.has(email.toLowerCase())) continue;
      seen.add(email.toLowerCase()); result.push({ email, password, note, name: `Higgsfield_${email.split('@')[0]!.replace(/[^\w.-]+/g, '_').slice(0, 60)}` });
    }
    return result;
  };
  const createBatchAccounts = async (): Promise<void> => {
    const credentials = parseCredentials(batchText);
    if (!credentials.length) return onStatus('没有识别到账号，请按“邮箱----密码”一行一个填写');
    if (credentials.length > MAX_STANDARD_ACCOUNT_CREATION) return onStatus(`一次最多创建 ${MAX_STANDARD_ACCOUNT_CREATION} 个 Higgsfield 账号，请分批处理`);
    if (credentials.length > MAX_EMBEDDED_BATCH_WORKSPACE_ACCOUNTS && !confirm(`本次将创建 ${credentials.length} 个 Higgsfield 账号，内置登录会按每批 ${MAX_EMBEDDED_BATCH_WORKSPACE_ACCOUNTS} 个分批处理，继续吗？`)) return;
    if (!confirm(`将创建 ${credentials.length} 个 Higgsfield 账号，并把凭据仅保存在本窗口内存中，继续吗？`)) return;
    setCreateBusy(true); let created = 0; const credentialRows: Record<string, Row> = {};
    try {
      for (const credential of credentials) {
        try {
          const account = unwrap(await window.workbench.accounts.create({ ...emptyInput, platform, name: credential.name, group: batchGroup.trim(), remark: credential.note || credential.email }));
          credentialRows[account.id] = { email: credential.email, password: credential.password, status: '已创建，等待登录', busy: false }; created += 1;
        } catch (error) { onStatus(`${credential.email} 创建失败：${error instanceof Error ? error.message : String(error)}`); }
      }
      setRows((current) => ({ ...current, ...credentialRows })); await onAccountsChanged(); setBatchText(''); onStatus(`已创建 ${created}/${credentials.length} 个 Higgsfield 账号`);
    } finally { setCreateBusy(false); }
  };
  const calibrate = async (account: Account): Promise<void> => {
    try {
      patch(account.id, { busy: true, status: '正在识别登录入口…' });
      const step = batchLoginMode === 'embedded'
        ? (await ensureEmbeddedWorkspace([account.id]), unwrap(await window.workbench.browser.open(account.id)), await new Promise((resolve) => setTimeout(resolve, 1200)), unwrap(await window.workbench.browser.batchLoginCalibrateEmbedded(account.id, platform)))
        : (unwrap(await window.workbench.browser.externalLoginStart(account.id)), await new Promise((resolve) => setTimeout(resolve, 1200)), unwrap(await window.workbench.browser.batchLoginCalibrate(account.id, platform)));
      patch(account.id, { status: step.message });
    } catch (error) { patch(account.id, { status: error instanceof Error ? error.message : String(error) }); }
    finally { patch(account.id, { busy: false }); }
  };
  const run = async (account: Account, externalLayout?: ExternalBrowserLayout, ensureWorkspace = true): Promise<void> => {
    const row = rows[account.id]!; if (!row.email || !row.password) return patch(account.id, { status: '请填写邮箱和密码' });
    patch(account.id, { busy: true, status: batchLoginMode === 'embedded' ? '打开内置页面…' : '启动外部浏览器…' });
    try {
      if (batchLoginMode === 'embedded') { if (ensureWorkspace) await ensureEmbeddedWorkspace([account.id]); unwrap(await window.workbench.browser.open(account.id)); } else unwrap(await window.workbench.browser.externalLoginStart(account.id, externalLayout));
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const step = batchLoginMode === 'embedded'
          ? unwrap(await window.workbench.browser.batchLoginFillEmbedded(account.id, row.email, row.password, platform))
          : unwrap(await window.workbench.browser.batchLoginFill(account.id, row.email, row.password, platform));
        patch(account.id, { status: step.message });
        if (step.manual) {
          if (batchLoginMode === 'external') {
            const ready = await waitForExternalLogin(account);
            if (ready) {
              const synced = unwrap(await window.workbench.browser.externalLoginSync(account.id));
              await window.workbench.browser.externalLoginClose(account.id);
              patch(account.id, { status: `完成 · ${synced.cookies} Cookies` });
              return;
            }
          }
          break;
        }
        if (step.readyToSync) {
          if (batchLoginMode === 'external') { const synced = unwrap(await window.workbench.browser.externalLoginSync(account.id)); await window.workbench.browser.externalLoginClose(account.id); patch(account.id, { status: `完成 · ${synced.cookies} Cookies` }); }
          else patch(account.id, { status: '内置页面已显示登录态' });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    } catch (error) { patch(account.id, { status: error instanceof Error ? error.message : String(error) }); }
    finally { patch(account.id, { busy: false }); }
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
            if (index > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(index * 800, 8000)));
            await run(account, undefined, false);
          });
          if (batchIndex < batches.length - 1) await window.workbench.browser.closeBatchWorkspace();
        }
      } else {
        await runWithConcurrency(accounts, concurrency, async (account, index) => {
          await run(account, externalBrowserGridLayout(index, accounts.length), false);
        });
      }
      onStatus(`Higgsfield ${batchLoginMode === 'embedded' ? '内置' : '外部'}批量填入流程已执行（${batchLoginMode === 'embedded' ? '每批最多 20 个、' : ''}最多 ${concurrency} 个并发）；遇到验证码或 2FA 的账号请人工完成`);
    } finally { setBatchLoginBusy(false); }
  };
  const syncAll = async (): Promise<void> => {
    if (batchLoginMode === 'embedded') return onStatus('内置 WebContentsView 模式会直接使用当前账号 Session，无需同步外部浏览器');
    setBatchLoginBusy(true); let synced = 0;
    try {
      for (const account of accounts) {
        try {
          const state = unwrap(await window.workbench.browser.externalLoginStatus(account.id)); if (!state.running) continue;
          const value = unwrap(await window.workbench.browser.externalLoginSync(account.id)); await window.workbench.browser.externalLoginClose(account.id); patch(account.id, { status: `已同步 · ${value.cookies} Cookies` }); synced += 1;
        } catch (error) { patch(account.id, { status: `同步失败：${error instanceof Error ? error.message : String(error)}` }); }
      }
      onStatus(`已同步 ${synced} 个 Higgsfield 外部登录窗口`);
    } finally { setBatchLoginBusy(false); }
  };
  return <div className="dola-batch">
    <p>Higgsfield 批量登录复用账号独立 Session；内置模式不启动系统 Chrome。凭据只在当前窗口内存中使用，验证码、两步验证和通行密钥需要人工完成。</p>
    <div className="dola-create-box"><div className="section-heading"><strong>批量创建 Higgsfield 账号</strong><small>兼容“邮箱----密码”等格式；密码不写入账号配置。</small></div><textarea value={batchText} onChange={(event) => setBatchText(event.target.value)} rows={4} placeholder={'email1@example.com----password1\nemail2@example.com----password2'} /><div className="form-grid"><label>默认分组<input value={batchGroup} onChange={(event) => setBatchGroup(event.target.value)} /></label><label>安全提示<span className="inline-status">最多 100 个；内置登录超过 20 个时分批处理；验证码/2FA 需人工完成</span></label></div><button className="primary" disabled={createBusy || !batchText.trim()} onClick={() => void createBatchAccounts()}>{createBusy ? '正在创建…' : '创建并加入登录列表'}</button></div>
    <div className="dola-login-mode"><div className="section-heading"><strong>批量登录方式</strong><small>{batchLoginMode === 'embedded' ? '使用应用内每个账号自己的 WebContentsView；Google 弹窗也在 Electron 子窗口中打开。' : '使用系统 Chrome/Edge 独立辅助窗口，完成后可把 Cookie 同步回账号 Session。'}</small></div><label>方式<select disabled={batchLoginBusy} value={batchLoginMode} onChange={(event) => setBatchLoginMode(event.target.value as 'embedded' | 'external')}><option value="embedded">内置 WebContentsView（推荐）</option><option value="external">系统 Chrome / Edge</option></select></label></div>
    <div className="dola-calibration-box"><div className="section-heading"><strong>登录入口检查</strong><small>按当前页面 DOM 识别可见登录控件，不调用私有登录接口。</small></div><p className="form-hint">Higgsfield 不复用 Dola 的固定点位；如果页面改版导致 DOM 无法识别，请在页面中手动点击入口后继续。</p></div>
    <div className="dola-table">{accounts.map((account) => <div className="dola-row" key={account.id}><strong>{account.name}</strong><input type="email" placeholder="Google 邮箱" value={rows[account.id]?.email ?? ''} onChange={(event) => patch(account.id, { email: event.target.value })} /><input type="password" placeholder="密码" value={rows[account.id]?.password ?? ''} onChange={(event) => patch(account.id, { password: event.target.value })} /><span>{rows[account.id]?.status}</span><div className="dola-row-actions"><button disabled={rows[account.id]?.busy || batchLoginBusy} onClick={() => void calibrate(account)}>校准入口</button><button disabled={rows[account.id]?.busy || batchLoginBusy} onClick={() => void run(account)}>开始/继续登录</button></div></div>)}</div><div className="account-tools dola-batch-actions"><button className="primary" disabled={batchLoginBusy} onClick={() => void runAll()}>{batchLoginMode === 'embedded' ? '并行填入内置页面（最多4）' : '并行自动填入（最多10）'}</button><button disabled={batchLoginBusy || batchLoginMode === 'embedded'} onClick={() => void syncAll()}>同步全部外部窗口</button>{batchLoginMode === 'embedded' && <button disabled={batchLoginBusy} onClick={() => void closeEmbeddedWorkspace()}>关闭内置窗口</button>}</div>
  </div>;
}
