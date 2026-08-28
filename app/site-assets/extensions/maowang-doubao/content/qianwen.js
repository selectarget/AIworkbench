(function maowangQianwenContent() {
  "use strict";

  if (window.__MAOWANG_QIANWEN_CONTENT__) return;
  window.__MAOWANG_QIANWEN_CONTENT__ = true;

  const platformRules = globalThis.MaowangPlatformRules;
  const images = new Map();
  const videos = new Map();
  const processedImages = new WeakSet();
  const processedVideos = new WeakSet();
  const health = {
    contentReady: true,
    scanCount: 0,
    candidateImages: 0,
    lastIssue: "",
    lastEventAt: Date.now()
  };
  let consoleElement = null;
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

  function baseUrl(value) {
    try {
      const url = new URL(value);
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch (_) {
      return "";
    }
  }

  function imageContext(image) {
    const parts = [];
    let current = image.parentElement;
    for (let level = 0; current && current !== document.body && level < 6; level += 1) {
      parts.push(
        current.className,
        current.getAttribute?.("data-role"),
        current.getAttribute?.("data-message-role"),
        current.getAttribute?.("aria-label")
      );
      current = current.parentElement;
    }
    return parts.filter(Boolean).join(" ");
  }

  function isGeneratedImage(image) {
    const src = image.currentSrc || image.src;
    if (image.closest("video, .mw-console")) return false;
    if (image.closest('.chat-question-wrap, .question-text-card, [class*="avatar"]')) return false;
    return platformRules.qianwenImageDecision({
      url: src,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      context: imageContext(image)
    }).accepted;
  }

  function registerImage(image) {
    if (!isGeneratedImage(image)) return null;
    const url = image.currentSrc || image.src;
    const key = baseUrl(url);
    if (!key) return null;
    if (!images.has(key)) {
      images.set(key, {
        url,
        width: image.naturalWidth || 0,
        height: image.naturalHeight || 0
      });
      health.lastEventAt = Date.now();
      reportStatus();
    }
    return images.get(key);
  }

  function videoUrl(video) {
    const direct = video.currentSrc || video.src;
    if (direct && !direct.startsWith("blob:")) return direct;
    return Array.from(video.querySelectorAll("source"))
      .map((source) => source.src)
      .find((url) => url && !url.startsWith("blob:")) || "";
  }

  function videoTitle(video) {
    const container = video.closest(
      '.videoContainer-3A8Fk, .videoPlayerCard-1k1NX, [class*="videoContainer"], [class*="video-card"]'
    );
    const title = container?.querySelector(
      '.title-35epL, .queryText-G_8y-, [class*="title"], [class*="queryText"]'
    )?.textContent;
    return String(title || "千问视频").replace(/\s+/g, " ").trim().slice(0, 60);
  }

  function registerVideo(video) {
    const url = videoUrl(video);
    const key = baseUrl(url);
    if (!key) return null;
    if (!videos.has(key)) {
      videos.set(key, {
        url,
        title: videoTitle(video),
        width: video.videoWidth || 0,
        height: video.videoHeight || 0
      });
      health.lastEventAt = Date.now();
      reportStatus();
    }
    return videos.get(key);
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

  function safeName(value) {
    return String(value || "媒体").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 80);
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

  async function downloadItem(item, type, button) {
    const resetText = button.classList.contains("mw-item-download")
      ? "单独下载"
      : type === "image" ? "下载原图" : "下载视频";
    setButtonState(button, "busy", "正在传输", resetText);
    const dimensions = item.width && item.height ? `_${item.width}x${item.height}` : "";
    const filename = type === "image"
      ? `猫王千问_图片${dimensions}_${Date.now()}.png`
      : `猫王千问_${safeName(item.title)}${dimensions}_${Date.now()}.mp4`;
    const result = await sendRuntime({
      type: "MW_DOWNLOAD",
      item: { url: item.url, filename }
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
    if (processedImages.has(image)) return;
    const item = registerImage(image);
    if (!item) return;
    const container = findStableContainer(image);
    if (!container || container.querySelector(":scope > .mw-media-action[data-kind='image']")) return;
    if (getComputedStyle(container).position === "static") container.style.position = "relative";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "mw-media-action";
    button.dataset.kind = "image";
    button.textContent = "下载原图";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      downloadItem(item, "image", button);
    });
    container.appendChild(button);
    processedImages.add(image);
  }

  function injectVideoButton(video) {
    if (processedVideos.has(video)) return;
    const item = registerVideo(video);
    if (!item) return;
    const container = findStableContainer(video);
    if (!container || container.querySelector(":scope > .mw-media-action[data-kind='video']")) return;
    if (getComputedStyle(container).position === "static") container.style.position = "relative";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "mw-media-action";
    button.dataset.kind = "video";
    button.textContent = "下载视频";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      downloadItem(item, "video", button);
    });
    container.appendChild(button);
    processedVideos.add(video);
  }

  function scanPage() {
    health.scanCount += 1;
    health.candidateImages = document.images.length;
    health.lastEventAt = Date.now();
    document.querySelectorAll("img").forEach((image) => {
      if (image.complete) injectImageButton(image);
      else image.addEventListener("load", () => injectImageButton(image), { once: true });
    });
    document.querySelectorAll("video").forEach(injectVideoButton);
    reportStatus();
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanPage, 160);
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
        (button) => downloadItem(item, "image", button)
      ));
    }

    let videoIndex = 0;
    for (const item of videos.values()) {
      videoIndex += 1;
      fragment.appendChild(createMediaListItem(
        "video",
        videoIndex,
        mediaDetail(item, "无水印视频"),
        (button) => downloadItem(item, "video", button)
      ));
    }
    list.appendChild(fragment);
  }

  function reportStatus() {
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      sendRuntime({
        type: "MW_STATUS_UPDATE",
        platform: "qianwen",
        imageCount: images.size,
        videoCount: videos.size,
        health
      });
      updateConsole();
    }, 120);
  }

  async function batchDownload(button) {
    const items = [];
    let imageIndex = 0;
    for (const image of images.values()) {
      imageIndex += 1;
      items.push({
        url: image.url,
        filename: `猫王千问_图片_${String(imageIndex).padStart(3, "0")}_${Date.now()}.png`
      });
    }
    let videoIndex = 0;
    for (const video of videos.values()) {
      videoIndex += 1;
      items.push({
        url: video.url,
        filename: `猫王千问_${safeName(video.title)}_${String(videoIndex).padStart(3, "0")}_${Date.now()}.mp4`
      });
    }

    if (!items.length) {
      showToast("当前页面还没有识别到可下载内容", "error");
      return;
    }

    button.disabled = true;
    button.textContent = `正在下载 ${items.length} 项`;
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
    if (consoleElement || !document.body) return;
    consoleElement = document.createElement("section");
    consoleElement.id = "mw-qianwen-console";
    consoleElement.className = "mw-console";
    consoleElement.dataset.minimized = "false";
    consoleElement.innerHTML = `
      <header class="mw-console__header">
        <div class="mw-console__identity">
          <span class="mw-console__eyebrow">千问下载助手</span>
          <strong class="mw-console__title">猫王豆包无水印</strong>
        </div>
        <div class="mw-console__controls">
          <button class="mw-icon-button" data-minimize type="button" title="最小化">−</button>
          <button class="mw-icon-button" data-close type="button" title="隐藏">×</button>
        </div>
      </header>
      <div class="mw-console__body">
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
    `;
    document.body.appendChild(consoleElement);

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
      scheduleScan();
      showToast("已重新扫描当前页面", "success");
    });
    installDrag(consoleElement.querySelector(".mw-console__header"));
    updateConsole();
  }

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "m") {
      event.preventDefault();
      createConsole();
      consoleElement.style.display = "";
    }
  });

  function start() {
    if (!document.body) return setTimeout(start, 100);
    createConsole();
    scanPage();
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "poster"]
    });
    setInterval(reportStatus, 5000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
