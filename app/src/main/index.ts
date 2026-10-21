import { app, BrowserWindow, dialog, globalShortcut, protocol } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AccountService } from './accounts';
import { BrowserManager } from './browser-manager';
import { prepareDataPaths, ProfileLocationService, resolveDataPaths, resolveRuntimeDataOptions } from './data';
import { registerIpc } from './ipc';
import { captureModeAccepts, MediaService } from './media';
import { SettingsService } from './settings';
import { ConfigBackupService } from './config-backup';
import { createMediaProtocolHandler } from './media-protocol';
import { setMediaRequestLogger } from './media-request';
import { NetworkFailureReporter } from './network-diagnostics';
import { consumeCompatibilityCancellation } from './site-request-compatibility';
import { UpdateService } from './updates';
import { ExternalLoginService } from './external-login';
import { Logger } from './logger';
import { ProxyService } from './proxy';
import { FingerprintService } from './fingerprint';
import { LegacyMigrationService } from './migration';
import { PluginService } from './plugins';
import { LegacyCacheCleaner } from './cache-cleaner';
import { enqueueTeardown } from './lifecycle';
import { channels } from '../shared/channels';

app.commandLine.appendSwitch('lang', 'zh-CN');
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('disable-features', 'ThirdPartyStoragePartitioning');
if (process.env.AIAM_DISABLE_GPU === '1') app.disableHardwareAcceleration();
if (process.env.AIAM_ENABLE_REMOTE_DEBUG === '1') {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.AIAM_REMOTE_DEBUG_PORT || '9223');
  app.commandLine.appendSwitch('remote-allow-origins', 'http://localhost');
}
const dataOptions = resolveRuntimeDataOptions();
const profileLocation = new ProfileLocationService(dataOptions);
const paths = resolveDataPaths(dataOptions, profileLocation.get().path);
protocol.registerSchemesAsPrivileged([{ scheme: 'workbench-media', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } }]);
const logger = new Logger(paths.logs);
process.once('exit', () => logger.flushSync());
// Milliseconds since the process started, for the [startup-timing] log lines.
const uptimeMs = (): number => Math.round(process.uptime() * 1000);
const networkFailures = new NetworkFailureReporter((level, message) => logger[level](message));
app.once('will-quit', () => networkFailures.dispose());
setMediaRequestLogger((message) => logger.info(message));
// Chromium's socket console messages omit the failing destination. Record
// session request failures without signed URL parameters or login credentials.
app.on('session-created', (ses) => {
  ses.webRequest.onErrorOccurred((details) => {
    // Only cancellations made by our own policy are informational. Ordinary
    // blocked requests, certificate failures and media errors stay diagnostic.
    if (consumeCompatibilityCancellation(ses, details.id)) return;
    networkFailures.record(details);
  });
});
try { prepareDataPaths(paths); app.setPath('userData', paths.sessions); } catch (error) { dialog.showErrorBox('AI创作工作台无法启动', error instanceof Error ? error.message : String(error)); app.exit(1); }
// Keep native TLS/GPU errors for diagnosis without flooding the development
// terminal. Certificate validation and network routing remain unchanged.
app.commandLine.appendSwitch('enable-logging', 'file');
app.commandLine.appendSwitch('log-file', join(paths.logs, 'chromium.log'));
app.commandLine.appendSwitch('log-level', '1');

if (!app.requestSingleInstanceLock()) app.exit(0);

let registeredBossKey = '';
let mainWindow: BrowserWindow | null = null;
let activeRuntime: {
  browser: BrowserManager;
  externalLogin: ExternalLoginService;
  proxy: ProxyService;
  disposeSettingsListener: () => void;
  disposeIpc: () => void;
} | null = null;
let lifecycleInstalled = false;
let shutdownStarted = false;
let windowCreation: Promise<BrowserWindow> | null = null;
let runtimeTeardown: Promise<void> = Promise.resolve();
let mediaProtocolInstalled = false;
let activeMedia: MediaService | null = null;
let persistentRuntimeStarted = false;
type PersistentServices = {
  accounts: AccountService;
  settings: SettingsService;
  proxy: ProxyService;
  fingerprints: FingerprintService;
  plugins: PluginService;
  media: MediaService;
  updates: UpdateService;
  externalLogin: ExternalLoginService;
  cacheCleaner: LegacyCacheCleaner;
  backups: ConfigBackupService;
};
let persistentServices: PersistentServices | null = null;
function bossKeyAccelerator(settings: ReturnType<SettingsService['get']>): string | null {
  const boss = settings.bossKey;
  if (!boss.enabled || !boss.key) return null;
  const modifiers: string[] = [];
  if (boss.ctrl) modifiers.push('Control');
  if (boss.alt) modifiers.push('Alt');
  if (boss.shift) modifiers.push('Shift');
  if (boss.meta) modifiers.push(process.platform === 'darwin' ? 'Command' : 'Super');
  if (!modifiers.length) return null;
  return [...modifiers, boss.key.toUpperCase()].join('+');
}
function configureBossKey(window: BrowserWindow, settings: ReturnType<SettingsService['get']>): void {
  if (registeredBossKey) { globalShortcut.unregister(registeredBossKey); registeredBossKey = ''; }
  const accelerator = bossKeyAccelerator(settings);
  if (!accelerator) return;
  if (!globalShortcut.register(accelerator, () => {
    if (window.isDestroyed()) return;
    if (window.isVisible()) window.hide();
    else { window.show(); window.focus(); }
  })) logger.warn(`无法注册 Boss Key：${accelerator}`);
  else registeredBossKey = accelerator;
}

function queueProxyShutdown(proxy: ProxyService): Promise<void> {
  const next = enqueueTeardown(runtimeTeardown, () => proxy.shutdown()).catch((error) => {
    logger.warn(`代理运行时退出清理失败：${error instanceof Error ? error.message : String(error)}`);
  });
  runtimeTeardown = next;
  return next;
}

function getPersistentServices(): PersistentServices {
  if (persistentServices) return persistentServices;
  const accounts = new AccountService(join(paths.config, 'accounts.json'));
  const settings = new SettingsService(join(paths.config, 'settings.json'), paths.downloads);
  const backups = new ConfigBackupService(paths.config);
  try { backups.automatic(); } catch (error) { logger.error(error instanceof Error ? error.message : String(error)); }
  if (!accounts.list().length) {
    const legacy = join(app.getPath('appData'), 'AIAccountManager', 'accounts.json');
    if (existsSync(legacy)) { try { const rows = JSON.parse(readFileSync(legacy, 'utf8')); if (Array.isArray(rows)) accounts.importMetadata(rows); } catch { /* manual import remains available */ } }
  }
  const proxy = new ProxyService(join(paths.config, 'proxy'), accounts);
  const fingerprints = new FingerprintService(accounts);
  const plugins = new PluginService(paths.config);
  const media = new MediaService(accounts, settings, (accountId, url) => {
    const browser = activeRuntime?.browser;
    return browser ? browser.resolveBlob(accountId, url) : Promise.reject(new Error('浏览器页面未打开'));
  }, undefined, join(paths.config, 'download-tasks.json'), join(paths.root, 'preview-cache'));
  const updates = new UpdateService(paths.updates);
  const externalLogin = new ExternalLoginService(join(paths.root, 'external-login'), accounts, settings, proxy);
  const cacheCleaner = new LegacyCacheCleaner({
    localAppData: process.platform === 'win32' ? process.env.LOCALAPPDATA : undefined,
    temp: app.getPath('temp'),
    activeDirs: [dirname(process.execPath), app.getAppPath(), process.resourcesPath]
  });
  persistentServices = { accounts, settings, proxy, fingerprints, plugins, media, updates, externalLogin, cacheCleaner, backups };
  return persistentServices;
}

function flushPersistentState(): void {
  try { persistentServices?.accounts.flush(); } catch (error) { logger.warn(`账号位置保存失败：${error instanceof Error ? error.message : String(error)}`); }
  try { persistentServices?.media.flush(); } catch (error) { logger.warn(`下载任务保存失败：${error instanceof Error ? error.message : String(error)}`); }
  logger.flushSync();
}

async function createWindow(): Promise<BrowserWindow> {
  await runtimeTeardown;
  const window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1080, minHeight: 680, title: 'AI创作工作台',
    backgroundColor: '#f3f4f7', autoHideMenuBar: true,
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#ffffff', symbolColor: '#303746', height: 36 } } : {}),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
    if (level === 'debug') return;
    logger.info(`[renderer:${level}] ${message} (${sourceId}:${lineNumber})`);
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logger.error(`[renderer:did-fail-load] code=${errorCode} description=${errorDescription} url=${validatedURL} mainFrame=${isMainFrame}`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`[renderer:gone] reason=${details.reason} exitCode=${details.exitCode}`);
  });
  logger.info(`[startup-timing] window-created=${uptimeMs()}ms`);
  const services = getPersistentServices();
  logger.info(`[startup-timing] services-ready=${uptimeMs()}ms`);
  const { accounts, settings, proxy, fingerprints, plugins, media, updates, externalLogin, cacheCleaner, backups } = services;
  const syncWindowTheme = (theme: 'light' | 'dark'): void => {
    window.setBackgroundColor(theme === 'light' ? '#f3f4f7' : '#30343c');
    if (process.platform === 'win32') window.setTitleBarOverlay({ color: theme === 'light' ? '#ffffff' : '#30343c', symbolColor: theme === 'light' ? '#303746' : '#f3f4f7', height: 36 });
  };
  syncWindowTheme(settings.get().theme);
  configureBossKey(window, settings.get());
  const browser = new BrowserManager(window, accounts, settings, proxy, fingerprints, plugins);
  browser.setResolverDiagnosticSink((message) => logger.info(message));
  browser.setNetworkDiagnosticSink((level, message) => logger[level](message));
  media.setProgrammaticDownloadMarker((accountId, url) => browser.markProgrammaticDownload(accountId, url));
  media.setResourceRefresher(async (resource) => {
    const account = accounts.list().find((item) => item.id === resource.accountId);
    if (account?.platform === 'dola') {
      await browser.resolveDolaResource(resource.accountId, resource, false);
    } else if (account?.platform === 'doubao') {
      await browser.refreshDoubaoVideo(resource.accountId, resource);
    } else throw new Error('请在账号页面打开原视频对话后重新捕获素材');
  });
  const disposeSettingsListener = settings.onChange((value, previous) => {
    configureBossKey(window, value);
    syncWindowTheme(value.theme);
    void browser.syncAdapterSettings(previous.disabledAdapters, value.disabledAdapters, previous.experimentalResponsePatchEnabled !== value.experimentalResponsePatchEnabled);
  });
  // Match the original application: captured resources are a runtime feed, not a cross-restart archive.
  if (!mediaProtocolInstalled) {
    protocol.handle('workbench-media', createMediaProtocolHandler(() => activeMedia));
    mediaProtocolInstalled = true;
  }
  activeMedia = media;
  browser.setSleepGuard((accountId) => media.tasks().some((task) => task.accountId === accountId && (task.status === 'running' || task.status === 'queued')));
  browser.setMediaSink((accountId, resource) => { browser.markActivity(accountId); if (!captureModeAccepts((settings.get().parseImages ? 'all' : 'video'), resource)) return; const added = media.add(accountId, browser.scopeCapturedMedia(accountId, resource)); if (added) void media.materializeBlobPreview(added.id).catch(() => undefined); });
  browser.setSiteDownloadSink((accountId, resource) => { browser.markActivity(accountId); if (!captureModeAccepts((settings.get().parseImages ? 'all' : 'video'), resource)) return; const added = media.add(accountId, browser.scopeCapturedMedia(accountId, resource)); if (added) { media.enqueue(added.id); void media.materializeBlobPreview(added.id).catch(() => undefined); } });
  browser.setNativeDownloadSink((notice) => { if (!window.isDestroyed()) window.webContents.send(channels.filesDownloaded, notice); });
  browser.setNativeDownloadPathResolver((accountId, filename) => media.reserveNativeDownloadPath(accountId, filename), (path) => media.releaseReservedDownloadPath(path));
  const migration = new LegacyMigrationService(window, accounts, join(paths.config, 'accounts.json'), (accountId, bundle) => browser.importStorage(accountId, bundle), settings);
  const disposeIpc = registerIpc(window, { accounts, browser, media, settings, updates, externalLogin, proxy, fingerprints, migration, plugins, profileLocation, cacheCleaner, backups, requestRestart: () => { app.relaunch(); app.quit(); } });
  activeRuntime = { browser, externalLogin, proxy, disposeSettingsListener, disposeIpc };
  if (!persistentRuntimeStarted) { persistentRuntimeStarted = true; media.resume(); }
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
    disposeIpc();
    disposeSettingsListener();
    if (registeredBossKey) { globalShortcut.unregister(registeredBossKey); registeredBossKey = ''; }
    void externalLogin.closeAll();
    media.setProgrammaticDownloadMarker(null);
    browser.dispose();
    // The process may remain alive on macOS. Keep the persistent download and
    // account stores, but stop account-owned proxy children and discard the
    // window-bound runtime; the next window receives a fresh BrowserManager.
    // On macOS the process remains alive after the window closes. Keep this
    // promise visible to a later explicit app quit so child processes cannot
    // outlive the last BrowserWindow.
    flushPersistentState();
    if (!shutdownStarted) queueProxyShutdown(proxy);
    if (activeRuntime?.browser === browser) activeRuntime = null;
  });
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await window.loadFile(join(__dirname, '../renderer/index.html'));
  logger.info(`[startup-timing] ui-loaded=${uptimeMs()}ms`);
  return window;
}

function ensureMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); return; }
  if (windowCreation) return;
  windowCreation = createWindow().then((window) => { mainWindow = window; return window; }).catch((error) => {
    logger.error(error instanceof Error ? error.stack ?? error.message : String(error));
    dialog.showErrorBox('重新打开失败', error instanceof Error ? error.message : String(error));
    throw error;
  }).finally(() => { windowCreation = null; });
  void windowCreation.catch(() => undefined);
}

function installAppLifecycle(): void {
  if (lifecycleInstalled) return;
  lifecycleInstalled = true;
  app.on('login', (event, webContents, _details, authInfo, callback) => {
    if (!authInfo.isProxy) return;
    const runtime = activeRuntime;
    const credentials = runtime?.browser.proxyCredentials(webContents, authInfo.host, authInfo.port);
    if (!credentials) return;
    event.preventDefault(); callback(credentials.username, credentials.password);
  });
  app.on('before-quit', (event) => {
    if (shutdownStarted) return;
    event.preventDefault();
    shutdownStarted = true;
    const runtime = activeRuntime;
    flushPersistentState();
    const externalLoginTeardown = runtime?.externalLogin.closeAll() ?? Promise.resolve();
    runtime?.browser.dispose();
    runtime?.disposeIpc();
    const teardown = runtime ? queueProxyShutdown(runtime.proxy) : runtimeTeardown;
    void Promise.all([externalLoginTeardown, teardown]).finally(() => app.quit());
  });
  app.on('activate', () => {
    ensureMainWindow();
  });
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); return; }
    ensureMainWindow();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

app.whenReady().then(async () => {
  logger.info(`[startup-timing] app-ready=${uptimeMs()}ms`);
  installAppLifecycle();
  const window = await createWindow();
  mainWindow = window;
  logger.info(`started version=${app.getVersion()} packaged=${app.isPackaged}`);
}).catch((error) => { logger.error(error instanceof Error ? error.stack ?? error.message : String(error)); dialog.showErrorBox('启动失败', error instanceof Error ? error.stack ?? error.message : String(error)); app.quit(); });
process.on('uncaughtException', (error) => logger.error(error.stack ?? error.message));
process.on('unhandledRejection', (error) => logger.error(error instanceof Error ? error.stack ?? error.message : String(error)));
