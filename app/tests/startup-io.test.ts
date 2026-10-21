import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(`safe:${value}`), decryptString: (value: Buffer) => value.toString().replace(/^safe:/, '') }, app: { getPath: () => tmpdir() }, net: {}, session: {}, shell: {} }));
import { AccountService } from '../src/main/accounts';
import { AtomicStore } from '../src/main/atomic-store';
import { Logger } from '../src/main/logger';
import { MediaService } from '../src/main/media';

const dirs: string[] = [];
afterEach(() => { vi.useRealTimers(); while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });
function tempDir(): string { const dir = mkdtempSync(join(tmpdir(), 'workbench-io-')); dirs.push(dir); return dir; }
const input = (name: string) => ({ name, platform: 'doubao' as const, group: '', remark: '', customUrl: '', proxy: { enabled: false, type: 'http' as const, host: '', username: '', password: '' } });

describe('navigation location batching', () => {
  it('shows the latest location immediately and writes it to disk only on flush', () => {
    const file = join(tempDir(), 'accounts.json'); const accounts = new AccountService(file); const account = accounts.create(input('A'));
    accounts.setLastUrl(account.id, 'https://www.doubao.com/chat/1');
    expect(accounts.get(account.id)?.browser.lastUrl).toBe('https://www.doubao.com/chat/1');
    expect(readFileSync(file, 'utf8')).not.toContain('/chat/1');
    accounts.flush();
    expect(readFileSync(file, 'utf8')).toContain('https://www.doubao.com/chat/1');
    expect(new AccountService(file).get(account.id)?.browser.lastUrl).toBe('https://www.doubao.com/chat/1');
  });
  it('lets an explicit browser profile edit replace a location that is still pending', () => {
    const file = join(tempDir(), 'accounts.json'); const accounts = new AccountService(file); const account = accounts.create(input('A'));
    accounts.setLastUrl(account.id, 'https://www.doubao.com/chat/old');
    accounts.update(account.id, { browser: { ...account.browser, lastUrl: 'https://www.doubao.com/chat/edited' } });
    accounts.flush();
    expect(new AccountService(file).get(account.id)?.browser.lastUrl).toBe('https://www.doubao.com/chat/edited');
  });
});

describe('atomic store read cache', () => {
  it('parses the file again after another writer replaces it', () => {
    const file = join(tempDir(), 'value.json'); const store = new AtomicStore(file, z.object({ name: z.string() }), { name: 'default' });
    store.write({ name: 'first' });
    expect(store.read().name).toBe('first');
    writeFileSync(file, JSON.stringify({ name: 'replaced by restore' }));
    expect(store.read().name).toBe('replaced by restore');
    const copy = store.read(); copy.name = 'mutated';
    expect(store.read().name).toBe('replaced by restore');
  });
});

describe('buffered logger', () => {
  it('does not write synchronously and keeps every line after flushSync', () => {
    const dir = tempDir(); const logger = new Logger(dir); const file = join(dir, 'workbench.log');
    logger.info('first'); logger.warn('token=secret');
    expect(existsSync(file)).toBe(false);
    logger.flushSync();
    const text = readFileSync(file, 'utf8');
    expect(text).toMatch(/INFO first\n/);
    expect(text).toContain('token=[REDACTED]');
  });
});

describe('download progress coalescing', () => {
  it('keeps byte counters in memory and coalesces broadcasts while status changes stay immediate', () => {
    vi.useFakeTimers();
    const dir = tempDir(); const tasksFile = join(dir, 'tasks.json');
    const accounts = { list: () => [] } as any; const settings = { get: () => ({ downloadDir: dir, videoDownloadDir: '', downloadConcurrency: 1, downloadRetryCount: 0 }) } as any;
    const media = new MediaService(accounts, settings, undefined, undefined, tasksFile, join(dir, 'cache'));
    const now = new Date().toISOString();
    (media as any).taskMap.set('t1', { id: 't1', resourceId: 'r1', accountId: 'a1', title: 'video', status: 'running', receivedBytes: 0, attempts: 0, createdAt: now, updatedAt: now });
    const listener = vi.fn(); media.onTasks(listener);
    (media as any).updateTask('t1', { receivedBytes: 100, progress: 10 });
    (media as any).updateTask('t1', { receivedBytes: 200, progress: 20 });
    expect(listener).not.toHaveBeenCalled();
    expect(readFileSync(tasksFile, 'utf8')).not.toContain('"receivedBytes": 200');
    vi.advanceTimersByTime(300);
    expect(listener).toHaveBeenCalledTimes(1);
    media.flush();
    expect(readFileSync(tasksFile, 'utf8')).toContain('"receivedBytes": 200');
    (media as any).updateTask('t1', { status: 'paused' });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(readFileSync(tasksFile, 'utf8')).toContain('"paused"');
  });
});
