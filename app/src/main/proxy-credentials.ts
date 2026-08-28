import type { Account } from '../shared/contracts';

/**
 * Resolve proxy credentials without allowing an owned WebContents to fall
 * through to another account that happens to use the same endpoint.
 *
 * When Electron gives us a WebContents, its account ownership is the
 * authoritative boundary. The endpoint-only lookup is retained only for
 * callers that genuinely do not have a WebContents (for example, a future
 * non-page probe).
 */
export function resolveProxyCredentials(accounts: Account[], ownedAccountId: string | null, hasWebContents: boolean, host: string, port: number): { username: string; password: string } | null {
  const matchesEndpoint = (account: Account): boolean => account.proxy.enabled && Boolean(account.proxy.username) && account.proxy.host === host && account.proxy.port === port;
  const account = hasWebContents
    ? (ownedAccountId ? accounts.find((item) => item.id === ownedAccountId && matchesEndpoint(item)) : undefined)
    : accounts.find(matchesEndpoint);
  return account?.proxy.username ? { username: account.proxy.username, password: account.proxy.password } : null;
}
