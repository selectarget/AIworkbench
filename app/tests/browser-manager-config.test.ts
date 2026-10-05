import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd(), getPath: () => process.cwd() },
  BrowserWindow: class {
    contentView = new (class {
      readonly children = new Set<unknown>();
      addChildView(view: unknown): void { this.children.add(view); }
      removeChildView(view: unknown): void { this.children.delete(view); }
    })();
    private readonly listeners = new Map<string, Array<() => void>>();
    private destroyed = false;
    on(event: string, listener: () => void): void { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); }
    once(event: string, listener: () => void): void { this.on(event, listener); }
    emit(event: string): void { for (const listener of this.listeners.get(event) ?? []) listener(); }
    isDestroyed(): boolean { return this.destroyed; }
    getContentSize(): [number, number] { return [1600, 1000]; }
    loadURL = vi.fn(async () => undefined);
    show = vi.fn();
    close(): void { this.destroyed = true; this.emit('closed'); }
    destroy(): void { this.destroyed = true; this.emit('closed'); }
  },
  WebContentsView: class {},
  dialog: { showMessageBox: vi.fn() },
  session: { fromPartition: vi.fn() },
  shell: {}
}));

import { BrowserManager, classifyNativeDownload, dolaFallbackReferer, inspectDolaCompletionBody, isDolaExternalVideoUrl, ProgrammaticDownloadGuard } from '../src/main/browser-manager';
import { dialog } from 'electron';
import { DOUBAO_HISTORY_URL, isDoubaoHistoryUrl } from '../src/main/doubao-history';

describe('Doubao history cleanup confirmation', () => {
  function fixture(platform = 'doubao') {
    const account = { id: 'doubao_a', name: '测试豆包账号', platform };
    const window = { isDestroyed: () => false };
    const manager = new BrowserManager(window as never, { list: () => [account] } as never, {} as never);
    let url = DOUBAO_HISTORY_URL;
    const contents = {
      isDestroyed: vi.fn(() => false), getURL: () => url,
      loadURL: vi.fn(async (value: string) => { url = value; }),
      executeJavaScript: vi.fn().mockResolvedValueOnce({ ok: true, count: 51, message: '等待确认' })
        .mockResolvedValueOnce({ ok: true, count: 51, submitted: true, message: '已删除' })
        .mockResolvedValueOnce({ ok: true, count: 51, submitted: true, message: '已核验：历史会话已清空' })
    };
    const entries = (manager as unknown as { entries: Map<string, unknown> }).entries;
    entries.set(account.id, { view: { webContents: contents }, accountId: account.id });
    vi.mocked(dialog.showMessageBox).mockReset();
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 1, checkboxChecked: false });
    return { manager, account, window, contents, entries, navigate: (value: string) => { url = value; } };
  }
  it('uses the fixed history URL and cancels without executing deletion', async () => {
    const f = fixture();
    const result = await f.manager.clearDoubaoHistory(f.account.id);
    expect(result.message).toContain('已取消');
    expect(f.contents.loadURL).toHaveBeenCalledWith(DOUBAO_HISTORY_URL);
    expect(f.contents.executeJavaScript).toHaveBeenCalledTimes(1);
    expect(dialog.showMessageBox).toHaveBeenCalledWith(f.window, expect.objectContaining({
      message: expect.stringContaining('全部 51 个'), defaultId: 1, cancelId: 1,
      detail: expect.stringContaining('线上作品')
    }));
  });
  it('deletes only after a confirmation identifying the account and total', async () => {
    const f = fixture();
    vi.mocked(dialog.showMessageBox).mockImplementation(async () => {
      expect(f.contents.executeJavaScript).toHaveBeenCalledTimes(1);
      return { response: 0, checkboxChecked: false };
    });
    await expect(f.manager.clearDoubaoHistory(f.account.id)).resolves.toMatchObject({ ok: true, count: 51 });
    expect(dialog.showMessageBox).toHaveBeenCalledWith(f.window, expect.objectContaining({ message: expect.stringContaining(f.account.name) }));
    expect(f.contents.executeJavaScript).toHaveBeenCalledTimes(3);
    expect(f.contents.executeJavaScript.mock.calls[1]?.[0]).toContain('"delete"');
    expect(f.contents.executeJavaScript.mock.calls[2]?.[0]).toContain('})("verify",');
    expect(f.contents.loadURL).toHaveBeenCalledTimes(2);
  });
  it('stops if the account page is replaced during confirmation', async () => {
    const f = fixture();
    vi.mocked(dialog.showMessageBox).mockImplementation(async () => {
      f.entries.set(f.account.id, {});
      return { response: 0, checkboxChecked: false };
    });
    await expect(f.manager.clearDoubaoHistory(f.account.id)).rejects.toThrow('页面已变化');
    expect(f.contents.executeJavaScript).toHaveBeenCalledTimes(1);
  });
  it('stops if confirmation outlives navigation to another page', async () => {
    const f = fixture();
    vi.mocked(dialog.showMessageBox).mockImplementation(async () => {
      f.navigate('https://www.doubao.com/chat/');
      return { response: 0, checkboxChecked: false };
    });
    await expect(f.manager.clearDoubaoHistory(f.account.id)).rejects.toThrow('页面已变化');
    expect(f.contents.executeJavaScript).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed counts without presenting a destructive confirmation', async () => {
    const f = fixture();
    f.contents.executeJavaScript.mockReset().mockResolvedValue({ ok: true, count: -1, message: 'bad' });
    await expect(f.manager.clearDoubaoHistory(f.account.id)).rejects.toThrow('有效清理结果');
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });
  it('rejects other platforms before navigating', async () => {
    const f = fixture('dola');
    await expect(f.manager.clearDoubaoHistory(f.account.id)).rejects.toThrow('仅豆包');
    expect(f.contents.loadURL).not.toHaveBeenCalled();
  });
  it('reports an already-cleared account without confirmation or deletion', async () => {
    const f = fixture();
    f.contents.executeJavaScript.mockReset().mockResolvedValue({ ok: true, count: 0, submitted: true, message: '已核验：可批量清理的历史会话已清空' });
    await expect(f.manager.clearDoubaoHistory(f.account.id)).resolves.toMatchObject({ ok: true, count: 0, submitted: false });
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(f.contents.executeJavaScript).toHaveBeenCalledTimes(1);
  });
  it('blocks concurrent calls and releases the guard after cancellation', async () => {
    const f = fixture();
    const pending = f.manager.clearDoubaoHistory(f.account.id);
    await expect(f.manager.clearDoubaoHistory(f.account.id)).rejects.toThrow('勿重复');
    await pending;
    f.contents.executeJavaScript.mockReset().mockResolvedValue({ ok: false, count: 0, message: '页面结构变化' });
    await expect(f.manager.clearDoubaoHistory(f.account.id)).resolves.toMatchObject({ message: '页面结构变化' });
  });
  it('never retries a submitted deletion with an unconfirmed outcome', async () => {
    const f = fixture();
    f.contents.executeJavaScript.mockReset().mockResolvedValueOnce({ ok: true, count: 51, message: '待确认' })
      .mockResolvedValueOnce({ ok: false, count: 0, submitted: true, message: '请在页面核对' })
      .mockResolvedValueOnce({ ok: false, count: 0, submitted: true, message: '仍有 3 个可清理会话' });
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false });
    await expect(f.manager.clearDoubaoHistory(f.account.id)).resolves.toMatchObject({ ok: false, submitted: true });
    expect(f.contents.executeJavaScript).toHaveBeenCalledTimes(3);
    expect(f.contents.executeJavaScript.mock.calls.filter(([script]) => script.includes('})("delete",'))).toHaveLength(1);
  });
  it('reports verified success despite an erroneous platform toast, without a second delete', async () => {
    const f = fixture();
    const sink = vi.fn(); f.manager.setNetworkDiagnosticSink(sink);
    f.contents.executeJavaScript.mockReset().mockResolvedValueOnce({ ok: true, count: 51, message: '待确认' })
      .mockResolvedValueOnce({ ok: false, count: 0, submitted: true, message: '豆包未完成删除：删除失败，请稍后再试' })
      .mockResolvedValueOnce({ ok: true, count: 51, submitted: true, message: '已核验：可批量清理的历史会话已清空；豆包保留的主对话不支持批量删除' });
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false });
    await expect(f.manager.clearDoubaoHistory(f.account.id)).resolves.toMatchObject({ ok: true, message: expect.stringContaining('主对话') });
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(f.contents.loadURL).toHaveBeenCalledTimes(2);
    expect(f.contents.executeJavaScript.mock.calls.filter(([script]) => script.includes('})("delete",'))).toHaveLength(1);
    expect(sink).toHaveBeenCalledWith('warn', expect.stringContaining('stage=page-result ok=false'));
    expect(sink).toHaveBeenCalledWith('info', expect.stringContaining('stage=result ok=true'));
  });
  it('keeps an unavailable verification ambiguous and never retries deletion', async () => {
    const f = fixture();
    f.contents.executeJavaScript.mockReset().mockResolvedValueOnce({ ok: true, count: 51, message: '待确认' })
      .mockResolvedValueOnce({ ok: true, count: 51, submitted: true, message: '删除成功' })
      .mockRejectedValueOnce(new Error('网络超时'));
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false });
    await expect(f.manager.clearDoubaoHistory(f.account.id)).resolves.toMatchObject({ ok: false, submitted: true, message: expect.stringContaining('未能核验') });
    expect(f.contents.executeJavaScript.mock.calls.filter(([script]) => script.includes('})("delete",'))).toHaveLength(1);
  });
  it('rejects any Delete action requested during read-only verification', async () => {
    const f = fixture();
    f.contents.executeJavaScript.mockReset().mockResolvedValueOnce({ ok: true, count: 51, message: '待确认' })
      .mockResolvedValueOnce({ ok: false, count: 0, submitted: true, message: '删除失败' })
      .mockResolvedValueOnce({ ok: false, count: 0, message: 'bad', action: { kind: 'remove', xRatio: 0.9, yRatio: 0.9 } });
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false });
    await expect(f.manager.clearDoubaoHistory(f.account.id)).resolves.toMatchObject({ ok: false, submitted: true, message: expect.stringContaining('未能核验') });
  });
  it('accepts only the actual HTTPS Doubao history route', () => {
    expect(isDoubaoHistoryUrl(DOUBAO_HISTORY_URL)).toBe(true);
    expect(isDoubaoHistoryUrl('https://doubao.com/chat/thread/list/')).toBe(true);
    for (const url of ['http://www.doubao.com/chat/thread/list', 'https://www.doubao.com.evil.test/chat/thread/list', 'https://evil.test@www.doubao.com/chat/thread/list', 'https://www.doubao.com/chat/']) {
      expect(isDoubaoHistoryUrl(url)).toBe(false);
    }
  });
  it('uses native page input and does not repeat a click while UI state is pending', async () => {
    const f = fixture();
    const sendCommand = vi.fn(async () => undefined);
    Object.assign(f.contents, { debugger: { isAttached: () => true, sendCommand } });
    const steps = [
      { ok: false, count: 0, message: 'menu', action: { kind: 'menu', xRatio: 0.9, yRatio: 0.1 } },
      { ok: false, count: 0, message: 'menu', action: { kind: 'menu', xRatio: 0.9, yRatio: 0.1 } },
      { ok: true, count: 51, message: '待确认' }
    ];
    f.contents.executeJavaScript.mockReset().mockImplementation(async (script: string) => script.startsWith('({ width:') ? { width: 1000, height: 600 } : steps.shift());
    await expect(f.manager.clearDoubaoHistory(f.account.id)).resolves.toMatchObject({ message: '已取消清理，未执行删除' });
    expect(sendCommand.mock.calls.map(call => call[0])).toEqual(['Input.dispatchMouseEvent', 'Input.dispatchMouseEvent', 'Input.dispatchMouseEvent']);
    expect(sendCommand).toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.objectContaining({ type: 'mousePressed', x: 900, y: 60 }));
  });
  it('never accepts a Delete click request during preparation', async () => {
    const f = fixture();
    f.contents.executeJavaScript.mockReset().mockResolvedValue({ ok: false, count: 0, message: 'bad', action: { kind: 'remove', xRatio: 0.9, yRatio: 0.9 } });
    await expect(f.manager.clearDoubaoHistory(f.account.id)).rejects.toThrow('点击目标无效');
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });
  it('records preparation failure and displays it without a delete confirmation', async () => {
    const f = fixture();
    const sink = vi.fn(); f.manager.setNetworkDiagnosticSink(sink);
    f.contents.executeJavaScript.mockReset().mockResolvedValue({ ok: false, count: 0, message: '全选入口尚未出现' });
    await expect(f.manager.clearDoubaoHistory(f.account.id)).resolves.toMatchObject({ ok: false });
    expect(sink).toHaveBeenCalledWith('warn', expect.stringContaining('stage=prepared ok=false'));
    expect(dialog.showMessageBox).toHaveBeenCalledWith(f.window, expect.objectContaining({ title: '历史清理未执行', message: '全选入口尚未出现', buttons: ['知道了'] }));
  });
});

describe('account runtime budget', () => {
  it('prevents allocating another account while allowing an already open one', async () => {
    const manager = new BrowserManager({} as never, {} as never, { get: () => ({ maxOpenAccounts: 2 }) } as never);
    const entries = (manager as unknown as { entries: Map<string, unknown> }).entries;
    entries.set('account_a', {}); entries.set('account_b', {});
    await expect(manager.open('account_a')).resolves.toBeUndefined();
    await expect(manager.open('account_c')).rejects.toThrow('同时运行 2 个账号');
  });
});

describe('programmatic download guard', () => {
  it('matches account and global marks, then expires them', () => {
    const guard = new ProgrammaticDownloadGuard();
    const url = 'https://cdn.example.com/video.mp4';
    guard.mark('account_1', url, 1_000);
    expect(guard.shouldCancel('account_1', url, 12_999)).toBe(true);
    // The legacy global mark also protects a default-session download.
    expect(guard.shouldCancel('account_2', url, 12_999)).toBe(true);
    expect(guard.shouldCancel('account_1', url, 13_000)).toBe(false);
    expect(guard.shouldCancel('account_1', url, 31_000)).toBe(false);
  });

  it('does not match a different URL or a clock-skewed future event', () => {
    const guard = new ProgrammaticDownloadGuard();
    guard.mark('account_1', 'https://cdn.example.com/one.mp4', 5_000);
    expect(guard.shouldCancel('account_1', 'https://cdn.example.com/two.mp4', 5_100)).toBe(false);
    expect(guard.shouldCancel('account_1', 'https://cdn.example.com/one.mp4', 4_900)).toBe(false);
  });
});

describe('Dola external video URL detection', () => {
  it('keeps Dola and ciciai video links in-app and ignores unrelated hosts', () => {
    expect(isDolaExternalVideoUrl('https://www.dola.com/video/tos/cn/example/1.mp4')).toBe(true);
    expect(isDolaExternalVideoUrl('https://cdn.ciciai.com/play/clip?mime_type=video_mp4')).toBe(true);
    expect(isDolaExternalVideoUrl('https://www.dola.com/chat')).toBe(false);
    expect(isDolaExternalVideoUrl('https://www.doubao.com/video/tos/cn/example/1.mp4')).toBe(false);
    expect(isDolaExternalVideoUrl('not-a-url')).toBe(false);
  });
});

describe('native download classification', () => {
  it('routes only explicit media downloads to the media queue', () => {
    expect(classifyNativeDownload('clip', 'https://cdn.example/media/clip', 'video/mp4')).toBe('video');
    expect(classifyNativeDownload('cover', 'https://cdn.example/generated/asset', 'image/png')).toBe('image');
    expect(classifyNativeDownload('clip.mp4', 'https://cdn.example/download?id=1', 'application/octet-stream')).toBe('video');
    expect(classifyNativeDownload('report.pdf', 'https://cdn.example/report.pdf', 'application/pdf')).toBeNull();
    expect(classifyNativeDownload('archive.zip', 'https://cdn.example/archive.zip', '')).toBeNull();
  });

  it('recognises the additional V4.4 image and video download formats', () => {
    expect(classifyNativeDownload('原图', 'https://cdn.example/generated/result', 'image/tiff')).toBe('image');
    expect(classifyNativeDownload('原图.heic', 'https://cdn.example/generated/result', 'application/octet-stream')).toBe('image');
    expect(classifyNativeDownload('动画.mkv', 'https://cdn.example/generated/result', 'application/octet-stream')).toBe('video');
    expect(classifyNativeDownload('vector.svg', 'https://cdn.example/generated/vector.svg', '')).toBe('image');
  });

  it('recognises explicit media type query values on extensionless URLs', () => {
    expect(classifyNativeDownload('download', 'https://cdn.example/asset?mime_type=video_mp4', 'application/octet-stream')).toBe('video');
    expect(classifyNativeDownload('download', 'https://cdn.example/asset?content_type=image_webp', 'application/octet-stream')).toBe('image');
    expect(classifyNativeDownload('download', 'https://cdn.example/asset?mime-type=video%2Fmp4', 'application/octet-stream')).toBe('video');
  });

  it('leaves non-media Chromium downloads unhandled', () => {
    const accounts = { list: vi.fn(() => []), get: vi.fn() };
    const manager = new BrowserManager({} as never, accounts as never, {} as never);
    const browserSession = {
      webRequest: { onBeforeRequest: vi.fn() },
      setUserAgent: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    };
    const sink = vi.fn();
    manager.setSiteDownloadSink(sink);
    const configure = (manager as unknown as { configureSession(account: unknown, target: unknown): void }).configureSession.bind(manager);
    configure({ id: 'account_1', name: '测试账号', platform: 'kimi', fingerprint: { seed: '' } }, browserSession);
    const listener = browserSession.on.mock.calls.find(([event]) => event === 'will-download')?.[1] as ((event: { preventDefault: () => void }, item: unknown) => void);
    const preventDefault = vi.fn();
    listener({ preventDefault }, { getURL: () => 'https://cdn.example/report.pdf', getFilename: () => 'report.pdf', getMimeType: () => 'application/pdf' });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(sink).not.toHaveBeenCalled();
  });

  it('keeps ordinary Chromium downloads native but places them in the configured path', () => {
    const accounts = { list: vi.fn(() => []), get: vi.fn() };
    const manager = new BrowserManager({} as never, accounts as never, {} as never);
    const browserSession = {
      webRequest: { onBeforeRequest: vi.fn() },
      setUserAgent: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    };
    const resolvePath = vi.fn(() => 'C:/Downloads/测试账号/report.pdf');
    const releasePath = vi.fn();
    manager.setNativeDownloadPathResolver(resolvePath, releasePath);
    const configure = (manager as unknown as { configureSession(account: unknown, target: unknown): void }).configureSession.bind(manager);
    configure({ id: 'account_1', name: '测试账号', platform: 'kimi', fingerprint: { seed: '' } }, browserSession);
    const listener = browserSession.on.mock.calls.find(([event]) => event === 'will-download')?.[1] as ((event: { preventDefault: () => void }, item: unknown) => void);
    const preventDefault = vi.fn();
    const setSavePath = vi.fn();
    const once = vi.fn();
    listener({ preventDefault }, { getURL: () => 'https://cdn.example/report.pdf', getFilename: () => 'report.pdf', getMimeType: () => 'application/pdf', setSavePath, once });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(resolvePath).toHaveBeenCalledWith('account_1', 'report.pdf');
    expect(setSavePath).toHaveBeenCalledWith('C:/Downloads/测试账号/report.pdf');
    expect(once).toHaveBeenCalledWith('done', expect.any(Function));
    once.mock.calls[0][1]();
    expect(releasePath).toHaveBeenCalledWith('C:/Downloads/测试账号/report.pdf');
  });

  it('notifies the workbench after an ordinary native download completes', () => {
    const accounts = { list: vi.fn(() => []), get: vi.fn() };
    const manager = new BrowserManager({} as never, accounts as never, {} as never);
    const browserSession = {
      webRequest: { onBeforeRequest: vi.fn() },
      setUserAgent: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    };
    const resolvePath = vi.fn(() => 'C:/Downloads/测试账号/report.pdf');
    const releasePath = vi.fn();
    const downloaded = vi.fn();
    manager.setNativeDownloadPathResolver(resolvePath, releasePath);
    manager.setNativeDownloadSink(downloaded);
    const configure = (manager as unknown as { configureSession(account: unknown, target: unknown): void }).configureSession.bind(manager);
    configure({ id: 'account_1', name: '测试账号', platform: 'kimi', fingerprint: { seed: '' } }, browserSession);
    const listener = browserSession.on.mock.calls.find(([event]) => event === 'will-download')?.[1] as ((event: { preventDefault: () => void }, item: unknown) => void);
    const done = vi.fn();
    listener({ preventDefault: vi.fn() }, { getURL: () => 'https://cdn.example/report.pdf', getFilename: () => 'report.pdf', getMimeType: () => 'application/pdf', setSavePath: vi.fn(), once: done });
    const completion = done.mock.calls[0]?.[1] as ((event: unknown, state: string) => void);
    completion({}, 'completed');
    expect(downloaded).toHaveBeenCalledWith({ accountId: 'account_1', filename: 'report.pdf', path: 'C:/Downloads/测试账号/report.pdf', url: 'https://cdn.example/report.pdf' });
    expect(releasePath).toHaveBeenCalledWith('C:/Downloads/测试账号/report.pdf');
  });

  it('routes a media Chromium download with its MIME hint', () => {
    const accounts = { list: vi.fn(() => []), get: vi.fn() };
    const manager = new BrowserManager({} as never, accounts as never, {} as never);
    const browserSession = {
      webRequest: { onBeforeRequest: vi.fn() },
      setUserAgent: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    };
    const sink = vi.fn();
    manager.setSiteDownloadSink(sink);
    const configure = (manager as unknown as { configureSession(account: unknown, target: unknown): void }).configureSession.bind(manager);
    configure({ id: 'account_1', name: '测试账号', platform: 'kimi', fingerprint: { seed: '' } }, browserSession);
    const listener = browserSession.on.mock.calls.find(([event]) => event === 'will-download')?.[1] as ((event: { preventDefault: () => void }, item: unknown) => void);
    const preventDefault = vi.fn();
    listener({ preventDefault }, { getURL: () => 'https://cdn.example/generated/asset', getFilename: () => 'download', getMimeType: () => 'video/mp4' });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(sink).toHaveBeenCalledWith('account_1', expect.objectContaining({ type: 'video', mimeType: 'video/mp4', source: 'site-download' }));
  });

  it('cancels a native duplicate after a programmatic download was marked', () => {
    const accounts = { list: vi.fn(() => []), get: vi.fn() };
    const manager = new BrowserManager({} as never, accounts as never, {} as never);
    const browserSession = {
      webRequest: { onBeforeRequest: vi.fn() },
      setUserAgent: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    };
    const sink = vi.fn();
    manager.setSiteDownloadSink(sink);
    const configure = (manager as unknown as { configureSession(account: unknown, target: unknown): void }).configureSession.bind(manager);
    configure({ id: 'account_1', name: '测试账号', platform: 'kimi', fingerprint: { seed: '' } }, browserSession);
    const listener = browserSession.on.mock.calls.find(([event]) => event === 'will-download')?.[1] as ((event: { preventDefault: () => void }, item: unknown) => void);
    const url = 'https://cdn.example.com/generated/clip.mp4';
    manager.markProgrammaticDownload('account_1', url);
    const preventDefault = vi.fn();
    const cancel = vi.fn();
    listener({ preventDefault }, { getURL: () => url, getFilename: () => 'clip.mp4', getMimeType: () => 'video/mp4', cancel });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(sink).not.toHaveBeenCalled();
  });
});

describe('browser account reconfiguration', () => {
  it('resolves concurrent observations once per account and discards results after disposal', async () => {
    const manager = new BrowserManager({} as never, { list: () => [] } as never, {} as never);
    let finish!: (result: { videoUrl: string; posterUrl: string }) => void;
    const resolver = { resolve: vi.fn(() => new Promise<{ videoUrl: string; posterUrl: string }>((resolve) => { finish = resolve; })) };
    (manager as unknown as { dolaResolver: typeof resolver }).dolaResolver = resolver;
    const sink = vi.fn(); manager.setMediaSink(sink);
    const resolveFallbacks = (manager as unknown as { resolveDolaFallbacks(id: string, body: string, referer: string): Promise<void> }).resolveDolaFallbacks.bind(manager);
    const body = JSON.stringify({ fallback_api: 'https://www.dola.com/fallback?video_id=sample' });
    const first = resolveFallbacks('account_1', body, 'https://www.dola.com/');
    await resolveFallbacks('account_1', body, 'https://www.dola.com/');
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    manager.dispose();
    finish({ videoUrl: 'https://cdn.example/original.mp4', posterUrl: '' });
    await first;
    expect(sink).not.toHaveBeenCalled();
  });

  it('keeps simultaneous fallback requests isolated between accounts', async () => {
    const manager = new BrowserManager({} as never, { list: () => [] } as never, {} as never);
    const resolver = { resolve: vi.fn().mockResolvedValue({ videoUrl: 'https://cdn.example/original.mp4', posterUrl: '' }) };
    (manager as unknown as { dolaResolver: typeof resolver }).dolaResolver = resolver;
    const sink = vi.fn(); manager.setMediaSink(sink);
    const resolveFallbacks = (manager as unknown as { resolveDolaFallbacks(id: string, body: string, referer: string): Promise<void> }).resolveDolaFallbacks.bind(manager);
    const body = JSON.stringify({ fallback_api: 'https://www.dola.com/fallback?video_id=sample' });
    await Promise.all([resolveFallbacks('account_1', body, 'https://www.dola.com/'), resolveFallbacks('account_2', body, 'https://www.dola.com/')]);
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls.map(([accountId]) => accountId).sort()).toEqual(['account_1', 'account_2']);
  });

  it('resolves Doubao fallback APIs through the same V6.8 local resolver', async () => {
    const manager = new BrowserManager({} as never, { list: () => [] } as never, {} as never);
    const resolver = { resolve: vi.fn().mockResolvedValue({ videoUrl: 'https://v26-vdl.doubao.com/original.mp4', posterUrl: 'https://cdn.example/cover.jpg' }) };
    (manager as unknown as { dolaResolver: typeof resolver }).dolaResolver = resolver;
    const sink = vi.fn(); manager.setMediaSink(sink);
    const resolveFallbacks = (manager as unknown as { resolveDolaFallbacks(id: string, body: string, referer: string, platform: 'doubao', capturePageUrl: string, visibleIds: Set<string>): Promise<void> }).resolveDolaFallbacks.bind(manager);
    const api = 'https://www.doubao.com/samantha/media/get_play_info?video_id=vid-1';
    await resolveFallbacks('account_1', JSON.stringify({ fallback_api: api }), 'https://www.doubao.com/', 'doubao', 'https://www.doubao.com/chat/123', new Set(['vid-1']));
    expect(resolver.resolve).toHaveBeenCalledWith(api, undefined, 'https://www.doubao.com/');
    expect(sink).toHaveBeenCalledWith('account_1', expect.objectContaining({ source: 'doubao-video-fallback-api', vid: 'vid-1', confirmedNoWatermark: true, resolutionMethod: 'fallback_api' }));
  });
  it('keeps the response URL as the Dola fallback referer', () => {
    expect(dolaFallbackReferer('https://www.dola.com/thread/123')).toBe('https://www.dola.com/thread/123');
    expect(dolaFallbackReferer('not a URL')).toBe('https://www.dola.com/');
  });

  it('allows a transient Dola fallback failure to be retried', async () => {
    const api = 'https://api.example/fallback?message_id=retry';
    const accounts = { list: vi.fn(() => []), get: vi.fn() };
    const manager = new BrowserManager({} as never, accounts as never, {} as never);
    const resolver = {
      resolve: vi.fn()
        .mockRejectedValueOnce(new Error('temporary network failure'))
        .mockResolvedValueOnce({ videoUrl: 'https://cdn.example/recovered.mp4', posterUrl: '' })
    };
    (manager as unknown as { dolaResolver: typeof resolver }).dolaResolver = resolver;
    const sink = vi.fn();
    manager.setMediaSink(sink);
    const resolveFallbacks = (manager as unknown as { resolveDolaFallbacks(accountId: string, body: string, referer: string): Promise<void> }).resolveDolaFallbacks.bind(manager);

    await resolveFallbacks('account_1', JSON.stringify({ data: { fallback_api: api } }), 'https://www.dola.com/thread/123');
    await resolveFallbacks('account_1', JSON.stringify({ data: { fallback_api: api } }), 'https://www.dola.com/thread/123');

    expect(resolver.resolve).toHaveBeenCalledTimes(2);
    expect(resolver.resolve).toHaveBeenLastCalledWith(api, undefined, 'https://www.dola.com/thread/123');
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('inspects the actual Dola completion payload without retaining credentials', () => {
    const body = JSON.stringify({ chat_ability: {
      ability_type: 17,
      ability_param: JSON.stringify({ model: 'seedance_v2.5', duration: 30 })
    }, cookie: 'must-not-be-read-as-task-data' });
    expect(inspectDolaCompletionBody(body, 30)).toEqual({
      detected: true,
      abilityType: 17,
      duration: 30,
      model: 'seedance_v2.5',
      matchesExpected: true
    });
    expect(inspectDolaCompletionBody(body, 15).matchesExpected).toBe(false);
    expect(inspectDolaCompletionBody('{not-json}', 30)).toEqual({ detected: false });
    expect(inspectDolaCompletionBody(JSON.stringify({ chat_ability: {
      ability_type: 1,
      ability_param: JSON.stringify({ duration: 30 })
    } }), 30)).toEqual({ detected: false });
  });

  it('retrieves an omitted Dola request body before confirming a video task', async () => {
    const debuggerChannel = new EventEmitter() as EventEmitter & {
      isAttached(): boolean;
      sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
    };
    debuggerChannel.isAttached = () => true;
    debuggerChannel.sendCommand = vi.fn(async (method: string) => {
      if (method === 'Network.getRequestPostData') return {
        postData: JSON.stringify({ chat_ability: { ability_type: 17, ability_param: JSON.stringify({ model: 'seedance_v2.5', duration: 30 }) } })
      };
      return {};
    });
    const executeJavaScript = vi.fn(async () => {
      setTimeout(() => debuggerChannel.emit('message', {}, 'Network.requestWillBeSent', {
        requestId: 'request-1',
        request: { url: 'https://www.dola.com/chat/completion', method: 'POST' }
      }), 0);
      return { ok: true, message: '已点击 Dola 生成按钮' };
    });
    const account = { id: 'dola_1', platform: 'dola', fingerprint: { seed: '' } };
    const view = { webContents: { isDestroyed: () => false, debugger: debuggerChannel, executeJavaScript } };
    const accounts = { list: vi.fn(() => [account]), get: vi.fn(() => account) };
    const manager = new BrowserManager({} as never, accounts as never, {} as never);
    (manager as unknown as { entries: Map<string, unknown> }).entries.set('dola_1', { view, accountId: 'dola_1' });

    const result = await manager.submitDolaVideo('dola_1', 'test', '16:9', 30);

    expect(result).toMatchObject({ ok: true, requestObserved: true, requestDuration: 30, verification: 'confirmed' });
    expect(debuggerChannel.sendCommand).toHaveBeenCalledWith('Network.getRequestPostData', { requestId: 'request-1' });
  });

  it('joins an account that is already opening instead of creating another view', async () => {
    const accounts = { list: vi.fn(() => []), get: vi.fn() };
    const manager = new BrowserManager({} as never, accounts as never, {} as never);
    const pending = Promise.resolve();
    const state = { promise: pending, cancelled: false };
    const opening = (manager as unknown as { opening: Map<string, typeof state> }).opening;
    opening.set('account_1', state);

    await manager.open('account_1');

    expect(accounts.list).not.toHaveBeenCalled();
    expect(opening.get('account_1')).toBe(state);
  });

  it('cancels a pending open so an immediate retry cannot join a stale task', () => {
    const stopRuntime = vi.fn();
    const accounts = { list: vi.fn(() => []), get: vi.fn() };
    const manager = new BrowserManager({} as never, accounts as never, {} as never, { stopRuntime } as never);
    const state = { promise: new Promise<void>(() => undefined), cancelled: false };
    const opening = (manager as unknown as { opening: Map<string, typeof state> }).opening;
    opening.set('account_1', state);

    manager.close('account_1');

    expect(state.cancelled).toBe(true);
    expect(opening.has('account_1')).toBe(false);
    expect(stopRuntime).toHaveBeenCalledWith('account_1');
  });

  it('does not open a closed account while applying a fingerprint/config change', async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    const accounts = { get: vi.fn().mockReturnValue({ id: 'account_1' }) };
    const manager = new BrowserManager({} as never, accounts as never, {} as never, { stopRuntime: vi.fn() } as never);
    vi.spyOn(manager, 'open').mockImplementation(open);

    await manager.reconfigure('account_1');

    expect(open).not.toHaveBeenCalled();
  });

  it('coalesces concurrent reloads for one open account', async () => {
    let release!: () => void;
    const stopRuntime = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const accounts = { get: vi.fn().mockReturnValue({ id: 'account_1' }) };
    const manager = new BrowserManager({} as never, accounts as never, {} as never, { stopRuntime } as never);
    const entries = (manager as unknown as { entries: Map<string, unknown> }).entries;
    entries.set('account_1', {});
    vi.spyOn(manager, 'close').mockImplementation(() => { entries.delete('account_1'); });
    vi.spyOn(manager as never, 'applyLayout' as never).mockImplementation(() => undefined);
    const open = vi.spyOn(manager, 'open').mockResolvedValue(undefined);

    const first = manager.reconfigure('account_1');
    const second = manager.reconfigure('account_1');
    await Promise.resolve();
    expect(open).not.toHaveBeenCalled();
    release();
    await Promise.all([first, second]);

    expect(stopRuntime).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('rebuilds open response-patch accounts when the experimental toggle changes', async () => {
    const accounts = {
      list: vi.fn(() => [
        { id: 'dola_account', platform: 'dola' },
        { id: 'generic_account', platform: 'kimi' }
      ]),
      get: vi.fn()
    };
    const manager = new BrowserManager({} as never, accounts as never, {} as never, { stopRuntime: vi.fn() } as never);
    const entries = (manager as unknown as { entries: Map<string, unknown> }).entries;
    entries.set('dola_account', { accountId: 'dola_account' });
    entries.set('generic_account', { accountId: 'generic_account' });
    const reload = vi.spyOn(manager as unknown as { reloadAdapter(accountId: string): Promise<void> }, 'reloadAdapter').mockResolvedValue(undefined);

    await manager.syncAdapterSettings([], [], true);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith('dola_account');
  });

  it('shows embedded batch account views in a visible grid and restores them', async () => {
    const mainContentView = {
      children: new Set<unknown>(),
      addChildView(view: unknown): void { this.children.add(view); },
      removeChildView(view: unknown): void { this.children.delete(view); }
    };
    const mainWindow = { contentView: mainContentView, webContents: {} };
    const accounts = {
      list: vi.fn(() => [{ id: 'account_1' }, { id: 'account_2' }]),
      get: vi.fn()
    };
    const manager = new BrowserManager(mainWindow as never, accounts as never, {} as never, { stopRuntime: vi.fn() } as never);
    const viewA = { webContents: { isDestroyed: () => false }, setBounds: vi.fn() };
    const viewB = { webContents: { isDestroyed: () => false }, setBounds: vi.fn() };
    const entries = (manager as unknown as { entries: Map<string, unknown> }).entries;
    entries.set('account_1', { view: viewA, accountId: 'account_1' });
    entries.set('account_2', { view: viewB, accountId: 'account_2' });
    vi.spyOn(manager, 'open').mockResolvedValue(undefined);

    await manager.openBatchWorkspace(['account_1', 'account_2']);
    const batch = (manager as unknown as { batchWindow: { contentView: typeof mainContentView } }).batchWindow;
    expect(batch.contentView.children.has(viewA)).toBe(true);
    expect(batch.contentView.children.has(viewB)).toBe(true);
    expect(viewA.setBounds).toHaveBeenCalled();
    expect(viewB.setBounds).toHaveBeenCalled();

    await manager.closeBatchWorkspace();
    expect(mainContentView.children.has(viewA)).toBe(true);
    expect(mainContentView.children.has(viewB)).toBe(true);
  });

  it('removes persistent session download listeners when the window runtime is disposed', () => {
    const accounts = { list: vi.fn(() => []), get: vi.fn() };
    const manager = new BrowserManager({} as never, accounts as never, {} as never);
    const browserSession = {
      webRequest: { onBeforeRequest: vi.fn() },
      setUserAgent: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    };
    const configure = (manager as unknown as { configureSession(account: unknown, target: unknown): void }).configureSession.bind(manager);

    configure({ id: 'account_1', name: '测试账号', platform: 'kimi', fingerprint: { seed: '' } }, browserSession);
    manager.dispose();

    expect(browserSession.on).toHaveBeenCalledWith('will-download', expect.any(Function));
    expect(browserSession.off).toHaveBeenCalledWith('will-download', expect.any(Function));
  });

  it('unloads stale built-in adapter extensions when an adapter is disabled', async () => {
    let disabledAdapters: string[] = [];
    const browserSession = {
      extensions: {
        loadExtension: vi.fn(async (path: string) => ({ id: path.includes('doubao') ? 'doubao-extension' : 'other-extension' })),
        removeExtension: vi.fn()
      }
    };
    const settings = { get: vi.fn(() => ({ disabledAdapters })) };
    const manager = new BrowserManager({} as never, { list: vi.fn(() => []), get: vi.fn() } as never, settings as never);
    const load = (manager as unknown as { loadExtensions(account: unknown, session: unknown): Promise<void> }).loadExtensions.bind(manager);

    await load({ id: 'account_1', platform: 'doubao' }, browserSession);
    disabledAdapters = ['doubao'];
    await load({ id: 'account_1', platform: 'doubao' }, browserSession);

    expect(browserSession.extensions.loadExtension).toHaveBeenCalled();
    expect(browserSession.extensions.removeExtension).toHaveBeenCalledWith('doubao-extension');
  });

  it('does not inject the post-load adapter fallback twice into one document', async () => {
    const accounts = { list: vi.fn(() => []), get: vi.fn() };
    const settings = { get: vi.fn(() => ({ disabledAdapters: [] })) };
    const executeJavaScript = vi.fn(async () => undefined);
    const view = { webContents: { getURL: () => 'https://kimi.com/', executeJavaScript } };
    const manager = new BrowserManager({} as never, accounts as never, settings as never);
    const inject = (manager as unknown as { injectSiteScripts(account: unknown, view: unknown): Promise<void> }).injectSiteScripts.bind(manager);
    const account = { id: 'kimi_1', platform: 'kimi' };

    await inject(account, view);
    await inject(account, view);
    expect(executeJavaScript).toHaveBeenCalledTimes(2);

    // did-start-loading clears the fallback set for the next document.
    (manager as unknown as { fallbackScriptNames: Map<string, Set<string>> }).fallbackScriptNames.delete('kimi_1');
    await inject(account, view);
    expect(executeJavaScript).toHaveBeenCalledTimes(4);
  });
});


describe('permission callbacks after account removal', () => {
  function fixture() {
    const manager = new BrowserManager({} as never, { list: () => [] } as never, {} as never);
    const target = { webRequest: { onBeforeRequest: vi.fn() }, setUserAgent: vi.fn(), setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn(), on: vi.fn(), off: vi.fn() };
    const internal = manager as unknown as { configureSession(account: unknown, target: unknown): void; permissionGrants: Map<string, Set<string>> };
    internal.configureSession({ id: 'permission_account', name: '权限测试', platform: 'kimi', fingerprint: { seed: '' } }, target);
    const check = target.setPermissionCheckHandler.mock.calls[0]![0] as (...args: unknown[]) => boolean;
    const request = target.setPermissionRequestHandler.mock.calls[0]![0] as (...args: unknown[]) => void;
    return { internal, check, request };
  }
  it('denies late permission checks after permissions are removed without throwing', () => {
    const f = fixture();
    f.internal.permissionGrants.get('permission_account')!.add('media:https://example.test');
    expect(f.check(null, 'media', 'https://example.test')).toBe(true);
    f.internal.permissionGrants.delete('permission_account');
    expect(f.check(null, 'media', 'https://example.test')).toBe(false);
    expect(f.check(null, 'fullscreen', 'https://example.test')).toBe(false);
  });
  it('does not prompt for a removed account', () => {
    const f = fixture();
    f.internal.permissionGrants.delete('permission_account');
    vi.mocked(dialog.showMessageBox).mockClear();
    const callback = vi.fn();
    f.request({ isDestroyed: () => false }, 'media', callback, { requestingUrl: 'https://example.test' });
    expect(callback).toHaveBeenCalledExactlyOnceWith(false);
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });
  it('rejects approval that arrives after an account is removed and reopened', async () => {
    const f = fixture();
    let approve!: (value: { response: number; checkboxChecked: boolean }) => void;
    vi.mocked(dialog.showMessageBox).mockImplementationOnce(() => new Promise(resolve => { approve = resolve; }));
    const callback = vi.fn();
    f.request({ isDestroyed: () => false }, 'media', callback, { requestingUrl: 'https://example.test' });
    f.internal.permissionGrants.delete('permission_account');
    f.internal.permissionGrants.set('permission_account', new Set());
    approve({ response: 1, checkboxChecked: false });
    await vi.waitFor(() => expect(callback).toHaveBeenCalledExactlyOnceWith(false));
    expect(f.check(null, 'media', 'https://example.test')).toBe(false);
  });
  it('rejects approval after the requesting page is destroyed', async () => {
    const f = fixture();
    let approve!: (value: { response: number; checkboxChecked: boolean }) => void;
    vi.mocked(dialog.showMessageBox).mockImplementationOnce(() => new Promise(resolve => { approve = resolve; }));
    let destroyed = false;
    const callback = vi.fn();
    f.request({ isDestroyed: () => destroyed }, 'media', callback, { requestingUrl: 'https://example.test' });
    destroyed = true;
    approve({ response: 1, checkboxChecked: false });
    await vi.waitFor(() => expect(callback).toHaveBeenCalledExactlyOnceWith(false));
    expect(f.check(null, 'media', 'https://example.test')).toBe(false);
  });
});


it('resolves only the village vid displayed on the current Doubao card, not other fallback APIs', async () => {
  const manager = new BrowserManager({} as never, { list: () => [] } as never, {} as never);
  const resolver = { resolve: vi.fn().mockResolvedValue({ videoUrl: 'https://cdn.example/village.mp4', posterUrl: 'https://cdn.example/village.jpg' }) };
  (manager as unknown as { dolaResolver: typeof resolver }).dolaResolver = resolver;
  const sink = vi.fn(); manager.setMediaSink(sink);
  const resolve = (manager as unknown as { resolveDolaFallbacks(id: string, body: string, referer: string, platform: string, page: string, vids: Set<string>): Promise<void> }).resolveDolaFallbacks.bind(manager);
  const village = 'https://www.doubao.com/samantha/media/get_play_info?video_id=village';
  const bridge = 'https://www.doubao.com/samantha/media/get_play_info?video_id=bridge';
  await resolve('account_1', JSON.stringify({ records: [...Array.from({ length: 10 }, (_, index) => ({ fallback_api: bridge + index })), { fallback_api: village }] }), 'https://www.doubao.com/', 'doubao', 'https://www.doubao.com/chat/current', new Set(['village']));
  expect(resolver.resolve).toHaveBeenCalledExactlyOnceWith(village, undefined, 'https://www.doubao.com/');
  expect(sink).toHaveBeenCalledExactlyOnceWith('account_1', expect.objectContaining({ vid: 'village', url: 'https://cdn.example/village.mp4', thumbUrl: 'https://cdn.example/village.jpg' }));
});


it('keeps the rendered card vid when the signed CDN API has no vid query parameter', async () => {
  const manager = new BrowserManager({} as never, { list: () => [] } as never, {} as never);
  const resolver = { resolve: vi.fn().mockResolvedValue({ videoUrl: 'https://cdn.example/village.mp4', posterUrl: 'https://cdn.example/village.jpg' }) };
  (manager as unknown as { dolaResolver: typeof resolver }).dolaResolver = resolver;
  const sink = vi.fn(); manager.setMediaSink(sink);
  const resolve = (manager as unknown as { resolveDolaFallbacks(id: string, body: string, referer: string, platform: string, page: string, vids: Set<string>, apis: Map<string, string>): Promise<void> }).resolveDolaFallbacks.bind(manager);
  const api = 'https://vas-lf-x.snssdk.com/video/opaque-path?key_seed=sample';
  await resolve('account_1', '{}', 'https://www.doubao.com/', 'doubao', 'https://www.doubao.com/chat/current', new Set(['village']), new Map([[api, 'village']]));
  expect(sink).toHaveBeenCalledExactlyOnceWith('account_1', expect.objectContaining({ vid: 'village', url: 'https://cdn.example/village.mp4' }));
});
