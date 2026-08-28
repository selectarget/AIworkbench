import { app, BrowserWindow, dialog, globalShortcut, net, protocol } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AccountService } from './accounts';
import { BrowserManager } from './browser-manager';
import { prepareDataPaths, ProfileLocationService, resolveDataPaths, resolveRuntimeDataOptions } from './data';
import { registerIpc } from './ipc';
import { captureModeAccepts, MediaService } from './media';
import { SettingsService } from './settings';
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
try { prepareDataPaths(paths); app.setPath('userData', paths.sessions); } catch (error) { dialog.showErrorBox('AI创作工作台无法启动', error instanceof Error ? error.message : String(error)); app.exit(1); }

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
  }, undefined, join(paths.config, 'download-tasks.json'));
  const updates = new UpdateService(paths.updates);
  const externalLogin = new ExternalLoginService(join(paths.root, 'external-login'), accounts, settings, proxy);
  const cacheCleaner = new LegacyCacheCleaner({
    localAppData: process.platform === 'win32' ? process.env.LOCALAPPDATA : undefined,
    temp: app.getPath('temp'),
    activeDirs: [dirname(process.execPath), app.getAppPath(), process.resourcesPath]
  });
  persistentServices = { accounts, settings, proxy, fingerprints, plugins, media, updates, externalLogin, cacheCleaner };
  return persistentServices;
}

async function createWindow(): Promise<BrowserWindow> {
  await runtimeTeardown;
  const window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1080, minHeight: 680, title: 'AI创作工作台',
    backgroundColor: '#0b1020', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const label = ['debug', 'info', 'warning', 'error'][level] ?? String(level);
    logger.info(`[renderer:${label}] ${message} (${sourceId}:${line})`);
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logger.error(`[renderer:did-fail-load] code=${errorCode} description=${errorDescription} url=${validatedURL} mainFrame=${isMainFrame}`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`[renderer:gone] reason=${details.reason} exitCode=${details.exitCode}`);
  });
  const services = getPersistentServices();
  const { accounts, settings, proxy, fingerprints, plugins, media, updates, externalLogin, cacheCleaner } = services;
  configureBossKey(window, settings.get());
  const browser = new BrowserManager(window, accounts, settings, proxy, fingerprints, plugins);
  media.setProgrammaticDownloadMarker((accountId, url) => browser.markProgrammaticDownload(accountId, url));
  const disposeSettingsListener = settings.onChange((value, previous) => {
    configureBossKey(window, value);
    void browser.syncAdapterSettings(previous.disabledAdapters, value.disabledAdapters, previous.experimentalResponsePatchEnabled !== value.experimentalResponsePatchEnabled);
  });
  // Match the original application: captured resources are a runtime feed, not a cross-restart archive.
  if (!mediaProtocolInstalled) {
    protocol.handle('workbench-media', (request) => {
      const path = activeMedia?.previewPath(request.url);
      return path ? net.fetch(pathToFileURL(path).href) : new Response('Not found', { status: 404 });
    });
    mediaProtocolInstalled = true;
  }
  activeMedia = media;
  browser.setMediaSink((accountId, resource) => { if (!captureModeAccepts(settings.get().captureMode, resource)) return; media.add(accountId, resource); });
  browser.setSiteDownloadSink((accountId, resource) => { if (!captureModeAccepts(settings.get().captureMode, resource)) return; const added = media.add(accountId, resource); if (added) { media.enqueue(added.id); void media.materializeBlobPreview(added.id).catch(() => undefined); } });
  browser.setNativeDownloadSink((notice) => { if (!window.isDestroyed()) window.webContents.send(channels.filesDownloaded, notice); });
  browser.setNativeDownloadPathResolver((accountId, filename) => media.reserveNativeDownloadPath(accountId, filename), (path) => media.releaseReservedDownloadPath(path));
  const migration = new LegacyMigrationService(window, accounts, join(paths.config, 'accounts.json'), (accountId, bundle) => browser.importStorage(accountId, bundle), settings);
  const disposeIpc = registerIpc(window, { accounts, browser, media, settings, updates, externalLogin, proxy, fingerprints, migration, plugins, profileLocation, cacheCleaner, requestRestart: () => { app.relaunch(); app.quit(); } });
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
    if (!shutdownStarted) queueProxyShutdown(proxy);
    if (activeRuntime?.browser === browser) activeRuntime = null;
  });
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await window.loadFile(join(__dirname, '../renderer/index.html'));
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
  installAppLifecycle();
  const window = await createWindow();
  mainWindow = window;
  logger.info(`started version=${app.getVersion()} packaged=${app.isPackaged}`);
}).catch((error) => { logger.error(error instanceof Error ? error.stack ?? error.message : String(error)); dialog.showErrorBox('启动失败', error instanceof Error ? error.stack ?? error.message : String(error)); app.quit(); });
process.on('uncaughtException', (error) => logger.error(error.stack ?? error.message));
process.on('unhandledRejection', (error) => logger.error(error instanceof Error ? error.stack ?? error.message : String(error)));
