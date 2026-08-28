import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

const setProxyCalls: Array<{ proxyRules?: string }> = [];
const fakeSession = {
  setProxy: vi.fn(async (value: { proxyRules?: string }) => { setProxyCalls.push(value); }),
  closeAllConnections: vi.fn(async () => undefined),
  fetch: vi.fn(async () => new Response(JSON.stringify({ ip: '203.0.113.7' }), { status: 200, headers: { 'content-type': 'application/json' } }))
};

vi.mock('electron', () => ({
  net: {},
  session: { fromPartition: vi.fn(() => fakeSession) }
}));

import { ProxyService } from '../src/main/proxy';

type TestAccount = {
  id: string;
  proxy: Record<string, unknown>;
};

describe('proxy node test lifecycle', () => {
  const previousExecutable = process.env.SING_BOX_PATH;
  const tempRoots: string[] = [];

  afterEach(() => {
    setProxyCalls.length = 0;
    fakeSession.setProxy.mockClear();
    fakeSession.closeAllConnections.mockClear();
    fakeSession.fetch.mockClear();
    if (previousExecutable === undefined) delete process.env.SING_BOX_PATH;
    else process.env.SING_BOX_PATH = previousExecutable;
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('restores the original node and Session binding after testing another node', async () => {
    process.env.SING_BOX_PATH = resolve(process.cwd(), 'sing-box', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'sing-box.exe' : 'sing-box');
    const account: TestAccount = {
      id: 'account123',
      proxy: {
        enabled: true,
        mode: 'subscription',
        type: 'socks5',
        selectedNodeTag: 'node-a',
        selectedNodeName: '节点 A',
        subscriptionNodes: [
          { tag: 'node-a', name: '节点 A', configJson: JSON.stringify({ type: 'direct', tag: 'node-a' }) },
          { tag: 'node-b', name: '节点 B', configJson: JSON.stringify({ type: 'direct', tag: 'node-b' }) }
        ],
        subscriptionConfigJson: JSON.stringify({ log: { level: 'error' }, outbounds: [{ type: 'direct', tag: 'node-a' }, { type: 'direct', tag: 'node-b' }] })
      }
    };
    const accounts = {
      get: (id: string) => id === account.id ? account : undefined,
      list: () => [account],
      update: (_id: string, patch: { proxy: Record<string, unknown> }) => { account.proxy = patch.proxy; return account; }
    };
    const root = mkdtempSync(resolve(tmpdir(), 'workbench-proxy-service-test-'));
    tempRoots.push(root);
    const service = new ProxyService(root, accounts as never);
    try {
      const result = await service.testNode(account.id, 'node-b');
      expect(result).toEqual(expect.objectContaining({ ok: true, ip: '203.0.113.7' }));
      expect(account.proxy.selectedNodeTag).toBe('node-a');
      expect(setProxyCalls).toHaveLength(2);
      expect(setProxyCalls[0]?.proxyRules).toMatch(/node-b|127\.0\.0\.1:\d+/);
      expect(setProxyCalls[1]?.proxyRules).toMatch(/127\.0\.0\.1:\d+/);
      expect(setProxyCalls[1]?.proxyRules).not.toBe(setProxyCalls[0]?.proxyRules);
      expect(fakeSession.closeAllConnections).toHaveBeenCalledTimes(2);
    } finally {
      await service.shutdown();
    }
  }, 20_000);

  it('tests every subscription node and keeps the selected node active afterwards', async () => {
    process.env.SING_BOX_PATH = resolve(process.cwd(), 'sing-box', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'sing-box.exe' : 'sing-box');
    const account: TestAccount = {
      id: 'account456',
      proxy: {
        enabled: true,
        mode: 'subscription',
        type: 'socks5',
        selectedNodeTag: 'node-a',
        selectedNodeName: '节点 A',
        subscriptionNodes: [
          { tag: 'node-a', name: '节点 A', configJson: JSON.stringify({ type: 'direct', tag: 'node-a' }) },
          { tag: 'node-b', name: '节点 B', configJson: JSON.stringify({ type: 'direct', tag: 'node-b' }) }
        ],
        subscriptionConfigJson: JSON.stringify({ log: { level: 'error' }, outbounds: [{ type: 'direct', tag: 'node-a' }, { type: 'direct', tag: 'node-b' }] })
      }
    };
    const accounts = {
      get: (id: string) => id === account.id ? account : undefined,
      list: () => [account],
      update: (_id: string, patch: { proxy: Record<string, unknown> }) => { account.proxy = patch.proxy; return account; }
    };
    const root = mkdtempSync(resolve(tmpdir(), 'workbench-proxy-batch-test-'));
    tempRoots.push(root);
    const service = new ProxyService(root, accounts as never);
    try {
      const result = await service.testAllNodes(account.id);
      expect(result.tested).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.results.map((item) => item.tag)).toEqual(['node-a', 'node-b']);
      expect(result.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ tag: 'node-a', latencyMs: expect.any(Number), realIp: '203.0.113.7' }),
        expect.objectContaining({ tag: 'node-b', latencyMs: expect.any(Number), realIp: '203.0.113.7' })
      ]));
      expect(account.proxy.selectedNodeTag).toBe('node-a');
      expect(setProxyCalls.at(-1)?.proxyRules).toMatch(/127\.0\.0\.1:\d+/);
    } finally {
      await service.shutdown();
    }
  }, 30_000);
});
