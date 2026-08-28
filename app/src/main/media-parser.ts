import type { MediaResource } from '../shared/contracts';
import { normalizeCapturedHttpUrl } from '../shared/url-utils';
import { decodeDolaMainUrl, findDolaKeySeed } from './dola-resolver';
import { mediaTypeFromExtension, mediaTypeFromMimeType } from './media-formats';

export type CapturedCandidate = Partial<MediaResource> & Pick<MediaResource, 'type' | 'url' | 'source'>;

const mediaUrl = /^https?:\/\//i;
const blocked = /(?:logo|favicon|sprite|avatar|placeholder|loading|empty|default|banner|background|\.css|\.js|\.map)(?:[._\/-]|[?#]|$)/i;
const maxNestedJsonText = 2 * 1024 * 1024;

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeUrl(value: string): string {
  const text = normalizeCapturedHttpUrl(value);
  if (!mediaUrl.test(text)) return '';
  try { const url = new URL(text); return !blocked.test(url.pathname) ? url.href : ''; } catch { return ''; }
}

function inferType(key: string, url: string): 'image' | 'video' | null {
  const text = `${key} ${url}`.toLowerCase();
  const urlType = mediaTypeFromExtension(url);
  if (urlType === 'video' || /video|play|stream|vod|origin[_-]?url|main[_-]?url|backup[_-]?url|man[_-]?url|fplay[_-]?url|download[_-]?url|media\/video/.test(text)) return 'video';
  if (urlType === 'image' || /image|img|cover|poster|thumb|origin_aigc|media\/image/.test(text)) return 'image';
  return null;
}

const typedUrlField = /^(?:url|uri|src|source|resource(?:_?url)|asset(?:_?url)|download(?:_?url)|play(?:_?url)|media(?:_?url)|file(?:_?url)|original(?:_?url)|main(?:_?url)|man(?:_?url)|backup(?:_?url)(?:_[1-9])?|third(?:_?(?:url|video_url))?|no[_-]?watermark(?:[_-]?url)?)$/i;
const legacyMediaCandidateField = /^(?:no[_-]?watermark(?:[_-]?url)?|main(?:_?url)|man(?:_?url)|backup(?:_?url)(?:_[1-9])?|third(?:_?(?:url|video_url))?|play(?:_?url)|video(?:_?url)|download(?:_?url)|origin(?:al)?(?:_?url)|raw(?:_?url)|source(?:_?url)|media(?:_?url)|fplay(?:_?url))$/i;
const mediaTypeFields = /^(?:mime(?:_?type)|content(?:_?type)|media(?:_?type)|resource(?:_?type)|file(?:_?type)|media(?:_?kind)|format|extension|file_ext|fileExtension|kind|type)$/i;

/**
 * Some generation APIs return signed, extensionless CDN URLs.  The URL key
 * alone is intentionally not enough to classify those values; use an
 * explicit MIME/media-type hint from the same response object instead.
 */
function inferTypedField(key: string, url: string, context: Record<string, unknown>): 'image' | 'video' | null {
  const direct = inferType(key, url);
  if (direct) return direct;
  if (!typedUrlField.test(key)) return null;
  const hint = Object.entries(context)
    .filter(([field]) => mediaTypeFields.test(field))
    .map(([, value]) => String(value ?? '').toLowerCase())
    .join(' ');
  if (!hint) return null;
  const hintValues = Object.entries(context).filter(([field]) => mediaTypeFields.test(field)).map(([, value]) => String(value ?? ''));
  if (hintValues.some((value) => mediaTypeFromMimeType(value) === 'video' || mediaTypeFromExtension(value) === 'video') || /(?:^|[\s/:._-])video(?:$|[\s/:._-])|video\/|mp4|webm|mov|m4v|mkv|avi|flv|mpeg|mpg|3gp|ogv/.test(hint)) return 'video';
  if (hintValues.some((value) => mediaTypeFromMimeType(value) === 'image' || mediaTypeFromExtension(value) === 'image') || /(?:^|[\s/:._-])image(?:$|[\s/:._-])|image\/|png|apng|jpe?g|jfif|webp|gif|bmp|tiff?|avif|heic|heif|svg|ico|jxl|photo|picture/.test(hint)) return 'image';
  return null;
}

const dolaVideoField = /^(?:main_url|mainurl|man_url|manurl|play_url|playurl|video_url|videourl|download_url|downloadurl|origin_url|original_url|raw_url|source_url|media_url|mediaUrl|fplay_url|fplayUrl|no[_-]?watermark(?:[_-]?url)?|watermark[_-]?free[_-]?url|unwatermarked[_-]?url|url)$/i;

/**
 * Legacy Doubao play-info responses can mark a playable URL with a routing
 * query parameter instead of returning a second field. Keep this scoped to
 * API responses captured from Doubao; generic page URLs must not be rewritten.
 */
export function upgradeDoubaoNoWatermarkUrl(value: string): string {
  try {
    const url = new URL(value);
    const before = url.href;
    for (const [key, current] of [...url.searchParams.entries()]) {
      if (key.toLowerCase() === 'lr' && /watermark/i.test(current)) url.searchParams.set(key, 'video_gen_no_watermark');
      if (key.toLowerCase() === 'logo_type' && /watermark/i.test(current) && !/no_watermark|unwatermarked/i.test(current)) url.searchParams.set(key, 'no_watermark');
    }
    return url.href !== before ? url.href : '';
  } catch {
    return '';
  }
}

function upgradePlatformUrl(value: string, source: string): string {
  if (/doubao/i.test(source)) return upgradeDoubaoNoWatermarkUrl(value);
  if (/dola/i.test(source)) return upgradeDolaNoWatermarkUrl(value);
  return '';
}

function score(key: string, url: string): number {
  const text = `${key} ${url}`.toLowerCase(); let value = 1;
  if (/no[_-]?watermark|without[_-]?watermark|watermark=false|video_gen_no_watermark/.test(text)) value += 100;
  if (/original_media|original|origin|source|raw|download|main_url/.test(text)) value += 40;
  if (/main|master|play|url/.test(text)) value += 12;
  if (/backup|fallback|thumb|cover|poster/.test(text)) value -= 15;
  if (/with_watermark|video_gen_watermark|watermark_dyn|aigc_busi_mark|wm=1/.test(text)) value -= 100;
  return value;
}

export function upgradeDolaNoWatermarkUrl(value: string): string {
  try {
    const url = new URL(value); const before = url.href;
    for (const [key, current] of [...url.searchParams.entries()]) {
      if (key.toLowerCase() === 'lr') url.searchParams.set(key, current.replace(/video_gen_watermark_dyn|video_gen_watermark/ig, 'video_gen_no_watermark'));
      if (key.toLowerCase() === 'logo_type' && !/no_watermark/i.test(current)) url.searchParams.set(key, 'no_watermark');
    }
    return url.href !== before && inferType('video', url.href) === 'video' ? url.href : '';
  } catch { return ''; }
}

export function parseSsePayloads(text: string): unknown[] {
  const payloads: unknown[] = []; let lines: string[] = [];
  const push = (value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '[DONE]') return false;
    try { payloads.push(JSON.parse(trimmed)); return true; } catch { return false; }
  };
  const flush = (): void => { if (!lines.length) return; const value = lines.join('\n'); lines = []; push(value); };
  for (const line of text.split(/\r?\n/)) {
    if (!line) { flush(); continue; }
    if (!line.startsWith('data:')) continue;
    const chunk = line.slice(5).trimStart();
    // Most SSE implementations put a blank line between events. A few
    // proxies omit it and emit one complete JSON object per data line. Parse
    // that compact form immediately, while retaining multiline JSON chunks
    // for the normal buffered path.
    if (!lines.length && push(chunk)) continue;
    lines.push(chunk);
  }
  flush(); return payloads;
}

/**
 * Some AI endpoints use newline-delimited JSON instead of SSE. Only accept
 * complete object/array lines; arbitrary text, HTML and partial JSON remain
 * ignored so a response cannot turn into a source of false media candidates.
 */
export function parseNdjsonPayloads(text: string): unknown[] {
  const payloads: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim();
    if (!value || (!value.startsWith('{') && !value.startsWith('['))) continue;
    try { payloads.push(JSON.parse(value)); } catch { /* partial or non-JSON line */ }
  }
  return payloads;
}

export function parseMediaPayload(text: string, source = 'network'): CapturedCandidate[] {
  const roots: unknown[] = [];
  try { roots.push(JSON.parse(text)); } catch { roots.push(...parseSsePayloads(text), ...parseNdjsonPayloads(text)); }
  const found: Array<CapturedCandidate & { score: number }> = []; const seenObjects = new WeakSet<object>();
  const walk = (value: unknown, key = '', depth = 0, context: Record<string, unknown> = {}): void => {
    if (depth > 24 || value == null) return;
    if (typeof value === 'string') {
      const nested = value.trim();
      if (nested.length <= maxNestedJsonText && (nested.startsWith('{') || nested.startsWith('['))) {
        try { walk(JSON.parse(nested), key, depth + 1, context); return; } catch { /* This is a URL or non-JSON text. */ }
      }
      const original = normalizeUrl(value); const upgraded = upgradePlatformUrl(original, source); const url = upgraded || original; const type = url && inferTypedField(key, url, context); if (!url || !type) return;
      const confirmed = Boolean(upgraded) || /no[_-]?watermark|video_gen_no_watermark|original_media/i.test(`${key} ${url}`); found.push({ type, url, source, title: String(context.title ?? context.prompt ?? context.name ?? ''), width: number(context.width), height: number(context.height), duration: number(context.duration), ...stableMetadata(context), confirmedNoWatermark: confirmed, qualityEvidence: qualityEvidenceFor(key, source, confirmed), resolutionMethod: upgraded ? (/doubao/i.test(source) ? 'doubao-url-variant' : 'dola-url-variant') : 'payload-url', score: score(key, url) }); return;
    }
    if (typeof value !== 'object' || seenObjects.has(value as object)) return; seenObjects.add(value as object);
    if (Array.isArray(value)) { value.forEach((item) => walk(item, key, depth + 1, context)); return; }
    const node = value as Record<string, unknown>; const next = { ...context, ...node };
    // V4.4 chain responses expose original images as image_ori_raw.url. That
    // field is authoritative even when the CDN URL has no file extension;
    // arbitrary extensionless URLs below still require an explicit media
    // type, so this does not broaden generic capture indiscriminately.
    const imageOriginal = objectValue(node.image_ori_raw);
    const imageOriginalUrl = typeof imageOriginal.url === 'string' ? normalizeUrl(imageOriginal.url) : '';
    if (imageOriginalUrl) {
      const imageContext = { ...next, ...imageOriginal };
      found.push({
        type: 'image', url: imageOriginalUrl, source,
        title: String(imageContext.title ?? imageContext.prompt ?? imageContext.name ?? ''),
        width: number(imageContext.width), height: number(imageContext.height), ...stableMetadata(imageContext),
        confirmedNoWatermark: true, qualityEvidence: 'server-original', resolutionMethod: 'image-ori-raw',
        score: score('image_ori_raw', imageOriginalUrl) + 50
      });
    }
    const mainValue = node.no_watermark_url ?? node.main_url ?? node.mainUrl ?? node.man_url ?? node.manUrl ?? node.manURL ?? node.video_url ?? node.videoUrl ?? node.play_url ?? node.playUrl;
    if (typeof mainValue === 'string') {
      const original = normalizeUrl(mainValue); const upgraded = upgradePlatformUrl(original, source); const url = upgraded || original; const type = url && inferTypedField(key || 'main_url', url, next);
      if (url && type) {
        const candidateValues = Object.entries(node)
          .filter(([field, value]) => legacyMediaCandidateField.test(field) && typeof value === 'string')
          .map(([, value]) => normalizeUrl(String(value)))
          .filter((value): value is string => Boolean(value));
        const backupValues = Object.entries(node)
          .filter(([field, value]) => /^backup(?:_?url)(?:_[1-9])?$/i.test(field) && typeof value === 'string')
          .map(([, value]) => normalizeUrl(String(value)))
          .filter((value): value is string => Boolean(value));
        const backupValue = node.backup_url ?? node.backupUrl ?? node.backup;
        const explicitBackup = typeof backupValue === 'string' ? normalizeUrl(backupValue) : '';
        const backupUrl = upgraded ? '' : explicitBackup || backupValues.find((value) => value !== url) || '';
        const alternateUrls = [...new Set(candidateValues.concat(backupValues))]
          .filter((value) => value !== url && value !== backupUrl)
          .slice(0, 8);
        const thumbValue = node.thumb_url ?? node.thumbUrl ?? node.cover_url ?? node.coverUrl ?? node.watermark_url;
        const thumbUrl = typeof thumbValue === 'string' ? normalizeUrl(thumbValue) : '';
        const confirmed = Boolean(upgraded) || /no[_-]?watermark|video_gen_no_watermark|original_media/i.test(`${key} ${url}`); found.push({ type, url, backupUrl: backupUrl || undefined, alternateUrls: alternateUrls.length ? alternateUrls : undefined, thumbUrl: thumbUrl || undefined, source, title: String(next.title ?? next.prompt ?? next.name ?? ''), width: number(next.width), height: number(next.height), duration: number(next.duration), ...stableMetadata(next), expiresAt: expiry(url), confirmedNoWatermark: confirmed, qualityEvidence: qualityEvidenceFor(key || 'main_url', source, confirmed), resolutionMethod: upgraded ? (/doubao/i.test(source) ? 'doubao-url-variant' : 'dola-url-variant') : 'payload-field', score: score(key || 'main_url', url) + 5 });
      }
    }
    for (const [childKey, child] of Object.entries(node)) {
      if (/^(?:raw_data|audio_data|bytes|base64|binary)$/i.test(childKey)) continue;
      walk(child, childKey, depth + 1, next);
    }
  };
  roots.forEach((root) => walk(root));
  const grouped = new Map<string, Array<typeof found[number]>>();
  for (const item of found) { const key = `${item.type}:${item.url}`; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key)!.push(item); }
  return [...grouped.values()].map((items) => { const best = items.sort((a, b) => b.score - a.score)[0]!; const { score: _score, ...candidate } = best; return candidate; });
}

/**
 * Qianwen's legacy message-list endpoint exposes generated assets in fields
 * that are intentionally not treated as generic media URLs (for example a
 * `thumbnail_url` without an extension or dimensions). Preserve that old
 * endpoint-specific behavior while requiring a Qianwen CDN/result signal.
 */
export function parseQianwenPayload(text: string, responseUrl = 'qianwen-message-list'): CapturedCandidate[] {
  const source = `cdp:qianwen:${/chat2(?:-api)?\.qianwen\.com/i.test(responseUrl) ? 'message-list' : 'network'}`;
  const roots: unknown[] = [];
  try { roots.push(JSON.parse(text)); } catch { /* The legacy endpoint is normally JSON. */ }
  const found = new Map<string, CapturedCandidate>();
  const seen = new WeakSet<object>();
  const valueText = (value: unknown): string => value == null ? '' : String(value).trim();
  const numberValue = (value: unknown): number | undefined => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : undefined; };
  const add = (candidate: CapturedCandidate): void => {
    const key = `${candidate.type}:${candidate.url}`;
    if (!found.has(key)) found.set(key, candidate);
  };
  const acceptsImage = (url: string, context: Record<string, unknown>): boolean => {
    try {
      const parsed = new URL(url);
      if (/^workspace-zb-cdn\.qianwen\.com$/i.test(parsed.hostname)) return true;
      const path = `${parsed.pathname} ${parsed.search}`;
      const contextText = Object.values(context).map(valueText).join(' ');
      return /workspace|generated|generation|aigc|creation|output|media|image/i.test(path) && /assistant|answer|result|generation|creation|workspace|message.*ai/i.test(contextText);
    } catch {
      return false;
    }
  };
  const looksLikeVideo = (url: string, context: Record<string, unknown>): boolean => mediaTypeFromExtension(url) === 'video' || /\/video\//i.test(url) || Boolean(valueText(context.poster || context.poster_url));
  const visit = (value: unknown, key = '', context: Record<string, unknown> = {}, depth = 0): void => {
    if (depth > 24 || value == null) return;
    if (typeof value === 'string') {
      const url = normalizeUrl(value);
      if (!url) return;
      if (/^thumbnail_url$/i.test(key) && acceptsImage(url, context)) add({ type: 'image', url, source, title: valueText(context.title || context.prompt || context.name), width: numberValue(context.width || context.image_width), height: numberValue(context.height || context.image_height), qualityEvidence: 'platform-api', resolutionMethod: 'qianwen-thumbnail-url' });
      if (/^src$/i.test(key) && looksLikeVideo(url, context)) add({ type: 'video', url, source, title: valueText(context.title || context.prompt || context.name) || '千问视频', width: numberValue(context.width || context.video_width), height: numberValue(context.height || context.video_height), duration: numberValue(context.duration || context.video_duration), qualityEvidence: 'platform-api', resolutionMethod: 'qianwen-message-list' });
      return;
    }
    if (typeof value !== 'object' || seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) { value.forEach((child) => visit(child, key, context, depth + 1)); return; }
    const node = value as Record<string, unknown>;
    const next = { ...context, ...node };
    for (const [childKey, child] of Object.entries(node)) visit(child, childKey, next, depth + 1);
  };
  roots.forEach((root) => visit(root));
  for (const match of text.matchAll(/\bsrc\s*=\s*["'](?<url>https?:\/\/[^"'<>\s]+)["']\s+poster\b/ig)) {
    const url = normalizeUrl(match.groups?.url ?? '');
    if (url && looksLikeVideo(url, {})) add({ type: 'video', url, source, title: '千问视频', qualityEvidence: 'platform-api', resolutionMethod: 'qianwen-src-poster' });
  }
  // Keep the generic JSON/SSE fields as a fallback for newer Qianwen builds;
  // the legacy fields above remain preferred because they carry endpoint
  // provenance and survive missing dimensions.
  for (const candidate of parseMediaPayload(text, 'cdp:qianwen')) {
    const key = `${candidate.type}:${candidate.url}`;
    if (!found.has(key)) found.set(key, candidate);
  }
  return [...found.values()];
}

export function parseYunquePayload(text: string, sourceUrl = 'yunque-network'): CapturedCandidate[] {
  const roots: unknown[] = []; try { roots.push(JSON.parse(text)); } catch { /* Some package responses are escaped fragments. */ }
  const found = new Map<string, CapturedCandidate>(); const packageResponse = /get_package_info/i.test(sourceUrl); const add = (url: string, type: 'image' | 'video', context: Record<string, unknown> = {}, key = ''): void => {
    const normalized = normalizeUrl(url); if (!normalized) return; const current = found.get(`${type}:${normalized}`); const candidate: CapturedCandidate = { type, url: normalized, source: `yunque:${packageResponse ? 'package' : 'thread-file'}`, title: String(context.title ?? context.name ?? context.prompt ?? ''), width: number(context.width), height: number(context.height), confirmedNoWatermark: type === 'image' ? /origin_aigc/i.test(normalized) : false, qualityEvidence: type === 'image' ? 'server-original' : 'platform-api', resolutionMethod: key || (packageResponse ? 'package-url' : 'origin-url') }; if (!current || (candidate.width ?? 0) * (candidate.height ?? 0) > (current.width ?? 0) * (current.height ?? 0)) found.set(`${type}:${normalized}`, candidate);
  };
  const walk = (value: unknown, key = '', context: Record<string, unknown> = {}, depth = 0): void => {
    if (depth > 20 || value == null) return;
    if (typeof value === 'string') { if (/^origin_url$/i.test(key)) add(value, 'video', context, key); else if (/^url$/i.test(key) && /origin_aigc/i.test(value)) add(value, 'image', context, key); else if (packageResponse && /^url$/i.test(key)) add(value, 'video', context, key); return; }
    if (typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((item) => walk(item, key, context, depth + 1)); return; }
    const node = value as Record<string, unknown>; const next = { ...context, ...node }; for (const [childKey, child] of Object.entries(node)) walk(child, childKey, next, depth + 1);
  };
  roots.forEach((root) => walk(root));
  if (!roots.length || !found.size) {
    for (const match of text.matchAll(/\\?"origin_url\\?"\s*:\s*\\?"(?<url>https?:\/\/[^"\\]+)\\?"/ig)) add(match.groups?.url ?? '', 'video', {}, 'origin_url');
    for (const match of text.matchAll(/\\?"url\\?"\s*:\s*\\?"(?<url>https?:\/\/[^"\\]+)\\?"/ig)) { const url = match.groups?.url ?? ''; if (/origin_aigc/i.test(url)) add(url, 'image', {}, 'url'); else if (packageResponse) add(url, 'video', {}, 'url'); }
  }
  return [...found.values()];
}

function number(value: unknown): number | undefined { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined; }
function qualityEvidenceFor(key: string, source: string, confirmed: boolean): NonNullable<CapturedCandidate['qualityEvidence']> {
  if (/dom|site-download/i.test(source)) return 'dom-direct';
  if (/decoded|token|qAAB/i.test(key)) return 'decoded-token';
  if (confirmed && /no[_-]?watermark|original|main_url|download/i.test(key)) return /cdp|api|network/i.test(source) ? 'platform-api' : 'server-original';
  return 'unknown';
}
function stableMetadata(value: Record<string, unknown>): Pick<CapturedCandidate, 'messageId' | 'conversationId' | 'shareId' | 'shareUrl' | 'threadUrl' | 'vid' | 'keySeed' | 'fplayUrl' | 'dolaRecordKey' | 'dolaCardId' | 'dolaVideoElementId'> {
  const text = (...keys: string[]): string | undefined => { for (const key of keys) if (value[key] != null && String(value[key]).trim()) return String(value[key]).trim(); return undefined; };
  return {
    messageId: text('message_id', 'messageId', 'item_message_id', 'itemMessageId'),
    conversationId: text('conversation_id', 'conversationId', 'conversationID', 'conversation'),
    shareId: text('share_id', 'shareId', 'shareID'),
    shareUrl: text('share_url', 'shareUrl', 'shareURL'),
    threadUrl: text('thread_url', 'threadUrl', 'threadURL'),
    vid: text('vid', 'video_id', 'videoId', 'item_vid'),
    keySeed: text('key_seed', 'keySeed'),
    fplayUrl: text('fplay_url', 'fplayUrl'),
    dolaRecordKey: text('dolaRecordKey', 'record_key', 'recordKey'),
    dolaCardId: text('dolaCardId', 'card_id', 'cardId'),
    dolaVideoElementId: text('dolaVideoElementId', 'video_element_id', 'videoElementId')
  };
}
function expiry(value: string): string | undefined { try { const raw = new URL(value).searchParams.get('x-expires') ?? new URL(value).searchParams.get('expires'); const number = Number(raw); if (!Number.isFinite(number) || number <= 0) return undefined; return new Date(number < 10_000_000_000 ? number * 1000 : number).toISOString(); } catch { return undefined; } }

function dolaResponseSource(url: string): string {
  if (/\/samantha\/(?:video|media)\/get_play_info/i.test(url)) return 'play-info';
  if (/\/alice\/media\/bigmusic\/share_save/i.test(url)) return 'share-save';
  if (/\/creativity\/share\/get_video_share_info/i.test(url)) return 'video-share-info';
  if (/\/samantha\/thread\/share\/info/i.test(url)) return 'thread-share-info';
  if (/\/im\/chain\/single/i.test(url)) return 'chain-single';
  if (/\/samantha\/skill\/pack/i.test(url)) return 'skill-pack';
  return 'network';
}

function candidateRank(candidate: CapturedCandidate): number {
  const evidence = candidate.qualityEvidence === 'server-original' ? 4 : candidate.qualityEvidence === 'platform-api' ? 3 : candidate.qualityEvidence === 'decoded-token' ? 2 : candidate.qualityEvidence === 'dom-direct' ? 1 : 0;
  return evidence + (candidate.confirmedNoWatermark ? 10 : 0);
}

/**
 * Parses Dola's public page responses in addition to the generic URL walker.
 * The legacy site sometimes exposes the playable asset as a base64/qAAB
 * `main_url`/`man_url` value rather than an HTTP URL.  Decoding that value is
 * intentionally limited to response data already visible to the page; this
 * function does not issue requests or manufacture authorization parameters.
 */
export function parseDolaPayload(text: string, responseUrl = 'dola-network'): CapturedCandidate[] {
  const source = `cdp:dola:${dolaResponseSource(responseUrl)}`;
  const candidates = parseMediaPayload(text, source);
  const roots: unknown[] = [];
  try { roots.push(JSON.parse(text)); } catch { roots.push(...parseSsePayloads(text)); }
  const decoded = new Map<string, CapturedCandidate>();
  const seen = new WeakSet<object>();
  let visited = 0;
  const stringValue = (value: unknown): string => value == null ? '' : String(value).trim();
  const numberValue = (value: unknown): number | undefined => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : undefined; };
  const first = (value: Record<string, unknown>, keys: string[]): string => { for (const key of keys) { const result = stringValue(value[key]); if (result) return result; } return ''; };
  const addDecoded = (token: string, field: string, context: Record<string, unknown>): void => {
    if (!dolaVideoField.test(field) || !token || /^https?:\/\//i.test(token) || token.length > 200_000) return;
    const seed = first(context, ['key_seed', 'keySeed']) || findDolaKeySeed(context);
    const url = decodeDolaMainUrl(token, seed);
    if (!/^https?:\/\//i.test(url)) return;
    const type = inferType(field, url) || 'video';
    if (type !== 'video') return;
    const metadata = stableMetadata(context);
    const candidate: CapturedCandidate = {
      type,
      url,
      source,
      title: first(context, ['title', 'prompt', 'name']) || '',
      width: numberValue(context.width ?? context.vwidth ?? context.video_width),
      height: numberValue(context.height ?? context.vheight ?? context.video_height),
      duration: numberValue(context.duration ?? context.video_duration),
      ...metadata,
      expiresAt: expiry(url),
      confirmedNoWatermark: true,
      qualityEvidence: 'decoded-token',
      resolutionMethod: /^qAAB/i.test(token) ? 'dola-qAAB-token' : 'dola-main-url-token'
    };
    const key = `${candidate.type}:${candidate.url}`;
    const current = decoded.get(key);
    if (!current || candidateRank(candidate) > candidateRank(current)) decoded.set(key, candidate);
  };
  const walk = (value: unknown, field = '', context: Record<string, unknown> = {}, depth = 0): void => {
    if (depth > 24 || visited++ > 12_000 || value == null) return;
    if (typeof value === 'string') {
      const nested = value.trim();
      if (nested.length <= maxNestedJsonText && (nested.startsWith('{') || nested.startsWith('['))) {
        try { walk(JSON.parse(nested), field, context, depth + 1); return; } catch { /* Try the value as a token below. */ }
      }
      addDecoded(value, field, context); return;
    }
    if (typeof value !== 'object' || seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) { value.forEach((child) => walk(child, field, context, depth + 1)); return; }
    const node = value as Record<string, unknown>;
    const next = { ...context, ...node };
    for (const [key, child] of Object.entries(node)) {
      if (/^(?:raw_data|audio_data|bytes|base64|binary)$/i.test(key)) continue;
      walk(child, key, next, depth + 1);
    }
  };
  roots.forEach((root) => walk(root));
  const merged = new Map<string, CapturedCandidate>();
  for (const candidate of [...candidates, ...decoded.values()]) {
    const key = `${candidate.type}:${candidate.url}`;
    const current = merged.get(key);
    if (!current || candidateRank(candidate) > candidateRank(current)) merged.set(key, candidate);
  }
  return [...merged.values()];
}
