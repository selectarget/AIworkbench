import { net, session } from 'electron';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import nodeNet from 'node:net';
import { join } from 'node:path';
import type { AccountService } from './accounts';
import type { ProxyService } from './proxy';
import type { SettingsService } from './settings';
import type { Account, BatchLoginPlatform, DolaExternalLoginState, DolaLoginState, DolaLoginStep, ExternalBrowserLayout, ExternalLoginState } from '../shared/contracts';
import { adapters } from './adapters';
import { buildDolaCalibrationScript, buildDolaLoginStepScript, normalizeDolaLoginStep } from './dola-login';

type Running = { process: ChildProcess; port: number };
type CdpPage = { type: string; url: string; webSocketDebuggerUrl?: string };
type CdpCookie = { name: string; value: string; domain: string; path: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: 'Strict' | 'Lax' | 'None' };

function chromeExecutable(configured = ''): string {
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean) as string[];
  const windowsCandidates = roots.flatMap((root) => [join(root, 'Google/Chrome/Application/chrome.exe'), join(root, 'Microsoft/Edge/Application/msedge.exe')]);
  const macCandidates = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), join(homedir(), 'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')];
  const candidates = [configured.trim(), ...(process.platform === 'darwin' ? macCandidates : windowsCandidates)].filter(Boolean);
  const found = candidates.find(existsSync); if (!found) throw new Error('未找到 Chrome 或 Edge'); return found;
}
function freePort(): Promise<number> { return new Promise((resolve, reject) => { const server = nodeNet.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const address = server.address(); const port = typeof address === 'object' && address ? address.port : 0; server.close(() => resolve(port)); }); }); }
async function cdp(url: string, method: string, params: object = {}): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url); const timer = setTimeout(() => { socket.close(); reject(new Error('登录辅助响应超时')); }, 8000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.addEventListener('message', (event) => { const value = JSON.parse(String(event.data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string } }; if (value.id !== 1) return; clearTimeout(timer); socket.close(); value.error ? reject(new Error(value.error.message)) : resolve(value.result ?? {}); });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('无法连接外部浏览器')); });
  });
}

export class ExternalLoginService {
  private readonly running = new Map<string, Running>();
  constructor(private readonly root: string, private readonly accounts: AccountService, private readonly settings?: SettingsService, private readonly proxy?: ProxyService) {}
  status(accountId: string): { running: boolean } { const item = this.running.get(accountId); return { running: Boolean(item && !childExited(item.process)) }; }
  async dolaLoginState(accountId: string): Promise<DolaLoginState> {
    const account = this.account(accountId);
    if (account.platform !== 'dola') return { ok: false, loggedIn: false, cookieCount: 0, message: '不是 Dola 账号' };
    const target = session.fromPartition(`persist:account_${accountId}`);
    const cookies = (await target.cookies.get({})).filter((cookie) => isDolaCookieDomain(cookie.domain ?? ''));
    const loggedIn = hasStableDolaLoginCookies(cookies);
    return { ok: true, loggedIn, cookieCount: cookies.length, message: loggedIn ? '已检测到 Dola 登录态' : '尚未检测到稳定的 Dola 登录 Cookie' };
  }
  async externalLoginState(accountId: string): Promise<ExternalLoginState> {
    return this.readExternalLoginState(this.account(accountId));
  }
  async externalDolaLoginState(accountId: string): Promise<DolaExternalLoginState> {
    const account = this.account(accountId);
    if (account.platform !== 'dola') return { ok: false, running: false, loggedIn: false, cookieCount: 0, message: '不是 Dola 账号' };
    return this.readExternalLoginState(account);
  }
  private async readExternalLoginState(account: Account): Promise<ExternalLoginState> {
    const running = this.running.get(account.id);
    const label = externalLoginPlatformLabel(account);
    if (!running || childExited(running.process)) return { ok: true, running: false, loggedIn: false, cookieCount: 0, message: '外部登录浏览器未运行' };
    try {
      const pages = await this.pages(running.port);
      const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl && isAccountSitePage(item.url, account))
        ?? pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl && isGoogleAuthPage(item.url));
      if (!page?.webSocketDebuggerUrl) return { ok: true, running: true, loggedIn: false, cookieCount: 0, message: '等待外部登录页面就绪' };
      const result = await cdp(page.webSocketDebuggerUrl, 'Network.getAllCookies');
      const cookies = (Array.isArray(result.cookies) ? result.cookies as CdpCookie[] : []).filter((cookie) => isAccountSiteCookieDomain(cookie.domain, account));
      const loggedIn = hasStableExternalLoginCookies(cookies);
      return { ok: true, running: true, loggedIn, cookieCount: cookies.length, message: loggedIn ? `外部浏览器已检测到 ${label} 登录态` : `等待完成 ${label} 登录验证` };
    } catch (error) {
      return { ok: false, running: true, loggedIn: false, cookieCount: 0, message: error instanceof Error ? error.message : '无法读取外部浏览器登录态' };
    }
  }
  async start(accountId: string, layout?: ExternalBrowserLayout): Promise<{ port: number }> {
    const existing = this.running.get(accountId); if (existing && !childExited(existing.process)) return { port: existing.port };
    const account = this.account(accountId); const port = await freePort(); const profile = join(this.root, accountId); mkdirSync(profile, { recursive: true });
    const url = account.platform === 'custom' ? account.customUrl || 'about:blank' : adapters[account.platform].definition.url;
    const args = [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check'];
    if (layout) {
      args.push('--new-window', `--window-position=${Math.round(layout.x)},${Math.round(layout.y)}`, `--window-size=${Math.round(layout.width)},${Math.round(layout.height)}`);
    }
    args.push(url);
    if (account.proxy.enabled) {
      const proxyServer = account.proxy.mode === 'subscription'
        ? `socks5://127.0.0.1:${(await this.proxy?.runtime.ensureStarted(accountId))?.localPort ?? 0}`
        : `${account.proxy.type}://${account.proxy.host}:${account.proxy.port}`;
      if (proxyServer.endsWith(':0')) throw new Error('订阅代理运行时未启动');
      args.splice(args.length - 1, 0, `--proxy-server=${proxyServer}`);
    }
    const child = spawn(chromeExecutable(this.settings?.get().externalBrowserPath), args, { windowsHide: process.platform === 'win32', stdio: 'ignore' });
    this.running.set(accountId, { process: child, port });
    child.once('exit', () => {
      // A fast restart can replace the map entry before the old process exits.
      // Do not let the old process clear the newly started browser state.
      if (this.running.get(accountId)?.process === child) this.running.delete(accountId);
    });
    return { port };
  }
  async openWithSession(accountId: string): Promise<{ port: number; cookies: number }> {
    const account = this.account(accountId);
    const target = session.fromPartition(`persist:account_${accountId}`);
    const sourceCookies = (await target.cookies.get({})).filter((cookie) => cookie.name && cookie.domain && isRelevantCookieDomain(cookie.domain, account));
    const started = await this.start(accountId);
    const page = await this.waitForPage(started.port);
    if (!page.webSocketDebuggerUrl) throw new Error('外部浏览器没有可控制的页面');
    const cookies = sourceCookies.filter((cookie) => cookie.name && cookie.domain).map((cookie) => {
      const sameSite = cookie.sameSite === 'no_restriction' ? 'None' : cookie.sameSite === 'lax' ? 'Lax' : cookie.sameSite === 'strict' ? 'Strict' : undefined;
      return {
        name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path || '/', secure: cookie.secure, httpOnly: cookie.httpOnly,
        ...(cookie.expirationDate && cookie.expirationDate > 0 ? { expires: cookie.expirationDate } : {}), ...(sameSite ? { sameSite } : {})
      };
    });
    let injected = 0;
    if (cookies.length) {
      try { await cdp(page.webSocketDebuggerUrl, 'Network.setCookies', { cookies }); injected = cookies.length; } catch { /* The browser can still be opened without a partial cookie transfer. */ }
    }
    await cdp(page.webSocketDebuggerUrl, 'Page.navigate', { url: this.accountUrl(accountId) }).catch(() => undefined);
    return { port: started.port, cookies: injected };
  }
  async sync(accountId: string): Promise<{ cookies: number }> {
    const account = this.account(accountId);
    const running = this.running.get(accountId); if (!running) throw new Error('登录辅助浏览器未启动');
    const response = await net.fetch(`http://127.0.0.1:${running.port}/json`); if (!response.ok) throw new Error('无法读取登录辅助页面');
    const pages = await response.json() as CdpPage[];
    const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl && isAccountSitePage(item.url, account))
      ?? pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl && isGoogleAuthPage(item.url));
    if (!page?.webSocketDebuggerUrl) throw new Error('没有可同步的登录页面');
    const result = await cdp(page.webSocketDebuggerUrl, 'Network.getAllCookies');
    const cookies = ((result.cookies ?? []) as CdpCookie[]).filter((cookie) => isRelevantCookieDomain(cookie.domain, account));
    if (!cookies.length) throw new Error('登录页面没有目标站点 Cookie，请先完成登录');
    const target = session.fromPartition(`persist:account_${accountId}`); let count = 0;
    for (const cookie of cookies) {
      try {
        const domain = cookie.domain.replace(/^\./, ''); const url = `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path || '/'}`;
        await target.cookies.set({ url, name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path || '/', secure: cookie.secure, httpOnly: cookie.httpOnly, expirationDate: cookie.expires && cookie.expires > 0 ? cookie.expires : undefined, sameSite: cookie.sameSite?.toLowerCase() as 'unspecified' | 'no_restriction' | 'lax' | 'strict' | undefined }); count++;
      } catch { /* Skip cookies rejected by Chromium. */ }
    }
    await target.cookies.flushStore(); return { cookies: count };
  }
  async batchLoginFill(accountId: string, email: string, password: string, platform: BatchLoginPlatform): Promise<DolaLoginStep> {
    const account = this.account(accountId); if (account.platform !== platform) throw new Error(`仅 ${platform === 'higgsfield' ? 'Higgsfield' : 'Dola'} 账号支持批量登录`);
    const running = this.running.get(accountId); if (!running) throw new Error('登录辅助浏览器未启动');
    const response = await net.fetch(`http://127.0.0.1:${running.port}/json`); const pages = await response.json() as CdpPage[];
    const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl && isBatchLoginPageUrl(item.url, platform)); if (!page?.webSocketDebuggerUrl) throw new Error(`未找到 ${platform === 'higgsfield' ? 'Higgsfield' : 'Dola'} 或 Google 登录页`);
    const result = await cdp(page.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: buildDolaLoginStepScript(email, password, platform), returnByValue: true });
    return normalizeDolaLoginStep((result.result as { value?: unknown } | undefined)?.value);
  }
  async batchLoginCalibrate(accountId: string, platform: BatchLoginPlatform): Promise<DolaLoginStep> {
    const account = this.account(accountId); if (account.platform !== platform) throw new Error(`仅 ${platform === 'higgsfield' ? 'Higgsfield' : 'Dola'} 账号支持登录入口校准`);
    const running = this.running.get(accountId); if (!running) throw new Error('请先启动该账号的登录辅助浏览器');
    const response = await net.fetch(`http://127.0.0.1:${running.port}/json`); const pages = await response.json() as CdpPage[];
    const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl && isBatchLoginSiteUrl(item.url, platform)); if (!page?.webSocketDebuggerUrl) throw new Error(`未找到 ${platform === 'higgsfield' ? 'Higgsfield' : 'Dola'} 登录页`);
    const result = await cdp(page.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: buildDolaCalibrationScript(), returnByValue: true });
    return normalizeDolaLoginStep((result.result as { value?: unknown } | undefined)?.value, '校准失败');
  }
  async fillDola(accountId: string, email: string, password: string): Promise<DolaLoginStep> { return this.batchLoginFill(accountId, email, password, 'dola'); }
  async calibrateDola(accountId: string): Promise<DolaLoginStep> { return this.batchLoginCalibrate(accountId, 'dola'); }
  async close(accountId: string): Promise<void> {
    const item = this.running.get(accountId); if (!item) return;
    try {
      const response = await net.fetch(`http://127.0.0.1:${item.port}/json/version`);
      const value = await response.json() as { webSocketDebuggerUrl?: string };
      if (value.webSocketDebuggerUrl) await cdp(value.webSocketDebuggerUrl, 'Browser.close');
    } catch { await terminateExternalBrowserProcess(item.process); }
    // The child may exit while the CDP close request is in flight. A caller
    // can then start a replacement process before this method returns; do
    // not let the old close operation delete that newer map entry.
    if (this.running.get(accountId)?.process === item.process) this.running.delete(accountId);
  }
  /**
   * Account deletion is stronger than closing the optional login helper.
   * Remove its isolated Chromium profile as well; otherwise copied cookies
   * and OAuth state would survive after the account metadata and Electron
   * Session have been deleted.
   */
  async removeAccount(accountId: string): Promise<void> {
    if (!/^[a-zA-Z0-9_-]{6,80}$/.test(accountId)) throw new Error('账号 ID 无效');
    await this.close(accountId);
    rmSync(join(this.root, accountId), { recursive: true, force: true });
  }
  async closeAll(): Promise<void> {
    const items = [...this.running.values()];
    this.running.clear();
    await Promise.all(items.map((item) => terminateExternalBrowserProcess(item.process)));
  }
  private account(id: string) { const account = this.accounts.list().find((item) => item.id === id); if (!account) throw new Error('账号不存在'); return account; }
  private accountUrl(accountId: string): string { const account = this.account(accountId); return account.platform === 'custom' ? account.customUrl || 'about:blank' : adapters[account.platform].definition.url; }
  private async pages(port: number): Promise<CdpPage[]> {
    const response = await net.fetch(`http://127.0.0.1:${port}/json`);
    if (!response.ok) throw new Error('无法读取外部浏览器页面');
    const value = await response.json();
    return Array.isArray(value) ? value as CdpPage[] : [];
  }
  private async waitForPage(port: number): Promise<CdpPage> {
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const response = await net.fetch(`http://127.0.0.1:${port}/json`);
        if (response.ok) {
          const pages = await response.json() as CdpPage[];
          const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl && !item.url.startsWith('chrome://'));
          if (page) return page;
        }
      } catch { /* Chrome may still be starting. */ }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('等待外部浏览器启动超时');
  }
}

function childExited(child: ChildProcess): boolean { return child.exitCode !== null || child.signalCode !== null; }

/**
 * The external browser is optional, but it is still an account-owned
 * process.  `ChildProcess.kill()` only targets the launcher on Windows and
 * can leave Chrome renderer/GPU children behind.  Use taskkill's tree mode on
 * Windows and a bounded TERM/KILL sequence elsewhere so application exit is
 * deterministic without waiting forever on a broken browser process.
 */
async function terminateExternalBrowserProcess(child: ChildProcess): Promise<void> {
  if (childExited(child)) return;
  if (process.platform === 'win32' && child.pid) {
    await new Promise<void>((resolve) => {
      execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => resolve());
    });
    return;
  }
  try { child.kill('SIGTERM'); } catch { /* the browser may have exited */ }
  await waitForExternalBrowserExit(child, 2000);
  if (!childExited(child)) {
    try { child.kill('SIGKILL'); } catch { /* best effort */ }
    await waitForExternalBrowserExit(child, 1000);
  }
}

function waitForExternalBrowserExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (childExited(child) || typeof child.once !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    child.once('exit', finish);
  });
}

/**
 * External-login profiles are account-scoped, but a user can still open an
 * unrelated tab in them. Only copy cookies belonging to the configured site
 * (plus Google auth cookies used by the normal OAuth flow).
 */
export function isRelevantCookieDomain(domain: string, account: Account): boolean {
  const value = String(domain || '').replace(/^\./, '').toLowerCase();
  if (!value) return false;
  if (value === 'google.com' || value.endsWith('.google.com')) return true;
  return isAccountSiteCookieDomain(value, account);
}

export function isAccountSiteCookieDomain(domain: string, account: Account): boolean {
  const value = String(domain || '').replace(/^\./, '').toLowerCase();
  if (!value) return false;
  const hosts = accountCookieHosts(account);
  return hosts.some((host) => value === host || value.endsWith(`.${host}`));
}

export function isAccountSitePage(raw: string, account: Account): boolean {
  try {
    const host = new URL(raw).hostname.replace(/^www\./i, '').toLowerCase();
    return accountCookieHosts(account).some((expected) => host === expected || host.endsWith(`.${expected}`));
  } catch { return false; }
}

export function isGoogleAuthPage(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === 'google.com' || host.endsWith('.google.com');
  } catch { return false; }
}

export function isDolaCookieDomain(domain: string): boolean {
  const value = String(domain || '').replace(/^\./, '').toLowerCase();
  return value === 'dola.com' || value.endsWith('.dola.com') || value === 'ciciai.com' || value.endsWith('.ciciai.com');
}

export function hasStableExternalLoginCookies(cookies: readonly { name?: string }[]): boolean {
  const names = cookies.map((cookie) => String(cookie.name || '').toLowerCase()).filter(Boolean);
  const known = new Set([
    'sessionid', 'sessionid_ss', 'sid_guard', 'sid_tt', 'sid_ucp_v1', 'ssid_ucp_v1', 'uid_tt_ss', 'uid_tt', 'passport_auth_status', 'passport_csrf_token',
    'session', 'session_token', 'access_token', 'refresh_token', 'id_token', 'jwt', 'next-auth.session-token', '__secure-next-auth.session-token', 'authjs.session-token'
  ]);
  return names.some((name) => known.has(name)) || /token|session|auth|jwt|access|refresh/i.test(names.join(' '));
}

export function hasStableDolaLoginCookies(cookies: readonly { name?: string }[]): boolean {
  return hasStableExternalLoginCookies(cookies);
}

function externalLoginPlatformLabel(account: Account): string {
  if (account.platform === 'higgsfield') return 'Higgsfield';
  if (account.platform === 'dola') return 'Dola';
  return account.platform === 'custom' ? '自定义站点' : account.platform;
}

function accountCookieHosts(account: Account): string[] {
  const configured = account.platform === 'custom' ? account.customUrl : adapters[account.platform]?.definition.url;
  const hosts = new Set<string>();
  try {
    const host = new URL(configured || '').hostname.replace(/^www\./i, '').toLowerCase();
    if (host) hosts.add(host);
  } catch { /* A custom account may not have a valid URL yet. */ }
  const aliases: Partial<Record<Account['platform'], string[]>> = {
    qianwen: ['qwen.ai', 'tongyi.aliyun.com'],
    kimi: ['kimi.com'],
    jimeng: ['jimeng.com']
  };
  for (const host of aliases[account.platform] ?? []) hosts.add(host);
  if (account.platform === 'dola') hosts.add('ciciai.com');
  return [...hosts];
}

function isBatchLoginSiteUrl(raw: string, platform: BatchLoginPlatform): boolean {
  try {
    const host = new URL(raw).hostname;
    return platform === 'higgsfield' ? /(^|\.)higgsfield\.ai$/i.test(host) : /(^|\.)dola\.com$/i.test(host) || /(^|\.)ciciai\.com$/i.test(host);
  } catch { return false; }
}

function isBatchLoginPageUrl(raw: string, platform: BatchLoginPlatform): boolean {
  try { return /(^|\.)accounts\.google\.com$/i.test(new URL(raw).hostname) || isBatchLoginSiteUrl(raw, platform); } catch { return false; }
}
