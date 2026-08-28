(function () {
  if (window.__genericVideoCaptureInstalled) return;
  window.__genericVideoCaptureInstalled = true;

  if (/(\.|^)doubao\.com$/i.test(location.hostname)) return;
  // Kimi used moonshot.cn historically and may land on kimi.com in newer
  // shells. Keep it on the generic path instead of silently disabling all
  // page/performance media capture.

  const seen = new Set();
  const videoExtPattern = /\.(mp4|webm|mov|m4v|mkv|avi|flv|ts|m2ts|mts|mpeg|mpg|3gp|3g2|ogv)(\?|#|$)/i;
  const imageExtPattern = /\.(png|apng|jpe?g|jfif|webp|gif|bmp|dib|tif|tiff|avif|heic|heif|jxl)(\?|#|$)/i;
  const videoHostPattern = /(video|media|vod|tos|byte|dola|doubao|aliyun|alicdn|s3|amazonaws|cloudfront|cdn)/i;
  const imageHostPattern = /(image|img|media|oss|tos|byte|dola|doubao|aliyun|alicdn|s3|amazonaws|cloudfront|cdn)/i;
  const blockedAssetPattern = /(?:logo|icon|favicon|sprite|avatar|placeholder|loading|empty|default|intro|banner|bg|background|\.css|\.js|\.map)(?:[._-]|\?|#|$)/i;
  // Dola has moved parts of the same authenticated shell to ciciai.com.
  // Keep the stricter card/image heuristics on both hosts; otherwise a
  // ciciai page falls back to the generic DOM rules and can flood the feed
  // with thumbnails or miss video cards that only expose a locator.
  const isDolaPage = /(^|\.)dola\.com$/i.test(location.hostname) || /(^|\.)ciciai\.com$/i.test(location.hostname);
  const isDolaCreateImagePage = isDolaPage && /^\/chat\/create-image(?:\/|$)/i.test(location.pathname);
  const isQianwenPage = /(^|\.)qianwen\.com$/i.test(location.hostname) || /(^|\.)tongyi\.aliyun\.com$/i.test(location.hostname) || /(^|\.)qwen\.ai$/i.test(location.hostname);
  const isKimiPage = /(^|\.)moonshot\.cn$/i.test(location.hostname) || /(^|\.)kimi\.com$/i.test(location.hostname);

  function cleanUrl(value) {
    if (!value || typeof value !== 'string') return '';
    const url = value.trim();
    if (!url || url.startsWith('data:')) return '';
    if (/^[{\[]/.test(url) || /"block_type"|"creation_block"|"content_block"/.test(url)) return '';
    if (!/^https?:\/\//i.test(url) && !/^blob:/i.test(url) && !/^\//.test(url)) return '';
    try {
      return new URL(url, location.href).href;
    } catch (e) {
      return '';
    }
  }

  function looksLikeVideoUrl(url, typeHint) {
    if (!url) return false;
    if (blockedAssetPattern.test(url) || /css-var|index\./i.test(url)) return false;
    const hint = String(typeHint || '');
    // A semantic image hint must win over broad URL heuristics.  CDN paths
    // often contain "media" or "video" even when the resource is a PNG/JPEG.
    if (/image(?:\/|[\s;:_-]|$)/i.test(hint) && !/video(?:\/|[\s;:_-]|$)/i.test(hint)) return false;
    // A CDN path such as /media/result.webp can otherwise match the broad
    // host/path heuristic below.  A concrete image extension wins unless a
    // caller supplied an explicit video semantic hint.
    if (imageExtPattern.test(url) && !/video(?:\/|[\s;:_-]|$)/i.test(hint)) return false;
    if (url.startsWith('blob:')) return true;
    if (/video(?:\/|[\s;:_-]|$)|\b(?:mp4|webm|mov|m4v|mkv|avi|flv|ts|m2ts|mts|mpeg|mpg|3gp|3g2|ogv)\b/i.test(hint)) return true;
    return videoExtPattern.test(url) || (/^https?:/i.test(url) && videoHostPattern.test(url) && /video|mp4|play|media|stream|source|mime_type=video|vod/i.test(url));
  }

  function looksLikeImageUrl(url, typeHint) {
    if (!url) return false;
    if (blockedAssetPattern.test(url) || /css-var|index\./i.test(url)) return false;
    const hint = String(typeHint || '');
    if (/video(?:\/|[\s;:_-]|$)/i.test(hint) && !/image(?:\/|[\s;:_-]|$)/i.test(hint)) return false;
    if (videoExtPattern.test(url) && !/image(?:\/|[\s;:_-]|$)/i.test(hint)) return false;
    if (isQianwenPage && /(?:svg|favicon|logo|icon|sprite|avatar|placeholder|toolbar|menu|button|appcenter|app_center|static|assets|_next|chunk|bundle|\.js|\.css)/i.test(url)) return false;
    if (/image(?:\/|[\s;:_-]|$)|\b(?:png|apng|jpe?g|jfif|webp|gif|bmp|dib|tif|tiff|avif|heic|heif|jxl)\b/i.test(hint)) return true;
    return imageExtPattern.test(url) || (/^https?:/i.test(url) && imageHostPattern.test(url) && /image|img|png|jpe?g|webp|cover|thumb|origin|watermark/i.test(url));
  }

  function mediaTypeHint(node) {
    if (!node || typeof node.getAttribute !== 'function') return '';
    const names = [
      'data-mime-type',
      'data-content-type',
      'data-media-type',
      'data-resource-type',
      'data-file-type',
      'data-format',
      'mime-type',
      'content-type',
      'media-type',
      'format',
      'type'
    ];
    return names.map((name) => node.getAttribute(name) || '').filter(Boolean).join(' ');
  }

  function hintForAttribute(name, node) {
    const semanticHint = mediaTypeHint(node);
    if (/video|play|movie|stream/i.test(name)) return `${semanticHint} video`;
    if (/image|picture|photo|thumbnail|cover/i.test(name)) return `${semanticHint} image`;
    return semanticHint;
  }

  function parseSrcset(value) {
    if (!value || typeof value !== 'string') return [];
    // A srcset descriptor is a comma-separated list.  Keep only the URL
    // token; descriptors such as `2x` and `800w` are not part of the address.
    return value.split(',')
      .map((item) => item.trim().split(/\s+/)[0] || '')
      .map((item) => cleanUrl(item))
      .filter(Boolean);
  }

  function isLikelyUserContentNode(node) {
    if (!node || node === document.documentElement || node === document.body) return false;
    if (node.closest('header,nav,aside,footer,[role="navigation"],[class*="logo"],[class*="icon"],[class*="avatar"]')) return false;
    if (isDolaPage && node.closest('main,[class*="creation"],[class*="generated"],[class*="asset"],[class*="work"],[class*="media"],[class*="video"],[class*="image"],[class*="card"]')) return true;
    if (isKimiPage) return !!node.closest('main,[class*="message"],[class*="chat"],[class*="conversation"],[class*="assistant"],[class*="answer"],[class*="result"],[class*="generated"],[class*="artifact"],[class*="file"]');
    return !!node.closest('[data-testid], article, main, [class*="message"], [class*="chat"], [class*="conversation"], [class*="answer"], [class*="result"], [class*="media"], [class*="video"], [class*="image"], [class*="creation"], [class*="generated"]');
  }

  function getTitleFromNode(node) {
    const root = node.closest('[data-testid], article, [class*="message"], [class*="card"], [class*="video"], [class*="media"]') || node.parentElement;
    const text = root ? (root.innerText || '').replace(/\s+/g, ' ').trim() : '';
    return text ? text.slice(0, 80) : document.title || 'Dola 视频';
  }

  function isDolaVideoImageNode(img) {
    if (!isDolaPage || !img) return false;
    const root = img.closest('[class*="video"],[class*="player"],[class*="media"],[class*="card"]') || img.parentElement;
    const text = (root?.innerText || '').replace(/\s+/g, ' ').trim();
    const className = `${img.className || ''} ${root?.className || ''}`;
    return /下载视频|生成视频|原视频|播放|预览|video/i.test(`${text} ${className}`);
  }

  function publish(resource) {
    const type = resource.type || 'video';
    const key = `${type}:${resource.url}`;
    if (!resource.url || seen.has(key)) return;
    if (type === 'image' && isDolaCreateImagePage) return;
    seen.add(key);
    const source = resource.source || (type === 'image' ? 'generic-dom-image' : 'generic-dom-video');
    if (type === 'image') {
      window.postMessage({
        type: 'imageDataExtracted',
        data: [{
          // A generic DOM address is only a directly observed page resource.
          // It is not evidence that the server returned an original/no-watermark variant.
          url: resource.url,
          watermark_url: resource.thumbUrl || resource.url,
          width: resource.width,
          height: resource.height,
          title: resource.title,
          source
        }]
      }, '*');
      return;
    }
    window.postMessage({
      type: 'videoDownloadResult',
      data: {
        success: true,
        videoUrl: resource.url,
        title: resource.title,
        thumbUrl: resource.thumbUrl,
        width: resource.width,
        height: resource.height,
        source
      }
    }, '*');
  }

  function collectVideoElement(video) {
    if (!isLikelyUserContentNode(video)) return;
    const posterUrl = cleanUrl(video.poster);
    const elementWidth = video.videoWidth || video.clientWidth || 0;
    const elementHeight = video.videoHeight || video.clientHeight || 0;
    if (isDolaPage) {
      if ((elementWidth && elementWidth < 240) || (elementHeight && elementHeight < 180)) return;
      if (!posterUrl && !video.currentSrc && !video.src && !video.querySelector('source[src]')) return;
    }
    const urls = [
      cleanUrl(video.currentSrc),
      cleanUrl(video.src),
      ...Array.from(video.querySelectorAll('source')).map(source => cleanUrl(source.src))
    ].filter(Boolean);

    for (const url of urls) {
      if (!looksLikeVideoUrl(url, 'video')) continue;
      publish({
        type: 'video',
        url,
        title: getTitleFromNode(video),
        thumbUrl: posterUrl,
        width: elementWidth,
        height: elementHeight
      });
    }
  }

  function collectImageElement(img) {
    if (!isLikelyUserContentNode(img)) return;
    if (isDolaVideoImageNode(img)) return;
    const width = img.naturalWidth || img.clientWidth || 0;
    const height = img.naturalHeight || img.clientHeight || 0;
    if (isQianwenPage && (!width || !height || width < 512 || height < 512)) return;
    if (isDolaPage && (!width || !height || width < 512 || height < 512 || width * height < 700 * 700)) return;
    if ((width && width < 240) || (height && height < 180)) return;
    const candidates = [
      cleanUrl(img.currentSrc),
      cleanUrl(img.src),
      cleanUrl(img.getAttribute('data-src')),
      cleanUrl(img.getAttribute('data-original')),
      cleanUrl(img.getAttribute('data-origin')),
      cleanUrl(img.getAttribute('data-url')),
      ...parseSrcset(img.getAttribute('srcset') || ''),
      ...parseSrcset(img.getAttribute('data-srcset') || ''),
      ...parseSrcset(img.getAttribute('data-original-srcset') || '')
    ].filter(Boolean);

    for (const url of candidates) {
      if (!looksLikeImageUrl(url, 'image')) continue;
      const title = getTitleFromNode(img);
      publish({
        type: 'image',
        url,
        thumbUrl: cleanUrl(img.src) || url,
        width,
        height,
        title
      });
    }
  }

  function scanLinks() {
    const selectors = [
      '[data-src]',
      '[data-original]',
      '[data-origin]',
      '[data-url]',
      '[data-video-url]',
      '[data-play-url]',
      '[data-image-url]',
      '[data-resource-url]',
      '[data-asset-url]',
      '[data-download-url]',
      '[data-original-url]',
      '[data-main-url]'
    ].join(',');

    for (const node of document.querySelectorAll(selectors)) {
      if (!isLikelyUserContentNode(node)) continue;
      const candidates = [
        'data-src',
        'data-original',
        'data-origin',
        'data-url',
        'data-video-url',
        'data-play-url',
        'data-image-url',
        'data-resource-url',
        'data-asset-url',
        'data-download-url',
        'data-original-url',
        'data-main-url'
      ].map((name) => ({ url: cleanUrl(node.getAttribute(name)), hint: hintForAttribute(name, node) })).filter((candidate) => candidate.url);

      for (const candidate of candidates) {
        const url = candidate.url;
        if (looksLikeVideoUrl(url, candidate.hint)) {
          publish({
            type: 'video',
            url,
            title: getTitleFromNode(node),
            thumbUrl: '',
            width: 0,
            height: 0
          });
        } else if (looksLikeImageUrl(url, candidate.hint)) {
          publish({
            type: 'image',
            url,
            title: getTitleFromNode(node),
            thumbUrl: '',
            width: 0,
            height: 0
          });
        }
      }
    }

    // Responsive images are often exposed only through <picture><source>
    // or a lazy-loading data-srcset attribute.  These nodes do not appear in
    // the normal <img> scan, but are still page-visible media candidates.
    for (const node of document.querySelectorAll('source[src],source[srcset],[data-srcset],[data-original-srcset]')) {
      if (!isLikelyUserContentNode(node)) continue;
      const candidates = [
        { url: cleanUrl(node.getAttribute('src')), hint: hintForAttribute('src', node) },
        ...parseSrcset(node.getAttribute('srcset') || '').map((url) => ({ url, hint: 'image' })),
        ...parseSrcset(node.getAttribute('data-srcset') || '').map((url) => ({ url, hint: 'image' })),
        ...parseSrcset(node.getAttribute('data-original-srcset') || '').map((url) => ({ url, hint: 'image' }))
      ].filter((candidate) => candidate.url);
      for (const candidate of candidates) {
        if (looksLikeVideoUrl(candidate.url, candidate.hint)) {
          publish({ type: 'video', url: candidate.url, title: getTitleFromNode(node), thumbUrl: '', width: 0, height: 0 });
        } else if (looksLikeImageUrl(candidate.url, candidate.hint)) {
          publish({ type: 'image', url: candidate.url, title: getTitleFromNode(node), thumbUrl: '', width: 0, height: 0 });
        }
      }
    }
  }

  function collectUrlCandidates(node) {
    const values = [];
    if (!node || node.nodeType !== 1) return values;
    for (const attr of Array.from(node.attributes || [])) {
      const name = attr.name.toLowerCase();
      const value = attr.value || '';
      if (/src|href|url|video|play|media|poster|cover|origin|download|data/.test(name)) values.push({ value, hint: hintForAttribute(name, node) });
    }
    const styleBg = getComputedStyle(node).backgroundImage || '';
    const bgMatch = styleBg.match(/url\(["']?([^"')]+)["']?\)/);
    if (bgMatch) values.push({ value: bgMatch[1], hint: mediaTypeHint(node) });
    return values.map((candidate) => ({ url: cleanUrl(candidate.value), hint: candidate.hint })).filter((candidate) => candidate.url);
  }

  function scanDolaVideoCards() {
    if (!isDolaPage) return;
    const selectors = [
      'video',
      'a[href]',
      '[class*="video"]',
      '[class*="media"]',
      '[class*="creation"]',
      '[class*="asset"]',
      '[class*="work"]',
      '[data-video-url]',
      '[data-play-url]',
      '[data-url]',
      '[data-src]'
    ].join(',');

    for (const node of document.querySelectorAll(selectors)) {
      if (!isLikelyUserContentNode(node)) continue;
      const scope = node.closest('[class*="card"],[class*="creation"],[class*="media"],[class*="video"],[class*="asset"],[class*="work"],article,main') || node;
      const candidates = [
        ...collectUrlCandidates(node),
        ...collectUrlCandidates(scope),
        ...Array.from(scope.querySelectorAll('[src],[href],[data-src],[data-url],[data-video-url],[data-play-url],[data-download-url],[data-resource-url],[data-asset-url],[data-original-url],[data-main-url]')).flatMap(collectUrlCandidates)
      ];
      const cover = scope.querySelector('img[src],img[data-src]');
      const thumbUrl = cleanUrl(cover?.currentSrc) || cleanUrl(cover?.src) || cleanUrl(cover?.getAttribute?.('data-src')) || '';
      for (const candidate of candidates) {
        const url = candidate.url;
        if (!looksLikeVideoUrl(url, candidate.hint)) continue;
        const width = node.videoWidth || node.clientWidth || cover?.naturalWidth || 0;
        const height = node.videoHeight || node.clientHeight || cover?.naturalHeight || 0;
        if (!thumbUrl && ((width && width < 240) || (height && height < 180))) continue;
        if (!thumbUrl && /^blob:/i.test(url)) continue;
        publish({
          type: 'video',
          url,
          title: getTitleFromNode(scope),
          thumbUrl,
          width,
          height
        });
      }
    }
  }

  function scanBackgroundImages() {
    // Canvas-backed cards and virtualized galleries commonly keep the
    // generated image in CSS rather than an <img>.  Limit this fallback to
    // likely user-content nodes and reasonably sized visible boxes so app
    // chrome, icons and decorative backgrounds do not flood the resource
    // panel.
    const selectors = '[style*="background"],[data-background-image],[data-bg-url]';
    for (const node of document.querySelectorAll(selectors)) {
      if (!isLikelyUserContentNode(node)) continue;
      const rect = node.getBoundingClientRect();
      const width = Math.max(node.clientWidth || 0, Math.round(rect.width || 0));
      const height = Math.max(node.clientHeight || 0, Math.round(rect.height || 0));
      if ((width && width < 240) || (height && height < 180)) continue;
      const candidates = [
        ...collectUrlCandidates(node),
        { url: cleanUrl(node.getAttribute('data-background-image')), hint: 'image' },
        { url: cleanUrl(node.getAttribute('data-bg-url')), hint: 'image' }
      ].filter((candidate) => candidate.url);
      for (const candidate of candidates) {
        if (!looksLikeImageUrl(candidate.url, candidate.hint)) continue;
        publish({ type: 'image', url: candidate.url, title: getTitleFromNode(node), thumbUrl: candidate.url, width, height });
      }
    }
  }

  function scanPerformanceResources() {
    // Some SPA renderers request the final asset, then replace the media node
    // with a canvas or a virtualized card. Performance entries are useful as a
    // bounded fallback, but they must stay conservative: only media-looking
    // URLs with an image/video initiator are accepted so logos, CSS, scripts,
    // fonts and API responses do not flood the resource panel.
    if (!window.performance || typeof window.performance.getEntriesByType !== 'function') return;
    let entries = [];
    try { entries = window.performance.getEntriesByType('resource').slice(-1000); } catch (e) { return; }
    for (const entry of entries) {
      const url = cleanUrl(entry && entry.name);
      const initiator = String(entry && entry.initiatorType || '').toLowerCase();
      if (!url) continue;
      if (looksLikeVideoUrl(url) && (initiator === 'video' || initiator === 'source' || /(?:video|media|vod|play|stream)/i.test(url))) {
        publish({ type: 'video', url, title: document.title || '视频资源', source: 'generic-performance-video', width: 0, height: 0 });
      } else if (looksLikeImageUrl(url) && (initiator === 'img' || initiator === 'image')) {
        publish({ type: 'image', url, title: document.title || '图片资源', source: 'generic-performance-image', width: 0, height: 0 });
      }
    }
  }

  function scan() {
    document.querySelectorAll('video').forEach(collectVideoElement);
    document.querySelectorAll('img').forEach(collectImageElement);
    scanLinks();
    scanDolaVideoCards();
    scanBackgroundImages();
    scanPerformanceResources();
  }

  const observer = new MutationObserver(() => {
    clearTimeout(observer._timer);
    observer._timer = setTimeout(scan, 300);
  });

  let started = false;
  const start = () => {
    if (started) return;
    const root = document.documentElement || document.body;
    if (!root) {
      window.setTimeout(start, 0);
      return;
    }
    started = true;
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'href', 'style', 'data-src', 'data-srcset', 'data-original', 'data-original-srcset', 'data-origin', 'data-url', 'data-video-url', 'data-play-url', 'data-image-url', 'data-resource-url', 'data-asset-url', 'data-download-url', 'data-original-url', 'data-main-url', 'data-background-image', 'data-bg-url', 'data-mime-type', 'data-content-type', 'data-media-type', 'data-resource-type', 'data-file-type', 'data-format']
    });
    scan();
    window.setInterval(scan, 3000);
  };

  window.addEventListener('loadedmetadata', (event) => {
    if (event.target && event.target.tagName === 'VIDEO') collectVideoElement(event.target);
  }, true);
  window.addEventListener('play', (event) => {
    if (event.target && event.target.tagName === 'VIDEO') collectVideoElement(event.target);
  }, true);
  window.addEventListener('load', (event) => {
    if (event.target && event.target.tagName === 'IMG') collectImageElement(event.target);
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
    window.setTimeout(start, 0);
  } else {
    start();
  }
})();
