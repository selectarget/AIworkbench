export function retryAfterTime(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  const time = Number.isFinite(seconds) ? now + Math.max(0, seconds) * 1000 : Date.parse(value);
  return Number.isFinite(time) && time >= now && time <= 8_640_000_000_000_000 ? time : undefined;
}

export class MediaHttpError extends Error {
  readonly retryAt?: number;
  constructor(readonly status: number, retryAfter: string | null = null) {
    super(`HTTP ${status}`);
    this.name = 'MediaHttpError';
    this.retryAt = retryAfterTime(retryAfter) ?? (status === 429 ? Date.now() + 60_000 : undefined);
  }
}

export function shouldRetryDownload(error: unknown): boolean {
  if (error instanceof MediaHttpError) return [408, 500, 502, 503, 504].includes(error.status);
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) return true;
  const message = error instanceof Error ? error.message : String(error);
  if (/HTTP (4\d\d)|ERR_CERT_|ERR_SSL_|ENOSPC|EACCES|EPERM|ENOENT|不是媒体文件|响应为空|Blob|断点位置/.test(message)) return false;
  return /ERR_CONNECTION_|ERR_NETWORK_|ERR_INTERNET_|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT|ERR_HTTP2_|ERR_QUIC_|fetch failed|TimeoutError|timeout|timed out|ECONNRESET|ETIMEDOUT|EPIPE|下载不完整|premature close/i.test(message);
}

export function retryDelay(error: unknown, attempt: number, random = Math.random()): number {
  const backoff = Math.round(Math.min(30_000, 1000 * 2 ** Math.min(attempt - 1, 5)) * (0.8 + random * 0.4));
  return Math.max(backoff, error instanceof MediaHttpError && error.retryAt ? error.retryAt - Date.now() : 0);
}

export function waitForRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = (): void => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, Math.min(milliseconds, 2_147_483_647));
    signal.addEventListener('abort', abort, { once: true });
  });
}
