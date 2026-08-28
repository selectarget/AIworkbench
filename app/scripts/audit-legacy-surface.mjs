import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const legacyPreload = resolve(appRoot, '..', 'reference-original', 'electron-source', 'src', 'preload.js');
const currentPreload = resolve(appRoot, 'src', 'preload', 'index.ts');
const currentChannels = resolve(appRoot, 'src', 'shared', 'channels.ts');
const currentMain = resolve(appRoot, 'src', 'main');

const legacySource = readFileSync(legacyPreload, 'utf8');
const currentSource = [
  readFileSync(currentPreload, 'utf8'),
  readFileSync(currentChannels, 'utf8'),
  ...['ipc.ts', 'browser-manager.ts', 'media.ts', 'external-login.ts', 'updates.ts'].map((name) => readFileSync(resolve(currentMain, name), 'utf8'))
].join('\n');

const legacyKeys = [...legacySource.matchAll(/^\s{2}([A-Za-z_$][\w$]*):/gm)].map((match) => match[1]);

/**
 * The old preload exposed a flat API. The rebuilt app deliberately groups
 * the same operations by domain and keeps a few operations in Main Process.
 * This table is the reviewable source of truth for that flattening, rather
 * than relying on a substring search that could miss a renamed operation.
 */
const coverage = {
  getExtensionScripts: ['internal', 'adapters.loadExtensions'],
  minimize: ['internal', 'native BrowserWindow frame'],
  maximize: ['internal', 'native BrowserWindow frame'],
  close: ['internal', 'native BrowserWindow frame'],
  isMaximized: ['internal', 'native BrowserWindow frame'],
  getAccounts: ['mapped', 'accounts.list'],
  addAccount: ['mapped', 'accounts.create'],
  updateAccount: ['mapped', 'accounts.update'],
  deleteAccount: ['mapped', 'accounts.remove'],
  deleteAccounts: ['mapped', 'accounts.removeMany'],
  reorderAccounts: ['mapped', 'accounts.reorder'],
  exportAccounts: ['mapped', 'accounts.export'],
  importAccounts: ['mapped', 'accounts.import'],
  getPlatforms: ['mapped', 'platforms'],
  getPlatformUrl: ['mapped', 'platforms (URL included in definition)'],
  getCompatUserAgent: ['internal', 'FingerprintService/browser-compat.js'],
  applyAccountProxy: ['mapped', 'browser.applyProxy'],
  testAccountProxy: ['mapped', 'browser.testProxy'],
  dolaBatchSetCredentials: ['mapped', 'browser.dolaBatchFill / batchLoginFill'],
  dolaLoginState: ['mapped', 'browser.dolaLoginState'],
  dolaExternalBatchStart: ['mapped', 'browser.externalLoginStart'],
  dolaExternalBatchSync: ['mapped', 'browser.externalLoginSync'],
  dolaExternalBatchFill: ['mapped', 'browser.dolaBatchFill'],
  externalLoginStatus: ['mapped', 'browser.externalLoginStatus'],
  externalLoginStart: ['mapped', 'browser.externalLoginStart'],
  externalLoginSync: ['mapped', 'browser.externalLoginSync'],
  externalLoginClose: ['mapped', 'browser.externalLoginClose'],
  licenseStatus: ['removed', '按计划删除授权/激活'],
  activateLicense: ['removed', '按计划删除授权/激活'],
  logoutLicense: ['removed', '按计划删除授权/激活'],
  checkAppUpdate: ['mapped', 'updates.check'],
  openExternalUrl: ['mapped', 'files.openUrl / updates.openRelease'],
  copyText: ['mapped', 'files.copyText'],
  getResources: ['mapped', 'media.list'],
  clearResources: ['mapped', 'media.clear'],
  getDownloadDir: ['mapped', 'settings.get'],
  getDownloadSettings: ['mapped', 'settings.get'],
  setDownloadSettings: ['mapped', 'settings.update'],
  openDownloadDir: ['mapped', 'files.openDownloadDir'],
  chooseDownloadDir: ['mapped', 'files.chooseDownloadDir'],
  listDownloadFiles: ['mapped', 'files.list'],
  openDownloadFile: ['mapped', 'files.open'],
  revealDownloadFile: ['mapped', 'files.reveal'],
  deleteDownloadFile: ['mapped', 'files.remove'],
  copyDownloadFilePath: ['mapped', 'files.copyPath'],
  startDownloadFileDrag: ['mapped', 'files.drag'],
  resolveDolaNowatermark: ['mapped', 'browser.resolveDolaResource'],
  downloadResource: ['mapped', 'media.download / media.downloadMany'],
  saveBlob: ['internal', 'browser.resolveBlob + MediaService'],
  onResourcesUpdated: ['mapped', 'media.onUpdated'],
  onFileDownloaded: ['mapped', 'files.onDownloaded / media.onTasks'],
  onDebuggerVideoDetected: ['mapped', 'media.onUpdated'],
  onDolaBatchLoginStatus: ['mapped', 'Dola/Higgsfield panel result polling'],
  reportCapturedResources: ['internal', 'remote:media IPC'],
  registerWebview: ['internal', 'BrowserManager ownership map'],
  getWebviewMap: ['mapped', 'diagnostics'],
  setupDownloadHandler: ['internal', 'BrowserManager Session setup'],
  getSession: ['internal', 'persist:account_<id> Session'],
  saveSession: ['internal', 'persist:account_<id> Session']
};

const missing = legacyKeys.filter((key) => !Object.prototype.hasOwnProperty.call(coverage, key));
if (missing.length) {
  throw new Error(`旧版 preload 出现未登记入口：${missing.join(', ')}`);
}

const expectedCurrentTokens = [
  'accountsList', 'browserOpen', 'mediaList', 'filesList', 'settingsGet', 'diagnosticsSnapshot',
  'proxyRuntimeStatus', 'fingerprintGet', 'migrationPreview', 'pluginsList', 'updatesCheck'
];
const missingTokens = expectedCurrentTokens.filter((token) => !currentSource.includes(token));
if (missingTokens.length) throw new Error(`当前 IPC 表面缺少基础域：${missingTokens.join(', ')}`);

const counts = legacyKeys.reduce((result, key) => {
  const status = coverage[key][0];
  result[status] = (result[status] ?? 0) + 1;
  return result;
}, {});

console.log(`legacy surface audit passed: ${legacyKeys.length} entries; mapped=${counts.mapped ?? 0}, internal=${counts.internal ?? 0}, removed=${counts.removed ?? 0}`);
for (const key of legacyKeys) console.log(`  ${key}: ${coverage[key][0]} -> ${coverage[key][1]}`);
