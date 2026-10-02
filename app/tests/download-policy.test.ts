import { describe, expect, it } from 'vitest';
import { MediaHttpError, retryAfterTime, retryDelay, shouldRetryDownload, waitForRetry } from '../src/main/download-policy';
import { RequestGate } from '../src/main/request-gate';
import { isSignedMediaCdn } from '../src/main/media-request-headers';

describe('download request policy', () => {
  it('retries transient failures but stops authentication, rate-limit, certificate and disk failures', () => {
    for (const status of [408, 500, 502, 503, 504]) expect(shouldRetryDownload(new MediaHttpError(status))).toBe(true);
    for (const status of [400, 401, 403, 404, 410, 429, 501, 505]) expect(shouldRetryDownload(new MediaHttpError(status))).toBe(false);
    for (const message of ['net::ERR_CERT_AUTHORITY_INVALID', 'ENOSPC', 'EPERM', '下载响应不是媒体文件', 'unknown failure']) expect(shouldRetryDownload(new Error(message))).toBe(false);
    expect(shouldRetryDownload(new Error('net::ERR_CONNECTION_CLOSED'))).toBe(true);
    expect(shouldRetryDownload(new Error('视频下载不完整，请重试'))).toBe(true);
  });
  it('honors Retry-After seconds and dates and uses growing jittered backoff', () => {
    const now = Date.parse('2026-10-02T03:00:00Z');
    expect(retryAfterTime('90', now)).toBe(now + 90_000);
    expect(retryAfterTime('Fri, 02 Oct 2026 03:02:00 GMT', now)).toBe(now + 120_000);
    expect(retryAfterTime('invalid', now)).toBeUndefined();
    expect(retryAfterTime(null, now)).toBeUndefined();
    expect(retryDelay(new Error('network'), 1, 0.5)).toBe(1000);
    expect(retryDelay(new Error('network'), 3, 0.5)).toBe(4000);
    expect(retryDelay(new MediaHttpError(503, '60'), 1, 0.5)).toBeGreaterThan(59_000);
  });
  it('cancels a retry wait immediately', async () => {
    const controller = new AbortController();
    const waiting = waitForRetry(60_000, controller.signal);
    controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('holds stream slots until release, and cancelled queued work does not block later work', async () => {
    const gate = new RequestGate(1);
    const release = await gate.acquire();
    const controller = new AbortController(); const cancelled = gate.acquire(controller.signal);
    controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    let acquired = false;
    const next = gate.acquire().then((release) => { acquired = true; return release; });
    await Promise.resolve(); expect(acquired).toBe(false);
    release(); const releaseNext = await next;
    release(); // Old releases must not accidentally grant an extra slot.
    let extra = false; const last = gate.acquire().then((release) => { extra = true; return release; });
    await Promise.resolve(); expect(extra).toBe(false);
    releaseNext(); (await last)();
  });
  it('omits credentials only for known HTTPS signed media CDNs', () => {
    expect(isSignedMediaCdn('https://v26-vdl.doubao.com/video?x-signature=sample')).toBe(true);
    expect(isSignedMediaCdn(`https://v26-vdl.doubao.com/${'a'.repeat(32)}/abcdef12/video/tos/cn/sample.mp4`)).toBe(true);
    expect(isSignedMediaCdn(`https://v26-videoweb.doubao.com/${'a'.repeat(32)}/abcdef12/video/tos/cn/sample.mp4`)).toBe(true);
    expect(isSignedMediaCdn('https://p3-sign.douyinpic.com/cover?signature=sample')).toBe(true);
    for (const url of ['https://www.doubao.com/api?signature=sample', 'https://v26-vdl.doubao.com/video', 'http://v26-vdl.doubao.com/video?signature=sample', 'https://douyinpic.com.evil.example/cover?signature=sample']) expect(isSignedMediaCdn(url)).toBe(false);
  });
});
