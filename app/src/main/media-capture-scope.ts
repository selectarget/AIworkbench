export function acceptsDoubaoCreationCapture(pageUrl: string, source?: string): boolean {
  let page: URL;
  try { page = new URL(pageUrl); } catch { return true; }
  if (!/(^|\.)doubao\.com$/i.test(page.hostname) || !/^\/chat\/create-image\/?$/i.test(page.pathname)) return true;
  // Collection pages contain historical works. Only explicit scans or card downloads may publish them.
  return source === 'doubao-creation-resource-panel' || source === 'doubao-creation-card' || source === 'site-download';
}
