import { app, BrowserWindow } from 'electron';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const userDataPath = mkdtempSync(join(tmpdir(), 'aiam-gui-preview-'));
const previewPath = resolve(root, process.env.GUI_SMOKE_PREVIEW_PATH || 'diagnose-gui-preview.png');
const previewWidth = Number(process.env.GUI_SMOKE_WIDTH || 1440);
const previewHeight = Number(process.env.GUI_SMOKE_HEIGHT || 900);
const now = new Date().toISOString();

const platformNames = {
  doubao: '豆包',
  qianwen: '千问',
  dola: 'Dola',
  yunque: '云雀',
  higgsfield: 'Higgsfield',
  kimi: 'Kimi',
  oiioii: 'oiioii',
  nano: 'nano',
  lovart: 'Lovart',
  jimeng: '即梦',
  custom: '自定义网站'
};

const platforms = Object.entries(platformNames).map(([id, name]) => ({
  id,
  name,
  url: id === 'custom' ? 'https://example.com' : `https://${id}.example.com`,
  specialized: id !== 'custom'
}));

const emptyProxy = {
  enabled: false,
  mode: 'direct',
  type: 'http',
  host: '',
  username: '',
  password: '',
  directScheme: 'http',
  directAddressText: '',
  directAuthText: '',
  subscriptionUrl: '',
  subscriptionUserAgent: 'sing-box',
  selectedNodeName: '',
  selectedNodeTag: '',
  subscriptionConfigJson: '',
  subscriptionNodes: [],
  lastRuntimeError: ''
};

const emptyBrowser = { homeUrl: '', lastUrl: '', zoomFactor: 1, restoreOnStart: true };
const emptyFingerprint = {
  enabled: false,
  seed: '',
  vendor: 'Google Inc.',
  languages: ['zh-CN', 'zh', 'en'],
  hardwareConcurrency: 8,
  deviceMemory: 8,
  maxTouchPoints: 0,
  webGlVendor: 'Google Inc.',
  webGlRenderer: 'ANGLE (Default Renderer)',
  userAgent: '',
  platform: '',
  userAgentDataBrands: '',
  userAgentDataFullVersionList: '',
  userAgentDataMobile: false,
  userAgentDataPlatform: '',
  userAgentDataArchitecture: '',
  userAgentDataBitness: '',
  userAgentDataPlatformVersion: '',
  screenWidth: 1920,
  screenHeight: 1080,
  deviceScaleFactor: 1,
  timezone: '',
  webRtcPolicy: 'default',
  canvasNoise: false,
  audioNoise: false,
  lastError: ''
};

function makeAccount(index) {
  const platform = index % 4 === 0 ? 'doubao' : index % 4 === 1 ? 'dola' : index % 4 === 2 ? 'qianwen' : 'jimeng';
  const id = `gui${String(index).padStart(3, '0')}`;
  return {
    schemaVersion: 2,
    id,
    name: `${platformNames[platform]} 工作账号 ${index}`,
    platform,
    group: index <= 6 ? '主力账号' : index <= 12 ? '测试账号' : '素材账号',
    remark: index % 3 === 0 ? 'GUI 预览夹具' : '跨平台迁移检查',
    customUrl: '',
    proxy: { ...emptyProxy },
    browser: { ...emptyBrowser, homeUrl: `https://${platform}.example.com` },
    fingerprint: { ...emptyFingerprint },
    createdAt: now,
    order: index
  };
}

const accounts = Array.from({ length: 18 }, (_value, index) => makeAccount(index + 1));
const activeAccount = accounts.find((account) => account.platform === 'doubao') ?? accounts[0];
const svgPreview = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#725cff"/><stop offset="1" stop-color="#3ea7ff"/></linearGradient></defs><rect width="640" height="360" fill="#10182b"/><rect x="22" y="22" width="596" height="316" rx="28" fill="url(#g)" opacity=".85"/><circle cx="180" cy="180" r="72" fill="#fff" opacity=".24"/><path d="M330 130h160v28H330zm0 52h120v28H330z" fill="#fff" opacity=".88"/></svg>');
const resources = [
  {
    id: 'gui-resource-1',
    type: 'image',
    url: 'https://cdn.example.com/workbench-primary.png',
    backupUrl: 'https://cdn.example.com/workbench-backup.png',
    alternateUrls: ['https://cdn.example.com/workbench-alternate.png'],
    previewUrl: svgPreview,
    previewThumbUrl: svgPreview,
    title: '跨平台素材预览',
    width: 640,
    height: 360,
    confirmedNoWatermark: true,
    resolutionMethod: 'gui-fixture',
    qualityEvidence: 'platform-api',
    rejectedCandidates: ['https://cdn.example.com/expired-candidate.png'],
    source: 'GUI fixture',
    accountId: accounts[0].id,
    capturedAt: now
  },
  {
    id: 'gui-resource-2',
    type: 'video',
    url: '',
    title: '待解析视频资源',
    source: 'Dola fixture',
    accountId: accounts[1].id,
    capturedAt: now
  },
  {
    id: 'gui-resource-3',
    type: 'video',
    url: 'https://cdn.example.com/workbench-video.mp4?lr=video_gen_no_watermark',
    previewUrl: svgPreview,
    previewThumbUrl: svgPreview,
    title: 'V5.2 视频通道预览',
    source: 'doubao_download_info',
    accountId: accounts[0].id,
    capturedAt: now,
    confirmedNoWatermark: true,
    qualityEvidence: 'platform-api'
  }
];

const settings = {
  schemaVersion: 2,
  theme: 'light',
  downloadDir: 'D:\\AI-Workbench\\Downloads',
  videoDownloadDir: 'D:\\AI-Workbench\\Videos',
  useAccountDownloadSubfolders: true,
  downloadFolderPattern: 'account',
  legacyVideoLayout: true,
  legacyV44MediaFolders: false,
  videoFilenamePrefix: '',
  captureMode: 'all',
  parseImages: false,
  lightThemeMigrated: true,
  downloadConcurrency: 2,
  downloadRetryCount: 2,
  experimentalResponsePatchEnabled: true,
  disabledAdapters: [],
  openTabs: [activeAccount.id],
  activeTabId: activeAccount.id,
  secondaryTabId: null,
  dualView: false,
  resourcesCollapsed: false,
  bossKey: { key: 'H', ctrl: true, alt: true, shift: false, meta: false, enabled: false },
  externalBrowserPath: '',
  ffmpegPath: '',
  dolaClickProfile: { login: { xRatio: 0.93, yRatio: 0.035 }, google: { xRatio: 0.345, yRatio: 0.61 } },
  dolaAspectRatio: '16:9',
  migrationCompleted: true
};

const runtimeState = { accountId: activeAccount.id, status: 'idle', localPort: null, pid: null, error: '' };
const tasks = [];
const diagnostics = {
  generatedAt: now,
  appVersion: '1.0.0-fixture',
  electronVersion: '43.1.1',
  platform: 'win32',
  arch: 'x64',
  packaged: false,
  accountCount: accounts.length,
  openTabCount: 1,
  resourceCount: resources.length,
  pluginCount: 0,
  taskCounts: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 },
  accounts: accounts.map((account) => ({
    id: account.id,
    name: account.name,
    platform: account.platform,
    open: account.id === activeAccount.id,
    url: account.browser.homeUrl,
    sessionPartition: `persist:account_${account.id}`,
    adapterEnabled: true,
    adapterCapabilities: { domCapture: true, fetchCapture: true, xhrCapture: true, sseCapture: true, cdpNetworkCapture: true, requestModification: account.platform === 'doubao' || account.platform === 'dola', responseModification: account.platform === 'doubao' || account.platform === 'dola', imageParser: true, videoParser: true, dedicatedDownloader: account.platform === 'doubao' || account.platform === 'dola', loginAssist: account.platform === 'dola' || account.platform === 'higgsfield', taskDurations: account.platform === 'doubao' || account.platform === 'dola' ? [15, 30] : [] },
    fingerprint: { enabled: false, seedPresent: false, lastAppliedAt: undefined, lastError: undefined },
    proxy: { enabled: false, mode: 'direct', status: 'idle', localPort: undefined, pid: undefined, selectedNodeName: '', nodeCount: 0, error: undefined }
  }))
};
const profileLocation = { path: 'D:\\AI-Workbench\\BrowserData', activePath: 'D:\\AI-Workbench\\BrowserData', defaultPath: 'D:\\AI-Workbench\\BrowserData', custom: false, restartRequired: false };
const migrationPreview = {
  sourcePath: 'V4.4 fixture/AppConfig.json',
  accountCount: 6,
  fingerprintCount: 6,
  proxyProfileCount: 2,
  storageFiles: [],
  warnings: ['仅用于 GUI 渲染预览'],
  settings: { downloadDir: 'D:\\AI-Workbench\\Downloads', hasDownloadDir: true, videoDownloadDir: 'D:\\AI-Workbench\\Videos', hasVideoDownloadDir: true, legacyV44MediaFolders: false, hasLegacyV44MediaFolders: false, profileRoot: '', hasProfileRoot: false, bossKey: settings.bossKey, hasBossKey: true, dolaAspectRatio: '16:9', hasDolaAspectRatio: true, homeUrlCount: 6 },
  accounts: accounts.slice(0, 6).map((account, index) => ({ legacyId: index + 1, name: account.name, platform: account.platform, hasFingerprint: true, proxyMode: 'direct' }))
};

function withTimeout(promise, label, milliseconds = 20_000) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function removeUserDataLater() {
  try { rmSync(userDataPath, { recursive: true, force: true }); } catch { setTimeout(() => { try { rmSync(userDataPath, { recursive: true, force: true }); } catch {} }, 750); }
}

async function main() {
  console.log('gui smoke: waiting for app ready');
  app.commandLine.appendSwitch('disable-gpu');
  app.setPath('userData', userDataPath);
  await app.whenReady();
  console.log('gui smoke: app ready');

  const fixture = { accounts, platforms, settings, resources, tasks, runtimeState, diagnostics, profileLocation, migrationPreview };
  const injectedApi = `(() => {
    const state = ${JSON.stringify(fixture)};
    const ok = (data) => Promise.resolve({ ok: true, data });
    const no = () => () => {};
    const fileDownloadedListeners = [];
    const taskListeners = [];
    const videoGeneratedListeners = [];
    const emitFileDownloaded = (notice) => { fileDownloadedListeners.slice().forEach((listener) => listener(notice)); };
    const emitTasks = (next) => { taskListeners.slice().forEach((listener) => listener(next)); };
    const emitVideoGenerated = (notice) => { videoGeneratedListeners.slice().forEach((listener) => listener(notice)); };
    const accountApi = {
      list: () => ok(state.accounts), import: () => ok(undefined), export: () => ok({ path: 'gui-fixture.json' }),
      create: () => ok(state.accounts[0]), update: () => ok(state.accounts[0]), remove: () => ok(undefined), removeMany: () => ok(undefined),
      reorder: () => ok(state.accounts), bulkUpdate: () => ok(state.accounts), renameGroup: () => ok(state.accounts), removeGroup: () => ok(state.accounts)
    };
    const browserApi = {
      open: () => ok({}), openMany: (ids) => ok({ succeeded: ids, failed: [] }), close: () => ok(undefined), closeMany: () => ok(undefined),
      activate: () => ok(undefined), setLayout: (layout) => { window.__fixtureLayout = layout; return ok(undefined); }, navigate: () => ok(undefined), back: () => ok(undefined), forward: () => ok(undefined),
      refresh: () => ok(undefined), refreshMany: () => ok(undefined), setZoom: () => ok(1), reconfigure: () => ok(undefined), applyProxy: () => ok(undefined),
      clearSession: () => ok(undefined), onNavigation: no, onVideoGenerated: no, openBatchWorkspace: () => ok(undefined), closeBatchWorkspace: () => ok(undefined),
      externalLoginStart: () => ok(undefined), externalLoginSync: () => ok({ cookies: 0 }), externalLoginClose: () => ok(undefined), externalLoginStatus: () => ok({ running: false }), externalLoginState: () => ok({ running: false, loggedIn: false, cookieCount: 0, message: 'fixture' }),
      batchLoginCalibrateEmbedded: () => ok({ message: 'fixture', manual: false, readyToSync: false }), batchLoginCalibrate: () => ok({ message: 'fixture', manual: false, readyToSync: false }),
      batchLoginFillEmbedded: () => ok({ message: 'fixture', manual: false, readyToSync: false }), batchLoginFill: () => ok({ message: 'fixture', manual: false, readyToSync: false }),
      dolaTask: () => ok({}), setDoubaoDuration: () => ok({}), sendDoubao15sPrompt: () => ok({}), startDoubaoCreationScan: () => ok({}), startJimengOriginal: () => ok({})
    };
    const mediaApi = {
      list: () => ok(state.resources), tasks: () => ok(state.tasks), clear: () => ok(undefined), cancel: () => ok(undefined), retry: () => ok(undefined),
      download: () => ok({}), downloadMany: () => ok([]), selectCandidate: (resourceId, url) => { const resource = state.resources.find((item) => item.id === resourceId); if (!resource) return ok(null); const candidates = [resource.url, resource.backupUrl, ...(resource.alternateUrls || [])].filter(Boolean); const selectedIndex = candidates.indexOf(url); if (selectedIndex < 0) return ok(resource); const remaining = candidates.filter((candidate) => candidate !== url); return ok({ ...resource, url, backupUrl: remaining[0] || undefined, alternateUrls: remaining.slice(1) }); }, convertForPreview: () => ok({ url: '', cached: false }), toolStatus: () => ok({ available: true, path: 'fixture/ffmpeg', version: '6.0', packaged: false, message: 'GUI fixture FFmpeg' }), onUpdated: no, onTasks: (listener) => { taskListeners.push(listener); return () => { const index = taskListeners.indexOf(listener); if (index >= 0) taskListeners.splice(index, 1); }; }, onVideoGenerated: (listener) => { videoGeneratedListeners.push(listener); return () => { const index = videoGeneratedListeners.indexOf(listener); if (index >= 0) videoGeneratedListeners.splice(index, 1); }; }
    };
    const settingsApi = { get: () => ok(structuredClone(state.settings)), update: (patch) => { Object.assign(state.settings, patch); return ok(structuredClone(state.settings)); } };
    const proxyApi = { runtimeStatus: () => ok(state.runtimeState), onState: no, importSubscription: () => ok({ nodes: [], configJson: '', skippedNodeCount: 0 }), refreshSubscription: () => ok({ nodes: [], configJson: '', skippedNodeCount: 0 }), selectNode: () => ok(state.runtimeState), testNode: () => ok({ message: 'fixture', latencyMs: 1, ip: '' }), testAllNodes: () => ok({ message: 'fixture', nodes: [] }), stopRuntime: () => ok(undefined) };
    const fingerprintApi = { regenerate: () => ok(state.accounts[0].fingerprint), reset: () => ok(state.accounts[0].fingerprint) };
    let libraryListCalls = 0;
    const filesApi = { list: () => { libraryListCalls += 1; return ok({ items: [], total: 0, page: 1, pageSize: 30, pages: 1 }); }, chooseDir: () => ok(''), chooseFile: () => ok([]), openDownloadDir: () => ok(undefined), openVideoDownloadDir: () => ok(undefined), openUrl: () => ok(undefined), copyText: () => ok(undefined), preview: () => ok(undefined), drag: () => ok(undefined), onDownloaded: (listener) => { fileDownloadedListeners.push(listener); return () => { const index = fileDownloadedListeners.indexOf(listener); if (index >= 0) fileDownloadedListeners.splice(index, 1); }; } };
    const migrationApi = { preview: () => ok(state.migrationPreview), import: () => ok({ ...state.migrationPreview, imported: 6, skipped: 0, backupPath: 'fixture-backup.json', errors: [] }), importStorage: () => ok({ cookies: 0, localStorage: 0, sessionStorage: 0, indexedDb: 0, errors: [] }) };
    const pluginsApi = { list: () => ok([]), importPackage: () => ok({}), importDirectory: () => ok({}), setEnabled: () => ok([]), remove: () => ok(undefined), openFolder: () => ok(undefined) };
  const dataApi = { profileLocation: () => ok(state.profileLocation), chooseProfileLocation: () => ok(state.profileLocation), resetProfileLocation: () => ok(state.profileLocation), restart: () => ok(undefined) };
    const maintenanceApi = { scanLegacyCache: () => ok({ scannedAt: now, candidates: [], totalBytes: 0 }), cleanLegacyCache: () => ok({ cleanedAt: now, deleted: [], failed: [], freedBytes: 0, remaining: { scannedAt: now, candidates: [], totalBytes: 0 } }) };
    const updatesApi = { check: () => ok({ enabled: false, hasUpdate: false, reason: 'GUI fixture 未配置更新仓库' }), download: () => ok('fixture-update.zip'), openRelease: () => ok(undefined) };
    window.__fixtureEmitFileDownloaded = emitFileDownloaded;
    window.__fixtureEmitMediaTasks = emitTasks;
    window.__fixtureEmitVideoGenerated = emitVideoGenerated;
    window.__fixtureLibraryListCalls = () => libraryListCalls;
    window.workbench = { accounts: accountApi, platforms: () => ok(state.platforms), settings: settingsApi, media: mediaApi, browser: browserApi, proxy: proxyApi, fingerprint: fingerprintApi, files: filesApi, migration: migrationApi, plugins: pluginsApi, data: dataApi, maintenance: maintenanceApi, diagnostics: () => ok(state.diagnostics), updates: updatesApi, faceGrid: { chooseImage: () => ok(null), chooseOutputDir: () => ok(''), model: () => ok({}), save: () => ok({}) } };
  })();`;

  const window = new BrowserWindow({
    show: false,
    width: previewWidth,
    height: previewHeight,
    backgroundColor: '#f3f4f7',
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#ffffff', height: 36 } } : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  await withTimeout(window.loadURL('about:blank'), 'GUI bootstrap page');
  console.log('gui smoke: bootstrap loaded');
  window.webContents.debugger.attach('1.3');
  console.log('gui smoke: debugger attached');
  await window.webContents.debugger.sendCommand('Page.enable');
  console.log('gui smoke: page enabled');
  await window.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: injectedApi });
  console.log('gui smoke: fixture API registered');
  await withTimeout(window.loadFile(resolve(root, 'out/renderer/index.html')), 'GUI renderer load');
  console.log('gui smoke: renderer loaded');
  const result = await withTimeout(window.webContents.executeJavaScript(`(async () => {
    const waitFor = async (predicate, label) => {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(label);
    };
    const clickExact = (label) => {
      const node = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
      if (!node) throw new Error('button did not render: ' + label);
      node.click();
    };
    const closeModal = async () => {
      document.querySelector('.modal > header button')?.click();
      await waitFor(() => !document.querySelector('.modal-backdrop'), 'modal did not close');
    };
    const checkTopModal = async (buttonLabel, expectedText) => {
      clickExact(buttonLabel);
      await waitFor(() => Boolean(document.querySelector('.modal h2')), buttonLabel + ' modal did not open');
      const dialog = document.querySelector('.modal[role="dialog"]');
      const labelledBy = dialog?.getAttribute('aria-labelledby');
      if (!dialog || dialog.getAttribute('aria-modal') !== 'true' || !labelledBy || !dialog.querySelector('#' + CSS.escape(labelledBy))) throw new Error(buttonLabel + ' modal accessibility attributes missing');
      await waitFor(() => window.__fixtureLayout?.occluded === true, 'modal did not hide native views');
      const text = document.querySelector('.modal')?.textContent || '';
      if (!text.includes(expectedText)) throw new Error(buttonLabel + ' modal missing ' + expectedText);
      if (buttonLabel === '设置') {
        const legacyRows = [...document.querySelectorAll('.settings-list > label:not(.setting-row)')];
        const darkRows = legacyRows.filter((node) => {
          const color = getComputedStyle(node).backgroundColor.replace(/\s/g, '');
          return color === 'rgb(11,17,32)' || color === 'rgba(11,17,32,1)';
        });
        if (!legacyRows.length || darkRows.length) throw new Error('settings legacy rows are not on the light surface: ' + JSON.stringify({ rows: legacyRows.length, darkRows: darkRows.length }));
        // The 图片解析 switch lives here now instead of in the 下载区 panel. The claim is
        // unchanged - image parsing defaults off and the switch round-trips through
        // settings.update - but it is asserted where the control is, and the batch row
        // underneath is checked to prove the setting actually reaches the panel.
        const imageBatchButton = () => [...document.querySelectorAll('.media-batch button')].some((node) => node.textContent?.trim() === '下载全部图片');
        const imageSwitch = document.querySelector('[role="switch"][aria-label="图片解析"]');
        if (!imageSwitch) throw new Error('image parsing switch is missing from 设置');
        if (imageSwitch.getAttribute('aria-checked') !== 'false') throw new Error('image parsing must default off');
        if (imageBatchButton()) throw new Error('the image batch action rendered while image parsing is off');
        imageSwitch.click();
        await waitFor(() => imageSwitch.getAttribute('aria-checked') === 'true', 'image parsing did not enable');
        await waitFor(imageBatchButton, 'enabling image parsing did not add the image batch action');
        imageSwitch.click();
        await waitFor(() => imageSwitch.getAttribute('aria-checked') === 'false', 'image parsing did not disable');
        await waitFor(() => !imageBatchButton(), 'disabling image parsing did not remove the image batch action');
        const navLabels = [...document.querySelectorAll('.settings-nav button')].map((node) => node.textContent?.trim()).filter(Boolean);
        if (!navLabels.includes('下载') || !navLabels.includes('浏览器') || !navLabels.includes('插件')) throw new Error('settings section navigation did not render: ' + JSON.stringify(navLabels));
        const navRects = [...document.querySelectorAll('.settings-nav button')].map((node) => node.getBoundingClientRect());
        const maxNavGap = navRects.slice(1).reduce((max, rect, index) => Math.max(max, rect.top - navRects[index].bottom), 0);
        if (maxNavGap > 18) throw new Error('settings navigation rows are stretched: ' + JSON.stringify({ maxNavGap, navRects }));
        if ((document.querySelector('.modal-body')?.scrollTop ?? 0) > 4) throw new Error('settings modal did not open at the top');
        const pluginNav = [...document.querySelectorAll('.settings-nav button')].find((node) => node.textContent?.trim() === '插件');
        pluginNav?.click();
        await waitFor(() => pluginNav?.classList.contains('active') === true, 'settings section navigation did not activate');
      }
      await closeModal();
      return buttonLabel;
    };
    const openTools = async () => {
      const current = document.querySelector('.toolbar-menu');
      if (!current) document.querySelector('.toolbar-more > button')?.click();
      await waitFor(() => Boolean(document.querySelector('.toolbar-menu')), 'toolbar menu did not open');
    };
    const checkToolModal = async (label, expectedText) => {
      await openTools();
      clickExact(label);
      await waitFor(() => Boolean(document.querySelector('.modal h2')), label + ' modal did not open');
      await waitFor(() => window.__fixtureLayout?.occluded === true, 'modal did not hide native views');
      const text = document.querySelector('.modal')?.textContent || '';
      if (!text.includes(expectedText)) throw new Error(label + ' modal missing ' + expectedText);
      await closeModal();
      return label;
    };
    const checkDolaTaskModal = async () => {
      await openTools();
      clickExact('Dola 批量登录');
      await waitFor(() => Boolean(document.querySelector('.modal h2')), 'Dola task modal did not open');
      const modal = document.querySelector('.modal');
      const text = modal?.textContent || '';
      const buttons = [...(modal?.querySelectorAll('button') || [])].map((node) => node.textContent?.trim()).filter(Boolean);
      const selects = [...(modal?.querySelectorAll('select') || [])].map((node) => [...node.options].map((option) => option.textContent?.trim()).filter(Boolean));
      const taskText = ['Dola 视频任务', '任务账号', '快速提交', '选择参考图', '选择参考音频', '选择参考视频', '提交选中账号', '依次提交选中账号'].every((item) => text.includes(item));
      const durationOptions = selects.some((options) => options.includes('15 秒') && options.includes('30 秒'));
      const expectedAspectOptions = ['1:1 方形', '3:4 竖幅', '4:3 横幅', '9:16 竖屏', '16:9 横屏', '21:9 超宽'];
      const aspectOptions = selects.some((options) => expectedAspectOptions.every((option) => options.includes(option)));
      const taskAccountOptions = selects.some((options) => options.includes('全部 Dola 账号（批量提交）') && options.length >= 3);
      const submitButton = buttons.includes('提交选中账号') && buttons.includes('依次提交选中账号');
      const taskAccountSelect = modal?.querySelector('select[aria-label="Dola 任务账号"]');
      const firstSingleOption = [...(taskAccountSelect?.options || [])].find((option) => option.value !== '__all__');
      let singleTaskSelection = false;
      if (taskAccountSelect && firstSingleOption) {
        taskAccountSelect.value = firstSingleOption.value;
        taskAccountSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor(() => document.querySelector('.dola-task-account-count')?.textContent?.includes('已选 1 个'), 'single Dola task selection did not update');
        singleTaskSelection = true;
        if (taskAccountSelect.querySelector('option[value="__all__"]')) {
          taskAccountSelect.value = '__all__';
          taskAccountSelect.dispatchEvent(new Event('change', { bubbles: true }));
          await waitFor(() => document.querySelector('.dola-task-account-count')?.textContent?.includes('已选 '), 'all Dola task selection did not restore');
        }
      }
      const body = modal?.querySelector('.modal-body');
      const layout = {
        modalClientWidth: modal?.clientWidth ?? 0,
        modalScrollWidth: modal?.scrollWidth ?? 0,
        bodyClientWidth: body?.clientWidth ?? 0,
        bodyScrollWidth: body?.scrollWidth ?? 0
      };
      const noHorizontalOverflow = layout.modalScrollWidth <= layout.modalClientWidth + 1 && layout.bodyScrollWidth <= layout.bodyClientWidth + 1;
      if (!taskText || !durationOptions || !aspectOptions || !taskAccountOptions || !singleTaskSelection || !submitButton || !noHorizontalOverflow) {
        throw new Error('Dola task controls/layout incomplete: ' + JSON.stringify({ taskText, durationOptions, aspectOptions, taskAccountOptions, singleTaskSelection, submitButton, noHorizontalOverflow, layout, buttons, selects }));
      }
      await closeModal();
      return { taskText, durationOptions, aspectOptions, taskAccountOptions, singleTaskSelection, submitButton, noHorizontalOverflow, layout };
    };
    for (let attempt = 0; attempt < 80 && !document.querySelector('.app-shell'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    if (!document.querySelector('.app-shell')) throw new Error('app shell did not render');
    if (document.documentElement.dataset.platform === 'windows') {
      const topbarRegion = getComputedStyle(document.querySelector('.topbar')).webkitAppRegion;
      const actionsRegion = getComputedStyle(document.querySelector('.top-actions')).webkitAppRegion;
      const buttonRegion = getComputedStyle(document.querySelector('.top-actions button')).webkitAppRegion;
      if (topbarRegion !== 'drag' || actionsRegion !== 'drag' || buttonRegion !== 'no-drag') throw new Error('window drag regions are incomplete: ' + JSON.stringify({ topbarRegion, actionsRegion, buttonRegion }));
    }
    for (let attempt = 0; attempt < 80 && !document.querySelector('.account-card.selected'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    if (!document.querySelector('.account-card.selected')) throw new Error('fixture account did not become active');
    const activeCard = document.querySelector('.account-card.selected');
    activeCard?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await waitFor(() => Boolean(document.querySelector('.fingerprint-box')), 'fingerprint editor did not open');
    const fingerprintEditor = {
      sections: document.querySelectorAll('.fingerprint-section').length,
      summary: Boolean(document.querySelector('.fingerprint-summary')),
      health: Boolean(document.querySelector('.fingerprint-health')),
      warnings: Boolean(document.querySelector('.fingerprint-warnings, .fingerprint-ok'))
    };
    if (fingerprintEditor.sections !== 3 || !fingerprintEditor.summary || !fingerprintEditor.health || !fingerprintEditor.warnings) throw new Error('fingerprint editor hierarchy incomplete: ' + JSON.stringify(fingerprintEditor));
    await closeModal();
    window.__fixtureEmitVideoGenerated({ accountId: ${JSON.stringify(activeAccount.id)}, key: 'gui-video-notice', title: 'GUI 生成视频' });
    await waitFor(() => Boolean(document.querySelector('.account-video-notice')) && Boolean(document.querySelector('.tab-video-dot')), 'video notice badge did not render');
    if (!document.querySelector('.account-video-notice')?.textContent?.includes('新视频')) throw new Error('account video notice badge text missing');
    const tabList = document.querySelector('[role="tablist"]');
    if (!tabList || document.querySelectorAll('[role="tab"]').length < 1) throw new Error('account tabs did not render');
    const accountButtons = document.querySelectorAll('.account-main');
    if (accountButtons.length > 1) {
      (accountButtons[1]).click();
      await waitFor(() => document.querySelectorAll('[role="tab"]').length >= 2, 'opening a second account did not create a tab');
      document.querySelector('[role="tab"]')?.click();
      await waitFor(() => document.querySelector('.tab.active')?.textContent?.includes('豆包'), 'switching back to the first tab failed');
    }
    const firstTab = document.querySelector('[role="tab"]');
    firstTab?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    await waitFor(() => Boolean(document.querySelector('.tab-context-menu')), 'tab context menu did not open');
    const tabContextItems = [...document.querySelectorAll('.tab-context-menu [role="menuitem"]')].map((node) => node.textContent?.trim()).filter(Boolean);
    if (!tabContextItems.includes('关闭其他标签') || !tabContextItems.includes('关闭此标签')) throw new Error('tab context actions incomplete: ' + JSON.stringify(tabContextItems));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => !document.querySelector('.tab-context-menu'), 'Escape did not close tab context menu');
    // The three 1/2/3渠道下载 buttons were merged into the single 下载 pill: they all called
    // download(resource) with no channel argument, so the number only ever chose a colour.
    // Asserting their absence is the point of the merge - a regression that reintroduces a
    // fake choice should fail here, not pass silently.
    if (document.querySelector('.media-channel')) throw new Error('the merged-away channel download buttons came back');
    if (!document.querySelector('.media-download-main') || !document.querySelector('.media-preview-action')) throw new Error('V5.2 download actions did not render');
    const candidateButton = [...document.querySelectorAll('.media-card button')].find((node) => node.textContent?.trim() === '候选地址 3');
    if (!candidateButton) throw new Error('media candidate selector did not render');
    candidateButton.click();
    await waitFor(() => Boolean(document.querySelector('.candidate-list')), 'media candidate modal did not open');
    const candidateModalText = document.querySelector('.candidate-list')?.textContent || '';
    if (!candidateModalText.includes('当前首选') || !candidateModalText.includes('备用地址') || !candidateModalText.includes('候选地址 1')) throw new Error('media candidate details incomplete: ' + candidateModalText);
    const rejectedText = document.querySelector('.rejected-candidates')?.textContent || '';
    if (!rejectedText.includes('最近失败的候选') || !rejectedText.includes('expired-candidate.png')) throw new Error('rejected candidate status did not render: ' + rejectedText);
    await closeModal();
    window.__fixtureEmitFileDownloaded({ accountId: 'gui001', filename: '报告.pdf', path: 'fixture/report.pdf', url: 'https://example.test/report.pdf' });
    await waitFor(() => document.querySelector('.statusbar')?.textContent?.includes('报告.pdf'), 'native download notice did not reach status bar');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    await waitFor(() => document.activeElement?.getAttribute('aria-label') === '搜索账号、分组或备注', 'Ctrl+K did not focus account search');
    const nativeDownloadNotice = document.querySelector('.statusbar')?.textContent || '';
    const more = document.querySelector('.toolbar-more > button');
    if (!more) throw new Error('toolbar more button did not render');
    more.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const authorShop = [...document.querySelectorAll('.toolbar-menu [role="menuitem"]')].find((node) => node.textContent?.trim() === '作者店铺');
    if (!authorShop) throw new Error('author shop menu item did not render');
    authorShop.click();
    await waitFor(() => document.querySelector('.statusbar')?.textContent?.includes('作者店铺'), 'author shop action did not complete');
    if (document.querySelector('.theme-toggle')) throw new Error('theme toggle should not reintroduce a dark palette');
    const lightTheme = document.documentElement.dataset.theme;
    const modalChecks = [];
    modalChecks.push(await checkTopModal('设置', '旧版临时缓存'));
    const checkLibraryAutoRefresh = async () => {
      clickExact('素材库');
      await waitFor(() => Boolean(document.querySelector('.modal h2')), '素材库 modal did not open');
      await waitFor(() => window.__fixtureLibraryListCalls() > 0, '素材库 initial list did not load');
      const beforeNative = window.__fixtureLibraryListCalls();
      window.__fixtureEmitFileDownloaded({ accountId: 'gui001', filename: 'library-refresh.pdf', path: 'fixture/library-refresh.pdf', url: 'https://example.test/library-refresh.pdf' });
      await waitFor(() => window.__fixtureLibraryListCalls() > beforeNative, '素材库 did not refresh after native download');
      const beforeTask = window.__fixtureLibraryListCalls();
      window.__fixtureEmitMediaTasks([{ id: 'gui-completed-task', status: 'completed' }]);
      await waitFor(() => window.__fixtureLibraryListCalls() > beforeTask, '素材库 did not refresh after media task completion');
      await new Promise((resolve) => setTimeout(resolve, 850));
      const beforeClose = window.__fixtureLibraryListCalls();
      await closeModal();
      window.__fixtureEmitFileDownloaded({ accountId: 'gui001', filename: 'after-close.pdf', path: 'fixture/after-close.pdf', url: 'https://example.test/after-close.pdf' });
      await new Promise((resolve) => setTimeout(resolve, 850));
      if (window.__fixtureLibraryListCalls() !== beforeClose) throw new Error('素材库 listener remained active after modal close');
      return { native: true, mediaTask: true, closed: true };
    };
    const libraryRefresh = await checkLibraryAutoRefresh();
    modalChecks.push('素材库');
    modalChecks.push(await checkToolModal('登录辅助', '打开登录浏览器'));
    const dolaTaskChecks = await checkDolaTaskModal();
    modalChecks.push('Dola 批量登录');
    modalChecks.push(await checkToolModal('使用指南与快捷键', '从账号到成片'));
    modalChecks.push(await checkToolModal('Higgsfield 批量登录', 'Higgsfield 批量登录'));
    modalChecks.push(await checkToolModal('人脸网格', '人脸网格工具'));
    modalChecks.push(await checkToolModal('迁移 V4.4', 'V4.4 数据迁移'));
    modalChecks.push(await checkToolModal('诊断', '系统诊断'));
    await openTools();
    const visible = (selector) => { const node = document.querySelector(selector); if (!node) return false; const rect = node.getBoundingClientRect(); return getComputedStyle(node).display !== 'none' && rect.width > 0 && rect.height > 0; };
    const menuNode = document.querySelector('.toolbar-menu');
    const menuRect = menuNode ? menuNode.getBoundingClientRect() : null;
    const toolbarMenuItems = [...document.querySelectorAll('.toolbar-menu [role="menuitem"]')].map((node) => node.textContent?.trim()).filter(Boolean);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => !document.querySelector('.toolbar-menu'), 'Escape did not close toolbar menu');
    await waitFor(() => window.__fixtureLayout?.occluded === false, 'native views did not restore');
    const accountCardsVisible = [...document.querySelectorAll('.account-card')].filter((node) => { const rect = node.getBoundingClientRect(); return getComputedStyle(node).display !== 'none' && rect.width > 0 && rect.height > 0; }).length;
    const workspace = document.querySelector('.workspace');
    const layoutSnapshot = workspace ? { display: getComputedStyle(workspace).display, columns: getComputedStyle(workspace).gridTemplateColumns, rows: getComputedStyle(workspace).gridTemplateRows, clientWidth: workspace.clientWidth, clientHeight: workspace.clientHeight, scrollWidth: workspace.scrollWidth, scrollHeight: workspace.scrollHeight } : null;
    const panelRects = Object.fromEntries(['.accounts-panel', '.browser-panel', '.media-panel'].map((selector) => { const rect = document.querySelector(selector)?.getBoundingClientRect(); return [selector, rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null]; }));
    return {
      title: document.title,
      themeRestored: document.documentElement.dataset.theme === 'light',
      lightTheme,
      accountCards: document.querySelectorAll('.account-card').length,
      accountCardsVisible,
      mediaCards: document.querySelectorAll('.media-card').length,
      columns: { accounts: visible('.accounts-panel'), browser: visible('.browser-panel'), media: visible('.media-panel') },
      toolbarMenuItems,
      modalChecks,
      libraryRefresh,
      fingerprintEditor,
      dolaTaskChecks,
      nativeDownloadNotice,
      menuRect: menuRect ? { width: menuRect.width, height: menuRect.height, left: menuRect.left, top: menuRect.top } : null,
      layoutSnapshot,
      panelRects,
      hasAddressBar: visible('.addressbar'),
      hasStatusBar: visible('.statusbar'),
      menuOpen: Boolean(document.querySelector('.toolbar-menu')),
      modalOpen: Boolean(document.querySelector('.modal-backdrop')),
      modalTitle: document.querySelector('.modal h2')?.textContent?.trim() || null
    };
  })()`), 'GUI interaction smoke');
  if (result.title !== 'AI创作工作台') throw new Error(`unexpected GUI title: ${result.title}`);
  if (result.accountCards < 12) throw new Error(`expected account cards to render, received ${result.accountCards}`);
  if (result.accountCardsVisible < 12) throw new Error(`expected account cards to be visible, received ${result.accountCardsVisible}`);
  if (result.mediaCards < 2) throw new Error(`expected media cards to render, received ${result.mediaCards}`);
  if (!result.columns.accounts || !result.columns.browser || !result.columns.media) throw new Error(`workspace columns are not visible: ${JSON.stringify(result.columns)}`);
   if (!result.toolbarMenuItems.includes('豆包 15s 设置') || !result.toolbarMenuItems.includes('豆包 30s 设置') || !result.toolbarMenuItems.includes('使用指南与快捷键')) throw new Error(`duration/help tools missing: ${JSON.stringify(result.toolbarMenuItems)}`);
  if (!result.nativeDownloadNotice.includes('报告.pdf')) throw new Error(`native download notice missing: ${result.nativeDownloadNotice}`);
  if (!result.libraryRefresh?.native || !result.libraryRefresh?.mediaTask || !result.libraryRefresh?.closed) throw new Error(`library refresh lifecycle incomplete: ${JSON.stringify(result.libraryRefresh)}`);
  if (result.fingerprintEditor?.sections !== 3 || !result.fingerprintEditor?.summary || !result.fingerprintEditor?.health) throw new Error(`fingerprint editor checks incomplete: ${JSON.stringify(result.fingerprintEditor)}`);
  if (!result.toolbarMenuItems.includes('作者店铺')) throw new Error(`author shop tool missing: ${JSON.stringify(result.toolbarMenuItems)}`);
   if (result.modalChecks.length !== 9) throw new Error(`expected all primary GUI modals to render, received ${JSON.stringify(result.modalChecks)}`);
   if (!result.menuRect || result.menuRect.width < 250 || result.menuRect.height < 100) throw new Error(`toolbar menu has no visible layout: ${JSON.stringify(result.menuRect)}`);
   if (result.menuOpen) throw new Error('Escape did not close toolbar menu');
   if (result.modalOpen) throw new Error(`a modal remained open after GUI smoke: ${result.modalTitle}`);
  if (!result.themeRestored || result.lightTheme !== 'light') throw new Error(`white theme did not remain enabled: ${JSON.stringify(result)}`);

  await new Promise((resolve) => setTimeout(resolve, 500));
  const image = await window.webContents.capturePage();
  writeFileSync(previewPath, image.toPNG());
  console.log(`gui preview ok: ${JSON.stringify(result)}`);
  console.log(`gui preview image: ${previewPath}`);
  try { window.webContents.debugger.detach(); } catch {}
  window.destroy();
  removeUserDataLater();
  app.quit();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  removeUserDataLater();
  app.exit(1);
});
