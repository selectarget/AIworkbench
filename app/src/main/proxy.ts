import { net, session, type Session } from 'electron';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createServer, createConnection } from 'node:net';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Account, ProxyBatchTestResult, ProxyConfig, ProxyNode, ProxyNodeTestResult, ProxyRuntimeState, ProxyTestResult, SubscriptionProfile } from '../shared/contracts';
import type { AccountService } from './accounts';
import { buildProxyRules } from './proxy-rules';
import { parseSubscription } from './subscription';

const MAX_SUBSCRIPTION_BYTES = 10 * 1024 * 1024;
type Running = { child: ChildProcess; port: number; workspace: string; selectedTag: string; startedAt: string };
type LocalHttpResponse = { statusCode: number; body: string };
const BATCH_SELECTOR_PREFIX = '__workbench_batch_selector__';

function accountOrThrow(accounts: AccountService, accountId: string): Account {
  const account = accounts.get(accountId); if (!account) throw new Error('账号不存在'); return account;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const address = server.address(); const port = typeof address === 'object' && address ? address.port : 0; server.close((error) => error ? reject(error) : resolve(port)); });
  });
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => { const socket = createConnection({ host: '127.0.0.1', port }); const finish = (value: boolean): void => { socket.destroy(); resolve(value); }; socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); setTimeout(() => finish(false), 800); });
}

async function waitForPort(port: number, timeoutMs = 12000, isCancelled?: () => boolean): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (isCancelled?.()) throw new Error('代理运行时启动已取消');
    if (await canConnect(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`sing-box 本地端口 ${port} 未监听`);
}

function executableCandidates(): string[] {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const platformArch = `${process.platform}-${process.arch}`;
  const resources = process.resourcesPath || process.cwd();
  const configured = process.env.SING_BOX_PATH?.trim();
  return [
    configured,
    join(resources, 'sing-box', platformArch, `sing-box${suffix}`),
    join(resources, 'site-assets', 'sing-box', platformArch, `sing-box${suffix}`),
    join(process.cwd(), 'sing-box', platformArch, `sing-box${suffix}`),
    join(process.cwd(), 'site-assets', 'sing-box', platformArch, `sing-box${suffix}`),
    join(process.cwd(), 'sing-box', `sing-box${suffix}`)
  ].filter((path): path is string => Boolean(path));
}

function resolveExecutable(): string {
  const path = executableCandidates().find(existsSync); if (!path) throw new Error(`未找到 sing-box 核心，请将 ${process.platform}-${process.arch} 版本放入 resources/sing-box 或设置 SING_BOX_PATH`); return path;
}

function parseConfig(value: string): Record<string, unknown> {
  try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

function subscriptionUrl(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('订阅地址格式无效'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('订阅地址只允许使用 HTTP 或 HTTPS');
  return parsed.toString();
}

function outboundFromNode(node: ProxyNode): Record<string, unknown> | null { try { const parsed = JSON.parse(node.configJson) as unknown; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null; } catch { return null; } }

function buildRuntimeConfig(proxy: ProxyConfig, selectedTag: string, port: number): Record<string, unknown> {
  const source = parseConfig(proxy.subscriptionConfigJson); const rawOutbounds = Array.isArray(source.outbounds) ? source.outbounds.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : [];
  const byTag = new Set(rawOutbounds.map((item) => String(item.tag ?? '')));
  const selectedNode = proxy.subscriptionNodes.find((node) => node.tag === selectedTag || node.name === selectedTag); const selectedOutbound = selectedNode ? outboundFromNode(selectedNode) : null;
  if (selectedOutbound && !byTag.has(selectedTag)) rawOutbounds.push({ ...selectedOutbound, tag: selectedTag });
  if (!rawOutbounds.some((item) => String(item.tag ?? '') === selectedTag)) throw new Error('选中的代理节点不在订阅配置中');
  const config: Record<string, unknown> = { ...source, inbounds: [{ type: 'socks', tag: 'account-in', listen: '127.0.0.1', listen_port: port }], outbounds: rawOutbounds, route: { ...(source.route && typeof source.route === 'object' ? source.route : {}), final: selectedTag } };
  return config;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nodeTag(node: ProxyNode): string {
  const tag = (node.tag || node.name).trim();
  if (!tag) throw new Error('订阅节点缺少标签');
  return tag;
}

function buildBatchRuntimeConfig(proxy: ProxyConfig, nodes: ProxyNode[], port: number, controlPort: number): { config: Record<string, unknown>; selectorTag: string } {
  const source = parseConfig(proxy.subscriptionConfigJson);
  const rawOutbounds = Array.isArray(source.outbounds) ? source.outbounds.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : [];
  const byTag = new Set(rawOutbounds.map((item) => String(item.tag ?? '')));
  const tags = [...new Set(nodes.map(nodeTag))];
  if (!tags.length) throw new Error('未找到可检测的节点');
  for (const node of nodes) {
    const tag = nodeTag(node);
    if (byTag.has(tag)) continue;
    const outbound = outboundFromNode(node);
    if (!outbound) throw new Error(`节点“${node.name || tag}”缺少 sing-box 配置`);
    rawOutbounds.push({ ...outbound, tag });
    byTag.add(tag);
  }
  let selectorTag = BATCH_SELECTOR_PREFIX;
  while (byTag.has(selectorTag)) selectorTag = `${BATCH_SELECTOR_PREFIX}${Math.random().toString(36).slice(2, 8)}`;
  const experimental = { ...objectValue(source.experimental), clash_api: { external_controller: `127.0.0.1:${controlPort}`, secret: '' } };
  const config: Record<string, unknown> = {
    ...source,
    inbounds: [{ type: 'mixed', tag: 'workbench-batch-in', listen: '127.0.0.1', listen_port: port }],
    outbounds: [...rawOutbounds, { type: 'selector', tag: selectorTag, outbounds: tags, default: tags[0] }],
    route: { ...objectValue(source.route), final: selectorTag },
    log: { ...objectValue(source.log), disabled: true },
    experimental
  };
  return { config, selectorTag };
}

function requestLocalHttp(port: number, path: string, method = 'GET', body = '', timeoutMs = 4000): Promise<LocalHttpResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: '127.0.0.1', port, path, method,
      headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : undefined
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { text = `${text}${chunk}`.slice(-1_000_000); });
      response.once('end', () => resolve({ statusCode: response.statusCode ?? 0, body: text }));
      response.once('error', reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`本地控制请求超时（${timeoutMs}ms）`)));
    request.once('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function waitForClashApi(port: number, timeoutMs = 5000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const response = await requestLocalHttp(port, '/proxies', 'GET', '', 500);
      if (response.statusCode >= 200 && response.statusCode < 300) return;
    } catch { /* The controller may still be starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`sing-box Clash API ${port} 未启动`);
}

async function queryClashNodeDelay(port: number, tag: string): Promise<number | null> {
  try {
    const path = `/proxies/${encodeURIComponent(tag)}/delay?timeout=3000&url=${encodeURIComponent('https://www.gstatic.com/generate_204')}`;
    const response = await requestLocalHttp(port, path, 'GET', '', 4500);
    if (response.statusCode < 200 || response.statusCode >= 300) return null;
    const parsed = JSON.parse(response.body) as { delay?: unknown };
    const delay = Number(parsed.delay);
    return Number.isFinite(delay) && delay > 0 ? delay : null;
  } catch { return null; }
}

async function selectClashNode(port: number, selectorTag: string, tag: string): Promise<boolean> {
  try {
    const response = await requestLocalHttp(port, `/proxies/${encodeURIComponent(selectorTag)}`, 'PUT', JSON.stringify({ name: tag }), 2500);
    return response.statusCode >= 200 && response.statusCode < 300;
  } catch { return false; }
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const consume = async (): Promise<void> => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => consume()));
  return results;
}

export class SingBoxRuntimeManager {
  private readonly running = new Map<string, Running>();
  // A browser open, a node test and a manual proxy refresh can all ask for
  // the same runtime at nearly the same time. Keep one startup promise per
  // account so those callers share one port and one child process.
  private readonly starting = new Map<string, Promise<ProxyRuntimeState>>();
  private readonly stopping = new Map<string, Promise<void>>();
  private readonly stopRequested = new Set<string>();
  private readonly states = new Map<string, ProxyRuntimeState>();
  private stateSink: ((state: ProxyRuntimeState) => void) | null = null;

  constructor(private readonly root: string, private readonly accounts: AccountService) { this.cleanupStale(); }
  onState(listener: (state: ProxyRuntimeState) => void): () => void {
    this.stateSink = listener;
    return () => { if (this.stateSink === listener) this.stateSink = null; };
  }

  getState(accountId: string): ProxyRuntimeState { return this.states.get(accountId) ?? { accountId, status: 'idle' }; }
  getNodes(accountId: string): ProxyNode[] { return accountOrThrow(this.accounts, accountId).proxy.subscriptionNodes; }

  async ensureStarted(accountId: string): Promise<ProxyRuntimeState> {
    const current = this.running.get(accountId); if (current && !childExited(current.child)) return this.state(accountId, 'running', current);
    const pending = this.starting.get(accountId); if (pending) return pending;
    const startup = this.startInternal(accountId);
    this.starting.set(accountId, startup);
    try { return await startup; } finally { if (this.starting.get(accountId) === startup) this.starting.delete(accountId); }
  }

  /**
   * Start a throw-away selector runtime for batch node probes. It deliberately
   * does not touch the account's live runtime or its persisted selected node.
   * The caller owns the callback lifetime and this method always tears the
   * temporary process and workspace down afterwards.
   */
  async withTemporaryProbe<T>(accountId: string, proxy: ProxyConfig, nodes: ProxyNode[], callback: (runtime: { port: number; controlPort: number; selectorTag: string }) => Promise<T>): Promise<T> {
    accountOrThrow(this.accounts, accountId);
    const executable = resolveExecutable();
    const port = await freePort();
    let controlPort = await freePort();
    while (controlPort === port) controlPort = await freePort();
    const workspace = join(this.root, 'proxy-tests', accountId, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    mkdirSync(workspace, { recursive: true });
    const configPath = join(workspace, 'config.json');
    let selectorTag = '';
    let child: ChildProcess | null = null;
    let diagnostic = '';
    try {
      const built = buildBatchRuntimeConfig(proxy, nodes, port, controlPort);
      selectorTag = built.selectorTag;
      writeFileSync(configPath, `${JSON.stringify(built.config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      child = spawn(executable, ['run', '-c', configPath], {
        cwd: workspace,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ENABLE_DEPRECATED_LEGACY_DNS_SERVERS: 'true',
          ENABLE_DEPRECATED_OUTBOUND_DNS_RULE_ITEM: 'true',
          ENABLE_DEPRECATED_MISSING_DOMAIN_RESOLVER: 'true'
        }
      });
      const report = (chunk: Buffer): void => { diagnostic = `${diagnostic}${chunk.toString('utf8')}`.slice(-2000); };
      child.stderr?.on('data', report); child.stdout?.on('data', report);
      child.once('error', (error) => { diagnostic = `${diagnostic}${error.message}`.slice(-2000); });
      await waitForPort(port, 12000);
      await waitForClashApi(controlPort, 6000);
      return await callback({ port, controlPort, selectorTag });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}${diagnostic ? `：${diagnostic}` : ''}`);
    } finally {
      if (child) await terminateChild(child);
      try { rmSync(workspace, { recursive: true, force: true }); } catch { /* best effort cleanup */ }
    }
  }

  private async startInternal(accountId: string): Promise<ProxyRuntimeState> {
    const current = this.running.get(accountId); if (current && !childExited(current.child)) return this.state(accountId, 'running', current);
    const account = accountOrThrow(this.accounts, accountId); const proxy = account.proxy;
    if (!proxy.enabled || proxy.mode !== 'subscription') throw new Error('当前账号没有启用订阅代理');
    const selectedTag = proxy.selectedNodeTag || proxy.subscriptionNodes[0]?.tag || proxy.subscriptionNodes[0]?.name;
    if (!selectedTag) throw new Error('请先刷新订阅并选择一个节点');
    let executable: string;
    try { executable = resolveExecutable(); } catch (error) { return this.fail(accountId, error); }
    const port = await freePort(); const workspace = join(this.root, 'proxy-runtimes', accountId); mkdirSync(workspace, { recursive: true });
    const configPath = join(workspace, 'config.json');
    let config: Record<string, unknown>;
    try { config = buildRuntimeConfig(proxy, selectedTag, port); writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 }); } catch (error) { return this.fail(accountId, error); }
    this.publish({ accountId, status: 'starting', localPort: port, selectedNodeTag: selectedTag });
    const child = spawn(executable, ['run', '-c', configPath], { cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const startedAt = new Date().toISOString(); const item: Running = { child, port, workspace, selectedTag, startedAt }; this.running.set(accountId, item);
    const report = (chunk: Buffer): void => { const message = chunk.toString('utf8').trim(); if (message && /error|fatal|failed/i.test(message)) this.publish({ accountId, status: 'failed', localPort: port, pid: child.pid, selectedNodeTag: selectedTag, error: message.slice(-1600) }); };
    child.stderr?.on('data', report); child.stdout?.on('data', report);
    child.once('error', (error) => { if (this.running.get(accountId)?.child === child) this.publish({ accountId, status: 'failed', localPort: port, pid: child.pid, selectedNodeTag: selectedTag, error: error.message }); });
    if (child.pid) writeFileSync(join(workspace, 'process.pid'), String(child.pid), { encoding: 'utf8', mode: 0o600 });
    child.once('exit', (code, signal) => { if (this.running.get(accountId)?.child !== child) return; this.running.delete(accountId); this.publish({ accountId, status: 'failed', localPort: port, pid: child.pid, selectedNodeTag: selectedTag, error: `sing-box 已退出（code=${code ?? 'null'}, signal=${signal ?? 'none'}）` }); });
    child.once('exit', () => { try { rmSync(workspace, { recursive: true, force: true }); } catch { /* best effort cleanup after a crash */ } });
    try {
      await waitForPort(port, 12000, () => this.stopRequested.has(accountId));
      if (this.stopRequested.has(accountId)) throw new Error('代理运行时启动已取消');
    } catch (error) { await this.stopRunning(accountId); throw error; }
    return this.state(accountId, 'running', item);
  }

  async stop(accountId: string): Promise<void> {
    const existing = this.stopping.get(accountId);
    if (existing) return existing;
    const stopping = this.stopInternal(accountId);
    this.stopping.set(accountId, stopping);
    try { await stopping; } finally { if (this.stopping.get(accountId) === stopping) this.stopping.delete(accountId); }
  }
  private async stopInternal(accountId: string): Promise<void> {
    this.stopRequested.add(accountId);
    try {
      const pending = this.starting.get(accountId);
      if (pending) { try { await pending; } catch { /* the caller receives the startup failure */ } }
      await this.stopRunning(accountId);
    } finally { this.stopRequested.delete(accountId); }
  }

  private async stopRunning(accountId: string): Promise<void> {
    const item = this.running.get(accountId); if (!item) { this.publish({ accountId, status: 'idle' }); return; }
    this.publish({ accountId, status: 'stopping', localPort: item.port, pid: item.child.pid, selectedNodeTag: item.selectedTag, startedAt: item.startedAt });
    this.running.delete(accountId); const pid = item.child.pid;
    try {
      if (process.platform === 'win32' && pid) await new Promise<void>((resolve) => execFile('taskkill', ['/pid', String(pid), '/t', '/f'], () => resolve()));
      else if (!childExited(item.child)) item.child.kill('SIGTERM');
    } catch { /* fall through to the forced termination below */ }
    await waitForChildExit(item.child, 3500);
    if (!childExited(item.child)) {
      try { item.child.kill(process.platform === 'win32' ? undefined : 'SIGKILL'); } catch { /* already stopped */ }
      await waitForChildExit(item.child, 1500);
    }
    try { rmSync(item.workspace, { recursive: true, force: true }); } catch { /* best effort cleanup */ }
    this.publish({ accountId, status: 'idle' });
  }

  async restart(accountId: string): Promise<ProxyRuntimeState> { await this.stop(accountId); return this.ensureStarted(accountId); }
  async closeAll(): Promise<void> { await Promise.all([...new Set([...this.running.keys(), ...this.starting.keys(), ...this.stopping.keys()])].map((accountId) => this.stop(accountId))); }

  private state(accountId: string, status: ProxyRuntimeState['status'], item?: Running): ProxyRuntimeState { const current = this.states.get(accountId); return { accountId, status, localPort: item?.port ?? current?.localPort, pid: item?.child.pid ?? current?.pid, selectedNodeTag: item?.selectedTag ?? current?.selectedNodeTag, startedAt: item?.startedAt ?? current?.startedAt, error: current?.error }; }
  private publish(state: ProxyRuntimeState): void {
    this.states.set(state.accountId, state);
    try {
      const account = this.accounts.get(state.accountId);
      if (account) {
        const error = state.status === 'failed' ? state.error ?? 'sing-box 运行失败' : state.status === 'running' || state.status === 'idle' ? '' : account.proxy.lastRuntimeError;
        if (account.proxy.lastRuntimeError !== error) this.accounts.update(state.accountId, { proxy: { ...account.proxy, lastRuntimeError: error } });
      }
    } catch { /* 状态上报不能阻塞代理进程生命周期 */ }
    this.stateSink?.(state);
  }
  private fail(accountId: string, error: unknown): never {
    const message = error instanceof Error ? error.message : String(error);
    this.publish({ accountId, status: 'failed', error: message });
    throw error instanceof Error ? error : new Error(message);
  }
  private cleanupStale(): void {
    const base = join(this.root, 'proxy-runtimes'); if (!existsSync(base)) return;
    // Only remove runtime metadata whose process is definitely gone. Never kill an unknown process during startup.
    for (const entry of readdirSafe(base)) { const workspace = join(base, entry); const pidPath = join(workspace, 'process.pid'); if (!existsSync(pidPath)) continue; try { const pid = Number(readFileSync(pidPath, 'utf8')); process.kill(pid, 0); } catch { try { rmSync(workspace, { recursive: true, force: true }); } catch { /* best effort */ } } }
  }
}

function readdirSafe(path: string): string[] { try { return readdirSync(path); } catch { return []; } }
function childExited(child: ChildProcess): boolean { return child.exitCode !== null || child.signalCode !== null; }
async function terminateChild(child: ChildProcess): Promise<void> {
  if (childExited(child)) return;
  try {
    if (process.platform === 'win32' && child.pid) await new Promise<void>((resolve) => execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => resolve()));
    else child.kill('SIGTERM');
  } catch { /* fall through to the forced termination below */ }
  await waitForChildExit(child, 3500);
  if (!childExited(child)) {
    try { child.kill(process.platform === 'win32' ? undefined : 'SIGKILL'); } catch { /* already stopped */ }
    await waitForChildExit(child, 1500);
  }
}
async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (childExited(child)) return;
  await Promise.race([once(child, 'exit').then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}

export class ProxyService {
  readonly runtime: SingBoxRuntimeManager;
  constructor(root: string, private readonly accounts: AccountService) { this.runtime = new SingBoxRuntimeManager(root, accounts); }

  async apply(accountId: string, target: Session): Promise<ProxyRuntimeState> {
    const account = accountOrThrow(this.accounts, accountId); const proxy = account.proxy;
    if (!proxy.enabled || proxy.mode !== 'subscription') {
      if (this.runtime.getState(accountId).status !== 'idle') await this.runtime.stop(accountId);
      if (!proxy.enabled) { await target.setProxy({ mode: 'system' }); await target.closeAllConnections(); return { accountId, status: 'idle' }; }
    }
    if (proxy.mode === 'subscription') {
      const state = await this.runtime.ensureStarted(accountId); await target.setProxy({ mode: 'fixed_servers', proxyRules: `socks5://127.0.0.1:${state.localPort}`, proxyBypassRules: '<local>' }); await target.closeAllConnections(); return state;
    }
    await target.setProxy({ mode: 'fixed_servers', proxyRules: buildProxyRules(proxy), proxyBypassRules: '<local>' }); await target.closeAllConnections(); return { accountId, status: 'running' };
  }

  async importSubscription(accountId: string, url?: string): Promise<SubscriptionProfile> {
    const account = accountOrThrow(this.accounts, accountId); const rawUrl = (url ?? account.proxy.subscriptionUrl).trim(); if (!rawUrl) throw new Error('请输入订阅地址'); const sourceUrl = subscriptionUrl(rawUrl);
    const response = await net.fetch(sourceUrl, { headers: { 'User-Agent': account.proxy.subscriptionUserAgent || 'sing-box' } }); if (!response.ok) throw new Error(`订阅请求失败：HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length')); if (length > MAX_SUBSCRIPTION_BYTES) throw new Error('订阅内容超过 10 MB 限制'); const bytes = Buffer.from(await response.arrayBuffer()); if (bytes.length > MAX_SUBSCRIPTION_BYTES) throw new Error('订阅内容超过 10 MB 限制');
    const profile = parseSubscription(bytes.toString('utf8'), sourceUrl); const selected = account.proxy.selectedNodeTag && profile.nodes.some((node) => node.tag === account.proxy.selectedNodeTag) ? profile.nodes.find((node) => node.tag === account.proxy.selectedNodeTag)! : profile.nodes[0]!;
    this.accounts.update(accountId, { proxy: { ...account.proxy, enabled: true, mode: 'subscription', type: 'socks5', subscriptionUrl: sourceUrl, subscriptionConfigJson: profile.configJson, subscriptionNodes: profile.nodes, selectedNodeName: selected.name, selectedNodeTag: selected.tag, lastRuntimeError: '' } });
    if (this.runtime.getState(accountId).status === 'running') await this.runtime.restart(accountId); return profile;
  }

  async refreshSubscription(accountId: string): Promise<SubscriptionProfile> { const account = accountOrThrow(this.accounts, accountId); return this.importSubscription(accountId, account.proxy.subscriptionUrl); }
  async listNodes(accountId: string): Promise<ProxyNode[]> { return this.runtime.getNodes(accountId); }
  async selectNode(accountId: string, tag: string): Promise<ProxyRuntimeState> {
    const account = accountOrThrow(this.accounts, accountId); const node = account.proxy.subscriptionNodes.find((item) => item.tag === tag || item.name === tag); if (!node) throw new Error('节点不存在');
    this.accounts.update(accountId, { proxy: { ...account.proxy, selectedNodeName: node.name, selectedNodeTag: node.tag, lastRuntimeError: '' } });
    if (account.proxy.enabled && account.proxy.mode === 'subscription') return this.runtime.restart(accountId); return this.runtime.getState(accountId);
  }
  async testNode(accountId: string, tag?: string): Promise<ProxyTestResult> {
    const account = accountOrThrow(this.accounts, accountId);
    if (account.proxy.mode !== 'subscription') throw new Error('只有订阅代理支持节点测试');
    if (!account.proxy.enabled) throw new Error('请先启用订阅代理');
    const old = { name: account.proxy.selectedNodeName, tag: account.proxy.selectedNodeTag };
    const target = tag
      ? account.proxy.subscriptionNodes.find((item) => item.tag === tag || item.name === tag)
      : account.proxy.subscriptionNodes.find((item) => item.tag === old.tag) ?? account.proxy.subscriptionNodes[0];
    if (!target) throw new Error(tag ? '节点不存在' : '请先刷新订阅并选择一个节点');
    const changed = target.tag !== old.tag;
    try {
      if (changed) await this.selectNode(accountId, target.tag);
      const state = await this.runtime.ensureStarted(accountId);
      const targetSession = session.fromPartition(`persist:account_${accountId}`);
      await targetSession.setProxy({ mode: 'fixed_servers', proxyRules: `socks5://127.0.0.1:${state.localPort}`, proxyBypassRules: '<local>' });
      await targetSession.closeAllConnections();
      const started = Date.now();
      const response = await targetSession.fetch('https://api64.ipify.org?format=json', { signal: AbortSignal.timeout(12000) });
      const body = await response.text(); let ip = '';
      try { ip = String((JSON.parse(body) as { ip?: unknown }).ip ?? ''); } catch { ip = body.trim(); }
      const result = { ok: response.ok, status: response.status, latencyMs: Date.now() - started, ip, message: response.ok ? '节点连接成功' : `HTTP ${response.status}` };
      const current = accountOrThrow(this.accounts, accountId);
      this.accounts.update(accountId, { proxy: { ...current.proxy, subscriptionNodes: current.proxy.subscriptionNodes.map((node) => node.tag === target.tag ? { ...node, latencyMs: result.latencyMs, realIp: result.ip } : node) } });
      return result;
    } catch (error) { return { ok: false, latencyMs: 0, message: error instanceof Error ? error.message : String(error) }; }
    finally {
      if (changed) {
        const current = accountOrThrow(this.accounts, accountId);
        this.accounts.update(accountId, { proxy: { ...current.proxy, selectedNodeName: old.name, selectedNodeTag: old.tag } });
        // selectNode() restarts the runtime for the temporary node. Restore both
        // the original node and the browser Session binding; otherwise an open
        // WebContentsView keeps using the stopped temporary port.
        if (current.proxy.enabled && current.proxy.mode === 'subscription') {
          const restored = await this.runtime.restart(accountId);
          await this.apply(accountId, session.fromPartition(`persist:account_${accountId}`));
          if (restored.status !== 'running') throw new Error('代理测试后无法恢复原节点');
        }
      }
    }
  }
  /**
   * Measure every parsed subscription node through one temporary selector
   * runtime. Delay probes use the sing-box Clash API with a bounded pool,
   * while出口 IP probes switch that selector and use the account Session's
   * normal HTTP proxy. The live account runtime and selected node are restored
   * after the batch, so an open WebContentsView never remains bound to the
   * temporary port.
   */
  async testAllNodes(accountId: string): Promise<ProxyBatchTestResult> {
    const account = accountOrThrow(this.accounts, accountId);
    if (account.proxy.mode !== 'subscription') throw new Error('只有订阅代理支持节点测试');
    if (!account.proxy.enabled) throw new Error('请先启用订阅代理');
    const nodes = [...account.proxy.subscriptionNodes];
    if (!nodes.length) throw new Error('请先刷新订阅并解析节点');
    const targetSession = session.fromPartition(`persist:account_${accountId}`);
    const results: ProxyNodeTestResult[] = [];
    try {
      await this.runtime.withTemporaryProbe(accountId, account.proxy, nodes, async ({ port, controlPort, selectorTag }) => {
        await targetSession.setProxy({ mode: 'fixed_servers', proxyRules: `http://127.0.0.1:${port}`, proxyBypassRules: '<local>' });
        await targetSession.closeAllConnections();
        const delays = await mapConcurrent(nodes, 8, async (node) => queryClashNodeDelay(controlPort, nodeTag(node)));
        for (const [index, node] of nodes.entries()) {
          const tag = nodeTag(node);
          const started = Date.now();
          let response: Response | null = null;
          let ip = '';
          let status: number | undefined;
          let errorMessage = '';
          const selected = await selectClashNode(controlPort, selectorTag, tag);
          if (selected) {
            try {
              response = await targetSession.fetch('https://api64.ipify.org?format=json', { signal: AbortSignal.timeout(12000) });
              status = response.status;
              const body = await response.text();
              try { ip = String((JSON.parse(body) as { ip?: unknown }).ip ?? ''); } catch { ip = body.trim(); }
            } catch (error) {
              errorMessage = error instanceof Error ? error.message : String(error);
            }
          } else {
            errorMessage = '节点选择失败';
          }
          const delay = delays[index] ?? null;
          const ok = delay !== null || Boolean(response?.ok);
          const latencyMs = delay ?? (selected ? Date.now() - started : 0);
          const message = ok
            ? (ip ? '节点连接成功' : delay !== null ? '延迟测试成功，出口 IP 获取失败' : '出口 IP 获取成功')
            : errorMessage || '延迟和出口 IP 测试均失败';
          results.push({ ok, status, latencyMs, ip, message, tag, name: node.name || tag });
        }
      });
      const measuredByTag = new Map(results.map((result) => [result.tag, result]));
      const current = accountOrThrow(this.accounts, accountId);
      this.accounts.update(accountId, {
        proxy: {
          ...current.proxy,
          subscriptionNodes: current.proxy.subscriptionNodes.map((node) => {
            const measured = measuredByTag.get(nodeTag(node));
            if (!measured) return node;
            return { ...node, latencyMs: measured.latencyMs || node.latencyMs, realIp: measured.ip || node.realIp };
          })
        }
      });
    } finally {
      // Keep the same post-test behavior as the single-node path: the
      // selected account node remains usable and the WebContentsView is not
      // left on the temporary HTTP proxy.
      const current = accountOrThrow(this.accounts, accountId);
      if (current.proxy.enabled && current.proxy.mode === 'subscription') await this.apply(accountId, targetSession);
    }
    const finalAccount = accountOrThrow(this.accounts, accountId);
    const succeeded = results.filter((result) => result.ok).length;
    return { nodes: finalAccount.proxy.subscriptionNodes, results, tested: results.length, succeeded, message: `已完成 ${results.length} 个节点测试，可用 ${succeeded} 个` };
  }
  runtimeStatus(accountId: string): ProxyRuntimeState { accountOrThrow(this.accounts, accountId); return this.runtime.getState(accountId); }
  async stopRuntime(accountId: string): Promise<void> { accountOrThrow(this.accounts, accountId); await this.runtime.stop(accountId); }
  async shutdown(): Promise<void> { await this.runtime.closeAll(); }
}
