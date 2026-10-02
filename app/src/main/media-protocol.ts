import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { extname } from 'node:path';
import type { MediaService } from './media';

export function parseMediaRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || !size || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size ? { start, end } : null;
}

export function createMediaProtocolHandler(getMedia: () => MediaService | null): (request: Request) => Promise<Response> {
  return async (request) => {
    const media = getMedia();
    const remote = await media?.remotePreviewResponse(request);
    if (remote) return remote;
    const path = media?.previewPath(request.url);
    if (!path) return new Response('Not found', { status: 404 });
    try {
      const stat = statSync(path);
      const mime: Record<string, string> = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' };
      const headers = new Headers({ 'content-type': mime[extname(path).toLowerCase()] || 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' });
      const rawRange = request.headers.get('range');
      const range = rawRange ? parseMediaRange(rawRange, stat.size) : undefined;
      if (rawRange && !range) { headers.set('content-range', `bytes */${stat.size}`); return new Response(null, { status: 416, headers }); }
      const start = range?.start ?? 0; const end = range?.end ?? stat.size - 1;
      headers.set('content-length', String(Math.max(0, end - start + 1)));
      if (range) headers.set('content-range', `bytes ${start}-${end}/${stat.size}`);
      const body = request.method === 'HEAD' || !stat.size ? null : Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>;
      return new Response(body, { status: range ? 206 : 200, headers });
    } catch { return new Response('Preview unavailable', { status: 404 }); }
  };
}
