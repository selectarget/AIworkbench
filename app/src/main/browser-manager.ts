import { app, BrowserWindow, WebContentsView, dialog, session, shell, type DownloadItem, type Event as ElectronEvent, type Rectangle, type WebContents } from 'electron';
import { basename, extname, join, resolve } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { DoubaoHistoryCleanupResult } from '../shared/contracts';
import { buildDoubaoHistoryScript, DOUBAO_HISTORY_URL, isDoubaoHistoryUrl, type DoubaoHistoryPageResult } from './doubao-history';
import type { Account, BatchLoginPlatform, BrowserDiagnostic, DolaResourceReference, DoubaoDuration, DoubaoDurationResult, DoubaoPromptResult, DolaClickPoint, DolaClickTarget, DolaLoginStep, DolaReferenceKind, DolaReferenceUploadResult, DolaReferenceUploadStatus, DolaVideoTaskResult, NativeDownloadNotice, PlatformId, ProxyTestResult, SessionDataKind, StorageImportBundle, ViewLayout } from '../shared/contracts';
import { channels } from '../shared/channels';
import { adapters, responsePatchHeaders } from './adapters';
import { parseMediaPayload } from './media-parser';
import { installSiteRequestCompatibility } from './site-request-compatibility';
import type { AccountService } from './accounts';
import type { SettingsService } from './settings';
import { buildProxyRules } from './proxy-rules';
import type { ProxyService } from './proxy';
import { adaptFingerprintProfile, createFingerprintProfile, FingerprintService } from './fingerprint';
import { decodeDolaMainUrl, DolaVideoResolver, extractDolaFallbackApis } from './dola-resolver';
import { buildDolaVideoPreparationScript, buildDolaVideoSubmissionScript, buildDolaVideoTaskScript } from './dola-task';
import type { PluginService } from './plugins';
import { resolveProxyCredentials } from './proxy-credentials';
import { buildDolaCalibrationScript, buildDolaClickCaptureScript, buildDolaLoginStepScript, normalizeDolaClickPoint, normalizeDolaLoginStep } from './dola-login';
import { buildDoubao15sPromptSendScript, buildDoubaoDurationControlScript, buildDoubao15sFloatingScript } from './doubao-task';
import { buildStorageImportScript } from './storage-import';
import { buildDolaReferenceInputDispatchScript, buildDolaReferenceInputPreparationScript, buildDolaReferenceUploadStatusScript, validateDolaMediaReferencePaths } from './dola-media';
import { normalizeNavigationUrl } from './path-utils';
import { mediaTypeFromExtension, mediaTypeFromMimeType } from './media-formats';
import { clearSessionData } from './session-cleanup';
import { WebSocketDiagnosticTracker } from './network-diagnostics';
import { setMediaRequestProxyAuth } from './media-request';
import { acceptsDoubaoCreationCapture } from './media-capture-scope';
import { parseDoubaoPlayInfoResponse } from './doubao-play-info';

type Entry = { view: WebContentsView; accountId: string };
type OpeningTask = { promise: Promise<void>; cancelled: boolean };
type DolaCompletionObservation = { url: string; inspection: DolaCompletionInspection };
type DolaCompletionObserver = { promise: Promise<DolaCompletionObservation | null>; dispose: () => void };
type DolaReferenceUploadObservation = {
  inputCount: number;
  expectedCount: number;
  available: boolean;
  matchedCount: number;
  boundCount: number;
  pendingCount: number;
  failedCount: number;
  readyForSubmit: boolean;
  status: DolaReferenceUploadStatus;
};

/**
 * Network.loadingFinished does not carry the response URL. Keep the original
 * URL captured at Network.responseReceived so the authenticated fallback fetch
 * gets the same page context as the response that exposed it.
 */
export function isDolaExternalVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (!(host === 'dola.com' || host.endsWith('.dola.com') || host === 'ciciai.com' || host.endsWith('.ciciai.com'))) return false;
    const text = `${parsed.pathname}?${parsed.search}`.toLowerCase();
    return text.includes('/video/') || text.includes('.mp4') || text.includes('.m3u8') || text.includes('mime_type=video') || text.includes('content-type=video') || text.includes('video_mp4');
  } catch {
    return false;
  }
}

export function dolaFallbackReferer(responseUrl: string): string {
  try {
    const url = new URL(responseUrl);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch { /* Fall back to the public Dola entry point for malformed data. */ }
  return adapters.dola.definition.url;
}

/**
 * Native Chromium downloads are not necessarily media resources.  In
 * particular, a site may trigger a PDF/ZIP/JSON download from the same page
 * that exposes images and videos.  Only downloads with a trustworthy media
 * signal should be routed through MediaService; everything else must retain
 * Electron's normal download behavior.
 */
export function classifyNativeDownload(filename: string, url: string, mimeType = ''): 'image' | 'video' | null {
  const filenameHint = filename.toLowerCase();
  const urlHint = url.toLowerCase();
  const decodedUrlHint = (() => {
    try { return decodeURIComponent(urlHint); } catch { return urlHint; }
  })();
  const hint = `${filenameHint} ${urlHint} ${decodedUrlHint}`;
  const mime = mimeType.trim().toLowerCase().split(';', 1)[0] ?? '';
  const mimeKind = mediaTypeFromMimeType(mime);
  const filenameKind = mediaTypeFromExtension(filenameHint);
  const urlKind = mediaTypeFromExtension(urlHint);
  // Some legacy endpoints use values such as `video_mp4`, `video/mp4`,
  // or `image_webp` in a query parameter while leaving both the URL and
  // Content-Disposition filename extensionless.  These are still explicit
  // media signals; accepting the suffix prevents them from silently falling
  // through to Chromium's ordinary download path.
  if (mimeKind === 'video' || filenameKind === 'video' || urlKind === 'video' || /(?:mime|content)[_-]?type\s*=\s*video(?:[\/_-][a-z0-9.+-]+)?(?:[&?#]|$)/i.test(hint) || /\/(?:video|vod|stream)\/(?:fplay|download|media|tos)(?:[/?]|$)/i.test(urlHint)) return 'video';
  if (mimeKind === 'image' || filenameKind === 'image' || urlKind === 'image' || /(?:mime|content)[_-]?type\s*=\s*image(?:[\/_-][a-z0-9.+-]+)?(?:[&?#]|$)/i.test(hint)) return 'image';
  return null;
}

const PROGRAMMATIC_DOWNLOAD_TTL_MS = 30_000;
const DUPLICATE_DOWNLOAD_WINDOW_MS = 12_000;

function normalizeProgrammaticDownloadUrl(value: string): string {
  return String(value ?? '').trim();
}

/**
 * The legacy Electron build marked direct/programmatic downloads before the
 * page's Chromium download event arrived.  It then cancelled a matching
 * `will-download` event for a short window so one click could not produce two
 * files.  Keep both an account-scoped and a global mark: the latter also
 * covers downloads raised on Electron's default session.
 */
export class ProgrammaticDownloadGuard {
  private readonly marks = new Map<string, number>();

  mark(accountId: string, url: string, now = Date.now()): void {
    const normalizedUrl = normalizeProgrammaticDownloadUrl(url);
    if (!normalizedUrl) return;
    this.prune(now);
    this.marks.set(this.key('', normalizedUrl), now);
    const normalizedAccountId = String(accountId ?? '').trim();
    if (normalizedAccountId) this.marks.set(this.key(normalizedAccountId, normalizedUrl), now);
  }

  shouldCancel(accountId: string, url: string, now = Date.now()): boolean {
    const normalizedUrl = normalizeProgrammaticDownloadUrl(url);
    if (!normalizedUrl) return false;
    this.prune(now);
    const normalizedAccountId = String(accountId ?? '').trim();
    const timestamps = [
      this.marks.get(this.key('', normalizedUrl)),
      normalizedAccountId ? this.marks.get(this.key(normalizedAccountId, normalizedUrl)) : undefined
    ];
    return timestamps.some((timestamp) => timestamp !== undefined && timestamp <= now && now - timestamp < DUPLICATE_DOWNLOAD_WINDOW_MS);
  }

  clear(): void { this.marks.clear(); }

  private key(accountId: string, url: string): string { return `${accountId}\u0000${url}`; }

  private prune(now: number): void {
    for (const [key, timestamp] of this.marks) {
      if (timestamp > now) continue;
      // Future timestamps are retained; this avoids deleting a mark if the
      // system clock moves backwards between the two events.
      if (now - timestamp >= PROGRAMMATIC_DOWNLOAD_TTL_MS) this.marks.delete(key);
    }
  }
}

export type DolaCompletionInspection = {
  detected: boolean;
  abilityType?: number;
  duration?: number;
  model?: string;
  matchesExpected?: boolean;
};

function findDolaVideoAbility(value: unknown, depth = 0, seen = new Set<object>()): Record<string, unknown> | null {
  if (value == null || depth > 8) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null;
    try { return findDolaVideoAbility(JSON.parse(trimmed), depth + 1, seen); } catch { return null; }
  }
  if (typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDolaVideoAbility(item, depth + 1, seen);
      if (found) return found;
    }
    return null;
  }
  const object = value as Record<string, unknown>;
  for (const key of ['chat_ability', 'chatAbility', 'ability']) {
    const candidate = object[key];
    if (!candidate) continue;
    const parsed = typeof candidate === 'string'
      ? (() => { try { return JSON.parse(candidate) as unknown; } catch { return null; } })()
      : candidate;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const ability = parsed as Record<string, unknown>;
      if (Number(ability.ability_type ?? ability.abilityType ?? ability.type) === 17) return ability;
    }
  }
  if (Number(object.ability_type ?? object.abilityType) === 17) return object;
  for (const child of Object.values(object)) {
    const found = findDolaVideoAbility(child, depth + 1, seen);
    if (found) return found;
  }
  return null;
}

export function inspectDolaCompletionBody(body: string, expectedDuration?: 15 | 30): DolaCompletionInspection {
  if (!body || body.length > 15_000_000) return { detected: false };
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { return { detected: false }; }
  const ability = findDolaVideoAbility(payload);
  if (!ability) return { detected: false };
  const rawParam = ability.ability_param ?? ability.abilityParam;
  let param: Record<string, unknown> = ability;
  if (typeof rawParam === 'string') {
    try {
      const parsed = JSON.parse(rawParam) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) param = parsed as Record<string, unknown>;
    } catch { /* The request is still a video ability; the site may use an opaque parameter string. */ }
  } else if (rawParam && typeof rawParam === 'object' && !Array.isArray(rawParam)) {
    param = rawParam as Record<string, unknown>;
  }
  const durationValue = Number(param.duration ?? param.duration_seconds ?? param.durationSeconds);
  const modelValue = String(param.model ?? param.model_name ?? param.modelName ?? '').trim();
  const duration = Number.isFinite(durationValue) && durationValue > 0 ? durationValue : undefined;
  const model = modelValue || undefined;
  return {
    detected: true,
    abilityType: Number(ability.ability_type ?? ability.abilityType ?? ability.type) || undefined,
    duration,
    model,
    matchesExpected: expectedDuration === undefined || duration === undefined || duration === expectedDuration
  };
}

function isDolaCompletionUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    return (host === 'dola.com' || host.endsWith('.dola.com') || host === 'ciciai.com' || host.endsWith('.ciciai.com')) && url.pathname === '/chat/completion';
  } catch { return false; }
}

export class BrowserManager {
  private readonly entries = new Map<string, Entry>();
  private readonly opening = new Map<string, OpeningTask>();
  private readonly clearingDoubaoHistory = new Set<string>();
  private readonly loginPopups = new Map<string, Set<BrowserWindow>>();
  private primaryId: string | null = null;
  private secondaryId: string | null = null;
  private layout: ViewLayout = { primary: { x: 0, y: 0, width: 0, height: 0 } };
  private mediaSink: ((accountId: string, resource: unknown) => void) | null = null;
  private siteDownloadSink: ((accountId: string, resource: unknown) => void) | null = null;
  private nativeDownloadSink: ((notice: NativeDownloadNotice) => void) | null = null;
  private nativeDownloadPathResolver: ((accountId: string, filename: string) => string) | null = null;
  private nativeDownloadPathRelease: ((path: string) => void) | null = null;
  private readonly programmaticDownloadGuard = new ProgrammaticDownloadGuard();
  private readonly configuredSessions = new Set<string>();
  private readonly downloadListenerDisposers = new Map<string, () => void>();
  private readonly permissionGrants = new Map<string, Set<string>>();
  private readonly networkResponses = new Map<string, { accountId: string; platform: Account['platform']; url: string }>();
  private readonly recovering = new Set<string>();
  private readonly dolaResolver = new DolaVideoResolver();
  private readonly resolvedDolaFallbackApis = new Set<string>();
  private readonly doubaoPlayInfoApis = new Map<string, string>();
  private readonly resolvingDolaFallbackApis = new Map<string, symbol>();
  private resolverDiagnosticSink: ((message: string) => void) | null = null;
  private networkDiagnosticSink: ((level: 'info' | 'warn', message: string) => void) | null = null;
  /**
   * Extensions belong to the persistent Session, not to a single
   * WebContentsView. Keep their ids so a platform switch can unload the old
   * adapter instead of leaving its content scripts active in the account.
   */
  private readonly builtInExtensionIds = new Map<string, Map<string, string>>();
  private readonly customExtensionIds = new Map<string, Map<string, string>>();
  /**
   * Keep adapter script names that were registered for the next document.
   * The old Electron build got this ordering from its preload/content-script
   * pipeline; a did-finish-load call is too late for first-load XHR/SSE and
   * media URLs. The post-load path remains a fallback when CDP is unavailable.
   */
  private readonly documentScriptNames = new Map<string, Set<string>>();
  /**
   * Names injected by the post-load fallback for the current document.
   * Unlike documentScriptNames (which tracks CDP registrations that survive
   * navigation), this set must be cleared when a new document starts loading
   * so a CDP failure does not make later navigations lose their adapter.
   */
  private readonly fallbackScriptNames = new Map<string, Set<string>>();
  private readonly locationTimers = new Map<string, NodeJS.Timeout>();
  private readonly dolaProfileClickAt = new Map<string, number>();
  private readonly adapterReloads = new Map<string, Promise<void>>();
  private readonly runtimeStops = new Map<string, Promise<void>>();
  private batchWindow: BrowserWindow | null = null;
  private batchAccountIds: string[] = [];
  private readonly disposePluginListener: (() => void) | null;

  constructor(private readonly window: BrowserWindow, private readonly accounts: AccountService, private readonly settings: SettingsService, private readonly proxy?: ProxyService, private readonly fingerprints: FingerprintService = new FingerprintService(accounts), private readonly plugins?: PluginService) {
    this.disposePluginListener = plugins?.onChange(() => { void this.syncCustomExtensions(); }) ?? null;
  }
  setMediaSink(sink: (accountId: string, resource: unknown) => void): void { this.mediaSink = sink; }
  acceptsMediaCapture(accountId: string, source?: string): boolean {
    const entry = this.entries.get(accountId);
    return !entry || entry.view.webContents.isDestroyed() || acceptsDoubaoCreationCapture(entry.view.webContents.getURL(), source);
  }
  setResolverDiagnosticSink(sink: (message: string) => void): void { this.resolverDiagnosticSink = sink; }
  setNetworkDiagnosticSink(sink: (level: 'info' | 'warn', message: string) => void): void { this.networkDiagnosticSink = sink; }
  setSiteDownloadSink(sink: (accountId: string, resource: unknown) => void): void { this.siteDownloadSink = sink; }
  setNativeDownloadSink(sink: (notice: NativeDownloadNotice) => void): void { this.nativeDownloadSink = sink; }
  setNativeDownloadPathResolver(resolvePath: (accountId: string, filename: string) => string, releasePath?: (path: string) => void): void { this.nativeDownloadPathResolver = resolvePath; this.nativeDownloadPathRelease = releasePath ?? null; }
  markProgrammaticDownload(accountId: string, url: string): void { this.programmaticDownloadGuard.mark(accountId, url); }
  dispose(): void {
    const batch = this.batchWindow;
    if (batch) {
      this.restoreBatchWorkspace(batch);
      try { if (!batch.isDestroyed()) batch.destroy(); } catch { /* the window may already be closing */ }
    }
    for (const accountId of new Set([...this.entries.keys(), ...this.opening.keys()])) this.close(accountId);
    for (const accountId of [...this.downloadListenerDisposers.keys()]) this.detachDownloadListener(accountId);
    this.disposePluginListener?.();
    this.builtInExtensionIds.clear();
    this.networkResponses.clear();
    this.resolvingDolaFallbackApis.clear();
    this.resolvedDolaFallbackApis.clear();
    this.programmaticDownloadGuard.clear();
  }

  ownsWebContents(id: number): string | null {
    for (const entry of this.entries.values()) if (entry.view.webContents.id === id) return entry.accountId;
    return null;
  }

  diagnostics(): BrowserDiagnostic[] {
    return this.accounts.list().map((account) => {
      const entry = this.entries.get(account.id);
      let url = account.browser.lastUrl || account.browser.homeUrl;
      if (entry && !entry.view.webContents.isDestroyed()) {
        try { url = entry.view.webContents.getURL() || url; } catch { /* The view may be closing. */ }
      }
      return { accountId: account.id, open: Boolean(entry && !entry.view.webContents.isDestroyed()), url, sessionPartition: `persist:account_${account.id}` };
    });
  }

  async open(accountId: string): Promise<void> {
    if (this.entries.has(accountId)) return;
    const pending = this.opening.get(accountId);
    if (pending) return pending.promise;
    const limit = this.settings.get().maxOpenAccounts ?? 20;
    const allocated = new Set([...this.entries.keys(), ...this.opening.keys()]);
    if (allocated.size >= limit) throw new Error(`已达到同时运行 ${limit} 个账号的上限，请关闭闲置标签或在设置中调整`);
    const state: OpeningTask = { promise: Promise.resolve(), cancelled: false };
    const task = this.createView(accountId, state);
    state.promise = task;
    this.opening.set(accountId, state);
    try {
      await task;
    } finally {
      if (this.opening.get(accountId) === state) this.opening.delete(accountId);
    }
  }

  private async createView(accountId: string, opening: OpeningTask): Promise<void> {
    if (this.entries.has(accountId)) return;
    const account = this.account(accountId);
    const ses = session.fromPartition(`persist:account_${accountId}`);
    this.configureSession(account, ses);
    const view = new WebContentsView({ webPreferences: {
      session: ses, preload: join(__dirname, '../preload/remote.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true
    } });
    this.entries.set(accountId, { view, accountId });
    this.window.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (!/^https?:\/\//i.test(url)) return { action: 'deny' };
      if (account.platform === 'dola' && !this.settings.get().disabledAdapters.includes('dola') && isDolaExternalVideoUrl(url)) return { action: 'deny' };
      const batchPlatform: BatchLoginPlatform = account.platform === 'higgsfield' ? 'higgsfield' : 'dola';
      if (!isBatchLoginUrl(url, batchPlatform)) { void shell.openExternal(url); return { action: 'deny' }; }
      const popup = new BrowserWindow({
        width: 520, height: 760, minWidth: 420, minHeight: 520, parent: this.window,
        title: `${account.name} · 登录`, autoHideMenuBar: true,
        webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true }
      });
      const popups = this.loginPopups.get(accountId) ?? new Set<BrowserWindow>();
      popups.add(popup); this.loginPopups.set(accountId, popups);
      popup.on('closed', () => { popups.delete(popup); if (!popups.size) this.loginPopups.delete(accountId); });
      popup.webContents.setWindowOpenHandler(({ url: childUrl }) => { if (/^https?:\/\//i.test(childUrl)) void shell.openExternal(childUrl); return { action: 'deny' }; });
      return { action: 'allow', createWindow: () => popup.webContents };
    });
    view.webContents.on('will-navigate', (event, url) => { if (url !== 'about:blank' && !/^https?:\/\//i.test(url)) event.preventDefault(); });
    view.webContents.on('did-start-loading', () => { this.fallbackScriptNames.delete(accountId); });
    view.webContents.on('did-finish-load', () => { void this.injectSiteScripts(account, view); });
    const rememberLocation = (): void => {
      const currentUrl = view.webContents.getURL();
      if (!/^https?:\/\//i.test(currentUrl)) return;
      try { this.window.webContents.send(channels.browserNavigationUpdated, { accountId, url: currentUrl }); } catch { /* the main window may be closing */ }
      const timer = this.locationTimers.get(accountId); if (timer) clearTimeout(timer);
      this.locationTimers.set(accountId, setTimeout(() => {
        this.locationTimers.delete(accountId);
        try {
          const current = this.account(accountId);
          if (current.browser.lastUrl !== currentUrl) this.accounts.update(accountId, { browser: { ...current.browser, lastUrl: currentUrl } });
        } catch { /* The account may have been removed while navigation was finishing. */ }
      }, 500));
    };
    view.webContents.on('did-navigate', rememberLocation);
    view.webContents.on('did-navigate-in-page', rememberLocation);
    view.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => { if (isMainFrame && code !== -3 && !view.webContents.isDestroyed()) setTimeout(() => view.webContents.reload(), 1800); });
    view.webContents.on('render-process-gone', () => { void this.recover(accountId, view); });
    try {
      // Wait until the Session, proxy and document-level hooks are prepared.
      // The actual site navigation is intentionally started by initializeView
      // without waiting for a remote page, so opening an account remains
      // responsive even when a site is slow or offline.
      await this.initializeView(account, ses, view);
      // `close()` can cancel the initialization while proxy/extensions/CDP
      // setup is in flight. Never let that stale task claim success, and do
      // not leave an untracked WebContentsView behind if the close happened
      // before the entry was registered in a future Electron version.
      if (opening.cancelled || this.entries.get(accountId)?.view !== view) {
        if (this.entries.get(accountId)?.view === view) this.close(accountId);
        else this.disposeView(view);
        throw new Error('账号打开已取消');
      }
    } catch (error) {
      if (!view.webContents.isDestroyed()) view.webContents.loadURL(`data:text/plain;charset=utf-8,${encodeURIComponent(error instanceof Error ? error.message : String(error))}`).catch(() => undefined);
      // Opening can fail after the entry has been registered (for example,
      // when the proxy or renderer bootstrap times out). Do not leave a dead
      // View in the map: a later retry must be able to create a clean one.
      if (this.entries.get(accountId)?.view === view) this.close(accountId);
      else if (opening.cancelled) this.disposeView(view);
      throw error;
    }
  }

  private async initializeView(account: Account, ses: Electron.Session, view: WebContentsView): Promise<void> {
    await withTimeout(this.loadExtensions(account, ses), 15000, '扩展初始化超时').catch(() => undefined);
    // A close/reopen sequence can leave the previous sing-box stop request
    // in flight. Wait for that exact request before binding this Session to a
    // new local port; otherwise the old stop can terminate the newly-started
    // runtime for the same account.
    await this.runtimeStops.get(account.id);
    await withTimeout(this.applyProxy(account.id), 12000, '代理初始化超时');
    // Electron 43 may leave a newly-created WebContentsView without a live
    // renderer target. Establish a harmless blank document first so the CDP
    // Page domain can register fingerprint and adapter scripts before the
    // actual site navigation. The blank page is never exposed by the layout.
    await withTimeout(view.webContents.loadURL('about:blank'), 5000, '浏览器 renderer 初始化超时');
    // Zoom is persisted per account. Apply it before the real page is
    // navigated so a reopened account does not briefly use the default scale
    // and so the setting remains independent across WebContentsViews.
    const zoomFactor = Math.max(0.25, Math.min(5, account.browser.zoomFactor));
    if (!view.webContents.isDestroyed()) view.webContents.setZoomFactor(zoomFactor);
    await withTimeout(this.setupDebugger(account, view), 5000, '调试器初始化超时').catch(() => undefined);
    if (!view.webContents.isDestroyed()) void view.webContents.loadURL(this.url(account)).catch(() => { /* did-fail-load owns retry */ });
  }

  close(accountId: string): void {
    for (const key of this.doubaoPlayInfoApis.keys()) if (key.startsWith(`${accountId}:`)) this.doubaoPlayInfoApis.delete(key);
    for (const key of this.resolvingDolaFallbackApis.keys()) if (key.startsWith(`${accountId}:`)) this.resolvingDolaFallbackApis.delete(key);
    for (const key of this.resolvedDolaFallbackApis) if (key.startsWith(`${accountId}:`)) this.resolvedDolaFallbackApis.delete(key);
    const pending = this.opening.get(accountId);
    if (pending) {
      pending.cancelled = true;
      this.opening.delete(accountId);
    }
    const entry = this.entries.get(accountId); if (!entry) {
      if (pending) void this.stopAccountRuntime(accountId).catch(() => undefined);
      this.detachDownloadListener(accountId);
      // A renderer crash or a cancelled initialization can remove the View
      // before the persistent Session bookkeeping is cleared. Clean up the
      // Session-owned extensions as well so a later deletion/retry cannot
      // inherit an adapter that no longer has a tracked WebContentsView.
      this.detachAccountExtensions(accountId, session.fromPartition(`persist:account_${accountId}`));
      this.customExtensionIds.delete(accountId);
      this.builtInExtensionIds.delete(accountId);
      this.documentScriptNames.delete(accountId);
      this.fallbackScriptNames.delete(accountId);
      return;
    }
    this.entries.delete(accountId); this.batchAccountIds = this.batchAccountIds.filter((id) => id !== accountId); const timer = this.locationTimers.get(accountId); if (timer) clearTimeout(timer); this.locationTimers.delete(accountId); this.clearNetworkResponses(entry.view.webContents.id); this.detachView(entry.view); this.disposeView(entry.view); this.closeLoginPopups(accountId); this.detachDownloadListener(accountId); this.detachAccountExtensions(accountId, session.fromPartition(`persist:account_${accountId}`)); for (const key of this.resolvedDolaFallbackApis) if (key.startsWith(`${accountId}:`)) this.resolvedDolaFallbackApis.delete(key); for (const key of this.dolaProfileClickAt.keys()) if (key.startsWith(`${accountId}:`)) this.dolaProfileClickAt.delete(key); this.customExtensionIds.delete(accountId); this.builtInExtensionIds.delete(accountId); this.documentScriptNames.delete(accountId); this.fallbackScriptNames.delete(accountId); void this.stopAccountRuntime(accountId).catch(() => undefined); if (this.batchWindow && !this.batchWindow.isDestroyed()) { if (this.batchAccountIds.length) this.applyBatchLayout(); else void this.closeBatchWorkspace(); }
    if (this.primaryId === accountId) this.primaryId = null; if (this.secondaryId === accountId) this.secondaryId = null;
  }
  /**
   * Match the legacy instance deletion behavior: close the account view and
   * remove its persistent Chromium data before the account metadata is
   * deleted. The caller deliberately awaits this method so a failed cleanup
   * cannot silently leave a half-deleted account behind.
   */
  async removeAccountSession(accountId: string): Promise<void> {
    this.account(accountId);
    this.close(accountId);
    await this.stopAccountRuntime(accountId);
    const ses = session.fromPartition(`persist:account_${accountId}`);
    await clearSessionData(ses, 'all');
    this.permissionGrants.delete(accountId);
    this.configuredSessions.delete(accountId);
    this.builtInExtensionIds.delete(accountId);
    this.customExtensionIds.delete(accountId);
    this.documentScriptNames.delete(accountId);
    this.fallbackScriptNames.delete(accountId);
  }
  private async recover(accountId: string, failedView: WebContentsView): Promise<void> {
    if (this.recovering.has(accountId) || !this.entries.has(accountId)) return; this.recovering.add(accountId);
    const wasPrimary = this.primaryId === accountId; const wasSecondary = this.secondaryId === accountId;
    try { this.window.contentView.removeChildView(failedView); } catch { /* already detached */ } this.clearNetworkResponses(failedView.webContents.id); this.entries.delete(accountId); this.disposeView(failedView); this.closeLoginPopups(accountId);
    this.fallbackScriptNames.delete(accountId);
    try { await new Promise((resolve) => setTimeout(resolve, 600)); await this.open(accountId); if (wasPrimary) this.primaryId = accountId; if (wasSecondary) this.secondaryId = accountId; this.applyLayout(); } catch { if (wasPrimary) this.primaryId = null; if (wasSecondary) this.secondaryId = null; } finally { this.recovering.delete(accountId); }
  }
  refresh(accountId: string): void { const entry = this.entries.get(accountId); if (!entry) throw new Error('账号页面未打开'); entry.view.webContents.reload(); }
  async navigate(accountId: string, rawUrl: string): Promise<void> {
    const entry = this.entries.get(accountId);
    if (!entry || entry.view.webContents.isDestroyed()) throw new Error('账号页面未打开');
    await entry.view.webContents.loadURL(normalizeNavigationUrl(rawUrl));
  }
  /**
   * Rebuild an already-open account view after account-level browser,
   * fingerprint or session configuration changes. A normal reload cannot
   * replace next-document scripts or the session User-Agent override.
   */
  async reconfigure(accountId: string): Promise<void> {
    // Configuration changes for a closed account are persisted only. Do not
    // turn a fingerprint edit into an unexpected browser launch.
    const pending = this.adapterReloads.get(accountId);
    if (pending) { await pending; return; }
    if (!this.entries.has(accountId)) return;
    await this.reloadAdapter(accountId);
  }
  /**
   * Adapter switches affect document scripts, extensions and CDP domains. A
   * plain reload would leave the old registration in the current renderer, so
   * rebuild only the affected account views and preserve their layout roles.
   */
  async syncAdapterSettings(previousDisabled: readonly PlatformId[], nextDisabled: readonly PlatformId[], responsePatchChanged = false): Promise<void> {
    const before = new Set(previousDisabled); const after = new Set(nextDisabled);
    const changed = new Set<PlatformId>([...before, ...after].filter((platform): platform is PlatformId => before.has(platform) !== after.has(platform)));
    if (!changed.size && !responsePatchChanged) return;
    const affected = [...this.entries.values()].filter((entry) => {
      try {
        const platform = this.account(entry.accountId).platform;
        // Fetch interception is registered during view creation. Rebuild open
        // accounts that have a response patch when the global toggle changes;
        // otherwise the setting would only take effect after a manual reopen.
        return changed.has(platform) || (responsePatchChanged && Boolean(adapters[platform].patchResponse && adapters[platform].fetchPatterns.length));
      } catch { return false; }
    }).map((entry) => entry.accountId);
    await Promise.all(affected.map(async (accountId) => {
      try { await this.reloadAdapter(accountId); } catch { /* A setting change must not make the IPC update fail. */ }
    }));
  }

  private async reloadAdapter(accountId: string): Promise<void> {
    if (!this.entries.has(accountId)) return;
    const pending = this.adapterReloads.get(accountId);
    if (pending) return pending;
    const task = (async () => {
      const wasPrimary = this.primaryId === accountId; const wasSecondary = this.secondaryId === accountId;
      this.close(accountId);
      // close() initiates this stop for normal callers too; awaiting the same
      // idempotent stop prevents a new subscription runtime from racing the
      // old view teardown during adapter reconfiguration.
      await this.stopAccountRuntime(accountId);
      if (!this.accounts.get(accountId)) return;
      await this.open(accountId);
      if (wasPrimary) this.primaryId = accountId;
      if (wasSecondary) this.secondaryId = accountId;
      this.applyLayout();
    })();
    this.adapterReloads.set(accountId, task);
    try { await task; } finally { if (this.adapterReloads.get(accountId) === task) this.adapterReloads.delete(accountId); }
  }
  back(accountId: string): void { const entry = this.entries.get(accountId); if (!entry) throw new Error('账号页面未打开'); if (entry.view.webContents.canGoBack()) entry.view.webContents.goBack(); }
  forward(accountId: string): void { const entry = this.entries.get(accountId); if (!entry) throw new Error('账号页面未打开'); if (entry.view.webContents.canGoForward()) entry.view.webContents.goForward(); }
  setZoom(accountId: string, factor: number): number { const entry = this.entries.get(accountId); if (!entry) throw new Error('账号页面未打开'); const value = Math.max(0.25, Math.min(5, factor)); entry.view.webContents.setZoomFactor(value); const account = this.account(accountId); this.accounts.update(accountId, { browser: { ...account.browser, zoomFactor: value } }); return value; }
  private watchDolaCompletionRequest(view: WebContentsView, expectedDuration: 15 | 30): DolaCompletionObserver | null {
    const devtools = view.webContents.debugger;
    if (!devtools.isAttached()) return null;
    let resolveObserver!: (value: DolaCompletionObservation | null) => void;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const inspectedRequestIds = new Set<string>();
    const promise = new Promise<DolaCompletionObservation | null>((resolve) => { resolveObserver = resolve; });
    const onMessage = async (_event: Electron.Event, method: string, params: Record<string, unknown>): Promise<void> => {
      if (method !== 'Network.requestWillBeSent') return;
      const request = params.request as Record<string, unknown> | undefined;
      const url = String(request?.url ?? '');
      if (!isDolaCompletionUrl(url) || String(request?.method ?? 'GET').toUpperCase() !== 'POST') return;
      const requestId = String(params.requestId ?? '');
      if (!requestId || inspectedRequestIds.has(requestId)) return;
      inspectedRequestIds.add(requestId);
      let postData = typeof request?.postData === 'string' ? request.postData : '';
      // Chromium normally includes postData in requestWillBeSent, but it can
      // be omitted for large/streamed requests. The endpoint is shared by
      // text and video messages, so a URL-only observation is not enough to
      // claim that the requested video task was submitted.
      if (!postData.trim()) {
        try {
          const result = await devtools.sendCommand('Network.getRequestPostData', { requestId }) as { postData?: unknown };
          postData = typeof result?.postData === 'string' ? result.postData : '';
        } catch { /* The request may have completed before CDP could expose its body. */ }
      }
      if (settled || !postData.trim()) return;
      const inspection = inspectDolaCompletionBody(postData, expectedDuration);
      // /chat/completion is shared by text and video messages. If Chromium
      // exposes a body, require the explicit video ability before accepting
      // this event as the task submission. A URL-only observation is ignored
      // and will become a visible timeout in submitDolaVideo.
      if (!inspection.detected) return;
      finish({ url, inspection });
    };
    const finish = (value: DolaCompletionObservation | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      devtools.removeListener('message', onMessage);
      resolveObserver(value);
    };
    devtools.on('message', onMessage);
    timer = setTimeout(() => finish(null), 8_000);
    return { promise, dispose: () => finish(null) };
  }
  async submitDolaVideo(accountId: string, prompt: string, aspectRatio: string, duration: 15 | 30, referencePaths: string[] = []): Promise<DolaVideoTaskResult> {
    const account = this.account(accountId); if (account.platform !== 'dola') throw new Error('仅 Dola 账号支持视频任务提交');
    const entry = this.entries.get(accountId); if (!entry || entry.view.webContents.isDestroyed()) throw new Error('请先打开并等待 Dola 账号页面加载完成');
    const ratio = aspectRatio.trim() || '16:9';
    const references = validateDolaReferencePaths(referencePaths);
    let result: DolaPageResult | undefined;
    let observer: DolaCompletionObserver | null = null;
    try {
      if (references.length > 0) {
        result = await this.prepareDolaReferenceFiles(entry.view, ratio, duration, references);
        if (!result.ok) return { ok: false, message: result.message ?? '参考图准备失败', duration, aspectRatio: ratio };
        await new Promise((resolve) => setTimeout(resolve, 900));
        observer = this.watchDolaCompletionRequest(entry.view, duration);
        result = await entry.view.webContents.executeJavaScript(buildDolaVideoSubmissionScript(prompt.trim(), ratio, duration, references.length), true) as DolaPageResult | undefined;
      } else {
        observer = this.watchDolaCompletionRequest(entry.view, duration);
        result = await entry.view.webContents.executeJavaScript(buildDolaVideoTaskScript(prompt.trim(), ratio, duration), true) as DolaPageResult | undefined;
      }
      if (!result || typeof result.message !== 'string') throw new Error('Dola 页面未返回任务提交结果');
      if (!result.ok) return { ok: false, message: result.message, duration, aspectRatio: ratio };
      if (!observer) return { ok: false, message: `${result.message}；调试通道不可用，未能确认 Dola 请求`, duration, aspectRatio: ratio, verification: 'unavailable' };
      const observed = await observer.promise;
      if (!observed) return { ok: false, message: `${result.message}；8 秒内未观察到 Dola 视频请求，未确认提交`, duration, aspectRatio: ratio, verification: 'timeout' };
      if (observed.inspection.matchesExpected === false) {
        const actual = observed.inspection.duration ? `${observed.inspection.duration} 秒` : '未知时长';
        return { ok: false, message: `${result.message}；实际请求为 ${actual}，未按 ${duration} 秒提交`, duration, aspectRatio: ratio, requestObserved: true, requestDuration: observed.inspection.duration, requestModel: observed.inspection.model, verification: 'mismatch' };
      }
      const detail = observed.inspection.duration ? `已确认请求参数 ${observed.inspection.duration} 秒` : '已确认 Dola 视频请求已发出';
      return { ok: true, message: `${result.message}；${detail}`, duration, aspectRatio: ratio, requestObserved: true, requestDuration: observed.inspection.duration, requestModel: observed.inspection.model, verification: 'confirmed' };
    } finally {
      observer?.dispose();
    }
  }
  async uploadDolaReferences(accountId: string, kind: DolaReferenceKind, referencePaths: string[], aspectRatio = '16:9', duration: 15 | 30 = 15): Promise<DolaReferenceUploadResult> {
    const account = this.account(accountId);
    if (account.platform !== 'dola') throw new Error('仅 Dola 账号支持音视频参考素材');
    const entry = this.entries.get(accountId);
    if (!entry || entry.view.webContents.isDestroyed()) throw new Error('请先打开并等待 Dola 账号页面加载完成');
    const paths = validateDolaMediaReferencePaths(kind, referencePaths);
    const devtools = entry.view.webContents.debugger;
    if (!devtools.isAttached()) throw new Error('Dola 页面调试通道未就绪，无法附加参考素材');
    // The legacy tool opened the video composer before it touched the media
    // input. Keep that behavior so a normal chat page can accept references.
    await entry.view.webContents.executeJavaScript(buildDolaVideoPreparationScript(aspectRatio, duration, 0), true).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const prepared = await entry.view.webContents.executeJavaScript(buildDolaReferenceInputPreparationScript(kind), true) as { ok?: boolean; message?: string } | undefined;
    if (!prepared?.ok) throw new Error(prepared?.message || 'Dola 未找到可用的参考素材输入框');
    const node = await this.findDolaFileInput(devtools, kind);
    if (!node) throw new Error(`Dola 未找到可用的参考${kind === 'audio' ? '音频' : '视频'}输入框`);
    const command: Record<string, unknown> = { files: paths };
    if (node.nodeId !== undefined) command.nodeId = node.nodeId;
    if (node.backendNodeId !== undefined) command.backendNodeId = node.backendNodeId;
    await devtools.sendCommand('DOM.setFileInputFiles', command);
    await new Promise((resolve) => setTimeout(resolve, 180));
    const dispatched = await entry.view.webContents.executeJavaScript(buildDolaReferenceInputDispatchScript(kind), true) as { ok?: boolean; count?: number; message?: string } | undefined;
    if (!dispatched?.ok) throw new Error(dispatched?.message || `Dola 参考${kind === 'audio' ? '音频' : '视频'}事件触发失败`);
    const observation = await this.waitForDolaReferenceUpload(entry.view, kind, paths);
    const statusMessage = observation.status === 'settled'
      ? `已确认 Dola 已绑定 ${observation.boundCount} 个参考${kind === 'audio' ? '音频' : '视频'}`
      : observation.status === 'pending'
        ? `Dola 已收到 ${observation.inputCount}/${paths.length} 个参考${kind === 'audio' ? '音频' : '视频'}，仍在上传，请稍后再提交`
        : observation.status === 'failed'
          ? `Dola 参考${kind === 'audio' ? '音频' : '视频'}上传失败，请查看页面提示`
          : `已将 ${paths.length} 个参考${kind === 'audio' ? '音频' : '视频'}交给 Dola；页面上传状态暂不可观测，请等待页面完成`;
    return {
      ok: observation.status !== 'failed',
      kind,
      accepted: paths.length,
      inputCount: observation.inputCount || Number(dispatched.count || 0),
      boundCount: observation.boundCount,
      pendingCount: observation.pendingCount,
      status: observation.status,
      readyForSubmit: observation.readyForSubmit,
      message: statusMessage
    };
  }
  private async waitForDolaReferenceUpload(view: WebContentsView, kind: DolaReferenceKind, paths: string[]): Promise<DolaReferenceUploadObservation> {
    const expectedCount = paths.length;
    const script = buildDolaReferenceUploadStatusScript(kind, paths);
    const deadline = Date.now() + 8_000;
    let last: DolaReferenceUploadObservation = {
      inputCount: 0,
      expectedCount,
      available: false,
      matchedCount: 0,
      boundCount: 0,
      pendingCount: 0,
      failedCount: 0,
      readyForSubmit: false,
      status: 'unavailable'
    };
    while (Date.now() < deadline) {
      if (view.webContents.isDestroyed()) break;
      const current = await view.webContents.executeJavaScript(script, true).catch(() => undefined) as Partial<DolaReferenceUploadObservation> | undefined;
      if (current && typeof current === 'object') {
        last = {
          inputCount: Number(current.inputCount) || 0,
          expectedCount,
          available: Boolean(current.available),
          matchedCount: Number(current.matchedCount) || 0,
          boundCount: Number(current.boundCount) || 0,
          pendingCount: Number(current.pendingCount) || 0,
          failedCount: Number(current.failedCount) || 0,
          readyForSubmit: Boolean(current.readyForSubmit),
          status: current.status === 'settled' || current.status === 'pending' || current.status === 'failed' || current.status === 'unavailable' ? current.status : 'unavailable'
        };
        if (last.status === 'failed' || last.readyForSubmit) return last;
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    return last;
  }
  private async prepareDolaReferenceFiles(view: WebContentsView, aspectRatio: string, duration: 15 | 30, paths: string[]): Promise<DolaPageResult> {
    const devtools = view.webContents.debugger;
    if (!devtools.isAttached()) throw new Error('Dola 页面调试通道未就绪，无法附加参考图');
    let chooserResolve: ((target: DolaFileInputTarget) => void) | null = null;
    let chooserTarget: DolaFileInputTarget | null = null;
    const chooserOpened = new Promise<DolaFileInputTarget>((resolve) => { chooserResolve = resolve; });
    const onDebuggerMessage = (_event: Electron.Event, method: string, params: Record<string, unknown>): void => {
      if (method !== 'Page.fileChooserOpened') return;
      const backendNodeId = Number(params.backendNodeId);
      const target = Number.isInteger(backendNodeId) && backendNodeId > 0 ? { backendNodeId } : {};
      chooserTarget = target;
      chooserResolve?.(target);
    };
    devtools.on('message', onDebuggerMessage);
    try {
      try { await devtools.sendCommand('Page.enable'); } catch { /* Older Chromium builds may not expose the Page domain. */ }
      try { await devtools.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true }); } catch { /* DOM.setFileInputFiles remains the fallback. */ }
      const prepared = await view.webContents.executeJavaScript(buildDolaVideoPreparationScript(aspectRatio, duration, paths.length), true) as DolaPageResult | undefined;
      if (!prepared || typeof prepared.message !== 'string') throw new Error('Dola 页面未返回参考图准备结果');
      if (!prepared.ok) return prepared;

      let filesSet = false;
      const intercepted = chooserTarget ?? await Promise.race([chooserOpened, new Promise<null>((resolve) => setTimeout(() => resolve(null), 650))]);
      if (intercepted) {
        try {
          await devtools.sendCommand('DOM.setFileInputFiles', { backendNodeId: intercepted.backendNodeId, files: paths });
          filesSet = true;
        } catch { /* Some pages expose the input only after the picker event. */ }
      }
      if (!filesSet) {
        const node = await this.findDolaFileInput(devtools);
        if (!node) throw new Error('Dola 未找到可用的参考图文件输入框');
        const command: Record<string, unknown> = { files: paths };
        if (node.nodeId !== undefined) command.nodeId = node.nodeId;
        if (node.backendNodeId !== undefined) command.backendNodeId = node.backendNodeId;
        await devtools.sendCommand('DOM.setFileInputFiles', command);
      }
      return prepared;
    } finally {
      devtools.removeListener('message', onDebuggerMessage);
      try { await devtools.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }); } catch { /* page may have gone away */ }
    }
  }
  private async findDolaFileInput(devtools: Electron.Debugger, kind?: DolaReferenceKind): Promise<DolaFileInputTarget | null> {
    try {
      await devtools.sendCommand('DOM.enable');
      const document = await devtools.sendCommand('DOM.getDocument', { depth: -1, pierce: true }) as { root?: { nodeId?: number } };
      const rootNodeId = document.root?.nodeId;
      if (!rootNodeId) return null;
      const result = await devtools.sendCommand('DOM.querySelectorAll', { nodeId: rootNodeId, selector: 'input[type="file"]' }) as { nodeIds?: number[] };
      const nodeIds = result.nodeIds ?? [];
      let fallback: DolaFileInputTarget | null = null;
      let preferred: DolaFileInputTarget | null = null;
      for (const nodeId of nodeIds) {
        const attributes = await devtools.sendCommand('DOM.getAttributes', { nodeId }).catch(() => ({ attributes: [] })) as { attributes?: string[] };
        const values = attributes.attributes ?? [];
        const acceptIndex = values.findIndex((value) => value.toLowerCase() === 'accept');
        const accept = acceptIndex >= 0 ? String(values[acceptIndex + 1] ?? '') : '';
        const testIdIndex = values.findIndex((value) => value.toLowerCase() === 'data-testid');
        const testId = testIdIndex >= 0 ? String(values[testIdIndex + 1] ?? '') : '';
        const target = { nodeId };
        if (!fallback) fallback = target;
        if (kind && !preferred && testId === 'upload-file-input') preferred = target;
        if (kind && new RegExp(kind === 'audio' ? 'audio|mp3|wav' : 'video|mp4|mov', 'i').test(accept)) return target;
        if (!kind && (!accept || /image|png|jpe?g|webp|\*/i.test(accept))) return target;
      }
      return preferred ?? fallback;
    } catch {
      return null;
    }
  }
  resolveDolaToken(accountId: string, raw: unknown): void {
    const account = this.account(accountId);
    if (account.platform !== 'dola' || !raw || typeof raw !== 'object') return;
    const value = raw as Record<string, unknown>;
    const token = String(value.token ?? value.mainUrl ?? value.main_url ?? '').trim();
    const keySeed = String(value.keySeed ?? value.key_seed ?? '').trim();
    if (!token || token.length > 200_000 || keySeed.length > 20_000) return;
    const videoUrl = decodeDolaMainUrl(token, keySeed);
    if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) return;
    this.mediaSink?.(accountId, {
      type: 'video',
      url: videoUrl,
      backupUrl: String(value.backupUrl ?? '').trim() || undefined,
      thumbUrl: String(value.coverUrl ?? value.thumbUrl ?? '').trim() || undefined,
      title: String(value.title ?? 'Dola 原视频').trim().slice(0, 200),
      width: Number(value.width) || undefined,
      height: Number(value.height) || undefined,
      duration: Number(value.duration) || undefined,
      source: 'dola-page-decoded-token',
      confirmedNoWatermark: Boolean(value.confirmedNoWatermark),
      qualityEvidence: 'decoded-token',
      resolutionMethod: 'page-qAAB-token',
      messageId: String(value.messageId ?? '').trim() || undefined,
      vid: String(value.vid ?? '').trim() || undefined,
      keySeed: keySeed || undefined,
      fplayUrl: String(value.fplayUrl ?? '').trim() || undefined,
      dolaRecordKey: String(value.dolaRecordKey ?? '').trim() || undefined,
      dolaCardId: String(value.dolaCardId ?? '').trim() || undefined,
      dolaVideoElementId: String(value.dolaVideoElementId ?? '').trim() || undefined
    });
  }
  async resolveDolaResource(accountId: string, reference: DolaResourceReference, downloadAfterResolve = false): Promise<void> {
    const account = this.account(accountId);
    if (account.platform !== 'dola') throw new Error('只有 Dola 账号支持页面资源解析');
    const entry = this.entries.get(accountId);
    if (!entry || entry.view.webContents.isDestroyed()) throw new Error('账号页面未打开');
    const payload = JSON.stringify({ ...reference, downloadAfterResolve: Boolean(downloadAfterResolve) });
    await entry.view.webContents.executeJavaScript(`window.postMessage({ type: 'AIAM_DOLA_RESOLVE_RESOURCE', resource: ${payload} }, '*'); void 0;`, true);
  }
  async openMany(ids: string[]): Promise<{ succeeded: string[]; failed: Array<{ id: string; message: string }> }> { const succeeded: string[] = []; const failed: Array<{ id: string; message: string }> = []; for (const id of [...new Set(ids)]) { try { await this.open(id); succeeded.push(id); } catch (error) { failed.push({ id, message: error instanceof Error ? error.message : String(error) }); } } return { succeeded, failed }; }
  closeMany(ids: string[]): void { [...new Set(ids)].forEach((id) => this.close(id)); }
  async openBatchWorkspace(accountIds: string[]): Promise<void> {
    const ids = [...new Set(accountIds)];
    if (!ids.length) throw new Error('没有可显示的批量登录账号');
    if (ids.length > 20) throw new Error('内置批量登录窗口最多显示 20 个账号');
    for (const id of ids) this.account(id);
    for (const id of ids) await this.open(id);
    if (this.batchWindow?.isDestroyed()) this.restoreBatchWorkspace(this.batchWindow);
    if (!this.batchWindow) {
      const batch = new BrowserWindow({
        width: 1600, height: 1000, minWidth: 900, minHeight: 560, show: false,
        parent: this.window, title: '内置批量登录', autoHideMenuBar: true, backgroundColor: '#0f172a',
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
      });
      this.batchWindow = batch;
      batch.on('closed', () => this.restoreBatchWorkspace(batch));
      batch.on('resize', () => this.applyBatchLayout());
      batch.on('show', () => this.applyBatchLayout());
      void batch.loadURL('about:blank').catch(() => undefined);
      batch.show();
    }
    this.batchAccountIds = ids;
    this.attachBatchViews();
    this.applyBatchLayout();
  }
  async closeBatchWorkspace(): Promise<void> {
    const batch = this.batchWindow;
    if (!batch) return;
    if (batch.isDestroyed()) { this.restoreBatchWorkspace(batch); return; }
    await new Promise<void>((resolve) => {
      batch.once('closed', resolve);
      try { batch.close(); } catch { this.restoreBatchWorkspace(batch); resolve(); }
    });
  }
  refreshMany(ids: string[]): void { [...new Set(ids)].forEach((id) => this.refresh(id)); }
  activate(primaryId: string | null, secondaryId: string | null = null): void { this.primaryId = primaryId; this.secondaryId = secondaryId; this.applyLayout(); }
  setLayout(layout: ViewLayout): void { this.layout = layout; this.applyLayout(); }
  private rect(value: Rectangle): Rectangle { return { x: Math.round(value.x), y: Math.round(value.y), width: Math.max(0, Math.round(value.width)), height: Math.max(0, Math.round(value.height)) }; }
  private applyLayout(): void {
    if (this.batchWindow && !this.batchWindow.isDestroyed()) { this.applyBatchLayout(); return; }
    for (const [id, entry] of this.entries) {
      if (this.layout.occluded) entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      else if (id === this.primaryId) entry.view.setBounds(this.rect(this.layout.primary));
      else if (id === this.secondaryId && this.layout.secondary) entry.view.setBounds(this.rect(this.layout.secondary));
      else entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  }
  private detachView(view: WebContentsView): void {
    try { this.window.contentView.removeChildView(view); } catch { /* the view may belong to the batch window */ }
    const batch = this.batchWindow;
    if (batch && !batch.isDestroyed()) {
      try { batch.contentView.removeChildView(view); } catch { /* the view may belong to the main window */ }
    }
  }
  private attachBatchViews(): void {
    const batch = this.batchWindow;
    if (!batch || batch.isDestroyed()) return;
    const selected = new Set(this.batchAccountIds);
    for (const [accountId, entry] of this.entries) {
      if (entry.view.webContents.isDestroyed()) continue;
      this.detachView(entry.view);
      try { (selected.has(accountId) ? batch.contentView : this.window.contentView).addChildView(entry.view); } catch { /* the window may be closing */ }
    }
  }
  private applyBatchLayout(): void {
    const batch = this.batchWindow;
    if (!batch || batch.isDestroyed()) return;
    const ids = this.batchAccountIds.filter((id) => this.entries.has(id));
    if (!ids.length) return;
    const [rawWidth, rawHeight] = batch.getContentSize();
    const width = Number(rawWidth) || 1600;
    const height = Number(rawHeight) || 1000;
    const columns = ids.length <= 1 ? 1 : ids.length <= 4 ? 2 : ids.length <= 9 ? 3 : 5;
    const rows = Math.ceil(ids.length / columns);
    const gap = 8;
    const cellWidth = Math.max(220, Math.floor((Math.max(1, width) - gap * (columns - 1)) / columns));
    const cellHeight = Math.max(180, Math.floor((Math.max(1, height) - gap * (rows - 1)) / rows));
    ids.forEach((accountId, index) => {
      const entry = this.entries.get(accountId);
      if (!entry || entry.view.webContents.isDestroyed()) return;
      entry.view.setBounds(this.layout.occluded
        ? { x: 0, y: 0, width: 0, height: 0 }
        : { x: (index % columns) * (cellWidth + gap), y: Math.floor(index / columns) * (cellHeight + gap), width: cellWidth, height: cellHeight });
    });
  }
  private restoreBatchWorkspace(batch: BrowserWindow): void {
    if (this.batchWindow !== batch) return;
    const ids = [...this.batchAccountIds];
    this.batchWindow = null;
    this.batchAccountIds = [];
    for (const accountId of ids) {
      const entry = this.entries.get(accountId);
      if (!entry || entry.view.webContents.isDestroyed()) continue;
      try { if (!batch.isDestroyed()) batch.contentView.removeChildView(entry.view); } catch { /* already detached */ }
      try { this.window.contentView.addChildView(entry.view); entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 }); } catch { /* main window may be closing */ }
    }
    this.applyLayout();
  }
  async applyProxy(accountId: string): Promise<void> {
    const account = this.account(accountId); const ses = session.fromPartition(`persist:account_${accountId}`); const proxy = account.proxy;
    if (this.proxy) { await this.proxy.apply(accountId, ses); return; }
    if (!proxy.enabled) await ses.setProxy({ mode: 'system' });
    else {
      await ses.setProxy({ mode: 'fixed_servers', proxyRules: buildProxyRules(proxy), proxyBypassRules: '<local>' });
    }
    await ses.closeAllConnections();
  }
  async testProxy(accountId: string): Promise<ProxyTestResult> {
    const started = Date.now();
    try {
      await this.applyProxy(accountId); const ses = session.fromPartition(`persist:account_${accountId}`);
      const response = await ses.fetch('https://api64.ipify.org?format=json', { signal: AbortSignal.timeout(12000) });
      const text = await response.text(); let ip = ''; try { ip = String((JSON.parse(text) as { ip?: unknown }).ip ?? ''); } catch { ip = text.trim(); }
      return { ok: response.ok, status: response.status, latencyMs: Date.now() - started, ip, message: response.ok ? '代理连接成功' : `HTTP ${response.status}` };
    } catch (error) { return { ok: false, latencyMs: Date.now() - started, message: error instanceof Error ? error.message : String(error) }; }
  }
  async startJimengOriginal(accountId: string): Promise<{ ok: boolean; message: string }> {
    const account = this.account(accountId);
    if (account.platform !== 'jimeng') throw new Error('仅即梦账号支持原图选择');
    const entry = this.entries.get(accountId);
    if (!entry || entry.view.webContents.isDestroyed()) throw new Error('请先打开即梦账号页面');
    const result = await entry.view.webContents.executeJavaScript(`typeof window.__AIAM_JIMENG_START_SELECT__ === 'function' ? window.__AIAM_JIMENG_START_SELECT__() : false`, true);
    return result === true ? { ok: true, message: '已开启即梦原图选择，请点击一张图片' } : { ok: false, message: '即梦原图脚本尚未就绪，请进入资产页后重试' };
  }
  async refreshDoubaoVideo(accountId: string, resource: { vid?: string; messageId?: string; title?: string }): Promise<void> {
    const api = resource.vid ? this.doubaoPlayInfoApis.get(`${accountId}:${resource.vid}`) : undefined;
    if (!api) throw new Error('尚未捕获当前作品的播放信息，请回到原对话点击视频播放后重试下载；无需打开“我的创作”');
    const resolved = await this.dolaResolver.resolve(api, session.fromPartition(`persist:account_${accountId}`), 'https://www.doubao.com/');
    this.mediaSink?.(accountId, { ...resource, type: 'video', url: resolved.videoUrl, alternateUrls: resolved.alternateUrls,
      thumbUrl: resolved.posterUrl || undefined, source: 'doubao-video-fallback-api', confirmedNoWatermark: true,
      qualityEvidence: 'platform-api', resolutionMethod: 'fallback_api' });
    this.resolverDiagnosticSink?.(`[video-resolver] platform=doubao account=${accountId} result=resolved method=current-play-info host=${new URL(resolved.videoUrl).hostname}`);
  }
  async startDoubaoCreationScan(accountId: string, targetResource?: { vid?: string; messageId?: string }): Promise<{ ok: boolean; message: string; count?: number }> {
    const account = this.account(accountId);
    if (account.platform !== 'doubao') throw new Error('仅豆包账号支持创作原视频扫描');
    const entry = this.entries.get(accountId);
    if (!entry || entry.view.webContents.isDestroyed()) throw new Error('请先打开豆包账号页面');
    if (targetResource && !targetResource.vid && !targetResource.messageId) return { ok: false, count: 0, message: '当前素材缺少作品标识，请回到原对话重新捕获；未扫描历史作品' };
    const target = 'https://www.doubao.com/chat/create-image?tab=myCreation';
    const current = entry.view.webContents.getURL();
    if (!/^https:\/\/www\.doubao\.com\/chat\/create-image/i.test(current) || !/(?:^|[?&])tab=myCreation(?:&|$)/i.test(new URL(current || target).search)) {
      await withTimeout(entry.view.webContents.loadURL(target), 20_000, '豆包“我的创作”页面加载超时');
    }
    await entry.view.webContents.executeJavaScript(readFileSync(this.assetPath('scripts', 'doubao-creation-download.js'), 'utf8'), true);
    const result = await entry.view.webContents.executeJavaScript(`typeof window.__AIAM_DOUBAO_CREATION_SCAN_TO_RESOURCE_PANEL__ === 'function' ? window.__AIAM_DOUBAO_CREATION_SCAN_TO_RESOURCE_PANEL__(${JSON.stringify(targetResource ?? null)}) : { ok: false, count: 0 }`, true) as { ok?: boolean; count?: number; navigated?: boolean } | undefined;
    if (!result || result.navigated) return { ok: false, message: '已打开豆包“我的创作”，请稍后再次点击扫描' };
    return result.ok ? { ok: true, count: Number(result.count) || 0, message: `已扫描 ${Number(result.count) || 0} 个豆包创作原视频，请查看素材流` } : { ok: false, count: Number(result.count) || 0, message: targetResource ? '未找到当前作品的原视频下载地址，请回到原对话重新捕获；未导入其他历史作品' : '未找到平台明确的原视频下载流，请确认“我的创作”页面已加载' };
  }
  async clearDoubaoHistory(accountId: string): Promise<DoubaoHistoryCleanupResult> {
    const account = this.account(accountId);
    if (account.platform !== 'doubao') throw new Error('仅豆包账号支持历史会话清理');
    const entry = this.entries.get(accountId);
    if (!entry || entry.view.webContents.isDestroyed()) throw new Error('请先打开豆包账号页面');
    if (this.clearingDoubaoHistory.has(accountId)) throw new Error('此账号正在清理历史会话，请勿重复操作');
    this.clearingDoubaoHistory.add(accountId);
    const record = (stage: string, result?: DoubaoHistoryCleanupResult): void => {
      this.networkDiagnosticSink?.(result && !result.ok ? 'warn' : 'info',
        `[doubao-history] account=${accountId} stage=${stage}${result ? ` ok=${result.ok} count=${result.count} submitted=${result.submitted === true} message=${result.message}` : ''}`);
    };
    const showFailure = async (result: DoubaoHistoryCleanupResult): Promise<void> => {
      if (this.window.isDestroyed()) return;
      await dialog.showMessageBox(this.window, {
        type: 'warning', title: result.submitted ? '请核对清理结果' : '历史清理未执行', message: result.message,
        detail: result.submitted ? '请先在豆包页面核对结果，不要重复点击清理。' : '未执行删除。可以在历史管理页手动操作，或检查登录状态后重试。',
        buttons: ['知道了'], noLink: true
      });
    };
    const contents = entry.view.webContents;
    const token = randomUUID();
    const unchanged = (): boolean => this.entries.get(accountId) === entry && !contents.isDestroyed()
      && this.account(accountId).platform === 'doubao' && isDoubaoHistoryUrl(contents.getURL());
    const readResult = (value: unknown): DoubaoHistoryCleanupResult => {
      const result = value as Partial<DoubaoHistoryCleanupResult> | null;
      if (!result || typeof result.ok !== 'boolean' || typeof result.message !== 'string'
        || !Number.isSafeInteger(result.count) || result.count! < 0) {
        throw new Error('豆包页面未返回有效清理结果，已停止操作');
      }
      return { ok: result.ok, count: result.count!, message: result.message, submitted: result.submitted === true };
    };
    const runPhase = async (phase: 'prepare' | 'delete' | 'verify', count = 0): Promise<DoubaoHistoryCleanupResult> => {
      const deadline = Date.now() + 30_000;
      const clicked = new Set<string>();
      while (Date.now() < deadline) {
        if (!unchanged()) throw new Error('账号页面已变化，已停止清理，请在页面核对');
        const value = await withTimeout(contents.executeJavaScript(buildDoubaoHistoryScript(phase, token, count, Math.min(15_000, deadline - Date.now()), true), true), 20_000, '清理页面响应超时，请在豆包页面核对；不会自动重试') as DoubaoHistoryPageResult;
        if (!value?.action) return readResult(value);
        const { kind, xRatio, yRatio } = value.action;
        const allowed = phase === 'prepare' ? ['menu', 'batch', 'loaded', 'all'] : phase === 'verify' ? ['menu', 'batch'] : ['remove', 'confirm'];
        if (!allowed.includes(kind) || !Number.isFinite(xRatio) || !Number.isFinite(yRatio) || xRatio <= 0 || xRatio >= 1 || yRatio <= 0 || yRatio >= 1) throw new Error('页面点击目标无效，已停止清理');
        // A delayed UI update may request the same action again. Never repeat
        // a click: only poll for its resulting state, especially after Delete.
        if (!clicked.has(kind)) {
          if (!unchanged()) throw new Error('账号页面已变化，已停止清理');
          clicked.add(kind);
          record(`click-${kind}`);
          await new Promise<void>((resolve) => setTimeout(resolve, 150));
          if (!unchanged()) throw new Error('账号页面已变化，已停止清理');
          await this.dispatchDolaNativeClick(contents, { xRatio, yRatio } as DolaClickPoint);
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
      }
      return { ok: false, count: 0, submitted: phase === 'verify' || clicked.has('remove'), message: phase === 'prepare' ? '历史页面准备超时，未执行删除，请稍后重试' : '已提交删除，结果尚未确认，请在豆包页面核对；不会自动重试' };
    };
    try {
      record('navigate');
      await withTimeout(contents.loadURL(DOUBAO_HISTORY_URL), 20_000, '豆包历史管理页面加载超时');
      if (!unchanged()) throw new Error('账号页面已变化，未执行删除');
      record('prepare');
      const prepared = await runPhase('prepare');
      record('prepared', prepared);
      if (!prepared.ok) { await showFailure(prepared); return prepared; }
      if (prepared.count === 0) { const empty = { ...prepared, submitted: false }; record('result', empty); return empty; }
      if (!unchanged() || this.window.isDestroyed()) throw new Error('账号页面已变化，未执行删除');
      const confirmation = await dialog.showMessageBox(this.window, {
        type: 'warning', title: '清理豆包全部历史会话',
        message: `删除“${account.name}”的全部 ${prepared.count} 个历史会话？`,
        detail: '会话及关联的线上作品将一起删除，无法撤销。已下载到电脑的文件会保留。仅清理此豆包账号。',
        buttons: ['删除全部会话', '取消'], defaultId: 1, cancelId: 1, noLink: true
      });
      if (confirmation.response !== 0) { record('cancelled'); return { ok: false, count: 0, message: '已取消清理，未执行删除' }; }
      if (!unchanged()) throw new Error('确认期间账号页面已变化，未执行删除，请重新操作');
      record('confirmed-delete');
      let result = await runPhase('delete', prepared.count);
      record('page-result', result);
      if (result.ok && result.count !== prepared.count) throw new Error('删除结果数量不一致，请在豆包页面核对；不会自动重试');
      if (result.submitted) {
        // A failed bulk-delete toast can coexist with successful removal of
        // ordinary threads (the undeletable main conversation is retained).
        // Refresh once and read the native total, never submit deletion again.
        try {
          if (!unchanged()) throw new Error('账号页面已变化');
          record('verify-refresh');
          await withTimeout(contents.loadURL(DOUBAO_HISTORY_URL), 20_000, '结果核验页面加载超时');
          result = await runPhase('verify', prepared.count);
          if (result.ok && result.count !== prepared.count) throw new Error('核验结果数量不一致');
          if (!result.ok) result = { ...result, submitted: true };
        } catch (error) {
          record('verify-unavailable', { ok: false, count: 0, submitted: true, message: error instanceof Error ? error.message : String(error) });
          result = { ok: false, count: 0, submitted: true, message: '已提交删除，但未能核验最终结果，请在豆包页面核对；不会自动重试' };
        }
      }
      record('result', result);
      if (!result.ok) await showFailure(result);
      return result;
    } catch (error) {
      this.networkDiagnosticSink?.('warn', `[doubao-history] account=${accountId} stage=exception message=${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      this.clearingDoubaoHistory.delete(accountId);
    }
  }
  async sendDoubao15sPrompt(accountId: string): Promise<DoubaoPromptResult> {
    const account = this.account(accountId);
    if (account.platform !== 'doubao') throw new Error('仅豆包账号支持 15 秒增强提示词');
    const entry = this.entries.get(accountId);
    if (!entry || entry.view.webContents.isDestroyed()) throw new Error('请先打开并等待豆包账号页面加载完成');
    const result = await entry.view.webContents.executeJavaScript(buildDoubao15sPromptSendScript(), true) as Partial<DoubaoPromptResult> | undefined;
    if (!result || typeof result.message !== 'string') throw new Error('豆包页面未返回提示词发送结果');
    return { ok: Boolean(result.ok), message: result.message };
  }
  async setDoubaoDuration(accountId: string, duration: DoubaoDuration): Promise<DoubaoDurationResult> {
    const account = this.account(accountId);
    if (account.platform !== 'doubao') throw new Error('仅豆包账号支持时长设置');
    const entry = this.entries.get(accountId);
    if (!entry || entry.view.webContents.isDestroyed()) throw new Error('请先打开并等待豆包账号页面加载完成');
    const result = await entry.view.webContents.executeJavaScript(buildDoubaoDurationControlScript(duration), true) as Partial<DoubaoDurationResult> | undefined;
    if (!result || typeof result.message !== 'string' || (result.duration !== 15 && result.duration !== 30)) throw new Error('豆包页面未返回时长设置结果');
    return {
      ok: Boolean(result.ok),
      message: result.message,
      duration: result.duration,
      durationFlag: result.durationFlag === '1' ? '1' : '0',
      model: typeof result.model === 'string' ? result.model : '',
      modelSupports30: Boolean(result.modelSupports30),
      bridgeReady: Boolean(result.bridgeReady)
    };
  }
  async batchLoginFillEmbedded(accountId: string, email: string, password: string, platform: BatchLoginPlatform): Promise<DolaLoginStep> {
    const account = this.account(accountId);
    if (account.platform !== platform) throw new Error(`仅 ${platform === 'higgsfield' ? 'Higgsfield' : 'Dola'} 账号支持批量登录`);
    const entry = await this.waitForBatchLoginEntry(accountId, platform);
    let last: DolaLoginStep = { ok: false, message: '等待登录页面' };
    try {
      for (const target of this.dolaLoginTargets(accountId, entry)) {
        try {
          const value = normalizeDolaLoginStep(await target.executeJavaScript(buildDolaLoginStepScript(email, password, platform), true));
          last = value;
          if (platform === 'dola' && value.manual && /未识别登录入口|人工点击/i.test(value.message) && !/验证码|人工验证|通行密钥|安全密钥|两步|手机号|phone|2-step|verification code/i.test(value.message)) {
            const targetKind: DolaClickTarget = target === entry.view.webContents ? 'login' : 'google';
            const profileKey = `${accountId}:${targetKind}`;
            const lastClickAt = this.dolaProfileClickAt.get(profileKey) ?? 0;
            if (Date.now() - lastClickAt >= 2500) {
              await this.dispatchDolaNativeClick(target, this.settings.get().dolaClickProfile[targetKind]);
              this.dolaProfileClickAt.set(profileKey, Date.now());
              return { ok: true, field: `${targetKind}-profile`, message: `已按校准的${targetKind === 'login' ? '登录' : 'Google'}点位点击，请等待页面响应` };
            }
            return { ok: true, field: `${targetKind}-profile-wait`, message: '已点击校准点位，等待登录页面响应' };
          }
          if (value.ok || value.manual || value.readyToSync) return value;
        } catch { /* A popup may close while Google redirects; try the next target. */ }
      }
      return last;
    } catch (error) {
      return { ok: false, message: `内置 ${platform === 'higgsfield' ? 'Higgsfield' : 'Dola'} 页面仍在加载：${error instanceof Error ? error.message : String(error)}` };
    }
  }
  async batchLoginCalibrateEmbedded(accountId: string, platform: BatchLoginPlatform): Promise<DolaLoginStep> {
    const account = this.account(accountId);
    if (account.platform !== platform) throw new Error(`仅 ${platform === 'higgsfield' ? 'Higgsfield' : 'Dola'} 账号支持登录入口校准`);
    const entry = await this.waitForBatchLoginEntry(accountId, platform);
    try {
      const value = await entry.view.webContents.executeJavaScript(buildDolaCalibrationScript(), true);
      return normalizeDolaLoginStep(value, '校准失败');
    } catch (error) {
      return { ok: false, message: `内置 ${platform === 'higgsfield' ? 'Higgsfield' : 'Dola'} 页面仍在加载：${error instanceof Error ? error.message : String(error)}` };
    }
  }
  async dolaBatchFillEmbedded(accountId: string, email: string, password: string): Promise<DolaLoginStep> { return this.batchLoginFillEmbedded(accountId, email, password, 'dola'); }
  async dolaCalibrateEmbedded(accountId: string): Promise<DolaLoginStep> { return this.batchLoginCalibrateEmbedded(accountId, 'dola'); }
  async dolaCaptureClickPoint(accountId: string, target: DolaClickTarget): Promise<DolaClickPoint> {
    const account = this.account(accountId);
    if (account.platform !== 'dola') throw new Error('仅 Dola 账号支持登录点位校准');
    const entry = await this.waitForDolaEntry(accountId);
    const contents = this.dolaCalibrationContents(accountId, target, entry);
    if (!contents || contents.isDestroyed()) {
      throw new Error(target === 'google' ? '请先测试登录点位并打开 Google 登录窗口' : 'Dola 页面尚未准备好');
    }
    const result = await contents.executeJavaScript(buildDolaClickCaptureScript(target), true);
    const point = normalizeDolaClickPoint(result);
    if (!point) {
      const message = result && typeof result === 'object' && typeof (result as { message?: unknown }).message === 'string'
        ? String((result as { message: string }).message)
        : '没有记录到有效点位';
      throw new Error(message);
    }
    const current = this.settings.get().dolaClickProfile;
    this.settings.update({ dolaClickProfile: { ...current, [target]: point, updatedAt: new Date().toISOString() } });
    return point;
  }
  async dolaTestClickPoint(accountId: string, target: DolaClickTarget): Promise<{ ok: boolean; message: string }> {
    const account = this.account(accountId);
    if (account.platform !== 'dola') throw new Error('仅 Dola 账号支持登录点位测试');
    const entry = await this.waitForDolaEntry(accountId);
    const contents = this.dolaCalibrationContents(accountId, target, entry);
    if (!contents || contents.isDestroyed()) {
      throw new Error(target === 'google' ? '请先测试登录点位，等待 Google 登录窗口出现' : 'Dola 页面尚未准备好');
    }
    const point = this.settings.get().dolaClickProfile[target];
    await this.dispatchDolaNativeClick(contents, point);
    return { ok: true, message: `已按保存的${target === 'login' ? '登录' : 'Google'}点位点击` };
  }
  private dolaCalibrationContents(accountId: string, target: DolaClickTarget, entry: Entry): WebContents | null {
    if (target === 'login') return entry.view.webContents;
    const popups = this.loginPopups.get(accountId);
    const popup = [...(popups ?? [])].reverse().find((item) => !item.isDestroyed() && !item.webContents.isDestroyed());
    return popup?.webContents ?? null;
  }
  private async dispatchDolaNativeClick(contents: WebContents, point: DolaClickPoint): Promise<void> {
    const devtools = contents.debugger;
    const wasAttached = devtools.isAttached();
    if (!wasAttached) devtools.attach('1.3');
    try {
      let viewport = { width: 1280, height: 720 };
      try {
        const value = await contents.executeJavaScript('({ width: Number(window.innerWidth) || 1280, height: Number(window.innerHeight) || 720 })', true) as { width?: number; height?: number };
        viewport = { width: Math.max(1, Number(value.width) || 1280), height: Math.max(1, Number(value.height) || 720) };
      } catch { /* Use a safe default if the page is transitioning. */ }
      const x = Math.max(1, Math.min(viewport.width - 1, Math.round(point.xRatio * viewport.width)));
      const y = Math.max(1, Math.min(viewport.height - 1, Math.round(point.yRatio * viewport.height)));
      await devtools.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
      await devtools.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await devtools.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    } finally {
      if (!wasAttached && devtools.isAttached()) {
        try { devtools.detach(); } catch { /* page may have closed */ }
      }
    }
  }
  async clearSession(accountId: string, kind: SessionDataKind): Promise<void> {
    this.account(accountId); const ses = session.fromPartition(`persist:account_${accountId}`);
    await clearSessionData(ses, kind);
  }
  async importStorage(accountId: string, bundle: StorageImportBundle): Promise<{ cookies: number; localStorage: number; sessionStorage: number; indexedDb: number; errors: string[] }> {
    const account = this.account(accountId); const ses = session.fromPartition(`persist:account_${accountId}`); const errors: string[] = [...(bundle.warnings ?? [])]; let cookies = 0;
    for (const cookie of bundle.cookies ?? []) {
      try {
        const domain = cookie.domain.replace(/^\./, ''); const url = `https://${domain}${cookie.path || '/'}`;
        await ses.cookies.set({ url, name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path || '/', secure: cookie.secure, httpOnly: cookie.httpOnly, expirationDate: cookie.expires && cookie.expires > 0 ? cookie.expires : undefined, sameSite: normalizeSameSite(cookie.sameSite) }); cookies++;
      } catch (error) { errors.push(`Cookie ${cookie.name}：${error instanceof Error ? error.message : String(error)}`); }
    }
    await ses.cookies.flushStore();
    const entry = this.entries.get(accountId); let localStorage = 0; let sessionStorage = 0; let indexedDb = 0;
    const hasStructuredStorage = Object.prototype.hasOwnProperty.call(bundle, 'localStorage') || Object.prototype.hasOwnProperty.call(bundle, 'sessionStorage') || Boolean(bundle.indexedDb?.databases.length);
    if (hasStructuredStorage) {
      if (!entry || entry.view.webContents.isDestroyed()) {
        errors.push('LocalStorage/SessionStorage/IndexedDB 导入需要先打开账号页面');
      } else {
        try {
          const rawResult = await entry.view.webContents.executeJavaScript(buildStorageImportScript(bundle), true) as unknown;
          const result = typeof rawResult === 'string' ? JSON.parse(rawResult) as { local?: number; session?: number; indexedDB?: number; errors?: unknown[] } : rawResult as { local?: number; session?: number; indexedDB?: number; errors?: unknown[] };
          localStorage = Number(result?.local) || 0; sessionStorage = Number(result?.session) || 0; indexedDb = Number(result?.indexedDB) || 0;
          for (const error of result?.errors ?? []) if (typeof error === 'string' && error.trim()) errors.push(error);
        } catch (error) {
          errors.push(`结构化存储导入失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    void account;
    return { cookies, localStorage, sessionStorage, indexedDb, errors };
  }
  proxyCredentials(webContents: WebContents | null, host: string, port: number): { username: string; password: string } | null {
    const owned = webContents ? this.ownsWebContents(webContents.id) : null;
    return resolveProxyCredentials(this.accounts.list(), owned, Boolean(webContents), host, port);
  }
  async resolveBlob(accountId: string, url: string): Promise<Buffer> {
    const entry = this.entries.get(accountId); if (!entry) throw new Error('请先打开包含该素材的账号页面');
    if (!url.startsWith('blob:')) throw new Error('不是 Blob 地址');
    const bytes = await entry.view.webContents.executeJavaScript(`fetch(${JSON.stringify(url)}).then(async response => { if (!response.ok) throw new Error('Blob读取失败'); return Array.from(new Uint8Array(await response.arrayBuffer())); })`, true) as number[];
    if (!Array.isArray(bytes) || bytes.length > 500_000_000) throw new Error('Blob 数据无效或过大');
    return Buffer.from(bytes);
  }
  private stopAccountRuntime(accountId: string): Promise<void> {
    const pending = this.runtimeStops.get(accountId);
    if (pending) return pending;
    const task = (async () => { await this.proxy?.stopRuntime(accountId); })();
    this.runtimeStops.set(accountId, task);
    void task.finally(() => { if (this.runtimeStops.get(accountId) === task) this.runtimeStops.delete(accountId); }).catch(() => undefined);
    return task;
  }
  private account(id: string): Account { const account = this.accounts.list().find((item) => item.id === id); if (!account) throw new Error('账号不存在'); return account; }
  private async waitForBatchLoginEntry(accountId: string, platform: BatchLoginPlatform): Promise<Entry> {
    if (!this.entries.has(accountId)) await this.open(accountId);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const entry = this.entries.get(accountId);
      if (entry && !entry.view.webContents.isDestroyed()) {
        const url = entry.view.webContents.getURL();
        if (isBatchLoginUrl(url, platform)) return entry;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`内置 ${platform === 'higgsfield' ? 'Higgsfield' : 'Dola'} 页面加载超时，请先打开账号页面`);
  }
  private async waitForDolaEntry(accountId: string): Promise<Entry> { return this.waitForBatchLoginEntry(accountId, 'dola'); }
  private dolaLoginTargets(accountId: string, entry: Entry): WebContents[] {
    const popups = this.loginPopups.get(accountId);
    const targets = [...(popups ?? [])].filter((popup) => !popup.isDestroyed()).map((popup) => popup.webContents).filter((contents) => !contents.isDestroyed());
    targets.push(entry.view.webContents);
    return targets;
  }
  private closeLoginPopups(accountId: string): void {
    const popups = this.loginPopups.get(accountId);
    if (!popups) return;
    this.loginPopups.delete(accountId);
    for (const popup of popups) { try { if (!popup.isDestroyed()) popup.close(); } catch { /* The parent window may already be closing. */ } }
  }
  private clearNetworkResponses(webContentsId: number): void { const prefix = `${webContentsId}:`; for (const key of this.networkResponses.keys()) if (key.startsWith(prefix)) this.networkResponses.delete(key); }
  private disposeView(view: WebContentsView): void { try { if (view.webContents.debugger.isAttached()) view.webContents.debugger.detach(); } catch { /* debugger may already be gone */ } try { view.webContents.close(); } catch { /* renderer may already be gone */ } }
  private url(account: Account): string { if (account.browser.restoreOnStart && /^https?:\/\//i.test(account.browser.lastUrl)) return account.browser.lastUrl; return account.browser.homeUrl || (account.platform === 'custom' ? account.customUrl || 'about:blank' : adapters[account.platform].definition.url); }

  private assetPath(...parts: string[]): string {
    return join(app.isPackaged ? process.resourcesPath : process.cwd(), 'site-assets', ...parts);
  }
  private configureSession(account: Account, ses: Electron.Session): void {
    const requestSettings = this.settings;
    installSiteRequestCompatibility(ses, () => requestSettings.get().blockedSiteRequestCompatibility, this.networkDiagnosticSink ?? undefined);
    const accounts = this.accounts; const accountId = account.id;
    setMediaRequestProxyAuth(ses, (host, port) => resolveProxyCredentials(accounts.list(), accountId, true, host, port));
    const fallbackFingerprint = createFingerprintProfile(account.platform, account.fingerprint.seed || account.id);
    const fingerprint = adaptFingerprintProfile(account.platform, account.fingerprint.userAgent ? account.fingerprint : fallbackFingerprint);
    ses.setUserAgent(fingerprint.userAgent, fingerprint.languages.join(','));
    const passive = ['clipboard-sanitized-write', 'fullscreen', 'notifications']; const prompt = ['media', 'geolocation', 'clipboard-read', 'display-capture'];
    const grantKey = (permission: string, origin: string): string => `${permission}:${origin}`; if (!this.permissionGrants.has(account.id)) this.permissionGrants.set(account.id, new Set());
    ses.setPermissionCheckHandler((_wc, permission, origin) => /^https:\/\//i.test(origin) && (passive.includes(permission) || this.permissionGrants.get(account.id)!.has(grantKey(permission, origin))));
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      let origin = ''; try { origin = new URL(details.requestingUrl || wc?.getURL() || '').origin; } catch { return callback(false); }
      if (!/^https:\/\//i.test(origin)) return callback(false); if (passive.includes(permission)) return callback(true); if (!prompt.includes(permission)) return callback(false);
      void dialog.showMessageBox(this.window, { type: 'question', title: '网站权限请求', message: `${origin} 请求使用“${permission}”权限`, detail: `账号：${account.name}\n仅在你确认当前网站确实需要时允许。`, buttons: ['拒绝', '本次允许'], defaultId: 0, cancelId: 0 }).then(({ response }) => { if (response === 1) this.permissionGrants.get(account.id)!.add(grantKey(permission, origin)); callback(response === 1); }).catch(() => callback(false));
    });
    if (!this.configuredSessions.has(account.id)) {
      this.configuredSessions.add(account.id);
      const handler = (event: ElectronEvent, item: DownloadItem): void => {
        const url = item.getURL();
        if (this.programmaticDownloadGuard.shouldCancel(account.id, url)) {
          event.preventDefault();
          try { item.cancel(); } catch { /* the item may already have completed */ }
          return;
        }
        const filename = item.getFilename();
        const mimeType = typeof (item as DownloadItem & { getMimeType?: () => string }).getMimeType === 'function'
          ? (item as DownloadItem & { getMimeType: () => string }).getMimeType()
          : '';
        const type = classifyNativeDownload(filename, url, mimeType);
        // Keep non-media downloads (PDF, ZIP, JSON, etc.) on Chromium's
        // default path.  The old implementation handled these as ordinary
        // downloads; treating them as images would silently lose them.
        if (type && this.siteDownloadSink) {
          event.preventDefault();
          this.siteDownloadSink(account.id, { type, url, title: filename, source: 'site-download', mimeType });
          return;
        }
        // Keep the native DownloadItem behavior for ordinary files, while
        // matching the legacy app's configured directory and account folder.
        // If path allocation is unavailable, returning leaves Electron's
        // normal platform default untouched instead of cancelling the file.
        if (!this.nativeDownloadPathResolver || !filename) return;
        let savePath = '';
        try { savePath = this.nativeDownloadPathResolver(account.id, filename); } catch { return; }
        if (!savePath) return;
        try {
          item.setSavePath(savePath);
          item.once('done', (_doneEvent, state) => {
            this.nativeDownloadPathRelease?.(savePath);
            if (state !== 'completed') return;
            this.nativeDownloadSink?.({ accountId: account.id, filename, path: savePath, url });
          });
        } catch {
          this.nativeDownloadPathRelease?.(savePath);
        }
      };
      ses.on('will-download', handler);
      this.downloadListenerDisposers.set(account.id, () => ses.off('will-download', handler));
    }
  }
  private detachDownloadListener(accountId: string): void {
    this.downloadListenerDisposers.get(accountId)?.();
    this.downloadListenerDisposers.delete(accountId);
    this.configuredSessions.delete(accountId);
  }
  private async loadExtensions(account: Account, ses: Electron.Session): Promise<void> {
    const builtIn = this.builtInExtensionIds.get(account.id) ?? new Map<string, string>();
    this.builtInExtensionIds.set(account.id, builtIn);
    const desired = new Set(this.settings.get().disabledAdapters.includes(account.platform) ? [] : adapters[account.platform].extensions);
    for (const [name, extensionId] of [...builtIn]) {
      if (desired.has(name)) continue;
      try { ses.extensions.removeExtension(extensionId); } catch { /* extension may already be gone */ }
      builtIn.delete(name);
    }
    const loaded = this.customExtensionIds.get(account.id) ?? new Map<string, string>();
    this.customExtensionIds.set(account.id, loaded);
    for (const name of desired) {
      if (builtIn.has(name)) continue;
      try {
        const extension = await withTimeout(ses.extensions.loadExtension(this.assetPath('extensions', name), { allowFileAccess: false }), 4000, `扩展 ${name} 加载超时`);
        if (extension?.id) builtIn.set(name, extension.id);
      } catch { /* DOM/CDP adapters remain available */ }
    }
    await this.syncCustomExtensionsFor(account.id, ses, loaded);
  }
  private detachAccountExtensions(accountId: string, ses: Electron.Session): void {
    for (const extensionId of this.builtInExtensionIds.get(accountId)?.values() ?? []) {
      try { ses.extensions.removeExtension(extensionId); } catch { /* extension may already be gone */ }
    }
    for (const extensionId of this.customExtensionIds.get(accountId)?.values() ?? []) {
      try { ses.extensions.removeExtension(extensionId); } catch { /* extension may already be gone */ }
    }
  }
  private async syncCustomExtensions(): Promise<void> {
    for (const [accountId] of this.entries) {
      await this.syncCustomExtensionsFor(accountId, session.fromPartition(`persist:account_${accountId}`), this.customExtensionIds.get(accountId) ?? new Map<string, string>());
    }
  }
  private async syncCustomExtensionsFor(accountId: string, ses: Electron.Session, loaded: Map<string, string>): Promise<void> {
    const enabled = new Map((this.plugins?.enabledPaths() ?? []).map((plugin) => [plugin.id, plugin.path]));
    for (const [pluginId, extensionId] of [...loaded]) {
      const path = enabled.get(pluginId);
      if (path) continue;
      try { ses.extensions.removeExtension(extensionId); } catch { /* extension may already be gone */ }
      loaded.delete(pluginId);
    }
    for (const [pluginId, path] of enabled) {
      if (loaded.has(pluginId)) continue;
      try {
        const extension = await withTimeout(ses.extensions.loadExtension(path, { allowFileAccess: false }), 6000, `插件 ${pluginId} 加载超时`);
        loaded.set(pluginId, extension.id);
      } catch { /* an invalid extension must not block the account page */ }
    }
    this.customExtensionIds.set(accountId, loaded);
  }
  private async injectSiteScripts(account: Account, view: WebContentsView): Promise<void> {
    if (this.settings.get().disabledAdapters.includes(account.platform)) return;
    if (!/^https?:\/\//i.test(view.webContents.getURL())) return;
    const installed = this.documentScriptNames.get(account.id) ?? new Set<string>();
    const fallbackInstalled = this.fallbackScriptNames.get(account.id) ?? new Set<string>();
    this.fallbackScriptNames.set(account.id, fallbackInstalled);
    for (const name of [...adapters[account.platform].scripts, ...(account.platform === 'doubao' ? ['doubao-15s-floating'] : [])]) {
      if (installed.has(name) || fallbackInstalled.has(name)) continue;
      try {
        await view.webContents.executeJavaScript(name === 'doubao-15s-floating' ? buildDoubao15sFloatingScript() : readFileSync(this.assetPath('scripts', name), 'utf8'), true);
        fallbackInstalled.add(name);
      } catch { /* A site script must not break navigation; a later retry may still succeed. */ }
    }
  }

  private async setupDebugger(account: Account, view: WebContentsView): Promise<void> {
    const adapter = adapters[account.platform]; const settings = this.settings.get();
    try {
      view.webContents.debugger.attach('1.3');
      // Electron 43 requires the Page domain to be enabled before scripts are
      // registered. The initial about:blank document is created by
      // initializeView, so this command is safe and makes the registration
      // order deterministic for both fingerprint and adapter scripts.
      await view.webContents.debugger.sendCommand('Page.enable');
      await this.fingerprints.install(account.id, view.webContents);
      await this.installDocumentScripts(account, view);
      if (settings.disabledAdapters.includes(account.platform)) return;
      await view.webContents.debugger.sendCommand('Network.enable', { maxTotalBufferSize: 50_000_000, maxResourceBufferSize: 15_000_000 });
      const patchEnabled = settings.experimentalResponsePatchEnabled && adapter.patchResponse && adapter.fetchPatterns.length;
      if (patchEnabled) await view.webContents.debugger.sendCommand('Fetch.enable', { patterns: adapter.fetchPatterns });
      const sockets = new WebSocketDiagnosticTracker(account.id, (level, message) => this.networkDiagnosticSink?.(level, message));
      view.webContents.debugger.on('message', async (_event, method, params) => {
        sockets.record(method, params);
        if (this.settings.get().disabledAdapters.includes(account.platform)) { if (method === 'Fetch.requestPaused') try { await view.webContents.debugger.sendCommand('Fetch.continueRequest', { requestId: String(params.requestId) }); } catch { /* page closed */ } return; }
        if (method === 'Fetch.requestPaused') await this.patchPausedResponse(adapter, view, params);
        if (method === 'Network.responseReceived') {
          if (!adapter.definition.specialized && !adapter.parseResponse) return;
          const mime = String(params.response?.mimeType ?? ''); const type = String(params.type ?? '');
          if (!/json|event-stream|text\//i.test(mime) || !/XHR|Fetch/i.test(type)) return;
          this.networkResponses.set(`${view.webContents.id}:${String(params.requestId)}`, { accountId: account.id, platform: account.platform, url: String(params.response?.url ?? '') });
        }
        if (method === 'Network.loadingFinished') {
          const key = `${view.webContents.id}:${String(params.requestId)}`; const pending = this.networkResponses.get(key); if (!pending) return; this.networkResponses.delete(key);
          try {
            const response = await view.webContents.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId });
            const body = response.base64Encoded ? Buffer.from(response.body, 'base64').toString('utf8') : String(response.body ?? '');
            if (body.length > 15_000_000) return;
            const responseUrl = pending.url;
            if (!this.acceptsMediaCapture(pending.accountId)) return;
            if (pending.platform === 'doubao') {
              for (const candidate of parseDoubaoPlayInfoResponse(responseUrl, body) ?? []) {
                if (candidate.vid) {
                  if (this.doubaoPlayInfoApis.size >= 500) this.doubaoPlayInfoApis.delete(this.doubaoPlayInfoApis.keys().next().value!);
                  this.doubaoPlayInfoApis.set(`${pending.accountId}:${candidate.vid}`, responseUrl);
                }
              }
            }
            for (const resource of (adapter.parseResponse?.(responseUrl, body) ?? parseMediaPayload(body, `cdp:${pending.platform}`))) this.mediaSink?.(pending.accountId, resource);
            if (pending.platform === 'dola' || pending.platform === 'doubao') void this.resolveDolaFallbacks(pending.accountId, body, pending.platform === 'doubao' ? 'https://www.doubao.com/' : dolaFallbackReferer(responseUrl), pending.platform);
          } catch { /* streaming and cached bodies may be unavailable */ }
        }
        if (method === 'Network.loadingFailed') this.networkResponses.delete(`${view.webContents.id}:${String(params.requestId)}`);
      });
    } catch { /* Never block page loading when CDP is unavailable. */ }
  }
  private async installDocumentScripts(account: Account, view: WebContentsView): Promise<void> {
    if (this.settings.get().disabledAdapters.includes(account.platform)) return;
    const installed = this.documentScriptNames.get(account.id) ?? new Set<string>();
    this.documentScriptNames.set(account.id, installed);
    for (const name of [...adapters[account.platform].scripts, ...(account.platform === 'doubao' ? ['doubao-15s-floating'] : [])]) {
      if (installed.has(name)) continue;
      try {
        const source = name === 'doubao-15s-floating' ? buildDoubao15sFloatingScript() : readFileSync(this.assetPath('scripts', name), 'utf8');
        const result = await view.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source }) as { identifier?: string };
        if (typeof result?.identifier === 'string' && result.identifier) installed.add(name);
      } catch { /* did-finish-load injection below remains the safe fallback. */ }
    }
  }
  private async resolveDolaFallbacks(accountId: string, body: string, referer: string, platform: 'dola' | 'doubao' = 'dola'): Promise<void> {
    const target = session.fromPartition(`persist:account_${accountId}`);
    for (const fallbackApi of extractDolaFallbackApis(body)) {
      const key = `${accountId}:${fallbackApi}`;
      if (this.resolvedDolaFallbackApis.has(key) || this.resolvingDolaFallbackApis.has(key)) continue;
      const operation = Symbol(); this.resolvingDolaFallbackApis.set(key, operation);
      try {
        const resolved = await this.dolaResolver.resolve(fallbackApi, target, referer);
        if (this.resolvingDolaFallbackApis.get(key) !== operation) continue;
        // Only suppress future attempts after a successful resolution. A
        // transient HTTP/token failure should be retryable when the page
        // exposes the same fallback API again.
        this.resolvedDolaFallbackApis.add(key);
        this.resolverDiagnosticSink?.(`[video-resolver] platform=${platform} account=${accountId} result=resolved host=${new URL(resolved.videoUrl).hostname}`);
        let vid: string | undefined;
        try { const query = new URL(fallbackApi).searchParams; vid = query.get('video_id') || query.get('vid') || undefined; } catch { /* extractor already validates the URL */ }
        if (platform === 'doubao' && vid) this.doubaoPlayInfoApis.set(`${accountId}:${vid}`, fallbackApi);
        this.mediaSink?.(accountId, { type: 'video', url: resolved.videoUrl, alternateUrls: resolved.alternateUrls, thumbUrl: resolved.posterUrl || undefined, vid, title: platform === 'doubao' ? '豆包原视频' : 'Dola 原视频', source: `${platform}-video-fallback-api`, confirmedNoWatermark: true, resolutionMethod: 'fallback_api', qualityEvidence: 'platform-api' });
      } catch (error) {
        if (this.resolvingDolaFallbackApis.get(key) !== operation) continue;
        const message = (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, '[URL]');
        this.resolverDiagnosticSink?.(`[video-resolver] platform=${platform} account=${accountId} result=failed error=${message}`);
      } finally { if (this.resolvingDolaFallbackApis.get(key) === operation) this.resolvingDolaFallbackApis.delete(key); }
    }
  }
  private async patchPausedResponse(adapter: typeof adapters[keyof typeof adapters], view: WebContentsView, params: Record<string, any>): Promise<void> {
    const requestId = String(params.requestId); const url = String(params.request?.url ?? '');
    try {
      if (!params.responseStatusCode || !adapter.patchResponse) { await view.webContents.debugger.sendCommand('Fetch.continueRequest', { requestId }); return; }
      const response = await view.webContents.debugger.sendCommand('Fetch.getResponseBody', { requestId });
      const body = response.base64Encoded ? Buffer.from(response.body, 'base64').toString('utf8') : String(response.body ?? ''); const patched = adapter.patchResponse(url, body);
      if (!patched.changed) { await view.webContents.debugger.sendCommand('Fetch.continueRequest', { requestId }); return; }
      const headers = responsePatchHeaders(params.responseHeaders as Array<{ name: string; value: string }> | undefined ?? [], patched.body);
      await view.webContents.debugger.sendCommand('Fetch.fulfillRequest', { requestId, responseCode: params.responseStatusCode, responsePhrase: params.responseStatusText, responseHeaders: headers, body: Buffer.from(patched.body).toString('base64') });
    } catch { try { await view.webContents.debugger.sendCommand('Fetch.continueRequest', { requestId }); } catch { /* page closed */ } }
  }
}

type DolaPageResult = Partial<DolaVideoTaskResult> & { referenceCount?: number; composerReady?: boolean; referenceInput?: boolean };
type DolaFileInputTarget = { nodeId?: number; backendNodeId?: number };

function validateDolaReferencePaths(paths: string[]): string[] {
  const unique = [...new Set(paths.map((path) => resolve(path.trim())))];
  if (unique.length > 9) throw new Error('Dola 参考图最多选择 9 张');
  const allowed = new Set(['.png', '.jpg', '.jpeg', '.webp']);
  let totalBytes = 0;
  for (const path of unique) {
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`参考图不存在：${basename(path)}`);
    if (!allowed.has(extname(path).toLowerCase())) throw new Error(`不支持的参考图格式：${basename(path)}`);
    const bytes = statSync(path).size;
    if (bytes > 50 * 1024 * 1024) throw new Error(`参考图超过 50 MB：${basename(path)}`);
    totalBytes += bytes;
  }
  if (totalBytes > 150 * 1024 * 1024) throw new Error('参考图总大小超过 150 MB');
  return unique;
}

function isBatchLoginUrl(raw: string, platform: BatchLoginPlatform = 'dola'): boolean {
  try {
    const hostname = new URL(raw).hostname;
    const siteMatches = platform === 'higgsfield'
      ? /(^|\.)higgsfield\.ai$/i.test(hostname)
      : /(^|\.)dola\.com$/i.test(hostname) || /(^|\.)ciciai\.com$/i.test(hostname);
    return siteMatches || /(^|\.)google\.com$/i.test(hostname);
  } catch { return false; }
}

function normalizeSameSite(value: string | undefined): 'unspecified' | 'no_restriction' | 'lax' | 'strict' | undefined {
  const normalized = String(value ?? '').toLowerCase(); if (normalized === 'none' || normalized === 'no_restriction') return 'no_restriction'; if (normalized === 'lax') return 'lax'; if (normalized === 'strict') return 'strict'; return undefined;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([promise, new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]); }
  finally { if (timer) clearTimeout(timer); }
}
