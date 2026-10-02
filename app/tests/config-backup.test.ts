import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigBackupService } from '../src/main/config-backup';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe('configuration backups', () => {
  it('backs up only configuration, once a day, and validates imports', () => {
    const root = mkdtempSync(join(tmpdir(), 'config-backup-')); dirs.push(root);
    writeFileSync(join(root, 'settings.json'), JSON.stringify({ downloadDir: join(root, 'downloads'), parseImages: true }));
    writeFileSync(join(root, 'accounts.json'), '[]');
    const service = new ConfigBackupService(root); const path = service.automatic();
    expect(service.automatic()).toBe(path); expect(readdirSync(service.folder)).toHaveLength(1);
    expect(service.read(path)).toMatchObject({ format: 'ai-workbench-config', version: 1, settings: { parseImages: true } });
    const invalid = join(root, 'invalid.json'); writeFileSync(invalid, '{"format":"other"}');
    expect(() => service.read(invalid)).toThrow();
  });
});
