import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PreviewCache } from '../src/main/preview-cache';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup(limit = 10) { const root = mkdtempSync(join(tmpdir(), 'preview-cache-test-')); dirs.push(root); return new PreviewCache(root, limit); }

describe('preview cache', () => {
  it('isolates accounts and atomically caches the body', async () => {
    const cache = setup(); const path = cache.path('a', 'https://cdn/video?token=x', '.mp4');
    expect(cache.path('b', 'https://cdn/video?token=x', '.mp4')).not.toBe(path);
    await cache.write(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp4' } }), path);
    expect([...readFileSync(path)]).toEqual([1, 2, 3]);
    expect(readdirSync(cache.root).some((name) => name.endsWith('.part'))).toBe(false);
  });
  it('rejects login pages and oversized streams without keeping partial files', async () => {
    const cache = setup(); const path = cache.path('a', 'url', '.mp4');
    await expect(cache.write(new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }), path)).rejects.toThrow('登录页');
    await expect(cache.write(new Response(new Uint8Array(20), { headers: { 'content-type': 'video/mp4' } }), path)).rejects.toThrow('过大');
    expect(existsSync(path)).toBe(false); expect(readdirSync(cache.root)).toHaveLength(0);
  });
  it('evicts older cached media while retaining the new file', async () => {
    const cache = setup(8); const first = cache.path('a', 'first', '.mp4'); const second = cache.path('a', 'second', '.mp4');
    await cache.write(new Response(new Uint8Array(6), { headers: { 'content-type': 'video/mp4' } }), first);
    await cache.write(new Response(new Uint8Array(6), { headers: { 'content-type': 'video/mp4' } }), second);
    expect(existsSync(first)).toBe(false); expect(existsSync(second)).toBe(true);
  });
});
