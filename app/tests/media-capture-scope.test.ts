import { describe, expect, it } from 'vitest';
import { acceptsConversationResponse, acceptsDoubaoCreationCapture } from '../src/main/media-capture-scope';
describe('Doubao history collection capture', () => {
  const creation = 'https://www.doubao.com/chat/create-image?tab=myCreation';
  it('rejects passive collection page traffic and DOM captures', () => {
    for (const source of [undefined, 'cdp:doubao', 'generic-video', 'doubao-image-data']) expect(acceptsDoubaoCreationCapture(creation, source)).toBe(false);
  });
  it('allows explicitly requested scans and downloads', () => {
    for (const source of ['doubao-creation-resource-panel', 'doubao-creation-card', 'site-download']) expect(acceptsDoubaoCreationCapture(creation, source)).toBe(true);
  });
  it('preserves ordinary chat capture and other sites', () => {
    expect(acceptsDoubaoCreationCapture('https://www.doubao.com/chat/123', 'cdp:doubao')).toBe(true);
    expect(acceptsDoubaoCreationCapture('https://www.dola.com/chat', 'generic-video')).toBe(true);
  });
});

it('does not parse media embedded in a history/sidebar response', () => {
  expect(acceptsConversationResponse('https://www.doubao.com/samantha/thread/list')).toBe(false);
  expect(acceptsConversationResponse('https://www.doubao.com/samantha/media/get_play_info')).toBe(true);
});
