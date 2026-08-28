import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { session, shell } from 'electron';
import { z } from 'zod';
import { downloadTaskSchema, libraryQuerySchema, mediaResourceSchema, type AppSettings, type DownloadFile, type DownloadTask, type LibraryPage, type LibraryQuery, type MediaResource, type MediaToolStatus, type PlatformId, type PreviewConversionResult } from '../shared/contracts';
import { platforms } from '../shared/platforms';
import { normalizeCapturedUrl } from '../shared/url-utils';
import type { AccountService } from './accounts';
import type { SettingsService } from './settings';
import { isPathInside, mediaTypeFromPath, sanitizeFilename } from './path-utils';
import { canonicalMediaExtension, extensionFromMimeType, mediaExtensionFromSignature, mediaTypeFromExtension } from './media-formats';
import { AtomicStore } from './atomic-store';

type BlobResolver = (accountId: string, url: string) => Promise<Buffer>;
type ProgrammaticDownloadMarker = (accountId: string, url: string) => void;

export function captureModeAccepts(mode: AppSettings['captureMode'], raw: unknown): boolean {
  if (mode === 'all') return true;
  return Boolean(raw && typeof raw === 'object' && (raw as { type?: unknown }).type === mode);
}

export class MediaService {
  private resources = new Map<string, MediaResource>();
  private taskMap = new Map<string, DownloadTask>();
  private readonly aborters = new Map<string, AbortController>();
  private readonly previewTokens = new Map<string, string>();
  private readonly conversionJobs = new Map<string, Promise<PreviewConversionResult>>();
  private readonly blobPreviewJobs = new Map<string, Promise<MediaResource | null>>();
  private readonly blobPreviewPaths = new Set<string>();
  private running = 0;
  private taskListener: ((tasks: DownloadTask[]) => void) | null = null;
  private resourceListener: ((resources: MediaResource[]) => void) | null = null;
  private readonly taskStore?: AtomicStore<DownloadTask[]>;
  private readonly pendingCovers = new Map<string, MediaResource[]>();
  private programmaticDownloadMarker: ProgrammaticDownloadMarker | null = null;
  constructor(private readonly accounts: AccountService, private readonly settings: SettingsService, private readonly resolveBlob?: BlobResolver, _indexFile?: string, tasksFile?: string) {
    if (tasksFile) { this.taskStore = new AtomicStore(tasksFile, z.array(downloadTaskSchema), []); const restored = this.taskStore.read().map((task) => task.status === 'running' ? { ...task, status: 'failed' as const, error: '应用上次在下载过程中退出' } : task); this.taskMap = new Map(restored.map((item) => [item.id, item])); this.persistTasks(); }
  }

  setProgrammaticDownloadMarker(marker: ProgrammaticDownloadMarker | null): void {
    this.programmaticDownloadMarker = marker;
  }

  onTasks(listener: (tasks: DownloadTask[]) => void): () => void {
    this.taskListener = listener;
    return () => { if (this.taskListener === listener) this.taskListener = null; };
  }
  onUpdated(listener: (resources: MediaResource[]) => void): () => void {
    this.resourceListener = listener;
    return () => { if (this.resourceListener === listener) this.resourceListener = null; };
  }
  private emitTasks(): void { this.taskListener?.(this.tasks()); }
  private emitResources(): void { this.resourceListener?.(this.list()); }
  private updateTask(id: string, patch: Partial<DownloadTask>): DownloadTask {
    const current = this.taskMap.get(id); if (!current) throw new Error('下载任务不存在');
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() }; this.taskMap.set(id, next); this.persistTasks(); this.emitTasks(); return next;
  }

  add(accountId: string, raw: unknown): MediaResource | null {
    if (!raw || typeof raw !== 'object') return null;
    const account = this.accounts.list().find((item) => item.id === accountId); if (!account) return null;
    const value = cleanRecord(raw as Record<string, unknown>); const url = String(value.url ?? value.no_watermark_url ?? '');
    const pending = !url && account.platform === 'dola' && hasPendingMediaLocator(value);
    if ((!url && !pending) || (url && !/^(https?:|blob:)/i.test(url))) return null;
    const provisionalId = createHash('sha256').update(`${accountId}:${String(value.type)}:${semanticIdentity(value, url)}`).digest('hex');
    const parsed = mediaResourceSchema.safeParse({ ...value, url, id: provisionalId, accountId, capturedAt: new Date().toISOString(), source: String(value.source ?? 'remote-preload'), expiresAt: normalizeDate(value.expiresAt ?? value.expires_at) });
    if (!parsed.success) return null;
    let candidate = parsed.data;
    if (/generic-(?:dom|performance)|dom-fallback/i.test(candidate.source)) {
      candidate = { ...candidate, confirmedNoWatermark: false, qualityEvidence: 'dom-direct', resolutionMethod: candidate.resolutionMethod ?? 'dom-direct' };
    }

    if (isPotentialVideoCover(candidate, account.platform)) {
      const attached = this.attachCover(accountId, candidate); if (attached) { this.emitResources(); return attached; }
      const pending = this.pendingCovers.get(accountId) ?? []; pending.push(candidate); this.pendingCovers.set(accountId, pending.slice(-12)); return null;
    }
    if (!shouldKeepResource(candidate, account.platform)) return null;
    if (candidate.type === 'video') candidate = this.applyPendingCover(candidate);

    const duplicate = [...this.resources.values()].find((item) => item.accountId === accountId && isSameResource(item, candidate));
    if (duplicate) {
      const merged = mergeResource(duplicate, candidate); this.resources.set(duplicate.id, merged); this.emitResources(); return merged;
    }
    this.resources.set(candidate.id, candidate); this.emitResources(); return candidate;
  }
  list(): MediaResource[] { return [...this.resources.values()].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)); }
  clear(): void {
    this.resources.clear(); this.pendingCovers.clear();
    for (const path of this.blobPreviewPaths) { try { rmSync(path, { force: true }); } catch { /* best effort cleanup */ } }
    for (const [token, path] of this.previewTokens) if (this.blobPreviewPaths.has(path)) this.previewTokens.delete(token);
    this.blobPreviewPaths.clear();
    this.emitResources();
  }
  tasks(): DownloadTask[] { return [...this.taskMap.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }

  /**
   * Promote a candidate already observed for this resource to the primary
   * URL. Renderer input cannot become an arbitrary download URL: the value
   * must already be in the bounded candidate set, and the normal Session
   * download path still performs the final fetch.
   */
  selectCandidate(resourceId: string, rawUrl: string): MediaResource {
    const resource = this.resources.get(resourceId);
    if (!resource) throw new Error('素材不存在');
    const selected = normalizeCapturedUrl(rawUrl);
    if (!selected) throw new Error('素材候选地址协议不受支持');
    const candidates = uniqueResourceUrls([resource.url, resource.backupUrl, ...(resource.alternateUrls ?? [])]);
    if (!candidates.includes(selected)) throw new Error('候选地址不属于当前素材');
    if (selected === resource.url) return resource;
    const remaining = candidates.filter((candidate) => candidate !== selected);
    const updated = mediaResourceSchema.parse({
      ...resource,
      url: selected,
      backupUrl: remaining[0] || undefined,
      alternateUrls: remaining.length > 1 ? remaining.slice(1, 9) : undefined,
      // A materialized Blob preview belongs to the previous primary URL.
      previewUrl: undefined,
      previewThumbUrl: undefined
    });
    this.resources.set(resourceId, updated);
    this.emitResources();
    return updated;
  }

  async materializeBlobPreview(resourceId: string): Promise<MediaResource | null> {
    const existing = this.blobPreviewJobs.get(resourceId);
    if (existing) return existing;
    const job = this.materializeBlobPreviewNow(resourceId);
    this.blobPreviewJobs.set(resourceId, job);
    try { return await job; } finally { this.blobPreviewJobs.delete(resourceId); }
  }

  private async materializeBlobPreviewNow(resourceId: string): Promise<MediaResource | null> {
    const resource = this.resources.get(resourceId);
    if (!resource || !this.resolveBlob) return resource ?? null;
    const previewUrl = resource.url.startsWith('blob:') && !resource.previewUrl ? await this.writeBlobPreview(resource, resource.url, false) : resource.previewUrl;
    const previewThumbUrl = resource.thumbUrl?.startsWith('blob:') && !resource.previewThumbUrl ? await this.writeBlobPreview(resource, resource.thumbUrl, true) : resource.previewThumbUrl;
    if (!previewUrl && !previewThumbUrl) return resource;
    const current = this.resources.get(resourceId);
    if (!current) return null;
    const updated = { ...current, previewUrl: previewUrl ?? current.previewUrl, previewThumbUrl: previewThumbUrl ?? current.previewThumbUrl };
    this.resources.set(resourceId, updated);
    this.emitResources();
    return updated;
  }

  private rememberRejectedCandidates(resource: MediaResource, urls: string[]): void {
    const current = this.resources.get(resource.id);
    if (!current) return;
    const failed = uniqueResourceUrls(urls).filter((url) => url.length <= 2_000);
    if (!failed.length) return;
    const rejectedCandidates = [...new Set([...(current.rejectedCandidates ?? []), ...failed])].slice(-100);
    if (rejectedCandidates.length === (current.rejectedCandidates ?? []).length && rejectedCandidates.every((value, index) => value === current.rejectedCandidates?.[index])) return;
    this.resources.set(resource.id, mediaResourceSchema.parse({ ...current, rejectedCandidates }));
    this.emitResources();
  }

  private async writeBlobPreview(resource: MediaResource, url: string, thumbnail: boolean): Promise<string | undefined> {
    if (!this.resolveBlob) return undefined;
    const bytes = await this.resolveBlob(resource.accountId, url);
    if (!bytes.length) throw new Error('Blob 预览数据为空');
    const extension = detectMediaExtension('', bytes, thumbnail ? 'image' : resource.type, thumbnail ? resource.thumbUrl : resource.url) ?? (thumbnail ? '.png' : resource.type === 'video' ? '.mp4' : '.png');
    const token = createHash('sha256').update(`${resource.accountId}:${url}`).digest('hex');
    const root = join(tmpdir(), 'ai-creation-workbench', 'blob-preview'); mkdirSync(root, { recursive: true });
    const path = join(root, `${token}${extension}`);
    if (!existsSync(path)) {
      const temporary = `${path}.${process.pid}.part`;
      try { writeFileSync(temporary, bytes, { flag: 'wx' }); renameSync(temporary, path); }
      catch (error) { if (existsSync(temporary)) rmSync(temporary, { force: true }); if (!existsSync(path)) throw error; }
    }
    this.blobPreviewPaths.add(path);
    return this.registerPreviewPath(path);
  }

  async toolStatus(): Promise<MediaToolStatus> {
    const found = await findFfmpeg(this.settings.get().ffmpegPath);
    if (!found) return { available: false, packaged: false, message: '未找到 FFmpeg；可在设置中指定 ffmpeg 可执行文件路径' };
    return { available: true, path: found.path, version: found.version, packaged: found.packaged, message: found.packaged ? `已使用随应用携带的 FFmpeg：${found.version}` : `已找到系统 FFmpeg：${found.version}` };
  }

  async convertForPreview(resourceId: string): Promise<PreviewConversionResult> {
    const resource = this.resources.get(resourceId);
    if (!resource) throw new Error('素材不存在');
    if (resource.type !== 'video') throw new Error('只有视频素材可以转换');
    const existing = this.conversionJobs.get(resourceId);
    if (existing) return existing;
    const output = this.previewOutput(resource);
    const job = this.runPreviewConversion(resource, output);
    this.conversionJobs.set(resourceId, job);
    try { return await job; } finally { this.conversionJobs.delete(resourceId); }
  }

  private async runPreviewConversion(resource: MediaResource, output: string): Promise<PreviewConversionResult> {
    if (existsSync(output)) return { path: output, url: this.registerPreviewPath(output), cached: true, toolPath: '缓存' };
    const found = await findFfmpeg(this.settings.get().ffmpegPath);
    if (!found) throw new Error('未找到 FFmpeg。请在设置中指定 ffmpeg 路径，或将 ffmpeg 加入系统 PATH');
    const root = dirname(output); mkdirSync(root, { recursive: true });
    const source = join(root, `${previewKey(resource)}.source${sourceExtension(resource)}`);
    const temporaryOutput = `${output}.part`;
    try {
      await this.writeConversionSource(resource, source);
      await runFfmpeg(found.path, source, temporaryOutput);
      if (!existsSync(temporaryOutput)) throw new Error('FFmpeg 未生成预览文件');
      if (existsSync(output)) rmSync(output, { force: true });
      renameSync(temporaryOutput, output);
      return { path: output, url: this.registerPreviewPath(output), cached: false, toolPath: found.path };
    } finally {
      if (existsSync(source)) rmSync(source, { force: true });
      if (existsSync(temporaryOutput)) rmSync(temporaryOutput, { force: true });
    }
  }

  private registerPreviewPath(path: string): string {
    const token = createHash('sha256').update(path).digest('hex');
    this.previewTokens.set(token, path);
    return `workbench-media://preview/${token}`;
  }

  private async writeConversionSource(resource: MediaResource, target: string): Promise<void> {
    if (resource.url.startsWith('blob:')) {
      if (!this.resolveBlob) throw new Error('Blob 下载服务不可用');
      writeFileSync(target, await this.resolveBlob(resource.accountId, resource.url));
      return;
    }
    const account = this.accounts.list().find((item) => item.id === resource.accountId);
    if (!account) throw new Error('账号不存在');
    const referer = account.customUrl || platforms[account.platform].url;
    const origin = new URL(referer).origin;
    const urls = uniqueResourceUrls([resource.url, resource.backupUrl, ...(resource.alternateUrls ?? [])]);
    let lastError: unknown;
    for (const url of urls) {
      try {
        if (/^blob:/i.test(url)) {
          if (!this.resolveBlob) throw new Error('Blob 下载服务不可用');
          const data = await this.resolveBlob(account.id, url);
          if (!data.length) throw new Error('Blob 资源为空');
          writeFileSync(target, data);
          return;
        }
        const response = await session.fromPartition(`persist:account_${account.id}`).fetch(url, { headers: { Referer: referer, Origin: origin } });
        if (!response.ok || !response.body) { lastError = new Error(`HTTP ${response.status}`); continue; }
        const writer = createWriteStream(target);
        // Cancellation can race with a pending WebStream read. Keep an error
        // listener attached for the lifetime of the file stream so a late
        // write-after-destroy is observed by the surrounding download flow,
        // not reported by Node as an unhandled exception.
        writer.on('error', () => undefined);
        const reader = response.body.getReader();
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            if (!writer.write(Buffer.from(chunk.value))) await once(writer, 'drain');
          }
          writer.end(); await once(writer, 'finish'); return;
        } catch (error) {
          writer.destroy(); throw error;
        }
      } catch (error) { lastError = error; if (existsSync(target)) rmSync(target, { force: true }); }
    }
    throw lastError instanceof Error ? lastError : new Error('视频源下载失败');
  }

  private root(): string { const root = this.settings.get().downloadDir; mkdirSync(root, { recursive: true }); return resolve(root); }
  private videoRoot(): string {
    const configured = (this.settings.get().videoDownloadDir ?? '').trim();
    const root = configured || this.root();
    mkdirSync(root, { recursive: true });
    return resolve(root);
  }
  /**
   * Reserve a path for a Chromium download that is not a captured image/video.
   * These files still use Electron's native DownloadItem lifecycle, but the
   * old application saved them under the configured workbench directory rather
   * than silently falling back to the operating system Downloads folder.
   */
  reserveNativeDownloadPath(accountId: string, filename: string): string {
    const folder = this.accountDownloadFolder(accountId, this.root());
    const initialName = sanitizeFilename(filename, `download_${Date.now()}`);
    const extension = extname(initialName);
    const stem = basename(initialName, extension);
    let target = join(folder, initialName);
    let suffix = 1;
    while (this.isPathOccupied(target)) target = join(folder, `${stem} (${suffix++})${extension}`);
    this.reservedPaths.add(target);
    return target;
  }
  releaseReservedDownloadPath(path: string): void { this.reservedPaths.delete(resolve(path)); }
  private previewOutput(resource: MediaResource): string {
    if (this.settings.get().legacyV44MediaFolders === true) {
      const hash = createHash('sha256').update(resource.url).digest('hex');
      return join(this.videoRoot(), 'Videos', `转码_${hash}.mp4`);
    }
    return previewOutputPath(resource);
  }
  private readonly reservedPaths = new Set<string>();
  private safePath(path: string): string { const target = resolve(path); const roots = [this.root(), this.videoRoot()]; if (!roots.some((root) => isPathInside(root, target))) throw new Error('文件不在下载目录内'); return target; }
  private folder(resource: MediaResource): string {
    const account = this.accounts.list().find((item) => item.id === resource.accountId); if (!account) throw new Error('账号不存在');
    const settings = this.settings.get();
    const root = resource.type === 'video' ? this.videoRoot() : this.root();
    if (settings.legacyV44MediaFolders === true) {
      const folder = join(root, resource.type === 'video' ? 'Videos' : 'Images'); mkdirSync(folder, { recursive: true }); return folder;
    }
    if (resource.type === 'video' && this.settings.get().legacyVideoLayout !== false && ['doubao', 'dola'].includes(account.platform)) {
      const folder = join(root, sanitizeFilename(platforms[account.platform].name, '平台').slice(0, 80)); mkdirSync(folder, { recursive: true }); return folder;
    }
    return this.accountDownloadFolder(account.id, root);
  }
  private accountDownloadFolder(accountId: string, root: string): string {
    const account = this.accounts.list().find((item) => item.id === accountId); if (!account) throw new Error('账号不存在');
    if (!this.settings.get().useAccountDownloadSubfolders) return root;
    const clean = (value: string, fallback: string): string => sanitizeFilename(value, fallback).slice(0, 80);
    const platform = clean(platforms[account.platform]?.name ?? account.platform, '平台');
    const name = clean(account.name, account.id);
    const date = new Date().toISOString().slice(0, 10);
    const parts = this.settings.get().downloadFolderPattern === 'platform' ? [platform] : this.settings.get().downloadFolderPattern === 'platform-account' ? [platform, name] : this.settings.get().downloadFolderPattern === 'date' ? [date, name] : [name];
    const folder = join(root, ...parts); mkdirSync(folder, { recursive: true }); return folder;
  }
  private filename(resource: MediaResource, folder: string): string {
    const account = this.accounts.list().find((item) => item.id === resource.accountId)!; const urlPath = resource.url.startsWith('http') ? new URL(resource.url).pathname : '';
    const settings = this.settings.get();
    const guessed = resource.title || basename(urlPath) || `${resource.type}_${Date.now()}`; let cleaned = sanitizeFilename(guessed, `download_${Date.now()}`);
    const fallback = resource.type === 'video' ? '.mp4' : '.png'; if (!extname(cleaned)) cleaned += extname(urlPath) || fallback;
    if (resource.type === 'video' && (settings.legacyV44MediaFolders === true || (settings.legacyVideoLayout !== false && ['doubao', 'dola'].includes(account.platform)))) {
      const extension = extname(cleaned) || fallback;
      const videoExtensions = [...new Set([extension.toLowerCase(), '.mp4', '.webm', '.mov', '.m4v'])];
      for (let index = 1; index <= 1000; index++) {
        const stem = String(index);
        if (videoExtensions.some((item) => this.isPathOccupied(join(folder, `${stem}${item}`)))) continue;
        return `${stem}${extension}`;
      }
      throw new Error('视频下载编号 1-1000 已用完');
    }
    if (resource.type === 'image' && settings.legacyV44MediaFolders === true) {
      const extension = extname(cleaned) || fallback;
      const pad = (value: number): string => String(value).padStart(2, '0');
      const now = new Date();
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}_${String(now.getMilliseconds()).padStart(3, '0')}`;
      return `图片_${timestamp}${extension}`;
    }
    const prefix = sanitizeFilename(settings.videoFilenamePrefix, '').trim().replace(/[. ]+$/g, '').slice(0, 80);
    if (prefix) {
      const pad = (value: number): string => String(value).padStart(2, '0');
      const now = new Date();
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const accountName = sanitizeFilename(account.name || platforms[account.platform].name || account.id, '账号').replace(/[. ]+$/g, '').slice(0, 80) || '账号';
      const extension = extname(cleaned) || fallback;
      cleaned = sanitizeFilename(`${prefix}_${accountName}_${timestamp}${extension}`, `download_${Date.now()}${extension}`);
    }
    return cleaned;
  }
  private availablePath(resource: MediaResource, extension?: string): string {
    const folder = this.folder(resource); const initialName = this.filename(resource, folder); const parsedExt = extname(initialName); const requestedExt = extension && (extension.startsWith('.') ? extension : `.${extension}`); const initial = requestedExt && parsedExt.toLowerCase() !== requestedExt.toLowerCase() ? `${basename(initialName, parsedExt)}${requestedExt}` : initialName; const effectiveExt = extname(initial); const stem = basename(initial, effectiveExt); let file = join(folder, initial); let suffix = 1;
    while (this.isPathOccupied(file)) file = join(folder, `${stem} (${suffix++})${effectiveExt}`);
    this.reservedPaths.add(file);
    return file;
  }
  private isPathOccupied(path: string): boolean { return existsSync(path) || existsSync(`${path}.part`) || this.reservedPaths.has(path); }

  enqueue(resourceId: string): DownloadTask {
    const resource = this.resources.get(resourceId); if (!resource) throw new Error('素材不存在');
    if (!resource.url) throw new Error('素材还没有可下载地址，请先解析 Dola 原始资源');
    const existing = this.tasks().find((task) => task.resourceId === resourceId && (['queued', 'running'].includes(task.status) || (task.status === 'completed' && Boolean(task.path && existsSync(task.path))))); if (existing) return existing;
    const now = new Date().toISOString(); const task: DownloadTask = { id: randomUUID(), resourceId, accountId: resource.accountId, title: resource.title || resource.type, status: 'queued', receivedBytes: 0, attempts: 0, createdAt: now, updatedAt: now };
    this.taskMap.set(task.id, task); this.persistTasks(); this.emitTasks(); void this.pump(); return task;
  }
  enqueueMany(resourceIds: string[]): DownloadTask[] { return [...new Set(resourceIds)].map((id) => this.enqueue(id)); }
  cancel(id: string): void { const task = this.taskMap.get(id); if (!task || !['queued', 'running'].includes(task.status)) return; this.aborters.get(id)?.abort(); this.updateTask(id, { status: 'cancelled', error: undefined }); }
  retry(id: string): DownloadTask { const task = this.taskMap.get(id); if (!task) throw new Error('下载任务不存在'); if (!['failed', 'cancelled'].includes(task.status)) throw new Error('当前任务不能重试'); const next = this.updateTask(id, { status: 'queued', error: undefined, receivedBytes: 0, totalBytes: undefined, progress: undefined, path: undefined }); void this.pump(); return next; }

  private async pump(): Promise<void> {
    while (this.running < this.settings.get().downloadConcurrency) {
      const task = this.tasks().reverse().find((item) => item.status === 'queued'); if (!task) break;
      this.running++; this.updateTask(task.id, { status: 'running' }); void this.run(task.id).finally(() => { this.running--; void this.pump(); });
    }
  }
  resume(): void { void this.pump(); }
  private persistTasks(): void { this.taskStore?.write(this.tasks()); }
  private async run(id: string): Promise<void> {
    const task = this.taskMap.get(id)!; const resource = this.resources.get(task.resourceId); if (!resource) { this.updateTask(id, { status: 'failed', error: '素材已不存在' }); return; }
    const controller = new AbortController(); this.aborters.set(id, controller); let file = this.availablePath(resource); let partial = `${file}.part`;
    try {
      const maxAttempts = this.settings.get().downloadRetryCount + 1; let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError'); this.updateTask(id, { attempts: attempt });
        try { const detectedExtension = await this.downloadResource(resource, partial, id, controller.signal); if (detectedExtension && extname(file).toLowerCase() !== detectedExtension) { this.reservedPaths.delete(file); const correctedFile = this.availablePath(resource, detectedExtension); const correctedPartial = `${correctedFile}.part`; renameSync(partial, correctedPartial); file = correctedFile; partial = correctedPartial; } renameSync(partial, file); this.updateTask(id, { status: 'completed', path: file, progress: 100 }); return; }
        catch (error) { lastError = error; if (existsSync(partial)) rmSync(partial, { force: true }); if (controller.signal.aborted || attempt === maxAttempts) throw error; }
      }
      throw lastError;
    } catch (error) {
      if (existsSync(partial)) rmSync(partial, { force: true });
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) this.updateTask(id, { status: 'cancelled' });
      else this.updateTask(id, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
    } finally { this.aborters.delete(id); this.reservedPaths.delete(file); }
  }
  private async downloadResource(resource: MediaResource, partial: string, taskId: string, signal: AbortSignal): Promise<string | undefined> {
    const account = this.accounts.list().find((item) => item.id === resource.accountId);
    if (!account) throw new Error('账号不存在');
    const ses = session.fromPartition(`persist:account_${account.id}`);
    const referer = account.customUrl || platforms[account.platform].url;
    const origin = new URL(referer).origin;
    const urls = uniqueResourceUrls([resource.url, resource.backupUrl, ...(resource.alternateUrls ?? [])]);
    let lastError: unknown;
    const rejected: string[] = [];
    const rememberFailure = (url: string, error: unknown): void => {
      rejected.push(url);
      lastError = error;
      if (!signal.aborted) this.updateTask(taskId, { receivedBytes: 0, totalBytes: undefined, progress: undefined });
    };

    for (const url of urls) {
      if (signal.aborted) throw new DOMException('已取消', 'AbortError');
      try {
        if (/^blob:/i.test(url)) {
          if (!this.resolveBlob) throw new Error('Blob 下载服务不可用');
          const data = await this.resolveBlob(resource.accountId, url);
          if (!data.length) throw new Error('Blob 资源为空');
          if (signal.aborted) throw new DOMException('已取消', 'AbortError');
          writeFileSync(partial, data);
          this.updateTask(taskId, { receivedBytes: data.length, totalBytes: data.length, progress: 100 });
          this.rememberRejectedCandidates(resource, rejected);
          return detectMediaExtension('', data, resource.type, url);
        }

        try { this.programmaticDownloadMarker?.(account.id, url); } catch { /* the duplicate guard must never break a download */ }
        const response = await ses.fetch(url, { signal, headers: { Referer: referer, Origin: origin } });
        if (!response.ok || !response.body) {
          rememberFailure(url, new Error(response.ok ? '下载响应为空' : `HTTP ${response.status}`));
          continue;
        }

        const contentType = response.headers.get('content-type') ?? '';
        const total = Number(response.headers.get('content-length')) || undefined;
        const writer = createWriteStream(partial);
        writer.on('error', () => undefined);
        const reader = response.body.getReader();
        let received = 0;
        let firstChunk: Uint8Array | undefined;
        let detectedExtension: string | undefined;
        try {
          const first = await reader.read();
          if (first.done) throw new Error('下载响应为空');
          firstChunk = first.value;
          if (isClearlyErrorPayload(contentType, firstChunk)) throw new Error(`下载响应不是媒体文件（${contentType || '未知类型'}）`);
          detectedExtension = detectMediaExtension(contentType, firstChunk, resource.type, url);
          received += firstChunk.byteLength;
          if (!writer.write(Buffer.from(firstChunk))) await once(writer, 'drain');
          this.updateTask(taskId, { receivedBytes: received, totalBytes: total, progress: total ? Math.min(99, Math.round(received / total * 100)) : undefined });
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            if (signal.aborted) throw new DOMException('已取消', 'AbortError');
            received += chunk.value.byteLength;
            if (!writer.write(Buffer.from(chunk.value))) await once(writer, 'drain');
            this.updateTask(taskId, { receivedBytes: received, totalBytes: total, progress: total ? Math.min(99, Math.round(received / total * 100)) : undefined });
          }
          writer.end();
          await once(writer, 'finish');
          this.rememberRejectedCandidates(resource, rejected);
          return detectedExtension ?? detectMediaExtension(contentType, firstChunk, resource.type, url);
        } catch (error) {
          try { await reader.cancel(); } catch { /* response may already be closed */ }
          writer.destroy();
          if (existsSync(partial)) rmSync(partial, { force: true });
          if (signal.aborted) throw error;
          rememberFailure(url, error);
        }
      } catch (error) {
        if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
        if (!rejected.includes(url)) rememberFailure(url, error);
        if (existsSync(partial)) rmSync(partial, { force: true });
      }
    }

    this.rememberRejectedCandidates(resource, rejected);
    throw lastError instanceof Error ? lastError : new Error('下载响应为空');
  }

  listFiles(raw: Partial<LibraryQuery> = {}): LibraryPage {
    const query = libraryQuerySchema.parse(raw); const configuredRoots = [...new Set([this.root(), this.videoRoot()])]; const roots = configuredRoots.filter((candidate) => !configuredRoots.some((other) => other !== candidate && isPathInside(other, candidate))); const result: DownloadFile[] = []; const accounts = this.accounts.list();
    const walk = (dir: string, base: string): void => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) walk(path, base); else if (!entry.name.endsWith('.part')) { const stat = statSync(path); const relativePath = relative(base, path); const segments = relativePath.split(/[\\/]/); const account = accounts.find((item) => segments.includes(sanitizeFilename(item.name, '未分组').slice(0, 80))); const platform = account?.platform ?? (Object.values(platforms).find((item) => segments.includes(item.name))?.id); const type = mediaTypeFromPath(path); const token = createHash('sha256').update(path).digest('hex'); if (type !== 'other') this.previewTokens.set(token, path); result.push({ path, relativePath, name: entry.name, size: stat.size, modifiedAt: stat.mtime.toISOString(), type, previewUrl: type === 'other' ? undefined : `workbench-media://library/${token}`, account: account?.name, platform }); } } };
    for (const root of roots) walk(root, root); const filtered = result.filter((file) => (query.type === 'all' || file.type === query.type) && (!query.search || `${file.name} ${file.relativePath}`.toLowerCase().includes(query.search.toLowerCase())) && (!query.account || file.account === query.account) && (!query.platform || file.platform === query.platform) && (!query.dateFrom || file.modifiedAt >= `${query.dateFrom}T00:00:00`) && (!query.dateTo || file.modifiedAt <= `${query.dateTo}T23:59:59.999`)).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    const start = (query.page - 1) * query.pageSize; return { items: filtered.slice(start, start + query.pageSize), total: filtered.length, page: query.page, pageSize: query.pageSize, pages: Math.max(1, Math.ceil(filtered.length / query.pageSize)) };
  }
  async open(path: string): Promise<void> { const error = await shell.openPath(this.safePath(path)); if (error) throw new Error(error); }
  async openDownloadDir(): Promise<void> { const error = await shell.openPath(this.root()); if (error) throw new Error(error); }
  async openVideoDownloadDir(): Promise<void> { const error = await shell.openPath(this.videoRoot()); if (error) throw new Error(error); }
  reveal(path: string): void { shell.showItemInFolder(this.safePath(path)); }
  remove(path: string): void { unlinkSync(this.safePath(path)); }
  validateLibraryPath(path: string): string { const safe = this.safePath(path); if (!existsSync(safe) || statSync(safe).isDirectory() || safe.endsWith('.part')) throw new Error('素材文件不存在'); return safe; }
  previewPath(url: string): string | null { try { const parsed = new URL(url); if (parsed.protocol !== 'workbench-media:' || !['library', 'preview'].includes(parsed.hostname)) return null; const path = this.previewTokens.get(parsed.pathname.replace(/^\//, '')); return path && existsSync(path) ? (parsed.hostname === 'library' ? this.safePath(path) : resolve(path)) : null; } catch { return null; } }

  private attachCover(accountId: string, cover: MediaResource): MediaResource | null {
    const videos = [...this.resources.values()].filter((item) => item.accountId === accountId && item.type === 'video' && (!item.thumbUrl || sharesStableId(item, cover)));
    const match = videos.find((item) => sharesStableId(item, cover)) ?? (videos.length === 1 ? videos[0] : undefined); if (!match) return null;
    const merged = mergeResource(match, { ...match, thumbUrl: cover.url, width: match.width ?? cover.width, height: match.height ?? cover.height, capturedAt: match.capturedAt });
    this.resources.set(match.id, merged); return merged;
  }
  private applyPendingCover(video: MediaResource): MediaResource {
    const pending = this.pendingCovers.get(video.accountId) ?? []; if (!pending.length) return video;
    const index = pending.findIndex((cover) => sharesStableId(video, cover)); const selected = index >= 0 ? pending[index] : pending.length === 1 ? pending[0] : undefined; if (!selected) return video;
    this.pendingCovers.set(video.accountId, pending.filter((item) => item !== selected));
    return { ...video, thumbUrl: video.thumbUrl || selected.url, width: video.width ?? selected.width, height: video.height ?? selected.height };
  }
}

type FfmpegCandidate = { path: string; packaged: boolean };
type FfmpegProbe = FfmpegCandidate & { version: string };

function previewKey(resource: MediaResource): string {
  return createHash('sha256').update(JSON.stringify({ accountId: resource.accountId, url: resource.url, backupUrl: resource.backupUrl ?? '', alternateUrls: resource.alternateUrls ?? [] })).digest('hex');
}

function previewOutputPath(resource: MediaResource): string {
  return join(tmpdir(), 'ai-creation-workbench', 'preview-cache', `${previewKey(resource)}.mp4`);
}

function sourceExtension(resource: MediaResource): string {
  if (resource.url.startsWith('http')) {
    try {
      const extension = extname(new URL(resource.url).pathname).toLowerCase();
      if (/^\.(?:mp4|webm|mov|m4v|mkv|avi|flv|ts)$/.test(extension)) return extension;
    } catch { /* use the safe video fallback */ }
  }
  return '.mp4';
}

function ffmpegCandidates(configuredPath = ''): FfmpegCandidate[] {
  const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const key = `${process.platform}-${process.arch}`;
  const candidates: FfmpegCandidate[] = [];
  const add = (path: string, packaged: boolean): void => {
    const value = path.trim();
    if (!value || candidates.some((item) => item.path.toLowerCase() === value.toLowerCase())) return;
    candidates.push({ path: value, packaged });
  };
  add(configuredPath, false);
  if (process.resourcesPath) add(join(process.resourcesPath, 'media-tools', key, executable), true);
  add(join(process.cwd(), 'media-tools', key, executable), false);
  add(executable, false);
  return candidates;
}

async function probeFfmpeg(candidate: FfmpegCandidate): Promise<FfmpegProbe | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: FfmpegProbe | null): void => { if (!settled) { settled = true; resolve(value); } };
    execFile(candidate.path, ['-version'], { windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024 }, (error, stdout) => {
      if (error) return finish(null);
      const version = String(stdout).split(/\r?\n/, 1)[0]?.trim() || 'FFmpeg';
      finish({ ...candidate, version });
    }).on('error', () => finish(null));
  });
}

async function findFfmpeg(configuredPath = ''): Promise<FfmpegProbe | null> {
  for (const candidate of ffmpegCandidates(configuredPath)) {
    const found = await probeFfmpeg(candidate);
    if (found) return found;
  }
  return null;
}

function runFfmpeg(ffmpegPath: string, source: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', '-f', 'mp4', output], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-16_000); });
    let settled = false;
    const finish = (error?: Error): void => { if (settled) return; settled = true; error ? reject(error) : resolve(); };
    child.once('error', (error) => finish(error));
    child.once('close', (code) => finish(code === 0 ? undefined : new Error(stderr.trim() || `FFmpeg 转换失败（退出码 ${code ?? 'unknown'}）`)));
  });
}

function normalizeDate(value: unknown): string | undefined { if (!value) return undefined; const date = new Date(typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : String(value)); return Number.isNaN(date.valueOf()) ? undefined : date.toISOString(); }
function cleanRecord(value: Record<string, unknown>): Record<string, unknown> {
  const result = { ...value };
  const primary = result.url == null || String(result.url).trim() === '' ? result.no_watermark_url : result.url;
  result.url = primary == null ? '' : normalizeCapturedUrl(primary);
  for (const key of ['backupUrl', 'thumbUrl']) {
    if (result[key] != null) result[key] = normalizeCapturedUrl(result[key]) || undefined;
  }
  for (const key of ['messageId', 'conversationId', 'shareId', 'shareUrl', 'threadUrl', 'vid', 'keySeed', 'fplayUrl', 'dolaRecordKey', 'dolaCardId', 'dolaVideoElementId', 'backupUrl', 'thumbUrl']) if (result[key] != null) result[key] = String(result[key]).trim() || undefined;
  if (Array.isArray(result.alternateUrls)) result.alternateUrls = uniqueResourceUrls(result.alternateUrls);
  return result;
}

function uniqueResourceUrls(values: unknown[]): string[] {
  return [...new Set(values.map((value) => normalizeCapturedUrl(value)).filter(Boolean))].slice(0, 8);
}

function hasPendingMediaLocator(value: Record<string, unknown>): boolean {
  return ['messageId', 'conversationId', 'shareId', 'shareUrl', 'threadUrl', 'vid', 'keySeed', 'fplayUrl', 'dolaRecordKey', 'dolaCardId', 'dolaVideoElementId']
    .some((key) => Boolean(String(value[key] ?? '').trim()));
}

const blockedAsset = /(?:logo|icon|favicon|sprite|avatar|placeholder|loading|empty|default|intro|banner|background|toolbar|button|static|\.css|\.js|\.map)(?:[._\/-]|[?#]|$)/i;
const vectorAsset = /\.(?:svg|ico)(?:[?#]|$)/i;
const trustedVectorSource = /^(?:site-download|cdp:|(?:doubao|dola|qianwen|yunque|jimeng):)/i;
const originalSignal = /(?:rc_gen_image|image[_-]?(?:ori|raw)|raw_image|no[_-]?watermark|origin|original|tplv-|tos-|byteimg|ibyteimg|imagex|ck-image)/i;
const coverSignal = /(?:cover|poster|thumb|preview|downsize|vodimg)/i;
const imageExtension = /\.(?:apng|png|jpe?g|jfif|webp|gif|bmp|dib|tif|tiff|avif|heic|heif|svg|ico|jxl)(?:[?#]|$)/i;
const videoExtension = /\.(?:mp4|webm|mov|m4v|mkv|avi|flv|ts|m2ts|mts|mpeg|mpg|3gp|3g2|ogv)(?:[?#]|$)/i;
const apiImageSignal = /(?:generated?|generation|output|result|original|origin|raw|image|img|media|download|aigc|render|asset)/i;
const performanceImageSignal = /(?:generated?|generation|creation|result|output|origin|raw|image|img|media|aigc|render|asset)/i;

function isBlockedResource(resource: MediaResource, text: string): boolean {
  if (blockedAsset.test(text)) return true;
  return vectorAsset.test(text) && !trustedVectorSource.test(resource.source);
}

function shouldKeepResource(resource: MediaResource, platform: PlatformId): boolean {
  const text = `${resource.url} ${resource.thumbUrl ?? ''} ${resource.source} ${resource.title}`.toLowerCase();
  if (!resource.url) return platform === 'dola' && resource.type === 'video' && hasPendingMediaLocator(resource);
  if (isBlockedResource(resource, text)) return false;
  const width = resource.width ?? 0; const height = resource.height ?? 0; const source = resource.source.toLowerCase();
  if (resource.type === 'video') {
    if (source === 'site-download') return true;
    if (platform === 'doubao') {
      // The legacy Doubao extensions resolve a message/video id through the
      // platform play-info/download endpoint and report the resulting URL as
      // `doubao_download_info` or `maowang_bridge`. These are authoritative
      // platform responses, not arbitrary DOM video elements.
      if (source === 'doubao-creation-resource-panel') return true;
      if (/^(?:doubao[_-](?:download|play|original)|maowang[_-](?:bridge|doubao))/.test(source)) {
        return Boolean(resource.confirmedNoWatermark || resource.qualityEvidence === 'platform-api' || resource.qualityEvidence === 'server-original');
      }
      if (/^cdp:doubao(?::|$)/.test(source)) {
        return resource.qualityEvidence === 'platform-api' || Boolean(resource.confirmedNoWatermark);
      }
      return false;
    }
    if ((width && width < 240) || (height && height < 160)) return false;
    return videoExtension.test(resource.url) || /(?:video|play|stream|vod|fplay|blob:)/i.test(text);
  }
  if (source === 'site-download') return true;
  if ((width && width < 240) || (height && height < 180)) return false;
  const likelyApiImage = isLikelyApiImage(resource, text);
  if (platform === 'doubao') return !/generic-dom|dom-fallback/.test(source) && (originalSignal.test(text) || (width >= 512 && height >= 512));
  if (platform === 'qianwen') return (source.startsWith('cdp:qianwen:') && resource.qualityEvidence === 'platform-api') || width >= 512 && height >= 512 || likelyApiImage;
  if (platform === 'dola') {
    if (coverSignal.test(text) && /video|播放|生成视频|原视频/.test(text)) return false;
    return width >= 512 && height >= 512 && width * height >= 490_000;
  }
  if (source === 'generic-performance-image') {
    // The page-side performance fallback has already required an `img`/`image`
    // initiator and passed the generic URL filter. Keep extensionless CDN
    // results only when their URL still carries a generated-media signal.
    return imageExtension.test(resource.url) || performanceImageSignal.test(resource.url);
  }
  // 云雀的原始资源接口经常只返回 URL，不返回宽高。来源已经由
  // parseYunquePayload 标记为 platform API/server original，因此不能按
  // 普通 DOM 图片的尺寸规则丢弃。
  if (platform === 'yunque' && /^yunque:/.test(source)) return true;
  if (platform === 'jimeng') return originalSignal.test(text) || (width >= 480 && height >= 480) || likelyApiImage;
  return width >= 512 && height >= 512 || likelyApiImage;
}

function isLikelyApiImage(resource: MediaResource, text: string): boolean {
  const source = resource.source.toLowerCase();
  const exposedByApi = source.startsWith('cdp:') || /(?:api|network|response|payload|site-download)/i.test(source);
  if (!exposedByApi || isBlockedResource(resource, text)) return false;
  // API/download responses frequently omit width and height. Accept only a
  // recognisable image URL or generated-media field, never an arbitrary DOM
  // image, so avatars and UI chrome do not flood the resource panel.
  return imageExtension.test(resource.url) || apiImageSignal.test(text);
}

function isPotentialVideoCover(resource: MediaResource, platform: PlatformId): boolean {
  if (resource.type !== 'image' || !['doubao', 'dola'].includes(platform)) return false;
  const text = `${resource.url} ${resource.source} ${resource.title}`.toLowerCase();
  return coverSignal.test(text) && /video|vod|播放|生成视频|原视频|fplay/.test(text);
}

function stableIds(resource: Partial<MediaResource>): string[] {
  return [resource.dolaRecordKey, resource.dolaCardId, resource.dolaVideoElementId, resource.messageId, resource.vid, resource.keySeed, resource.fplayUrl].filter((item): item is string => Boolean(item));
}
function sharesStableId(a: Partial<MediaResource>, b: Partial<MediaResource>): boolean { const ids = new Set(stableIds(a)); return stableIds(b).some((id) => ids.has(id)); }
function semanticIdentity(value: Record<string, unknown>, url: string): string {
  for (const key of ['dolaRecordKey', 'dolaCardId', 'dolaVideoElementId', 'messageId', 'vid', 'keySeed', 'fplayUrl']) if (value[key]) return `${key}:${String(value[key])}`;
  return resourceIdentity(url, String(value.type) === 'image');
}
function isSameResource(a: MediaResource, b: MediaResource): boolean {
  if (a.type !== b.type || a.accountId !== b.accountId) return false;
  if (sharesStableId(a, b)) return true;
  return resourceIdentity(a.url, a.type === 'image') === resourceIdentity(b.url, b.type === 'image');
}
function mergeResource(current: MediaResource, incoming: MediaResource): MediaResource {
  const currentArea = (current.width ?? 0) * (current.height ?? 0); const incomingArea = (incoming.width ?? 0) * (incoming.height ?? 0);
  const preferIncoming = Boolean(incoming.url) && !current.url || incoming.confirmedNoWatermark && !current.confirmedNoWatermark || incomingArea > currentArea || resourceIdentity(current.url) === resourceIdentity(incoming.url);
  const primary = preferIncoming ? incoming : current; const alternate = preferIncoming ? current : incoming;
  const evidenceRank: Record<NonNullable<MediaResource['qualityEvidence']>, number> = { unknown: 0, 'dom-direct': 1, 'decoded-token': 2, 'platform-api': 3, 'server-original': 4 };
  const currentEvidence = current.qualityEvidence ?? 'unknown'; const incomingEvidence = incoming.qualityEvidence ?? 'unknown'; const qualityEvidence = evidenceRank[incomingEvidence] >= evidenceRank[currentEvidence] ? incomingEvidence : currentEvidence;
  const url = primary.url || alternate.url;
  const backupUrl = primary.backupUrl || (alternate.url !== url ? alternate.url : alternate.backupUrl);
  const alternateUrls = uniqueResourceUrls([
    ...(current.alternateUrls ?? []), ...(incoming.alternateUrls ?? []),
    current.url, current.backupUrl, incoming.url, incoming.backupUrl,
  ]).filter((candidate) => candidate !== url && candidate !== backupUrl).slice(0, 8);
  return { ...current, ...incoming, id: current.id, url, backupUrl, alternateUrls, thumbUrl: incoming.thumbUrl || current.thumbUrl || (current.type === 'image' ? primary.url : undefined), messageId: incoming.messageId || current.messageId, conversationId: incoming.conversationId || current.conversationId, shareId: incoming.shareId || current.shareId, shareUrl: incoming.shareUrl || current.shareUrl, threadUrl: incoming.threadUrl || current.threadUrl, vid: incoming.vid || current.vid, keySeed: incoming.keySeed || current.keySeed, fplayUrl: incoming.fplayUrl || current.fplayUrl, dolaRecordKey: incoming.dolaRecordKey || current.dolaRecordKey, dolaCardId: incoming.dolaCardId || current.dolaCardId, dolaVideoElementId: incoming.dolaVideoElementId || current.dolaVideoElementId, width: primary.width ?? alternate.width, height: primary.height ?? alternate.height, capturedAt: current.capturedAt, confirmedNoWatermark: Boolean(current.confirmedNoWatermark || incoming.confirmedNoWatermark), qualityEvidence, resolutionMethod: qualityEvidence === incomingEvidence ? incoming.resolutionMethod ?? current.resolutionMethod : current.resolutionMethod ?? incoming.resolutionMethod, rejectedCandidates: [...new Set([...(current.rejectedCandidates ?? []), ...(incoming.rejectedCandidates ?? [])])].slice(0, 100) };
}
function resourceIdentity(value: string, image = false): string {
  const normalized = normalizeCapturedUrl(value) || value;
  if (!normalized.startsWith('http')) return normalized;
  try {
    const url = new URL(normalized); for (const key of [...url.searchParams.keys()]) if (/^(?:x-?expires|expires?|signature|sig|token|auth_key|image_size|width|height|w|h)$/i.test(key)) url.searchParams.delete(key);
    if (image) url.pathname = url.pathname.replace(/\/(?:origin|original|large|small|thumb|preview|watermark|downsize)\//ig, '/').replace(/[_-]?(?:\d+x\d+|720p|1080p|144p|preview|thumb|cover|watermark|no[_-]?watermark)/ig, '');
    return url.href;
  } catch { return value; }
}

export function detectMediaExtension(contentType: string, bytes: Uint8Array | undefined, type: MediaResource['type'], url = ''): string | undefined {
  // For images the file header is the strongest signal, matching the V4.4
  // downloader and avoiding a misleading URL suffix on extensionless CDNs.
  const signature = mediaExtensionFromSignature(bytes);
  if (type === 'image' && signature && mediaTypeFromExtension(signature) === 'image') return signature;
  const mimeExtension = extensionFromMimeType(contentType);
  if (mimeExtension && mediaTypeFromExtension(mimeExtension) === type) return mimeExtension;
  const urlExtension = canonicalMediaExtension(url);
  if (urlExtension && mediaTypeFromExtension(urlExtension) === type) return urlExtension;
  if (type === 'video' && signature && mediaTypeFromExtension(signature) === 'video') return signature;
  // Keep the old resource-kind fallback for extensionless/opaque responses.
  return type === 'video' ? '.mp4' : '.jpg';
}

function isClearlyErrorPayload(contentType: string, bytes: Uint8Array): boolean {
  if (!/text\/html|application\/(?:json|problem\+json)/i.test(contentType)) return false;
  const prefix = Buffer.from(bytes).subarray(0, 256).toString('utf8').trimStart();
  return prefix.startsWith('<') || prefix.startsWith('{') || prefix.startsWith('[');
}
