(function maowangDoubaoBridge() {
  "use strict";

  if (window.__MAOWANG_DOUBAO_BRIDGE__) return;
  window.__MAOWANG_DOUBAO_BRIDGE__ = true;

  const SOURCE = "maowang-doubao-bridge";
  const DURATION_KEY = "maowang_doubao_duration";
  const TARGET_DURATION = 15;
  const TARGET_MODEL = "seedance_v2.0";
  const DURATION_MARK = "data-maowang-doubao-15s";
  const DURATION_STYLE_ID = "maowang-doubao-15s-style";
  const platformRules = globalThis.MaowangPlatformRules;
  const originalFetch = window.fetch.bind(window);
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;
  const videoByMessage = new Map();
  const processedRequests = new Set();
  const health = {
    bridgeReady: true,
    completionRequests: 0,
    mediaPayloads: 0,
    durationOptionReady: false,
    lastIssue: "",
    lastEventAt: Date.now()
  };
  let durationTimer = 0;
  let healthTimer = 0;

  function emit(type, detail) {
    window.postMessage({ source: SOURCE, type, ...detail }, location.origin);
  }

  function scheduleHealth() {
    clearTimeout(healthTimer);
    healthTimer = setTimeout(() => {
      emit("MW_BRIDGE_HEALTH", { health: { ...health } });
    }, 80);
  }

  function markIssue(code) {
    health.lastIssue = String(code || "").slice(0, 80);
    health.lastEventAt = Date.now();
    scheduleHealth();
  }

  function rememberVideoMappings(media) {
    for (const video of media.videos || []) {
      if (video.messageId && video.videoKey) {
        videoByMessage.set(video.messageId, video.videoKey);
      }
    }
    return media;
  }

  function extractMessageMedia(messages) {
    return rememberVideoMappings(platformRules.extractDoubaoMessageMedia(messages));
  }

  function extractPatchMedia(payload) {
    return rememberVideoMappings(platformRules.extractDoubaoPatchMedia(payload));
  }

  function publish(media) {
    if (!media.images.length && !media.videos.length) return;
    health.mediaPayloads += 1;
    health.lastIssue = "";
    health.lastEventAt = Date.now();
    scheduleHealth();
    emit("MW_DOUBAO_MEDIA", media);
  }

  async function consumeEventStream(stream) {
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const packets = buffer.split("\n\n");
        buffer = packets.pop() || "";
        for (const packet of packets) {
          const match = packet.match(/^data:\s*(.+)$/m);
          if (!match || match[1] === "[DONE]") continue;
          try {
            publish(extractPatchMedia(JSON.parse(match[1])));
          } catch (_) {}
        }
      }
    } catch (_) {
      markIssue("doubao-stream-read");
    }
  }

  function scanRouterData() {
    const cells = window._ROUTER_DATA?.loaderData?.chat_layout?.trimmedChainRecentConvCells || [];
    const images = [];
    const videos = [];
    for (const cell of cells) {
      const media = extractMessageMedia(cell?.conversation?.messages || []);
      images.push(...media.images);
      videos.push(...media.videos);
    }
    publish({ images, videos });
  }

  function isCompletionUrl(input) {
    return platformRules.isDoubaoCompletionUrl(input, location.href);
  }

  function selectedDuration() {
    try {
      return Number(localStorage.getItem(DURATION_KEY)) || 0;
    } catch (_) {
      return 0;
    }
  }

  function saveDuration(seconds) {
    try {
      if (seconds) localStorage.setItem(DURATION_KEY, String(seconds));
      else localStorage.removeItem(DURATION_KEY);
    } catch (_) {}
  }

  function patchDurationBody(body) {
    return platformRules.patchDoubaoDurationBody(
      body,
      selectedDuration(),
      TARGET_DURATION,
      TARGET_MODEL
    );
  }

  window.fetch = async function patchedFetch(input, init) {
    let nextInput = input;
    let nextInit = init;

    if (isCompletionUrl(input)) {
      health.completionRequests += 1;
      health.lastEventAt = Date.now();
      scheduleHealth();
      try {
        if (init && Object.prototype.hasOwnProperty.call(init, "body")) {
          nextInit = { ...init, body: patchDurationBody(init.body) };
        } else if (
          window.Request &&
          input instanceof Request &&
          String(input.method || "").toUpperCase() === "POST"
        ) {
          const body = patchDurationBody(await input.clone().text());
          nextInput = new Request(input, { body });
        }
      } catch (_) {
        markIssue("doubao-request-patch");
      }
    }

    const response = await originalFetch(nextInput, nextInit);
    if (!isCompletionUrl(input)) return response;

    try {
      const key = `${Date.now()}:${response.url}`;
      if (!processedRequests.has(key) && response.body) {
        processedRequests.add(key);
        const streams = response.body.tee();
        consumeEventStream(streams[1]);
        return new Response(streams[0], {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }
    } catch (_) {
      markIssue("doubao-response-stream");
    }
    return response;
  };

  XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
    this.__mwMethod = method;
    this.__mwUrl = url;
    return originalXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function patchedSend(body) {
    if (isCompletionUrl(this.__mwUrl) && String(this.__mwMethod).toUpperCase() === "POST") {
      body = patchDurationBody(body);
    }
    this.addEventListener("load", () => {
      if (!String(this.__mwUrl || "").includes("chain/single")) return;
      try {
        const messages = JSON.parse(this.responseText)
          ?.downlink_body
          ?.pull_singe_chain_downlink_body
          ?.messages;
        publish(extractMessageMedia(messages || []));
      } catch (_) {
        markIssue("doubao-chain-json");
      }
    });
    return originalXhrSend.call(this, body);
  };

  async function resolveVideo(videoKey) {
    const request = platformRules.buildDoubaoPlayInfoRequest(videoKey, crypto.randomUUID());
    const response = await originalFetch(request.url, request.init);
    const result = platformRules.extractDoubaoPlayInfo(await response.json());
    if (!result.success) throw new Error(result.error);
    return result;
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.source !== "maowang-doubao-content") return;

    if (message.type === "MW_SCAN_DOUBAO") {
      scanRouterData();
      scheduleHealth();
      return;
    }

    if (message.type === "MW_RESOLVE_VIDEO") {
      const videoKey = message.videoKey || videoByMessage.get(String(message.messageId || ""));
      try {
        const result = await resolveVideo(videoKey);
        emit("MW_VIDEO_RESULT", { requestId: message.requestId, success: true, ...result });
      } catch (error) {
        emit("MW_VIDEO_RESULT", {
          requestId: message.requestId,
          success: false,
          videoKey,
          error: error.message
        });
      }
    }
  });

  function visible(element) {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style.display !== "none"
      && style.visibility !== "hidden";
  }

  function compactText(element) {
    return String(element?.textContent || "")
      .replace(/\s+/g, "")
      .replace(/[✓✔√]/g, "")
      .trim();
  }

  function exactDuration(element) {
    const match = compactText(element).match(/^(5|10|15)(s|秒)$/);
    return match ? Number(match[1]) : 0;
  }

  function installDurationStyle() {
    if (document.getElementById(DURATION_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = DURATION_STYLE_ID;
    style.textContent = `
      [${DURATION_MARK}="option"] {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 26px !important;
        cursor: pointer !important;
      }
      [${DURATION_MARK}="option"] [${DURATION_MARK}-check] {
        margin-left: auto !important;
        flex: 0 0 auto !important;
        color: currentColor !important;
        font-size: 18px !important;
        line-height: 1 !important;
      }
      [${DURATION_MARK}-native-check="hidden"] {
        visibility: hidden !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function closestClickable(element) {
    let current = element?.nodeType === Node.TEXT_NODE ? element.parentElement : element;
    let pointerFallback = null;
    for (let level = 0; current && level < 7; level += 1, current = current.parentElement) {
      const role = current.getAttribute?.("role");
      if (
        current.tagName === "BUTTON"
        || role === "button"
        || role === "menuitem"
        || role === "option"
        || current.tabIndex >= 0
      ) {
        return current;
      }
      if (!pointerFallback && /pointer/.test(String(getComputedStyle(current).cursor || ""))) {
        pointerFallback = current;
      }
    }
    return pointerFallback || element?.parentElement || null;
  }

  function findDurationMenu() {
    if (!document.body) return null;
    return Array.from(
      document.querySelectorAll('[role="menu"], [role="listbox"], [data-slot*="dropdown-menu"], div')
    )
      .filter(visible)
      .filter((element) => {
        const value = compactText(element);
        if (value.length > 220) return false;
        if (!value.includes("时长") || !value.includes("5s") || !value.includes("10s")) return false;
        return !value.includes("Seedance") && !value.includes("比例");
      })
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return aRect.width * aRect.height - bRect.width * bRect.height;
      })[0] || null;
  }

  function durationTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return /^\s*(5|10|15)(s|秒)\s*$/.test(node.nodeValue || "")
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function findDurationOptions(root) {
    const options = [];
    for (const node of durationTextNodes(root)) {
      if (!visible(node.parentElement)) continue;
      const item = closestClickable(node.parentElement);
      if (!item || !root.contains(item) || !exactDuration(item)) continue;
      if (options.some((existing) => existing === item || existing.contains(item))) continue;
      for (let index = options.length - 1; index >= 0; index -= 1) {
        if (item.contains(options[index])) options.splice(index, 1);
      }
      options.push(item);
    }
    return options;
  }

  function durationTextNode(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (/^\s*(5|10|15)(s|秒)\s*$/.test(walker.currentNode.nodeValue || "")) {
        return walker.currentNode;
      }
    }
    return null;
  }

  function removeOwnChecks(element) {
    element.querySelectorAll(`[${DURATION_MARK}-check]`).forEach((node) => node.remove());
  }

  function setNativeChecksHidden(item, hidden) {
    item.querySelectorAll(`[${DURATION_MARK}-native-check]`).forEach((node) => {
      node.removeAttribute(`${DURATION_MARK}-native-check`);
    });
    if (!hidden) return;

    item.querySelectorAll("svg,img,canvas").forEach((node) => {
      node.setAttribute(`${DURATION_MARK}-native-check`, "hidden");
    });
    const nodes = [];
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return /[✓✔√]/.test(node.nodeValue || "")
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const parent = node.parentElement;
      if (parent && /^[\s✓✔√]+$/.test(parent.textContent || "")) {
        parent.setAttribute(`${DURATION_MARK}-native-check`, "hidden");
      }
    }
  }

  function scrubDurationClone(clone) {
    clone.removeAttribute("aria-selected");
    clone.removeAttribute("aria-checked");
    clone.removeAttribute("checked");
    clone.removeAttribute("selected");
    clone.removeAttribute(DURATION_MARK);
    clone.removeAttribute(`${DURATION_MARK}-native`);
    clone.removeAttribute(`${DURATION_MARK}-trigger`);
    clone.querySelectorAll(
      `[${DURATION_MARK}], [${DURATION_MARK}-native], [${DURATION_MARK}-trigger]`
    ).forEach((node) => {
      node.removeAttribute(DURATION_MARK);
      node.removeAttribute(`${DURATION_MARK}-native`);
      node.removeAttribute(`${DURATION_MARK}-trigger`);
    });
    removeOwnChecks(clone);
    const node = durationTextNode(clone);
    if (node) node.nodeValue = "15s";
    else clone.textContent = "15s";
  }

  function setToolbarDuration(seconds) {
    const next = seconds === TARGET_DURATION ? "15s" : `${seconds}s`;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return /^\s*(5|10|15)(s|秒)\s*$/.test(node.nodeValue || "")
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      if (!visible(node.parentElement)) continue;
      const trigger = closestClickable(node.parentElement);
      if (!trigger || !visible(trigger)) continue;
      let current = trigger.parentElement;
      for (let level = 0; current && level < 7; level += 1, current = current.parentElement) {
        const value = compactText(current);
        if (value.includes("Seedance") && value.includes("比例") && value.length < 260) {
          node.nodeValue = next;
          if (!trigger.hasAttribute(`${DURATION_MARK}-trigger`)) {
            trigger.setAttribute(`${DURATION_MARK}-trigger`, "1");
            trigger.addEventListener("click", () => {
              setTimeout(injectDurationOption, 80);
              setTimeout(injectDurationOption, 240);
            }, true);
          }
          break;
        }
      }
    }
  }

  function renderDurationChecks(options) {
    const selected15 = selectedDuration() === TARGET_DURATION;
    for (const item of options) {
      const value = exactDuration(item);
      if (value === 5 || value === 10) setNativeChecksHidden(item, selected15);
      if (value === TARGET_DURATION) {
        removeOwnChecks(item);
        setNativeChecksHidden(item, !selected15);
      }
    }
  }

  function bindNativeDuration(item, seconds) {
    if (item.hasAttribute(`${DURATION_MARK}-native`)) return;
    item.setAttribute(`${DURATION_MARK}-native`, String(seconds));
    item.addEventListener("click", () => {
      saveDuration(0);
      setToolbarDuration(seconds);
      setTimeout(injectDurationOption, 80);
    }, true);
  }

  function closeDurationMenu(customItem) {
    const menu = customItem.closest('[role="menu"], [role="listbox"], [data-slot*="dropdown-menu"]')
      || findDurationMenu();

    const trigger = Array.from(document.querySelectorAll(`[${DURATION_MARK}-trigger]`))
      .find((element) => visible(element) && !menu?.contains(element));
    if (trigger) {
      trigger.click();
      return;
    }

    customItem.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      composed: true
    }));
  }

  function bindFifteenDuration(item) {
    if (item.hasAttribute(DURATION_MARK)) return;
    item.setAttribute(DURATION_MARK, "option");

    const check = document.createElement("span");
    check.setAttribute(`${DURATION_MARK}-check`, "true");
    check.textContent = "✓";
    check.style.display = selectedDuration() === TARGET_DURATION ? "inline" : "none";
    item.appendChild(check);

    item.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeDurationMenu(item);
      saveDuration(TARGET_DURATION);
      setToolbarDuration(TARGET_DURATION);
      check.style.display = "inline";
      requestAnimationFrame(() => {
        saveDuration(TARGET_DURATION);
        setToolbarDuration(TARGET_DURATION);
      });
      setTimeout(() => {
        saveDuration(TARGET_DURATION);
        setToolbarDuration(TARGET_DURATION);
      }, 60);
    }, true);
  }

  function injectDurationOption() {
    const menu = findDurationMenu();
    if (!menu) return;
    const options = findDurationOptions(menu);
    if (!options.length) return;

    for (const item of options) {
      const value = exactDuration(item);
      if (value === 5 || value === 10) bindNativeDuration(item, value);
      if (value === TARGET_DURATION) bindFifteenDuration(item);
    }

    if (!options.some((item) => exactDuration(item) === TARGET_DURATION)) {
      const after = options.find((item) => exactDuration(item) === 10) || options[options.length - 1];
      const template = options.find((item) => exactDuration(item) === 5) || after;
      if (!after?.parentElement || !template) return;
      const clone = template.cloneNode(true);
      scrubDurationClone(clone);
      bindFifteenDuration(clone);
      after.parentElement.insertBefore(clone, after.nextSibling);
      options.push(clone);
    }

    renderDurationChecks(options);
    health.durationOptionReady = options.some((item) => exactDuration(item) === TARGET_DURATION);
    health.lastEventAt = Date.now();
    scheduleHealth();
  }

  function durationTick() {
    if (selectedDuration() === TARGET_DURATION) setToolbarDuration(TARGET_DURATION);
    injectDurationOption();
  }

  function scheduleDurationTick() {
    clearTimeout(durationTimer);
    durationTimer = setTimeout(durationTick, 100);
  }

  function start() {
    if (!document.body) return setTimeout(start, 100);
    installDurationStyle();
    scheduleHealth();
    durationTick();
    const durationObserver = new MutationObserver(scheduleDurationTick);
    durationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
    scanRouterData();
    setTimeout(scanRouterData, 1800);
    setTimeout(scanRouterData, 5200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
