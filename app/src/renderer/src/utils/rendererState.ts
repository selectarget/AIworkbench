import {
  dolaAspectRatios,
  type Account,
  type AccountInput,
  type DolaAspectRatio,
  type ExternalBrowserLayout,
  type MediaResource,
  type ProxyRuntimeState
} from '@shared/contracts';

export function parseDolaAspectRatio(value: string | null | undefined): DolaAspectRatio | undefined {
  return dolaAspectRatios.includes(value as DolaAspectRatio) ? (value as DolaAspectRatio) : undefined;
}

export function moveAccountIds(
  ids: readonly string[],
  draggedId: string,
  targetId: string,
  side: 'before' | 'after' = 'before'
): string[] {
  if (!draggedId || !targetId || draggedId === targetId) return [...ids];
  const next = [...ids];
  const fromIndex = next.indexOf(draggedId);
  if (fromIndex < 0) return next;
  const [dragged] = next.splice(fromIndex, 1);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex < 0 || !dragged) return [...ids];
  next.splice(targetIndex + (side === 'after' ? 1 : 0), 0, dragged);
  return next;
}

export function externalBrowserGridLayout(index: number, total: number): ExternalBrowserLayout {
  const count = Math.max(1, Math.min(10, Number(total) || 1));
  let columns = 1;
  if (count <= 2) columns = count;
  else if (count <= 4) columns = 2;
  else if (count <= 6) columns = 3;
  else columns = 5;
  const rows = Math.ceil(count / columns);
  const screen = typeof window !== 'undefined' ? (window.screen as Screen & { availLeft?: number; availTop?: number }) : undefined;
  const left = Number(screen?.availLeft || 0);
  const top = Number(screen?.availTop || 0);
  const availableWidth = Math.max(900, Number(screen?.availWidth || (typeof window !== 'undefined' ? window.innerWidth : 1400) || 1400));
  const availableHeight = Math.max(700, Number(screen?.availHeight || (typeof window !== 'undefined' ? window.innerHeight : 900) || 900));
  const gap = 8;
  const width = Math.max(480, Math.floor((availableWidth - gap * (columns - 1)) / columns));
  const height = Math.max(420, Math.floor((availableHeight - gap * (rows - 1)) / rows));
  const slot = Math.max(0, index) % count;
  return { x: left + (slot % columns) * (width + gap), y: top + Math.floor(slot / columns) * (height + gap), width, height };
}

export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (!items.length) return;
  let cursor = 0;
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = cursor;
        if (index >= items.length) return;
        cursor += 1;
        await worker(items[index]!, index);
      }
    })
  );
}

export function splitIntoBatches<T>(items: readonly T[], size: number): T[][] {
  const batchSize = Math.max(1, Math.floor(size));
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += batchSize) batches.push(items.slice(start, start + batchSize));
  return batches;
}

export type ConnectionVisualState = {
  label: string;
  tone: 'ready' | 'busy' | 'error' | 'idle';
  detail?: string;
};

/**
 * Keep the browser toolbar honest about the route that the active account is
 * actually using. A generic “isolated” label used to hide a failed sing-box
 * runtime even though the page had no usable network path.
 */
export function connectionVisualState(
  account: Pick<Account, 'id' | 'proxy'> | undefined,
  runtime: ProxyRuntimeState | null
): ConnectionVisualState {
  if (!account) return { label: '等待账号', tone: 'idle' };
  if (!account.proxy.enabled) return { label: '直连 · Session 隔离', tone: 'ready' };
  if (account.proxy.mode === 'direct') return { label: '代理已配置 · Session 隔离', tone: 'ready' };
  if (runtime?.accountId !== account.id) {
    return account.proxy.lastRuntimeError
      ? { label: '订阅代理异常', tone: 'error', detail: account.proxy.lastRuntimeError }
      : { label: '订阅代理 · 检查中', tone: 'busy' };
  }
  if (runtime.status === 'running') return { label: `代理已连接 · ${runtime.localPort ?? '回环端口'}`, tone: 'ready' };
  if (runtime.status === 'starting') return { label: '代理启动中', tone: 'busy' };
  if (runtime.status === 'stopping') return { label: '代理停止中', tone: 'busy' };
  if (runtime.status === 'failed') return { label: '代理运行失败 · 网络已阻断', tone: 'error', detail: runtime.error || account.proxy.lastRuntimeError };
  return { label: '订阅代理 · 未启动', tone: 'idle' };
}

export async function restoreOpenTabs(
  accountIds: readonly string[],
  openAccount: (accountId: string) => Promise<{ ok: boolean }>
): Promise<{ restored: string[]; failed: string[] }> {
  const restored: string[] = [];
  const failed: string[] = [];
  for (const accountId of [...new Set(accountIds)]) {
    try {
      const result = await openAccount(accountId);
      if (result.ok) restored.push(accountId);
      else failed.push(accountId);
    } catch {
      failed.push(accountId);
    }
  }
  return { restored, failed };
}

export function hasDolaResourceLocator(resource: MediaResource): boolean {
  return [
    resource.messageId,
    resource.conversationId,
    resource.shareId,
    resource.shareUrl,
    resource.threadUrl,
    resource.vid,
    resource.keySeed,
    resource.fplayUrl,
    resource.dolaRecordKey,
    resource.dolaCardId,
    resource.dolaVideoElementId
  ].some((item) => Boolean(item?.trim()));
}

const MEDIA_FORMAT_EXTENSIONS = new Set([
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'm3u8', 'ts',
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'heic'
]);

export function mediaFormatToken(url: string): string {
  if (!url) return '';
  let extension = '';
  try {
    extension = new URL(url).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? '';
  } catch {
    return '';
  }
  return MEDIA_FORMAT_EXTENSIONS.has(extension) ? extension.toUpperCase() : '';
}

export function mediaCandidateCount(resource: Pick<MediaResource, 'url' | 'backupUrl' | 'alternateUrls'>): number {
  return mediaCandidates(resource).length;
}

export type MediaCandidateRole = 'primary' | 'backup' | 'alternate';
export type MediaCandidate = { url: string; role: MediaCandidateRole; index: number };

export function mediaCandidates(resource: Pick<MediaResource, 'url' | 'backupUrl' | 'alternateUrls'>): MediaCandidate[] {
  const values = [resource.url, resource.backupUrl, ...(resource.alternateUrls ?? [])]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  return [...new Set(values)].map((url, index) => ({
    url,
    index,
    role: index === 0 ? 'primary' : index === 1 ? 'backup' : 'alternate'
  }));
}

export function mediaPreviewKind(
  resource: Pick<MediaResource, 'type' | 'url' | 'previewUrl' | 'thumbUrl' | 'previewThumbUrl'>
): 'video' | 'image' | 'placeholder' {
  const playableUrl = String(resource.previewUrl || resource.url || '').trim();
  const visualUrl = String(resource.previewThumbUrl || resource.thumbUrl || resource.previewUrl || resource.url || '').trim();
  if (resource.type === 'video' && playableUrl) return 'video';
  if (visualUrl) return 'image';
  return 'placeholder';
}

export function accountViewNeedsReconfigure(
  previous: Pick<Account, 'platform' | 'customUrl' | 'browser' | 'fingerprint'> | undefined,
  next: Pick<AccountInput, 'platform' | 'customUrl' | 'browser' | 'fingerprint'>
): boolean {
  if (!previous) return false;
  return (
    previous.platform !== next.platform ||
    (previous.customUrl ?? '') !== (next.customUrl ?? '') ||
    JSON.stringify(previous.browser) !== JSON.stringify(next.browser) ||
    JSON.stringify(previous.fingerprint) !== JSON.stringify(next.fingerprint)
  );
}
