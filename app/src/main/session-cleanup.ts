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
