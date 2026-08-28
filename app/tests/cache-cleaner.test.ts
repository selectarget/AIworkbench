import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { LegacyCacheCleaner } from '../src/main/cache-cleaner';

const fixtures: string[] = [];
const NOW = Date.parse('2026-08-28T12:00:00.000Z');

function makeFixture(): { root: string; localAppData: string; temp: string } {
  const root = join(tmpdir(), `aiam-cache-cleaner-${process.pid}-${Date.now()}-${fixtures.length}`);
  const localAppData = join(root, 'local-app-data');
  const temp = join(root, 'temp');
  mkdirSync(localAppData, { recursive: true });
  mkdirSync(temp, { recursive: true });
  fixtures.push(root);
  return { root, localAppData, temp };
}

function oldDirectory(path: string, bytes = 'cache'): string {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'payload.bin'), bytes);
  const time = new Date(NOW - 2 * 24 * 60 * 60 * 1000);
  utimesSync(path, time, time);
  return path;
}

function recentDirectory(path: string): string {
  mkdirSync(path, { recursive: true });
  const time = new Date(NOW - 10 * 60 * 1000);
  utimesSync(path, time, time);
  return path;
}

afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('legacy temporary cache cleaner', () => {
  it('scans only the four V4.4 allowlisted locations and applies age thresholds', () => {
    const fixture = makeFixture();
    const oldSingle = oldDirectory(join(fixture.localAppData, 'DolaMultiBrowser_FullSingle-old'), '12345');
    const recentSingle = recentDirectory(join(fixture.localAppData, 'DolaMultiBrowser_FullSingle-recent'));
    const unrelated = oldDirectory(join(fixture.localAppData, 'Unrelated-old'), 'should stay');
    const oldFull = oldDirectory(join(fixture.temp, 'DolaMultiBrowserFullFolder'), 'full');
    const oldNormal = oldDirectory(join(fixture.temp, 'DolaMultiBrowserNormal', 'runtime-old'), 'normal');
    const recentNormal = recentDirectory(join(fixture.temp, 'DolaMultiBrowserNormal', 'runtime-recent'));
    const tooRecentLegacy = join(fixture.temp, 'DolaMultiBrowser', 'cache-23-hours');
    mkdirSync(tooRecentLegacy, { recursive: true });
    const almostOld = new Date(NOW - 23 * 60 * 60 * 1000);
    utimesSync(tooRecentLegacy, almostOld, almostOld);
    const oldLegacy = oldDirectory(join(fixture.temp, 'DolaMultiBrowser', 'cache-old'), 'legacy');

    const cleaner = new LegacyCacheCleaner({ localAppData: fixture.localAppData, temp: fixture.temp, now: () => NOW });
    const scan = cleaner.scan();
    expect(scan.candidates.map((item) => item.path)).toEqual([oldFull, oldLegacy, oldNormal, oldSingle].sort((a, b) => a.localeCompare(b)));
    expect(scan.totalBytes).toBe(5 + 4 + 6 + 6);
    expect(scan.candidates.find((item) => item.path === oldSingle)?.source).toBe('local-appdata');
    expect(scan.candidates.find((item) => item.path === oldNormal)?.source).toBe('temp-normal');
    expect(scan.candidates.find((item) => item.path === oldLegacy)?.source).toBe('temp-legacy');
    expect(existsSync(recentSingle)).toBe(true);
    expect(existsSync(recentNormal)).toBe(true);
    expect(existsSync(unrelated)).toBe(true);
    expect(existsSync(tooRecentLegacy)).toBe(true);
  });

  it('protects active directories and deletes only a fresh eligible scan', () => {
    const fixture = makeFixture();
    const protectedPath = oldDirectory(join(fixture.temp, 'DolaMultiBrowserNormal', 'active-runtime'), 'active');
    const removablePath = oldDirectory(join(fixture.temp, 'DolaMultiBrowserNormal', 'removable-runtime'), 'remove');
    const cleaner = new LegacyCacheCleaner({ localAppData: fixture.localAppData, temp: fixture.temp, activeDirs: [protectedPath], now: () => NOW });
    const result = cleaner.clean();
    expect(result.deleted.map((item) => item.path)).toEqual([removablePath]);
    expect(result.freedBytes).toBe(6);
    expect(result.failed).toHaveLength(0);
    expect(existsSync(removablePath)).toBe(false);
    expect(existsSync(protectedPath)).toBe(true);
    expect(result.remaining.candidates.map((item) => item.path)).toEqual([]);
  });
});
