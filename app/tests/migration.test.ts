import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { discoverLegacyInstanceRows, findLegacyFingerprintPath, legacySettingsFromConfig, mapLegacyPlatform, parseStorageBundle, proxyFromLegacy } from '../src/main/migration';
import { settingsSchema } from '../src/shared/contracts';
import { buildStorageImportScript, normalizeIndexedDbBundle } from '../src/main/storage-import';

describe('legacy migration normalization', () => {
  it('does not let an incomplete enabled proxy abort migration', () => {
    const value = proxyFromLegacy({ Enabled: true, Mode: 'direct', Host: '', Port: 0 });
    expect(value.enabled).toBe(false);
    expect(value.lastRuntimeError).toContain('缺少有效主机或端口');
  });

  it('sanitizes malformed subscription addresses while preserving usable nodes', () => {
    const value = proxyFromLegacy({ Enabled: true, Mode: 'subscription', SubscriptionUrl: 'not-a-url', SubscriptionNodes: [{ Name: 'node', Host: '127.0.0.1', Port: 1080 }] });
    expect(value.enabled).toBe(true);
    expect(value.subscriptionUrl).toBe('');
    expect(value.subscriptionNodes).toHaveLength(1);
  });

  it('maps legacy platform names', () => {
    expect(mapLegacyPlatform('Higgsfield')).toBe('higgsfield');
    expect(mapLegacyPlatform('即梦')).toBe('jimeng');
    expect(mapLegacyPlatform('unknown')).toBe('doubao');
  });

  it('maps the numeric V4.4 account kinds', () => {
    expect(mapLegacyPlatform('1')).toBe('doubao');
    expect(mapLegacyPlatform('2')).toBe('dola');
    expect(mapLegacyPlatform('3')).toBe('qianwen');
    expect(mapLegacyPlatform('4')).toBe('yunque');
    expect(mapLegacyPlatform('5')).toBe('custom');
    expect(mapLegacyPlatform('6')).toBe('higgsfield');
  });

  it('matches a fingerprint file to the right account when UserDataFolder is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'legacy-fingerprint-'));
    try {
      const alpha = join(root, 'profiles', '1 - Alpha');
      const beta = join(root, 'profiles', '2 - Beta');
      mkdirSync(alpha, { recursive: true });
      mkdirSync(beta, { recursive: true });
      writeFileSync(join(alpha, 'fingerprint_config.json'), '{}');
      writeFileSync(join(beta, 'fingerprint_config.json'), '{}');
      expect(findLegacyFingerprintPath(root, { Id: 2, Name: 'Beta' })).toBe(join(beta, 'fingerprint_config.json'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not guess between equally matching legacy fingerprint folders', () => {
    const root = mkdtempSync(join(tmpdir(), 'legacy-fingerprint-'));
    try {
      const first = join(root, 'profiles', 'Alpha-one');
      const second = join(root, 'profiles', 'Alpha-two');
      mkdirSync(first, { recursive: true });
      mkdirSync(second, { recursive: true });
      writeFileSync(join(first, 'fingerprint_config.json'), '{}');
      writeFileSync(join(second, 'fingerprint_config.json'), '{}');
      expect(findLegacyFingerprintPath(root, { Name: 'Alpha' })).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('honors an explicit relative UserDataFolder before identity matching', () => {
    const root = mkdtempSync(join(tmpdir(), 'legacy-fingerprint-'));
    try {
      const selected = join(root, 'profiles', 'selected');
      const other = join(root, 'profiles', 'other');
      mkdirSync(selected, { recursive: true });
      mkdirSync(other, { recursive: true });
      writeFileSync(join(selected, 'fingerprint_config.json'), '{}');
      writeFileSync(join(other, 'fingerprint_config.json'), '{}');
      expect(findLegacyFingerprintPath(root, { Name: 'not-the-folder', UserDataFolder: 'profiles/selected' })).toBe(join(selected, 'fingerprint_config.json'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('discovers account rows from a legacy ProfileRoot when AppConfig is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'legacy-profile-root-'));
    try {
      const alpha = join(root, 'Alpha');
      const beta = join(root, 'Beta');
      mkdirSync(join(alpha, 'EBWebView'), { recursive: true });
      mkdirSync(beta, { recursive: true });
      writeFileSync(join(alpha, 'account_config.json'), JSON.stringify({ type: '5', homeUrl: 'https://example.com/work' }));
      writeFileSync(join(beta, 'fingerprint_config.json'), '{}');
      expect(discoverLegacyInstanceRows(root)).toEqual([
        { Id: 1, Name: 'Alpha', Kind: '5', UserDataFolder: alpha, HomeUrl: 'https://example.com/work' },
        { Id: 2, Name: 'Beta', Kind: '1', UserDataFolder: beta }
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('previews and maps legacy download, boss-key, and home-url settings', () => {
    const fallback = settingsSchema.parse({ bossKey: { key: 'H', ctrl: true, alt: true, shift: false, meta: false, enabled: false } });
    const value = legacySettingsFromConfig('C:/legacy-profile', {
      VideoDownloadRoot: 'downloads',
      ProfileRoot: 'profiles',
      BossKey: { Key: 'J', Ctrl: false, Alt: true, Shift: true, Win: true },
      Instances: [{ Name: 'custom', Kind: '5', HomeUrl: 'https://example.com/work' }, { Name: 'bad', Kind: '1', HomeUrl: 'javascript:alert(1)' }]
    }, fallback);
    expect(value.downloadDir).toBe(resolve('C:/legacy-profile', 'downloads'));
    expect(value.hasDownloadDir).toBe(true);
    expect(value.videoDownloadDir).toBe(resolve('C:/legacy-profile', 'downloads'));
    expect(value.hasVideoDownloadDir).toBe(true);
    expect(value.legacyV44MediaFolders).toBe(true);
    expect(value.hasLegacyV44MediaFolders).toBe(true);
    expect(value.profileRoot).toBe(resolve('C:/legacy-profile', 'profiles'));
    expect(value.hasProfileRoot).toBe(true);
    expect(value.bossKey).toEqual({ key: 'J', ctrl: false, alt: true, shift: true, meta: true, enabled: true });
    expect(value.hasBossKey).toBe(true);
    expect(value.homeUrlCount).toBe(1);
  });

  it('imports the legacy Dola aspect-ratio preference from the config directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'legacy-dola-ratio-'));
    try {
      writeFileSync(join(root, 'dola-video-ratio.txt'), '21:9\n');
      const fallback = settingsSchema.parse({});
      const value = legacySettingsFromConfig(root, { Instances: [] }, fallback);
      expect(value.dolaAspectRatio).toBe('21:9');
      expect(value.hasDolaAspectRatio).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps current settings when the legacy app did not save optional settings', () => {
    const fallback = settingsSchema.parse({ downloadDir: 'D:/downloads', bossKey: { key: 'K', ctrl: true, alt: false, shift: false, meta: false, enabled: true } });
    const value = legacySettingsFromConfig('C:/legacy-profile', { Instances: [] }, fallback);
    expect(value.downloadDir).toBe('');
    expect(value.hasDownloadDir).toBe(false);
    expect(value.videoDownloadDir).toBe('');
    expect(value.hasVideoDownloadDir).toBe(false);
    expect(value.legacyV44MediaFolders).toBe(false);
    expect(value.hasLegacyV44MediaFolders).toBe(false);
    expect(value.profileRoot).toBe('');
    expect(value.hasProfileRoot).toBe(false);
    expect(value.bossKey).toEqual(fallback.bossKey);
    expect(value.hasBossKey).toBe(false);
    expect(value.dolaAspectRatio).toBe(fallback.dolaAspectRatio);
    expect(value.hasDolaAspectRatio).toBe(false);
  });

  it('parses JSON cookie and storage bundles', () => {
    const value = parseStorageBundle(JSON.stringify({ cookies: [{ Name: 'sid', Value: 'abc', Domain: '.example.com' }], LocalStorage: { token: 42 }, SessionStorage: { step: '1' } }), false);
    expect(value.cookies?.[0]?.name).toBe('sid');
    expect(value.localStorage).toEqual({ token: 42 });
    expect(value.sessionStorage).toEqual({ step: '1' });
  });

  it('accepts legacy cookie aliases, URL-only domains and date expirations', () => {
    const value = parseStorageBundle(JSON.stringify({ Cookies: [{ name: 'sid', value: 'abc', url: 'https://example.com/login', expiresUtc: '2030-01-01T00:00:00Z', sameSite: 'None' }] }), false);
    expect(value.cookies?.[0]?.domain).toBe('example.com');
    expect(value.cookies?.[0]?.secure).toBe(true);
    expect(value.cookies?.[0]?.expires).toBe(1893456000);
  });

  it('parses quoted CSV cookie fields', () => {
    const value = parseStorageBundle('name,value,domain,path\n"sid","a,b",".example.com","/"\n', true);
    expect(value.cookies).toEqual([{ name: 'sid', value: 'a,b', domain: '.example.com', path: '/', expires: undefined, secure: false, httpOnly: false, sameSite: undefined }]);
  });

  it('normalizes the legacy structured IndexedDB format and protects limits', () => {
    const value = normalizeIndexedDbBundle({ databases: [{ name: 'app-db', version: 3, objectStores: [{ name: 'records', keyPath: 'id', indexes: [{ name: 'by-kind', keyPath: 'kind', unique: true }], records: [{ value: { id: 'a', kind: 'image', nested: { ok: true } } }, { value: { id: 'b', kind: 'video' } }] }, { name: 'key-value', keyPath: null, records: [{ key: 'answer', value: 42 }] }] }] });
    expect(value.bundle?.databases[0]?.objectStores?.[0]?.records).toHaveLength(2);
    expect(value.bundle?.databases[0]?.objectStores?.[0]?.indexes?.[0]?.unique).toBe(true);
    expect(value.bundle?.databases[0]?.objectStores?.[1]?.keyPath).toBeNull();
    expect(value.recordCount).toBe(3);
    expect(value.warnings).toEqual([]);
  });

  it('supports serialized binary values without interpolating raw JSON as code', () => {
    const value = parseStorageBundle(JSON.stringify({ indexedDB: { databases: [{ name: 'binary-db', objectStores: [{ name: 'values', records: [{ key: 'one', value: { data: { __type: 'ArrayBuffer', value: 'AQI=' } } }] }] }] } }), false);
    const script = buildStorageImportScript(value);
    expect(value.indexedDb?.databases[0]?.objectStores?.[0]?.records?.[0]?.value).toEqual({ data: { __type: 'ArrayBuffer', value: 'AQI=' } });
    expect(script).toContain('JSON.parse(');
    expect(script).toContain('base64ToArrayBuffer');
    expect(script).not.toContain('indexedDB 需要站点具体数据库结构');
  });

  it('keeps an explicitly empty web storage object so import can clear the target', () => {
    const value = parseStorageBundle(JSON.stringify({ localStorage: {}, sessionStorage: {} }), false);
    expect(Object.prototype.hasOwnProperty.call(value, 'localStorage')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(value, 'sessionStorage')).toBe(true);
  });

  it('accepts standalone localStorage objects and common section aliases', () => {
    const value = parseStorageBundle(JSON.stringify({ local_storage: { token: 'abc', count: 2 }, session_storage: [{ key: 'step', value: '2' }] }), false);
    expect(value.localStorage).toEqual({ token: 'abc', count: 2 });
    expect(value.sessionStorage).toEqual({ step: '2' });
  });

  it('accepts standalone key/value arrays without mistaking cookie rows for storage', () => {
    const value = parseStorageBundle(JSON.stringify({ storage: [{ key: 'token', value: 'abc' }, ['theme', 'dark'], { name: 'count', value: 2 }] }), false);
    expect(value.localStorage).toEqual({ token: 'abc', theme: 'dark', count: 2 });
    const cookie = parseStorageBundle(JSON.stringify([{ name: 'sid', value: 'abc', domain: '.example.com' }]), false);
    expect(cookie.cookies).toHaveLength(1);
    expect(cookie.localStorage).toBeUndefined();
  });

  it('treats an unwrapped JSON object as localStorage and explains the inference', () => {
    const value = parseStorageBundle(JSON.stringify({ token: 'abc', theme: 'dark' }), false);
    expect(value.localStorage).toEqual({ token: 'abc', theme: 'dark' });
    expect(value.warnings?.[0]).toContain('LocalStorage');
  });
});
