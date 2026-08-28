import { isAbsolute, relative, resolve } from 'node:path';
import { mediaTypeFromExtension } from './media-formats';

export function sanitizeFilename(value: string, fallback = 'download.bin'): string {
  const cleaned = String(value || fallback).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '').slice(0, 180);
  return cleaned || fallback;
}

export function isPathInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel);
}

export function mediaTypeFromPath(path: string): 'image' | 'video' | 'other' {
  return mediaTypeFromExtension(path);
}

/** Normalize the address-bar input while keeping navigation on web origins. */
export function normalizeNavigationUrl(value: string): string {
  const input = String(value ?? '').trim();
  if (!input) throw new Error('网页地址不能为空');
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try { url = new URL(candidate); } catch { throw new Error('网页地址格式不正确'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('网页地址只允许使用 HTTP 或 HTTPS');
  if (url.username || url.password) throw new Error('网页地址不能包含账号密码');
  return url.toString();
}

/** Validate a URL before handing it to the operating system's default browser. */
export function normalizeExternalHttpUrl(value: string): string {
  const input = String(value ?? '').trim();
  if (!input) throw new Error('外部地址不能为空');
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('外部地址格式不正确'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('外部地址只允许使用 HTTP 或 HTTPS');
  if (url.username || url.password) throw new Error('外部地址不能包含账号密码');
  return url.toString();
}
