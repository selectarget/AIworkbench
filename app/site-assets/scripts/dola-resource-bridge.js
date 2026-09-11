(function () {
  'use strict';

  // Dola's old extension mixed page capture, UI and direct browser-download
  // calls.  This replacement deliberately keeps only the page-side part:
  // observe resources that the already authenticated page exposes, publish
  // them to the existing remote preload, and let Main Process own downloads.
  if (!/(^|\.)dola\.com$/i.test(location.hostname) && !/(^|\.)ciciai\.com$/i.test(location.hostname)) return;
  if (window.__AIAM_DOLA_RESOURCE_BRIDGE__) return;
  window.__AIAM_DOLA_RESOURCE_BRIDGE__ = true;

  var MAX_RECORDS = 40;
  var MAX_TEXT = 2 * 1024 * 1024;
  var records = [];
  var recordCounter = 0;
  var posted = new Map();
  var postedTokens = new Set();
  var videoNoticeSeen = new Set();
  var videoNoticeReady = false;
  var generationWasVisible = false;
  var generationStartedAt = 0;
  var scanTimer = 0;
  var parseBudget = 0;
  var fallbackRecords = window.__dolaNativeFallbackRecords = window.__dolaNativeFallbackRecords || [];
  var recentClickDownloads = new Map();
  var QAAB_SALT_HEX = '4dd4c2e6b83162090e52b3c7a6733ba41cb2462b829ab58a196b39db57177524f49baf7f08e8d68d26a72e37c1a95a2f1f05a51892aef2949732b62a38aadd58';
  var fplayPattern = /\/video\/fplay\//i;
  var videoExtensionPattern = /\.(?:mp4|webm|mov|m4v|mkv|avi|flv|ts|m2ts|mts|mpeg|mpg|3gp|3g2|ogv)(?:[?#]|$)/i;
  var streamPattern = /\.(?:m3u8|mpd)(?:[?#]|$)/i;
  var blockedPattern = /(?:logo|favicon|sprite|avatar|placeholder|loading|empty|default|banner|background|\.css|\.js|\.map)(?:[._\/-]|[?#]|$)/i;
  var candidateKeyPattern = /^(?:main_url|mainurl|play_url|playurl|video_url|videourl|download_url|downloadurl|origin_url|original_url|raw_url|source_url|media_url|mediaUrl|fplay_url|fplayUrl|no[_-]?watermark(?:[_-]?url)?|watermark[_-]?free[_-]?url|unwatermarked[_-]?url|backup_url|backupUrl|url)$/i;
  var qualityKeyPattern = /(?:no[_-]?watermark|without[_-]?watermark|original|origin|raw|source|download|main_url|play_url)/i;
  var scriptStyleId = 'aiam-dola-resource-bridge-style';
  var videoOverlayMap = new Map();
  var videoElementCounter = 0;

  function asString(value) {
    return value == null ? '' : String(value).trim();
  }

  function cleanText(value) {
    return asString(value).replace(/\s+/g, ' ').slice(0, 120);
  }

  function isVisibleNode(node) {
    if (!node || !node.isConnected) return false;
    var rect = node.getBoundingClientRect();
    return rect.width >= 120 && rect.height >= 120;
  }

  function noticeImageUrl(root) {
    var image = root && root.querySelector && root.querySelector('img[src],img[data-src]');
    return image ? cleanUrl(image.currentSrc || image.src || image.getAttribute('data-src') || '') : '';
  }

  function noticeKey(root, video) {
    var source = video && (video.currentSrc || video.src || video.poster || '');
    var image = noticeImageUrl(root);
    var text = cleanText(root && root.innerText);
    var rect = root && root.getBoundingClientRect ? root.getBoundingClientRect() : { width: 0, height: 0 };
    return source || image || text || Math.round(rect.width) + 'x' + Math.round(rect.height);
  }

  function hasActiveGenerationText() {
    var text = cleanText(document.body && document.body.innerText);
    return /正在.*生成视频|正在为您生成视频|预计等待|生成中|视频生成中|消耗\s*\d+\s*个视频生成额度/i.test(text);
  }

  function findNoticeRoots() {
    var roots = new Set();
    document.querySelectorAll('video').forEach(function (video) {
      var root = video;
      for (var index = 0; index < 6 && root && root !== document.body; index += 1) {
        var text = cleanText(root.innerText);
        if (/下载视频|原视频|生成好|video/i.test(text) || root.querySelector('button,[role="button"],a')) break;
        root = root.parentElement;
      }
      if (root) roots.add(root);
    });
    document.querySelectorAll('button,[role="button"],a').forEach(function (button) {
      var text = cleanText(button.innerText || button.textContent);
      if (!/下载视频|原视频|打开链接|generated/i.test(text)) return;
      var root = button;
      for (var index = 0; index < 6 && root && root !== document.body; index += 1) {
        if (root.querySelector('video,img')) break;
        root = root.parentElement;
      }
      if (root) roots.add(root);
    });
    return Array.from(roots);
  }

  function scanGeneratedVideoNotices() {
    var roots = findNoticeRoots();
    var generatingNow = hasActiveGenerationText();
    if (!videoNoticeReady) {
      roots.forEach(function (root) {
        if (!isVisibleNode(root)) return;
        var key = noticeKey(root, root.querySelector && root.querySelector('video'));
        if (key) videoNoticeSeen.add(key);
      });
      generationWasVisible = generatingNow;
      generationStartedAt = generatingNow ? Date.now() : 0;
      videoNoticeReady = true;
      return;
    }
    if (generatingNow && !generationWasVisible) generationStartedAt = Date.now();
    generationWasVisible = generatingNow;
    if (!generationStartedAt || Date.now() - generationStartedAt >= 30 * 60 * 1000) return;
    roots.forEach(function (root) {
      if (!isVisibleNode(root)) return;
      var video = root.querySelector && root.querySelector('video');
      var key = noticeKey(root, video);
      if (!key || videoNoticeSeen.has(key)) return;
      videoNoticeSeen.add(key);
      if (videoNoticeSeen.size > 120) videoNoticeSeen.delete(videoNoticeSeen.values().next().value);
      window.postMessage({ type: 'videoGeneratedNotice', data: { key: key, title: cleanText(root.innerText), thumbUrl: noticeImageUrl(root) } }, '*');
    });
  }

  function cleanUrl(value) {
    var text = asString(value);
    // Dola has returned the same public URL through JSON, SSE, HTML and
    // postMessage at different points in time.  Normalize only the bounded
    // textual encodings here, before URL parsing, so an encoded candidate is
    // not discarded by the page bridge before it reaches Main Process.
    for (var round = 0; round < 3; round += 1) {
      var before = text;
      text = text
        .replace(/\\u([0-9a-f]{4})/gi, function (_match, digits) { return String.fromCharCode(parseInt(digits, 16)); })
        .replace(/\\\//g, '/')
        .replace(/\\(["'\\])/g, '$1')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&apos;/gi, "'")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#x([0-9a-f]+);?/gi, function (match, digits) { var codePoint = parseInt(digits, 16); return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match; })
        .replace(/&#(\d+);?/g, function (match, digits) { var codePoint = parseInt(digits, 10); return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match; })
        .trim();
      for (var quoteRound = 0; quoteRound < 3 && text.length >= 2 && ((text[0] === '"' && text[text.length - 1] === '"') || (text[0] === "'" && text[text.length - 1] === "'")); quoteRound += 1) text = text.slice(1, -1).trim();
      if (text === before) break;
    }
    if (!text || text.indexOf('data:') === 0 || text.length > 8192) return '';
    try {
      var parsed = new URL(text, location.href);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'blob:') return '';
      return parsed.href;
    } catch (_error) {
      return '';
    }
  }

  function decodeDirectUrl(value) {
    var direct = cleanUrl(value);
    if (direct) return direct;
    var text = asString(value);
    if (!text || text.length < 24 || text.length > 4096 || !/^[A-Za-z0-9+/_$@#=-]+$/.test(text)) return '';
    try {
      var normalized = text.replace(/\$/g, '_').replace(/@/g, '/').replace(/#/g, '=').replace(/-/g, '+').replace(/_/g, '/');
      while (normalized.length % 4) normalized += '=';
      var decoded = atob(normalized);
      if (!/^https?:\/\//i.test(decoded)) return '';
      return cleanUrl(decoded);
    } catch (_error) {
      return '';
    }
  }

  function isDownloadableVideo(url) {
    if (!url || streamPattern.test(url) || blockedPattern.test(url)) return false;
    if (/^blob:/i.test(url) || fplayPattern.test(url) || videoExtensionPattern.test(url)) return true;
    return /(?:video|play|vod|media|stream|mp4|fplay)/i.test(url) && !/(?:\.png|\.jpe?g|\.webp|\.gif|\.svg)(?:[?#]|$)/i.test(url);
  }

  function uniqueVideoUrls(values) {
    var result = [];
    (values || []).forEach(function (value) {
      var url = cleanUrl(value);
      if (url && isDownloadableVideo(url) && result.indexOf(url) < 0) result.push(url);
    });
    return result.slice(0, 8);
  }

  function legacyMediaUrls(values) {
    var result = [];
    (values || []).forEach(function (value) {
      var url = decodeDirectUrl(value);
      if (!/^https?:\/\//i.test(url) || !isDownloadableVideo(url) || result.indexOf(url) >= 0) return;
      result.push(url);
    });
    return result.slice(0, 8);
  }

  function appendKeySeed(url, keySeed) {
    var seed = asString(keySeed);
    if (!seed || !fplayPattern.test(url)) return url;
    try {
      var parsed = new URL(url);
      if (!parsed.searchParams.get('key_seed')) parsed.searchParams.set('key_seed', seed);
      return parsed.href;
    } catch (_error) {
      return url;
    }
  }

  function upgradeKnownVariant(url) {
    if (!url || /^blob:/i.test(url)) return { url: url, changed: false };
    try {
      var parsed = new URL(url);
      var before = parsed.href;
      parsed.searchParams.forEach(function (value, key) {
        if (key.toLowerCase() === 'lr') parsed.searchParams.set(key, value.replace(/video_gen_watermark_dyn|video_gen_watermark/ig, 'video_gen_no_watermark'));
        if (key.toLowerCase() === 'logo_type' && !/no_watermark|unwatermarked/i.test(value)) parsed.searchParams.set(key, 'no_watermark');
      });
      return { url: parsed.href, changed: parsed.href !== before };
    } catch (_error) {
      return { url: url, changed: false };
    }
  }

  function readFirst(node, keys) {
    if (!node || typeof node !== 'object') return '';
    for (var index = 0; index < keys.length; index += 1) {
      var key = keys[index];
      if (node[key] != null && asString(node[key])) return asString(node[key]);
    }
    return '';
  }

  function readNumber(node, keys) {
    var value = Number(readFirst(node, keys));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  function findKeySeed(value, depth) {
    if (depth > 8 || value == null) return '';
    if (typeof value === 'string') {
      var match = value.match(/(?:^|[?&])key_seed=([^&'"<>\\\s]+)/i);
      return match ? decodeURIComponent(match[1]) : '';
    }
    if (typeof value !== 'object') return '';
    if (asString(value.key_seed)) return asString(value.key_seed);
    if (asString(value.keySeed)) return asString(value.keySeed);
    var values = Array.isArray(value) ? value : Object.keys(value).map(function (key) { return value[key]; });
    for (var index = 0; index < values.length; index += 1) {
      var found = findKeySeed(values[index], depth + 1);
      if (found) return found;
    }
    return '';
  }

  function endpointName(url) {
    var value = asString(url);
    if (/\/samantha\/(?:video|media)\/get_play_info/i.test(value)) return 'play-info';
    if (/\/alice\/media\/bigmusic\/share_save/i.test(value)) return 'share-save';
    if (/\/creativity\/share\/get_video_share_info/i.test(value)) return 'video-share-info';
    if (/\/samantha\/thread\/share\/info/i.test(value)) return 'thread-share-info';
    if (/\/im\/chain\/single/i.test(value)) return 'chain-single';
    return 'network';
  }

  function requestContext(body) {
    var text = asString(body);
    if (!text || text.length > 256 * 1024) return {};
    var result = {};
    try {
      var parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        result.messageId = asString(parsed.message_id || parsed.messageId || parsed.msg_id);
        result.conversationId = asString(parsed.conversation_id || parsed.conversationId || parsed.chat_id || parsed.chatId);
        result.vid = asString(parsed.vid || parsed.video_id || parsed.videoId || parsed.key);
        result.shareId = asString(parsed.share_id || parsed.shareId);
        result.keySeed = asString(parsed.key_seed || parsed.keySeed);
        result.dolaRecordKey = asString(parsed.record_key || parsed.recordKey || parsed.dolaRecordKey);
        result.dolaCardId = asString(parsed.card_id || parsed.cardId || parsed.dolaCardId);
        return result;
      }
    } catch (_error) { /* Try a form-encoded body below. */ }
    try {
      var params = new URLSearchParams(text);
      result.messageId = asString(params.get('message_id') || params.get('messageId') || params.get('msg_id'));
      result.conversationId = asString(params.get('conversation_id') || params.get('conversationId') || params.get('chat_id') || params.get('chatId'));
      result.vid = asString(params.get('vid') || params.get('video_id') || params.get('videoId') || params.get('key'));
      result.shareId = asString(params.get('share_id') || params.get('shareId'));
      result.keySeed = asString(params.get('key_seed') || params.get('keySeed'));
      result.dolaRecordKey = asString(params.get('record_key') || params.get('recordKey'));
      result.dolaCardId = asString(params.get('card_id') || params.get('cardId'));
    } catch (_error) { /* Non-text bodies are not useful for page-side correlation. */ }
    return result;
  }

  function metadata(node, inherited) {
    var source = node && typeof node === 'object' ? node : {};
    var parent = inherited || {};
    return Object.assign({}, parent, {
      title: readFirst(source, ['title', 'name', 'prompt', 'description']) || parent.title || document.title || 'Dola 视频',
      width: readNumber(source, ['width', 'vwidth', 'video_width']) || parent.width,
      height: readNumber(source, ['height', 'vheight', 'video_height']) || parent.height,
      duration: readNumber(source, ['duration', 'video_duration']) || parent.duration,
      messageId: readFirst(source, ['message_id', 'messageId', 'item_message_id', 'itemMessageId']) || parent.messageId || '',
      conversationId: readFirst(source, ['conversation_id', 'conversationId', 'chat_id', 'chatId']) || parent.conversationId || '',
      shareId: readFirst(source, ['share_id', 'shareId']) || parent.shareId || '',
      shareUrl: cleanUrl(readFirst(source, ['share_url', 'shareUrl', 'share_link', 'shareLink'])) || parent.shareUrl || '',
      threadUrl: cleanUrl(readFirst(source, ['thread_url', 'threadUrl', 'thread_link', 'threadLink'])) || parent.threadUrl || '',
      vid: readFirst(source, ['vid', 'video_id', 'videoId', 'item_vid']) || parent.vid || '',
      keySeed: readFirst(source, ['key_seed', 'keySeed']) || parent.keySeed || '',
      dolaRecordKey: readFirst(source, ['record_key', 'recordKey', 'dolaRecordKey']) || parent.dolaRecordKey || '',
      dolaCardId: readFirst(source, ['card_id', 'cardId', 'dolaCardId']) || parent.dolaCardId || '',
      coverUrl: decodeDirectUrl(readFirst(source, ['poster_url', 'posterUrl', 'cover_url', 'coverUrl', 'thumb_url', 'thumbUrl'])) || parent.coverUrl || ''
    });
  }

  function candidateIdentity(item) {
    return item.messageId || item.vid || item.shareId || item.dolaRecordKey || item.dolaCardId || item.dolaVideoElementId || item.fplayUrl || item.keySeed || item.videoUrl;
  }

  function sameIdentity(left, right) {
    var leftIds = [left.messageId, left.vid, left.shareId, left.dolaRecordKey, left.dolaCardId, left.dolaVideoElementId, left.fplayUrl, left.keySeed].filter(Boolean);
    var rightIds = [right.messageId, right.vid, right.shareId, right.dolaRecordKey, right.dolaCardId, right.dolaVideoElementId, right.fplayUrl, right.keySeed].filter(Boolean);
    return leftIds.some(function (value) { return rightIds.indexOf(value) >= 0; }) || left.videoUrl === right.videoUrl;
  }

  function recordScore(record, hint) {
    if (!record || !hint) return 0;
    var score = 0;
    if (hint.messageId && record.messageId === hint.messageId) score += 100;
    if (hint.vid && record.vid === hint.vid) score += 90;
    if (hint.shareId && record.shareId === hint.shareId) score += 80;
    if (hint.dolaRecordKey && record.dolaRecordKey === hint.dolaRecordKey) score += 70;
    if (hint.dolaCardId && record.dolaCardId === hint.dolaCardId) score += 60;
    if (hint.dolaVideoElementId && record.dolaVideoElementId === hint.dolaVideoElementId) score += 65;
    if (hint.fplayUrl && record.fplayUrl === hint.fplayUrl) score += 55;
    if (hint.videoUrl && record.videoUrl === hint.videoUrl) score += 50;
    return score;
  }

  function findRecord(hint) {
    var best = null;
    var bestScore = 0;
    records.forEach(function (record) {
      var score = recordScore(record, hint);
      if (score > bestScore) { best = record; bestScore = score; }
    });
    return best || hint;
  }

  function rememberPending(details) {
    var value = details || {};
    var identity = candidateIdentity(value);
    if (!identity) return null;
    var existingIndex = -1;
    for (var index = 0; index < records.length; index += 1) {
      if (sameIdentity(records[index], value)) { existingIndex = index; break; }
    }
    var pending = {
      id: existingIndex >= 0 ? records[existingIndex].id : 'dola-pending-' + String(identity),
      type: 'video',
      videoUrl: asString(value.videoUrl),
      backupUrl: asString(value.backupUrl),
      alternateUrls: uniqueVideoUrls(value.alternateUrls),
      coverUrl: asString(value.coverUrl),
      title: asString(value.title) || document.title || 'Dola 视频',
      width: value.width || undefined,
      height: value.height || undefined,
      duration: value.duration || undefined,
      source: asString(value.source) || 'dola-page-state',
      confirmedNoWatermark: Boolean(value.confirmedNoWatermark),
      qualityEvidence: value.qualityEvidence || 'unknown',
      resolutionMethod: asString(value.resolutionMethod) || 'metadata-only',
      messageId: asString(value.messageId),
      conversationId: asString(value.conversationId),
      shareId: asString(value.shareId),
      shareUrl: asString(value.shareUrl),
      threadUrl: asString(value.threadUrl),
      vid: asString(value.vid),
      keySeed: asString(value.keySeed),
      fplayUrl: asString(value.fplayUrl),
      dolaRecordKey: asString(value.dolaRecordKey),
      dolaCardId: asString(value.dolaCardId),
      dolaVideoElementId: asString(value.dolaVideoElementId)
    };
    if (existingIndex >= 0) {
      var existing = records[existingIndex];
      pending.videoUrl = pending.videoUrl || existing.videoUrl;
      pending.backupUrl = pending.backupUrl || existing.backupUrl;
      pending.alternateUrls = uniqueVideoUrls([].concat(pending.alternateUrls || [], existing.alternateUrls || [], existing.videoUrl || '', existing.backupUrl || '')).filter(function (url) { return url !== pending.videoUrl && url !== pending.backupUrl; }).slice(0, 8);
      pending.coverUrl = pending.coverUrl || existing.coverUrl;
      pending.title = pending.title || existing.title;
      pending.width = pending.width || existing.width;
      pending.height = pending.height || existing.height;
      pending.duration = pending.duration || existing.duration;
      pending.messageId = pending.messageId || existing.messageId;
      pending.conversationId = pending.conversationId || existing.conversationId;
      pending.shareId = pending.shareId || existing.shareId;
      pending.shareUrl = pending.shareUrl || existing.shareUrl;
      pending.threadUrl = pending.threadUrl || existing.threadUrl;
      pending.vid = pending.vid || existing.vid;
      pending.keySeed = pending.keySeed || existing.keySeed;
      pending.fplayUrl = pending.fplayUrl || existing.fplayUrl;
      pending.dolaRecordKey = pending.dolaRecordKey || existing.dolaRecordKey;
      pending.dolaCardId = pending.dolaCardId || existing.dolaCardId;
      pending.dolaVideoElementId = pending.dolaVideoElementId || existing.dolaVideoElementId;
      pending.confirmedNoWatermark = pending.confirmedNoWatermark || existing.confirmedNoWatermark;
      if (existing.qualityEvidence === 'platform-api' || existing.qualityEvidence === 'server-original') pending.qualityEvidence = existing.qualityEvidence;
      records.splice(existingIndex, 1);
    }
    records.unshift(pending);
    if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
    // A card may exist before Dola exposes its final playable URL. The locator-only
    // record still reaches Main Process, and 解析原始 on the workbench's media card asks
    // this page to resolve it later.
    postRecord(pending);
    return pending;
  }

  function qualityFor(key, source, confirmed) {
    if (confirmed && /(?:api|response|fetch|xhr|network|performance)/i.test(source)) return 'platform-api';
    if (/fplay|token|decoded/i.test(key)) return 'decoded-token';
    if (/dom|video-element|performance/i.test(source)) return 'dom-direct';
    return 'unknown';
  }

  function postRecord(record) {
    var signature = JSON.stringify([record.videoUrl, record.backupUrl, record.alternateUrls, record.coverUrl, record.confirmedNoWatermark, record.qualityEvidence, record.resolutionMethod, record.messageId, record.conversationId, record.shareId, record.shareUrl, record.threadUrl, record.vid, record.keySeed, record.fplayUrl, record.dolaRecordKey, record.dolaCardId, record.dolaVideoElementId]);
    if (posted.get(record.id) === signature) return;
    posted.set(record.id, signature);
    window.postMessage({ type: 'videoDataExtracted', data: [record] }, '*');
  }

  function postToken(token, details) {
    var value = asString(token);
    if (!/^qAAB[A-Za-z0-9+/_$@#=-]{16,}$/i.test(value)) return;
    var key = value + '|' + asString(details.keySeed);
    if (postedTokens.has(key)) return;
    postedTokens.add(key);
    if (postedTokens.size > 300) postedTokens.delete(postedTokens.values().next().value);
    window.postMessage({ type: 'dolaTokenExtracted', data: {
      token: value, keySeed: asString(details.keySeed), title: asString(details.title) || document.title || 'Dola 原视频',
      coverUrl: asString(details.coverUrl), width: details.width, height: details.height, duration: details.duration,
      messageId: asString(details.messageId), vid: asString(details.vid), fplayUrl: asString(details.fplayUrl),
      dolaRecordKey: asString(details.dolaRecordKey), dolaCardId: asString(details.dolaCardId), dolaVideoElementId: asString(details.dolaVideoElementId),
      confirmedNoWatermark: Boolean(details.confirmedNoWatermark)
    } }, '*');
  }

  function publish(rawUrl, details) {
    var source = details.source || 'dola-page';
    var original = decodeDirectUrl(rawUrl);
    if (!isDownloadableVideo(original)) return;
    var keySeed = asString(details.keySeed);
    var seeded = appendKeySeed(original, keySeed);
    var upgraded = upgradeKnownVariant(seeded);
    var finalUrl = upgraded.url;
    var confirmed = Boolean(details.confirmedNoWatermark || upgraded.changed || qualityKeyPattern.test(details.field || ''));
    var fplayUrl = fplayPattern.test(seeded) ? seeded : asString(details.fplayUrl);
    var item = {
      id: 'dola-page-' + String(candidateIdentity({ messageId: details.messageId, vid: details.vid, shareId: details.shareId, dolaRecordKey: details.dolaRecordKey, dolaCardId: details.dolaCardId, fplayUrl: fplayUrl, videoUrl: finalUrl }) || (++recordCounter)),
      type: 'video',
      videoUrl: finalUrl,
      backupUrl: upgraded.changed && finalUrl !== original ? original : asString(details.backupUrl),
      alternateUrls: uniqueVideoUrls(details.alternateUrls),
      coverUrl: asString(details.coverUrl),
      title: asString(details.title) || document.title || 'Dola 视频',
      width: details.width || undefined,
      height: details.height || undefined,
      duration: details.duration || undefined,
      source: source,
      confirmedNoWatermark: confirmed,
      qualityEvidence: details.qualityEvidence || qualityFor(details.field || '', source, confirmed),
      resolutionMethod: upgraded.changed ? 'dola-url-variant' : (details.resolutionMethod || 'page-response'),
      messageId: asString(details.messageId),
      conversationId: asString(details.conversationId),
      shareId: asString(details.shareId),
      shareUrl: asString(details.shareUrl),
      threadUrl: asString(details.threadUrl),
      vid: asString(details.vid),
      keySeed: keySeed,
      fplayUrl: fplayUrl,
      dolaRecordKey: asString(details.dolaRecordKey),
      dolaCardId: asString(details.dolaCardId),
      dolaVideoElementId: asString(details.dolaVideoElementId)
    };

    var existingIndex = -1;
    for (var index = 0; index < records.length; index += 1) {
      if (sameIdentity(records[index], item)) { existingIndex = index; break; }
    }
    if (existingIndex >= 0) {
      var existing = records[existingIndex];
      item.id = existing.id;
      item.backupUrl = item.backupUrl || existing.backupUrl;
      item.alternateUrls = uniqueVideoUrls([].concat(item.alternateUrls || [], existing.alternateUrls || [], existing.videoUrl || '', existing.backupUrl || '')).filter(function (url) { return url !== item.videoUrl && url !== item.backupUrl; }).slice(0, 8);
      item.coverUrl = item.coverUrl || existing.coverUrl;
      item.title = item.title || existing.title;
      item.width = item.width || existing.width;
      item.height = item.height || existing.height;
      item.messageId = item.messageId || existing.messageId;
      item.conversationId = item.conversationId || existing.conversationId;
      item.shareId = item.shareId || existing.shareId;
      item.shareUrl = item.shareUrl || existing.shareUrl;
      item.threadUrl = item.threadUrl || existing.threadUrl;
      item.vid = item.vid || existing.vid;
      item.keySeed = item.keySeed || existing.keySeed;
      item.fplayUrl = item.fplayUrl || existing.fplayUrl;
      item.dolaRecordKey = item.dolaRecordKey || existing.dolaRecordKey;
      item.dolaCardId = item.dolaCardId || existing.dolaCardId;
      item.dolaVideoElementId = item.dolaVideoElementId || existing.dolaVideoElementId;
      item.confirmedNoWatermark = item.confirmedNoWatermark || existing.confirmedNoWatermark;
      if (existing.qualityEvidence === 'platform-api' || existing.qualityEvidence === 'server-original') item.qualityEvidence = existing.qualityEvidence;
      records.splice(existingIndex, 1);
    }
    records.unshift(item);
    if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
    postRecord(item);
    return item;
  }

  // Compatibility boundary for the old Dola/Doubao bridge. V4.4 used this
  // event after a page-visible API response had exposed an alternate public
  // media URL. Accept only explicit HTTP(S) video URLs and route them through
  // the same resource record and Main-owned download path as current captures.
  // This does not synthesize a response, invent credentials, or infer that a
  // URL is watermark-free merely because an old producer called it original.
  function rememberLegacyOriginalMedia(items) {
    if (!Array.isArray(items)) return false;
    var changed = false;
    items.slice(0, 16).forEach(function (raw) {
      if (!raw || typeof raw !== 'object' || raw.type !== 'video') return;
      var url = decodeDirectUrl(raw.url || raw.videoUrl);
      if (!/^https?:\/\//i.test(url) || !isDownloadableVideo(url)) return;
      var backupUrl = decodeDirectUrl(raw.backupUrl || raw.backup_url);
      var alternates = legacyMediaUrls([].concat(raw.alternateUrls || [], raw.urls || [], backupUrl || '')).filter(function (value) { return value !== url && value !== backupUrl; });
      publish(url, {
        source: 'legacy-public-original',
        backupUrl: backupUrl,
        alternateUrls: alternates,
        coverUrl: decodeDirectUrl(raw.coverUrl || raw.thumbUrl || raw.cover_url || raw.thumb_url),
        title: asString(raw.title) || 'Dola 原视频',
        width: Number(raw.width) || undefined,
        height: Number(raw.height) || undefined,
        duration: Number(raw.duration) || undefined,
        messageId: asString(raw.messageId || raw.message_id),
        conversationId: asString(raw.conversationId || raw.conversation_id),
        shareId: asString(raw.shareId || raw.share_id),
        shareUrl: decodeDirectUrl(raw.shareUrl || raw.share_url),
        threadUrl: decodeDirectUrl(raw.threadUrl || raw.thread_url),
        vid: asString(raw.videoKey || raw.vid || raw.videoId || raw.video_id),
        keySeed: asString(raw.keySeed || raw.key_seed),
        fplayUrl: decodeDirectUrl(raw.fplayUrl || raw.fplay_url),
        dolaRecordKey: asString(raw.dolaRecordKey || raw.recordKey || raw.record_key),
        dolaCardId: asString(raw.dolaCardId || raw.cardId || raw.card_id),
        dolaVideoElementId: asString(raw.dolaVideoElementId || raw.videoElementId || raw.video_element_id),
        confirmedNoWatermark: Boolean(raw.confirmedNoWatermark),
        qualityEvidence: raw.confirmedNoWatermark ? 'platform-api' : 'unknown',
        resolutionMethod: 'legacy-public-original'
      });
      changed = true;
    });
    return changed;
  }

  function videoKeyFromUrl(value) {
    try {
      var url = cleanUrl(value);
      if (!/^https?:\/\//i.test(url)) return '';
      var parsed = new URL(url, location.href);
      var path = decodeURIComponent(parsed.pathname || '');
      var marker = '/video/tos/';
      var index = path.toLowerCase().indexOf(marker);
      if (index < 0) return '';
      path = path.slice(index).replace(/\/+$/g, '');
      return path.split('/').length >= 5 ? path.toLowerCase() : '';
    } catch (_error) {
      return '';
    }
  }

  function collectVideoKeys(value, depth, out, seen) {
    var keys = out || new Set();
    var visited = seen || new Set();
    if (depth > 8 || value == null) return keys;
    if (typeof value === 'string') {
      var directKey = videoKeyFromUrl(cleanUrl(value));
      if (directKey) keys.add(directKey);
      var pattern = /https?:\\?\/\\?\/[^"'<>\s\\]+/gi;
      var match;
      while ((match = pattern.exec(value))) {
        var found = videoKeyFromUrl(match[0]);
        if (found) keys.add(found);
      }
      return keys;
    }
    if (typeof value !== 'object' || visited.has(value)) return keys;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach(function (item) { collectVideoKeys(item, depth + 1, keys, visited); });
    } else {
      Object.keys(value).forEach(function (key) { collectVideoKeys(value[key], depth + 1, keys, visited); });
    }
    return keys;
  }

  function addFallbackRecord(api, context) {
    var url = cleanUrl(api);
    if (!/^https?:\/\//i.test(url) || !/(?:dola|ciciai)\.com/i.test(url)) return;
    var keys = Array.from(collectVideoKeys(context || '', 0)).filter(Boolean);
    var existing = fallbackRecords.findIndex(function (record) { return record && String(record.api).toLowerCase() === url.toLowerCase(); });
    if (existing >= 0) fallbackRecords.splice(existing, 1);
    fallbackRecords.push({ api: url, keys: keys, time: Date.now() });
    while (fallbackRecords.length > 120) fallbackRecords.shift();
  }

  function rememberFallbackApis(text) {
    var body = asString(text);
    if (!body || body.indexOf('fallback_api') < 0) return;
    var patterns = [
      /["']fallback_api["']\s*:\s*["']([^"']+)["']/gi,
      /fallback_api\\+["']\s*:\s*\\+["']([^\\"']+)/gi,
      /fallback_api[^\n\r]{0,120}?(https?:\\?\/\\?\/[^"'\\\s<>]+)/gi
    ];
    patterns.forEach(function (pattern) {
      var match;
      while ((match = pattern.exec(body))) addFallbackRecord(match[1], body.slice(Math.max(0, match.index - 4000), Math.min(body.length, match.index + 4000)));
    });
    try { rememberFallbackObject(JSON.parse(body), 0, new Set()); } catch (_error) { /* HTML and SSE still match the regexes above. */ }
  }

  function rememberFallbackObject(value, depth, seen) {
    if (depth > 9 || value == null) return;
    if (typeof value === 'string') {
      rememberFallbackApis(value);
      return;
    }
    if (typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (typeof value.fallback_api === 'string') addFallbackRecord(value.fallback_api, value);
    if (Array.isArray(value)) {
      value.forEach(function (item) { rememberFallbackObject(item, depth + 1, seen); });
    } else {
      Object.keys(value).forEach(function (key) { rememberFallbackObject(value[key], depth + 1, seen); });
    }
  }

  function withUnwatermarkParams(url) {
    var parsed = new URL(url, location.href);
    parsed.searchParams.set('channel', 'no');
    parsed.searchParams.set('codec_type', '8');
    parsed.searchParams.set('logo_type', 'unwatermarked');
    return parsed.href;
  }

  function hexBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var index = 0; index < out.length; index += 1) out[index] = parseInt(hex.substr(index * 2, 2), 16);
    return out;
  }

  function concatBytes(left, right) {
    var out = new Uint8Array(left.length + right.length);
    out.set(left, 0);
    out.set(right, left.length);
    return out;
  }

  function stripPkcs7(bytes) {
    if (!bytes || !bytes.length) return null;
    var count = bytes[bytes.length - 1];
    if (count < 1 || count > 16 || count > bytes.length) return null;
    for (var index = bytes.length - count; index < bytes.length; index += 1) if (bytes[index] !== count) return null;
    return bytes.slice(0, bytes.length - count);
  }

  function bytesToHttpUrl(bytes) {
    try {
      if (!bytes || !bytes.length) return '';
      for (var index = 0; index < bytes.length; index += 1) {
        var code = bytes[index];
        if (code !== 9 && code !== 10 && code !== 13 && (code < 32 || code > 126)) return '';
      }
      var text = new TextDecoder('ascii').decode(bytes).replace(/\0+$/g, '').trim();
      return /^https?:\/\//i.test(text) ? text : '';
    } catch (_error) {
      return '';
    }
  }

  function b64BytesLoose(text) {
    try {
      var raw = String(text || '').trim();
      var variants = [raw, raw.replace(/\$/g, '_').replace(/@/g, '/').replace(/#/g, '.'), raw.replace(/\$/g, '+').replace(/@/g, '/').replace(/#/g, '=')];
      var tried = new Set();
      for (var index = 0; index < variants.length; index += 1) {
        var candidate = variants[index];
        if (!candidate || tried.has(candidate)) continue;
        tried.add(candidate);
        candidate = candidate.replace(/-/g, '+').replace(/_/g, '/');
        candidate += '='.repeat((4 - (candidate.length % 4)) % 4);
        try {
          var binary = atob(candidate);
          var bytes = new Uint8Array(binary.length);
          for (var offset = 0; offset < binary.length; offset += 1) bytes[offset] = binary.charCodeAt(offset);
          return bytes;
        } catch (_decodeError) { /* try the next alphabet */ }
      }
    } catch (_error) { /* malformed token */ }
    return null;
  }

  async function tryAesCbc(payload, key, iv) {
    try {
      var cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt']);
      return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv }, cryptoKey, payload));
    } catch (_error) {
      return null;
    }
  }

  async function decodeQaabToken(token, keySeed) {
    try {
      if (!crypto || !crypto.subtle) return '';
      var payload = b64BytesLoose(token);
      var seed = b64BytesLoose(keySeed);
      if (!payload || !seed) return '';
      var first = new Uint8Array(await crypto.subtle.digest('SHA-512', seed.slice(0, Math.min(seed.length, 32))));
      var second = new Uint8Array(await crypto.subtle.digest('SHA-512', concatBytes(first, hexBytes(QAAB_SALT_HEX))));
      var key = second.slice(0, 16);
      var alternate = second.slice(16, 32);
      var attempts = [];
      if (payload.length >= 4 && payload[0] === 168 && payload[1] === 0 && payload[2] === 1 && payload[3] === 0) {
        attempts.push([payload.slice(4), key, alternate], [payload.slice(4), alternate, key]);
        if (payload.length > 36) attempts.push([payload.slice(36), key, payload.slice(20, 36)], [payload.slice(36), key, alternate]);
      } else attempts.push([payload, key, alternate]);
      for (var index = 0; index < attempts.length; index += 1) {
        var body = attempts[index][0];
        if (!body.length || body.length % 16) continue;
        var decrypted = await tryAesCbc(body, attempts[index][1], attempts[index][2]);
        var direct = bytesToHttpUrl(decrypted);
        if (direct) return direct;
        var stripped = bytesToHttpUrl(stripPkcs7(decrypted));
        if (stripped) return stripped;
      }
    } catch (_error) { /* keep the locator-only fallback below */ }
    return '';
  }

  async function decodeMainUrl(token, keySeed) {
    var value = String(token || '').trim();
    if (/^https?:\/\//i.test(value)) return value;
    var decoded = bytesToHttpUrl(b64BytesLoose(value));
    if (decoded) return decoded;
    if (value.indexOf('qAAB') === 0 && keySeed) return decodeQaabToken(value, keySeed);
    return '';
  }

  function pickMainUrlToken(data) {
    var source = (data && data.video_info) || (data && data.data && data.data.video_info) || data;
    var video = (source && source.data) || source || data;
    var list = video && video.video_list ? (Array.isArray(video.video_list) ? video.video_list : Object.keys(video.video_list).map(function (key) { return video.video_list[key]; })) : [video];
    var best = '';
    var bestScore = -Infinity;
    list.filter(Boolean).forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      var token = String(item.main_url || item.play_url || '').trim();
      if (!token) return;
      var score = Number(item.bitrate || item.real_bitrate || 0) + Number(item.vwidth || item.width || 0) * Number(item.vheight || item.height || 0);
      if (!best || score > bestScore) { best = token; bestScore = score; }
    });
    return best;
  }

  function showNativeToast(message, success) {
    try {
      var toast = document.getElementById('dola-native-video-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'dola-native-video-toast';
        (document.body || document.documentElement).appendChild(toast);
      }
      toast.textContent = message;
      toast.style.cssText = [
        'position:fixed', 'z-index:2147483647', 'left:50%', 'top:92px', 'transform:translateX(-50%)',
        'min-width:168px', 'max-width:360px', 'padding:10px 14px', 'box-sizing:border-box', 'border-radius:12px',
        'background:' + (success ? 'rgba(22,163,74,.96)' : 'rgba(220,38,38,.96)'),
        'color:#fff', 'font:700 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', 'text-align:center',
        'box-shadow:0 12px 30px rgba(15,23,42,.28)', 'opacity:1', 'transition:opacity .25s ease', 'pointer-events:none'
      ].join(';');
      clearTimeout(window.__dolaNativeVideoToastTimer);
      window.__dolaNativeVideoToastTimer = setTimeout(function () {
        var node = document.getElementById('dola-native-video-toast');
        if (node) node.style.opacity = '0';
      }, 2600);
    } catch (_error) { /* toast is advisory */ }
  }

  function isDolaVideoUrl(value) {
    try {
      if (!value) return false;
      var parsed = new URL(String(value), location.href);
      var host = (parsed.hostname || '').replace(/^www\./i, '').toLowerCase();
      if (!(host === 'dola.com' || host.endsWith('.dola.com') || host === 'ciciai.com' || host.endsWith('.ciciai.com'))) return false;
      var text = (parsed.pathname + '?' + parsed.search).toLowerCase();
      return text.indexOf('/video/') >= 0 || text.indexOf('.mp4') >= 0 || text.indexOf('.m3u8') >= 0 || text.indexOf('mime_type=video') >= 0 || text.indexOf('content-type=video') >= 0 || text.indexOf('video_mp4') >= 0;
    } catch (_error) {
      return false;
    }
  }

  function findFallbackRecordForClickedUrl(clickedUrl) {
    try {
      rememberFallbackApis(document.documentElement ? document.documentElement.innerHTML : '');
      var clickedKey = videoKeyFromUrl(clickedUrl);
      if (!clickedKey) return null;
      var records = fallbackRecords.filter(function (record) { return record && /^https?:\/\//i.test(cleanUrl(record.api || '')); }).slice().sort(function (left, right) { return Number(right.time || 0) - Number(left.time || 0); });
      return records.find(function (record) { return Array.isArray(record.keys) && record.keys.indexOf(clickedKey) >= 0; }) || null;
    } catch (_error) {
      return null;
    }
  }

  async function resolveFallbackApi(fallbackApi) {
    var response = await fetch(withUnwatermarkParams(fallbackApi), { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error('fallback_api failed ' + response.status);
    var json = await response.json();
    var token = pickMainUrlToken(json);
    var videoUrl = await decodeMainUrl(token, findKeySeed(json, 0));
    var posterUrl = findField(json, ['poster_url', 'posterUrl', 'cover_url', 'coverUrl'], 0) || videoUrl;
    return { videoUrl: videoUrl, posterUrl: posterUrl };
  }

  async function notifyVideoLinkClicked(clickedUrl) {
    var originalUrl = cleanUrl(clickedUrl);
    if (!originalUrl) return false;
    var last = recentClickDownloads.get(originalUrl) || 0;
    if (Date.now() - last < 3000) return true;
    recentClickDownloads.set(originalUrl, Date.now());
    Array.from(recentClickDownloads.entries()).forEach(function (entry) {
      if (Date.now() - entry[1] > 15000) recentClickDownloads.delete(entry[0]);
    });
    var record = findFallbackRecordForClickedUrl(originalUrl);
    if (!record || !record.api) {
      showNativeToast('这个是预览链接，暂未匹配到无水印下载地址', false);
      publish(originalUrl, { source: 'dola-native-video-click', field: 'preview_url', confirmedNoWatermark: false, qualityEvidence: 'dom-direct', resolutionMethod: 'dola-native-video-click' });
      return false;
    }
    showNativeToast('正在解析无水印下载地址...', true);
    try {
      var resolved = await resolveFallbackApi(record.api);
      var videoUrl = cleanUrl(resolved && resolved.videoUrl);
      if (!/^https?:\/\//i.test(videoUrl)) throw new Error('empty');
      var item = publish(videoUrl, {
        source: 'dola-video-fallback-api',
        coverUrl: cleanUrl((resolved && resolved.posterUrl) || videoUrl),
        confirmedNoWatermark: true,
        qualityEvidence: 'platform-api',
        resolutionMethod: 'fallback_api'
      });
      if (item) download(item);
      else download({ videoUrl: videoUrl, coverUrl: cleanUrl((resolved && resolved.posterUrl) || videoUrl), title: 'Dola 原视频', confirmedNoWatermark: true, qualityEvidence: 'platform-api', resolutionMethod: 'fallback_api' });
      showNativeToast('已同步无水印下载地址', true);
      return true;
    } catch (_error) {
      showNativeToast('无水印解析失败，已保留原链接', false);
      publish(originalUrl, { source: 'dola-native-video-click', field: 'preview_url', confirmedNoWatermark: false, qualityEvidence: 'dom-direct', resolutionMethod: 'dola-native-video-click' });
      return false;
    }
  }

  function hrefFromEvent(event) {
    try {
      var path = event.composedPath ? event.composedPath() : [];
      for (var index = 0; index < path.length; index += 1) {
        var node = path[index];
        if (!node) continue;
        if (node.href) return node.href;
        if (node.getAttribute) {
          var href = node.getAttribute('href') || node.getAttribute('src') || node.getAttribute('data-href') || node.getAttribute('data-src') || '';
          if (href) return href;
        }
      }
      if (event.target && event.target.closest) {
        var anchor = event.target.closest('a[href]');
        if (anchor) return anchor.href || anchor.getAttribute('href') || '';
      }
    } catch (_error) { /* event path can be revoked */ }
    return '';
  }

  function installNativeVideoClickCapture() {
    if (window.__dolaVideoLinkNativeDownloadInstalled) return;
    window.__dolaVideoLinkNativeDownloadInstalled = true;
    document.addEventListener('click', function (event) {
      try {
        var href = hrefFromEvent(event);
        if (isDolaVideoUrl(href)) notifyVideoLinkClicked(href);
      } catch (_error) { /* page click handlers must not throw */ }
    }, true);
    var originalOpen = window.open;
    window.open = function (url) {
      if (isDolaVideoUrl(url)) notifyVideoLinkClicked(url);
      return originalOpen.apply(this, arguments);
    };
  }

  function collectUrlText(text, details) {
    var value = asString(text);
    if (!value || value.length > MAX_TEXT || parseBudget > 10000) return;
    var pattern = /https?:\\?\/\\?\/[^"'<>\\\s\\]+/gi;
    var matches = value.match(pattern) || [];
    matches.forEach(function (match) {
      publish(match, Object.assign({}, details, { field: details.field || 'response-url' }));
    });
    var fplays = value.match(/https?:\\?\/\\?\/[^"'<>\\\s]+\/video\/fplay\/[^"'<>\\\s]*/gi) || [];
    fplays.forEach(function (match) { publish(match, Object.assign({}, details, { field: 'fplay_url' })); });
  }

  function walk(value, inherited, field, depth, seen) {
    if (depth > 12 || parseBudget++ > 10000 || value == null) return;
    if (typeof value === 'string') {
      if (candidateKeyPattern.test(field || '') || /\/video\/fplay\//i.test(value)) {
        var direct = decodeDirectUrl(value);
        if (direct) publish(direct, Object.assign({}, inherited, { field: field }));
        else if (candidateKeyPattern.test(field || '')) postToken(value, Object.assign({}, inherited, { field: field }));
      }
      collectUrlText(value, Object.assign({}, inherited, { field: field }));
      return;
    }
    if (typeof value !== 'object') return;
    var visited = seen || new Set();
    if (visited.has(value)) return;
    visited.add(value);
    var next = metadata(value, inherited);
    var directIdentity = readFirst(value, ['message_id', 'messageId', 'item_message_id', 'itemMessageId', 'vid', 'video_id', 'videoId', 'item_vid', 'share_id', 'shareId', 'record_key', 'recordKey', 'card_id', 'cardId', 'key_seed', 'keySeed', 'fplay_url', 'fplayUrl']);
    if (directIdentity) rememberPending(next);
    var keys = Array.isArray(value) ? Object.keys(value) : Object.keys(value);
    keys.slice(0, 300).forEach(function (key) {
      var child = value[key];
      if (/^(?:raw_data|audio_data|bytes|base64|binary)$/i.test(key)) return;
      if (/^fallback_api$/i.test(key) && typeof child === 'string') addFallbackRecord(child, value);
      walk(child, next, key, depth + 1, visited);
    });
  }

  function parseText(text, source, details) {
    var value = asString(text);
    if (!value || value.length > MAX_TEXT) return;
    parseBudget = 0;
    var base = Object.assign({ source: source, title: document.title || 'Dola 视频' }, details || {});
    rememberFallbackApis(value);
    try {
      walk(JSON.parse(value), metadata({}, base), '', 0);
    } catch (_error) {
      var lines = value.split(/\r?\n/);
      lines.forEach(function (line) {
        var data = line.replace(/^data:\s*/i, '').trim();
        if (!data || data === '[DONE]') return;
        try { walk(JSON.parse(data), metadata({}, base), '', 0); } catch (_jsonError) { /* URL scan below */ }
      });
      collectUrlText(value, base);
    }
  }

  function isNoWatermarkUrl(url) {
    return /(?:unwatermarked|no[_-]?watermark|video_gen_no_watermark|logo_type=no_watermark)/i.test(asString(url));
  }

  function findField(value, names, depth) {
    if (depth > 10 || value == null) return '';
    if (typeof value === 'string' || typeof value === 'number') return '';
    if (Array.isArray(value)) {
      for (var arrayIndex = 0; arrayIndex < value.length; arrayIndex += 1) {
        var arrayFound = findField(value[arrayIndex], names, depth + 1);
        if (arrayFound) return arrayFound;
      }
      return '';
    }
    var keys = Object.keys(value);
    for (var keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      var key = keys[keyIndex];
      if (names.some(function (name) { return name.toLowerCase() === key.toLowerCase(); })) {
        var direct = asString(value[key]);
        if (direct) return direct;
      }
    }
    for (var childIndex = 0; childIndex < keys.length; childIndex += 1) {
      var childFound = findField(value[keys[childIndex]], names, depth + 1);
      if (childFound) return childFound;
    }
    return '';
  }

  function extractVideoUrl(value, depth, field) {
    if (depth > 12 || value == null) return '';
    if (typeof value === 'string') {
      var direct = decodeDirectUrl(value);
      return isDownloadableVideo(direct) ? direct : '';
    }
    if (typeof value !== 'object') return '';
    var objectValue = value;
    var keys = Array.isArray(objectValue) ? Object.keys(objectValue) : Object.keys(objectValue);
    keys.sort(function (left, right) {
      var leftScore = qualityKeyPattern.test(left) ? 1 : 0;
      var rightScore = qualityKeyPattern.test(right) ? 1 : 0;
      return rightScore - leftScore;
    });
    for (var index = 0; index < keys.length; index += 1) {
      var key = keys[index];
      if (/^(?:raw_data|audio_data|bytes|base64|binary)$/i.test(key)) continue;
      var found = extractVideoUrl(objectValue[key], depth + 1, key);
      if (found) return found;
    }
    return '';
  }

  function apiUrl(path) {
    try { return new URL(path, location.origin).href; } catch (_error) { return ''; }
  }

  async function requestJson(path, body, headers) {
    var url = apiUrl(path);
    if (!url) throw new Error('Dola 接口地址无效');
    var endpoint = endpointName(url);
    var response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: Object.assign({ accept: 'application/json', 'content-type': 'application/json', 'agw-js-conv': 'str' }, headers || {}),
      body: JSON.stringify(body || {})
    });
    var text = await response.text();
    if (!response.ok) throw new Error('Dola 接口请求失败：HTTP ' + String(response.status));
    var details = Object.assign({}, requestContext(JSON.stringify(body || {})), { source: 'dola-manual-' + endpoint, endpoint: endpoint, requestUrl: url, responseUrl: url });
    parseText(text, 'dola-manual-' + endpoint, details);
    try { return JSON.parse(text); } catch (_error) { throw new Error('Dola 接口返回内容不是 JSON'); }
  }

  async function requestPlayInfo(vid) {
    var attempts = [
      { key: vid, type: 'video' },
      { vid: vid },
      { key: vid },
      { vid: vid, type: 'video' }
    ];
    var lastError = null;
    for (var index = 0; index < attempts.length; index += 1) {
      try {
        var result = await requestJson('/samantha/video/get_play_info', attempts[index]);
        var url = extractVideoUrl(result, 0, 'play_info');
        if (url) return url;
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('play-info 没有返回视频地址');
  }

  async function requestLegacyShare(messageId, vid) {
    var saved = await requestJson('/alice/media/bigmusic/share_save', { message_id: messageId });
    var shareId = findField(saved, ['share_id', 'shareId'], 0);
    if (!shareId) throw new Error('share-save 没有返回 share_id');
    var shared = await requestJson('/creativity/share/get_video_share_info', { share_id: shareId, vid: vid, creation_id: '' });
    var videoUrl = extractVideoUrl(shared, 0, 'share_info');
    if (!videoUrl) throw new Error('video-share-info 没有返回视频地址');
    return { shareId: shareId, videoUrl: videoUrl };
  }

  async function requestThreadShareInfo(messageId) {
    var result = await requestJson('/samantha/thread/share/info', { message_id: messageId });
    var shareUrl = cleanUrl(findField(result, ['share_url', 'shareUrl', 'share_link', 'shareLink'], 0));
    var threadUrl = cleanUrl(findField(result, ['thread_url', 'threadUrl', 'thread_link', 'threadLink', 'url'], 0));
    if (!shareUrl && !threadUrl) throw new Error('thread/share/info 没有返回分享地址');
    return { shareUrl: shareUrl, threadUrl: threadUrl };
  }

  async function parseThreadPage(threadUrl) {
    var response = await fetch(threadUrl, { credentials: 'include' });
    var html = await response.text();
    if (!response.ok) throw new Error('Dola 分享页面读取失败：HTTP ' + String(response.status));
    parseText(html, 'dola-thread-html', { source: 'dola-thread-html', threadUrl: threadUrl, responseUrl: threadUrl });
    var matches = html.match(/https?:\/\/[^\s"'<>\\]+\/video\/(?:tos|play|fplay)\/[^\s"'<>\\]+/gi) || [];
    for (var index = 0; index < matches.length; index += 1) {
      var url = decodeDirectUrl(matches[index]);
      if (isDownloadableVideo(url)) return url;
    }
    var extracted = extractVideoUrl(html, 0, 'thread-html');
    if (extracted) return extracted;
    throw new Error('Dola 分享页面没有视频地址');
  }

  function publishResolved(url, details) {
    var upgraded = upgradeKnownVariant(url);
    var finalUrl = upgraded.url;
    return publish(finalUrl, Object.assign({}, details, {
      confirmedNoWatermark: true,
      qualityEvidence: 'platform-api',
      resolutionMethod: details.resolutionMethod || 'dola-manual-endpoint'
    }));
  }

  async function resolveRecord(item) {
    var hint = {
      messageId: asString(item && item.messageId), conversationId: asString(item && item.conversationId),
      shareId: asString(item && item.shareId), shareUrl: asString(item && item.shareUrl), threadUrl: asString(item && item.threadUrl),
      vid: asString(item && item.vid), keySeed: asString(item && item.keySeed), fplayUrl: asString(item && item.fplayUrl),
      dolaRecordKey: asString(item && item.dolaRecordKey), dolaCardId: asString(item && item.dolaCardId), videoUrl: asString(item && item.videoUrl), alternateUrls: uniqueVideoUrls(item && item.alternateUrls)
    };
    var record = findRecord(hint);
    var base = Object.assign({}, record, hint);
    base.alternateUrls = uniqueVideoUrls([].concat(record && record.alternateUrls || [], item && item.alternateUrls || []));
    if (base.videoUrl && isNoWatermarkUrl(base.videoUrl)) return base;
    if (base.vid) {
      try {
        var playUrl = await requestPlayInfo(base.vid);
        var playRecord = publishResolved(playUrl, Object.assign({}, base, { source: 'dola-manual-play-info', field: 'original_media_info' }));
        if (playRecord) return playRecord;
      } catch (_playError) { /* Try the share and thread fallbacks below. */ }
    }
    if (base.messageId && base.vid) {
      try {
        var legacy = await requestLegacyShare(base.messageId, base.vid);
        var shareRecord = publishResolved(legacy.videoUrl, Object.assign({}, base, { shareId: legacy.shareId, source: 'dola-manual-share-info', field: 'share_info' }));
        if (shareRecord) return shareRecord;
      } catch (_shareError) { /* Continue to the thread fallback. */ }
    }
    if (base.messageId) {
      try {
        var thread = await requestThreadShareInfo(base.messageId);
        var threadTarget = thread.threadUrl || thread.shareUrl;
        var threadVideo = threadTarget ? await parseThreadPage(threadTarget) : '';
        var threadRecord = publishResolved(threadVideo, Object.assign({}, base, thread, { source: 'dola-manual-thread', field: 'thread_video' }));
        if (threadRecord) return threadRecord;
      } catch (_threadError) { /* Continue to known URL variants. */ }
    }
    if (base.threadUrl || base.shareUrl) {
      try {
        var directThreadVideo = await parseThreadPage(base.threadUrl || base.shareUrl);
        var directRecord = publishResolved(directThreadVideo, Object.assign({}, base, { source: 'dola-manual-thread-direct', field: 'thread_video' }));
        if (directRecord) return directRecord;
      } catch (_directThreadError) { /* Continue to the local URL variant. */ }
    }
    var upgraded = upgradeKnownVariant(base.videoUrl || base.fplayUrl);
    if (upgraded.changed) {
      var upgradedRecord = publishResolved(upgraded.url, Object.assign({}, base, { source: 'dola-known-url-variant', field: 'no_watermark_variant' }));
      if (upgradedRecord) return upgradedRecord;
    }
    var current = findRecord(base);
    if (current && current.videoUrl) return current;
    throw new Error('当前作品还没有解析出平台原始视频');
  }

  function nodeTitle(node) {
    var root = node && node.closest ? node.closest('[class*="card"],[class*="creation"],[class*="media"],[class*="video"],article,main') : null;
    var text = root && root.innerText ? root.innerText.replace(/\s+/g, ' ').trim() : '';
    return text.slice(0, 100) || document.title || 'Dola 视频';
  }

  function ensureVideoElementId(video) {
    if (!video || !video.getAttribute || !video.setAttribute) return '';
    var attribute = 'data-aiam-dola-video-id';
    var existing = asString(video.getAttribute(attribute));
    if (existing) return existing;
    var id = 'aiam-dola-video-' + String(++videoElementCounter);
    try { video.setAttribute(attribute, id); return id; } catch (_error) { return ''; }
  }

  function videoSourceUrls(video) {
    var values = [];
    var push = function (value) {
      var url = cleanUrl(value);
      if (url && values.indexOf(url) < 0) values.push(url);
    };
    if (!video) return values;
    push(video.currentSrc || video.src);
    if (video.querySelectorAll) Array.from(video.querySelectorAll('source')).forEach(function (source) { push(source.currentSrc || source.src || source.getAttribute('src')); });
    return values;
  }

  function resourceForVideo(video) {
    var videoId = ensureVideoElementId(video);
    var urls = videoSourceUrls(video);
    var hint = { dolaVideoElementId: videoId, videoUrl: urls[0] || '' };
    var record = findRecord(hint) || {};
    var currentUrl = urls[0] || '';
    return Object.assign({}, record, {
      type: 'video',
      videoUrl: asString(record.videoUrl) || currentUrl,
      backupUrl: asString(record.backupUrl) || urls[1] || '',
      alternateUrls: uniqueVideoUrls([].concat(record.alternateUrls || [], urls)).filter(function (url) { return url !== (asString(record.videoUrl) || currentUrl) && url !== (asString(record.backupUrl) || urls[1] || ''); }).slice(0, 8),
      coverUrl: asString(record.coverUrl) || cleanUrl(video && video.poster),
      title: asString(record.title) || nodeTitle(video),
      width: record.width || (video && (video.videoWidth || video.clientWidth)) || undefined,
      height: record.height || (video && (video.videoHeight || video.clientHeight)) || undefined,
      source: asString(record.source) || 'dola-video-overlay',
      qualityEvidence: record.qualityEvidence || (currentUrl ? 'dom-direct' : 'unknown'),
      resolutionMethod: asString(record.resolutionMethod) || 'dola-video-element',
      dolaVideoElementId: videoId
    });
  }

  function hasVideoLocator(item) {
    return Boolean(item && [item.messageId, item.conversationId, item.shareId, item.shareUrl, item.threadUrl, item.vid, item.keySeed, item.fplayUrl, item.dolaRecordKey, item.dolaCardId, item.dolaVideoElementId].some(function (value) { return Boolean(asString(value)); }));
  }

  function overlayButtonState(button, busy, label, error) {
    if (!button) return;
    button.disabled = Boolean(busy);
    button.textContent = busy ? '处理中…' : (error || label);
    button.classList.toggle('aiam-dola-error', Boolean(error));
  }

  function overlaySuccess(button, label) {
    if (!button) return;
    button.disabled = false;
    button.classList.remove('aiam-dola-error');
    button.textContent = label;
    window.setTimeout(function () { if (button.isConnected) { button.disabled = false; button.textContent = button.dataset.label || label; } }, 1500);
  }

  function overlayFailure(button, label, error) {
    if (!button) return;
    button.disabled = false;
    button.classList.add('aiam-dola-error');
    button.textContent = (error && error.message ? error.message : String(error || '操作失败')).slice(0, 24);
    window.setTimeout(function () { if (button.isConnected) { button.classList.remove('aiam-dola-error'); button.textContent = button.dataset.label || label; } }, 2200);
  }

  function downloadResolvedVideo(video, button) {
    var item = resourceForVideo(video);
    if (!item.videoUrl && !hasVideoLocator(item)) {
      overlayFailure(button, '解析并下载', new Error('当前视频还没有可用资源定位信息'));
      return;
    }
    overlayButtonState(button, true, '解析并下载');
    resolveRecord(item).then(function (resolved) {
      if (!resolved || !resolved.videoUrl) throw new Error('当前作品还没有解析出平台原始视频');
      download(resolved);
      overlaySuccess(button, '已加入下载队列');
    }).catch(function (error) {
      overlayFailure(button, '解析并下载', error);
    });
  }

  function openResolvedVideo(video, button) {
    var item = resourceForVideo(video);
    if (!item.videoUrl && !hasVideoLocator(item)) {
      overlayFailure(button, '打开原始', new Error('当前视频还没有可用资源定位信息'));
      return;
    }
    var popup = null;
    try { popup = window.open('about:blank', '_blank', 'noopener,noreferrer'); } catch (_openError) { /* popup permission may be denied */ }
    overlayButtonState(button, true, '打开原始');
    resolveRecord(item).then(function (resolved) {
      if (!resolved || !resolved.videoUrl) throw new Error('当前作品还没有解析出平台原始视频');
      if (popup && !popup.closed) popup.location.href = resolved.videoUrl;
      else window.open(resolved.videoUrl, '_blank', 'noopener,noreferrer');
      overlaySuccess(button, '已打开原始');
    }).catch(function (error) {
      if (popup && !popup.closed) { try { popup.close(); } catch (_closeError) { /* ignored */ } }
      overlayFailure(button, '打开原始', error);
    });
  }

  function downloadCurrentVideo(video, button) {
    var urls = videoSourceUrls(video).filter(function (url) { return isDownloadableVideo(url); });
    if (!urls.length) {
      overlayFailure(button, '当前地址', new Error('当前视频地址不可下载'));
      return;
    }
    var item = resourceForVideo(video);
    item.videoUrl = urls[0];
    item.backupUrl = urls[1] || item.backupUrl;
    item.alternateUrls = uniqueVideoUrls([].concat(item.alternateUrls || [], urls)).filter(function (url) { return url !== item.videoUrl && url !== item.backupUrl; }).slice(0, 8);
    item.confirmedNoWatermark = false;
    item.qualityEvidence = 'dom-direct';
    item.resolutionMethod = 'dola-video-element';
    download(item);
    overlaySuccess(button, '已加入下载队列');
  }

  function copyVideoAddress(video, button) {
    var item = resourceForVideo(video);
    var value = item.videoUrl || videoSourceUrls(video)[0] || '';
    if (!value) {
      overlayFailure(button, '复制地址', new Error('当前视频还没有地址'));
      return;
    }
    var copy = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(value) : Promise.reject(new Error('当前页面不允许访问剪贴板'));
    copy.then(function () { overlaySuccess(button, '已复制地址'); }).catch(function (error) { overlayFailure(button, '复制地址', error); });
  }

  function videoOverlayVisible(video) {
    if (!video || !video.isConnected || !video.getBoundingClientRect) return false;
    var rect = video.getBoundingClientRect();
    var style;
    try { style = window.getComputedStyle(video); } catch (_error) { style = null; }
    if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.03) return false;
    return rect.width >= 160 && rect.height >= 100 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
  }

  function ensureVideoOverlayHost(video) {
    var host = video && video.parentElement;
    if (!host) return null;
    try { if (window.getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch (_error) { /* best effort */ }
    return host;
  }

  function makeOverlayButton(label, className, handler) {
    var node = document.createElement('button');
    node.type = 'button'; node.className = className || ''; node.textContent = label; node.dataset.label = label;
    node.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); handler(); }, true);
    return node;
  }

  function createVideoOverlay(video, host) {
    var panel = document.createElement('div');
    panel.className = 'aiam-dola-video-overlay';
    panel.setAttribute('aria-label', 'Dola 视频操作');
    var title = document.createElement('div'); title.className = 'aiam-dola-video-overlay-title'; title.textContent = 'Dola 原始资源'; panel.appendChild(title);
    var actions = document.createElement('div'); actions.className = 'aiam-dola-video-overlay-actions'; panel.appendChild(actions);
    var downloadButton = makeOverlayButton('解析并下载', 'aiam-dola-overlay-primary', function () { downloadResolvedVideo(video, downloadButton); });
    var openButton = makeOverlayButton('打开原始', 'aiam-dola-overlay-open', function () { openResolvedVideo(video, openButton); });
    var currentButton = makeOverlayButton('当前地址', 'aiam-dola-overlay-current', function () { downloadCurrentVideo(video, currentButton); });
    var copyButton = makeOverlayButton('复制地址', 'aiam-dola-overlay-copy', function () { copyVideoAddress(video, copyButton); });
    actions.appendChild(downloadButton); actions.appendChild(openButton); actions.appendChild(currentButton); actions.appendChild(copyButton);
    host.appendChild(panel);
    return { panel: panel, title: title, downloadButton: downloadButton, openButton: openButton, currentButton: currentButton, copyButton: copyButton };
  }

  function updateVideoOverlay(video, entry, host) {
    if (!entry || !entry.panel) return;
    if (entry.panel.parentElement !== host && host) host.appendChild(entry.panel);
    var visible = videoOverlayVisible(video);
    entry.panel.style.display = visible ? 'flex' : 'none';
    if (!visible) return;
    var item = resourceForVideo(video);
    var urls = videoSourceUrls(video);
    entry.title.textContent = item.confirmedNoWatermark ? 'Dola 原始资源' : 'Dola 视频资源';
    entry.downloadButton.disabled = Boolean(entry.downloadButton.disabled && entry.downloadButton.textContent === '处理中…') || (!item.videoUrl && !hasVideoLocator(item));
    entry.openButton.disabled = Boolean(entry.openButton.disabled && entry.openButton.textContent === '处理中…') || (!item.videoUrl && !hasVideoLocator(item));
    entry.currentButton.disabled = !urls.some(function (url) { return isDownloadableVideo(url); });
    entry.copyButton.disabled = !item.videoUrl && !urls.length;
  }

  function renderVideoOverlays() {
    if (!document.body) return;
    var videos = Array.from(document.querySelectorAll('video'));
    videoOverlayMap.forEach(function (entry, video) {
      if (!video.isConnected || videos.indexOf(video) < 0) {
        if (entry.panel && entry.panel.remove) entry.panel.remove();
        videoOverlayMap.delete(video);
      }
    });
    videos.forEach(function (video) {
      ensureVideoElementId(video);
      var host = ensureVideoOverlayHost(video);
      if (!host) return;
      var entry = videoOverlayMap.get(video);
      if (!entry) { entry = createVideoOverlay(video, host); videoOverlayMap.set(video, entry); }
      updateVideoOverlay(video, entry, host);
    });
  }

  function collectDom() {
    if (!document.documentElement) return;
    document.querySelectorAll('video').forEach(function (node, index) {
      var videoElementId = ensureVideoElementId(node);
      var urls = [node.currentSrc, node.src].concat(Array.from(node.querySelectorAll('source')).map(function (source) { return source.src; }));
      urls.forEach(function (url) {
        publish(url, {
          source: 'dola-video-element',
          field: 'video_element',
          title: nodeTitle(node),
          coverUrl: cleanUrl(node.poster),
          width: node.videoWidth || node.clientWidth || undefined,
          height: node.videoHeight || node.clientHeight || undefined,
          dolaVideoElementId: videoElementId || node.id || 'video-' + String(index + 1),
          qualityEvidence: 'dom-direct',
          resolutionMethod: 'dom-video-element'
        });
      });
    });
    renderVideoOverlays();
    document.querySelectorAll('a[href],[data-video-url],[data-play-url],[data-download-url],[data-origin-url],[data-url]').forEach(function (node) {
      var values = [node.getAttribute('href'), node.getAttribute('data-video-url'), node.getAttribute('data-play-url'), node.getAttribute('data-download-url'), node.getAttribute('data-origin-url'), node.getAttribute('data-url')];
      values.forEach(function (url) {
        publish(url, { source: 'dola-dom-link', field: 'dom_link', title: nodeTitle(node), coverUrl: '' });
      });
    });
    try {
      performance.getEntriesByType('resource').slice(-300).forEach(function (entry) {
        var url = entry && entry.name;
        if (fplayPattern.test(url || '') || videoExtensionPattern.test(url || '')) publish(url, { source: 'dola-performance', field: 'performance_url', title: document.title || 'Dola 视频', resolutionMethod: 'performance-resource' });
      });
    } catch (_error) { /* Some embedded page contexts deny performance entries. */ }
  }

  function collectPageState() {
    var states = [window._ROUTER_DATA, window._SSR_DATA];
    states.forEach(function (state) {
      if (!state || typeof state !== 'object') return;
      try { parseText(JSON.stringify(state), 'dola-page-state', { endpoint: 'page-state' }); } catch (_error) { /* State may contain cycles. */ }
    });
    var nextData = document.getElementById('__NEXT_DATA__');
    if (nextData && nextData.textContent) parseText(nextData.textContent, 'dola-next-data', { endpoint: 'next-data' });
    collectReactState();
  }

  // Dola has shipped versions where the useful video metadata exists only in
  // React props/state attached to the rendered card. Read a bounded, local
  // snapshot of those objects so the bridge can correlate a visible video
  // with its message/record identifiers. Do not walk the entire Fiber tree or
  // invoke component methods; this is observation of data already on the page.
  function collectReactState() {
    if (!document.querySelectorAll) return;
    parseBudget = 0;
    var elements = document.querySelectorAll('video,[class*="card"],[class*="creation"],[class*="media"],main');
    var inspected = 0;
    for (var index = 0; index < elements.length && inspected < 180; index += 1) {
      var element = elements[index];
      var keys = [];
      try { keys = Object.keys(element).filter(function (key) { return /^__react(?:Props|Fiber)\$/i.test(key); }).slice(0, 4); } catch (_error) { continue; }
      for (var keyIndex = 0; keyIndex < keys.length && inspected < 180; keyIndex += 1) {
        var key = keys[keyIndex];
        var value;
        try { value = element[key]; } catch (_readError) { continue; }
        inspected += 1;
        if (/^__reactProps\$/i.test(key)) {
          try { walk(value, metadata({}, { source: 'dola-react-props', title: document.title || 'Dola 视频' }), 'reactProps', 0, new Set()); } catch (_propsError) { /* React props are page-owned and may be revoked. */ }
          continue;
        }
        try {
          var fiber = value;
          var snapshot = { memoizedProps: fiber && fiber.memoizedProps, pendingProps: fiber && fiber.pendingProps, memoizedState: fiber && fiber.memoizedState };
          walk(snapshot, metadata({}, { source: 'dola-react-state', title: document.title || 'Dola 视频' }), 'reactState', 0, new Set());
        } catch (_fiberError) { /* Ignore a page revision with non-readable Fiber fields. */ }
      }
    }
  }

  function hookFetch() {
    if (typeof window.fetch !== 'function' || window.fetch.__aiamDolaWrapped) return;
    var original = window.fetch;
    var wrapped = function () {
      var request = arguments[0];
      var requestUrl = typeof request === 'string' ? request : (request && request.url) || '';
      var requestDetails = requestContext(arguments[1] && arguments[1].body);
      return original.apply(this, arguments).then(function (response) {
        var contentType = '';
        try { contentType = response.headers.get('content-type') || ''; } catch (_error) { /* ignore */ }
        if (/json|text|javascript|event-stream/i.test(contentType) || fplayPattern.test(response.url || requestUrl)) {
          try { response.clone().text().then(function (text) { parseText(text, 'dola-fetch-response', Object.assign({}, requestDetails, { requestUrl: requestUrl, responseUrl: response.url, endpoint: endpointName(response.url || requestUrl) })); }).catch(function () { /* ignore */ }); } catch (_error) { /* ignore */ }
        }
        return response;
      });
    };
    wrapped.__aiamDolaWrapped = true;
    window.fetch = wrapped;
  }

  function hookXhr() {
    if (!window.XMLHttpRequest || XMLHttpRequest.prototype.__aiamDolaWrapped) return;
    var open = XMLHttpRequest.prototype.open;
    var send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__aiamDolaRequestUrl = asString(url);
      return open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      this.__aiamDolaRequestContext = requestContext(arguments[0]);
      this.addEventListener('load', function () {
        var type = asString(this.getResponseHeader && this.getResponseHeader('content-type'));
        if ((this.responseType && this.responseType !== '' && this.responseType !== 'text') || (!/json|text|javascript|event-stream/i.test(type) && !fplayPattern.test(this.responseURL || this.__aiamDolaRequestUrl))) return;
        parseText(this.responseText || '', 'dola-xhr-response', Object.assign({}, this.__aiamDolaRequestContext || {}, { requestUrl: this.__aiamDolaRequestUrl, responseUrl: this.responseURL, endpoint: endpointName(this.responseURL || this.__aiamDolaRequestUrl) }));
      });
      return send.apply(this, arguments);
    };
    XMLHttpRequest.prototype.__aiamDolaWrapped = true;
  }

  function installStyle() {
    if (document.getElementById(scriptStyleId)) return;
    var style = document.createElement('style');
    style.id = scriptStyleId;
    style.textContent = '.aiam-dola-video-overlay{position:absolute;right:10px;bottom:10px;z-index:2147483644;display:none;flex-direction:column;gap:6px;width:188px;padding:9px;border:1px solid rgba(255,255,255,.2);border-radius:14px;background:linear-gradient(145deg,rgba(8,13,24,.9),rgba(15,23,42,.8));box-shadow:0 14px 34px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.12);backdrop-filter:blur(15px) saturate(1.25);-webkit-backdrop-filter:blur(15px) saturate(1.25);font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.aiam-dola-video-overlay-title{color:#f8fafc;font-weight:700;font-size:11px;letter-spacing:.03em}.aiam-dola-video-overlay-actions{display:grid;grid-template-columns:1fr 1fr;gap:5px}.aiam-dola-video-overlay button{min-width:0;padding:5px 4px;border:1px solid rgba(148,163,184,.32);border-radius:7px;background:rgba(30,41,59,.86);color:#e5e7eb;font:600 10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.aiam-dola-video-overlay button:hover:not(:disabled){background:#334155;border-color:rgba(255,255,255,.42)}.aiam-dola-video-overlay button:disabled{opacity:.45;cursor:not-allowed}.aiam-dola-video-overlay .aiam-dola-overlay-primary{background:linear-gradient(135deg,#2563eb,#4f46e5);border-color:#4f46e5;color:#fff}.aiam-dola-video-overlay .aiam-dola-error{background:#7f1d1d;border-color:#ef4444;color:#fee2e2}';
    (document.head || document.documentElement).appendChild(style);
  }

  // The page-side panel that used to call this is gone; the workbench's media card and this
  // page's own inbound resolve message are the only callers now. The `source` tag keeps its
  // historical value because records already written carry it and the smoke fixtures key on it.
  function download(item) {
    window.postMessage({ type: 'electronDownload', data: {
      type: 'video', url: item.videoUrl, backupUrl: item.backupUrl, alternateUrls: item.alternateUrls, thumbUrl: item.coverUrl,
      title: item.title, source: 'dola-resource-panel', confirmedNoWatermark: item.confirmedNoWatermark,
      qualityEvidence: item.qualityEvidence, resolutionMethod: item.resolutionMethod,
      messageId: item.messageId, conversationId: item.conversationId, shareId: item.shareId,
      shareUrl: item.shareUrl, threadUrl: item.threadUrl, vid: item.vid, keySeed: item.keySeed,
      fplayUrl: item.fplayUrl, dolaRecordKey: item.dolaRecordKey, dolaCardId: item.dolaCardId,
      dolaVideoElementId: item.dolaVideoElementId
    } }, '*');
  }

  function bounded(value, limit) {
    var text = asString(value);
    return text.length <= limit ? text : text.slice(0, limit);
  }

  function resolutionHint(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var value = raw;
    var directUrl = bounded(value.url || value.videoUrl || value.thirdVideoUrl, 8192);
    var hint = {
      url: directUrl,
      // Older Dola panel events sometimes provide only thirdVideoUrl and no
      // message/record id. Keep the URL in the normalized identity too, so
      // that URL-only downloads are not discarded before resolveRecord().
      videoUrl: directUrl,
      messageId: bounded(value.messageId, 2000),
      conversationId: bounded(value.conversationId, 2000),
      shareId: bounded(value.shareId, 2000),
      shareUrl: bounded(value.shareUrl, 8192),
      threadUrl: bounded(value.threadUrl, 8192),
      vid: bounded(value.vid, 2000),
      keySeed: bounded(value.keySeed, 20000),
      fplayUrl: bounded(value.fplayUrl, 8192),
      dolaRecordKey: bounded(value.dolaRecordKey, 2000),
      dolaCardId: bounded(value.dolaCardId, 2000),
      dolaVideoElementId: bounded(value.dolaVideoElementId, 2000),
      alternateUrls: uniqueVideoUrls(value.alternateUrls),
      title: bounded(value.title, 500)
    };
    return candidateIdentity(hint) ? hint : null;
  }

  // Main Process uses this page-side message for locator-only resources. The
  // actual requests still use the page's normal authenticated fetch path;
  // this does not invent credentials or bypass a site permission check.
  window.addEventListener('message', function (event) {
    if (event.source !== window || !event.data || typeof event.data !== 'object') return;
    var payload = event.data;
    if (payload.type === 'AIAM_ALT_ORIGINAL_MEDIA_FOUND') {
      rememberLegacyOriginalMedia(payload.items);
      return;
    }
    if (payload.type === 'AIAM_DOLA_RESOURCE_DOWNLOAD') {
      var downloadHint = resolutionHint(payload.resource);
      if (!downloadHint) return;
      var downloadTarget = Object.assign({}, findRecord(downloadHint), downloadHint);
      if (downloadHint.url) downloadTarget.videoUrl = downloadHint.url;
      resolveRecord(downloadTarget).then(function (resolved) {
        if (!resolved || !resolved.videoUrl) throw new Error('当前作品还没有解析出可下载视频');
        download(resolved);
      }).catch(function (error) {
        var current = findRecord(downloadHint);
        if (current) current.resolveError = error && error.message ? error.message : '下载解析失败';
      });
      return;
    }
    if (payload.type !== 'AIAM_DOLA_RESOLVE_RESOURCE') return;
    var hint = resolutionHint(payload.resource);
    if (!hint) return;
    var record = findRecord(hint);
    var target = Object.assign({}, record, hint);
    resolveRecord(target).then(function (resolved) {
      if (payload.downloadAfterResolve && resolved && resolved.videoUrl) download(resolved);
    }).catch(function (error) {
      var current = findRecord(hint);
      if (current) current.resolveError = error && error.message ? error.message : '解析失败';
    });
  });

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = window.setTimeout(function () { scanTimer = 0; collectPageState(); collectDom(); scanGeneratedVideoNotices(); installStyle(); }, 250);
  }

  var mutationObserverStarted = false;
  function startMutationObserver() {
    if (mutationObserverStarted) return;
    var root = document.documentElement || document.body;
    if (!root) {
      window.setTimeout(startMutationObserver, 0);
      return;
    }
    mutationObserverStarted = true;
    try { new MutationObserver(scheduleScan).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href', 'poster', 'style', 'class', 'data-url', 'data-video-url', 'data-play-url'] }); } catch (_error) { /* page may not expose MutationObserver */ }
  }

  hookFetch();
  hookXhr();
  installNativeVideoClickCapture();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { scheduleScan(); startMutationObserver(); }, { once: true });
    window.setTimeout(startMutationObserver, 0);
  } else {
    scheduleScan();
    startMutationObserver();
  }
  window.setInterval(function () { collectDom(); scanGeneratedVideoNotices(); installStyle(); }, 3000);
})();
