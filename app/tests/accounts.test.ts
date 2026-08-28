import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(`safe:${value}`), decryptString: (value: Buffer) => value.toString().replace(/^safe:/, '') } }));
import { AccountService } from '../src/main/accounts';

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });
function service(): { value: AccountService; file: string } { const dir = mkdtempSync(join(tmpdir(), 'workbench-accounts-')); dirs.push(dir); const file = join(dir, 'accounts.json'); return { value: new AccountService(file), file }; }
const input = (name: string, group = '') => ({ name, platform: 'doubao' as const, group, remark: '', customUrl: '', proxy: { enabled: false, type: 'http' as const, host: '', username: '', password: '' } });

describe('account groups and bulk operations', () => {
  it('renames and removes groups', () => { const { value } = service(); value.create(input('A', '工作')); value.create(input('B', '工作')); expect(value.groups()).toEqual([{ name: '工作', count: 2 }]); value.renameGroup('工作', '视频'); expect(value.list().every((item) => item.group === '视频')).toBe(true); value.removeGroup('视频'); expect(value.groups()).toEqual([]); });
  it('bulk updates without storing plaintext proxy passwords', () => { const { value, file } = service(); const a = value.create(input('A')); const b = value.create(input('B')); value.bulkUpdate([a.id, b.id], { proxy: { enabled: true, type: 'http', host: '127.0.0.1', port: 8080, username: 'u', password: 'secret' } }); expect(value.list().map((item) => item.proxy.password)).toEqual(['secret', 'secret']); expect(readFileSync(file, 'utf8')).not.toContain('secret'); });
  it('normalizes legacy account records and persists a stable fingerprint', () => { const { value, file } = service(); writeFileSync(file, JSON.stringify([{ id: 1, name: '旧 Dola', kind: 'Dola', proxy: { enabled: false } }])); const account = value.list()[0]!; expect(account.platform).toBe('dola'); expect(account.id).toBe('legacy_1'); expect(account.fingerprint.seed).toBeTruthy(); const saved = JSON.parse(readFileSync(file, 'utf8')) as Array<{ schemaVersion: number; fingerprint: { seed: string } }>; expect(saved[0]?.schemaVersion).toBe(2); expect(saved[0]?.fingerprint.seed).toBe(account.fingerprint.seed); });
  it('preserves browser, fingerprint and subscription metadata when importing exported accounts', () => {
    const { value } = service();
    const source = value.create({
      ...input('可 round-trip'),
      group: '迁移',
      browser: { homeUrl: 'https://example.test/home', lastUrl: 'https://example.test/last', zoomFactor: 1.25, restoreOnStart: false },
      fingerprint: { ...value.create(input('临时')).fingerprint, enabled: true, seed: 'stable_seed_1' },
      proxy: { enabled: true, mode: 'subscription', type: 'socks5', host: '', port: undefined, subscriptionUrl: 'https://example.test/sub', subscriptionUserAgent: 'round-trip', selectedNodeName: '节点 A', selectedNodeTag: 'node-a', subscriptionConfigJson: '{"outbounds":[]}', subscriptionNodes: [{ name: '节点 A', scheme: 'socks5', host: '127.0.0.1', port: 1080, username: '', password: '', tag: 'node-a', configJson: '{"type":"socks","tag":"node-a"}', latencyMs: 12, realIp: '203.0.113.10' }] }
    });
    const exported = { ...source, proxy: { ...source.proxy, password: '' } };
    const imported = new AccountService(join(dirs[0]!, 'round-trip.json'));
    expect(imported.importMetadata([exported])).toBe(1);
    const copy = imported.list()[0]!;
    expect(copy.browser).toEqual(source.browser);
    expect(copy.fingerprint.seed).toBe('stable_seed_1');
    expect(copy.proxy.subscriptionUrl).toBe(source.proxy.subscriptionUrl);
    expect(copy.proxy.subscriptionNodes[0]?.tag).toBe('node-a');
  });
});
