import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import type { LegacyCacheCleanReport, LegacyCacheCandidate, LegacyCacheScan } from '../shared/contracts';

const FRESH_RUNTIME_GRACE_MS = 30 * 60 * 1000;
const TEMP_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type LegacyCacheRule = 'local-appdata-single' | 'temp-full' | 'temp-normal-child' | 'temp-legacy-child';

export type LegacyCacheRoots = {
  localAppData?: string;
  temp?: string;
  activeDirs?: string[];
  now?: () => number;
};

type CacheCandidateRecord = LegacyCacheCandidate & { rule: LegacyCacheRule };

function canonicalPath(value: string): string {
  return resolve(value);
}

function pathKey(value: string): string {
  const normalized = canonicalPath(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function sameOrNested(left: string, right: string): boolean {
  const a = pathKey(left);
  const b = pathKey(right);
  return a === b || a.startsWith(`${b}${sep}`) || b.startsWith(`${a}${sep}`);
}

function isRealDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function directorySize(path: string): number {
  let total = 0;
  const visit = (current: string): void => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(current, entry.name);
      try {
        // Do not follow symlinks while measuring or cleaning legacy folders.
        const info = lstatSync(child);
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory()) visit(child);
        else if (info.isFile()) total += info.size;
      } catch {
        // Files can disappear or be locked while the directory is being scanned.
      }
    }
  };
  visit(path);
  return total;
}

function listChildDirectories(parent: string): string[] {
  if (!isRealDirectory(parent)) return [];
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(parent, entry.name));
  } catch {
    return [];
  }
}

function toCandidate(path: string, source: LegacyCacheCandidate['source'], rule: LegacyCacheRule, minimumAgeMs: number, now: number, activeDirs: readonly string[]): CacheCandidateRecord | null {
  const fullPath = canonicalPath(path);
  if (!isRealDirectory(fullPath) || activeDirs.some((active) => sameOrNested(fullPath, active))) return null;
  const name = basename(fullPath);
  if (rule === 'local-appdata-single' && !/^DolaMultiBrowser_FullSingle/i.test(name)) return null;
  if (rule === 'temp-full' && name.toLowerCase() !== 'dolamultibrowserfullfolder') return null;
  try {
    const stat = lstatSync(fullPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    const ageMs = now - stat.mtimeMs;
    if (ageMs < minimumAgeMs) return null;
    return {
      path: fullPath,
      source,
      modifiedAt: new Date(stat.mtimeMs).toISOString(),
      ageHours: Math.max(0, Math.floor(ageMs / (60 * 60 * 1000))),
      sizeBytes: directorySize(fullPath),
      rule
    };
  } catch {
    return null;
  }
}

/**
 * Safe, opt-in replacement for V4.4's StartupCacheCleaner.
 *
 * The scanner only knows four exact legacy locations/rules. It never accepts
 * arbitrary paths from the renderer and it never touches account sessions,
 * downloads, application files, or the user's general temp directory.
 */
export class LegacyCacheCleaner {
  private readonly roots: LegacyCacheRoots;

  public constructor(roots: LegacyCacheRoots) {
    this.roots = roots;
  }

  private activeDirs(): string[] {
    return [...new Set((this.roots.activeDirs ?? []).filter(Boolean).map(canonicalPath))];
  }

  private records(): CacheCandidateRecord[] {
    const now = this.roots.now?.() ?? Date.now();
    const activeDirs = this.activeDirs();
    const candidates: CacheCandidateRecord[] = [];
    const add = (path: string, source: LegacyCacheCandidate['source'], rule: LegacyCacheRule, minimumAgeMs: number): void => {
      const candidate = toCandidate(path, source, rule, minimumAgeMs, now, activeDirs);
      if (candidate) candidates.push(candidate);
    };
    const localAppData = this.roots.localAppData ? canonicalPath(this.roots.localAppData) : '';
    const temp = this.roots.temp ? canonicalPath(this.roots.temp) : '';

    if (localAppData && isRealDirectory(localAppData)) {
      for (const path of listChildDirectories(localAppData).filter((item) => /^DolaMultiBrowser_FullSingle/i.test(basename(item)))) {
        add(path, 'local-appdata', 'local-appdata-single', FRESH_RUNTIME_GRACE_MS);
      }
    }
    if (temp && isRealDirectory(temp)) {
      add(join(temp, 'DolaMultiBrowserFullFolder'), 'temp-full', 'temp-full', FRESH_RUNTIME_GRACE_MS);
      for (const path of listChildDirectories(join(temp, 'DolaMultiBrowserNormal'))) add(path, 'temp-normal', 'temp-normal-child', FRESH_RUNTIME_GRACE_MS);
      for (const path of listChildDirectories(join(temp, 'DolaMultiBrowser'))) add(path, 'temp-legacy', 'temp-legacy-child', TEMP_CACHE_MAX_AGE_MS);
    }
    const unique = new Map<string, CacheCandidateRecord>();
    for (const candidate of candidates) unique.set(pathKey(candidate.path), candidate);
    return [...unique.values()].sort((left, right) => left.path.localeCompare(right.path));
  }

  public scan(): LegacyCacheScan {
    const candidates = this.records().map(({ rule: _rule, ...candidate }) => candidate);
    return {
      scannedAt: new Date(this.roots.now?.() ?? Date.now()).toISOString(),
      candidates,
      totalBytes: candidates.reduce((total, candidate) => total + candidate.sizeBytes, 0)
    };
  }

  public clean(): LegacyCacheCleanReport {
    // Re-scan immediately before deletion so a preview cannot become a stale
    // deletion list after the user spends time reviewing it.
    const records = this.records();
    const deleted: LegacyCacheCandidate[] = [];
    const failed: Array<{ candidate: LegacyCacheCandidate; error: string }> = [];
    for (const record of records) {
      const { rule: _rule, ...candidate } = record;
      try {
        if (!existsSync(candidate.path) || !isRealDirectory(candidate.path)) {
          failed.push({ candidate, error: '目录已不存在或不是普通目录' });
          continue;
        }
        rmSync(candidate.path, { recursive: true, force: false });
        if (existsSync(candidate.path)) {
          failed.push({ candidate, error: '删除后目录仍存在' });
          continue;
        }
        deleted.push(candidate);
      } catch (error) {
        failed.push({ candidate, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return {
      cleanedAt: new Date(this.roots.now?.() ?? Date.now()).toISOString(),
      deleted,
      failed,
      freedBytes: deleted.reduce((total, candidate) => total + candidate.sizeBytes, 0),
      remaining: this.scan()
    };
  }
}

export function runtimeLegacyCacheRoots(activeDirs: string[] = []): LegacyCacheRoots {
  const localAppData = process.platform === 'win32' ? process.env.LOCALAPPDATA : undefined;
  return { localAppData, temp: process.env.TEMP || process.env.TMP || undefined, activeDirs };
}
