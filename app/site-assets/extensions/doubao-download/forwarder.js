// forwarder.js - 姘镐箙鏈夋晥鐗堬紙鏃犵増鏈鏌ワ級
const imageDataMap = new Map();
const videoButtonMap = new Map();
const altOriginalVideoMap = new Map();
let latestAltOriginalVideo = null;
const publishedVideoMessageIds = new Set();
let domObserverActive = false;
const ENABLE_DOUBAO_CHAT_VIDEO_DOWNLOAD = false;

// 鎻愬彇鍥剧墖 key
function extractFileKey(url) {
  if (!url) return null;
  const match = url.match(/rc_gen_image\/([^?~]+)/);
  return match ? match[1] : null;
}

function registerImageData(data) {
  const key = extractFileKey(data.watermark_url || data.no_watermark_url);
  if (key) imageDataMap.set(key, data);
}

function injectStyles() {
  if (document.getElementById("doubao-dl-styles")) return;
  const style = document.createElement("style");
  style.id = "doubao-dl-styles";
  style.textContent = `
    .doubao-dl-btn {
      position: absolute;
      bottom: 10px;
      right: 10px;
      z-index: 9999;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 9px;
      background: rgba(0, 0, 0, 0.62);
      color: #fff;
      border: none;
      border-radius: 7px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      transition: background 0.2s, transform 0.15s;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
      line-height: 1;
      white-space: nowrap;
      pointer-events: all;
      user-select: none;
      letter-spacing: 0.2px;
    }
    .doubao-dl-btn:hover:not(:disabled) {
      background: rgba(0, 0, 0, 0.82);
    }
    .doubao-dl-btn:active:not(:disabled) {
      transform: scale(0.97);
    }
    .doubao-dl-btn:disabled {
      cursor: not-allowed;
      opacity: 0.75;
    }
    .doubao-dl-btn.doubao-dl-success {
      background: rgba(16, 185, 129, 0.85);
    }
    .doubao-dl-btn.doubao-dl-error {
      background: rgba(239, 68, 68, 0.82);
    }
    .doubao-dl-btn svg {
      flex-shrink: 0;
    }
  `;
  document.head.appendChild(style);
}

const DOWNLOAD_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

function injectDownloadButton(imgElement, imageData) {
  // `maowang-doubao` and this legacy forwarder intentionally remain
  // installed together: they provide different parser and fallback paths.
  // They must nevertheless share one visible image action per card.
  if (imgElement.dataset.doubaoInjected || imgElement.dataset.aiamDoubaoImageAction) return;
  imgElement.dataset.doubaoInjected = "1";

  let container = imgElement.parentElement;
  // 鍚戜笂鏌ユ壘鍚堥€傜殑鐩稿瀹氫綅瀹瑰櫒
  for (let i = 0; i < 6 && container && container !== document.body; i++) {
    const rect = container.getBoundingClientRect();
    if (rect.width >= 100 && rect.height >= 80) break;
    container = container.parentElement;
  }
  if (!container) container = imgElement.parentElement;
  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }

  if (container.querySelector(":scope > [data-aiam-doubao-image-action]")) return;

  const btn = document.createElement("button");
  btn.dataset.aiamDoubaoImageAction = "legacy-download";
  btn.className = "doubao-dl-btn";
  btn.innerHTML = `${DOWNLOAD_ICON} 下载原图`;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.disabled = true;
    btn.innerHTML = "下载中...";
    const key = (extractFileKey(imageData.no_watermark_url) || String(Date.now())).replace(/\.(jpeg|jpg|png|webp)$/i, "");
    const filename = `doubao${imageData.width && imageData.height ? `_${imageData.width}x${imageData.height}` : ""}_${key.slice(-12)}.png`;
    chrome.runtime.sendMessage({ type: "downloadImage", url: imageData.no_watermark_url, filename }, (response) => {
      if (response?.success) {
        btn.innerHTML = "已下载";
        btn.classList.add("doubao-dl-success");
        setTimeout(() => {
          btn.disabled = false;
          btn.innerHTML = `${DOWNLOAD_ICON} 下载原图`;
          btn.classList.remove("doubao-dl-success");
        }, 3000);
      } else {
        const shortError = String(response?.error || "下载失败").slice(0, 18);
        btn.innerHTML = shortError;
        btn.title = response?.error || "下载失败，点击重试";
        btn.classList.add("doubao-dl-error");
        btn.disabled = false;
        setTimeout(() => {
          btn.innerHTML = `${DOWNLOAD_ICON} 下载原图`;
          btn.classList.remove("doubao-dl-error");
        }, 3000);
      }
    });
  });
  container.appendChild(btn);
}

function tryInjectForImg(img) {
  if (!img.src || img.dataset.doubaoInjected) return;
  const key = extractFileKey(img.src);
  if (!key) return;
  const data = imageDataMap.get(key);
  if (data) injectDownloadButton(img, data);
}

// 澧炲己锛氭煡鎵?messageId锛堟敮鎸?data-*銆乮d銆乧lass锛?
function findMessageId(element) {
  let el = element;
  for (let i = 0; i < 20 && el && el !== document.body; i++) {
    if (el.dataset) {
      if (el.dataset.messageId) return el.dataset.messageId;
      if (el.dataset.message_id) return el.dataset.message_id;
    }
    if (el.id && /msg[_\-]?(\d+)/i.test(el.id)) {
      const match = el.id.match(/(\d+)/);
      if (match) return match[1];
    }
    if (el.className && typeof el.className === 'string') {
      const classMatch = el.className.match(/message[_-]?(\d+)/i);
      if (classMatch) return classMatch[1];
    }
    el = el.parentElement;
  }
  console.warn("[forwarder] 未找到 messageId，跳过视频按钮注入", element);
  return null;
}

function extractVideoThumb(container) {
  const video = container.querySelector('video[poster]');
  if (video?.poster) return video.poster;

  const imgs = Array.from(container.querySelectorAll('img')).filter(img => {
    const src = img.currentSrc || img.src || '';
    if (!src || /^data:/i.test(src)) return false;
    const rect = img.getBoundingClientRect();
    return rect.width >= 40 && rect.height >= 40;
  }).sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return (br.width * br.height) - (ar.width * ar.height);
  });
  if (imgs[0]) {
    const img = imgs[0];
    const fromSrcset = (img.srcset || '').split(',').map(item => item.trim().split(/\s+/)[0]).filter(Boolean).pop();
    return img.currentSrc || img.src || fromSrcset || '';
  }

  const bgNodes = [container, ...Array.from(container.querySelectorAll('*'))];
  for (const node of bgNodes) {
    const bg = getComputedStyle(node).backgroundImage || '';
    const match = bg.match(/url\(["']?([^"')]+)["']?\)/);
    if (match && match[1] && !/^data:/i.test(match[1])) return match[1];
  }
  return '';
}

function extractVideoTitle(container) {
  let el = container;
  for (let i = 0; i < 8 && el && el !== document.body; i++) {
    const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (text && text.length > 2) {
      return text.slice(0, 80);
    }
    el = el.parentElement;
  }
  return '';
}

function publishDomVideo(container, messageId) {
  if (!messageId) return;
  const title = extractVideoTitle(container);
  const thumbUrl = extractVideoThumb(container);
  const key = `${messageId}:${title}:${thumbUrl}`;
  if (publishedVideoMessageIds.has(key)) return;
  publishedVideoMessageIds.add(key);
  if (publishedVideoMessageIds.size > 300) {
    publishedVideoMessageIds.delete(publishedVideoMessageIds.values().next().value);
  }
  const payload = {
    messageId,
    title,
    thumbUrl,
    source: 'dom'
  };
  window.postMessage({ type: "videoDataExtracted", data: [payload] }, "*");
}

function rememberAltOriginalVideos(items) {
  let changed = false;
  for (const item of items || []) {
    if (!item || item.type !== "video" || !/^https?:\/\//i.test(String(item.url || ""))) continue;
    const normalized = {
      videoUrl: item.url,
      backupUrl: item.backupUrl || "",
      messageId: String(item.messageId || ""),
      title: item.title || "豆包原视频",
      source: item.source || "doubao-original-plugin",
      confirmedNoWatermark: true
    };
    latestAltOriginalVideo = normalized;
    if (normalized.messageId) altOriginalVideoMap.set(normalized.messageId, normalized);
    changed = true;
  }
  return changed;
}

function altOriginalVideoForMessage(messageId) {
  const key = String(messageId || "");
  if (key && altOriginalVideoMap.has(key)) return altOriginalVideoMap.get(key);
  if (altOriginalVideoMap.size === 1) return Array.from(altOriginalVideoMap.values())[0];
  return latestAltOriginalVideo;
}

function postAltOriginalDownloadResult(messageId, item) {
  const filename = `doubao_original_${Date.now()}.mp4`;
  window.postMessage({
    type: "videoDownloadResult",
    data: {
      success: true,
      videoUrl: item.videoUrl,
      backupUrl: item.backupUrl || "",
      messageId,
      title: item.title || "豆包原视频",
      source: item.source || "doubao-original-plugin",
      confirmedNoWatermark: true,
      filename,
      downloadAfterResolve: true
    }
  }, "*");
}

function injectVideoDownloadButton(container, messageId) {
  if (!ENABLE_DOUBAO_CHAT_VIDEO_DOWNLOAD) return;
  if (container.dataset.doubaoVideoInjected) return;
  container.dataset.doubaoVideoInjected = "1";
  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }
  const btn = document.createElement("button");
  btn.className = "doubao-dl-btn";
  btn.innerHTML = `${DOWNLOAD_ICON} 原视频下载`;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.disabled = true;
    btn.innerHTML = "解析原视频中...";
    videoButtonMap.set(messageId, btn);
    const cachedOriginal = altOriginalVideoForMessage(messageId);
    if (cachedOriginal?.videoUrl) {
      postAltOriginalDownloadResult(messageId, cachedOriginal);
      return;
    }
    window.postMessage({
      type: "startVideoDownloadByMessageId",
      messageId: messageId,
      filename: `doubao_original_${Date.now()}.mp4`,
      downloadAfterResolve: true
    }, "*");
  });
  container.appendChild(btn);
}
function tryInjectForVideo(videoContainer) {
  if (!ENABLE_DOUBAO_CHAT_VIDEO_DOWNLOAD) return;
  if (!videoContainer.className || typeof videoContainer.className !== "string") return;
  const className = videoContainer.className;
  const looksLikeVideoCard =
    className.includes("block-video") ||
    className.includes("video-player") ||
    className.includes("play-icon") ||
    className.includes("cover-") ||
    !!videoContainer.querySelector('video,[class*="block-video"],[class*="video-player"],[class*="play-icon"],[class*="cover-"]');
  if (!looksLikeVideoCard) return;
  // 妫€鏌ユ槸鍚﹀寘鍚棰戠浉鍏冲厓绱?
  if (!(videoContainer.querySelector('[class*="cover-"]') ||
        videoContainer.querySelector('[class*="video-player"]') ||
        videoContainer.querySelector('[class*="play-icon"]'))) {
    return;
  }
  const messageId = findMessageId(videoContainer);
  if (!messageId) return;
  publishDomVideo(videoContainer, messageId);
  if (videoContainer.dataset.doubaoVideoInjected) return;
  injectVideoDownloadButton(videoContainer, messageId);
}

function scanAndInjectVideos() {
  if (!ENABLE_DOUBAO_CHAT_VIDEO_DOWNLOAD) return;
  document
    .querySelectorAll('[class*="block-video"],[class*="video-player"],[class*="play-icon"],[class*="cover-"],video')
    .forEach((node) => {
      let container = node;
      for (let i = 0; i < 6 && container && container !== document.body; i++) {
        if (container.className && typeof container.className === "string" && /block-video|message|video/i.test(container.className)) break;
        container = container.parentElement;
      }
      tryInjectForVideo(container || node);
    });
}

function scanAndInject() {
  document.querySelectorAll("img").forEach(tryInjectForImg);
  scanAndInjectVideos();
}

function scheduleVideoRescan() {
  setTimeout(scanAndInjectVideos, 150);
  setTimeout(scanAndInjectVideos, 700);
  setTimeout(scanAndInjectVideos, 1600);
}

function watchSpaNavigation() {
  if (window.__doubaoVideoNavWatch) return;
  window.__doubaoVideoNavWatch = true;

  const wrapHistory = (name) => {
    const original = history[name];
    history[name] = function(...args) {
      const ret = original.apply(this, args);
      scheduleVideoRescan();
      return ret;
    };
  };
  wrapHistory('pushState');
  wrapHistory('replaceState');
  window.addEventListener('popstate', scheduleVideoRescan);
  document.addEventListener('click', () => scheduleVideoRescan(), true);
}

function startDOMObserver() {
  if (domObserverActive) return;
  domObserverActive = true;
  injectStyles();
  watchSpaNavigation();
  scanAndInject();

  const observer = new MutationObserver((mutations) => {
    let shouldRescan = false;
    for (const mutation of mutations) {
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            if (node.tagName === "IMG") {
              tryInjectForImg(node);
            } else if (node.querySelectorAll) {
              node.querySelectorAll("img").forEach(tryInjectForImg);
            }
            if (node.classList && typeof node.className === "string" && node.className.includes("block-video")) {
              tryInjectForVideo(node);
            }
            if (node.querySelectorAll) {
              node.querySelectorAll('[class*="block-video"]').forEach(tryInjectForVideo);
            }
          }
        }
        shouldRescan = true;
      }
      if (mutation.type === "attributes" && mutation.target.tagName === "IMG") {
        tryInjectForImg(mutation.target);
      }
    }
    if (shouldRescan) scanAndInject();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"]
  });
}

// 鍒濆鍖栵細姘镐箙鏈夋晥锛岀洿鎺ヤ粠鍚庡彴鑾峰彇宸叉崟鑾风殑鍥剧墖鍒楄〃
function init() {
  try {
    chrome.runtime.sendMessage({ type: "GET_IMAGE_LIST" }, (res) => {
      if (res?.data) res.data.forEach(registerImageData);
      startDOMObserver();
      if (ENABLE_DOUBAO_CHAT_VIDEO_DOWNLOAD) {
        window.postMessage({ type: "scanInitialVideos" }, "*");
        setTimeout(() => {
          window.postMessage({ type: "scanInitialVideos" }, "*");
        }, 1500);
      }
    });
  } catch (e) {
    console.error("[forwarder] 初始化失败", e);
  }
}

// 鐩戝惉鏉ヨ嚜 content script 鐨勬秷鎭?
window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === "imageDataExtracted") {
    const images = data.data || [];
    try {
      if (chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: "imageDataExtracted", data: images });
      }
    } catch (e) {
      if (!e.message?.includes("Extension context invalidated")) console.error(e);
    }
    images.forEach(registerImageData);
    setTimeout(scanAndInject, 300);
    setTimeout(scanAndInject, 1000);
    setTimeout(scanAndInject, 2500);
  }

  if (data.type === "AIAM_ALT_ORIGINAL_MEDIA_FOUND") {
    if (!ENABLE_DOUBAO_CHAT_VIDEO_DOWNLOAD) return;
    if (rememberAltOriginalVideos(data.items || [])) {
      const videos = (data.items || []).filter(item => item && item.type === "video" && item.url).map(item => ({
        vid: item.videoKey || item.messageId || item.url,
        messageId: item.messageId || "",
        videoUrl: item.url,
        backupUrl: item.backupUrl || "",
        title: item.title || "豆包原视频",
        source: item.source || "doubao-original-plugin",
        confirmedNoWatermark: true,
        status: "ready"
      }));
      if (videos.length) window.postMessage({ type: "videoDataExtracted", data: videos }, "*");
      setTimeout(scanAndInjectVideos, 100);
      setTimeout(scanAndInjectVideos, 500);
      setTimeout(scanAndInjectVideos, 1200);
    }
    return;
  }

  if (data.type === "videoDownloadResult") {
    const result = data.data;
    const messageId = result?.messageId;
    const btn = messageId ? videoButtonMap.get(messageId) : null;
    if (btn) {
      if (result?.success) {
        btn.innerHTML = "下载已开始";
        btn.classList.add("doubao-dl-success");
        setTimeout(() => {
          btn.disabled = false;
          btn.innerHTML = `${DOWNLOAD_ICON} 原视频下载`;
          btn.classList.remove("doubao-dl-success");
        }, 3000);
      } else {
        btn.innerHTML = "失败，点击重试";
        btn.classList.add("doubao-dl-error");
        btn.disabled = false;
        setTimeout(() => {
          btn.innerHTML = `${DOWNLOAD_ICON} 原视频下载`;
          btn.title = "";
          btn.classList.remove("doubao-dl-error");
        }, 3000);
      }
      videoButtonMap.delete(messageId);
    }
    if (!result?.suppressAutoDownload) {
      try {
        if (chrome?.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: "videoDownloadResult", data: result });
        }
      } catch (e) {
        if (!e.message?.includes("Extension context invalidated")) console.error(e);
      }
    }
  }

  if (data.type === "videoDataExtracted") {
    const videos = data.data || [];
    try {
      if (chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: "videoDataExtracted", data: videos });
      }
    } catch (e) {
      if (!e.message?.includes("Extension context invalidated")) console.error(e);
    }
    setTimeout(scanAndInjectVideos, 300);
    setTimeout(scanAndInjectVideos, 1000);
    setTimeout(scanAndInjectVideos, 2500);
  }

  if (data.type === "bigmusicShareSave") {
    try {
      chrome.runtime.sendMessage({ type: "bigmusicShareSave", messageId: data.messageId }, (response) => {
        window.postMessage({ type: "bigmusicShareSaveResult", data: response }, "*");
      });
    } catch (e) {
      window.postMessage({ type: "bigmusicShareSaveResult", data: null }, "*");
    }
  }
});

// 鐩戝惉鏉ヨ嚜 background 鐨勬秷鎭紙濡傛柊鍥剧墖鏁版嵁涓诲姩鎺ㄩ€侊級
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "newImageData") {
    (message.data || []).forEach(registerImageData);
    setTimeout(scanAndInject, 300);
    sendResponse({ success: true });
    return true;
  }
  if (message.type === "startVideoDownload") {
    window.postMessage({ type: "startVideoDownload" }, "*");
    sendResponse({ success: true });
    return true;
  }
});

init();


