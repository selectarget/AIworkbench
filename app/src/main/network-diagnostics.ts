type Level = 'info' | 'warn';
type Sink = (level: Level, message: string) => void;
type Failure = { url: string; error: string; resourceType: string; webContentsId?: number };

function destination(raw: string): { host: string; probe: boolean } {
  try {
    const url = new URL(raw);
    const probe = /^(www\.)?(dola|ciciai)\.com$/i.test(url.hostname)
      && decodeURIComponent(url.pathname) === '/security/Create WebSocket';
    return { host: url.hostname, probe };
  } catch { return { host: 'unknown', probe: false }; }
}

// Changing a video source cancels the old request. Dola's security page also
// opens a WebSocket on a capability-test route which returns 404.
// Retain both as informational events rather than failed workbench operations.
export function networkFailure(details: Failure): { level: Level; message: string } {
  const { host, probe } = destination(details.url);
  const cancelled = details.error === 'net::ERR_ABORTED';
  const level = cancelled || (probe && details.resourceType === 'webSocket') ? 'info' : 'warn';
  const reason = cancelled ? ' reason=request-cancelled' : probe && details.resourceType === 'webSocket' ? ' reason=site-security-probe' : '';
  return { level, message: `[network] error=${details.error} host=${host} type=${details.resourceType} webContents=${details.webContentsId ?? 'none'}${reason}` };
}

export class NetworkFailureReporter {
  private readonly events = new Map<string, { level: Level; message: string; repeats: number }>();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly sink: Sink, intervalMs = 30_000) {
    this.timer = setInterval(() => this.flush(), intervalMs);
    this.timer.unref();
  }
  record(details: Failure): void {
    const event = networkFailure(details);
    const key = `${event.level}:${event.message}`;
    const existing = this.events.get(key);
    if (existing) { existing.repeats++; return; }
    if (this.events.size >= 500) this.flush();
    this.events.set(key, { ...event, repeats: 0 });
    this.sink(event.level, event.message);
  }
  flush(): void {
    for (const event of this.events.values()) if (event.repeats) this.sink(event.level, `${event.message} repeated=${event.repeats}`);
    this.events.clear();
  }
  dispose(): void { clearInterval(this.timer); this.flush(); }
}

export class WebSocketDiagnosticTracker {
  private readonly sockets = new Map<string, { host: string; probe: boolean }>();
  constructor(private readonly accountId: string, private readonly sink: Sink) {}
  record(method: string, params: Record<string, any>): void {
    if (!method.startsWith('Network.webSocket')) return;
    const id = String(params.requestId);
    if (method === 'Network.webSocketCreated') {
      if (this.sockets.size >= 128) this.sockets.delete(this.sockets.keys().next().value!);
      this.sockets.set(id, destination(String(params.url ?? '')));
      return;
    }
    const socket = this.sockets.get(id);
    if (!socket) return;
    const context = `account=${this.accountId} host=${socket.host}`;
    if (method === 'Network.webSocketHandshakeResponseReceived') {
      const status = Number(params.response?.status);
      if (!Number.isFinite(status)) return;
      this.sink(status === 101 || (socket.probe && status === 404) ? 'info' : 'warn', `[websocket] ${context} status=${status}${socket.probe ? ' purpose=site-security-probe' : ''}`);
    } else if (method === 'Network.webSocketFrameError') {
      const error = (String(params.errorMessage ?? '').trim() || 'handshake-failed').replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, '[URL]');
      this.sink(socket.probe ? 'info' : 'warn', `[websocket] ${context} error=${error}${socket.probe ? ' purpose=site-security-probe' : ''}`);
    } else if (method === 'Network.webSocketClosed') this.sockets.delete(id);
  }
}
