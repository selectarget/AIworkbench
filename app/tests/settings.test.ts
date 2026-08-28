import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { AppSettings } from '../src/shared/contracts';
import { SettingsService } from '../src/main/settings';

describe('settings service', () => {
  it('migrates an empty legacy download directory to the portable default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-settings-')); const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ downloadDir: '', openTabs: [] }));
    const service = new SettingsService(file, join(dir, 'downloads'));
    expect(service.get().downloadDir).toBe(join(dir, 'downloads'));
    expect(service.get().videoDownloadDir).toBe('');
  });
  it('notifies listeners with the previous snapshot so runtime switches can reconcile open views', () => {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-settings-listener-'));
    const service = new SettingsService(join(dir, 'settings.json'), join(dir, 'downloads'));
    let previous: AppSettings | undefined;
    let next: AppSettings | undefined;
    const dispose = service.onChange((value, oldValue) => { next = value; previous = oldValue; });
    const value = service.update({ disabledAdapters: ['dola'] });
    dispose();
    expect(next?.disabledAdapters).toEqual(['dola']);
    expect(previous?.disabledAdapters).toEqual([]);
    expect(value.disabledAdapters).toEqual(['dola']);
  });
  it('persists the Dola aspect ratio in the settings file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-settings-dola-ratio-'));
    const file = join(dir, 'settings.json');
    const service = new SettingsService(file, join(dir, 'downloads'));
    service.update({ dolaAspectRatio: '9:16' });
    const reloaded = new SettingsService(file, join(dir, 'downloads'));
    expect(reloaded.get().dolaAspectRatio).toBe('9:16');
  });
});
