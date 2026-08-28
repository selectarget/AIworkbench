import { describe, expect, it, vi } from 'vitest';
import { accountViewNeedsReconfigure, connectionVisualState, mediaCandidateCount, mediaCandidates, mediaPreviewKind, moveAccountIds, restoreOpenTabs, splitIntoBatches } from '../src/renderer/src/App';

describe('renderer startup state', () => {
  it('keeps only successfully restored tabs and de-duplicates saved ids', async () => {
    const open = vi.fn(async (id: string) => ({ ok: id !== 'failed' }));

    await expect(restoreOpenTabs(['first', 'failed', 'first', 'second'], open)).resolves.toEqual({
      restored: ['first', 'second'],
      failed: ['failed']
    });
    expect(open).toHaveBeenCalledTimes(3);
  });

  it('records thrown open failures without aborting later accounts', async () => {
    const open = vi.fn(async (id: string) => {
      if (id === 'broken') throw new Error('renderer failed');
      return { ok: true };
    });

    await expect(restoreOpenTabs(['broken', 'healthy'], open)).resolves.toEqual({
      restored: ['healthy'],
      failed: ['broken']
    });
  });

  it('splits large embedded login runs into bounded workspace batches', () => {
    expect(splitIntoBatches(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
    expect(splitIntoBatches(['a', 'b'], 0)).toEqual([['a'], ['b']]);
    expect(splitIntoBatches([], 20)).toEqual([]);
  });

  it('rebuilds an open view when its platform or custom start URL changes', () => {
    const previous = {
      platform: 'doubao' as const,
      customUrl: '',
      browser: { homeUrl: 'https://www.doubao.com/chat', lastUrl: '', zoomFactor: 1, restoreOnStart: true },
      fingerprint: { seed: 'stable', userAgent: '', platform: '', vendor: '', languages: ['zh-CN'], hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0, webglVendor: '', webglRenderer: '', screenWidth: 1920, screenHeight: 1080, devicePixelRatio: 1, timezone: 'Asia/Shanghai', webrtcPolicy: 'default' as const, canvasNoise: 0, audioNoise: 0, uaMetadata: {} }
    };
    const next = { ...previous, platform: 'custom' as const, customUrl: 'https://example.com/' };
    expect(accountViewNeedsReconfigure(previous, next)).toBe(true);
    expect(accountViewNeedsReconfigure(previous, { ...previous })).toBe(false);
  });

  it('surfaces the active account proxy runtime state in the browser toolbar', () => {
    const account = { id: 'account_1', proxy: { enabled: false, mode: 'direct' as const, lastRuntimeError: '' } };
    expect(connectionVisualState(account, null)).toMatchObject({ label: '直连 · Session 隔离', tone: 'ready' });
    const subscription = { id: 'account_1', proxy: { enabled: true, mode: 'subscription' as const, lastRuntimeError: '' } };
    expect(connectionVisualState(subscription, { accountId: 'account_1', status: 'running', localPort: 19080 })).toMatchObject({ label: '代理已连接 · 19080', tone: 'ready' });
    expect(connectionVisualState(subscription, { accountId: 'account_1', status: 'failed', error: '核心退出' })).toMatchObject({ label: '代理运行失败 · 网络已阻断', tone: 'error', detail: '核心退出' });
    expect(connectionVisualState(subscription, { accountId: 'other', status: 'running' })).toMatchObject({ label: '订阅代理 · 检查中', tone: 'busy' });
  });

  it('counts unique media failover candidates for the resource panel', () => {
    expect(mediaCandidateCount({ url: 'https://cdn.example.com/main', backupUrl: 'https://cdn.example.com/backup', alternateUrls: ['https://cdn.example.com/backup', 'https://cdn.example.com/third', ''] })).toBe(3);
    expect(mediaCandidateCount({ url: '', backupUrl: undefined, alternateUrls: [] })).toBe(0);
  });

  it('labels observed media candidates without inventing or reordering URLs', () => {
    expect(mediaCandidates({ url: 'https://cdn.example.com/main', backupUrl: 'https://cdn.example.com/backup', alternateUrls: ['https://cdn.example.com/backup', 'blob:https://example.test/third'] })).toEqual([
      { url: 'https://cdn.example.com/main', role: 'primary', index: 0 },
      { url: 'https://cdn.example.com/backup', role: 'backup', index: 1 },
      { url: 'blob:https://example.test/third', role: 'alternate', index: 2 }
    ]);
  });

  it('selects video, poster, and placeholder media previews safely', () => {
    expect(mediaPreviewKind({ type: 'video', url: 'https://cdn.example.com/video.mp4', previewUrl: '', thumbUrl: '', previewThumbUrl: '' })).toBe('video');
    expect(mediaPreviewKind({ type: 'video', url: '', previewUrl: '', thumbUrl: '', previewThumbUrl: 'https://cdn.example.com/poster.jpg' })).toBe('image');
    expect(mediaPreviewKind({ type: 'image', url: '', previewUrl: '', thumbUrl: '', previewThumbUrl: '' })).toBe('placeholder');
  });

  it('preserves legacy before/after account drop ordering', () => {
    expect(moveAccountIds(['a', 'b', 'c', 'd'], 'a', 'c', 'before')).toEqual(['b', 'a', 'c', 'd']);
    expect(moveAccountIds(['a', 'b', 'c', 'd'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveAccountIds(['a', 'b', 'c', 'd'], 'd', 'b', 'after')).toEqual(['a', 'b', 'd', 'c']);
    expect(moveAccountIds(['a', 'b'], 'missing', 'b', 'after')).toEqual(['a', 'b']);
  });
});
