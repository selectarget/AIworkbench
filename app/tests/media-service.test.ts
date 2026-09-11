import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const fetchMock = vi.fn();
vi.mock('electron', () => ({ session: { fromPartition: () => ({ fetch: fetchMock }) }, shell: { openPath: vi.fn(), showItemInFolder: vi.fn() } }));
import { captureModeAccepts, MediaService } from '../src/main/media';
import type { MediaResource } from '../src/shared/contracts';

const dirs: string[] = [];
afterEach(() => { fetchMock.mockReset(); while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });
function setup(persist = false, platform = 'doubao', resolveBlob?: (accountId: string, url: string) => Promise<Buffer>, legacyVideoLayout?: boolean, videoFilenamePrefix = '', videoDownloadDir = '', legacyV44MediaFolders = false) { const dir = mkdtempSync(join(tmpdir(), 'workbench-media-')); dirs.push(dir); const accounts = { list: () => [{ id: 'account_1', name: '测试账号', platform, customUrl: '', proxy: {}, group: '', remark: '', createdAt: new Date().toISOString(), order: 0 }] } as any; const settings = { get: () => ({ downloadDir: dir, videoDownloadDir, useAccountDownloadSubfolders: false, downloadFolderPattern: 'account', downloadConcurrency: 1, downloadRetryCount: 0, videoFilenamePrefix, legacyV44MediaFolders, ...(legacyVideoLayout === undefined ? {} : { legacyVideoLayout }) }) } as any; const create = () => new MediaService(accounts, settings, resolveBlob, persist ? join(dir, 'index.json') : undefined, persist ? join(dir, 'tasks.json') : undefined); return { dir, service: create(), create } ; }
async function waitFor(predicate: () => boolean): Promise<void> { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error('timeout'); }

describe('media download queue', () => {
  it('matches V5.2 numbered downloads and skips occupied bare-number directories', async () => {
    const { dir, service } = setup(false, 'qianwen', undefined, undefined, '', '', true);
    mkdirSync(join(dir, 'Videos', '1'), { recursive: true });
    fetchMock.mockImplementation(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp4' } })));
    const item = service.add('account_1', { type: 'video', url: 'https://cdn.example.com/clip.mp4', source: 'qianwen-api', width: 1920, height: 1080 })!;
    const batch = service.enqueueMany([item.id, item.id]);
    expect(batch).toHaveLength(1);
    await waitFor(() => service.tasks()[0]?.status === 'completed');
    expect(service.tasks()[0]?.path).toBe(join(dir, 'Videos', '2.mp4'));
    expect(service.enqueue(item.id).id).toBe(batch[0]!.id);
  });
  const video = (url: string, extra = {}) => ({ type: 'video', url, title: '作品', source: 'doubao-creation-resource-panel', ...extra });
  const image = (url: string, extra = {}) => ({ type: 'image', url, title: '作品', source: 'doubao-image-data', width: 1024, height: 1024, ...extra });
  it('applies the capture mode before a resource enters the main-process feed', () => {
    expect(captureModeAccepts('all', image('https://cdn.example.com/a.png'))).toBe(true);
    expect(captureModeAccepts('image', image('https://cdn.example.com/a.png'))).toBe(true);
    expect(captureModeAccepts('image', video('https://cdn.example.com/a.mp4'))).toBe(false);
    expect(captureModeAccepts('video', video('https://cdn.example.com/a.mp4'))).toBe(true);
    expect(captureModeAccepts('video', image('https://cdn.example.com/a.png'))).toBe(false);
  });
  it('allows a window-bound task listener to be removed before the next window is created', async () => {
    const { service } = setup();
    fetchMock.mockImplementation(() => Promise.resolve(new Response(new Uint8Array([1]), { status: 200 })));
    const seen: number[] = [];
    const dispose = service.onTasks((tasks) => seen.push(tasks.length));
    const first = service.add('account_1', image('https://cdn.example.com/image_ori_raw/listener-1.png'))!;
    service.enqueue(first.id);
    await waitFor(() => service.tasks()[0]?.status === 'completed');
    expect(seen.length).toBeGreaterThan(0);
    dispose();
    const before = seen.length;
    const second = service.add('account_1', image('https://cdn.example.com/image_ori_raw/listener-2.png'))!;
    service.enqueue(second.id);
    await waitFor(() => service.tasks().filter((task) => task.status === 'completed').length === 2);
    expect(seen.length).toBe(before);
  });
  it('streams a download, reports completion and indexes the library', async () => { const { dir, service } = setup(); fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-length': '4' } })); service.add('account_1', video('https://cdn.example.com/a.mp4')); const task = service.enqueue(service.list()[0]!.id); await waitFor(() => service.tasks()[0]?.status === 'completed'); const done = service.tasks().find((item) => item.id === task.id)!; expect(done.progress).toBe(100); expect(readFileSync(done.path!)).toEqual(Buffer.from([1, 2, 3, 4])); expect(service.listFiles({ page: 1, pageSize: 10 }).total).toBe(1); expect(done.path!.startsWith(dir)).toBe(true); });
  it('marks each network candidate before a programmatic download fetch', async () => {
    const { service } = setup();
    const marker = vi.fn();
    service.setProgrammaticDownloadMarker(marker);
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'video/mp4' } }));
    const resource = service.add('account_1', video('https://cdn.example.com/marked.mp4'))!;
    service.enqueue(resource.id);
    await waitFor(() => service.tasks()[0]?.status === 'completed');
    expect(marker).toHaveBeenCalledWith('account_1', 'https://cdn.example.com/marked.mp4');
  });
  it('normalizes escaped URLs before de-duplication and download', async () => {
    const { service } = setup();
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } }));
    const encoded = String.raw`"https:\/\/cdn.example.com\/image_ori_raw\/encoded.png?x=1&amp;y=2\u0026z=3"`;
    const resource = service.add('account_1', image(encoded))!;
    expect(resource.url).toBe('https://cdn.example.com/image_ori_raw/encoded.png?x=1&y=2&z=3');
    const same = service.add('account_1', image('https://cdn.example.com/image_ori_raw/encoded.png?x=1&y=2&z=3'));
    expect(same?.id).toBe(resource.id);
    expect(service.list()).toHaveLength(1);
    service.enqueue(resource.id);
    await waitFor(() => service.tasks()[0]?.status === 'completed');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(resource.url);
  });
  it('keeps videos in the optional video root while ordinary resources stay in the general root', async () => { const videoDir = mkdtempSync(join(tmpdir(), 'workbench-video-root-')); dirs.push(videoDir); const { dir, service } = setup(false, 'dola', undefined, false, '', videoDir); fetchMock.mockImplementation((input: RequestInfo | URL) => { const isVideo = String(input).includes('dola.mp4'); return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': isVideo ? 'video/mp4' : 'image/png' } })); }); const videoResource = service.add('account_1', { type: 'video', url: 'https://cdn.example.com/dola.mp4', title: '视频作品', source: 'dola-api', width: 1920, height: 1080 })!; const imageResource = service.add('account_1', image('https://cdn.example.com/image.png'))!; service.enqueue(videoResource.id); service.enqueue(imageResource.id); await waitFor(() => service.tasks().filter((task) => task.status === 'completed').length === 2); const tasks = service.tasks(); const videoTask = tasks.find((task) => task.resourceId === videoResource.id)!; const imageTask = tasks.find((task) => task.resourceId === imageResource.id)!; expect(videoTask.path!.startsWith(videoDir)).toBe(true); expect(imageTask.path!.startsWith(dir)).toBe(true); expect(service.listFiles({ page: 1, pageSize: 10 }).total).toBe(2); });
  it.each([
    ['dola', 'Dola', 'dola-api'],
    ['doubao', '豆包', 'doubao-creation-resource-panel'],
  ] as const)('keeps the legacy numbered platform folder layout for %s videos', async (platform, folder, source) => { const { dir, service } = setup(false, platform); fetchMock.mockImplementation(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'video/mp4' } }))); const first = service.add('account_1', { type: 'video', url: `https://cdn.example.com/${platform}-1.mp4`, title: '第一条作品', source, width: 1920, height: 1080 })!; service.enqueue(first.id); await waitFor(() => service.tasks()[0]?.status === 'completed'); const second = service.add('account_1', { type: 'video', url: `https://cdn.example.com/${platform}-2.mp4`, title: '第二条作品', source, width: 1920, height: 1080 })!; service.enqueue(second.id); await waitFor(() => service.tasks().filter((item) => item.status === 'completed').length === 2); const paths = service.tasks().filter((item) => item.status === 'completed').map((item) => item.path!).sort(); expect(paths[0]).toBe(join(dir, folder, '1.mp4')); expect(paths[1]).toBe(join(dir, folder, '2.mp4')); });
  it('uses the normal folder and filename rules when the legacy video layout is disabled', async () => { const { dir, service } = setup(false, 'dola', undefined, false); fetchMock.mockImplementation(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'video/mp4' } }))); const resource = service.add('account_1', { type: 'video', url: 'https://cdn.example.com/dola-generic.mp4', title: '第一条作品', source: 'dola-api', width: 1920, height: 1080 })!; service.enqueue(resource.id); await waitFor(() => service.tasks()[0]?.status === 'completed'); expect(service.tasks()[0]!.path).toBe(join(dir, '第一条作品.mp4')); });
  it('restores the exact V4.4 Videos and Images folder layout when enabled', async () => { const { dir, service } = setup(false, 'doubao', undefined, false, '', '', true); fetchMock.mockImplementation((input: RequestInfo | URL) => { const isVideo = String(input).includes('video.mp4'); return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': isVideo ? 'video/mp4' : 'image/png' } })); }); const videoResource = service.add('account_1', { type: 'video', url: 'https://cdn.example.com/video.mp4', title: '视频作品', source: 'doubao-creation-resource-panel', width: 1920, height: 1080 })!; const imageResource = service.add('account_1', image('https://cdn.example.com/image.png', { title: '图片作品', source: 'doubao-image-data' }))!; service.enqueue(videoResource.id); service.enqueue(imageResource.id); await waitFor(() => service.tasks().filter((item) => item.status === 'completed').length === 2); const tasks = service.tasks(); const videoTask = tasks.find((item) => item.resourceId === videoResource.id)!; const imageTask = tasks.find((item) => item.resourceId === imageResource.id)!; expect(videoTask.path).toBe(join(dir, 'Videos', '1.mp4')); expect(imageTask.path).toContain(join(dir, 'Images')); expect(imageTask.path!.split(/[\\/]/).pop()).toMatch(/^图片_\d{8}_\d{6}_\d{3}\.png$/); });
  it('applies the configured prefix outside legacy numbered video layout', async () => { const { dir, service } = setup(false, 'dola', undefined, false, '项目A'); fetchMock.mockImplementation(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'video/mp4' } }))); const resource = service.add('account_1', { type: 'video', url: 'https://cdn.example.com/dola-generic.mp4', title: '第一条作品', source: 'dola-api', width: 1920, height: 1080 })!; service.enqueue(resource.id); await waitFor(() => service.tasks()[0]?.status === 'completed'); const path = service.tasks()[0]!.path!; expect(path).toMatch(/项目A_测试账号_\d{8}_\d{6}\.mp4$/); expect(path.startsWith(join(dir, '项目A_'))).toBe(true); });
  it('corrects the output extension from the media response type', async () => { const { service } = setup(); fetchMock.mockResolvedValue(new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { 'content-type': 'image/jpeg' } })); service.add('account_1', image('https://cdn.example.com/image_ori_raw/a.png')); service.enqueue(service.list()[0]!.id); await waitFor(() => service.tasks()[0]?.status === 'completed'); expect(service.tasks()[0]!.path).toMatch(/\.jpg$/i); });
  it('keeps the legacy TIFF and Matroska suffixes when the CDN omits a filename extension', async () => {
    const { service } = setup();
    fetchMock.mockImplementation((input: RequestInfo | URL) => String(input).includes('image-result')
      ? Promise.resolve(new Response(new Uint8Array([0x49, 0x49, 0x2a, 0x00]), { status: 200, headers: { 'content-type': 'image/tiff' } }))
      : Promise.resolve(new Response(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), { status: 200, headers: { 'content-type': 'video/x-matroska' } })));
    const imageResource = service.add('account_1', image('https://cdn.example.com/image-result'))!;
    const videoResource = service.add('account_1', video('https://cdn.example.com/video-result'))!;
    service.enqueue(imageResource.id); service.enqueue(videoResource.id);
    await waitFor(() => service.tasks().filter((task) => task.status === 'completed').length === 2);
    expect(service.tasks().find((task) => task.resourceId === imageResource.id)?.path).toMatch(/\.tiff$/i);
    expect(service.tasks().find((task) => task.resourceId === videoResource.id)?.path).toMatch(/\.mkv$/i);
  });
  it('rejects an HTML or JSON error page returned with HTTP 200', async () => { const { service } = setup(); fetchMock.mockResolvedValue(new Response('<html>expired</html>', { status: 200, headers: { 'content-type': 'text/html' } })); service.add('account_1', image('https://cdn.example.com/image_ori_raw/expired.png')); service.enqueue(service.list()[0]!.id); await waitFor(() => service.tasks()[0]?.status === 'failed'); expect(service.tasks()[0]!.error).toContain('不是媒体文件'); });
  it('suppresses duplicate active/completed downloads', async () => { const { service } = setup(); fetchMock.mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 })); service.add('account_1', image('https://cdn.example.com/image_ori_raw/a.png')); const resource = service.list()[0]!; const first = service.enqueue(resource.id); const second = service.enqueue(resource.id); expect(second.id).toBe(first.id); await waitFor(() => service.tasks()[0]?.status === 'completed'); });
  it('deduplicates refreshed signed URLs for the same media path', () => { const { service } = setup(); service.add('account_1', video('https://cdn.example.com/a.mp4?x-expires=100&signature=one')); service.add('account_1', video('https://cdn.example.com/a.mp4?x-expires=200&signature=two')); expect(service.list()).toHaveLength(1); expect(service.list()[0]!.url).toContain('signature=two'); });
  it('uses a backup URL when the primary response fails', async () => { const { service } = setup(); fetchMock.mockResolvedValueOnce(new Response('no', { status: 403 })).mockResolvedValueOnce(new Response(new Uint8Array([9]), { status: 200 })); service.add('account_1', video('https://cdn.example.com/main.mp4', { backupUrl: 'https://cdn.example.com/backup.mp4' })); service.enqueue(service.list()[0]!.id); await waitFor(() => service.tasks()[0]?.status === 'completed'); expect(fetchMock).toHaveBeenCalledTimes(2); });
  it('tries retained alternate URLs after the primary and backup responses fail', async () => {
    const { service } = setup();
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 403 }))
      .mockResolvedValueOnce(new Response('no', { status: 404 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([9]), { status: 200, headers: { 'content-type': 'video/mp4' } }));
    service.add('account_1', video('https://cdn.example.com/main.mp4', {
      backupUrl: 'https://cdn.example.com/backup.mp4',
      alternateUrls: ['https://cdn.example.com/third.mp4'],
    }));
    service.enqueue(service.list()[0]!.id);
    await waitFor(() => service.tasks()[0]?.status === 'completed');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('third.mp4');
    expect(service.tasks()[0]!.path).toMatch(/\.mp4$/i);
  });
  it('promotes only an observed candidate and preserves the remaining fallback order', () => {
    const { service } = setup();
    const resource = service.add('account_1', video('https://cdn.example.com/main.mp4', {
      backupUrl: 'https://cdn.example.com/backup.mp4',
      alternateUrls: ['https://cdn.example.com/third.mp4', 'https://cdn.example.com/fourth.mp4']
    }))!;
    const updated = service.selectCandidate(resource.id, 'https://cdn.example.com/third.mp4');
    expect(updated.url).toBe('https://cdn.example.com/third.mp4');
    expect(updated.backupUrl).toBe('https://cdn.example.com/main.mp4');
    expect(updated.alternateUrls).toEqual(['https://cdn.example.com/backup.mp4', 'https://cdn.example.com/fourth.mp4']);
    expect(() => service.selectCandidate(resource.id, 'https://attacker.example.com/not-observed.mp4')).toThrow('不属于当前素材');
  });
  it('falls back from an HTTP 200 error page and records the rejected candidate', async () => {
    const { service } = setup();
    fetchMock.mockResolvedValueOnce(new Response('<html>expired</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    const updates: MediaResource[][] = [];
    const dispose = service.onUpdated((resources) => updates.push(resources));
    const resource = service.add('account_1', image('https://cdn.example.com/expired-primary.png', { backupUrl: 'https://cdn.example.com/fresh-backup.jpg' }))!;
    service.enqueue(resource.id);
    await waitFor(() => service.tasks()[0]?.status === 'completed');
    const current = service.list()[0]!;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(current.rejectedCandidates).toContain('https://cdn.example.com/expired-primary.png');
    expect(updates.some((items) => items[0]?.rejectedCandidates?.includes('https://cdn.example.com/expired-primary.png'))).toBe(true);
    dispose();
  });
  it('falls back after a response stream aborts and removes the partial candidate file', async () => {
    const { service } = setup();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abortedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        let settled = false;
        controller.enqueue(new Uint8Array([0]));
        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try { controller.error(new Error('stream aborted')); } catch { /* the reader may have cancelled first */ }
        }, 5);
      },
      cancel() {
        if (timer) clearTimeout(timer);
      }
    });
    fetchMock.mockResolvedValueOnce(new Response(abortedBody, { status: 200, headers: { 'content-type': 'video/mp4' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 0, 0, 0]), { status: 200, headers: { 'content-type': 'video/mp4' } }));
    const resource = service.add('account_1', video('https://cdn.example.com/aborted-primary.mp4', { backupUrl: 'https://cdn.example.com/healthy-backup.mp4' }))!;
    service.enqueue(resource.id);
    await waitFor(() => service.tasks()[0]?.status === 'completed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(service.list()[0]!.rejectedCandidates).toContain('https://cdn.example.com/aborted-primary.mp4');
    expect(service.tasks()[0]!.path).toMatch(/\.mp4$/i);
  });
  it('resolves a Blob alternate through the account page after network candidates fail', async () => {
    const bytes = Buffer.from('RIFF....WEBP');
    const { service } = setup(false, 'yunque', async (_accountId, url) => {
      expect(url).toBe('blob:https://example.test/alternate');
      return bytes;
    });
    fetchMock.mockResolvedValue(new Response('no', { status: 403 }));
    const resource = service.add('account_1', image('https://cdn.example.com/expired-image', {
      alternateUrls: ['blob:https://example.test/alternate']
    }))!;
    service.enqueue(resource.id);
    await waitFor(() => service.tasks()[0]?.status === 'completed');
    expect(service.tasks()[0]!.path).toMatch(/\.webp$/i);
    expect(readFileSync(service.tasks()[0]!.path!)).toEqual(bytes);
  });
  it('cancels a running stream and removes its partial file', async () => { const { dir, service } = setup(); let timer: ReturnType<typeof setInterval> | undefined; const slowBody = new ReadableStream<Uint8Array>({ start(controller) { let count = 0; timer = setInterval(() => { try { controller.enqueue(new Uint8Array([count++])); if (count === 5) { if (timer) clearInterval(timer); controller.close(); } } catch { if (timer) clearInterval(timer); } }, 20); }, cancel() { if (timer) clearInterval(timer); } }); fetchMock.mockResolvedValue(new Response(slowBody, { status: 200, headers: { 'content-length': '5' } })); service.add('account_1', video('https://cdn.example.com/slow.mp4')); const task = service.enqueue(service.list()[0]!.id); await waitFor(() => service.tasks()[0]?.status === 'running'); service.cancel(task.id); await waitFor(() => service.tasks()[0]?.status === 'cancelled'); await new Promise((resolve) => setTimeout(resolve, 150)); expect(service.listFiles().total).toBe(0); expect(dir).toBeTruthy(); });
  it('keeps the capture feed runtime-only while restoring task history', async () => { const { service, create } = setup(true); fetchMock.mockResolvedValue(new Response(new Uint8Array([7]), { status: 200 })); service.add('account_1', image('https://cdn.example.com/image_ori_raw/history.png')); service.enqueue(service.list()[0]!.id); await waitFor(() => service.tasks()[0]?.status === 'completed'); const restored = create(); expect(restored.list()).toHaveLength(0); expect(restored.tasks()[0]?.status).toBe('completed'); });
  it('reserves sanitized native download paths and avoids concurrent filename collisions', () => { const { dir, service } = setup(); const first = service.reserveNativeDownloadPath('account_1', 'report<>.pdf'); const second = service.reserveNativeDownloadPath('account_1', 'report<>.pdf'); expect(first).toBe(join(dir, 'report__.pdf')); expect(second).toBe(join(dir, 'report__ (1).pdf')); service.releaseReservedDownloadPath(first); const reusable = service.reserveNativeDownloadPath('account_1', 'report<>.pdf'); expect(reusable).toBe(first); });
  it('rejects generic page assets and non-panel Doubao videos', () => { const { service } = setup(); service.add('account_1', { type: 'image', url: 'https://cdn.example.com/logo.png', source: 'dom-fallback', width: 1024, height: 1024 }); service.add('account_1', { type: 'video', url: 'https://cdn.example.com/ad.mp4', source: 'generic-dom-video' }); expect(service.list()).toEqual([]); });
  it('keeps generated API images without dimensions while rejecting UI avatars', () => { const { service } = setup(false, 'kimi'); service.add('account_1', { type: 'image', url: 'https://cdn.example.com/assets/generated/result.png', source: 'cdp:kimi', title: '生成结果' }); service.add('account_1', { type: 'image', url: 'https://cdn.example.com/assets/avatar.png', source: 'cdp:kimi', title: '用户头像' }); expect(service.list()).toEqual([expect.objectContaining({ url: 'https://cdn.example.com/assets/generated/result.png' })]); });
  it('keeps a generated image found through the performance fallback without calling it watermark-free', () => { const { service } = setup(false, 'kimi'); const resource = service.add('account_1', { type: 'image', url: 'https://cdn.example.com/generated/result-1', source: 'generic-performance-image', title: '图片资源' }); expect(resource).toEqual(expect.objectContaining({ qualityEvidence: 'dom-direct', confirmedNoWatermark: false })); expect(service.list()).toHaveLength(1); });
  it('keeps legacy Qianwen API images without dimensions when endpoint evidence is present', () => { const { service } = setup(false, 'qianwen'); service.add('account_1', { type: 'image', url: 'https://workspace-zb-cdn.qianwen.com/generated/result-1', source: 'cdp:qianwen:message-list', qualityEvidence: 'platform-api' }); expect(service.list()).toEqual([expect.objectContaining({ url: 'https://workspace-zb-cdn.qianwen.com/generated/result-1' })]); });
  it('keeps authoritative legacy Doubao video results while rejecting generic page video', () => { const { service } = setup(false, 'doubao'); const resolved = service.add('account_1', { type: 'video', url: 'https://videoweb-download.doubao.com/video/original.mp4?download=true&lr=video_gen_no_watermark', source: 'doubao_download_info', confirmedNoWatermark: true, qualityEvidence: 'platform-api', width: 1920, height: 1080 }); const bridge = service.add('account_1', { type: 'video', url: 'https://videoweb-download.doubao.com/video/bridge.mp4?download=true', source: 'maowang_bridge', confirmedNoWatermark: true, qualityEvidence: 'platform-api' }); const generic = service.add('account_1', { type: 'video', url: 'https://cdn.example.com/player.mp4', source: 'generic-dom-video', width: 1920, height: 1080 }); expect(resolved?.source).toBe('doubao_download_info'); expect(bridge?.source).toBe('maowang_bridge'); expect(generic).toBeNull(); expect(service.list()).toHaveLength(2); });
  it('deduplicates videos by business id and keeps the better URL', () => { const { service } = setup(); service.add('account_1', video('https://cdn.example.com/preview.mp4', { messageId: 'message-1', width: 640, height: 360 })); service.add('account_1', video('https://cdn.example.com/original.mp4', { messageId: 'message-1', width: 1920, height: 1080, confirmedNoWatermark: true })); expect(service.list()).toHaveLength(1); expect(service.list()[0]).toEqual(expect.objectContaining({ url: 'https://cdn.example.com/original.mp4', confirmedNoWatermark: true })); });
  it('keeps a Dola locator-only resource and upgrades it when the page resolves a URL', () => { const { service } = setup(false, 'dola'); const pending = service.add('account_1', { type: 'video', url: '', title: '待解析作品', source: 'dola-page-state', messageId: 'message-pending', vid: 'vid-pending', shareUrl: 'https://dola.example/share/1' }); expect(pending).toEqual(expect.objectContaining({ url: '', messageId: 'message-pending', vid: 'vid-pending', shareUrl: 'https://dola.example/share/1' })); const resolved = service.add('account_1', { type: 'video', url: 'https://cdn.example.com/original.mp4', title: '待解析作品', source: 'dola-manual-play-info', messageId: 'message-pending', vid: 'vid-pending', confirmedNoWatermark: true, qualityEvidence: 'platform-api' }); expect(resolved).toEqual(expect.objectContaining({ url: 'https://cdn.example.com/original.mp4', messageId: 'message-pending', confirmedNoWatermark: true })); expect(service.list()).toHaveLength(1); });
  it('does not retain locator-only resources for non-Dola accounts', () => { const { service } = setup(false, 'kimi'); expect(service.add('account_1', { type: 'video', url: '', source: 'page-state', messageId: 'message-1' })).toBeNull(); expect(service.list()).toHaveLength(0); });
  it('refuses to enqueue a locator-only resource before it has a URL', () => { const { service } = setup(false, 'dola'); const resource = service.add('account_1', { type: 'video', url: '', source: 'dola-page-state', vid: 'vid-1' })!; expect(() => service.enqueue(resource.id)).toThrow('解析 Dola 原始资源'); });
  it('keeps Yunque original API resources even when dimensions are omitted', () => { const { service } = setup(false, 'yunque'); service.add('account_1', { type: 'image', url: 'https://xyq.jianying.com/origin_aigc/result.webp', source: 'yunque:thread-file', qualityEvidence: 'server-original' }); expect(service.list()).toHaveLength(1); });
  it('materializes account-page Blob media into a workbench preview URL without replacing the download URL', async () => { const bytes = Buffer.from('RIFF....WEBP'); const { service } = setup(false, 'yunque', async (_accountId, url) => { expect(url).toBe('blob:https://example.test/media-1'); return bytes; }); const resource = service.add('account_1', { type: 'image', url: 'blob:https://example.test/media-1', source: 'dom-fallback', width: 1024, height: 1024 })!; const updated = await service.materializeBlobPreview(resource.id); expect(updated?.url).toBe(resource.url); expect(updated?.previewUrl).toMatch(/^workbench-media:\/\/preview\//); const previewPath = service.previewPath(updated!.previewUrl!); expect(previewPath).toBeTruthy(); expect(readFileSync(previewPath!)).toEqual(bytes); });
  it.runIf(process.platform === 'win32')('converts a captured video through the packaged FFmpeg and caches the preview', async () => {
    const { dir, service } = setup(false, 'doubao', undefined, undefined, '', '', true);
    const ffmpeg = join(process.cwd(), 'media-tools', 'win32-x64', 'ffmpeg.exe');
    if (!existsSync(ffmpeg)) return;
    const fixture = join(dir, 'fixture.mp4');
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=2', '-t', '0.5', '-an', '-c:v', 'libx264', fixture], { windowsHide: true, timeout: 20_000 });
    fetchMock.mockResolvedValue(new Response(readFileSync(fixture), { status: 200, headers: { 'content-type': 'video/mp4' } }));
    service.add('account_1', video('https://cdn.example.com/preview.m3u8'));
    const resource = service.list()[0]!;
    const first = await service.convertForPreview(resource.id);
    expect(first.cached).toBe(false);
    expect(first.path).toMatch(/[\\/]Videos[\\/]转码_[0-9a-f]{64}\.mp4$/);
    expect(existsSync(first.path)).toBe(true);
    expect(statSync(first.path).size).toBeGreaterThan(0);
    const second = await service.convertForPreview(resource.id);
    expect(second.cached).toBe(true);
    expect(second.path).toBe(first.path);
    rmSync(first.path, { force: true });
  });
});
