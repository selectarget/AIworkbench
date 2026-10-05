import type { MediaResource } from './contracts';

export function conversationKey(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl);
    const queryId = url.searchParams.get('conversation_id') || url.searchParams.get('chat_id') || url.searchParams.get('thread_id');
    if (queryId) return queryId;
    const match = url.pathname.match(/^\/chat\/(?:thread\/)?([^/]+)\/?$/);
    if (!match || /^(?:list|thread|create-image|search|settings)$/i.test(match[1]!)) return null;
    return decodeURIComponent(match[1]!);
  } catch { return null; }
}

export function mediaBelongsToPage(resource: Pick<MediaResource, 'conversationId' | 'threadUrl' | 'capturePageUrl'>, pageUrl: string): boolean {
  const current = conversationKey(pageUrl);
  if (!current) return false;
  // An explicit platform id is stronger evidence than the page where a response arrived.
  const owner = resource.conversationId || conversationKey(resource.threadUrl || '') || conversationKey(resource.capturePageUrl || '');
  return owner === current;
}
