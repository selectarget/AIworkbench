import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { isPathInside, mediaTypeFromPath, normalizeExternalHttpUrl, normalizeNavigationUrl, sanitizeFilename } from '../src/main/path-utils';

describe('download path safety', () => {
  it('sanitizes Windows reserved filename characters', () => { expect(sanitizeFilename('a<>:"/\\|?*b.mp4')).toBe('a_________b.mp4'); });
  it('rejects traversal outside the download root', () => {
    const root = resolve('portable', 'data', 'downloads');
    expect(isPathInside(root, join(root, '..', 'secret.txt'))).toBe(false);
  });
  it('accepts a nested download path', () => {
    const root = resolve('portable', 'data', 'downloads');
    expect(isPathInside(root, join(root, '豆包', '1.mp4'))).toBe(true);
  });
  it('classifies common media types', () => { expect(mediaTypeFromPath('x.WEBP')).toBe('image'); expect(mediaTypeFromPath('x.mp4')).toBe('video'); });
  it('normalizes host-only navigation and rejects non-web schemes or embedded credentials', () => {
    expect(normalizeNavigationUrl('example.com/path')).toBe('https://example.com/path');
    expect(normalizeNavigationUrl('http://localhost:3000/')).toBe('http://localhost:3000/');
    expect(() => normalizeNavigationUrl('file:///C:/secret.txt')).toThrow('HTTP 或 HTTPS');
    expect(() => normalizeNavigationUrl('https://user:pass@example.com')).toThrow('账号密码');
  });
  it('allows only credential-free HTTP URLs for system-browser opening', () => {
    expect(normalizeExternalHttpUrl('https://cdn.example/video.mp4?x=1')).toBe('https://cdn.example/video.mp4?x=1');
    expect(() => normalizeExternalHttpUrl('file:///C:/secret.txt')).toThrow('HTTP 或 HTTPS');
    expect(() => normalizeExternalHttpUrl('javascript:alert(1)')).toThrow('HTTP 或 HTTPS');
    expect(() => normalizeExternalHttpUrl('https://user:pass@example.com')).toThrow('账号密码');
  });
});
