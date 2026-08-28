import type { Account, BrowserDiagnostic, DiagnosticsSnapshot, DownloadTask, MediaResource, PlatformId, ProxyRuntimeState } from '../shared/contracts';
import { adapters } from './adapters';

const taskStatuses = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;

export function summarizeDownloadTasks(tasks: DownloadTask[]): DiagnosticsSnapshot['taskCounts'] {
  const counts = Object.fromEntries(taskStatuses.map((status) => [status, 0])) as DiagnosticsSnapshot['taskCounts'];
  for (const task of tasks) counts[task.status] += 1;
  return counts;
}

export function buildDiagnosticsSnapshot(input: {
  appVersion: string;
  electronVersion: string;
  platform: string;
  arch: string;
  packaged: boolean;
  accounts: Account[];
  browser: BrowserDiagnostic[];
  proxy: ProxyRuntimeState[];
  resources: MediaResource[];
  tasks: DownloadTask[];
  pluginCount: number;
  disabledAdapters: PlatformId[];
}): DiagnosticsSnapshot {
  const browserById = new Map(input.browser.map((item) => [item.accountId, item]));
  const proxyById = new Map(input.proxy.map((item) => [item.accountId, item]));
  const accounts = input.accounts.map((account) => {
    const browser = browserById.get(account.id);
    const runtime = proxyById.get(account.id) ?? { accountId: account.id, status: 'idle' as const };
    return {
      id: account.id,
      name: account.name,
      platform: account.platform,
      open: browser?.open ?? false,
      url: browser?.url || account.browser.lastUrl || account.browser.homeUrl,
      sessionPartition: browser?.sessionPartition ?? `persist:account_${account.id}`,
      adapterEnabled: !input.disabledAdapters.includes(account.platform),
      adapterCapabilities: { ...adapters[account.platform].capabilities, taskDurations: [...adapters[account.platform].capabilities.taskDurations] },
      fingerprint: {
        enabled: account.fingerprint.enabled,
        seedPresent: Boolean(account.fingerprint.seed),
        lastAppliedAt: account.fingerprint.lastAppliedAt,
        lastError: account.fingerprint.lastError || undefined
      },
      proxy: {
        enabled: account.proxy.enabled,
        mode: account.proxy.mode,
        status: runtime.status,
        localPort: runtime.localPort,
        pid: runtime.pid,
        selectedNodeName: account.proxy.selectedNodeName || undefined,
        nodeCount: account.proxy.subscriptionNodes.length,
        error: runtime.error || account.proxy.lastRuntimeError || undefined
      }
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    appVersion: input.appVersion,
    electronVersion: input.electronVersion,
    platform: input.platform,
    arch: input.arch,
    packaged: input.packaged,
    accountCount: input.accounts.length,
    openTabCount: input.browser.filter((item) => item.open).length,
    resourceCount: input.resources.length,
    pluginCount: input.pluginCount,
    taskCounts: summarizeDownloadTasks(input.tasks),
    accounts
  };
}
