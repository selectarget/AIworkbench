import { mkdtempSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ net: {}, session: {} }));

import { SingBoxRuntimeManager } from '../src/main/proxy';

type TestAccount = {
  id: string;
  proxy: Record<string, unknown>;
};

function terminateProcess(pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(pid), '/t', '/f'], (error) => error ? reject(error) : resolve());
      return;
    }
    try {
      process.kill(pid, 'SIGKILL');
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

async function waitForState(manager: SingBoxRuntimeManager, accountId: string, predicate: (status: ReturnType<SingBoxRuntimeManager['getState']>) => boolean, timeoutMs = 5000): Promise<ReturnType<SingBoxRuntimeManager['getState']>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = manager.getState(accountId);
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`等待 sing-box 状态超时：${JSON.stringify(manager.getState(accountId))}`);
}

describe('sing-box runtime lifecycle', () => {
  const previousExecutable = process.env.SING_BOX_PATH;
  const tempRoots: string[] = [];

  afterEach(() => {
    if (previousExecutable === undefined) delete process.env.SING_BOX_PATH;
    else process.env.SING_BOX_PATH = previousExecutable;
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('shares one startup process when several callers open the same account concurrently', async () => {
    const executable = resolve(process.cwd(), 'sing-box', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'sing-box.exe' : 'sing-box');
    process.env.SING_BOX_PATH = executable;
    const account: TestAccount = {
      id: 'account123',
      proxy: {
        enabled: true,
        mode: 'subscription',
        selectedNodeTag: 'direct',
        selectedNodeName: 'direct',
        subscriptionNodes: [{ tag: 'direct', name: 'direct', configJson: JSON.stringify({ type: 'direct' }) }],
        subscriptionConfigJson: JSON.stringify({ log: { level: 'error' }, outbounds: [{ type: 'direct', tag: 'direct' }] })
      }
    };
    const accounts = {
      get: (id: string) => id === account.id ? account : undefined,
      update: (_id: string, patch: { proxy: Record<string, unknown> }) => { account.proxy = patch.proxy; return account; }
    };
    const root = mkdtempSync(resolve(tmpdir(), 'workbench-proxy-test-'));
    tempRoots.push(root);
    const manager = new SingBoxRuntimeManager(root, accounts as never);
    const states = await Promise.all([manager.ensureStarted(account.id), manager.ensureStarted(account.id), manager.ensureStarted(account.id)]);
    expect(new Set(states.map((state) => state.localPort)).size).toBe(1);
    expect(new Set(states.map((state) => state.pid)).size).toBe(1);
    expect(states[0]?.status).toBe('running');
    await Promise.all([manager.stop(account.id), manager.stop(account.id), manager.stop(account.id)]);
    expect(manager.getState(account.id).status).toBe('idle');
  }, 20_000);

  it('reports a crashed runtime instead of falling back to direct, then recovers only after an explicit restart', async () => {
    const executable = resolve(process.cwd(), 'sing-box', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'sing-box.exe' : 'sing-box');
    process.env.SING_BOX_PATH = executable;
    const account: TestAccount = {
      id: 'account-crash',
      proxy: {
        enabled: true,
        mode: 'subscription',
        selectedNodeTag: 'direct',
        selectedNodeName: 'direct',
        subscriptionNodes: [{ tag: 'direct', name: 'direct', configJson: JSON.stringify({ type: 'direct' }) }],
        subscriptionConfigJson: JSON.stringify({ log: { level: 'error' }, outbounds: [{ type: 'direct', tag: 'direct' }] })
      }
    };
    const accounts = {
      get: (id: string) => id === account.id ? account : undefined,
      update: (_id: string, patch: { proxy: Record<string, unknown> }) => { account.proxy = patch.proxy; return account; }
    };
    const root = mkdtempSync(resolve(tmpdir(), 'workbench-proxy-crash-test-'));
    tempRoots.push(root);
    const manager = new SingBoxRuntimeManager(root, accounts as never);
    const started = await manager.ensureStarted(account.id);
    expect(started.status).toBe('running');
    expect(started.pid).toBeTypeOf('number');

    await terminateProcess(started.pid!);
    const failed = await waitForState(manager, account.id, (state) => state.status === 'failed');
    expect(failed.error).toContain('sing-box 已退出');
    expect(manager.getState(account.id).status).toBe('failed');
    expect(account.proxy.lastRuntimeError).toContain('sing-box 已退出');

    const recovered = await manager.restart(account.id);
    expect(recovered.status).toBe('running');
    expect(recovered.pid).not.toBe(started.pid);
    await manager.stop(account.id);
    expect(manager.getState(account.id).status).toBe('idle');
  }, 30_000);
});
