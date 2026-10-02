import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('electron', () => ({ session: {}, shell: {} }));
import { createMediaProtocolHandler, parseMediaRange } from '../src/main/media-protocol';

describe('local media protocol', () => {
  it('validates bounded and suffix ranges', () => {
    expect(parseMediaRange('bytes=2-5', 8)).toEqual({ start: 2, end: 5 });
    expect(parseMediaRange('bytes=-3', 8)).toEqual({ start: 5, end: 7 });
    expect(parseMediaRange('bytes=3-', 8)).toEqual({ start: 3, end: 7 });
    expect(parseMediaRange('bytes=9-', 8)).toBeNull(); expect(parseMediaRange('bytes=0-1,3-4', 8)).toBeNull();
  });
  it('serves only registered files with correct range and HEAD responses', async () => {
    const root = mkdtempSync(join(tmpdir(), 'media-protocol-')); const path = join(root, 'preview.mp4'); writeFileSync(path, 'abcdefgh');
    const handler = createMediaProtocolHandler(() => ({ remotePreviewResponse: async () => null, previewPath: (url: string) => url.endsWith('/known') ? path : null }) as any);
    try {
      const response = await handler(new Request('workbench-media://preview/known', { headers: { Range: 'bytes=2-5' } }));
      expect(response.status).toBe(206); expect(response.headers.get('content-range')).toBe('bytes 2-5/8'); expect(await response.text()).toBe('cdef');
      expect((await handler(new Request('workbench-media://preview/known', { headers: { Range: 'bytes=50-' } }))).status).toBe(416);
      expect((await handler(new Request('workbench-media://preview/unknown'))).status).toBe(404);
      const head = await handler(new Request('workbench-media://preview/known', { method: 'HEAD' })); expect(head.headers.get('content-length')).toBe('8'); expect(await head.text()).toBe('');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
