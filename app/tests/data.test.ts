import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { prepareDataPaths, ProfileLocationService, resolveDataBase, resolveDataPaths, resolveProfileLocation, normalizeProfileLocation, type DataPathOptions, type DataPaths } from '../src/main/data';

describe('portable data path', () => {
  it('keeps Windows portable data beside the executable', () => {
    expect(resolveDataBase({ packaged: true, platform: 'win32', cwd: 'C:\\dev', executableDirectory: 'C:\\app', appDataDirectory: 'C:\\Users\\tester\\AppData', portableDirectory: 'D:\\portable' })).toBe('D:\\portable');
  });

  it('keeps installed Windows data in user Application Data', () => {
    expect(resolveDataBase({ packaged: true, platform: 'win32', cwd: 'C:\\dev', executableDirectory: 'C:\\Program Files\\AI\\', appDataDirectory: 'C:\\Users\\tester\\AppData' })).toBe(join('C:\\Users\\tester\\AppData', 'AI创作工作台'));
  });

  it('keeps macOS packaged data in user Application Support', () => {
    expect(resolveDataBase({ packaged: true, platform: 'darwin', cwd: '/src', executableDirectory: '/Applications/AI.app/Contents/MacOS', appDataDirectory: '/Users/tester/Library/Application Support', portableDirectory: '/wrong' })).toBe(join('/Users/tester/Library/Application Support', 'AI创作工作台'));
  });

  it('uses the project directory in development', () => {
    expect(resolveDataBase({ packaged: false, platform: 'darwin', cwd: 'D:\\workbench', executableDirectory: '/ignored', appDataDirectory: '/ignored' })).toBe('D:\\workbench');
  });

  it('reports a clear error when the portable directory cannot be created', () => {
    const parent = mkdtempSync(join(tmpdir(), 'workbench-readonly-')); const root = join(parent, 'occupied'); writeFileSync(root, 'not a directory');
    const paths: DataPaths = { root, config: join(root, 'config'), sessions: join(root, 'sessions'), logs: join(root, 'logs'), downloads: join(root, 'downloads'), updates: join(root, 'updates') };
    expect(() => prepareDataPaths(paths)).toThrow(/便携数据目录不可写/);
  });

  it('persists a selected profile root and reports that a restart is required', () => {
    const parent = mkdtempSync(join(tmpdir(), 'workbench-profile-'));
    const options: DataPathOptions = { packaged: false, platform: process.platform, cwd: parent, executableDirectory: parent, appDataDirectory: parent };
    const defaultPath = resolveProfileLocation(options).path;
    const selectedPath = join(parent, 'profiles-on-d');
    try {
      const service = new ProfileLocationService(options);
      expect(service.get()).toMatchObject({ path: defaultPath, activePath: defaultPath, restartRequired: false, custom: false });
      expect(service.select(selectedPath)).toMatchObject({ path: selectedPath, activePath: defaultPath, restartRequired: true, custom: true });
      expect(resolveProfileLocation(options).path).toBe(selectedPath);
      expect(resolveDataPaths(options, selectedPath).sessions).toBe(selectedPath);
      const restarted = new ProfileLocationService(options);
      expect(restarted.get()).toMatchObject({ path: selectedPath, activePath: selectedPath, restartRequired: false, custom: true });
      expect(restarted.reset()).toMatchObject({ path: defaultPath, activePath: selectedPath, restartRequired: true, custom: false });
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('rejects putting macOS profile data inside an application bundle', () => {
    expect(() => normalizeProfileLocation('/Applications/AI创作工作台.app/Contents/Resources/data', 'darwin')).toThrow(/应用包内/);
  });
});
