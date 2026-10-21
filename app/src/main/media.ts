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
import { PreviewCache } from './preview-cache';
import { fetchAccountMedia, setMediaRequestCooldown } from './media-request';
import { MediaHttpError, retryDelay, shouldRetryDownload, waitForRetry } from './download-policy';
import { isDoubaoPlaybackStream, supersededDoubaoPlayback } from '../shared/media-quality';

type BlobResolver = (accountId: string, url: string) => Promise<Buffer>;
type ProgrammaticDownloadMarker = (accountId: string, url: string) => void;
type ResourceRefresher = (resource: MediaResource) => Promise<void>;

export function captureModeAccepts(mode: AppSettings['captureMode'], raw: unknown): boolean {
  if (mode === 'all') return true;
  return Boolean(raw && typeof raw === 'object' && (raw as { type?: unknown }).type === mode);
}

const PROGRESS_ONLY_KEYS: ReadonlySet<string> = new Set(['receivedBytes', 'totalBytes', 'progress', 'speedBytesPerSecond', 'remainingSeconds']);
const TASK_PERSIST_DELAY_MS = 3000;
const TASK_EMIT_DELAY_MS = 250;

export class MediaService {
  private resources = new Map<string, MediaResource>();
  private taskMap = new Map<string, DownloadTask>();
  private readonly aborters = new Map<string, AbortController>();
  private readonly pausedTasks = new Set<string>();
  private readonly progressUpdates = new Map<string, number>();
  private refresher: ResourceRefresher | null = null;
  private readonly refreshJobs = new Map<string, Promise<MediaResource>>();
  private readonly prepareJobs = new Map<string, Promise<MediaResource>>();
  private readonly coverJobs = new Map<string, Promise<void>>();
  private readonly cache: PreviewCache;
  private readonly previewTokens = new Map<string, string>();
  private readonly remotePreviewTokens = new Map<string, { accountId: string; url: string; resourceId?: string; thumbnail?: boolean }>();
  private readonly conversionJobs = new Map<string, Promise<PreviewConversionResult>>();
  private readonly blobPreviewJobs = new Map<string, Promise<MediaResource | null>>();
  private readonly blobPreviewPaths = new Set<string>();
  private running = 0;
  private readonly runningByAccount = new Map<string, number>();
  private readonly accountCooldowns = new Map<string, number>();
  private cooldownTimer?: ReturnType<typeof setTimeout>;
  private taskListener: ((tasks: DownloadTask[]) => void) | null = null;
  private taskPersistTimer: NodeJS.Timeout | null = null;
  private taskEmitTimer: NodeJS.Timeout | null = null;
  private resourceListener: ((resources: MediaResource[]) => void) | null = null;
  private readonly taskStore?: AtomicStore<DownloadTask[]>;
  private readonly pendingCovers = new Map<string, MediaResource[]>();
  private programmaticDownloadMarker: ProgrammaticDownloadMarker | null = null;
  constructor(private readonly accounts: AccountService, private readonly settings: SettingsService, private readonly resolveBlob?: BlobResolver, _indexFile?: string, tasksFile?: string, cacheRoot?: string) {
    this.cache = new PreviewCache(cacheRoot || join(tmpdir(), 'ai-creation-workbench', 'media-cache'));
    if (tasksFile) { this.taskStore = new AtomicStore(tasksFile, z.array(downloadTaskSchema), []); const restored = this.taskStore.read().map((task) => task.status === 'running' ? { ...task, status: 'failed' as const, error: '应用上次在下载过程中退出' } : task); this.taskMap = new Map(restored.map((item) => [item.id, item])); this.persistTasks(); }
    for (const task of this.taskMap.values()) {
      const until = Date.parse(task.retryAfter ?? '');
      if (until > Date.now()) {
        this.accountCooldowns.set(task.accountId, Math.max(this.accountCooldowns.get(task.accountId) ?? 0, until));
        setMediaRequestCooldown(session.fromPartition(`persist:account_${task.accountId}`), until);
      }
    }
  }

  setProgrammaticDownloadMarker(marker: ProgrammaticDownloadMarker | null): void {
    this.programmaticDownloadMarker = marker;
  }

  setResourceRefresher(refresher: ResourceRefresher | null): void { this.refresher = refresher; }

  async refreshResource(resourceId: string): Promise<MediaResource> {
    const existing = this.refreshJobs.get(resourceId);
    if (existing) return existing;
    const job = this.refreshResourceNow(resourceId);
    this.refreshJobs.set(resourceId, job);
    try { return await job; } finally { this.refreshJobs.delete(resourceId); }
  }

  private async refreshResourceNow(resourceId: string): Promise<MediaResource> {
    const resource = this.resources.get(resourceId);
    if (!resource) throw new Error('素材不存在，请打开生成视频的对话重新捕获');
    if (!this.refresher) throw new Error('请打开生成视频的账号页面后重新解析');
    const previousVersion = this.resourceVersions.get(resourceId) ?? 0;
    await this.refresher(resource);
    for (let attempt = 0; attempt < 40; attempt++) {
      const updated = this.resources.get(resourceId);
      if (!updated) throw new Error('素材已清空');
      if ((this.resourceVersions.get(resourceId) ?? 0) > previousVersion && updated.url) return updated;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('未获取到新地址，请在对应账号打开原视频对话后重试');
  }

  private readonly resourceVersions = new Map<string, number>();

  onTasks(listener: (tasks: DownloadTask[]) => void): () => void {
    this.taskListener = listener;
    return () => { if (this.taskListener === listener) this.taskListener = null; };
  }
  onUpdated(listener: (resources: MediaResource[]) => void): () => void {
    this.resourceListener = listener;
    return () => { if (this.resourceListener === listener) this.resourceListener = null; };
  }
  private emitTasks(): void { if (this.taskEmitTimer) { clearTimeout(this.taskEmitTimer); this.taskEmitTimer = null; } this.taskListener?.(this.tasks()); }
  private emitResources(): void { this.resourceListener?.(this.list()); }
  private updateTask(id: string, patch: Partial<DownloadTask>): DownloadTask {
    const current = this.taskMap.get(id); if (!current) throw new Error('下载任务不存在');
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() }; this.taskMap.set(id, next);
    // Byte counters change several times per second for every running task.
    // Keep them in memory and coalesce the disk write and the renderer
    // broadcast; status, phase, path and error changes are still immediate.
    if (Object.keys(patch).every((key) => PROGRESS_ONLY_KEYS.has(key))) { this.schedulePersistTasks(); this.scheduleEmitTasks(); } else { this.persistTasks(); this.emitTasks(); }
    return next;
  }
  private schedulePersistTasks(): void {
    if (this.taskPersistTimer) return;
    this.taskPersistTimer = setTimeout(() => { this.taskPersistTimer = null; this.persistTasks(); }, TASK_PERSIST_DELAY_MS);
    this.taskPersistTimer.unref?.();
  }
  private scheduleEmitTasks(): void {
    if (this.taskEmitTimer) return;
    this.taskEmitTimer = setTimeout(() => { this.taskEmitTimer = null; this.emitTasks(); }, TASK_EMIT_DELAY_MS);
    this.taskEmitTimer.unref?.();
  }
  /** Writes progress that is still waiting for the coalesced task store write. */
  flush(): void { if (this.taskPersistTimer) this.persistTasks(); }

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
    if (account.platform === 'doubao' && isLowResolutionDoubaoPreview(candidate)) return null;
    if (account.platform === 'doubao' && candidate.type === 'video' && isDoubaoPlaybackStream(candidate.url) && candidate.source !== 'doubao-video-fallback-api') {
      candidate = { ...candidate, confirmedNoWatermark: false, qualityEvidence: 'platform-api', resolutionMethod: 'doubao-playback-stream' };
    }
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
      let merged = mergeResource(duplicate, candidate);
      if (merged.url !== duplicate.url || merged.thumbUrl !== duplicate.thumbUrl) merged = { ...merged, previewUrl: undefined, previewThumbUrl: undefined, previewStatus: 'idle', previewError: undefined, previewCached: false };
      this.resourceVersions.set(duplicate.id, (this.resourceVersions.get(duplicate.id) ?? 0) + 1);
      this.resources.set(duplicate.id, merged); this.emitResources(); return merged;
    }
    this.resources.set(candidate.id, candidate); this.emitResources(); return candidate;
  }
  list(): MediaResource[] {
    const visible: MediaResource[] = [];
    const platformsByAccount = new Map(this.accounts.list().map(account => [account.id, account.platform]));
    const completedIds = new Set([...this.taskMap.values()].filter(task => task.status === 'completed').map(task => task.resourceId));
    for (const resource of this.resources.values()) {
      if (platformsByAccount.get(resource.accountId) === 'doubao' && isLowResolutionDoubaoPreview(resource)) continue;
      const index = visible.findIndex(item => isSameResource(item, resource));
      if (index < 0) visible.push(resource);
      else visible[index] = completedIds.has(resource.id) ? mergeResource(resource, visible[index]!) : mergeResource(visible[index]!, resource);
    }
    return visible.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  }
  clear(): void {
    this.resources.clear(); this.pendingCovers.clear();
    this.resourceVersions.clear();
    this.remotePreviewTokens.clear();
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
      confirmedNoWatermark: isDoubaoPlaybackStream(selected) ? false : resource.confirmedNoWatermark,
      backupUrl: remaining[0] || undefined,
      alternateUrls: remaining.length > 1 ? remaining.slice(1, 9) : undefined,
      // A materialized Blob preview belongs to the previous primary URL.
      previewUrl: undefined,
      previewThumbUrl: undefined,
      previewStatus: 'idle', previewError: undefined, previewCached: false
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
    if (!resource) return null;
    const previewUrl = resource.previewUrl || (resource.url.startsWith('blob:') ? await this.writeBlobPreview(resource, resource.url, false) : this.remotePreviewUrl(resource.accountId, resource.url, resource.id));
    const previewThumbUrl = resource.previewThumbUrl || (resource.thumbUrl?.startsWith('blob:') ? await this.writeBlobPreview(resource, resource.thumbUrl, true) : this.remotePreviewUrl(resource.accountId, resource.thumbUrl, resource.id, true));
    if (!previewUrl && !previewThumbUrl) return resource;
    const current = this.resources.get(resourceId);
    if (!current) return null;
    const updated = { ...current, previewUrl: previewUrl ?? current.previewUrl, previewThumbUrl: previewThumbUrl ?? current.previewThumbUrl };
    this.resources.set(resourceId, updated);
    this.emitResources();
    return updated;
  }

  async preparePreview(resourceId: string): Promise<MediaResource> {
    const existing = this.prepareJobs.get(resourceId);
    if (existing) return existing;
    const job = this.preparePreviewNow(resourceId);
    this.prepareJobs.set(resourceId, job);
    try { return await job; } finally { this.prepareJobs.delete(resourceId); }
  }

  private patchResource(id: string, patch: Partial<MediaResource>): MediaResource | null {
    const resource = this.resources.get(id);
    if (!resource) return null;
    const updated = { ...resource, ...patch };
    this.resources.set(id, updated); this.emitResources(); return updated;
  }

  private async preparePreviewNow(resourceId: string): Promise<MediaResource> {
    let resource = this.resources.get(resourceId);
    if (!resource) throw new Error('素材不存在');
    this.patchResource(resourceId, { previewStatus: 'loading', previewError: undefined });
    try {
      const completed = this.tasks().find((task) => task.resourceId === resourceId && task.status === 'completed' && !supersededDoubaoPlayback(task.resumeUrl, resource!.url) && task.path && existsSync(task.path));
      let path = completed?.path;
      if (!path && resource.expiresAt && Date.parse(resource.expiresAt) < Date.now()) resource = await this.refreshResource(resourceId);
      if (!path && resource.url.startsWith('blob:')) {
        const updated = await this.materializeBlobPreview(resourceId);
        path = updated?.previewUrl ? this.previewPath(updated.previewUrl) ?? undefined : undefined;
      }
      if (!path) {
        path = this.cache.path(resource.accountId, resource.url, detectMediaExtension('', undefined, resource.type, resource.url) || (resource.type === 'video' ? '.mp4' : '.png'));
        if (!existsSync(path)) {
          let refreshed = false;
          while (true) {
            try { await this.cacheResource(resource, path); break; }
            catch (error) {
              if (refreshed || !this.refresher || !isRefreshableMediaError(error)) throw error;
              resource = await this.refreshResource(resourceId); refreshed = true;
              path = this.cache.path(resource.accountId, resource.url, detectMediaExtension('', undefined, resource.type, resource.url) || (resource.type === 'video' ? '.mp4' : '.png'));
            }
          }
        }
      }
      const previewUrl = this.registerPreviewPath(path);
      let previewThumbUrl = resource.previewThumbUrl;
      if (resource.type === 'video') previewThumbUrl = await this.createThumbnail(resource, path) || previewThumbUrl;
      const current = this.resources.get(resourceId);
      if (!current) throw new Error('素材已清空');
      // A candidate may have changed while its old URL was being fetched.
      if (current.url !== resource.url) return current;
      return this.patchResource(resourceId, { previewUrl, previewThumbUrl, previewStatus: 'ready', previewCached: true, previewError: undefined })!;
    } catch (error) {
      const message = mediaErrorMessage(error);
      this.patchResource(resourceId, { previewStatus: 'failed', previewError: message });
      throw new Error(message);
    }
  }

  private async cacheResource(resource: MediaResource, path: string): Promise<void> {
    const account = this.accounts.list().find((item) => item.id === resource.accountId);
    if (!account) throw new Error('账号不存在');
    const referer = account.customUrl || platforms[account.platform].url;
    let lastError: unknown;
    for (const url of uniqueResourceUrls([resource.url, resource.backupUrl, ...(resource.alternateUrls ?? [])])) {
      try {
        if (url.startsWith('blob:')) {
          if (!this.resolveBlob) throw new Error('Blob 解析不可用');
          const bytes = await this.resolveBlob(account.id, url);
          if (!bytes.length) throw new Error('预览数据为空');
          writeFileSync(path, bytes); return;
        }
        const response = await fetchAccountMedia(session.fromPartition(`persist:account_${account.id}`), url, { headers: { Referer: referer, Origin: new URL(referer).origin }, signal: AbortSignal.timeout(45_000) });
        await this.cache.write(response, path); return;
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('预览资源不可用');
  }

  private thumbnailQueue: Promise<void> = Promise.resolve();
  private async createThumbnail(resource: MediaResource, source: string): Promise<string | undefined> {
    const job = this.thumbnailQueue.then(() => this.createThumbnailNow(resource, source));
    this.thumbnailQueue = job.then(() => undefined, () => undefined);
    return job;
  }

  private async createThumbnailNow(resource: MediaResource, source: string): Promise<string | undefined> {
    const target = this.cache.path(resource.accountId, `cover:${resource.url}`, '.jpg');
    if (existsSync(target)) return this.registerPreviewPath(target);
    const found = await findFfmpeg(this.settings.get().ffmpegPath);
    if (!found) return undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(found.path, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-frames:v', '1', '-vf', 'scale=640:-2', target], { windowsHide: true, timeout: 15_000 }, (error) => error ? reject(error) : resolve());
      });
      this.cache.trim(target);
      return existsSync(target) ? this.registerPreviewPath(target) : undefined;
    } catch { if (existsSync(target)) rmSync(target, { force: true }); return undefined; }
  }

  private async useDownloadedPreview(resource: MediaResource, path: string): Promise<void> {
    this.patchResource(resource.id, { previewUrl: this.registerPreviewPath(path), previewStatus: 'ready', previewCached: true, previewError: undefined });
    if (resource.type === 'video') {
      const previewThumbUrl = await this.createThumbnail(resource, path);
      if (previewThumbUrl) this.patchResource(resource.id, { previewThumbUrl });
    }
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
    const local = resource.previewUrl ? this.previewPath(resource.previewUrl) : null;
    const source = local || join(root, `${previewKey(resource)}.source${sourceExtension(resource)}`);
    const temporaryOutput = `${output}.part`;
    try {
      if (!local) await this.writeConversionSource(resource, source);
      await runFfmpeg(found.path, source, temporaryOutput);
      if (!existsSync(temporaryOutput)) throw new Error('FFmpeg 未生成预览文件');
      if (existsSync(output)) rmSync(output, { force: true });
      renameSync(temporaryOutput, output);
      if (dirname(output) === this.cache.root) this.cache.trim(output);
      return { path: output, url: this.registerPreviewPath(output), cached: false, toolPath: found.path };
    } finally {
      if (!local && existsSync(source)) rmSync(source, { force: true });
      if (existsSync(temporaryOutput)) rmSync(temporaryOutput, { force: true });
    }
  }

  private registerPreviewPath(path: string): string {
    const token = createHash('sha256').update(path).digest('hex');
    this.previewTokens.set(token, path);
    return `workbench-media://preview/${token}`;
  }

  private remotePreviewUrl(accountId: string, url?: string, resourceId?: string, thumbnail = false): string | undefined {
    if (!url || !/^https?:\/\//i.test(url)) return undefined;
    const token = createHash('sha256').update(`${accountId}:${url}`).digest('hex');
    this.remotePreviewTokens.set(token, { accountId, url, resourceId, thumbnail });
    return `workbench-media://remote/${token}`;
  }

  async remotePreviewResponse(request: Request): Promise<Response | null> {
    const parsed = new URL(request.url);
    if (parsed.hostname !== 'remote') return null;
    const entry = this.remotePreviewTokens.get(parsed.pathname.slice(1));
    const account = entry && this.accounts.list().find((item) => item.id === entry.accountId);
    if (!entry || !account) return new Response('Not found', { status: 404 });
    const referer = account.customUrl || platforms[account.platform].url;
    const headers: Record<string, string> = { Referer: referer, Origin: new URL(referer).origin };
    const range = request.headers.get('range');
    if (range) headers.Range = range;
    try {
      if (entry.thumbnail) {
        const path = this.cache.path(entry.accountId, `poster:${entry.url}`, '.jpg');
        if (!existsSync(path)) {
          let job = this.coverJobs.get(path);
          if (!job) {
            job = (async () => {
              const response = await fetchAccountMedia(session.fromPartition(`persist:account_${account.id}`), entry.url, { headers, signal: AbortSignal.timeout(30_000) });
              await this.cache.write(response, path, 10 * 1024 * 1024);
            })();
            this.coverJobs.set(path, job);
          }
          try { await job; } finally { if (this.coverJobs.get(path) === job) this.coverJobs.delete(path); }
        }
        return new Response(await import('node:fs/promises').then((fs) => fs.readFile(path)), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400' } });
      }
      const resource = entry.resourceId ? this.resources.get(entry.resourceId) : undefined;
      const urls = uniqueResourceUrls([entry.url, resource?.url, resource?.backupUrl, ...(resource?.alternateUrls ?? [])]);
      for (const url of urls) {
        if (!/^https?:/i.test(url)) continue;
        try {
        const response = await fetchAccountMedia(session.fromPartition(`persist:account_${account.id}`), url, { headers, signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]) });
        if (response.status === 429) { await response.body?.cancel(); return new Response('站点限流，请稍后再预览', { status: 429, headers: { 'retry-after': response.headers.get('retry-after') || '60' } }); }
        if (!response.ok || /text\/|json|xml/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); continue; }
        // Only media headers cross into the renderer. Site cookies and CSP belong
        // to the account page and must not be applied to the workbench origin.
        const forwarded = new Headers();
        for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
          if (key === 'content-length' && response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') continue;
          const value = response.headers.get(key); if (value) forwarded.set(key, value);
        }
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: forwarded });
        } catch (error) {
          if (error instanceof MediaHttpError && error.status === 429) return new Response('站点限流，请稍后再预览', { status: 429 });
          if (request.signal.aborted) break;
          // A TLS/socket failure on one CDN must not skip the remaining captured URLs.
          continue;
        }
      }
      return new Response('素材地址不可用，请重新解析', { status: 502 });
    } catch {
      return new Response('视频或封面加载失败，请重新解析素材地址', { status: 502 });
    }
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
        const response = await fetchAccountMedia(session.fromPartition(`persist:account_${account.id}`), url, { headers: { Referer: referer, Origin: origin } });
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
    return this.cache.path(resource.accountId, `compatible:${resource.url}`, '.mp4');
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
        if (existsSync(join(folder, stem))) continue;
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

  enqueue(resourceId: string, options: { automatic?: boolean } = {}): DownloadTask {
    const resource = this.resources.get(resourceId); if (!resource) throw new Error('素材不存在');
    if (!resource.url) throw new Error('素材还没有可下载地址，请先解析 Dola 原始资源');
    const automatic = options.automatic === true;
    const existing = this.tasks().find((task) => task.resourceId === resourceId && (['queued', 'running'].includes(task.status) || (task.status === 'completed' && !supersededDoubaoPlayback(task.resumeUrl, resource.url) && Boolean(task.path && existsSync(task.path)))
      // An automatic capture must not mint a fresh row every time the page re-offers the same
      // resource. A page-side capture types a URL by guessing, so its failures are permanent -
      // the file it fetched is simply not media. Without this, every page load re-enqueued the
      // same three resources and each session added another identical failed row.
      // A manual enqueue is exempt: that is the user asking again, and gets a new attempt.
      || task.status === 'paused' || (automatic && task.status === 'failed')));
    if (existing) return existing;
    const now = new Date().toISOString(); const task: DownloadTask = { id: randomUUID(), resourceId, accountId: resource.accountId, title: resource.title || resource.type, status: 'queued', receivedBytes: 0, attempts: 0, createdAt: now, updatedAt: now, automatic: automatic || undefined };
    this.taskMap.set(task.id, task); this.persistTasks(); this.emitTasks(); void this.pump(); return task;
  }
  enqueueMany(resourceIds: string[]): DownloadTask[] { return [...new Set(resourceIds)].map((id) => this.enqueue(id)); }
  cancel(id: string): void {
    const task = this.taskMap.get(id); if (!task || !['queued', 'running', 'paused'].includes(task.status)) return;
    this.pausedTasks.delete(id); this.aborters.get(id)?.abort();
    if (task.status === 'paused' && !this.aborters.has(id) && task.path) {
      const partial = `${this.safePath(task.path)}.part`; if (existsSync(partial)) rmSync(partial, { force: true });
      this.reservedPaths.delete(task.path);
    }
    this.updateTask(id, { status: 'cancelled', error: undefined, speedBytesPerSecond: undefined, remainingSeconds: undefined });
  }
  pause(id: string): void {
    const task = this.taskMap.get(id); if (!task || !['queued', 'running'].includes(task.status)) return;
    this.pausedTasks.add(id);
    this.updateTask(id, { status: 'paused', speedBytesPerSecond: undefined, remainingSeconds: undefined });
    this.aborters.get(id)?.abort();
  }
  async resumeTask(id: string): Promise<DownloadTask> {
    const task = this.taskMap.get(id); if (!task || task.status !== 'paused') throw new Error('只有暂停的任务可以继续');
    // Wait for the previous writer to close before appending to the same file.
    for (let attempt = 0; this.aborters.has(id) && attempt < 100; attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    if (this.aborters.has(id)) throw new Error('任务仍在暂停，请稍后继续');
    this.pausedTasks.delete(id);
    if (task.path && !existsSync(`${this.safePath(task.path)}.part`)) this.reservedPaths.delete(task.path);
    const next = this.updateTask(id, { status: 'queued', error: undefined }); void this.pump(); return next;
  }
  retry(id: string): DownloadTask { const task = this.taskMap.get(id); if (!task) throw new Error('下载任务不存在'); if (!['failed', 'cancelled'].includes(task.status)) throw new Error('当前任务不能重试'); if (!this.resources.has(task.resourceId)) throw new Error('请先打开原视频对话重新捕获素材'); const next = this.updateTask(id, { status: 'queued', phase: 'waiting', error: undefined, receivedBytes: 0, totalBytes: undefined, progress: undefined, path: undefined, resumeUrl: undefined, resumeEtag: undefined, speedBytesPerSecond: undefined, remainingSeconds: undefined }); void this.pump(); return next; }
  /**
   * Drop every task that has stopped moving: failed and cancelled. Tasks are persisted, so
   * without this the queue only ever grows - a failure from three weeks ago still occupies a
   * row, and there is no completed download to match it against. Only the queue is cleared;
   * the resources themselves stay in the material list and can be downloaded again.
   */
  clearFailed(): void {
    const dropped = [...this.taskMap.values()].filter((task) => task.status === 'failed' || task.status === 'cancelled');
    if (!dropped.length) return;
    for (const task of dropped) this.taskMap.delete(task.id);
    this.persistTasks(); this.emitTasks();
  }

  private async pump(): Promise<void> {
    while (this.running < this.settings.get().downloadConcurrency) {
      const queued = this.tasks().reverse().filter((item) => item.status === 'queued');
      for (const item of queued) {
        const until = this.accountCooldowns.get(item.accountId) ?? 0;
        if (until > Date.now() && item.retryAfter !== new Date(until).toISOString()) this.updateTask(item.id, { retryAfter: new Date(until).toISOString(), error: '平台限流，按服务器要求等待后继续' });
      }
      const task = queued.find((item) => (this.runningByAccount.get(item.accountId) ?? 0) < 2 && (this.accountCooldowns.get(item.accountId) ?? 0) <= Date.now());
      if (!task) break;
      this.running++; this.runningByAccount.set(task.accountId, (this.runningByAccount.get(task.accountId) ?? 0) + 1);
      this.updateTask(task.id, { status: 'running', error: undefined, retryAfter: undefined });
      void this.run(task.id).finally(() => { this.running--; this.runningByAccount.set(task.accountId, Math.max(0, (this.runningByAccount.get(task.accountId) ?? 1) - 1)); void this.pump(); });
    }
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    const waitingUntil = this.tasks().filter((task) => task.status === 'queued').map((task) => this.accountCooldowns.get(task.accountId) ?? 0).filter((time) => time > Date.now());
    if (waitingUntil.length) {
      this.cooldownTimer = setTimeout(() => { this.cooldownTimer = undefined; void this.pump(); }, Math.min(2_147_483_647, Math.max(1, Math.min(...waitingUntil) - Date.now())));
      this.cooldownTimer.unref();
    }
  }
  resume(): void { void this.pump(); }
  private persistTasks(): void { if (this.taskPersistTimer) { clearTimeout(this.taskPersistTimer); this.taskPersistTimer = null; } this.taskStore?.write(this.tasks()); }
  private async run(id: string): Promise<void> {
    const task = this.taskMap.get(id)!; let resource = this.resources.get(task.resourceId); if (!resource) { this.updateTask(id, { status: 'failed', error: '请打开原视频对话重新捕获素材' }); return; }
    const controller = new AbortController(); this.aborters.set(id, controller); let file = ''; let partial = '';
    try {
      if (this.accounts.list().find((account) => account.id === resource!.accountId)?.platform === 'doubao' && isDoubaoPlaybackStream(resource.url) && resource.source !== 'doubao-video-fallback-api') {
        this.updateTask(id, { phase: 'resolving' });
        if (this.refresher) resource = await this.refreshResource(resource.id);
        if (isDoubaoPlaybackStream(resource.url) && resource.source !== 'doubao-video-fallback-api') throw new Error('当前地址是可能带水印的豆包播放流。请打开该作品页面，使用“豆包最新视频”解析站点原始下载地址后重试');
      }
      const resumable = task.path && task.resumeUrl && existsSync(`${task.path}.part`);
      file = resumable ? this.safePath(task.path!) : this.availablePath(resource); partial = `${file}.part`;
      this.reservedPaths.add(file); this.updateTask(id, { path: file, phase: 'downloading' });
      if (resource.expiresAt && Date.parse(resource.expiresAt) < Date.now() && this.refresher) {
        this.updateTask(id, { phase: 'resolving' }); resource = await this.refreshResource(resource.id);
      }
      const maxAttempts = this.settings.get().downloadRetryCount + 1; let lastError: unknown;
      const invalidCandidates = new Map<string, unknown>();
      let refreshed = false;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError'); this.updateTask(id, { attempts: attempt });
        try { this.updateTask(id, { phase: 'downloading' }); const detectedExtension = await this.downloadResource(resource, partial, id, controller.signal, invalidCandidates); if (detectedExtension && extname(file).toLowerCase() !== detectedExtension) { this.reservedPaths.delete(file); const correctedFile = this.availablePath(resource, detectedExtension); const correctedPartial = `${correctedFile}.part`; renameSync(partial, correctedPartial); file = correctedFile; partial = correctedPartial; } renameSync(partial, file); this.updateTask(id, { status: 'completed', phase: 'completed', path: file, progress: 100, speedBytesPerSecond: undefined, remainingSeconds: undefined }); void this.useDownloadedPreview(resource, file).catch(() => undefined); return; }
        catch (error) {
          lastError = error;
          if (!controller.signal.aborted && existsSync(partial)) rmSync(partial, { force: true });
          if (controller.signal.aborted) throw error;
          if (error instanceof MediaHttpError && error.status === 429) {
            const until = Math.max(this.accountCooldowns.get(resource.accountId) ?? 0, error.retryAt!);
            this.accountCooldowns.set(resource.accountId, until);
            setMediaRequestCooldown(session.fromPartition(`persist:account_${resource.accountId}`), until);
            this.updateTask(id, { retryAfter: new Date(until).toISOString() });
            throw error;
          }
          if (!refreshed && this.refresher && isRefreshableMediaError(error)) {
            refreshed = true; this.updateTask(id, { phase: 'resolving' });
            try { resource = await this.refreshResource(resource.id); attempt--; continue; }
            catch { /* Retain the original download error and its actionable explanation. */ }
          }
          if (attempt === maxAttempts || !shouldRetryDownload(error)) throw error;
          this.updateTask(id, { phase: 'retrying' });
          await waitForRetry(retryDelay(error, attempt), controller.signal);
        }
      }
      throw lastError;
    } catch (error) {
      const paused = this.pausedTasks.has(id);
      if (!paused && existsSync(partial)) rmSync(partial, { force: true });
      if (paused) this.updateTask(id, { status: 'paused', speedBytesPerSecond: undefined, remainingSeconds: undefined });
      else if (controller.signal.aborted) this.updateTask(id, { status: 'cancelled' });
      else this.updateTask(id, { status: 'failed', error: mediaErrorMessage(error), speedBytesPerSecond: undefined, remainingSeconds: undefined });
    } finally { this.aborters.delete(id); this.progressUpdates.delete(id); if (!this.pausedTasks.has(id)) this.reservedPaths.delete(file); }
  }
  private async downloadResource(resource: MediaResource, partial: string, taskId: string, signal: AbortSignal, invalidCandidates = new Map<string, unknown>()): Promise<string | undefined> {
    const account = this.accounts.list().find((item) => item.id === resource.accountId);
    if (!account) throw new Error('账号不存在');
    const ses = session.fromPartition(`persist:account_${account.id}`);
    const referer = account.customUrl || platforms[account.platform].url;
    const origin = new URL(referer).origin;
    const resolvedUrls = new Set(resource.resolvedDownloadUrls ?? []);
    const urls = uniqueResourceUrls([resource.url, resource.backupUrl, ...(resource.alternateUrls ?? [])]).filter((url) => account.platform !== 'doubao' || !isDoubaoPlaybackStream(url) || resolvedUrls.has(url) || (resource.source === 'doubao-video-fallback-api' && url === resource.url));
    let lastError: unknown;
    const rejected: string[] = [];
    const rememberFailure = (url: string, error: unknown): void => {
      rejected.push(url);
      lastError = error;
      if (!signal.aborted) this.updateTask(taskId, { receivedBytes: 0, totalBytes: undefined, progress: undefined });
    };

    for (const url of urls) {
      if (signal.aborted) throw new DOMException('已取消', 'AbortError');
      if (invalidCandidates.has(url)) { lastError = invalidCandidates.get(url); continue; }
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
        const previous = this.taskMap.get(taskId)!;
        const offset = previous.resumeUrl === url && previous.resumeEtag && existsSync(partial) ? statSync(partial).size : 0;
        const headers: Record<string, string> = { Referer: referer, Origin: origin };
        if (offset) { headers.Range = `bytes=${offset}-`; headers['If-Range'] = previous.resumeEtag!; }
        const response = await fetchAccountMedia(ses, url, { signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]), headers });
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          const error = response.ok ? new Error('下载响应为空') : new MediaHttpError(response.status, response.headers.get('retry-after'));
          if (error instanceof MediaHttpError && (error.status === 429 || error.status === 503 && error.retryAt)) throw error;
          if (error instanceof MediaHttpError && error.status >= 400 && error.status < 500 && error.status !== 408) invalidCandidates.set(url, error);
          rememberFailure(url, error);
          continue;
        }

        const contentType = response.headers.get('content-type') ?? '';
        const append = offset > 0 && response.status === 206;
        if (append && (!response.headers.get('content-range')?.startsWith(`bytes ${offset}-`) || (response.headers.get('etag') && response.headers.get('etag') !== previous.resumeEtag))) { await response.body.cancel(); throw new Error('断点位置或资源版本改变，请重新下载'); }
        const start = append ? offset : 0;
        const encoded = response.headers.get('content-encoding');
        const length = encoded && encoded !== 'identity' ? undefined : Number(response.headers.get('content-length')) || undefined;
        const contentRange = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/);
        if (response.status === 206 && (!contentRange || Number(contentRange[1]) !== start)) {
          await response.body.cancel(); throw new Error('断点位置或资源版本改变，请重新下载');
        }
        const total = contentRange && contentRange[3] !== '*' ? Number(contentRange[3]) : length ? length + start : undefined;
        this.updateTask(taskId, { resumeUrl: url, resumeEtag: response.headers.get('etag') || undefined });
        const writer = createWriteStream(partial, { flags: append ? 'a' : 'w' });
        const reader = response.body.getReader();
        let writeError: Error | undefined;
        writer.on('error', (error) => { writeError = error; void reader.cancel(error).catch(() => undefined); });
        let received = start;
        const started = Date.now();
        let firstChunk: Uint8Array | undefined;
        let detectedExtension: string | undefined;
        try {
          const first = await reader.read();
          if (first.done) throw new Error('下载响应为空');
          firstChunk = first.value;
          if (isClearlyErrorPayload(contentType, firstChunk)) {
            const error = new Error(`下载响应不是媒体文件（${contentType || '未知类型'}）`);
            invalidCandidates.set(url, error); throw error;
          }
          detectedExtension = detectMediaExtension(contentType, firstChunk, resource.type, url);
          received += firstChunk.byteLength;
          if (!writer.write(Buffer.from(firstChunk))) await once(writer, 'drain');
          this.reportProgress(taskId, received, total, start, started);
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            if (signal.aborted) throw new DOMException('已取消', 'AbortError');
            received += chunk.value.byteLength;
            if (!writer.write(Buffer.from(chunk.value))) await once(writer, 'drain');
            this.reportProgress(taskId, received, total, start, started);
          }
          if (writeError) throw writeError;
          writer.end();
          await once(writer, 'finish');
          if (total && received !== total) throw new Error('视频下载不完整，请重试');
          this.reportProgress(taskId, received, total, start, started, true);
          this.rememberRejectedCandidates(resource, rejected);
          return detectedExtension ?? detectMediaExtension(contentType, firstChunk, resource.type, url);
        } catch (error) {
          try { await reader.cancel(); } catch { /* response may already be closed */ }
          if (this.pausedTasks.has(taskId) && !writer.destroyed) {
            // Flush already received bytes before preserving the partial file.
            // Destroying a writer here can discard its buffered first chunk.
            const flushed = once(writer, 'finish');
            writer.end();
            try { await flushed; } catch { /* handled by the original failure */ }
          }
          writer.destroy();
          await new Promise<void>((resolve) => { if (writer.closed) resolve(); else writer.once('close', resolve); });
          if (!this.pausedTasks.has(taskId) && existsSync(partial)) rmSync(partial, { force: true });
          if (signal.aborted) throw error;
          if (/ENOSPC|EACCES|EPERM|ENOENT/.test(error instanceof Error ? error.message : String(error))) throw error;
          rememberFailure(url, error);
        }
      } catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof MediaHttpError && (error.status === 429 || error.status === 503 && error.retryAt) || /ERR_CERT_|ERR_SSL_|ENOSPC|EACCES|EPERM|ENOENT/.test(error instanceof Error ? error.message : String(error))) throw error;
        if (!rejected.includes(url)) rememberFailure(url, error);
        if (existsSync(partial)) rmSync(partial, { force: true });
      }
    }

    this.rememberRejectedCandidates(resource, rejected);
    throw lastError instanceof Error ? lastError : new Error('下载响应为空');
  }

  private reportProgress(id: string, receivedBytes: number, totalBytes: number | undefined, start: number, started: number, force = false): void {
    const now = Date.now();
    if (!force && now - (this.progressUpdates.get(id) ?? 0) < 350) return;
    this.progressUpdates.set(id, now);
    const speedBytesPerSecond = Math.round((receivedBytes - start) / Math.max(0.1, (now - started) / 1000));
    this.updateTask(id, { receivedBytes, totalBytes, progress: totalBytes ? Math.min(99, Math.round(receivedBytes / totalBytes * 100)) : undefined, speedBytesPerSecond, remainingSeconds: totalBytes && speedBytesPerSecond ? Math.ceil((totalBytes - receivedBytes) / speedBytesPerSecond) : undefined });
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
    const match = videos.find((item) => sharesStableId(item, cover)); if (!match) return null;
    const merged = mergeResource(match, { ...match, thumbUrl: cover.url, width: match.width ?? cover.width, height: match.height ?? cover.height, capturedAt: match.capturedAt });
    this.resources.set(match.id, merged); return merged;
  }
  private applyPendingCover(video: MediaResource): MediaResource {
    const pending = this.pendingCovers.get(video.accountId) ?? []; if (!pending.length) return video;
    const index = pending.findIndex((cover) => sharesStableId(video, cover)); const selected = index >= 0 ? pending[index] : undefined; if (!selected) return video;
    this.pendingCovers.set(video.accountId, pending.filter((item) => item !== selected));
    return { ...video, thumbUrl: video.thumbUrl || selected.url, width: video.width ?? selected.width, height: video.height ?? selected.height };
  }
}

type FfmpegCandidate = { path: string; packaged: boolean };
type FfmpegProbe = FfmpegCandidate & { version: string };

function previewKey(resource: MediaResource): string {
  return createHash('sha256').update(JSON.stringify({ accountId: resource.accountId, url: resource.url, backupUrl: resource.backupUrl ?? '', alternateUrls: resource.alternateUrls ?? [] })).digest('hex');
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

export function mediaErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/HTTP (401|403|410)/.test(message)) return '视频地址已过期或需要登录，请打开原视频对话后重新解析';
  if (/HTTP 404/.test(message)) return '视频地址不存在，请重新解析或切换候选地址';
  if (/HTTP 429/.test(message)) return '站点请求过于频繁，请稍后重试或降低同时下载数';
  if (/ENOSPC/.test(message)) return '磁盘空间不足，请清理磁盘或更换下载目录';
  if (/EACCES|EPERM/.test(message)) return '下载目录不可写，请在设置中选择有写入权限的目录';
  if (/ENOENT/.test(message)) return '下载目录不存在或已移动，请在设置中重新选择目录';
  if (/TimeoutError|timed out|timeout/i.test(message)) return '请求超时，请检查账号代理或稍后重试';
  if (/ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET/.test(message)) return '媒体连接被关闭，请检查账号或系统代理后重试，也可切换候选地址';
  if (/ERR_CERT_|ERR_SSL_/.test(message)) return '媒体 HTTPS 安全连接失败，请检查系统时间、代理和证书配置';
  if (/ERR_|fetch failed/i.test(message)) return '网络连接失败，请检查账号代理后重试';
  return message.slice(0, 1000);
}

function isRefreshableMediaError(error: unknown): boolean {
  return /HTTP (401|403|404|410)|登录页|错误页面|不是媒体文件|地址已过期/i.test(error instanceof Error ? error.message : String(error));
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
  if (Array.isArray(result.resolvedDownloadUrls)) result.resolvedDownloadUrls = uniqueResourceUrls(result.resolvedDownloadUrls, 9);
  return result;
}

function uniqueResourceUrls(values: unknown[], limit = 8): string[] {
  return [...new Set(values.map((value) => normalizeCapturedUrl(value)).filter(Boolean))].slice(0, limit);
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
      if (source === 'doubao-video-fallback-api') return resource.resolutionMethod === 'fallback_api' && resource.qualityEvidence === 'platform-api';
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
  if (platform === 'doubao') {
    if (/generic-dom|generic-performance|dom-fallback/.test(source)) return false;
    // Do not promote hashed page illustrations just because they are large
    // or hosted on byteimg/imagex. Original creation fields and the dedicated
    // creation bridge supply provenance; generic payload fields do not.
    if (source.startsWith('cdp:')) return resource.resolutionMethod === 'image-ori-raw' && resource.qualityEvidence === 'server-original';
    if (resource.confirmedNoWatermark && (resource.qualityEvidence === 'server-original' || resource.qualityEvidence === 'platform-api')) return true;
    return /^(?:doubao-image-data|doubao-creation-resource-panel)$/.test(source) && (width >= 512 && height >= 512);
  }
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

function sharesStableId(a: Partial<MediaResource>, b: Partial<MediaResource>): boolean {
  if (a.vid && b.vid && a.vid !== b.vid) return false;
  // Encryption seeds are shared across assets; different locator fields are not interchangeable ids.
  return (['vid', 'messageId', 'dolaRecordKey', 'dolaCardId', 'dolaVideoElementId', 'fplayUrl'] as const).some(key => Boolean(a[key]) && a[key] === b[key]);
}
function semanticIdentity(value: Record<string, unknown>, url: string): string {
  for (const key of ['vid', 'dolaRecordKey', 'dolaCardId', 'dolaVideoElementId', 'messageId', 'fplayUrl']) if (value[key]) return `${key}:${String(value[key])}`;
  return resourceIdentity(url, String(value.type) === 'image');
}
function isSameResource(a: MediaResource, b: MediaResource): boolean {
  if (a.type !== b.type || a.accountId !== b.accountId) return false;
  if (a.vid && b.vid && a.vid !== b.vid) return false;
  if (sharesStableId(a, b)) return true;
  const asset = doubaoVideoAssetIdentity(a.url);
  if (a.type === 'video' && asset && asset === doubaoVideoAssetIdentity(b.url)) return true;
  return resourceIdentity(a.url, a.type === 'image') === resourceIdentity(b.url, b.type === 'image');
}
function isLowResolutionDoubaoPreview(resource: MediaResource): boolean {
  return resource.type === 'video' && !resource.confirmedNoWatermark && Boolean(resource.width && resource.height) && Math.max(resource.width!, resource.height!) < 720;
}
function doubaoVideoAssetIdentity(value: string): string {
  try {
    const url = new URL(value);
    if (!/^v\d+-(?:vdl|videoweb)\.doubao\.com$/i.test(url.hostname)) return '';
    const index = url.pathname.indexOf('/video/tos/');
    return index >= 0 ? url.pathname.slice(index).replace(/\/+$/, '') : '';
  } catch { return ''; }
}
function mergeResource(current: MediaResource, incoming: MediaResource): MediaResource {
  const currentArea = (current.width ?? 0) * (current.height ?? 0); const incomingArea = (incoming.width ?? 0) * (incoming.height ?? 0);
  // Fresh originals replace stale signed URLs across CDN hosts; passive playback does not.
  const resolvedOriginal = incoming.source === 'doubao-video-fallback-api' && incoming.resolvedDownloadUrls?.includes(incoming.url);
  const preferIncoming = Boolean(resolvedOriginal) || !(isDoubaoPlaybackStream(incoming.url) && current.confirmedNoWatermark) && (Boolean(incoming.url) && !current.url || incoming.confirmedNoWatermark && !current.confirmedNoWatermark || incomingArea > currentArea || resourceIdentity(current.url) === resourceIdentity(incoming.url));
  const primary = preferIncoming ? incoming : current; const alternate = preferIncoming ? current : incoming;
  incoming = { ...incoming, source: primary.source, resolutionMethod: primary.resolutionMethod };
  const resolvedDownloadUrls = uniqueResourceUrls([...(primary.resolvedDownloadUrls ?? []), ...(alternate.resolvedDownloadUrls ?? [])], 9);
  const evidenceRank: Record<NonNullable<MediaResource['qualityEvidence']>, number> = { unknown: 0, 'dom-direct': 1, 'decoded-token': 2, 'platform-api': 3, 'server-original': 4 };
  const currentEvidence = current.qualityEvidence ?? 'unknown'; const incomingEvidence = incoming.qualityEvidence ?? 'unknown'; const qualityEvidence = evidenceRank[incomingEvidence] >= evidenceRank[currentEvidence] ? incomingEvidence : currentEvidence;
  const url = primary.url || alternate.url;
  const backupUrl = primary.backupUrl || (alternate.url !== url ? alternate.url : alternate.backupUrl);
  const alternateUrls = uniqueResourceUrls([
    ...(current.alternateUrls ?? []), ...(incoming.alternateUrls ?? []),
    current.url, current.backupUrl, incoming.url, incoming.backupUrl,
  ]).filter((candidate) => candidate !== url && candidate !== backupUrl).slice(0, 8);
  return { ...current, ...incoming, id: current.id, url, backupUrl, alternateUrls, resolvedDownloadUrls, thumbUrl: incoming.thumbUrl || current.thumbUrl || (current.type === 'image' ? primary.url : undefined), messageId: incoming.messageId || current.messageId, conversationId: incoming.conversationId || current.conversationId, shareId: incoming.shareId || current.shareId, shareUrl: incoming.shareUrl || current.shareUrl, threadUrl: incoming.threadUrl || current.threadUrl, vid: incoming.vid || current.vid, keySeed: incoming.keySeed || current.keySeed, fplayUrl: incoming.fplayUrl || current.fplayUrl, dolaRecordKey: incoming.dolaRecordKey || current.dolaRecordKey, dolaCardId: incoming.dolaCardId || current.dolaCardId, dolaVideoElementId: incoming.dolaVideoElementId || current.dolaVideoElementId, width: primary.width ?? alternate.width, height: primary.height ?? alternate.height, capturedAt: current.capturedAt, confirmedNoWatermark: Boolean(current.confirmedNoWatermark || incoming.confirmedNoWatermark), qualityEvidence, resolutionMethod: qualityEvidence === incomingEvidence ? incoming.resolutionMethod ?? current.resolutionMethod : current.resolutionMethod ?? incoming.resolutionMethod, rejectedCandidates: [...new Set([...(current.rejectedCandidates ?? []), ...(incoming.rejectedCandidates ?? [])])].slice(0, 100) };
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
  const prefix = Buffer.from(bytes).subarray(0, 256).toString('utf8').trimStart();
  if (/^<(?:!doctype\s+html|html|head|body|\?xml|error)(?:\s|>|\/)/i.test(prefix)) return true;
  if (!/text\/html|application\/(?:json|problem\+json)/i.test(contentType)) return false;
  return prefix.startsWith('<') || prefix.startsWith('{') || prefix.startsWith('[');
}
