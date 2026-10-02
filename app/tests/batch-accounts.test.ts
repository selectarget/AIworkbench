import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`safe:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^safe:/, '')
  }
}));

import { AccountService } from '../src/main/accounts';
import { purgeOrphanProfiles } from '../src/main/session-cleanup';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) {
    try {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function service(): { value: AccountService; file: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'workbench-batch-test-'));
  dirs.push(dir);
  const file = join(dir, 'accounts.json');
  return { value: new AccountService(file), file, dir };
}

describe('V6.8 batch account creation and orphan cleanup', () => {
  it('batch creates accounts with auto-numbering and distinct fingerprints', () => {
    const { value, file } = service();
    const created = value.batchCreate({
      count: 5,
      platform: 'doubao',
      namePrefix: '测试账号',
      startNumber: 1,
      group: '生产批次'
    });

    expect(created).toHaveLength(5);
    expect(created[0]?.name).toBe('测试账号 01');
    expect(created[1]?.name).toBe('测试账号 02');
    expect(created[4]?.name).toBe('测试账号 05');
    expect(created.every((item) => item.platform === 'doubao')).toBe(true);
    expect(created.every((item) => item.group === '生产批次')).toBe(true);

    // Each account should have a distinct ID and fingerprint seed
    const ids = new Set(created.map((item) => item.id));
    expect(ids.size).toBe(5);
    const seeds = new Set(created.map((item) => item.fingerprint.seed));
    expect(seeds.size).toBe(5);

    // Check persistence
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Array<{ name: string }>;
    expect(saved).toHaveLength(5);
    expect(saved[0]?.name).toBe('测试账号 01');
  });

  it('rejects count outside [1, 50] range', () => {
    const { value } = service();
    expect(() => {
      value.batchCreate({ count: 0, platform: 'dola' });
    }).toThrow();

    expect(() => {
      value.batchCreate({ count: 51, platform: 'dola' });
    }).toThrow();
  });

  it('purges orphan profile directories while preserving active accounts', () => {
    const root = mkdtempSync(join(tmpdir(), 'workbench-partitions-test-'));
    dirs.push(root);

    const activeId1 = 'active_account_001_xxxx';
    const activeId2 = 'active_account_002_yyyy';
    const orphanId1 = 'orphan_account_003_zzzz';
    const orphanId2 = 'orphan_account_004_wwww';

    // Create directories under partitions root
    mkdirSync(join(root, `account_${activeId1}`));
    mkdirSync(join(root, `account_${activeId2}`));
    mkdirSync(join(root, `account_${orphanId1}`));
    mkdirSync(join(root, orphanId2)); // legacy direct format
    // Also a regular non-account directory that should not be touched
    mkdirSync(join(root, 'SystemData'));

    const purged = purgeOrphanProfiles([activeId1, activeId2], root);

    expect(purged).toHaveLength(2);
    expect(purged).toContain(join(root, `account_${orphanId1}`));
    expect(purged).toContain(join(root, orphanId2));

    // Active directories and system directory must remain
    expect(existsSync(join(root, `account_${activeId1}`))).toBe(true);
    expect(existsSync(join(root, `account_${activeId2}`))).toBe(true);
    expect(existsSync(join(root, 'SystemData'))).toBe(true);

    // Orphan directories must be gone
    expect(existsSync(join(root, `account_${orphanId1}`))).toBe(false);
    expect(existsSync(join(root, orphanId2))).toBe(false);
  });
});
