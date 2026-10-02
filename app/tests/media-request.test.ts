import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('electron', () => ({ net: { request: requestMock } }));
import { fetchAccountMedia, setMediaRequestCooldown, setMediaRequestProxyAuth } from '../src/main/media-request';

class FakeRequest extends EventEmitter {
  readonly headers = new Map<string, string>();
  readonly end = vi.fn();
  response?: PassThrough;
  readonly abort = vi.fn(() => { this.emit('abort'); this.response?.destroy(); });
  setHeader(name: string, value: string): void { this.headers.set(name.toLowerCase(), value); }
  respond(status = 200, headers: Record<string, string> = {}): void {
    this.response = Object.assign(new PassThrough(), { statusCode: status, headers });
    this.emit('response', this.response);
  }
}
const requests: FakeRequest[] = [];
function prepare(): object {
  requestMock.mockImplementation(() => { const request = new FakeRequest(); requests.push(request); return request; });
  return { getUserAgent: () => 'account-ua' };
}
async function tick(): Promise<void> { await new Promise((resolve) => setTimeout(resolve, 0)); }
afterEach(() => { for (const request of requests.splice(0)) request.abort(); requestMock.mockReset(); });

describe('account media transport', () => {
  it('answers proxy challenges only with the owning session credentials and rejects origin challenges', async () => {
    const target = prepare(); const other = { getUserAgent: () => 'other-ua' };
    const own = vi.fn((host, port) => host === 'proxy.example' && port === 8080 ? { username: 'own-user', password: 'own-secret' } : null);
    const foreign = vi.fn(() => ({ username: 'other-user', password: 'other-secret' }));
    setMediaRequestProxyAuth(target as never, own); setMediaRequestProxyAuth(other as never, foreign);
    const result = fetchAccountMedia(target as never, 'https://cdn.example/video');
    await tick();
    const callback = vi.fn();
    requests[0]!.emit('login', { isProxy: true, host: 'proxy.example', port: 8080 }, callback);
    expect(callback).toHaveBeenLastCalledWith('own-user', 'own-secret');
    requests[0]!.emit('login', { isProxy: false, host: 'proxy.example', port: 8080 }, callback);
    expect(callback).toHaveBeenLastCalledWith();
    requests[0]!.emit('login', { isProxy: true, host: 'unknown.example', port: 8080 }, callback);
    expect(callback).toHaveBeenLastCalledWith();
    expect(foreign).not.toHaveBeenCalled();
    requests[0]!.respond(); await (await result).body!.cancel();
  });
  it('honors a restored cooldown before making any transport request', async () => {
    const target = prepare();
    setMediaRequestCooldown(target as never, Date.now() + 120_000);
    await expect(fetchAccountMedia(target as never, 'https://cdn.example/video')).rejects.toMatchObject({ status: 429 });
    expect(requestMock).not.toHaveBeenCalled();
  });
  it('uses the account proxy session and UA but omits credentials and Origin for signed CDN media', async () => {
    const target = prepare();
    const result = fetchAccountMedia(target as never, 'https://v26-vdl.doubao.com/video?signature=sample', { headers: { Referer: 'https://www.doubao.com/chat/', Origin: 'https://www.doubao.com', Cookie: 'secret' } });
    await tick();
    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({ session: target, useSessionCookies: false, credentials: 'omit' }));
    expect(requests[0]!.headers.get('referer')).toBe('https://www.doubao.com/');
    expect(requests[0]!.headers.get('user-agent')).toBe('account-ua');
    expect(requests[0]!.headers.has('cookie')).toBe(false);
    expect(requests[0]!.headers.has('origin')).toBe(false);
    requests[0]!.respond(); await (await result).body!.cancel();
    expect(requests[0]!.abort).toHaveBeenCalled();
  });
  it('retains account credentials and platform headers for ordinary authenticated endpoints', async () => {
    const target = prepare();
    const result = fetchAccountMedia(target as never, 'https://api.example/media', { headers: { Origin: 'https://api.example', Referer: 'https://api.example/chat', 'User-Agent': 'explicit-account-ua' } });
    await tick();
    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({ session: target, useSessionCookies: true, credentials: 'include' }));
    expect(requests[0]!.headers.get('origin')).toBe('https://api.example');
    expect(requests[0]!.headers.get('user-agent')).toBe('explicit-account-ua');
    requests[0]!.respond(); await (await result).body!.cancel();
  });
  it('holds the per-session stream limit until a response is cancelled', async () => {
    const target = prepare();
    const results = Array.from({ length: 5 }, (_, index) => fetchAccountMedia(target as never, `https://cdn.example/${index}`));
    await tick(); expect(requestMock).toHaveBeenCalledTimes(4);
    for (const request of requests) request.respond();
    await tick(); expect(requestMock).toHaveBeenCalledTimes(4);
    await (await results[0]!).body!.cancel();
    await tick(); expect(requestMock).toHaveBeenCalledTimes(5);
    requests[4]!.respond();
    for (const result of results.slice(1)) await (await result).body!.cancel();
  });
  it('blocks follow-up requests in the same session during Retry-After without blocking other accounts', async () => {
    const target = prepare();
    const result = fetchAccountMedia(target as never, 'https://cdn.example/video');
    await tick(); requests[0]!.respond(429, { 'retry-after': '120' });
    await (await result).body!.cancel();
    await expect(fetchAccountMedia(target as never, 'https://cdn.example/backup')).rejects.toMatchObject({ status: 429 });
    expect(requestMock).toHaveBeenCalledTimes(1);
    const other = fetchAccountMedia({ getUserAgent: () => 'other-ua' } as never, 'https://cdn.example/other');
    await tick(); requests[1]!.respond(); await (await other).body!.cancel();
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});
