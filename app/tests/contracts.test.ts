import { describe, expect, it } from 'vitest';
import { accountInputSchema, browserProfileSchema, settingsSchema, videoGeneratedNoticeSchema } from '../src/shared/contracts';

describe('contracts', () => {
  it('accepts a disabled empty proxy', () => {
    expect(accountInputSchema.parse({ name: '豆包 1', platform: 'doubao', group: '', remark: '', customUrl: '', proxy: { enabled: false, type: 'http', host: '', username: '', password: '' } }).name).toBe('豆包 1');
  });
  it('rejects an enabled proxy without endpoint', () => {
    expect(() => accountInputSchema.parse({ name: 'x', platform: 'dola', proxy: { enabled: true, type: 'http', host: '', username: '', password: '' } })).toThrow();
  });
  it('enables the response patch by default', () => {
    expect(settingsSchema.parse({}).experimentalResponsePatchEnabled).toBe(true);
  });
  it('keeps the legacy ordinary-resource filename prefix setting', () => {
    expect(settingsSchema.parse({}).videoFilenamePrefix).toBe('');
    expect(settingsSchema.parse({ videoFilenamePrefix: ' 项目A ' }).videoFilenamePrefix).toBe('项目A');
  });
  it('keeps the video download directory optional for backwards-compatible settings', () => {
    expect(settingsSchema.parse({}).videoDownloadDir).toBe('');
    expect(settingsSchema.parse({ videoDownloadDir: 'D:/videos' }).videoDownloadDir).toBe('D:/videos');
  });
  it('keeps V4.4 folder compatibility opt-in for new settings', () => {
    expect(settingsSchema.parse({}).legacyV44MediaFolders).toBe(false);
    expect(settingsSchema.parse({ legacyV44MediaFolders: true }).legacyV44MediaFolders).toBe(true);
  });
  it('keeps the resource panel visibility preference in settings', () => {
    expect(settingsSchema.parse({}).resourcesCollapsed).toBe(false);
    expect(settingsSchema.parse({ resourcesCollapsed: true }).resourcesCollapsed).toBe(true);
  });
  it('persists the legacy resource capture mode', () => {
    expect(settingsSchema.parse({}).captureMode).toBe('all');
    expect(settingsSchema.parse({ captureMode: 'video' }).captureMode).toBe('video');
  });
  it('keeps image parsing off for new and existing settings until explicitly enabled', () => {
    expect(settingsSchema.parse({}).parseImages).toBe(false);
    expect(settingsSchema.parse({ captureMode: 'all' }).parseImages).toBe(false);
    expect(settingsSchema.parse({ parseImages: true }).parseImages).toBe(true);
    expect(settingsSchema.parse({ parseImages: false }).parseImages).toBe(false);
  });
  it('persists the Dola aspect ratio in the application settings', () => {
    expect(settingsSchema.parse({}).dolaAspectRatio).toBe('16:9');
    expect(settingsSchema.parse({ dolaAspectRatio: '9:16' }).dolaAspectRatio).toBe('9:16');
    expect(settingsSchema.parse({ dolaAspectRatio: '3:4' }).dolaAspectRatio).toBe('3:4');
    expect(settingsSchema.parse({ dolaAspectRatio: '21:9' }).dolaAspectRatio).toBe('21:9');
    expect(() => settingsSchema.parse({ dolaAspectRatio: '2:1' })).toThrow();
  });
  it('bounds generated-video notification metadata', () => {
    expect(videoGeneratedNoticeSchema.parse({ key: 'record-1', title: '新视频' })).toEqual({ key: 'record-1', title: '新视频' });
    expect(() => videoGeneratedNoticeSchema.parse({ key: '' })).toThrow();
    expect(() => videoGeneratedNoticeSchema.parse({ key: 'x'.repeat(513) })).toThrow();
  });
  it('keeps a per-account last page address separate from the home page', () => {
    expect(browserProfileSchema.parse({ homeUrl: 'https://example.com/home', lastUrl: 'https://example.com/work', restoreOnStart: true }).lastUrl).toBe('https://example.com/work');
    expect(browserProfileSchema.parse({}).lastUrl).toBe('');
  });
  it('allows only HTTP(S) browser destinations', () => {
    expect(() => browserProfileSchema.parse({ homeUrl: 'javascript:alert(1)' })).toThrow(/HTTP 或 HTTPS/);
    expect(() => accountInputSchema.parse({ name: '自定义', platform: 'custom', customUrl: 'file:///tmp/page.html' })).toThrow(/HTTP 或 HTTPS/);
  });
});
