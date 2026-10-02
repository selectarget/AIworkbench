import { describe, expect, it } from 'vitest';
import { mediaRequestHeaders } from '../src/main/media-request-headers';

describe('media CDN request headers', () => {
  it('uses the Doubao root without leaking chat IDs while preserving ranges', () => {
    const headers = { Referer: 'https://www.doubao.com/chat/123?token=private', Origin: 'https://www.doubao.com', Range: 'bytes=12-', 'If-Range': '"version"' };
    expect(mediaRequestHeaders(headers)).toEqual({ ...headers, Referer: 'https://www.doubao.com/' });
    expect(headers.Referer).toContain('/chat/123');
  });
  it('preserves other platform page paths and unrelated domains', () => {
    for (const referer of ['https://www.dola.com/chat/123', 'https://doubao.com.example/chat']) {
      expect(mediaRequestHeaders({ referer })).toEqual({ referer });
    }
  });
});
