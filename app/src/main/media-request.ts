import { net, type Session } from 'electron';
import { Readable } from 'node:stream';
import { isSignedMediaCdn, mediaRequestHeaders } from './media-request-headers';
import { MediaHttpError } from './download-policy';
import { RequestGate } from './request-gate';

let logRequest: ((message: string) => void) | undefined;
export function setMediaRequestLogger(logger: (message: string) => void): void { logRequest = logger; }
const gates = new WeakMap<Session, RequestGate>();
const cooldowns = new WeakMap<Session, number>();
const proxyAuth = new WeakMap<Session, (host: string, port: number) => { username: string; password: string } | null>();
export function setMediaRequestProxyAuth(ses: Session, resolve: (host: string, port: number) => { username: string; password: string } | null): void { proxyAuth.set(ses, resolve); }
export function setMediaRequestCooldown(ses: Session, until: number): void {
  if (Number.isFinite(until) && until > Date.now()) cooldowns.set(ses, Math.max(cooldowns.get(ses) ?? 0, until));
}

// Read CDN bytes in the main process. Unlike a browser fetch, this request
// must not become a navigation/download or undergo renderer ORB checks.
// Preserve the owning session's proxy. Known signed CDN URLs authenticate with
// their signature; other endpoints retain the owning account's cookies.
export async function fetchAccountMedia(ses: Session, url: string, options: { headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<Response> {
  let gate = gates.get(ses);
  if (!gate) { gate = new RequestGate(4); gates.set(ses, gate); }
  const release = await gate.acquire(options.signal);
  const retryAt = cooldowns.get(ses) ?? 0;
  if (retryAt > Date.now()) { release(); throw new MediaHttpError(429, String(Math.ceil((retryAt - Date.now()) / 1000))); }
  return new Promise((resolve, reject) => {
    const signal = options.signal;
    if (signal?.aborted) { release(); reject(signal.reason); return; }
    const signed = isSignedMediaCdn(url);
    let request!: ReturnType<typeof net.request>;
    try {
      request = net.request({ url, session: ses, useSessionCookies: !signed, credentials: signed ? 'omit' : 'include' });
      const headers = mediaRequestHeaders(options.headers);
      if (!Object.keys(headers).some((key) => key.toLowerCase() === 'user-agent')) {
        const userAgent = ses.getUserAgent?.(); if (userAgent) headers['User-Agent'] = userAgent;
      }
      for (const [name, value] of Object.entries(headers)) {
        if (signed && /^(origin|cookie|authorization)$/i.test(name)) continue;
        request.setHeader(name, value);
      }
    } catch (error) { request?.abort(); release(); reject(error); return; }
    const abort = (): void => { request.abort(); cleanup(); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    const cleanup = (): void => { signal?.removeEventListener('abort', abort); release(); };
    request.on('login', (authInfo, callback) => {
      // Never use endpoint-only account lookup or answer an origin-server
      // Basic-auth challenge with a proxy password.
      let credentials: { username: string; password: string } | null = null;
      try { if (authInfo.isProxy) credentials = proxyAuth.get(ses)?.(authInfo.host, authInfo.port) ?? null; } catch { /* reject unknown authentication */ }
      if (credentials) callback(credentials.username, credentials.password);
      else callback();
    });
    request.once('close', cleanup);
    request.once('abort', cleanup);
    request.once('error', (error) => { cleanup(); if (!signal?.aborted) logRequest?.(`[media-http] host=${new URL(url).hostname} failed=${error.message.replace(/https?:\/\/\S+/g, '[URL]')}`); reject(signal?.aborted ? signal.reason : error); });
    request.once('response', (response) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
      }
      logRequest?.(`[media-http] host=${new URL(url).hostname} status=${response.statusCode} mime=${headers.get('content-type') ?? 'unknown'}`);
      if (response.statusCode === 429) {
        const rateLimit = new MediaHttpError(429, headers.get('retry-after'));
        setMediaRequestCooldown(ses, rateLimit.retryAt!);
      }
      response.once('end', cleanup);
      response.once('error', cleanup);
      const source = Readable.toWeb(response as unknown as Readable) as ReadableStream<Uint8Array>;
      const reader = source.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) { cleanup(); controller.close(); }
            else controller.enqueue(chunk.value);
          } catch (error) { cleanup(); controller.error(signal?.aborted ? signal.reason : error); }
        },
        async cancel(reason) { request.abort(); cleanup(); try { await reader.cancel(reason); } catch { /* transport already closed */ } }
      });
      if ([204, 205, 304].includes(response.statusCode)) { void body.cancel(); resolve(new Response(null, { status: response.statusCode, headers })); }
      else resolve(new Response(body, { status: response.statusCode, headers }));
    });
    request.end();
  });
}
