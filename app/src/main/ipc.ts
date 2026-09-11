import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, Notification, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { z, type ZodType } from 'zod';
import { channels } from '../shared/channels';
import { accountInputSchema, dolaAspectRatioSchema, dolaResourceReferenceSchema, fingerprintSchema, libraryQuerySchema, settingsSchema, videoGeneratedNoticeSchema, type ApiResult, type ExternalBrowserLayout, type ViewLayout } from '../shared/contracts';
import { platforms } from '../shared/platforms';
import type { AccountService } from './accounts';
import type { BrowserManager } from './browser-manager';
import { captureModeAccepts } from './media';
import type { MediaService } from './media';
import type { SettingsService } from './settings';
import type { UpdateService } from './updates';
import type { ExternalLoginService } from './external-login';
import { isRemoteAdapterEnabled, isTrustedMainFrame, isTrustedOwnedFrame } from './ipc-security';
import type { ProxyService } from './proxy';
import type { FingerprintService } from './fingerprint';
import type { LegacyMigrationService } from './migration';
import type { PluginService } from './plugins';
import type { ProfileLocationService } from './data';
import type { LegacyCacheCleaner } from './cache-cleaner';
import { buildDiagnosticsSnapshot } from './diagnostics';
import { normalizeExternalHttpUrl } from './path-utils';

type Services = { accounts: AccountService; browser: BrowserManager; media: MediaService; settings: SettingsService; updates: UpdateService; externalLogin: ExternalLoginService; proxy: ProxyService; fingerprints: FingerprintService; migration: LegacyMigrationService; plugins: PluginService; profileLocation: ProfileLocationService; cacheCleaner: LegacyCacheCleaner; requestRestart: () => void };
const idSchema = z.string().min(6).max(80);
const layoutSchema = z.object({ occluded: z.boolean().optional(), primary: z.object({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() }), secondary: z.object({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() }).optional() });
const externalBrowserLayoutSchema = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().int().min(320).max(10_000), height: z.number().int().min(240).max(10_000) });
const dolaReferenceKindSchema = z.enum(['audio', 'video']);
const faceGridSaveSchema = z.object({ inputPath: z.string().min(1).max(4096), outputDir: z.string().max(4096).optional(), mode: z.enum(['grid', 'regroup']), mime: z.enum(['image/png', 'image/jpeg', 'image/webp']), dataUrl: z.string().regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).max(160_000_000), faceCount: z.number().int().min(0).max(1000), scaled: z.boolean() });
const remoteMediaSchema = z.object({
  type: z.enum(['image', 'video']), url: z.string().max(16_384), autoDownload: z.boolean().optional(), backupUrl: z.string().max(16_384).optional(), alternateUrls: z.array(z.string().max(16_384)).max(8).optional(), thumbUrl: z.string().max(16_384).optional(),
  title: z.string().max(500).optional(), source: z.string().max(160).optional(), width: z.number().finite().nonnegative().max(100_000).optional(), height: z.number().finite().nonnegative().max(100_000).optional(),
  duration: z.number().finite().nonnegative().max(86_400).optional(), confirmedNoWatermark: z.boolean().optional(), resolutionMethod: z.string().max(160).optional(), qualityEvidence: z.enum(['unknown', 'dom-direct', 'platform-api', 'decoded-token', 'server-original']).optional(),
  rejectedCandidates: z.array(z.string().max(2_000)).max(100).optional(), messageId: z.string().max(2_000).optional(), conversationId: z.string().max(2_000).optional(), shareId: z.string().max(2_000).optional(), shareUrl: z.string().max(16_384).optional(), threadUrl: z.string().max(16_384).optional(), vid: z.string().max(2_000).optional(), keySeed: z.string().max(20_000).optional(), fplayUrl: z.string().max(16_384).optional(), dolaRecordKey: z.string().max(2_000).optional(), dolaCardId: z.string().max(2_000).optional(), dolaVideoElementId: z.string().max(2_000).optional()
}).strip();
const remoteDolaTokenSchema = z.object({
  token: z.string().min(1).max(200_000), keySeed: z.string().max(20_000).optional(), title: z.string().max(500).optional(), coverUrl: z.string().max(16_384).optional(), thumbUrl: z.string().max(16_384).optional(), width: z.number().finite().nonnegative().max(100_000).optional(), height: z.number().finite().nonnegative().max(100_000).optional(), duration: z.number().finite().nonnegative().max(86_400).optional(), messageId: z.string().max(2_000).optional(), vid: z.string().max(2_000).optional(), fplayUrl: z.string().max(16_384).optional(), dolaRecordKey: z.string().max(2_000).optional(), dolaCardId: z.string().max(2_000).optional(), dolaVideoElementId: z.string().max(2_000).optional(), confirmedNoWatermark: z.boolean().optional()
}).strip();

const ipcHandlerOwners = new Map<string, BrowserWindow>();
let activeIpcDisposer: (() => void) | null = null;

function failure(error: unknown): ApiResult<never> { return { ok: false, error: { code: 'OPERATION_FAILED', message: error instanceof Error ? error.message : String(error) } }; }
function register<T>(window: BrowserWindow, channel: string, schema: ZodType<T>, fn: (value: T, event: IpcMainInvokeEvent) => unknown | Promise<unknown>): void {
  // A macOS app can close and recreate its main window without terminating
  // the process. Electron rejects a second handler for the same channel, so
  // replace the previous window's handler before installing the new one.
  if (ipcHandlerOwners.has(channel)) ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (event, raw) => {
    const senderFrame = event.senderFrame;
    if (!senderFrame || !isTrustedMainFrame(event.sender.id, window.webContents.id, senderFrame.routingId, event.sender.mainFrame.routingId)) return { ok: false, error: { code: 'UNTRUSTED_SENDER', message: '拒绝来自非主界面的调用' } };
    const parsed = schema.safeParse(raw); if (!parsed.success) return { ok: false, error: { code: 'INVALID_ARGUMENT', message: parsed.error.issues[0]?.message ?? '参数错误' } };
    try { return { ok: true, data: await fn(parsed.data, event) }; } catch (error) { return failure(error); }
  });
  ipcHandlerOwners.set(channel, window);
}

export function registerIpc(window: BrowserWindow, services: Services): () => void {
  activeIpcDisposer?.();
  const eventDisposers: Array<() => void> = [];
  const { accounts, browser, media, settings, updates, externalLogin, proxy, fingerprints, migration, plugins, profileLocation, cacheCleaner, requestRestart } = services;
  register(window, channels.accountsList, z.undefined(), () => accounts.list());
  register(window, channels.accountsCreate, accountInputSchema, (value) => accounts.create(value));
  register(window, channels.accountsUpdate, z.object({ id: idSchema, patch: accountInputSchema.partial() }), ({ id, patch }) => accounts.update(id, patch));
  register(window, channels.accountsRemove, idSchema, async (id) => { await externalLogin.removeAccount(id); await browser.removeAccountSession(id); accounts.remove(id); });
  register(window, channels.accountsRemoveMany, z.array(idSchema).min(1), async (ids) => { for (const id of [...new Set(ids)]) { await externalLogin.removeAccount(id); await browser.removeAccountSession(id); accounts.remove(id); } });
  register(window, channels.accountsReorder, z.array(idSchema), (ids) => accounts.reorder(ids));
  register(window, channels.accountsGroups, z.undefined(), () => accounts.groups());
  register(window, channels.accountsRenameGroup, z.object({ from: z.string().max(80), to: z.string().max(80) }), ({ from, to }) => accounts.renameGroup(from, to));
  register(window, channels.accountsRemoveGroup, z.string().max(80), (name) => accounts.removeGroup(name));
  register(window, channels.accountsBulkUpdate, z.object({ ids: z.array(idSchema).min(1), patch: accountInputSchema.partial() }), ({ ids, patch }) => accounts.bulkUpdate(ids, patch));
  register(window, channels.accountsImport, z.undefined(), async () => {
    const result = await dialog.showOpenDialog(window, { title: '导入账号信息', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return { imported: 0 };
    const value = JSON.parse(readFileSync(result.filePaths[0], 'utf8')) as unknown;
    const rows = Array.isArray(value) ? value : (value && typeof value === 'object' && Array.isArray((value as { accounts?: unknown }).accounts) ? (value as { accounts: unknown[] }).accounts : []);
    return { imported: accounts.importMetadata(rows) };
  });
  register(window, channels.accountsExport, z.undefined(), async () => {
    const result = await dialog.showSaveDialog(window, { title: '导出账号信息', defaultPath: `AI创作工作台-账号-${new Date().toISOString().slice(0, 10)}.json` });
    if (result.canceled || !result.filePath) throw new Error('已取消导出');
    const exported = accounts.list().map((account) => ({ ...account, proxy: { ...account.proxy, password: '' } }));
    writeFileSync(result.filePath, `${JSON.stringify({ version: 1, accounts: exported }, null, 2)}\n`); return { path: result.filePath };
  });
  register(window, channels.browserOpen, idSchema, (id) => browser.open(id));
  register(window, channels.browserOpenBatchWorkspace, z.array(idSchema).min(1).max(20), (ids) => browser.openBatchWorkspace(ids));
  register(window, channels.browserCloseBatchWorkspace, z.undefined(), () => browser.closeBatchWorkspace());
  register(window, channels.browserClose, idSchema, (id) => browser.close(id));
  register(window, channels.browserRefresh, idSchema, (id) => browser.refresh(id));
  register(window, channels.browserBack, idSchema, (id) => browser.back(id));
  register(window, channels.browserForward, idSchema, (id) => browser.forward(id));
  register(window, channels.browserSetZoom, z.object({ accountId: idSchema, factor: z.number().min(0.25).max(5) }), ({ accountId, factor }) => browser.setZoom(accountId, factor));
  register(window, channels.browserReconfigure, idSchema, (id) => browser.reconfigure(id));
  register(window, channels.browserResolveDolaResource, z.object({ accountId: idSchema, reference: dolaResourceReferenceSchema, downloadAfterResolve: z.boolean().optional() }), ({ accountId, reference, downloadAfterResolve }) => browser.resolveDolaResource(accountId, reference, downloadAfterResolve));
  register(window, channels.browserNavigate, z.object({ accountId: idSchema, url: z.string().trim().min(1).max(16_384) }), ({ accountId, url }) => browser.navigate(accountId, url));
  register(window, channels.browserActivate, z.object({ primaryId: idSchema.nullable(), secondaryId: idSchema.nullable().optional() }), ({ primaryId, secondaryId }) => browser.activate(primaryId, secondaryId));
  register(window, channels.browserLayout, layoutSchema, (layout: ViewLayout) => browser.setLayout(layout));
  register(window, channels.browserApplyProxy, idSchema, (id) => browser.applyProxy(id));
  register(window, channels.browserOpenMany, z.array(idSchema).min(1), (ids) => browser.openMany(ids));
  register(window, channels.browserCloseMany, z.array(idSchema).min(1), (ids) => browser.closeMany(ids));
  register(window, channels.browserRefreshMany, z.array(idSchema).min(1), (ids) => browser.refreshMany(ids));
  register(window, channels.browserClearSession, z.object({ id: idSchema, kind: z.enum(['cookies', 'cache', 'storage', 'all']) }), ({ id, kind }) => browser.clearSession(id, kind));
  register(window, channels.browserTestProxy, idSchema, (id) => browser.testProxy(id));
  register(window, channels.browserStartJimengOriginal, idSchema, (id) => browser.startJimengOriginal(id));
  register(window, channels.browserStartDoubaoCreationScan, idSchema, (id) => browser.startDoubaoCreationScan(id));
  register(window, channels.browserSendDoubao15sPrompt, idSchema, (id) => browser.sendDoubao15sPrompt(id));
  register(window, channels.browserSetDoubaoDuration, z.object({ accountId: idSchema, duration: z.union([z.literal(15), z.literal(30)]) }), ({ accountId, duration }) => browser.setDoubaoDuration(accountId, duration));
  register(window, channels.proxyImportSubscription, z.object({ accountId: idSchema, url: z.string().url().optional() }), ({ accountId, url }) => proxy.importSubscription(accountId, url));
  register(window, channels.proxyRefreshSubscription, idSchema, (id) => proxy.refreshSubscription(id));
  register(window, channels.proxyListNodes, idSchema, (id) => proxy.listNodes(id));
  register(window, channels.proxySelectNode, z.object({ accountId: idSchema, tag: z.string().min(1).max(240) }), ({ accountId, tag }) => proxy.selectNode(accountId, tag));
  register(window, channels.proxyTestNode, z.object({ accountId: idSchema, tag: z.string().min(1).max(240).optional() }), ({ accountId, tag }) => proxy.testNode(accountId, tag));
  register(window, channels.proxyTestAllNodes, idSchema, (id) => proxy.testAllNodes(id));
  register(window, channels.proxyRuntimeStatus, idSchema, (id) => proxy.runtimeStatus(id));
  register(window, channels.proxyStopRuntime, idSchema, (id) => proxy.stopRuntime(id));
  register(window, channels.fingerprintGet, idSchema, (id) => fingerprints.get(id));
  register(window, channels.fingerprintRegenerate, idSchema, async (id) => { const value = fingerprints.regenerate(id); try { await browser.reconfigure(id); } catch { /* account page may be closed */ } return value; });
  register(window, channels.fingerprintUpdate, z.object({ accountId: idSchema, patch: fingerprintSchema.partial() }), async ({ accountId, patch }) => { const value = fingerprints.update(accountId, patch); try { await browser.reconfigure(accountId); } catch { /* account page may be closed */ } return value; });
  register(window, channels.fingerprintReset, idSchema, async (id) => { const value = fingerprints.reset(id); try { await browser.reconfigure(id); } catch { /* account page may be closed */ } return value; });
  register(window, channels.migrationPreview, z.undefined(), () => migration.preview());
  register(window, channels.migrationImport, z.undefined(), () => migration.import());
  register(window, channels.migrationImportStorage, idSchema, (id) => migration.importStorage(id));
  register(window, channels.externalLoginStart, z.object({ accountId: idSchema, layout: externalBrowserLayoutSchema.optional() }), ({ accountId, layout }) => externalLogin.start(accountId, layout as ExternalBrowserLayout | undefined));
  register(window, channels.externalLoginStatus, idSchema, (id) => externalLogin.status(id));
  register(window, channels.externalLoginState, idSchema, (id) => externalLogin.externalLoginState(id));
  register(window, channels.dolaLoginState, idSchema, (id) => externalLogin.dolaLoginState(id));
  register(window, channels.externalDolaLoginState, idSchema, (id) => externalLogin.externalDolaLoginState(id));
  register(window, channels.externalBrowserOpen, idSchema, (id) => externalLogin.openWithSession(id));
  register(window, channels.externalLoginSync, idSchema, (id) => externalLogin.sync(id));
  register(window, channels.externalLoginClose, idSchema, (id) => externalLogin.close(id));
  const batchLoginPlatformSchema = z.enum(['dola', 'higgsfield']);
  register(window, channels.batchLoginFill, z.object({ accountId: idSchema, email: z.string().email().max(320), password: z.string().min(1).max(1024), platform: batchLoginPlatformSchema }), ({ accountId, email, password, platform }) => externalLogin.batchLoginFill(accountId, email, password, platform));
  register(window, channels.batchLoginCalibrate, z.object({ accountId: idSchema, platform: batchLoginPlatformSchema }), ({ accountId, platform }) => externalLogin.batchLoginCalibrate(accountId, platform));
  register(window, channels.batchLoginFillEmbedded, z.object({ accountId: idSchema, email: z.string().email().max(320), password: z.string().min(1).max(1024), platform: batchLoginPlatformSchema }), ({ accountId, email, password, platform }) => browser.batchLoginFillEmbedded(accountId, email, password, platform));
  register(window, channels.batchLoginCalibrateEmbedded, z.object({ accountId: idSchema, platform: batchLoginPlatformSchema }), ({ accountId, platform }) => browser.batchLoginCalibrateEmbedded(accountId, platform));
  register(window, channels.dolaBatchFill, z.object({ accountId: idSchema, email: z.string().email().max(320), password: z.string().min(1).max(1024) }), ({ accountId, email, password }) => externalLogin.fillDola(accountId, email, password));
  register(window, channels.dolaCalibrate, idSchema, (accountId) => externalLogin.calibrateDola(accountId));
  register(window, channels.dolaBatchFillEmbedded, z.object({ accountId: idSchema, email: z.string().email().max(320), password: z.string().min(1).max(1024) }), ({ accountId, email, password }) => browser.dolaBatchFillEmbedded(accountId, email, password));
  register(window, channels.dolaCalibrateEmbedded, idSchema, (accountId) => browser.dolaCalibrateEmbedded(accountId));
  register(window, channels.dolaCaptureClickPoint, z.object({ accountId: idSchema, target: z.enum(['login', 'google']) }), ({ accountId, target }) => browser.dolaCaptureClickPoint(accountId, target));
  register(window, channels.dolaTestClickPoint, z.object({ accountId: idSchema, target: z.enum(['login', 'google']) }), ({ accountId, target }) => browser.dolaTestClickPoint(accountId, target));
  register(window, channels.dolaUploadReferences, z.object({ accountId: idSchema, kind: dolaReferenceKindSchema, paths: z.array(z.string().trim().min(1).max(4096)).min(1).max(10), aspectRatio: dolaAspectRatioSchema.default('16:9'), duration: z.union([z.literal(15), z.literal(30)]).default(15) }), ({ accountId, kind, paths, aspectRatio, duration }) => browser.uploadDolaReferences(accountId, kind, paths, aspectRatio, duration));
  register(window, channels.dolaSubmitVideo, z.object({ accountId: idSchema, prompt: z.string().trim().min(1).max(20_000), aspectRatio: dolaAspectRatioSchema, duration: z.union([z.literal(15), z.literal(30)]), referencePaths: z.array(z.string().trim().min(1).max(4096)).max(9).default([]) }), ({ accountId, prompt, aspectRatio, duration, referencePaths }) => browser.submitDolaVideo(accountId, prompt, aspectRatio, duration, referencePaths));
  register(window, channels.mediaList, z.undefined(), () => media.list());
  register(window, channels.mediaClear, z.undefined(), () => { media.clear(); });
  register(window, channels.mediaDownload, z.string(), (id) => media.enqueue(id));
  register(window, channels.mediaDownloadMany, z.array(z.string()).min(1), (ids) => media.enqueueMany(ids));
  register(window, channels.mediaSelectCandidate, z.object({ resourceId: z.string().min(1).max(200), url: z.string().trim().min(1).max(16_384) }), ({ resourceId, url }) => media.selectCandidate(resourceId, url));
  register(window, channels.mediaTasks, z.undefined(), () => media.tasks());
  register(window, channels.mediaCancel, z.string(), (id) => media.cancel(id));
  register(window, channels.mediaRetry, z.string(), (id) => media.retry(id));
  register(window, channels.mediaConvertForPreview, z.string().min(1).max(200), (id) => media.convertForPreview(id));
  register(window, channels.mediaToolStatus, z.undefined(), () => media.toolStatus());
  register(window, channels.faceGridChooseImage, z.undefined(), async () => {
    const result = await dialog.showOpenDialog(window, { title: '选择人脸网格图片', properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const path = result.filePaths[0]; const stat = statSync(path);
    if (stat.size > 50 * 1024 * 1024) throw new Error('图片超过 50 MB，无法在工作台中处理');
    const mime = imageMime(path); return { path, mime, dataUrl: `data:${mime};base64,${readFileSync(path).toString('base64')}` };
  });
  register(window, channels.faceGridChooseOutputDir, z.undefined(), async () => {
    const result = await dialog.showOpenDialog(window, { title: '选择人脸网格输出目录', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) throw new Error('已取消选择输出目录');
    return result.filePaths[0];
  });
  register(window, channels.faceGridModel, z.undefined(), () => {
    const root = app.isPackaged ? join(process.resourcesPath, 'face-grid-assets') : join(process.cwd(), 'face-grid-assets');
    const prototxt = join(root, 'deploy.prototxt'); const model = join(root, 'res10_300x300_ssd_iter_140000.caffemodel');
    if (!existsSync(prototxt) || !existsSync(model)) throw new Error('人脸检测模型缺失，请重新安装完整资源包');
    return { prototxt: readFileSync(prototxt), model: readFileSync(model) };
  });
  register(window, channels.faceGridSave, faceGridSaveSchema, (input) => {
    const source = resolve(input.inputPath); if (!existsSync(source) || !statSync(source).isFile()) throw new Error('原图片不存在');
    const outputDir = resolve(input.outputDir?.trim() || dirname(source)); mkdirSync(outputDir, { recursive: true });
    const sourceExtension = extname(source).toLowerCase(); const extension = ['.png', '.jpg', '.jpeg', '.webp'].includes(sourceExtension) ? sourceExtension : input.mime === 'image/jpeg' ? '.jpg' : input.mime === 'image/webp' ? '.webp' : '.png';
    const suffix = input.mode === 'grid' ? '_facegrid' : '_face_regroup'; const stem = basename(source, extname(source)); let target = join(outputDir, `${stem}${suffix}${extension}`); let index = 1;
    while (existsSync(target)) target = join(outputDir, `${stem}${suffix} (${index++})${extension}`);
    const encoded = input.dataUrl.slice(input.dataUrl.indexOf(',') + 1); const bytes = Buffer.from(encoded, 'base64'); if (!bytes.length) throw new Error('处理结果为空');
    const temporary = `${target}.${process.pid}.part`; try { writeFileSync(temporary, bytes, { flag: 'wx' }); renameSync(temporary, target); } finally { if (existsSync(temporary)) rmSync(temporary, { force: true }); }
    return { path: target, faceCount: input.faceCount, scaled: input.scaled };
  });
  register(window, channels.filesList, libraryQuerySchema.partial(), (query) => media.listFiles(query));
  register(window, channels.filesOpen, z.string(), (path) => media.open(path));
  register(window, channels.filesOpenUrl, z.string().trim().min(1).max(16_384), (url) => shell.openExternal(normalizeExternalHttpUrl(url)));
  register(window, channels.filesReveal, z.string(), (path) => media.reveal(path));
  register(window, channels.filesRemove, z.string(), (path) => media.remove(path));
  register(window, channels.filesChooseImages, z.undefined(), async () => {
    const result = await dialog.showOpenDialog(window, { title: '选择 Dola 参考图（最多 9 张）', properties: ['openFile', 'multiSelections'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (result.canceled || result.filePaths.length === 0) return [];
    const paths = [...new Set(result.filePaths)].slice(0, 9);
    for (const path of paths) {
      if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`参考图不存在：${basename(path)}`);
      if (statSync(path).size > 50 * 1024 * 1024) throw new Error(`参考图超过 50 MB：${basename(path)}`);
    }
    return paths;
  });
  register(window, channels.filesChooseDolaReferences, dolaReferenceKindSchema, async (kind) => {
    const extensions = kind === 'audio' ? ['mp3', 'wav'] : ['mp4', 'mov'];
    const label = kind === 'audio' ? '音频' : '视频';
    const result = await dialog.showOpenDialog(window, { title: `选择 Dola 参考${label}（最多 10 个）`, properties: ['openFile', 'multiSelections'], filters: [{ name: label, extensions }] });
    if (result.canceled || result.filePaths.length === 0) return [];
    const paths = [...new Set(result.filePaths)].slice(0, 10);
    for (const path of paths) {
      if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`参考${label}不存在：${basename(path)}`);
      if (statSync(path).size > 200 * 1024 * 1024) throw new Error(`参考${label}超过 200 MB：${basename(path)}`);
    }
    return paths;
  });
  register(window, channels.filesChooseDir, z.undefined(), async () => {
    const result = await dialog.showOpenDialog(window, { title: '选择下载目录', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) throw new Error('已取消选择');
    mkdirSync(result.filePaths[0], { recursive: true }); settings.update({ downloadDir: result.filePaths[0] }); return result.filePaths[0];
  });
  register(window, channels.filesOpenDir, z.undefined(), () => media.openDownloadDir());
  register(window, channels.filesChooseVideoDir, z.undefined(), async () => {
    const result = await dialog.showOpenDialog(window, { title: '选择视频下载目录', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) throw new Error('已取消选择');
    mkdirSync(result.filePaths[0], { recursive: true }); settings.update({ videoDownloadDir: result.filePaths[0] }); return result.filePaths[0];
  });
  register(window, channels.filesOpenVideoDir, z.undefined(), () => media.openVideoDownloadDir());
  register(window, channels.filesCopyPath, z.string(), (path) => clipboard.writeText(media.validateLibraryPath(path)));
  register(window, channels.filesCopyText, z.string().max(4096), (value) => clipboard.writeText(value));
  register(window, channels.filesDrag, z.string(), (path) => {
    const safe = media.validateLibraryPath(path);
    const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');
    window.webContents.startDrag({ file: safe, icon });
  });
  register(window, channels.settingsGet, z.undefined(), () => settings.get());
  register(window, channels.settingsUpdate, settingsSchema.partial(), (patch) => settings.update(patch));
  register(window, channels.profileLocationGet, z.undefined(), () => profileLocation.get());
  register(window, channels.profileLocationChoose, z.undefined(), async () => {
    const current = profileLocation.get();
    const result = await dialog.showOpenDialog(window, { title: '选择浏览器数据目录', defaultPath: current.path, properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return current;
    const next = profileLocation.select(result.filePaths[0]);
    await dialog.showMessageBox(window, { type: 'info', title: '浏览器数据目录已更新', message: '新的浏览器数据目录将在重启应用后生效。', detail: `目录：${next.path}\n当前进程仍使用：${next.activePath}` });
    return next;
  });
  register(window, channels.profileLocationReset, z.undefined(), async () => {
    const next = profileLocation.reset();
    await dialog.showMessageBox(window, { type: 'info', title: '已恢复默认目录', message: '默认浏览器数据目录将在重启应用后生效。', detail: `目录：${next.path}` });
    return next;
  });
  register(window, channels.profileLocationRestart, z.undefined(), () => { requestRestart(); });
  register(window, channels.maintenanceCacheScan, z.undefined(), () => cacheCleaner.scan());
  register(window, channels.maintenanceCacheClean, z.undefined(), () => cacheCleaner.clean());
  register(window, channels.diagnosticsSnapshot, z.undefined(), () => buildDiagnosticsSnapshot({
    appVersion: app.getVersion(), electronVersion: process.versions.electron ?? 'unknown', platform: process.platform, arch: process.arch, packaged: app.isPackaged,
    accounts: accounts.list(), browser: browser.diagnostics(), proxy: accounts.list().map((account) => proxy.runtimeStatus(account.id)), resources: media.list(), tasks: media.tasks(), pluginCount: plugins.list().length, disabledAdapters: settings.get().disabledAdapters
  }));
  register(window, channels.platforms, z.undefined(), () => Object.values(platforms));
  register(window, channels.pluginsList, z.undefined(), () => plugins.list());
  register(window, channels.pluginsImportPackage, z.undefined(), async () => {
    const result = await dialog.showOpenDialog(window, { title: '导入浏览器插件', properties: ['openFile'], filters: [{ name: '插件包', extensions: ['zip', 'crx'] }] });
    if (result.canceled || !result.filePaths[0]) throw new Error('已取消导入');
    return plugins.importPackage(result.filePaths[0]);
  });
  register(window, channels.pluginsImportDirectory, z.undefined(), async () => {
    const result = await dialog.showOpenDialog(window, { title: '选择插件目录', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) throw new Error('已取消导入');
    return plugins.importDirectory(result.filePaths[0]);
  });
  register(window, channels.pluginsSetEnabled, z.object({ id: idSchema, enabled: z.boolean() }), ({ id, enabled }) => plugins.setEnabled(id, enabled));
  register(window, channels.pluginsRemove, idSchema, (id) => plugins.remove(id));
  register(window, channels.pluginsOpenFolder, z.undefined(), () => plugins.openFolder());
  register(window, channels.updatesCheck, z.undefined(), () => updates.check());
  register(window, channels.updatesDownload, z.undefined(), () => updates.download().then((path) => ({ path })));
  register(window, channels.updatesOpenRelease, z.undefined(), () => updates.openRelease());
  eventDisposers.push(proxy.runtime.onState((state) => {
    if (!window.isDestroyed()) window.webContents.send(channels.proxyRuntimeUpdated, state);
  }));
  eventDisposers.push(media.onUpdated((resources) => {
    if (!window.isDestroyed()) window.webContents.send(channels.mediaUpdated, resources);
  }));

  const remoteMediaHandler = (event: IpcMainEvent, raw: unknown): void => {
    const senderFrame = event.senderFrame;
    const accountId = browser.ownsWebContents(event.sender.id);
    if (!senderFrame || !accountId || !isTrustedOwnedFrame(senderFrame.routingId, event.sender.mainFrame.routingId)) return;
    if (!/^https?:\/\//i.test(senderFrame.url || event.sender.getURL())) return;
    const account = accounts.list().find((item) => item.id === accountId); if (!account || !isRemoteAdapterEnabled(account.platform, settings.get().disabledAdapters)) return;
    const parsed = remoteMediaSchema.safeParse(raw); if (!parsed.success) return;
    const hasDolaLocator = [parsed.data.messageId, parsed.data.shareId, parsed.data.shareUrl, parsed.data.threadUrl, parsed.data.vid, parsed.data.keySeed, parsed.data.fplayUrl, parsed.data.dolaRecordKey, parsed.data.dolaCardId, parsed.data.dolaVideoElementId].some((item) => Boolean(item?.trim()));
    if (!parsed.data.url && (account.platform !== 'dola' || parsed.data.type !== 'video' || !hasDolaLocator)) return;
    if (!captureModeAccepts((settings.get().parseImages ? 'all' : 'video'), parsed.data)) return;
    const added = media.add(accountId, parsed.data);
    if (added && parsed.data.autoDownload && added.url) media.enqueue(added.id);
    if (added) void media.materializeBlobPreview(added.id).catch(() => undefined);
  };
  ipcMain.on(channels.remoteMedia, remoteMediaHandler);
  eventDisposers.push(() => ipcMain.removeListener(channels.remoteMedia, remoteMediaHandler));
  const videoNoticeKeys = new Set<string>();
  const remoteVideoGeneratedHandler = (event: IpcMainEvent, raw: unknown): void => {
    const senderFrame = event.senderFrame;
    const accountId = browser.ownsWebContents(event.sender.id);
    if (!senderFrame || !accountId || !isTrustedOwnedFrame(senderFrame.routingId, event.sender.mainFrame.routingId)) return;
    if (!/^https?:\/\//i.test(senderFrame.url || event.sender.getURL())) return;
    const account = accounts.list().find((item) => item.id === accountId);
    if (!account || account.platform !== 'dola' || !isRemoteAdapterEnabled(account.platform, settings.get().disabledAdapters)) return;
    const parsed = videoGeneratedNoticeSchema.safeParse(raw); if (!parsed.success) return;
    const identity = `${accountId}:${parsed.data.key}`;
    if (videoNoticeKeys.has(identity)) return;
    videoNoticeKeys.add(identity);
    if (videoNoticeKeys.size > 500) videoNoticeKeys.delete(videoNoticeKeys.values().next().value!);
    window.webContents.send(channels.mediaVideoGenerated, { accountId, ...parsed.data });
  };
  ipcMain.on(channels.remoteVideoGenerated, remoteVideoGeneratedHandler);
  eventDisposers.push(() => ipcMain.removeListener(channels.remoteVideoGenerated, remoteVideoGeneratedHandler));
  const remoteDolaTokenHandler = (event: IpcMainEvent, raw: unknown): void => {
    const senderFrame = event.senderFrame;
    const accountId = browser.ownsWebContents(event.sender.id);
    if (!senderFrame || !accountId || !isTrustedOwnedFrame(senderFrame.routingId, event.sender.mainFrame.routingId)) return;
    if (!/^https?:\/\//i.test(senderFrame.url || event.sender.getURL())) return;
    const account = accounts.list().find((item) => item.id === accountId);
    if (!account || account.platform !== 'dola' || !isRemoteAdapterEnabled(account.platform, settings.get().disabledAdapters)) return;
    const parsed = remoteDolaTokenSchema.safeParse(raw); if (!parsed.success) return;
    if (!captureModeAccepts((settings.get().parseImages ? 'all' : 'video'), { type: 'video' })) return;
    browser.resolveDolaToken(accountId, parsed.data);
  };
  ipcMain.on(channels.remoteDolaToken, remoteDolaTokenHandler);
  eventDisposers.push(() => ipcMain.removeListener(channels.remoteDolaToken, remoteDolaTokenHandler));
  const notified = new Set<string>();
  eventDisposers.push(media.onTasks((tasks) => {
    if (window.isDestroyed()) return;
    window.webContents.send(channels.mediaTasksUpdated, tasks);
    for (const task of tasks) if ((task.status === 'completed' || task.status === 'failed') && !notified.has(`${task.id}:${task.status}`)) {
      notified.add(`${task.id}:${task.status}`);
      if (Notification.isSupported()) new Notification({ title: task.status === 'completed' ? '素材下载完成' : '素材下载失败', body: task.status === 'completed' ? task.title : `${task.title}：${task.error ?? '未知错误'}` }).show();
    }
  }));
  const dispose = (): void => {
    for (const disposeEvent of eventDisposers.splice(0)) disposeEvent();
    for (const [channel, owner] of [...ipcHandlerOwners.entries()]) {
      if (owner !== window) continue;
      ipcMain.removeHandler(channel);
      ipcHandlerOwners.delete(channel);
    }
    if (activeIpcDisposer === dispose) activeIpcDisposer = null;
  };
  activeIpcDisposer = dispose;
  return dispose;
}

function imageMime(path: string): 'image/png' | 'image/jpeg' | 'image/webp' {
  const extension = extname(path).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return 'image/jpeg';
}
