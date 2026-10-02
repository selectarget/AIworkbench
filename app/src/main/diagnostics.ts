import type { Account, BrowserDiagnostic, DiagnosticsSnapshot, DownloadTask, MediaResource, PlatformId, ProxyRuntimeState } from '../shared/contracts';
import { adapters } from './adapters';

export function redactDiagnosticText(value: string): string {
  return value.replace(/https?:\/\/[^\s<>"']+/gi, (url) => {
    try { const parsed = new URL(url); return `${parsed.protocol}//${parsed.host}/[已隐藏路径及参数]`; } catch { return '[已隐藏地址]'; }
  }).replace(/(?:C|D|E):[\\/]Users[\\/][^\\/\s]+/gi, 'C:\\Users\\[用户]')
    .replace(/((?:password|authorization|cookie|token|key_seed|signature)\s*[:=]\s*)[^\s,;]+/gi, '$1[已隐藏]');
}

export function supportReport(snapshot: DiagnosticsSnapshot, resources: MediaResource[], tasks: DownloadTask[]): unknown {
  const ids = new Map(snapshot.accounts.map((account, index) => [account.id, `account_${index + 1}`]));
  return {
    ...snapshot,
    accounts: snapshot.accounts.map((account) => ({ ...account, id: ids.get(account.id), name: ids.get(account.id), sessionPartition: `persist:${ids.get(account.id)}`, url: redactDiagnosticText(account.url || ''), fingerprint: { ...account.fingerprint, lastError: account.fingerprint.lastError ? redactDiagnosticText(account.fingerprint.lastError) : undefined }, proxy: { ...account.proxy, selectedNodeName: undefined, error: account.proxy.error ? redactDiagnosticText(account.proxy.error) : undefined } })),
    media: resources.map((resource) => ({ account: ids.get(resource.accountId), type: resource.type, source: resource.source, previewStatus: resource.previewStatus || 'idle', cached: Boolean(resource.previewCached), candidateCount: [resource.url, resource.backupUrl, ...(resource.alternateUrls || [])].filter(Boolean).length, expired: Boolean(resource.expiresAt && Date.parse(resource.expiresAt) < Date.now()), previewError: resource.previewError ? redactDiagnosticText(resource.previewError) : undefined })),
    downloads: tasks.slice(0, 100).map((task) => ({ account: ids.get(task.accountId), status: task.status, phase: task.phase, receivedBytes: task.receivedBytes, totalBytes: task.totalBytes, attempts: task.attempts, error: task.error ? redactDiagnosticText(task.error) : undefined, updatedAt: task.updatedAt })),
    privacy: '已移除账号名称、作品标题、登录数据、代理凭据及地址路径参数'
  };
}

const taskStatuses = ['queued', 'running', 'paused', 'completed', 'failed', 'cancelled'] as const;

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
