import { ipcRenderer } from 'electron';
import { normalizeCapturedUrl } from '../shared/url-utils';

// This preload also has to remain a self-contained sandboxed bundle.
const remoteMediaChannel = 'remote:media';
const remoteDolaTokenChannel = 'remote:dola-token';
const remoteVideoGeneratedChannel = 'remote:video-generated';
const imageExtensionPattern = /\.(?:png|apng|jpe?g|jfif|webp|gif|bmp|dib|tif|tiff|avif|heic|heif|jxl)(?:[?#]|$)/i;
const videoExtensionPattern = /\.(?:mp4|webm|mov|m4v|mkv|avi|flv|ts|m2ts|mts|mpeg|mpg|3gp|3g2|ogv)(?:[?#]|$)/i;
const blockedAssetPattern = /(?:logo|icon|favicon|sprite|avatar|placeholder|loading|empty|default|intro|banner|bg|background|\.css|\.js|\.map)(?:[._-]|\?|#|$)/i;

type Captured = {
  type: 'image' | 'video'; url?: string; thumbUrl?: string; title: string; source: string; width?: number; height?: number; autoDownload?: boolean;
  backupUrl?: string; alternateUrls?: string[]; confirmedNoWatermark?: boolean; messageId?: string; vid?: string; keySeed?: string; fplayUrl?: string;
  conversationId?: string; shareId?: string; shareUrl?: string; threadUrl?: string; dolaRecordKey?: string; dolaCardId?: string; dolaVideoElementId?: string; resolutionMethod?: string; qualityEvidence?: 'unknown' | 'dom-direct' | 'platform-api' | 'decoded-token' | 'server-original'; rejectedCandidates?: string[];
};
type DolaTokenCaptured = {
  token: string; keySeed?: string; title?: string; coverUrl?: string; thumbUrl?: string; width?: number; height?: number; duration?: number;
  messageId?: string; vid?: string; fplayUrl?: string; dolaRecordKey?: string; dolaCardId?: string; dolaVideoElementId?: string; confirmedNoWatermark?: boolean;
};
const seen = new Set<string>();

function report(resource: Captured): void {
  const url = normalize(resource.url || '');
  const backupUrl = normalize(resource.backupUrl || '');
  const thumbUrl = normalize(resource.thumbUrl || '');
  const alternateUrls = normalizeUrlList(resource.alternateUrls);
  const hasLocator = [resource.messageId, resource.conversationId, resource.shareId, resource.shareUrl, resource.threadUrl, resource.vid, resource.keySeed, resource.fplayUrl, resource.dolaRecordKey, resource.dolaCardId, resource.dolaVideoElementId].some((item) => Boolean(item && item.trim()));
  if (!url && !(resource.type === 'video' && hasLocator)) return;
  const value = { ...resource, url, backupUrl: backupUrl || undefined, thumbUrl: thumbUrl || undefined, alternateUrls };
  const key = `${resource.type}:${url || resource.messageId || resource.vid || resource.dolaRecordKey || resource.dolaCardId || resource.fplayUrl}`;
  const signature = JSON.stringify([resource.autoDownload, backupUrl, alternateUrls, thumbUrl, resource.confirmedNoWatermark, resource.qualityEvidence, resource.resolutionMethod, resource.keySeed, resource.fplayUrl, resource.messageId, resource.vid, resource.shareId, resource.shareUrl, resource.threadUrl]);
  if (seen.has(`${key}:${signature}`)) return;
  seen.add(`${key}:${signature}`);
  if (seen.size > 5000) { const first = seen.values().next().value; if (first) seen.delete(first); }
  ipcRenderer.send(remoteMediaChannel, value);
}

function normalize(value: string): string {
  return normalizeCapturedUrl(value, location.href);
}

function normalizeUrlList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => normalize(String(item ?? ''))).filter(Boolean))].slice(0, 8);
}

function parseSrcset(value: string): string[] {
  if (!value) return [];
  return value.split(',').map((item) => normalize(item.trim().split(/\s+/)[0] || '')).filter(Boolean);
}

function isVisibleContentNode(node: Element): boolean {
  if (node.closest('header,nav,aside,footer,[role="navigation"],[class*="logo"],[class*="icon"],[class*="avatar"]')) return false;
  const rect = node.getBoundingClientRect();
  return rect.width >= 180 && rect.height >= 120;
}

function looksLikeImage(url: string, hint = ''): boolean {
  if (!url || videoExtensionPattern.test(url) || blockedAssetPattern.test(url)) return false;
  if (/video|movie|stream|audio/i.test(hint) && !/image|picture|photo/i.test(hint)) return false;
  return imageExtensionPattern.test(url) || /image|img|picture|photo|thumbnail|thumb|cover|origin/i.test(`${url} ${hint}`);
}

function reportImageCandidates(node: Element, candidates: Array<{ url: string; hint?: string }>, title: string): void {
  if (!isVisibleContentNode(node)) return;
  const image = node.matches('img') ? node as HTMLImageElement : node.querySelector('img');
  const rect = node.getBoundingClientRect();
  const width = image?.naturalWidth || Math.round(rect.width) || undefined;
  const height = image?.naturalHeight || Math.round(rect.height) || undefined;
  if (image?.naturalWidth && image?.naturalHeight && (image.naturalWidth < 512 || image.naturalHeight < 512)) return;
  if ((width && width < 180) || (height && height < 120)) return;
  for (const candidate of candidates) {
    if (!looksLikeImage(candidate.url, candidate.hint)) continue;
    report({ type: 'image', url: candidate.url, title, source: 'dom-fallback', width, height });
  }
}

function scan(): void {
  document.querySelectorAll<HTMLImageElement>('img[src]').forEach((node) => {
    const candidates = [
      { url: normalize(node.currentSrc || ''), hint: 'image' },
      { url: normalize(node.src || ''), hint: 'image' },
      { url: normalize(node.getAttribute('data-src') || ''), hint: 'image' },
      { url: normalize(node.getAttribute('data-original') || ''), hint: 'image' },
      ...parseSrcset(node.getAttribute('srcset') || '').map((url) => ({ url, hint: 'image' })),
      ...parseSrcset(node.getAttribute('data-srcset') || '').map((url) => ({ url, hint: 'image' })),
      ...parseSrcset(node.getAttribute('data-original-srcset') || '').map((url) => ({ url, hint: 'image' }))
    ].filter((candidate) => candidate.url);
    reportImageCandidates(node, candidates, node.alt || document.title);
  });
  document.querySelectorAll('source[src],source[srcset],[data-srcset],[data-original-srcset]').forEach((node) => {
    const picture = node.closest('picture');
    const owner = picture?.querySelector('img') || picture || node.parentElement;
    if (!owner) return;
    const candidates = [
      { url: normalize(node.getAttribute('src') || ''), hint: node.getAttribute('type') || 'image' },
      ...parseSrcset(node.getAttribute('srcset') || '').map((url) => ({ url, hint: node.getAttribute('type') || 'image' })),
      ...parseSrcset(node.getAttribute('data-srcset') || '').map((url) => ({ url, hint: 'image' })),
      ...parseSrcset(node.getAttribute('data-original-srcset') || '').map((url) => ({ url, hint: 'image' }))
    ].filter((candidate) => candidate.url);
    reportImageCandidates(owner, candidates, (owner.querySelector('img') as HTMLImageElement | null)?.alt || document.title);
  });
  document.querySelectorAll<HTMLElement>('[style*="background"],[data-background-image],[data-bg-url]').forEach((node) => {
    const style = getComputedStyle(node).backgroundImage || '';
    const styleUrl = style.match(/url\(["']?([^"')]+)["']?\)/)?.[1] || '';
    reportImageCandidates(node, [
      { url: normalize(styleUrl), hint: 'image' },
      { url: normalize(node.getAttribute('data-background-image') || ''), hint: 'image' },
      { url: normalize(node.getAttribute('data-bg-url') || ''), hint: 'image' }
    ].filter((candidate) => candidate.url), document.title);
  });
  document.querySelectorAll<HTMLVideoElement>('video').forEach((node) => {
    const rect = node.getBoundingClientRect();
    if (node.closest('header,nav,aside,footer') || rect.width < 240 || rect.height < 160) return;
    const urls = [normalize(node.currentSrc || ''), normalize(node.src || ''), ...Array.from(node.querySelectorAll('source[src]')).map((source) => normalize(source.getAttribute('src') || ''))].filter((url) => url && !imageExtensionPattern.test(url));
    for (const url of urls) report({ type: 'video', url, thumbUrl: normalize(node.poster), title: document.title, source: 'dom-fallback', width: node.videoWidth || undefined, height: node.videoHeight || undefined });
  });
}

window.addEventListener('DOMContentLoaded', () => { scan(); new MutationObserver(() => scan()).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'poster', 'style'] }); setInterval(scan, 5000); });
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || typeof event.data !== 'object') return;
  const payload = event.data as Record<string, unknown>;
  if (payload.type === 'imageDataExtracted' && Array.isArray(payload.data)) {
    for (const item of payload.data as Array<Record<string, unknown>>) report({ type: 'image', url: String(item.no_watermark_url ?? item.url ?? ''), thumbUrl: String(item.watermark_url ?? item.thumbUrl ?? ''), title: String(item.title ?? document.title), source: String(item.source ?? 'site-adapter'), width: Number(item.width) || undefined, height: Number(item.height) || undefined, confirmedNoWatermark: Boolean(item.no_watermark_url), qualityEvidence: item.no_watermark_url ? 'server-original' : 'unknown', resolutionMethod: item.no_watermark_url ? 'platform-original-field' : undefined });
  }
  if (payload.type === 'videoDownloadResult' && payload.data && typeof payload.data === 'object') {
    const item = payload.data as Record<string, unknown>; report({ type: 'video', url: String(item.videoUrl ?? item.mainUrl ?? item.url ?? ''), backupUrl: String(item.backupUrl ?? ''), alternateUrls: normalizeUrlList(item.alternateUrls), thumbUrl: String(item.coverUrl ?? item.thumbUrl ?? ''), title: String(item.title ?? document.title), source: String(item.source ?? 'site-adapter'), width: Number(item.width) || undefined, height: Number(item.height) || undefined, confirmedNoWatermark: Boolean(item.confirmedNoWatermark), qualityEvidence: item.qualityEvidence as Captured['qualityEvidence'] | undefined, resolutionMethod: String(item.resolutionMethod ?? '') || undefined, messageId: String(item.messageId ?? ''), conversationId: String(item.conversationId ?? ''), shareId: String(item.shareId ?? ''), shareUrl: String(item.shareUrl ?? ''), threadUrl: String(item.threadUrl ?? ''), vid: String(item.vid ?? ''), keySeed: String(item.keySeed ?? ''), fplayUrl: String(item.fplayUrl ?? ''), dolaRecordKey: String(item.dolaRecordKey ?? ''), dolaCardId: String(item.dolaCardId ?? ''), dolaVideoElementId: String(item.dolaVideoElementId ?? '') });
  }
  if (payload.type === 'videoDataExtracted' && Array.isArray(payload.data)) for (const raw of payload.data as Array<Record<string, unknown>>) { report({ type: 'video', url: String(raw.videoUrl ?? raw.mainUrl ?? raw.url ?? ''), backupUrl: String(raw.backupUrl ?? ''), alternateUrls: normalizeUrlList(raw.alternateUrls), thumbUrl: String(raw.coverUrl ?? raw.thumbUrl ?? ''), title: String(raw.title ?? document.title), source: String(raw.source ?? 'site-adapter'), width: Number(raw.width) || undefined, height: Number(raw.height) || undefined, confirmedNoWatermark: Boolean(raw.confirmedNoWatermark), qualityEvidence: raw.qualityEvidence as Captured['qualityEvidence'] | undefined, resolutionMethod: String(raw.resolutionMethod ?? '') || undefined, messageId: String(raw.messageId ?? ''), conversationId: String(raw.conversationId ?? ''), shareId: String(raw.shareId ?? ''), shareUrl: String(raw.shareUrl ?? ''), threadUrl: String(raw.threadUrl ?? ''), vid: String(raw.vid ?? ''), keySeed: String(raw.keySeed ?? ''), fplayUrl: String(raw.fplayUrl ?? ''), dolaRecordKey: String(raw.dolaRecordKey ?? ''), dolaCardId: String(raw.dolaCardId ?? ''), dolaVideoElementId: String(raw.dolaVideoElementId ?? '') }); }
  if (payload.type === 'dolaTokenExtracted' && payload.data && typeof payload.data === 'object') {
    const item = payload.data as Record<string, unknown>;
    const token = String(item.token ?? item.mainUrl ?? item.main_url ?? '').trim();
    if (token && token.length <= 200_000) {
      const value: DolaTokenCaptured = { token, keySeed: String(item.keySeed ?? item.key_seed ?? '').trim() || undefined, title: String(item.title ?? document.title), coverUrl: String(item.coverUrl ?? item.thumbUrl ?? '').trim() || undefined, thumbUrl: String(item.thumbUrl ?? '').trim() || undefined, width: Number(item.width) || undefined, height: Number(item.height) || undefined, duration: Number(item.duration) || undefined, messageId: String(item.messageId ?? '').trim() || undefined, vid: String(item.vid ?? '').trim() || undefined, fplayUrl: String(item.fplayUrl ?? '').trim() || undefined, dolaRecordKey: String(item.dolaRecordKey ?? '').trim() || undefined, dolaCardId: String(item.dolaCardId ?? '').trim() || undefined, dolaVideoElementId: String(item.dolaVideoElementId ?? '').trim() || undefined, confirmedNoWatermark: Boolean(item.confirmedNoWatermark) };
      ipcRenderer.send(remoteDolaTokenChannel, value);
    }
  }
  if (payload.type === 'videoGeneratedNotice' && payload.data && typeof payload.data === 'object') {
    const item = payload.data as Record<string, unknown>;
    const key = String(item.key ?? item.url ?? item.thumbUrl ?? '').trim();
    if (key && key.length <= 512) {
      const thumbUrl = normalize(String(item.thumbUrl ?? ''));
      ipcRenderer.send(remoteVideoGeneratedChannel, { key, title: String(item.title ?? '').trim().slice(0, 240), thumbUrl: thumbUrl || undefined });
    }
  }
  if (payload.type === 'electronDownload' && payload.data && typeof payload.data === 'object') { const item = payload.data as Record<string, unknown>; const url = normalize(String(item.url ?? '')); const type = item.type === 'video' || item.type === 'image' ? item.type : (videoExtensionPattern.test(url) ? 'video' : 'image'); report({ type, url, autoDownload: true, backupUrl: normalize(String(item.backupUrl ?? '')) || undefined, alternateUrls: normalizeUrlList(item.alternateUrls), thumbUrl: normalize(String(item.thumbUrl ?? '')) || undefined, title: String(item.title ?? item.filename ?? document.title), source: String(item.source ?? 'site-download'), confirmedNoWatermark: Boolean(item.confirmedNoWatermark), qualityEvidence: item.qualityEvidence as Captured['qualityEvidence'] | undefined ?? 'dom-direct', resolutionMethod: String(item.resolutionMethod ?? '') || 'will-download', messageId: String(item.messageId ?? '') || undefined, conversationId: String(item.conversationId ?? '') || undefined, shareId: String(item.shareId ?? '') || undefined, shareUrl: String(item.shareUrl ?? '') || undefined, threadUrl: String(item.threadUrl ?? '') || undefined, vid: String(item.vid ?? '') || undefined, keySeed: String(item.keySeed ?? '') || undefined, fplayUrl: String(item.fplayUrl ?? '') || undefined, dolaRecordKey: String(item.dolaRecordKey ?? '') || undefined, dolaCardId: String(item.dolaCardId ?? '') || undefined, dolaVideoElementId: String(item.dolaVideoElementId ?? '') || undefined }); }
});
