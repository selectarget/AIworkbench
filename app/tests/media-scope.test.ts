import { describe, expect, it } from 'vitest';
import { conversationKey, mediaBelongsToPage } from '../src/shared/media-scope';

describe('current conversation materials', () => {
  const page = 'https://www.doubao.com/chat/12345';
  it('matches a captured conversation while ignoring page query changes', () => {
    expect(mediaBelongsToPage({ capturePageUrl: `${page}?from=history` }, page)).toBe(true);
    expect(mediaBelongsToPage({ conversationId: '12345' }, page)).toBe(true);
  });
  it('does not attribute another conversation response to the current page', () => {
    expect(mediaBelongsToPage({ conversationId: '98765', capturePageUrl: page }, page)).toBe(false);
    expect(mediaBelongsToPage({ capturePageUrl: 'https://www.doubao.com/chat/98765' }, page)).toBe(false);
  });
  it('hides legacy records whose conversation cannot be proven', () => {
    expect(mediaBelongsToPage({}, page)).toBe(false);
    expect(mediaBelongsToPage({ capturePageUrl: 'https://www.doubao.com/chat/create-image' }, page)).toBe(false);
  });
  it('recognizes thread routes but not history or creation collections', () => {
    expect(conversationKey('https://www.dola.com/chat/thread/12345')).toBe('12345');
    expect(conversationKey('https://www.doubao.com/chat/thread/list')).toBe(null);
    expect(conversationKey('https://www.doubao.com/chat/create-image')).toBe(null);
  });
});
