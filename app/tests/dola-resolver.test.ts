import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/main/media-request', () => ({ fetchAccountMedia: (target: Session, url: string, options: RequestInit) => target.fetch(url, options) }));
import { createCipheriv, createHash } from 'node:crypto';
import type { Session } from 'electron';
import { buildDolaFallbackUrl, decodeDolaMainUrl, DolaVideoResolver, extractDolaFallbackApis, findDolaKeySeed, parseDolaResolveResponse, resolverUserAgent } from '../src/main/dola-resolver';

const QAAB_SALT = Buffer.from('4dd4c2e6b83162090e52b3c7a6733ba41cb2462b829ab58a196b39db57177524f49baf7f08e8d68d26a72e37c1a95a2f1f05a51892aef2949732b62a38aadd58', 'hex');

function encodeQaabUrl(url: string, seed: Buffer): { token: string; keySeed: string } {
  const first = createHash('sha512').update(seed.subarray(0, 32)).digest();
  const second = createHash('sha512').update(Buffer.concat([first, QAAB_SALT])).digest();
  const key = second.subarray(0, 16); const iv = second.subarray(16, 32);
  const plain = Buffer.from(url, 'ascii'); const padding = 16 - (plain.length % 16); const padded = Buffer.concat([plain, Buffer.alloc(padding, padding)]);
  const cipher = createCipheriv('aes-128-cbc', key, iv); cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return { token: Buffer.concat([Buffer.from([0xa8, 0, 1, 0]), encrypted]).toString('base64'), keySeed: seed.toString('base64') };
}

describe('Dola platform resolver', () => {
  it('stops reading oversized streamed API responses and cancels the body', async () => {
    const cancel = vi.fn(); let chunks = 0;
    const target = { getUserAgent: () => 'account-ua', fetch: async () => new Response(new ReadableStream({ pull(controller) { chunks++; controller.enqueue(new Uint8Array(6 * 1024 * 1024)); }, cancel })) } as unknown as Session;
    await expect(new DolaVideoResolver().resolve('https://api.example/fallback', target)).rejects.toThrow('响应过大');
    expect(cancel).toHaveBeenCalled(); expect(chunks).toBeLessThan(5);
  });
  it('preserves signed query encoding exactly as the V6.8 BuildRequestUri method', () => {
    const value = buildDolaFallbackUrl('https://www.doubao.com/samantha/media/get_play_info?video_id=v1&signature=a%20b%2Fc&opaque=%7E&channel=old&logo_type=watermark&codec_type=1');
    expect(value).toContain('signature=a%20b%2Fc&opaque=%7E');
    expect(value).toContain('channel=no&codec_type=8&logo_type=unwatermarked');
    expect(value).not.toContain('channel=old');
  });
  it('uses the account session user agent and strips the Electron token', () => {
    const userAgent = resolverUserAgent({ getUserAgent: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Electron/43.1.1' });
    expect(userAgent).toContain('Macintosh');
    expect(userAgent).not.toContain('Electron/');
  });
  it('falls back to the current host platform when a session has no user agent', () => {
    const userAgent = resolverUserAgent({ getUserAgent: () => '' });
    expect(userAgent).toMatch(process.platform === 'darwin' ? /Macintosh/ : /Windows NT/);
  });
  it('passes the account session user agent to the fallback request', async () => {
    let requestHeaders: Record<string, string> | undefined;
    const direct = 'https://cdn.example/video.mp4';
    const target = {
      getUserAgent: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Electron/43.1.1',
      fetch: async (_url: string, options: { headers: Record<string, string> }) => {
        requestHeaders = options.headers;
        return new Response(JSON.stringify({ video_info: { data: { main_url: Buffer.from(direct).toString('base64') } } }), { status: 200 });
      },
    } as unknown as Session;

    await new DolaVideoResolver().resolve('https://api.example/fallback', target);
    expect(requestHeaders?.['user-agent']).toContain('Macintosh');
    expect(requestHeaders?.['user-agent']).not.toContain('Electron/');
  });
  it('adds the platform-provided unwatermarked query without dropping existing parameters', () => {
    const result = new URL(buildDolaFallbackUrl('https://api.example/video?item_id=42&logo_type=watermark'));
    expect(result.searchParams.get('item_id')).toBe('42'); expect(result.searchParams.get('channel')).toBe('no'); expect(result.searchParams.get('codec_type')).toBe('8'); expect(result.searchParams.get('logo_type')).toBe('unwatermarked');
  });
  it('decodes a direct base64 main_url token and selects the highest quality item', () => {
    const direct = 'https://cdn.example/video.mp4?x-expires=9999999999'; const token = Buffer.from(direct).toString('base64');
    const result = parseDolaResolveResponse(JSON.stringify({ video_info: { data: { video_list: [{ main_url: Buffer.from('https://cdn.example/low.mp4').toString('base64'), bitrate: 10, vwidth: 640, vheight: 360 }, { main_url: token, bitrate: 100, vwidth: 1920, vheight: 1080 }], poster_url: 'https://cdn.example/poster.jpg' } } }));
    expect(result.videoUrl).toBe(direct); expect(result.posterUrl).toContain('poster.jpg'); expect(result.alternateUrls).toEqual(['https://cdn.example/low.mp4']); expect(decodeDolaMainUrl(token)).toBe(direct);
  });
  it('finds nested fallback APIs and deduplicates them', () => {
    const api = 'https://api.example/fallback?message_id=1'; const result = extractDolaFallbackApis(JSON.stringify({ data: [{ fallback_api: api }, { nested: { fallback_api: api } }] }));
    expect(result).toEqual([api]);
  });
  it('finds fallback APIs inside escaped JSON/SSE fragments', () => {
    const api = 'https://api.example/fallback?message_id=2&share_id=abc';
    const body = `data: ${JSON.stringify({ payload: JSON.stringify({ nested: { fallback_api: api } }) })}\n\n`;
    expect(extractDolaFallbackApis(body)).toEqual([api]);
    expect(extractDolaFallbackApis(`{\\"fallback_api\\":\\"${api}\\"}`)).toEqual([api]);
  });
  it('does not throw when key_seed contains malformed percent escapes', () => {
    expect(() => findDolaKeySeed('https://api.example/video?key_seed=%')).not.toThrow();
    expect(findDolaKeySeed('https://api.example/video?key_seed=%')).toBe('%');
  });
  it('decodes the qAAB AES-CBC main_url format used by the legacy resolver', () => {
    const encoded = encodeQaabUrl('https://cdn.example.com/original.mp4', Buffer.from('0123456789abcdef0123456789abcdef', 'ascii'));
    expect(encoded.token.startsWith('qAAB')).toBe(true);
    expect(decodeDolaMainUrl(encoded.token, encoded.keySeed)).toBe('https://cdn.example.com/original.mp4');
  });
});
