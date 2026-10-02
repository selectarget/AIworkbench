import { describe, expect, it, vi } from 'vitest';
import { NetworkFailureReporter, networkFailure, WebSocketDiagnosticTracker } from '../src/main/network-diagnostics';

describe('network diagnostics', () => {
  it('retains genuine failures without signed URLs or credentials', () => {
    const event = networkFailure({ url: 'https://user:secret@cdn.example/private.mp4?token=secret', error: 'net::ERR_CONNECTION_CLOSED', resourceType: 'media', webContentsId: 4 });
    expect(event.level).toBe('warn');
    expect(event.message).toContain('cdn.example');
    expect(event.message).not.toMatch(/secret|private|token|https:/);
  });
  it('treats a cancelled preview as informational', () => {
    expect(networkFailure({ url: 'workbench-media://preview/item', error: 'net::ERR_ABORTED', resourceType: 'media' })).toMatchObject({ level: 'info', message: expect.stringContaining('reason=request-cancelled') });
  });
  it('recognizes only the exact Dola security probe, keeping ordinary sockets as warnings', () => {
    const request = { error: 'net::ERR_FAILED', resourceType: 'webSocket' };
    expect(networkFailure({ ...request, url: 'wss://www.dola.com/security/Create%20WebSocket?token=secret' }).level).toBe('info');
    expect(networkFailure({ ...request, url: 'wss://www.dola.com/chat/realtime' }).level).toBe('warn');
    expect(networkFailure({ ...request, url: 'wss://www.dola.com.evil.example/security/Create%20WebSocket' }).level).toBe('warn');
  });
  it('aggregates repeated failures but reports changes and flushes counts on shutdown', () => {
    const sink = vi.fn();
    const reporter = new NetworkFailureReporter(sink);
    const request = { url: 'https://mssdk.bytedance.com/report', error: 'net::ERR_CONNECTION_CLOSED', resourceType: 'xhr', webContentsId: 4 };
    reporter.record(request); reporter.record(request); reporter.record(request);
    expect(sink).toHaveBeenCalledTimes(1);
    reporter.record({ ...request, error: 'net::ERR_CERT_DATE_INVALID' });
    expect(sink).toHaveBeenCalledTimes(2);
    reporter.dispose();
    expect(sink).toHaveBeenLastCalledWith('warn', expect.stringContaining('repeated=2'));
  });
  it('records real socket handshakes and distinguishes the observed security 404', () => {
    const sink = vi.fn(); const tracker = new WebSocketDiagnosticTracker('account_1', sink);
    tracker.record('Network.webSocketCreated', { requestId: 'probe', url: 'wss://www.dola.com/security/Create%20WebSocket?token=secret' });
    tracker.record('Network.webSocketFrameError', { requestId: 'probe', errorMessage: 'Error during WebSocket handshake: Unexpected response code: 404' });
    expect(sink).toHaveBeenLastCalledWith('info', expect.stringContaining('purpose=site-security-probe'));
    // The persistent account page can omit Chromium's error text.
    tracker.record('Network.webSocketFrameError', { requestId: 'probe', errorMessage: '' });
    expect(sink).toHaveBeenLastCalledWith('info', expect.stringContaining('error=handshake-failed'));
    tracker.record('Network.webSocketCreated', { requestId: 'chat', url: 'wss://www.dola.com/chat/realtime?token=secret' });
    tracker.record('Network.webSocketHandshakeResponseReceived', { requestId: 'chat', response: { status: 101 } });
    expect(sink).toHaveBeenLastCalledWith('info', expect.stringContaining('status=101'));
    tracker.record('Network.webSocketFrameError', { requestId: 'chat', errorMessage: 'Failed wss://www.dola.com/private?token=secret' });
    expect(sink).toHaveBeenLastCalledWith('warn', expect.stringContaining('error=Failed [URL]'));
    tracker.record('Network.webSocketClosed', { requestId: 'chat' });
    const count = sink.mock.calls.length;
    tracker.record('Network.webSocketFrameError', { requestId: 'chat', errorMessage: 'stale error' });
    expect(sink).toHaveBeenCalledTimes(count);
    expect(JSON.stringify(sink.mock.calls)).not.toContain('secret');
  });
});
