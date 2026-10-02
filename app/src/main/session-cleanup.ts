import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionDataKind } from '../shared/contracts';

/**
 * The subset of Electron.Session used by the cleanup paths. Keeping this
 * small makes the destructive operation easy to test without constructing a
 * BrowserWindow or a real Chromium profile.
 */
export type SessionCleanupTarget = {
  clearCache(): Promise<void>;
  clearStorageData(options?: { storages?: string[] }): Promise<void>;
  closeAllConnections(): Promise<void>;
  flushStorageData?: () => void | Promise<void>;
};

/**
 * Clear the requested persistent data and flush the backing store before the
 * account metadata is removed. SessionStorage is renderer-memory state, so
 * closing the account WebContents (done by BrowserManager) clears it too.
 */
export async function clearSessionData(target: SessionCleanupTarget, kind: SessionDataKind): Promise<void> {
  if (kind === 'cache' || kind === 'all') await target.clearCache();
  if (kind === 'cookies') await target.clearStorageData({ storages: ['cookies'] });
  else if (kind === 'storage') await target.clearStorageData({ storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'filesystem'] });
  else if (kind === 'all') await target.clearStorageData();
  await target.flushStorageData?.();
  await target.closeAllConnections();
}

/**
 * Scans a profile root directory (such as Partitions or legacy Profiles)
 * and safely purges folders that do not match any active account ID.
 *
 * Aligns with V6.8 ScheduleOrphanProfileFolderCleanup & IsSafeToDeleteProfileResidue.
 */
export function purgeOrphanProfiles(activeAccountIds: readonly string[], profileRoot: string): string[] {
  if (!existsSync(profileRoot)) return [];
  try {
    if (!lstatSync(profileRoot).isDirectory()) return [];
  } catch {
    return [];
  }
  const activeSet = new Set(activeAccountIds);
  const activePartitionSet = new Set(activeAccountIds.map((id) => `account_${id}`));
  const purged: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(profileRoot);
  } catch {
    return [];
  }

  for (const name of entries) {
    const isPartition = name.startsWith('account_');
    const isLegacyNumeric = /^\d+$/.test(name) || /^legacy_\d+/.test(name);
    const isUuidOrId = /^[a-fA-F0-9]{32}$/.test(name) || /^[a-zA-Z0-9_-]{20,80}$/.test(name);

    if (!isPartition && !isLegacyNumeric && !isUuidOrId) {
      // Not an account profile directory format (e.g. system folder)
      continue;
    }

    const accountId = isPartition ? name.slice('account_'.length) : name;

    if (!activeSet.has(accountId) && !activePartitionSet.has(name)) {
      const targetDir = join(profileRoot, name);
      try {
        if (lstatSync(targetDir).isDirectory()) {
          rmSync(targetDir, { recursive: true, force: true });
          purged.push(targetDir);
        }
      } catch {
        // Skip locked or non-removable folders
      }
    }
  }

  return purged;
}
