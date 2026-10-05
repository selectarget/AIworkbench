import { describe, expect, it } from 'vitest';
import { buildDoubaoVisibleVideoIdsScript, doubaoVideoIdFromApi } from '../src/main/doubao-video-scope';

describe('Doubao rendered video ownership', () => {
  it('reads card vid without picking ids from a global history store', () => {
    const node = {
      getBoundingClientRect: () => ({ width: 480, height: 270 }), closest: () => null, parentElement: null,
      '__reactProps$fixture': { media: { video_id: 'current-video', fallback_api: 'https://vas-lf-x.snssdk.com/video/opaque-path?key_seed=sample' }, store: { history: [{ video_id: 'other-video' }] } }
    };
    const snapshot = new Function('document', 'location', 'getComputedStyle', `return ${buildDoubaoVisibleVideoIdsScript()}`)(
      { querySelectorAll: () => [node] }, { href: 'https://www.doubao.com/chat/current' }, () => ({ display: 'block', visibility: 'visible' })
    );
    expect(snapshot.vids).toEqual(['current-video']);
    expect(snapshot.videos).toEqual([{ vid: 'current-video', fallbackApi: 'https://vas-lf-x.snssdk.com/video/opaque-path?key_seed=sample' }]);
    expect(snapshot.pageUrl).toBe('https://www.doubao.com/chat/current');
  });
  it('keeps the exact vid from a fallback API', () => {
    expect(doubaoVideoIdFromApi('https://www.doubao.com/samantha/media/get_play_info?video_id=one&logo_type=unwatermarked')).toBe('one');
    expect(doubaoVideoIdFromApi('not-a-url')).toBeUndefined();
  });
});
