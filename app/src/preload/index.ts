import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AppSettings, BrowserNavigationState, ExternalBrowserLayout, WorkbenchApi } from '../shared/contracts';

// Sandboxed Electron preloads cannot require Rollup's generated relative chunks.
// Keep these runtime channel names local so this entry is emitted as one file.
const channels = {
  accountsList: 'accounts:list', accountsCreate: 'accounts:create', accountsUpdate: 'accounts:update',
  accountsRemove: 'accounts:remove', accountsRemoveMany: 'accounts:remove-many', accountsReorder: 'accounts:reorder', accountsImport: 'accounts:import', accountsExport: 'accounts:export',
  accountsGroups: 'accounts:groups', accountsRenameGroup: 'accounts:rename-group', accountsRemoveGroup: 'accounts:remove-group', accountsBulkUpdate: 'accounts:bulk-update',
  browserOpen: 'browser:open', browserClose: 'browser:close', browserRefresh: 'browser:refresh', browserOpenBatchWorkspace: 'browser:open-batch-workspace', browserCloseBatchWorkspace: 'browser:close-batch-workspace', browserBack: 'browser:back', browserForward: 'browser:forward', browserSetZoom: 'browser:set-zoom', browserReconfigure: 'browser:reconfigure', browserResolveDolaResource: 'browser:resolve-dola-resource', browserNavigate: 'browser:navigate', browserNavigationUpdated: 'browser:navigation-updated', browserActivate: 'browser:activate',
  browserLayout: 'browser:layout', browserApplyProxy: 'browser:apply-proxy',
  browserOpenMany: 'browser:open-many', browserCloseMany: 'browser:close-many', browserRefreshMany: 'browser:refresh-many', browserClearSession: 'browser:clear-session', browserTestProxy: 'browser:test-proxy', browserStartJimengOriginal: 'browser:start-jimeng-original', browserStartDoubaoCreationScan: 'browser:start-doubao-creation-scan', browserSendDoubao15sPrompt: 'browser:send-doubao-15s-prompt', browserSetDoubaoDuration: 'browser:set-doubao-duration',
  externalLoginStart: 'browser:external-login-start', externalLoginStatus: 'browser:external-login-status', externalLoginState: 'browser:external-login-state', externalBrowserOpen: 'browser:external-browser-open',
  externalLoginSync: 'browser:external-login-sync', externalLoginClose: 'browser:external-login-close',
  batchLoginFill: 'browser:batch-login-fill', batchLoginCalibrate: 'browser:batch-login-calibrate', batchLoginFillEmbedded: 'browser:batch-login-fill-embedded', batchLoginCalibrateEmbedded: 'browser:batch-login-calibrate-embedded', dolaLoginState: 'browser:dola-login-state', externalDolaLoginState: 'browser:external-dola-login-state',
  dolaBatchFill: 'browser:dola-batch-fill', dolaCalibrate: 'browser:dola-calibrate', dolaBatchFillEmbedded: 'browser:dola-batch-fill-embedded', dolaCalibrateEmbedded: 'browser:dola-calibrate-embedded', dolaCaptureClickPoint: 'browser:dola-capture-click-point', dolaTestClickPoint: 'browser:dola-test-click-point', dolaUploadReferences: 'browser:dola-upload-references', dolaSubmitVideo: 'browser:dola-submit-video',
  proxyImportSubscription: 'proxy:import-subscription', proxyRefreshSubscription: 'proxy:refresh-subscription', proxyListNodes: 'proxy:list-nodes', proxySelectNode: 'proxy:select-node', proxyTestNode: 'proxy:test-node', proxyTestAllNodes: 'proxy:test-all-nodes', proxyRuntimeStatus: 'proxy:runtime-status', proxyStopRuntime: 'proxy:stop-runtime', proxyRuntimeUpdated: 'proxy:runtime-updated',
  fingerprintGet: 'fingerprint:get', fingerprintRegenerate: 'fingerprint:regenerate', fingerprintUpdate: 'fingerprint:update', fingerprintReset: 'fingerprint:reset',
  migrationPreview: 'migration:preview', migrationImport: 'migration:import', migrationImportStorage: 'migration:import-storage',
  mediaList: 'media:list', mediaClear: 'media:clear', mediaDownload: 'media:download', mediaDownloadMany: 'media:download-many', mediaSelectCandidate: 'media:select-candidate', mediaTasks: 'media:tasks', mediaCancel: 'media:cancel', mediaRetry: 'media:retry', mediaClearFailed: 'media:clear-failed', mediaConvertForPreview: 'media:convert-for-preview', mediaToolStatus: 'media:tool-status', mediaUpdated: 'media:updated', mediaTasksUpdated: 'media:tasks-updated', mediaVideoGenerated: 'media:video-generated',
  faceGridChooseImage: 'face-grid:choose-image', faceGridChooseOutputDir: 'face-grid:choose-output-dir', faceGridModel: 'face-grid:model', faceGridSave: 'face-grid:save',
  filesList: 'files:list', filesOpen: 'files:open', filesOpenUrl: 'files:open-url', filesReveal: 'files:reveal', filesRemove: 'files:remove', filesChooseImages: 'files:choose-images', filesChooseDolaReferences: 'files:choose-dola-references', filesChooseDir: 'files:choose-dir', filesOpenDir: 'files:open-dir', filesChooseVideoDir: 'files:choose-video-dir', filesOpenVideoDir: 'files:open-video-dir', filesCopyPath: 'files:copy-path', filesCopyText: 'files:copy-text', filesDrag: 'files:drag', filesDownloaded: 'files:downloaded',
  settingsGet: 'settings:get', settingsUpdate: 'settings:update', profileLocationGet: 'data:profile-location', profileLocationChoose: 'data:choose-profile-location', profileLocationReset: 'data:reset-profile-location', profileLocationRestart: 'data:restart', maintenanceCacheScan: 'maintenance:cache-scan', maintenanceCacheClean: 'maintenance:cache-clean', diagnosticsSnapshot: 'diagnostics:snapshot', platforms: 'platforms:list',
  pluginsList: 'plugins:list', pluginsImportPackage: 'plugins:import-package', pluginsImportDirectory: 'plugins:import-directory', pluginsSetEnabled: 'plugins:set-enabled', pluginsRemove: 'plugins:remove', pluginsOpenFolder: 'plugins:open-folder',
  updatesCheck: 'updates:check', updatesDownload: 'updates:download', updatesOpenRelease: 'updates:open-release'
} as const;

const invoke = <T>(channel: string, value?: unknown): Promise<T> => ipcRenderer.invoke(channel, value);
const api: WorkbenchApi = {
  accounts: {
    list: () => invoke(channels.accountsList), create: (input) => invoke(channels.accountsCreate, input),
    update: (id, patch) => invoke(channels.accountsUpdate, { id, patch }), remove: (id) => invoke(channels.accountsRemove, id), removeMany: (ids) => invoke(channels.accountsRemoveMany, ids),
    reorder: (ids) => invoke(channels.accountsReorder, ids), import: () => invoke(channels.accountsImport), export: () => invoke(channels.accountsExport),
    groups: () => invoke(channels.accountsGroups), renameGroup: (from, to) => invoke(channels.accountsRenameGroup, { from, to }), removeGroup: (name) => invoke(channels.accountsRemoveGroup, name),
    bulkUpdate: (ids, patch) => invoke(channels.accountsBulkUpdate, { ids, patch })
  },
  browser: {
    open: (accountId) => invoke(channels.browserOpen, accountId), openBatchWorkspace: (accountIds) => invoke(channels.browserOpenBatchWorkspace, accountIds), closeBatchWorkspace: () => invoke(channels.browserCloseBatchWorkspace), close: (accountId) => invoke(channels.browserClose, accountId),
    refresh: (accountId) => invoke(channels.browserRefresh, accountId), back: (accountId) => invoke(channels.browserBack, accountId), forward: (accountId) => invoke(channels.browserForward, accountId), setZoom: (accountId, factor) => invoke(channels.browserSetZoom, { accountId, factor }), reconfigure: (accountId) => invoke(channels.browserReconfigure, accountId), resolveDolaResource: (accountId, reference, downloadAfterResolve) => invoke(channels.browserResolveDolaResource, { accountId, reference, downloadAfterResolve }), navigate: (accountId, url) => invoke(channels.browserNavigate, { accountId, url }),
    onNavigation: (listener) => { const wrapped = (_event: Electron.IpcRendererEvent, value: BrowserNavigationState): void => listener(value); ipcRenderer.on(channels.browserNavigationUpdated, wrapped); return () => ipcRenderer.removeListener(channels.browserNavigationUpdated, wrapped); },
    activate: (primaryId, secondaryId) => invoke(channels.browserActivate, { primaryId, secondaryId }),
    setLayout: (layout) => invoke(channels.browserLayout, layout), applyProxy: (accountId) => invoke(channels.browserApplyProxy, accountId),
    openMany: (ids) => invoke(channels.browserOpenMany, ids), closeMany: (ids) => invoke(channels.browserCloseMany, ids), refreshMany: (ids) => invoke(channels.browserRefreshMany, ids),
    clearSession: (id, kind) => invoke(channels.browserClearSession, { id, kind }), testProxy: (id) => invoke(channels.browserTestProxy, id), startJimengOriginal: (accountId) => invoke(channels.browserStartJimengOriginal, accountId), startDoubaoCreationScan: (accountId) => invoke(channels.browserStartDoubaoCreationScan, accountId), sendDoubao15sPrompt: (accountId) => invoke(channels.browserSendDoubao15sPrompt, accountId), setDoubaoDuration: (accountId, duration) => invoke(channels.browserSetDoubaoDuration, { accountId, duration }),
    externalLoginStart: (accountId, layout?: ExternalBrowserLayout) => invoke(channels.externalLoginStart, { accountId, layout }), externalLoginStatus: (accountId) => invoke(channels.externalLoginStatus, accountId), externalLoginState: (accountId) => invoke(channels.externalLoginState, accountId), dolaLoginState: (accountId) => invoke(channels.dolaLoginState, accountId), externalDolaLoginState: (accountId) => invoke(channels.externalDolaLoginState, accountId), externalBrowserOpen: (accountId) => invoke(channels.externalBrowserOpen, accountId),
    externalLoginSync: (accountId) => invoke(channels.externalLoginSync, accountId), externalLoginClose: (accountId) => invoke(channels.externalLoginClose, accountId),
    batchLoginFill: (accountId, email, password, platform) => invoke(channels.batchLoginFill, { accountId, email, password, platform }), batchLoginCalibrate: (accountId, platform) => invoke(channels.batchLoginCalibrate, { accountId, platform }), batchLoginFillEmbedded: (accountId, email, password, platform) => invoke(channels.batchLoginFillEmbedded, { accountId, email, password, platform }), batchLoginCalibrateEmbedded: (accountId, platform) => invoke(channels.batchLoginCalibrateEmbedded, { accountId, platform }),
    dolaBatchFill: (accountId, email, password) => invoke(channels.dolaBatchFill, { accountId, email, password }), dolaCalibrate: (accountId) => invoke(channels.dolaCalibrate, accountId), dolaBatchFillEmbedded: (accountId, email, password) => invoke(channels.dolaBatchFillEmbedded, { accountId, email, password }), dolaCalibrateEmbedded: (accountId) => invoke(channels.dolaCalibrateEmbedded, accountId), dolaCaptureClickPoint: (accountId, target) => invoke(channels.dolaCaptureClickPoint, { accountId, target }), dolaTestClickPoint: (accountId, target) => invoke(channels.dolaTestClickPoint, { accountId, target }), dolaUploadReferences: (accountId, kind, paths, aspectRatio, duration) => invoke(channels.dolaUploadReferences, { accountId, kind, paths, aspectRatio, duration }), dolaSubmitVideo: (accountId, prompt, aspectRatio, duration, referencePaths) => invoke(channels.dolaSubmitVideo, { accountId, prompt, aspectRatio, duration, referencePaths })
  },
  proxy: {
    importSubscription: (accountId, url) => invoke(channels.proxyImportSubscription, { accountId, url }), refreshSubscription: (accountId) => invoke(channels.proxyRefreshSubscription, accountId),
    listNodes: (accountId) => invoke(channels.proxyListNodes, accountId), selectNode: (accountId, tag) => invoke(channels.proxySelectNode, { accountId, tag }), testNode: (accountId, tag) => invoke(channels.proxyTestNode, { accountId, tag }), testAllNodes: (accountId) => invoke(channels.proxyTestAllNodes, accountId),
    runtimeStatus: (accountId) => invoke(channels.proxyRuntimeStatus, accountId), stopRuntime: (accountId) => invoke(channels.proxyStopRuntime, accountId), onState: (listener) => { const wrapped = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]): void => listener(value); ipcRenderer.on(channels.proxyRuntimeUpdated, wrapped); return () => ipcRenderer.removeListener(channels.proxyRuntimeUpdated, wrapped); }
  },
  fingerprint: {
    get: (accountId) => invoke(channels.fingerprintGet, accountId), regenerate: (accountId) => invoke(channels.fingerprintRegenerate, accountId), update: (accountId, patch) => invoke(channels.fingerprintUpdate, { accountId, patch }), reset: (accountId) => invoke(channels.fingerprintReset, accountId)
  },
  migration: {
    preview: () => invoke(channels.migrationPreview), import: () => invoke(channels.migrationImport), importStorage: (accountId) => invoke(channels.migrationImportStorage, accountId)
  },
  media: {
    list: () => invoke(channels.mediaList), clear: () => invoke(channels.mediaClear), download: (id) => invoke(channels.mediaDownload, id), downloadMany: (ids) => invoke(channels.mediaDownloadMany, ids), selectCandidate: (resourceId, url) => invoke(channels.mediaSelectCandidate, { resourceId, url }),
    tasks: () => invoke(channels.mediaTasks), cancel: (id) => invoke(channels.mediaCancel, id), retry: (id) => invoke(channels.mediaRetry, id), clearFailed: () => invoke(channels.mediaClearFailed), convertForPreview: (id) => invoke(channels.mediaConvertForPreview, id), toolStatus: () => invoke(channels.mediaToolStatus),
    onUpdated: (listener) => { const wrapped = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]): void => listener(value); ipcRenderer.on(channels.mediaUpdated, wrapped); return () => ipcRenderer.removeListener(channels.mediaUpdated, wrapped); },
    onTasks: (listener) => { const wrapped = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]): void => listener(value); ipcRenderer.on(channels.mediaTasksUpdated, wrapped); return () => ipcRenderer.removeListener(channels.mediaTasksUpdated, wrapped); },
    onVideoGenerated: (listener) => { const wrapped = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]): void => listener(value); ipcRenderer.on(channels.mediaVideoGenerated, wrapped); return () => ipcRenderer.removeListener(channels.mediaVideoGenerated, wrapped); }
  },
  faceGrid: {
    chooseImage: () => invoke(channels.faceGridChooseImage), chooseOutputDir: () => invoke(channels.faceGridChooseOutputDir), model: () => invoke(channels.faceGridModel), save: (input) => invoke(channels.faceGridSave, input)
  },
  files: {
    list: (query = {}) => invoke(channels.filesList, query), open: (path) => invoke(channels.filesOpen, path), openUrl: (url) => invoke(channels.filesOpenUrl, url), reveal: (path) => invoke(channels.filesReveal, path),
    remove: (path) => invoke(channels.filesRemove, path), chooseImages: () => invoke(channels.filesChooseImages), chooseDolaReferences: (kind) => invoke(channels.filesChooseDolaReferences, kind), getPathForFile: (file) => webUtils.getPathForFile(file), chooseDownloadDir: () => invoke(channels.filesChooseDir), openDownloadDir: () => invoke(channels.filesOpenDir), chooseVideoDownloadDir: () => invoke(channels.filesChooseVideoDir), openVideoDownloadDir: () => invoke(channels.filesOpenVideoDir), copyPath: (path) => invoke(channels.filesCopyPath, path), copyText: (value) => invoke(channels.filesCopyText, value), drag: (path) => invoke(channels.filesDrag, path), onDownloaded: (listener) => { const wrapped = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]): void => listener(value); ipcRenderer.on(channels.filesDownloaded, wrapped); return () => ipcRenderer.removeListener(channels.filesDownloaded, wrapped); }
  },
  settings: { get: () => invoke(channels.settingsGet), update: (patch: Partial<AppSettings>) => invoke(channels.settingsUpdate, patch) },
  data: { profileLocation: () => invoke(channels.profileLocationGet), chooseProfileLocation: () => invoke(channels.profileLocationChoose), resetProfileLocation: () => invoke(channels.profileLocationReset), restart: () => invoke(channels.profileLocationRestart) },
  maintenance: { scanLegacyCache: () => invoke(channels.maintenanceCacheScan), cleanLegacyCache: () => invoke(channels.maintenanceCacheClean) },
  diagnostics: () => invoke(channels.diagnosticsSnapshot),
  updates: { check: () => invoke(channels.updatesCheck), download: () => invoke(channels.updatesDownload), openRelease: () => invoke(channels.updatesOpenRelease) },
  platforms: () => invoke(channels.platforms),
  plugins: {
    list: () => invoke(channels.pluginsList), importPackage: () => invoke(channels.pluginsImportPackage), importDirectory: () => invoke(channels.pluginsImportDirectory),
    setEnabled: (id, enabled) => invoke(channels.pluginsSetEnabled, { id, enabled }), remove: (id) => invoke(channels.pluginsRemove, id), openFolder: () => invoke(channels.pluginsOpenFolder)
  }
};
contextBridge.exposeInMainWorld('workbench', api);
