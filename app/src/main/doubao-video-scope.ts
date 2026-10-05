/** Read only rendered media cards; never walk a global React store or request other threads. */
export function buildDoubaoVisibleVideoIdsScript(): string {
  return `(() => {
    const ids = new Set();
    const videos = new Map();
    const seen = new WeakSet();
    let budget = 4000;
    function walk(value, depth = 0) {
      if (!value || depth > 7 || --budget < 0) return;
      if (typeof value === 'string') {
        if (value.length < 100000 && /^[{[]/.test(value.trim())) { try { walk(JSON.parse(value), depth + 1); } catch {} }
        if (/fallback_api|video_id=|[?&]vid=/.test(value)) {
          const match = value.match(/[?&](?:video_id|vid)=([^&"\\s]+)/);
          if (match) { try { ids.add(decodeURIComponent(match[1])); } catch {} }
        }
        return;
      }
      if (typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      const ownVid = value.video_id || value.vid || value.videoId || value.item_vid;
      if (ownVid && typeof value.fallback_api === 'string' && (value.fallback_api.startsWith('https://') || value.fallback_api.startsWith('http://'))) {
        videos.set(String(ownVid), { vid: String(ownVid), fallbackApi: value.fallback_api });
      }
      for (const [key, child] of Object.entries(value)) {
        if (/^(?:vid|video_id|videoId|item_vid)$/i.test(key) && (typeof child === 'string' || typeof child === 'number')) ids.add(String(child));
        if (/^(?:children|return|alternate|stateNode|ref|store|history|threads|conversations|messages|messageList|recommendations|suggestions|related)$/i.test(key)) continue;
        walk(child, depth + 1);
      }
    }
    for (const node of document.querySelectorAll('video,img')) {
      const rect = node.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 120 || node.closest('header,nav,aside,footer,#workbench-doubao-15s')) continue;
      // A card can be just outside the viewport when a new message arrives; it must remain rendered.
      if (getComputedStyle(node).display === 'none' || getComputedStyle(node).visibility === 'hidden') continue;
      let element = node;
      for (let level = 0; element && level < 4; level++, element = element.parentElement) {
        for (const key of Object.keys(element)) {
          if (key.startsWith('__reactProps$')) walk(element[key]);
          if (key.startsWith('__reactFiber$')) {
            let fiber = element[key];
            for (let hop = 0; fiber && hop < 3; hop++, fiber = fiber.return) walk(fiber.memoizedProps);
          }
        }
      }
    }
    return { pageUrl: location.href, vids: [...ids].filter(Boolean).slice(0, 100), videos: [...videos.values()].slice(0, 100) };
  })()`;
}

export function doubaoVideoIdFromApi(api: string): string | undefined {
  try { const url = new URL(api); return url.searchParams.get('video_id') || url.searchParams.get('vid') || undefined; }
  catch { return undefined; }
}
