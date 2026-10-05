import { createDecipheriv, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { Session } from 'electron';
import { fetchAccountMedia } from './media-request';
import { MediaHttpError } from './download-policy';

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const FALLBACK_USER_AGENT = process.platform === 'darwin'
  ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36'
  : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36';
const QAAB_SALT = Buffer.from('4dd4c2e6b83162090e52b3c7a6733ba41cb2462b829ab58a196b39db57177524f49baf7f08e8d68d26a72e37c1a95a2f1f05a51892aef2949732b62a38aadd58', 'hex');

type JsonObject = Record<string, unknown>;
export type DolaResolveResult = { videoUrl: string; posterUrl: string; alternateUrls?: string[] };

function object(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
function children(value: unknown): unknown[] { return Array.isArray(value) ? value : Object.values(object(value)); }
function stringValue(value: unknown): string { return value == null ? '' : String(value).trim(); }
function property(value: unknown, key: string): unknown { const source = object(value); return source[key] ?? source[Object.keys(source).find((name) => name.toLowerCase() === key.toLowerCase()) ?? '']; }

export function resolverUserAgent(target: Pick<Session, 'getUserAgent'>): string {
  try {
    const value = String(target.getUserAgent?.() ?? '')
      .replace(/\s+Electron\/[^\s]+/ig, '')
      .trim();
    return value || FALLBACK_USER_AGENT;
  } catch {
    return FALLBACK_USER_AGENT;
  }
}

export function buildDolaFallbackUrl(fallbackApi: string): string {
  let url: URL;
  try { url = new URL(fallbackApi.trim()); } catch { throw new Error('fallback_api 不是有效的 HTTP URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('fallback_api 不是有效的 HTTP URL');
  // Match V6.8 LocalVideoResolver.BuildRequestUri: retain the raw query
  // representation of unrelated fields instead of re-encoding signatures.
  const overrides = new Set(['channel', 'codec_type', 'logo_type']);
  const fields = url.search.slice(1).split('&').filter(Boolean).filter((field) => {
    const encodedKey = field.split('=', 1)[0]!;
    let key = encodedKey;
    try { key = decodeURIComponent(encodedKey.replace(/\+/g, ' ')); } catch { /* retain malformed unrelated field */ }
    return !overrides.has(key);
  });
  url.search = [...fields, 'channel=no', 'codec_type=8', 'logo_type=unwatermarked'].join('&');
  return url.href;
}

function decodeBase64Loose(value: string): Buffer | null {
  const input = value.trim(); if (!input) return null;
  const variants = [input, input.replace(/\$/g, '_').replace(/@/g, '/').replace(/#/g, '.'), input.replace(/\$/g, '+').replace(/@/g, '/').replace(/#/g, '=')];
  for (const candidate of [...new Set(variants)]) {
    let normalized = candidate.replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) continue;
    normalized = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
    try {
      const decoded = Buffer.from(normalized, 'base64');
      // Buffer.from is permissive and silently drops invalid characters. The
      // old resolver rejected malformed tokens, so verify the canonical
      // alphabet before accepting a candidate.
      if (decoded.toString('base64').replace(/=+$/, '') === normalized.replace(/=+$/, '')) return decoded;
    } catch { /* Try the next legacy alphabet. */ }
  }
  return null;
}

function asciiUrl(bytes: Buffer): string {
  if (!bytes.length || [...bytes].some((byte) => byte !== 9 && byte !== 10 && byte !== 13 && (byte < 32 || byte > 126))) return '';
  const value = bytes.toString('ascii').trim(); return /^https?:\/\//i.test(value) ? value : '';
}

function stripPkcs7(bytes: Buffer): Buffer | null {
  const count = bytes.at(-1) ?? 0; if (count < 1 || count > 16 || count > bytes.length) return null;
  for (let index = bytes.length - count; index < bytes.length; index++) if (bytes[index] !== count) return null;
  return bytes.subarray(0, bytes.length - count);
}

function decryptAesCbc(payload: Buffer, key: Buffer, iv: Buffer): Buffer | null {
  if (!payload.length || payload.length % 16 !== 0) return null;
  try { const decipher = createDecipheriv('aes-128-cbc', key.subarray(0, 16), iv.subarray(0, 16)); decipher.setAutoPadding(false); return Buffer.concat([decipher.update(payload), decipher.final()]); } catch { return null; }
}

function decodeQaabToken(token: string, keySeed: string): string {
  const payload = decodeBase64Loose(token); const seed = decodeBase64Loose(keySeed); if (!payload || !seed) return '';
  const first = createHash('sha512').update(seed.subarray(0, 32)).digest(); const material = Buffer.concat([first, QAAB_SALT]); const second = createHash('sha512').update(material).digest();
  const key = second.subarray(0, 16); const alternateKey = second.subarray(16, 32); const candidates: Array<{ data: Buffer; key: Buffer; iv: Buffer }> = [];
  if (payload.length >= 4 && payload[0] === 0xa8 && payload[1] === 0 && payload[2] === 1 && payload[3] === 0) {
    const body = payload.subarray(4); candidates.push({ data: body, key, iv: alternateKey }, { data: body, key: alternateKey, iv: key });
    if (payload.length > 36) { const bodyWithHeader = payload.subarray(36); candidates.push({ data: bodyWithHeader, key, iv: payload.subarray(20, 36) }, { data: bodyWithHeader, key, iv: alternateKey }); }
  } else candidates.push({ data: payload, key, iv: alternateKey });
  for (const candidate of candidates) {
    const decrypted = decryptAesCbc(candidate.data, candidate.key, candidate.iv); if (!decrypted) continue;
    const direct = asciiUrl(decrypted); if (direct) return direct; const stripped = stripPkcs7(decrypted); const padded = stripped ? asciiUrl(stripped) : ''; if (padded) return padded;
  }
  return '';
}

export function decodeDolaMainUrl(token: string, keySeed = ''): string {
  const value = token.trim(); if (/^https?:\/\//i.test(value)) return value;
  const decoded = decodeBase64Loose(value); const direct = decoded ? asciiUrl(decoded) : ''; if (direct) return direct;
  return value.startsWith('qAAB') && keySeed ? decodeQaabToken(value, keySeed) : '';
}

function numberValue(value: unknown): number { const result = Number(value); return Number.isFinite(result) ? result : 0; }
function getVideoData(payload: unknown): unknown {
  const root = object(payload); const first = property(root, 'video_info') ?? property(property(root, 'data'), 'video_info') ?? payload; return property(first, 'data') ?? first;
}

type DolaVideoCandidate = { token: string; score: number };

function dolaVideoCandidates(data: unknown): DolaVideoCandidate[] {
  const source = object(data); const list = children(property(source, 'video_list')); const candidates = list.length ? list : [data];
  return candidates.map((item): DolaVideoCandidate | null => {
    const node = object(item); const token = stringValue(property(node, 'main_url') ?? property(node, 'play_url'));
    if (!token) return null;
    const bitrate = numberValue(property(node, 'bitrate') ?? property(node, 'real_bitrate'));
    const width = numberValue(property(node, 'vwidth') ?? property(node, 'width'));
    const height = numberValue(property(node, 'vheight') ?? property(node, 'height'));
    return { token, score: bitrate + width * height };
  }).filter((item): item is DolaVideoCandidate => Boolean(item)).sort((left, right) => right.score - left.score);
}

function pickMainUrlToken(data: unknown): string {
  return dolaVideoCandidates(data)[0]?.token ?? '';
}

function decodeDolaVideoUrls(data: unknown, keySeed: string): string[] {
  const urls: string[] = [];
  for (const candidate of dolaVideoCandidates(data)) {
    const url = decodeDolaMainUrl(candidate.token, keySeed);
    try {
      const parsed = new URL(url);
      if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) continue;
      if (!urls.includes(parsed.href)) urls.push(parsed.href);
    } catch { /* Ignore malformed or non-network decoded candidates. */ }
    if (urls.length >= 9) break;
  }
  return urls;
}

export function findDolaKeySeed(value: unknown, depth = 0): string {
  if (depth > 10 || value == null) return '';
  if (typeof value === 'string') {
    const safeDecode = (input: string): string => { try { return decodeURIComponent(input); } catch { return input; } };
    const query = value.match(/(?:^|[?&])key_seed=([^&"'<>\\\s]+)/i); if (query) return safeDecode(query[1] ?? '');
    const json = value.match(/["']key_seed["']\s*:\s*["']([^"']+)["']/i); return json ? safeDecode(json[1] ?? '') : '';
  }
  const direct = stringValue(property(value, 'key_seed')); if (direct) return direct;
  for (const child of children(value)) { const found = findDolaKeySeed(child, depth + 1); if (found) return found; }
  return '';
}

function findString(value: unknown, key: string, depth = 0): string {
  if (depth > 10 || value == null) return ''; const direct = stringValue(property(value, key)); if (direct) return direct;
  for (const child of children(value)) { const found = findString(child, key, depth + 1); if (found) return found; }
  return '';
}

export function parseDolaResolveResponse(json: string): DolaResolveResult {
  let payload: unknown; try { payload = JSON.parse(json); } catch { throw new Error('fallback_api 返回内容不是 JSON'); }
  const data = getVideoData(payload); const urls = decodeDolaVideoUrls(data, findDolaKeySeed(payload));
  if (!urls[0]) {
    if (!pickMainUrlToken(data)) throw new Error('fallback_api 没有返回 main_url');
    throw new Error('main_url 解码失败');
  }
  return { videoUrl: urls[0], alternateUrls: urls.slice(1), posterUrl: findString(payload, 'poster_url') };
}

export function extractDolaFallbackApis(text: string, acceptedVideoIds?: ReadonlySet<string>): string[] {
  const result = new Set<string>();
  const pending: Array<{ value: string; depth: number }> = [{ value: text, depth: 0 }];
  const seen = new Set<string>();
  const maxNestedText = 10 * 1024 * 1024;

  const decodeStringLiteral = (value: string): string => {
    try { return JSON.parse(`"${value}"`) as string; } catch {
      try { return decodeURIComponent(value.replaceAll('\\/', '/').replaceAll('\\u0026', '&').replaceAll('\\u003d', '=')); } catch { return value.replaceAll('\\/', '/'); }
    }
  };
  const add = (value: unknown): void => {
    if (result.size >= 6 || typeof value !== 'string') return;
    const candidate = decodeStringLiteral(value).trim();
    try {
      const url = new URL(candidate);
      if (acceptedVideoIds && !acceptedVideoIds.has(url.searchParams.get('video_id') || url.searchParams.get('vid') || '')) return;
      if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname) result.add(candidate);
    } catch { /* Ignore malformed candidates just like the old resolver. */ }
  };
  const enqueueNested = (value: string, depth: number): void => {
    if (depth < 8 && value.length > 0 && value.length <= maxNestedText && value.includes('fallback_api')) pending.push({ value, depth });
  };
  const visit = (value: unknown, depth: number): void => {
    if (depth > 8 || value == null || result.size >= 6) return;
    if (typeof value === 'string') { enqueueNested(value, depth + 1); return; }
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    if (typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/^fallback_api$/i.test(key)) add(child);
      else visit(child, depth + 1);
    }
  };
  // V4.4 also inspected escaped fragments that were not valid top-level
  // JSON. Keep equivalent coverage for raw JSON, SSE, and nested strings.
  const rawPattern = /\\?["']fallback_api\\?["']\s*:\s*\\?["'](?<url>(?:\\.|[^"\\])+?)\\?["']/gi;
  while (pending.length && result.size < 6) {
    const current = pending.shift()!;
    if (seen.has(current.value)) continue;
    seen.add(current.value);
    try { visit(JSON.parse(current.value), current.depth); } catch { /* Regex handles non-JSON fragments. */ }
    for (const match of current.value.matchAll(rawPattern)) add(match.groups?.url ?? '');
    for (const match of current.value.matchAll(/fallback_api\s*[:=]\s*["'](?<url>https?:\/\/[^"'\s\\]+)/ig)) add(match.groups?.url ?? '');
  }
  return [...result];
}

export class DolaVideoResolver {
  async resolve(fallbackApi: string, target: Session, referer = 'https://dola.com/'): Promise<DolaResolveResult> {
    const url = buildDolaFallbackUrl(fallbackApi); const response = await fetchAccountMedia(target, url, { headers: { accept: 'application/json,text/plain,*/*', 'user-agent': resolverUserAgent(target), referer, origin: new URL(referer).origin }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) { await response.body?.cancel(); throw new MediaHttpError(response.status, response.headers.get('retry-after')); }
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_RESPONSE_BYTES) { await response.body?.cancel(); throw new Error('fallback_api 响应过大'); }
    if (!response.body) throw new Error('fallback_api 返回空响应');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let received = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        received += next.value.byteLength;
        if (received > MAX_RESPONSE_BYTES) throw new Error('fallback_api 响应过大');
        chunks.push(next.value);
      }
    } catch (error) { try { await reader.cancel(); } catch { /* already closed */ } throw error; }
    return parseDolaResolveResponse(Buffer.concat(chunks).toString('utf8'));
  }
}
