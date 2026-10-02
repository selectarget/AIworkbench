import { describe, expect, it } from 'vitest';
import { accountSchema, type DownloadTask } from '../src/shared/contracts';
import { buildDiagnosticsSnapshot, summarizeDownloadTasks, redactDiagnosticText } from '../src/main/diagnostics';

const task = (status: DownloadTask['status']): DownloadTask => ({
  id: `task_${status}`,
  resourceId: 'resource_1',
  accountId: 'account_a',
  title: '素材',
  status,
  receivedBytes: 0,
  attempts: 0,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z'
});

describe('diagnostics snapshot', () => {
  it('removes credentials, signed URL paths and Windows usernames from exported errors', () => {
    const text = redactDiagnosticText('HTTP 403 https://user:secret@cdn.example/private/video.mp4?token=signed Cookie=secret C:\\Users\\alice\\data');
    expect(text).not.toContain('alice'); expect(text).not.toContain('secret'); expect(text).not.toContain('signed'); expect(text).not.toContain('/private');
    expect(text).toContain('cdn.example');
  });
  it('summarizes every download task state', () => {
    const result = summarizeDownloadTasks(['queued', 'running', 'running', 'paused', 'completed', 'failed', 'cancelled'].map(task));
    expect(result).toEqual({ queued: 1, running: 2, paused: 1, completed: 1, failed: 1, cancelled: 1 });
  });

  it('reports isolated account state without secrets', () => {
    const account = accountSchema.parse({
      id: 'account_a', name: '账号 A', platform: 'doubao', createdAt: '2026-08-27T00:00:00.000Z', order: 0,
      fingerprint: { enabled: true, seed: 'stable_seed' },
      proxy: { enabled: true, mode: 'subscription', subscriptionNodes: [{ name: '节点 A', scheme: 'socks5', host: '127.0.0.1', port: 1080, password: 'secret' }], selectedNodeName: '节点 A' }
    });
    const snapshot = buildDiagnosticsSnapshot({
      appVersion: '1.0.0', electronVersion: '43.1.1', platform: 'win32', arch: 'x64', packaged: true,
      accounts: [account], browser: [{ accountId: account.id, open: true, url: 'https://www.doubao.com/chat', sessionPartition: 'persist:account_account_a' }],
      proxy: [{ accountId: account.id, status: 'running', localPort: 61001, pid: 1234 }], resources: [], tasks: [task('running')], pluginCount: 2, disabledAdapters: []
    });
    expect(snapshot.openTabCount).toBe(1);
    expect(snapshot.accounts[0]).toMatchObject({ open: true, sessionPartition: 'persist:account_account_a', adapterCapabilities: { dedicatedDownloader: true, taskDurations: [15, 30] }, fingerprint: { enabled: true, seedPresent: true }, proxy: { status: 'running', localPort: 61001, nodeCount: 1 } });
    expect(JSON.stringify(snapshot)).not.toContain('secret');
  });
});
