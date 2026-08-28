import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('electron', () => ({ net: { fetch: vi.fn() }, session: {} }));

import { net } from 'electron';
import { ExternalLoginService } from '../src/main/external-login';

describe('external login process lifecycle', () => {
  it('does not remove a replacement process when an older close finishes late', async () => {
    let release!: (value: { ok: boolean; json(): Promise<Record<string, unknown>> }) => void;
    vi.mocked(net.fetch).mockReturnValueOnce(new Promise((resolve) => { release = resolve; }) as never);

    const service = new ExternalLoginService('C:/tmp/external-login', { list: vi.fn(() => []) } as never);
    const running = (service as unknown as { running: Map<string, unknown> }).running;
    const oldProcess = { exitCode: null, signalCode: null, kill: vi.fn() };
    const replacementProcess = { exitCode: null, signalCode: null, kill: vi.fn() };
    const old = { process: oldProcess, port: 41001 };
    const replacement = { process: replacementProcess, port: 41002 };
    running.set('account_dola', old);

    const closing = service.close('account_dola');
    await Promise.resolve();
    running.set('account_dola', replacement);
    release({ ok: true, json: async () => ({}) });
    await closing;

    expect(running.get('account_dola')).toBe(replacement);
  });

  it('removes the account-scoped external browser profile on account deletion', async () => {
    const root = join(tmpdir(), `workbench-external-login-${process.pid}-${Date.now()}`);
    const profile = join(root, 'account_dola');
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, 'Cookies'), 'test');
    try {
      const service = new ExternalLoginService(root, { list: vi.fn(() => []) } as never);
      await service.removeAccount('account_dola');
      expect(existsSync(profile)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('clears every tracked external browser and terminates its launcher', async () => {
    const service = new ExternalLoginService('C:/tmp/external-login', { list: vi.fn(() => []) } as never);
    const running = (service as unknown as { running: Map<string, unknown> }).running;
    const firstProcess = { exitCode: null, signalCode: null, kill: vi.fn() };
    const secondProcess = { exitCode: null, signalCode: null, kill: vi.fn() };
    running.set('account_one', { process: firstProcess, port: 41001 });
    running.set('account_two', { process: secondProcess, port: 41002 });

    await service.closeAll();

    expect(running.size).toBe(0);
    expect(firstProcess.kill).toHaveBeenCalled();
    expect(secondProcess.kill).toHaveBeenCalled();
  });
});
