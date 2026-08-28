import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSessionData, type SessionCleanupTarget } from '../src/main/session-cleanup';

describe('persistent session cleanup', () => {
  afterEach(() => vi.restoreAllMocks());

  function target(): SessionCleanupTarget & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      clearCache: vi.fn(async () => { calls.push('cache'); }),
      clearStorageData: vi.fn(async (options?: { storages?: string[] }) => { calls.push(options?.storages?.join(',') ?? 'storage:all'); }),
      flushStorageData: vi.fn(async () => { calls.push('flush'); }),
      closeAllConnections: vi.fn(async () => { calls.push('connections'); })
    };
  }

  it('clears all persistent data and flushes before closing connections', async () => {
    const value = target();
    await clearSessionData(value, 'all');
    expect(value.calls).toEqual(['cache', 'storage:all', 'flush', 'connections']);
  });

  it('keeps scoped cleanup scoped', async () => {
    const value = target();
    await clearSessionData(value, 'cookies');
    expect(value.calls).toEqual(['cookies', 'flush', 'connections']);
    value.calls.length = 0;
    await clearSessionData(value, 'cache');
    expect(value.calls).toEqual(['cache', 'flush', 'connections']);
  });
});
