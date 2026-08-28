import { describe, expect, it } from 'vitest';
import { resolveProxyCredentials } from '../src/main/proxy-credentials';
import type { Account } from '../src/shared/contracts';

function account(id: string, username: string, host = '127.0.0.1', port = 1080): Account {
  return {
    id, schemaVersion: 2, name: id, platform: 'custom', group: '', remark: '', customUrl: 'https://example.com',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    proxy: { enabled: true, mode: 'direct', type: 'socks5', host, port, username, password: `${username}-secret`, subscriptionUrl: '', subscriptionUserAgent: 'test', subscriptionConfigJson: '', subscriptionNodes: [], selectedNodeName: '', selectedNodeTag: '', lastRuntimeError: '' },
    browser: { homeUrl: '', zoomFactor: 1 },
    fingerprint: { enabled: false, seed: '', userAgent: '', platform: '', languages: ['zh-CN'], timezone: 'Asia/Shanghai', hardwareConcurrency: 8, deviceMemory: 8, screenWidth: 1920, screenHeight: 1080, deviceScaleFactor: 1, webglVendor: '', webglRenderer: '', webrtcPolicy: 'default', canvasNoise: 0, audioNoise: 0, lastError: '' }
  };
}

describe('proxy credential isolation', () => {
  it('uses only the owned account when WebContents is known', () => {
    const accounts = [account('A', 'alice'), account('B', 'bob')];
    expect(resolveProxyCredentials(accounts, 'B', true, '127.0.0.1', 1080)).toEqual({ username: 'bob', password: 'bob-secret' });
  });

  it('does not fall through to another account when an owned page has no matching credentials', () => {
    const accounts = [account('A', 'alice'), account('B', 'bob', 'proxy.example', 1080)];
    expect(resolveProxyCredentials(accounts, 'A', true, 'proxy.example', 1080)).toBeNull();
  });

  it('can resolve by endpoint only when no WebContents is available', () => {
    expect(resolveProxyCredentials([account('A', 'alice')], null, false, '127.0.0.1', 1080)).toEqual({ username: 'alice', password: 'alice-secret' });
  });
});
