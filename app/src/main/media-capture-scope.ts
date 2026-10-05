export function acceptsDoubaoCreationCapture(pageUrl: string, source?: string): boolean {
  let page: URL;
  try { page = new URL(pageUrl); } catch { return true; }
  if (!/(^|\.)doubao\.com$/i.test(page.hostname) || !/^\/chat\/create-image\/?$/i.test(page.pathname)) return true;
  // Collection pages contain historical works. Only explicit scans or card downloads may publish them.
  return source === 'doubao-creation-resource-panel' || source === 'doubao-creation-card' || source === 'site-download';
}

export function acceptsConversationResponse(responseUrl: string): boolean {
  try {
    const url = new URL(responseUrl);
    // History/sidebar endpoints can return media belonging to many conversations.
    return !/\/(?:thread|conversation|chat)\/(?:list|list_all|history|search)(?:\/|$)/i.test(url.pathname);
  } catch { return true; }
}
