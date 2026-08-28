import { describe, expect, it } from 'vitest';
import { buildProxyRules } from '../src/main/proxy-rules';

describe('Chromium proxy rules', () => {
  it.each(['http', 'https', 'socks5'] as const)('uses a full %s proxy URI for all web traffic', (type) => {
    expect(buildProxyRules({ enabled: true, type, host: '127.0.0.1', port: 8080, username: '', password: '' })).toBe(`${type}://127.0.0.1:8080`);
  });
  it('brackets IPv6 hosts', () => expect(buildProxyRules({ enabled: true, type: 'socks5', host: '::1', port: 1080, username: '', password: '' })).toBe('socks5://[::1]:1080'));
  it('honors the explicit direct scheme when legacy data has a stale type field', () => expect(buildProxyRules({ enabled: true, mode: 'direct', type: 'http', directScheme: 'socks5', host: '127.0.0.1', port: 1080, username: '', password: '' })).toBe('socks5://127.0.0.1:1080'));
});
