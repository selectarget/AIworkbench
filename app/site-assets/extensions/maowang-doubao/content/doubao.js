(function maowangDoubaoContent() {
  "use strict";

  if (window.__MAOWANG_DOUBAO_CONTENT__) return;
  window.__MAOWANG_DOUBAO_CONTENT__ = true;

  const SOURCE = "maowang-doubao-content";
  const BRIDGE_SOURCE = "maowang-doubao-bridge";
  const images = new Map();
  const imageKeys = new Map();
  const videos = new Map();
  const altOriginalVideos = new Map();
  const pendingVideoRequests = new Map();
  const processedImages = new WeakSet();
  const processedVideos = new WeakSet();
  const health = {
    contentReady: true,
    bridgeReady: false,
    scanCount: 0,
    completionRequests: 0,
    mediaPayloads: 0,
    durationOptionReady: false,
    lastIssue: "",
    lastEventAt: Date.now()
  };
  let consoleElement = null;
  let activeTab = "media";
  let directoryTimer = 0;
  let scanTimer = 0;
  let statusTimer = 0;
  let mediaListSignature = null;

  function sendRuntime(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { success: false, error: "扩展没有响应" });
        });
      } catch (error) {
        resolve({ success: false, error: error.message });
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "AIAM_DOWNLOAD_REQUEST") return false;
    window.postMessage({ type: "electronDownload", data: message.data || {} }, "*");
    sendResponse({ success: true });
    return false;
  });

  function postBridge(type, detail = {}) {
    window.postMessage({ source: SOURCE, type, ...detail }, location.origin);
  }

  function mediaKey(url) {
    if (!url) return "";
    const match = String(url).match(/rc_gen_image\/([^?~]+)/);
    if (match) return match[1];
    try {
      return new URL(url).pathname.split("/").filter(Boolean).pop() || "";
    } catch (_) {
      return "";
    }
  }

  function registerImage(item) {
    if (!item?.url || images.has(item.url)) return false;
    images.set(item.url, item);
    const keys = [mediaKey(item.url), mediaKey(item.watermarkUrl)].filter(Boolean);
    for (const key of keys) imageKeys.set(key, item);
    return true;
  }

  function registerVideo(item) {
    if (!item?.videoKey) return false;
    const previous = videos.get(item.videoKey);
    videos.set(item.videoKey, { ...previous, ...item });
    return !previous;
  }

  function registerAltOriginalVideos(items) {
    let changed = false;
    for (const item of items || []) {
      if (!item || item.type !== "video" || !/^https?:\/\//i.test(String(item.url || ""))) continue;
      const key = item.messageId || item.videoKey || item.url;
      if (!key || altOriginalVideos.has(key)) continue;
      altOriginalVideos.set(key, {
        url: item.url,
        messageId: item.messageId || "",
        videoKey: item.videoKey || "",
        title: item.title || "Doubao original video"
      });
      changed = true;
    }
    return changed;
  }

  function showToast(message, kind = "info") {
    document.querySelectorAll(".mw-toast").forEach((node) => node.remove());
    const toast = document.createElement("div");
    toast.className = "mw-toast";
    toast.dataset.kind = kind;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  function fileExtension(url, fallback) {
    try {
      const match = new URL(url).pathname.match(/\.(png|jpe?g|webp|gif|mp4)(?:$|\/)/i);
      return match ? match[1].toLowerCase().replace("jpeg", "jpg") : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function imageFileName(item) {
    const size = item.width && item.height ? `_${item.width}x${item.height}` : "";
    const suffix = mediaKey(item.url).replace(/\.[^.]+$/, "").slice(-14) || Date.now();
    return `猫王豆包_图片${size}_${suffix}.${fileExtension(item.url, "png")}`;
  }

  function videoFileName(result) {
    const size = result.width && result.height ? `_${result.width}x${result.height}` : "";
    return `猫王豆包_视频${size}_${Date.now()}.mp4`;
  }

  function setButtonState(button, state, text, resetText) {
    button.disabled = state === "busy";
    button.dataset.state = state;
    button.textContent = text;
    if (state === "success" || state === "error") {
      setTimeout(() => {
        button.disabled = false;
        button.dataset.state = "";
        button.textContent = resetText;
      }, 2200);
    }
  }

  async function downloadImage(item, button) {
    const resetText = button.classList.contains("mw-item-download") ? "单独下载" : "下载原图";
    setButtonState(button, "busy", "正在传输", resetText);
    const result = await sendRuntime({
      type: "MW_DOWNLOAD",
      item: { url: item.url, filename: imageFileName(item) }
    });
    setButtonState(
      button,
      result.success ? "success" : "error",
      result.success ? "已加入下载" : "下载失败",
      resetText
    );
  }

  function requestVideo(video) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingVideoRequests.delete(requestId);
        resolve({ success: false, error: "视频解析超时", videoKey: video.videoKey });
      }, 12000);
      pendingVideoRequests.set(requestId, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      postBridge("MW_RESOLVE_VIDEO", {
        requestId,
        videoKey: video.videoKey,
        messageId: video.messageId
      });
    });
  }

  async function resolveVideo(video) {
    const pageResult = await requestVideo(video);
    if (pageResult.success) return pageResult;
    const videoKey = pageResult.videoKey || video.videoKey;
    if (!videoKey) return pageResult;
    return sendRuntime({ type: "MW_RESOLVE_DOUBAO_VIDEO", videoKey });
  }

  async function downloadVideo(video, button) {
    const resetText = button.classList.contains("mw-item-download") ? "单独下载" : "下载视频";
    setButtonState(button, "busy", "正在解析", resetText);
    const resolved = await resolveVideo(video);
    if (!resolved.success || !resolved.url) {
      setButtonState(button, "error", "解析失败", resetText);
      return;
    }
    setButtonState(button, "busy", "正在传输", resetText);
    const result = await sendRuntime({
      type: "MW_DOWNLOAD",
      item: {
        url: resolved.url,
        backupUrl: resolved.backupUrl,
        alternateUrls: Array.isArray(resolved.alternateUrls) ? resolved.alternateUrls : [],
        filename: videoFileName(resolved)
      }
    });
    setButtonState(
      button,
      result.success ? "success" : "error",
      result.success ? "已加入下载" : "下载失败",
      resetText
    );
  }

  async function downloadAltOriginalVideo(item, video, button) {
    const resetText = button.classList.contains("mw-item-download") ? "单独下载" : "原视频下载";
    let downloadItem = item && item.url ? { url: item.url } : null;
    if (!downloadItem && video) {
      setButtonState(button, "busy", "正在解析", resetText);
      const resolved = await resolveVideo(video);
      if (resolved && resolved.success && resolved.url) {
        downloadItem = {
          url: resolved.url,
          backupUrl: resolved.backupUrl || "",
          alternateUrls: Array.isArray(resolved.alternateUrls) ? resolved.alternateUrls : []
        };
      }
    }
    if (!downloadItem) {
      setButtonState(button, "error", "解析失败", resetText);
      return;
    }
    setButtonState(button, "busy", "正在传输", resetText);
    const result = await sendRuntime({
      type: "MW_DOWNLOAD",
      item: {
        url: downloadItem.url,
        backupUrl: downloadItem.backupUrl || "",
        alternateUrls: downloadItem.alternateUrls || [],
        filename: `doubao_original_${Date.now()}.mp4`
      }
    });
    setButtonState(
      button,
      result.success ? "success" : "error",
      result.success ? "已加入下载" : "下载失败",
      resetText
    );
  }

  function findStableContainer(element) {
    let current = element.parentElement;
    for (let level = 0; current && current !== document.body && level < 7; level += 1) {
      const rect = current.getBoundingClientRect();
      if (rect.width >= 120 && rect.height >= 90) break;
      current = current.parentElement;
    }
    return current || element.parentElement;
  }

  function injectImageButton(image) {
    if (processedImages.has(image) || !image.src) return;
    const item = imageKeys.get(mediaKey(image.currentSrc || image.src));
    if (!item) return;

    const container = findStableContainer(image);
    if (!container) return;
    // The legacy doubao-download forwarder is kept as a parser/download
    // fallback. Coordinate through a shared marker so whichever extension
    // injects first owns the single visible image action for this card.
    if (image.dataset.aiamDoubaoImageAction || container.querySelector(":scope > [data-aiam-doubao-image-action]")) {
      processedImages.add(image);
      return;
    }
    if (container.querySelector(":scope > .mw-media-action[data-kind='image']")) return;
    if (getComputedStyle(container).position === "static") container.style.position = "relative";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "mw-media-action";
    button.dataset.kind = "image";
    button.dataset.aiamDoubaoImageAction = "maowang";
    button.textContent = "下载原图";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      downloadImage(item, button);
    });
    container.appendChild(button);
    processedImages.add(image);
  }

  function messageIdFromElement(element) {
    let current = element;
    for (let level = 0; current && current !== document.body && level < 18; level += 1) {
      const id = current.dataset?.messageId || current.dataset?.message_id;
      if (id) return String(id);
      current = current.parentElement;
    }
    return "";
  }

  function videoForElement(element) {
    const messageId = messageIdFromElement(element);
    if (messageId) {
      const exact = Array.from(videos.values()).find((video) => video.messageId === messageId);
      if (exact) return exact;
    }
    if (videos.size === 1) return Array.from(videos.values())[0];
    return messageId ? { messageId, videoKey: "" } : null;
  }

  function altOriginalVideoForElement(element, video) {
    const messageId = messageIdFromElement(element) || video?.messageId || "";
    if (messageId && altOriginalVideos.has(messageId)) return altOriginalVideos.get(messageId);
    if (video?.videoKey && altOriginalVideos.has(video.videoKey)) return altOriginalVideos.get(video.videoKey);
    if (altOriginalVideos.size === 1) return Array.from(altOriginalVideos.values())[0];
    return null;
  }

  function injectAltOriginalVideoButton(container, video) {
    if (!container || !video || container.querySelector(":scope > .mw-media-action[data-kind='alt-video']")) return;
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    const altItem = altOriginalVideoForElement(container, video);
    const altButton = document.createElement("button");
    altButton.type = "button";
    altButton.className = "mw-media-action";
    altButton.dataset.kind = "alt-video";
    altButton.textContent = "原视频下载";
    altButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      downloadAltOriginalVideo(altItem, video, altButton);
    });
    container.appendChild(altButton);
  }

  function injectAltOriginalVideoButtons() {
    document
      .querySelectorAll('[class*="block-video"], [class*="video-player"], video')
      .forEach((element) => {
        const container = element.closest('[class*="block-video"]') || element.parentElement;
        const video = videoForElement(container);
        injectAltOriginalVideoButton(container, video);
      });
  }

  function injectVideoButton(container) {
    if (!container) return;
    const video = videoForElement(container);
    if (!video) return;
    if (getComputedStyle(container).position === "static") container.style.position = "relative";

    if (!container.querySelector(":scope > .mw-media-action[data-kind='video']")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mw-media-action";
      button.dataset.kind = "video";
      button.textContent = "下载视频";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        downloadVideo(video, button);
      });
      container.appendChild(button);
    }
    processedVideos.add(container);
  }

  function scanMediaButtons() {
    health.scanCount += 1;
    health.lastEventAt = Date.now();
    for (const image of document.images) injectImageButton(image);
    document
      .querySelectorAll('[class*="block-video"], [class*="video-player"], video')
      .forEach((element) => injectVideoButton(element.closest('[class*="block-video"]') || element.parentElement));
    // The visible Doubao video button is injected by the legacy forwarder.
  }

  function formatCount(value) {
    return String(Math.max(0, value)).padStart(2, "0");
  }

  function updateConsole() {
    if (!consoleElement) return;
    consoleElement.querySelector("[data-count=image]").textContent = formatCount(images.size);
    consoleElement.querySelector("[data-count=video]").textContent = formatCount(videos.size);
    renderMediaList();
  }

  function mediaDetail(item, fallback) {
    return item.width && item.height ? `${item.width} × ${item.height}` : fallback;
  }

  function createMediaListItem(type, index, detail, onDownload) {
    const row = document.createElement("div");
    row.className = "mw-media-list__item";

    const copy = document.createElement("span");
    copy.className = "mw-media-list__copy";
    const title = document.createElement("b");
    title.textContent = `${type === "image" ? "图片" : "视频"} ${String(index).padStart(2, "0")}`;
    const meta = document.createElement("small");
    meta.textContent = detail;
    copy.append(title, meta);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "mw-item-download";
    button.textContent = "单独下载";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onDownload(button);
    });

    row.append(copy, button);
    return row;
  }

  function renderMediaList() {
    const list = consoleElement?.querySelector("[data-media-list]");
    if (!list) return;

    const signature = [
      ...Array.from(images.keys(), (key) => `i:${key}`),
      ...Array.from(videos.keys(), (key) => `v:${key}`)
    ].join("|");
    if (signature === mediaListSignature) return;
    mediaListSignature = signature;
    list.replaceChildren();

    if (!images.size && !videos.size) {
      const empty = document.createElement("div");
      empty.className = "mw-media-list__empty";
      empty.textContent = "暂未发现媒体，生成内容后点击重新扫描";
      list.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    let imageIndex = 0;
    for (const item of images.values()) {
      imageIndex += 1;
      fragment.appendChild(createMediaListItem(
        "image",
        imageIndex,
        mediaDetail(item, "原始画质"),
        (button) => downloadImage(item, button)
      ));
    }

    let videoIndex = 0;
    for (const video of videos.values()) {
      videoIndex += 1;
      fragment.appendChild(createMediaListItem(
        "video",
        videoIndex,
        mediaDetail(video, "无水印视频"),
        (button) => downloadVideo(video, button)
      ));
    }
    list.appendChild(fragment);
  }

  function reportStatus() {
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      sendRuntime({
        type: "MW_STATUS_UPDATE",
        platform: "doubao",
        imageCount: images.size,
        videoCount: videos.size,
        health
      });
      updateConsole();
    }, 120);
  }

  async function batchDownload(button) {
    if (!images.size && !videos.size) {
      showToast("当前页面还没有识别到可下载内容", "error");
      return;
    }

    button.disabled = true;
    button.textContent = "正在整理媒体";
    const items = Array.from(images.values()).map((item) => ({
      url: item.url,
      filename: imageFileName(item)
    }));

    let videoIndex = 0;
    for (const video of videos.values()) {
      button.textContent = `解析视频 ${videoIndex + 1}/${videos.size}`;
      const result = await resolveVideo(video);
      if (result.success && result.url) {
        items.push({
          url: result.url,
          backupUrl: result.backupUrl,
          alternateUrls: Array.isArray(result.alternateUrls) ? result.alternateUrls : [],
          filename: `猫王豆包_视频_${String(videoIndex + 1).padStart(3, "0")}_${Date.now()}.mp4`
        });
      }
      videoIndex += 1;
    }

    button.textContent = `开始下载 ${items.length} 项`;
    const result = await sendRuntime({ type: "MW_DOWNLOAD_MANY", items });
    button.disabled = false;
    button.textContent = "下载全部";
    showToast(
      result.success
        ? `下载任务完成：成功 ${result.successCount}，失败 ${result.failCount}`
        : result.error || "批量下载失败",
      result.success ? "success" : "error"
    );
  }

  function isUserMessage(element) {
    const signature = [
      element.getAttribute("data-role"),
      element.getAttribute("data-sender"),
      element.getAttribute("data-message-role"),
      element.className
    ].join(" ").toLowerCase();
    if (/\b(user|human|question)\b/.test(signature)) return true;
    const style = getComputedStyle(element);
    return style.alignSelf === "flex-end" || style.justifyContent === "flex-end";
  }

  function cleanMessageText(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll("button,svg,img,video,[role=button],.mw-media-action").forEach((node) => node.remove());
    return String(clone.textContent || "").replace(/\s+/g, " ").trim();
  }

  function collectDirectoryEntries() {
    const candidates = new Set();
    const selectors = [
      '[data-role="user"]',
      '[data-sender="user"]',
      '[data-message-role="user"]',
      '[class*="user-message"]',
      '[class*="message-user"]',
      '[class*="question"]',
      "[data-message-id]"
    ];
    document.querySelectorAll(selectors.join(",")).forEach((element) => candidates.add(element));

    const entries = [];
    const seen = new Set();
    for (const element of candidates) {
      if (!isUserMessage(element) || element.closest(".mw-console")) continue;
      const text = cleanMessageText(element);
      if (text.length < 2 || text.length > 1500 || seen.has(text)) continue;
      if (/^(分享|复制|编辑|删除|重试|下载)/.test(text)) continue;
      seen.add(text);
      entries.push({ element, text });
    }
    return entries;
  }

  function scrollToEntry(element) {
    const scrollable = (() => {
      let current = element.parentElement;
      while (current && current !== document.body) {
        const style = getComputedStyle(current);
        if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight) return current;
        current = current.parentElement;
      }
      return null;
    })();

    if (scrollable) {
      const top = element.getBoundingClientRect().top
        - scrollable.getBoundingClientRect().top
        + scrollable.scrollTop
        - scrollable.clientHeight / 2;
      scrollable.scrollTo({ top, behavior: "smooth" });
    } else {
      const top = element.getBoundingClientRect().top + window.scrollY - window.innerHeight / 2;
      window.scrollTo({ top, behavior: "smooth" });
    }
    element.classList.add("mw-target-flash");
    setTimeout(() => element.classList.remove("mw-target-flash"), 1800);
  }

  function renderDirectory() {
    if (!consoleElement) return;
    const container = consoleElement.querySelector("[data-directory]");
    const entries = collectDirectoryEntries();
    container.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "mw-empty";
      empty.textContent = "暂未识别到用户提问";
      container.appendChild(empty);
      return;
    }
    entries.forEach((entry, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mw-directory__item";
      button.title = entry.text;

      const number = document.createElement("span");
      number.className = "mw-directory__index";
      number.textContent = String(index + 1).padStart(2, "0");

      const text = document.createElement("span");
      text.className = "mw-directory__text";
      text.textContent = entry.text;

      button.append(number, text);
      button.addEventListener("click", () => scrollToEntry(entry.element));
      container.appendChild(button);
    });
  }

  function switchTab(tab) {
    activeTab = tab === "directory" ? "directory" : "media";
    if (!consoleElement) return;
    consoleElement.querySelectorAll("[data-tab]").forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset.tab === activeTab));
    });
    consoleElement.querySelectorAll("[data-view]").forEach((view) => {
      view.hidden = view.dataset.view !== activeTab;
    });
    if (activeTab === "directory") renderDirectory();
  }

  function installDrag(handle) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      const rect = consoleElement.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      handle.setPointerCapture(event.pointerId);

      const move = (moveEvent) => {
        const left = Math.max(0, Math.min(
          window.innerWidth - consoleElement.offsetWidth,
          rect.left + moveEvent.clientX - startX
        ));
        const top = Math.max(0, Math.min(
          window.innerHeight - consoleElement.offsetHeight,
          rect.top + moveEvent.clientY - startY
        ));
        Object.assign(consoleElement.style, {
          left: `${left}px`,
          top: `${top}px`,
          right: "auto",
          bottom: "auto"
        });
      };
      const stop = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
    });
  }

  function createConsole() {
    if (globalThis.__AIAM_WORKBENCH_MODE__) return;
    if (consoleElement || !document.body) return;
    consoleElement = document.createElement("section");
    consoleElement.id = "mw-console";
    consoleElement.className = "mw-console";
    consoleElement.dataset.minimized = "false";
    consoleElement.innerHTML = `
      <header class="mw-console__header">
        <div class="mw-console__identity">
          <span class="mw-console__eyebrow">豆包下载助手</span>
          <strong class="mw-console__title">猫王豆包无水印</strong>
        </div>
        <div class="mw-console__controls">
          <button class="mw-icon-button" data-minimize type="button" title="最小化">−</button>
          <button class="mw-icon-button" data-close type="button" title="隐藏">×</button>
        </div>
      </header>
      <div class="mw-console__body">
        <nav class="mw-tabs" aria-label="功能切换">
          <button class="mw-tab" data-tab="media" aria-selected="true" type="button">媒体下载</button>
          <button class="mw-tab" data-tab="directory" aria-selected="false" type="button">对话目录</button>
        </nav>
        <div class="mw-view" data-view="media">
          <div class="mw-readout">
            <div class="mw-readout__cell"><span>已发现图片</span><strong data-count="image">00</strong></div>
            <div class="mw-readout__cell"><span>已发现视频</span><strong data-count="video">00</strong></div>
          </div>
          <section class="mw-media-section">
            <div class="mw-media-section__head">
              <strong>单个下载</strong>
              <span>按需选择，避免重复</span>
            </div>
            <div class="mw-media-list" data-media-list></div>
          </section>
          <div class="mw-console__actions">
            <button class="mw-primary" data-batch type="button">下载全部</button>
            <button class="mw-secondary" data-scan type="button">重新扫描</button>
          </div>
          <div class="mw-console__status"><span>免费使用 · 本地运行</span><i></i></div>
        </div>
        <div class="mw-view" data-view="directory" hidden>
          <div class="mw-directory" data-directory></div>
          <div class="mw-console__actions">
            <button class="mw-primary" data-directory-refresh type="button">刷新目录</button>
            <button class="mw-secondary" data-media-tab type="button">返回媒体</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(consoleElement);

    consoleElement.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => switchTab(button.dataset.tab));
    });
    consoleElement.querySelector("[data-minimize]").addEventListener("click", () => {
      const minimized = consoleElement.dataset.minimized === "true";
      consoleElement.dataset.minimized = String(!minimized);
      consoleElement.querySelector("[data-minimize]").textContent = minimized ? "−" : "+";
    });
    consoleElement.querySelector("[data-close]").addEventListener("click", () => {
      consoleElement.style.display = "none";
      showToast("控制台已隐藏，按 Ctrl+Shift+M 可重新打开");
    });
    consoleElement.querySelector("[data-batch]").addEventListener("click", (event) => {
      batchDownload(event.currentTarget);
    });
    consoleElement.querySelector("[data-scan]").addEventListener("click", () => {
      postBridge("MW_SCAN_DOUBAO");
      scheduleScan();
      showToast("已重新扫描当前页面", "success");
    });
    consoleElement.querySelector("[data-directory-refresh]").addEventListener("click", renderDirectory);
    consoleElement.querySelector("[data-media-tab]").addEventListener("click", () => switchTab("media"));
    installDrag(consoleElement.querySelector(".mw-console__header"));
    updateConsole();
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanMediaButtons, 160);
  }

  function scheduleDirectory() {
    if (activeTab !== "directory") return;
    clearTimeout(directoryTimer);
    directoryTimer = setTimeout(renderDirectory, 300);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.type === "AIAM_ALT_ORIGINAL_MEDIA_FOUND") {
      if (registerAltOriginalVideos(message.items || [])) {
        reportStatus();
        // The visible Doubao video button is injected by the legacy forwarder; keep this script as a data source.
      }
      return;
    }
    if (message?.source !== BRIDGE_SOURCE) return;

    if (message.type === "MW_DOUBAO_MEDIA") {
      let changed = false;
      for (const item of message.images || []) changed = registerImage(item) || changed;
      for (const item of message.videos || []) changed = registerVideo(item) || changed;
      if (changed) {
        health.lastEventAt = Date.now();
        reportStatus();
        scheduleScan();
      }
    }

    if (message.type === "MW_BRIDGE_HEALTH") {
      const bridge = message.health || {};
      health.bridgeReady = Boolean(bridge.bridgeReady);
      health.completionRequests = Math.max(0, Number(bridge.completionRequests) || 0);
      health.mediaPayloads = Math.max(0, Number(bridge.mediaPayloads) || 0);
      health.durationOptionReady = Boolean(bridge.durationOptionReady);
      health.lastIssue = String(bridge.lastIssue || "").slice(0, 80);
      health.lastEventAt = Math.max(health.lastEventAt, Number(bridge.lastEventAt) || 0);
      reportStatus();
    }

    if (message.type === "MW_VIDEO_RESULT") {
      const resolve = pendingVideoRequests.get(message.requestId);
      if (!resolve) return;
      pendingVideoRequests.delete(message.requestId);
      resolve(message);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (globalThis.__AIAM_WORKBENCH_MODE__) return;
    if (!event.ctrlKey || !event.shiftKey) return;
    if (event.key.toLowerCase() === "m") {
      event.preventDefault();
      createConsole();
      consoleElement.style.display = "";
    }
    if (event.key.toLowerCase() === "d") {
      event.preventDefault();
      createConsole();
      consoleElement.style.display = "";
      switchTab("directory");
    }
  });

  function start() {
    if (!document.body) return setTimeout(start, 100);
    createConsole();
    postBridge("MW_SCAN_DOUBAO");
    reportStatus();
    const observer = new MutationObserver(() => {
      scheduleScan();
      scheduleDirectory();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
    scheduleScan();
    setInterval(() => postBridge("MW_SCAN_DOUBAO"), 5000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
