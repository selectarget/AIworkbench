import { describe, expect, it, vi } from 'vitest';
import { blockedSiteHosts, consumeCompatibilityCancellation, installSiteRequestCompatibility, shouldCancelBlockedSiteRequest } from '../src/main/site-request-compatibility';

describe('blocked site request compatibility', () => {
  it('is opt-in and only cancels background requests to exact verified hosts', () => {
    for (const host of blockedSiteHosts) {
      expect(shouldCancelBlockedSiteRequest(`https://${host}/report?token=private`, 'xhr', true)).toBe(true);
      expect(shouldCancelBlockedSiteRequest(`https://${host}/report`, 'xhr', false)).toBe(false);
      expect(shouldCancelBlockedSiteRequest(`https://${host}/report`, 'mainFrame', true)).toBe(false);
      expect(shouldCancelBlockedSiteRequest(`https://${host}/script.js`, 'script', true)).toBe(false);
      expect(shouldCancelBlockedSiteRequest(`https://${host}/clip.mp4`, 'media', true)).toBe(false);
      expect(shouldCancelBlockedSiteRequest(`https://${host}.example/report`, 'xhr', true)).toBe(false);
    }
    for (const url of ['https://www.doubao.com/login', 'https://www.dola.com/chat', 'https://v26-vdl.doubao.com/clip.mp4', 'https://vas-lf-x.snssdk.com/api', 'https://p3-flow-imagex-sign.byteimg.com/image.png', 'not a URL']) {
      expect(shouldCancelBlockedSiteRequest(url, 'xhr', true)).toBe(false);
    }
  });
  it('keeps cancellation ownership, handles live toggling and logs no signed paths', () => {
    const before = vi.fn(); const ses = { webRequest: { onBeforeRequest: before } } as any;
    const other = {} as any; const sink = vi.fn(); let enabled = true;
    installSiteRequestCompatibility(ses, () => enabled, sink);
    const listener = before.mock.calls[0]![1]; const reply = vi.fn();
    listener({ id: 1, url: 'https://mssdk.bytedance.com/private?token=secret', resourceType: 'xhr' }, reply);
    expect(reply).toHaveBeenLastCalledWith({ cancel: true });
    expect(consumeCompatibilityCancellation(other, 1)).toBe(false);
    expect(consumeCompatibilityCancellation(ses, 1)).toBe(true);
    expect(consumeCompatibilityCancellation(ses, 1)).toBe(false);
    listener({ id: 2, url: 'https://mssdk.bytedance.com/report', resourceType: 'ping' }, reply);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(/private|secret|token/);
    enabled = false;
    listener({ id: 3, url: 'https://mssdk.bytedance.com/report', resourceType: 'xhr' }, reply);
    expect(reply).toHaveBeenLastCalledWith({ cancel: false });
    expect(consumeCompatibilityCancellation(ses, 3)).toBe(false);
    installSiteRequestCompatibility(ses, () => true, sink);
    expect(before).toHaveBeenCalledTimes(1);
    listener({ id: 4, url: 'https://mssdk.bytedance.com/report', resourceType: 'xhr' }, reply);
    expect(reply).toHaveBeenLastCalledWith({ cancel: true });
    expect(sink).toHaveBeenCalledTimes(2);
  });
});
