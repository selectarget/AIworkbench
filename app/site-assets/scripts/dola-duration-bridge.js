(function () {
  "use strict";

  const INSTALL_KEY = "__watermarkFreeDurationAudioReferenceInstalledV1";
  const DURATION_KEY = "intl_doubao_enable_30s_v1";
  const STATE_ATTRIBUTE = "data-watermark-free-duration-30";
  const STATE_EVENT = "watermark-free-duration-30-change";
  const MENU_MARK = "data-watermark-free-duration-option";
  const NATIVE_BOUND_MARK = "data-watermark-free-native-duration-bound";
  const MODEL_SELECTOR = "[data-input-engine-actionbar-control-key=\"video-model\"], [data-input-engine-actionbar-control-key=\"model\"]";
  const VIDEO_COMPLETION_PATH = "/chat/completion";
  const VIDEO_ABILITY_TYPE = 17;
  const SEEDANCE_25_MODEL = "seedance_v2.5";
  const DOLA_VIDEO_UPLOAD_MODULE_ID = 784675;
  const DOLA_CONFIGURED_UPLOAD_MODULE_ID = 998058;
  const DOLA_PIPELINE_READY_TIMEOUT_MS = 5000;
  const DOLA_ATTACHMENT_BIND_TIMEOUT_MS = 3500;
  const DOLA_ATTACHMENT_SETTLE_MS = 1800;
  const DOLA_PIPELINE_UNAVAILABLE_CODE = "DOLA_PIPELINE_UNAVAILABLE";
  const DOLA_ATTACHMENT_BLOCK_TYPE = 10052;
  const DOLA_MEDIA_ACCEPT = ".jpg,.png,.jpeg,.webp,.apng,.mp4,.mov,video/mp4,video/quicktime,.mp3,.wav,audio/mpeg,audio/wav";
  const DOLA_AUDIO_REFERENCE_SOURCE = "watermark-free-audio-reference";
  const DOLA_AUDIO_REFERENCE_REQUEST = "DOLA_AUDIO_REFERENCE_UPLOAD";
  const DOLA_AUDIO_REFERENCE_STATUS = "DOLA_AUDIO_REFERENCE_STATUS";
  const DOLA_AUDIO_LIMIT = 10;
  const DOLA_VIDEO_LIMIT = 10;
  const DOLA_MEDIA_PATCH_MARK = "__watermarkFreeDolaMediaPatched";

  let dolaWebpackRequire = null;
  let dolaSubmitPatchPending = false;
  let dolaAudioUploadPending = false;
  let dolaLastReferenceChatId = "";
  let dolaAudioNetworkEvents = [];
  let dolaAudioPreprocessEvents = [];
  let dolaAudioPreprocessState = null;
  let dolaAudioPipelineState = null;
  let dolaAudioCompatibilityState = null;
  let dolaConfiguredPipelineRunner = null;
  let dolaPipelineModuleScanAt = 0;

  if (globalThis[INSTALL_KEY]) {
    return;
  }
  globalThis[INSTALL_KEY] = true;

  const host = location.hostname.replace(/^www\./i, "").toLowerCase();
  if (!(host === "dola.com" || host.endsWith(".dola.com") || host === "ciciai.com" || host.endsWith(".ciciai.com") || host === "doubao.com" || host.endsWith(".doubao.com"))) {
    return;
  }

  let lastKnownModelTarget = 0;

  function textOf(element) {
    return String(
      element?.textContent ||
      element?.getAttribute?.("aria-label") ||
      element?.getAttribute?.("title") ||
      ""
    ).replace(/\s+/g, " ").trim();
  }

  function visible(element) {
    try {
      const rect = element?.getBoundingClientRect();
      const style = element && getComputedStyle(element);
      return Boolean(
        element &&
        element.isConnected &&
        rect.width > 1 &&
        rect.height > 1 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || 1) > 0.01
      );
    } catch {
      return false;
    }
  }

  function durationText(value) {
    return String(value || "").replace(/\s+/g, "").replace(/[✓✔√]/g, "").trim();
  }

  function selectedModelText() {
    return durationText(textOf(document.querySelector(MODEL_SELECTOR)));
  }

  function modelTargetDuration() {
    const text = selectedModelText();
    if (/2\.5|seedance[^\d]*2[^\d]*5/i.test(text)) {
      lastKnownModelTarget = 30;
    } else if (/2\.0|seedance[^\d]*2[^\d]*0|seedance[^\d]*fast/i.test(text)) {
      lastKnownModelTarget = 0;
    }
    return lastKnownModelTarget;
  }

  function duration30Enabled() {
    try {
      return localStorage.getItem(DURATION_KEY) === "1";
    } catch {
      return false;
    }
  }

  function selectedDuration() {
    return modelTargetDuration() === 30 && duration30Enabled() ? 30 : 0;
  }

  function publishDurationState() {
    const root = document.documentElement;
    if (!root) {
      return;
    }
    root.setAttribute(STATE_ATTRIBUTE, duration30Enabled() ? "1" : "0");
    document.dispatchEvent(new Event(STATE_EVENT));
  }

  function saveDuration30(enabled) {
    try {
      localStorage.setItem(DURATION_KEY, enabled ? "1" : "0");
    } catch {
      return;
    }
    publishDurationState();
  }

  document.addEventListener(STATE_EVENT, () => {
    const value = document.documentElement?.getAttribute(STATE_ATTRIBUTE);
    if (value !== "0" && value !== "1") {
      return;
    }
    try {
      localStorage.setItem(DURATION_KEY, value);
    } catch {
      return;
    }
    enhanceDurationOptions();
  });

  function getRequestUrl(input) {
    return typeof input === "string" ? input : (input && (input.url || input.href)) || String(input || "");
  }

  function normalizeDolaUploadUrl(rawUrl) {
    const value = String(rawUrl || "");
    const match = value.match(/^(?:https?:\/\/www\.(?:dola|ciciai)\.com\/chat\/)?(vod-[a-z0-9.-]+\.bytevcloudapi\.com)(\/?\?.*)$/i);
    if (!match) return value;
    const normalized = `https://${match[1]}${match[2]}`;
    window.__WATERMARK_FREE_LAST_UPLOAD_URL_REWRITE__ = {
      from: dolaNetworkEndpoint(value),
      to: dolaNetworkEndpoint(normalized),
      at: Date.now()
    };
    return normalized;
  }

  function isSupportedGenerationHost(rawUrl) {
    try {
      const requestHost = new URL(rawUrl, location.href).hostname.replace(/^www\./i, "").toLowerCase();
      return requestHost === "dola.com" || requestHost.endsWith(".dola.com") || requestHost === "ciciai.com" || requestHost.endsWith(".ciciai.com") ||
        requestHost === "doubao.com" || requestHost.endsWith(".doubao.com");
    } catch {
      return false;
    }
  }

  function isVideoCompletionUrl(rawUrl) {
    if (!isSupportedGenerationHost(rawUrl || location.href)) {
      return false;
    }
    try {
      return new URL(rawUrl, location.href).pathname === VIDEO_COMPLETION_PATH;
    } catch {
      return false;
    }
  }

  function patchBody(body, requestUrl = "") {
    if (!duration30Enabled() || typeof body !== "string" || !body.trim() || !isVideoCompletionUrl(requestUrl)) {
      return body;
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return body;
    }

    const ability = payload?.chat_ability;
    if (!ability || Number(ability.ability_type) !== VIDEO_ABILITY_TYPE || typeof ability.ability_param !== "string") {
      return body;
    }

    let abilityParam;
    try {
      abilityParam = JSON.parse(ability.ability_param);
    } catch {
      return body;
    }
    if (!abilityParam || abilityParam.model !== SEEDANCE_25_MODEL || Number(abilityParam.duration) === 30) {
      return body;
    }

    abilityParam.duration = 30;
    ability.ability_param = JSON.stringify(abilityParam);
    return JSON.stringify(payload);
  }

  function dolaNetworkEndpoint(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      return `${url.origin}${url.pathname}`.slice(0, 300);
    } catch {
      return String(rawUrl || "").split("?")[0].slice(0, 300);
    }
  }

  function dolaNetworkResponseFields(value) {
    if (!value || typeof value !== "object") return { code: "", message: "" };
    const nested = [value, value.data, value.error, value.meta].filter(item => item && typeof item === "object");
    const codeKeys = ["code", "status_code", "statusCode", "error_code", "err_code", "ret"];
    const messageKeys = ["message", "msg", "error_message", "errorMessage", "reason", "detail"];
    let code = "";
    let message = "";
    for (const item of nested) {
      for (const key of codeKeys) {
        if (code === "" && ["string", "number"].includes(typeof item[key])) code = String(item[key]).slice(0, 80);
      }
      for (const key of messageKeys) {
        if (!message && typeof item[key] === "string") message = item[key].trim().slice(0, 240);
      }
    }
    return { code, message };
  }

  function dolaRecordAudioNetwork(rawUrl, status, responseValue) {
    if (!dolaAudioUploadPending) return;
    const endpoint = dolaNetworkEndpoint(rawUrl);
    const lower = endpoint.toLowerCase();
    if (/monitor_browser|collect\/batch|mssdk|slardar/.test(lower)) return;
    if (!/upload|resource|imagex|vod|tos/.test(lower) && Number(status) < 400) return;
    let value = responseValue;
    if (typeof responseValue === "string" && responseValue.trim()) {
      try { value = JSON.parse(responseValue); } catch { value = null; }
    }
    const fields = dolaNetworkResponseFields(value);
    dolaAudioNetworkEvents.push({
      endpoint,
      status: Number(status || 0),
      code: fields.code,
      message: fields.message
    });
    if (dolaAudioNetworkEvents.length > 12) dolaAudioNetworkEvents.shift();
  }

  function dolaCaptureFetchResponse(rawUrl, response) {
    if (!dolaAudioUploadPending || !response) return;
    try {
      response.clone().text()
        .then(text => dolaRecordAudioNetwork(rawUrl, response.status, text))
        .catch(() => dolaRecordAudioNetwork(rawUrl, response.status, null));
    } catch {
      dolaRecordAudioNetwork(rawUrl, response.status, null);
    }
  }

  function patchRequests() {
    const originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
      window.fetch = function patchedFetch(input, init = {}) {
        const originalUrl = getRequestUrl(input);
        const requestUrl = normalizeDolaUploadUrl(originalUrl);
        if (requestUrl !== originalUrl) {
          try {
            input = typeof input === "object" && input instanceof Request
              ? new Request(requestUrl, input)
              : requestUrl;
          } catch {
            input = requestUrl;
          }
        }
        if (init && typeof init.body === "string") {
          const body = patchBody(init.body, requestUrl);
          if (body !== init.body) {
            init = { ...init, body };
          }
        }
        return originalFetch.call(this, input, init).then(response => {
          dolaCaptureFetchResponse(requestUrl, response);
          return response;
        }, error => {
          dolaRecordAudioNetwork(requestUrl, 0, { message: error?.message || "Network error" });
          throw error;
        });
      };
    }

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    if (typeof originalOpen === "function") {
      XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
        const originalUrl = getRequestUrl(url);
        const requestUrl = normalizeDolaUploadUrl(originalUrl);
        this.__watermarkFreeRequestUrl = requestUrl;
        const args = Array.from(arguments);
        args[1] = requestUrl;
        return originalOpen.apply(this, args);
      };
    }
    if (typeof originalSend === "function") {
      XMLHttpRequest.prototype.send = function patchedSend(body) {
        if (!this.__watermarkFreeAudioCaptureBound) {
          this.__watermarkFreeAudioCaptureBound = true;
          this.addEventListener("loadend", () => {
            let responseValue = null;
            try {
              responseValue = this.responseType === "json" ? this.response : this.responseText;
            } catch {
              responseValue = null;
            }
            dolaRecordAudioNetwork(this.__watermarkFreeRequestUrl || location.href, this.status, responseValue);
          });
        }
        return originalSend.call(this, patchBody(body, this.__watermarkFreeRequestUrl || location.href));
      };
    }
  }

  function exactDuration(element) {
    const match = durationText(textOf(element)).match(/^(5|10|15|30)(s|秒)$/i);
    return match ? Number(match[1]) : 0;
  }

  function findDurationMenuRoot() {
    const candidates = Array.from(document.querySelectorAll(
      "[role=\"menu\"], [role=\"listbox\"], [data-slot*=\"dropdown-menu\"], [class*=\"popover\"], [class*=\"dropdown\"], div"
    ))
      .filter((element) => visible(element))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width < 70 || rect.width > 520 || rect.height < 40 || rect.height > 520) {
          return false;
        }
        const text = durationText(textOf(element));
        const hasNativeDurations = /5(s|秒)/i.test(text) && /10(s|秒)/i.test(text);
        const looksLikeWholeToolbar = /Seedance|比例|参考图|模型|Model|Fast/i.test(text) && rect.width > 360;
        return hasNativeDurations && !looksLikeWholeToolbar;
      })
      .sort((first, second) => {
        const firstRect = first.getBoundingClientRect();
        const secondRect = second.getBoundingClientRect();
        return firstRect.width * firstRect.height - secondRect.width * secondRect.height;
      });
    return candidates[0] || null;
  }

  function replaceDurationLabel(element, target) {
    try {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let changed = false;
      while (walker.nextNode()) {
        const next = String(walker.currentNode.nodeValue || "").replace(/(?:5|10|15|30)(s|秒)/ig, `${target}s`);
        if (next !== walker.currentNode.nodeValue) {
          walker.currentNode.nodeValue = next;
          changed = true;
        }
      }
      if (changed) {
        return;
      }
    } catch {
      // Fall through to replacing the whole label.
    }
    element.textContent = `${target}s`;
  }

  function durationCheckMarks(item) {
    return Array.from(item?.querySelectorAll?.("svg") || []);
  }

  function setDurationMenuSelected(item, selected) {
    item?.setAttribute?.("aria-selected", selected ? "true" : "false");
    if (selected) {
      item?.setAttribute?.("data-state", "checked");
    } else {
      item?.removeAttribute?.("data-state");
    }
    for (const mark of durationCheckMarks(item)) {
      mark.style.visibility = selected ? "visible" : "hidden";
    }
  }

  function syncDurationMenuSelection(root) {
    if (!root) {
      return;
    }
    const force30 = selectedDuration() === 30;
    const options = Array.from(root.querySelectorAll("[role=\"menuitem\"], [role=\"option\"], li, button, div"))
      .filter((element) => element !== root && visible(element) && exactDuration(element) > 0);
    for (const option of options) {
      const value = exactDuration(option);
      if (force30) {
        setDurationMenuSelected(option, value === 30);
      } else if (option.getAttribute(MENU_MARK) === "30") {
        setDurationMenuSelected(option, false);
      }
    }
  }

  function updateToolbarDurationText(seconds) {
    if (!document.body) {
      return;
    }
    const menuRoot = findDurationMenuRoot();
    const isInMenu = (element) => Boolean(
      element && (menuRoot?.contains?.(element) || element.closest?.("[role=\"menu\"], [role=\"listbox\"], [data-slot=\"dropdown-menu-content\"]"))
    );
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!/^\s*(5|10|15|30)s\s*$/i.test(node.nodeValue || "")) {
        continue;
      }
      const element = node.parentElement;
      if (!visible(element) || isInMenu(element)) {
        continue;
      }
      const trigger = element.closest?.("button, [role=\"button\"], [aria-haspopup], [aria-expanded], [data-slot*=\"trigger\"]") || element;
      if (visible(trigger) && !isInMenu(trigger)) {
        node.nodeValue = `${seconds}s`;
      }
    }
  }

  function holdToolbarDurationText(seconds) {
    for (const delay of [0, 50, 120, 300, 800, 1500, 3000]) {
      setTimeout(() => updateToolbarDurationText(seconds), delay);
    }
  }

  function injectDurationMenuOption() {
    const root = findDurationMenuRoot();
    if (!root) {
      return false;
    }

    const target = modelTargetDuration();
    let options = Array.from(root.querySelectorAll("[role=\"menuitem\"], [role=\"option\"], li, button, div"))
      .filter((element) => element !== root && visible(element) && exactDuration(element) > 0);

    for (const option of options) {
      if (option.getAttribute(MENU_MARK) === "30" && target !== 30) {
        option.remove();
      }
    }

    options = Array.from(root.querySelectorAll("[role=\"menuitem\"], [role=\"option\"], li, button, div"))
      .filter((element) => element !== root && visible(element) && exactDuration(element) > 0);

    if (target === 30 && !options.some((element) => exactDuration(element) === 30)) {
      const template = options.find((element) => exactDuration(element) === 10) || options[0];
      if (!template?.parentElement) {
        return false;
      }
      const clone = template.cloneNode(true);
      clone.removeAttribute("aria-selected");
      clone.removeAttribute("data-state");
      clone.setAttribute(MENU_MARK, "30");
      clone.setAttribute("aria-selected", "false");
      replaceDurationLabel(clone, 30);
      for (const mark of durationCheckMarks(clone)) {
        mark.style.visibility = "hidden";
      }
      clone.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        saveDuration30(true);
        syncDurationMenuSelection(root);
        holdToolbarDurationText(30);
        setTimeout(() => {
          try {
            const options = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true };
            document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", options));
            document.dispatchEvent(new KeyboardEvent("keydown", options));
            document.dispatchEvent(new KeyboardEvent("keyup", options));
          } catch {
            document.body?.click?.();
          }
        }, 60);
      }, true);
      template.parentElement.appendChild(clone);
    }

    options = Array.from(root.querySelectorAll("[role=\"menuitem\"], [role=\"option\"], li, button, div"))
      .filter((element) => element !== root && visible(element) && exactDuration(element) > 0);
    for (const option of options) {
      const value = exactDuration(option);
      if ((value === 5 || value === 10 || value === 15) && !option.hasAttribute(NATIVE_BOUND_MARK)) {
        option.setAttribute(NATIVE_BOUND_MARK, String(value));
        option.addEventListener("click", () => saveDuration30(false), true);
      }
    }

    syncDurationMenuSelection(root);
    return true;
  }

  function enhanceDurationOptions() {
    injectDurationMenuOption();
    if (selectedDuration() === 30) {
      updateToolbarDurationText(30);
    }
  }

  function dolaMaterialKind(file) {
    const type = String(file?.type || "").toLowerCase();
    const name = String(file?.name || "").toLowerCase();
    if (type.startsWith("image/") || /\.(jpe?g|png|webp|apng)$/.test(name)) return "image";
    if (type.startsWith("video/") || /\.(mp4|mov)$/.test(name)) return "video";
    if (type.startsWith("audio/") || /\.(mp3|wav)$/.test(name)) return "audio";
    return "";
  }

  function dolaGetWebpackRequire() {
    if (dolaWebpackRequire) return dolaWebpackRequire;
    const chunks = window.__LOADABLE_LOADED_CHUNKS__;
    if (!Array.isArray(chunks)) return null;
    try {
      chunks.push([[`watermark-free-media-${Date.now()}`], {}, runtime => {
        dolaWebpackRequire = runtime;
      }]);
    } catch {
      return null;
    }
    return dolaWebpackRequire;
  }

  function dolaSafeWebpackModule(runtime, moduleId) {
    if (typeof runtime !== "function" || typeof runtime?.m?.[moduleId] !== "function") return null;
    try {
      return runtime(moduleId);
    } catch (error) {
      window.__WATERMARK_FREE_LAST_AUDIO_PIPELINE_MODULE__ = {
        moduleId: String(moduleId),
        loaded: false,
        message: String(error?.message || error || "").slice(0, 240)
      };
      return null;
    }
  }

  function dolaPipelineFunctionScore(fn) {
    if (typeof fn !== "function") return 0;
    let source = "";
    try {
      source = Function.prototype.toString.call(fn);
    } catch {
      return 0;
    }
    let score = 0;
    if (/uploadPipelineConfig/.test(source)) score += 4;
    if (/inputUploadConfig/.test(source)) score += 3;
    if (/targetAttachmentChannel|attachmentChannel/.test(source)) score += 2;
    if (/\bfiles\b/.test(source)) score += 1;
    return score;
  }

  function dolaFindConfiguredPipelineRunner(runtime) {
    if (dolaConfiguredPipelineRunner?.runPipeline) return dolaConfiguredPipelineRunner;
    const known = dolaSafeWebpackModule(runtime, DOLA_CONFIGURED_UPLOAD_MODULE_ID);
    if (typeof known?.Z === "function") {
      dolaConfiguredPipelineRunner = { runPipeline: known.Z, moduleId: DOLA_CONFIGURED_UPLOAD_MODULE_ID, source: "known" };
      return dolaConfiguredPipelineRunner;
    }

    const now = Date.now();
    if (now - dolaPipelineModuleScanAt < 1000) return null;
    dolaPipelineModuleScanAt = now;

    const inspectExports = (exports, moduleId, source) => {
      if (!exports) return null;
      const candidates = [];
      if (typeof exports === "function") candidates.push(exports);
      if (typeof exports === "object") {
        for (const value of Object.values(exports)) {
          if (typeof value === "function") candidates.push(value);
        }
      }
      let best = null;
      for (const fn of candidates) {
        const score = dolaPipelineFunctionScore(fn);
        if (score >= 7 && (!best || score > best.score)) best = { runPipeline: fn, moduleId, source, score };
      }
      return best;
    };

    try {
      for (const [moduleId, cached] of Object.entries(runtime?.c || {})) {
        const hit = inspectExports(cached?.exports, moduleId, "cache");
        if (hit) {
          dolaConfiguredPipelineRunner = hit;
          return hit;
        }
      }
    } catch {
      // Some Webpack builds do not expose the module cache.
    }

    try {
      for (const [moduleId, factory] of Object.entries(runtime?.m || {})) {
        if (String(moduleId) === String(DOLA_CONFIGURED_UPLOAD_MODULE_ID) || typeof factory !== "function") continue;
        let factorySource = "";
        try { factorySource = Function.prototype.toString.call(factory); } catch { continue; }
        if (!/uploadPipelineConfig/.test(factorySource) || !/inputUploadConfig|targetAttachmentChannel|attachmentChannel/.test(factorySource)) continue;
        const exports = dolaSafeWebpackModule(runtime, moduleId);
        const hit = inspectExports(exports, moduleId, "factory");
        if (hit) {
          dolaConfiguredPipelineRunner = hit;
          return hit;
        }
      }
    } catch {
      // A route transition can replace the module table while it is being inspected.
    }
    return null;
  }

  async function dolaWaitForConfiguredPipeline(runtime, inputUploadConfig) {
    const deadline = Date.now() + DOLA_PIPELINE_READY_TIMEOUT_MS;
    let pipelineConfig = null;
    let lastConfigError = null;
    do {
      if (!pipelineConfig) {
        try {
          const nextConfig = await inputUploadConfig?.uploadPipelineConfig?.();
          if (nextConfig && typeof nextConfig === "object") pipelineConfig = nextConfig;
          lastConfigError = null;
        } catch (error) {
          lastConfigError = error;
        }
      }
      const runner = dolaFindConfiguredPipelineRunner(runtime);
      if (pipelineConfig && runner?.runPipeline) return { pipelineConfig, ...runner };
      dolaHookUploadChunk();
      await dolaWait(250);
    } while (Date.now() < deadline);

    const detail = lastConfigError?.message || lastConfigError || "";
    const error = new Error(detail
      ? `Dola 配置化上传管线尚未加载：${detail}`
      : "Dola 配置化上传管线尚未加载");
    error.code = DOLA_PIPELINE_UNAVAILABLE_CODE;
    throw error;
  }

  function dolaPatchUploadConfig(config) {
    if (!config || typeof config !== "object") return false;
    config.acceptedAttachmentTypes = ["image", "video", "audio"];
    config.acceptedFileExtensions = ["jpg", "jpeg", "png", "webp", "apng", "mp4", "mov", "mp3", "wav"];
    config.maxCount = 50;
    config.addAttachmentType = ({ file } = {}) => dolaMaterialKind(file) || "file";
    config.isReusableAttachment = attachment => ["image", "video", "audio"].includes(attachment?.type);
    return true;
  }

  function dolaWrapUploadFactory(modules) {
    const factory = modules?.[DOLA_VIDEO_UPLOAD_MODULE_ID];
    if (typeof factory !== "function" || factory[DOLA_MEDIA_PATCH_MARK]) return false;
    const wrapped = function (...args) {
      const result = factory.apply(this, args);
      try {
        dolaPatchUploadConfig(args[1]?.videoUploadPipelineConfig);
      } catch {
        // The page can create the upload config lazily.
      }
      return result;
    };
    wrapped[DOLA_MEDIA_PATCH_MARK] = true;
    modules[DOLA_VIDEO_UPLOAD_MODULE_ID] = wrapped;
    return true;
  }

  function dolaHookUploadChunk() {
    const chunks = window.__LOADABLE_LOADED_CHUNKS__;
    if (!Array.isArray(chunks)) return false;
    if (!chunks[DOLA_MEDIA_PATCH_MARK]) {
      const originalPush = chunks.push;
      chunks.push = function (...entries) {
        for (const entry of entries) dolaWrapUploadFactory(entry?.[1]);
        return originalPush.apply(this, entries);
      };
      chunks[DOLA_MEDIA_PATCH_MARK] = true;
    }
    try {
      const runtime = dolaGetWebpackRequire();
      dolaWrapUploadFactory(runtime?.m);
    } catch {
      return false;
    }
    return true;
  }

  function dolaEnhanceMediaSupport() {
    if (!/2\.5|seedance[^\d]*2[^\d]*5/i.test(selectedModelText())) return false;
    let patched = false;
    try {
      dolaHookUploadChunk();
      const runtime = dolaGetWebpackRequire();
      const config = runtime?.m?.[DOLA_VIDEO_UPLOAD_MODULE_ID]
        ? runtime(DOLA_VIDEO_UPLOAD_MODULE_ID)?.videoUploadPipelineConfig
        : null;
      if (dolaPatchUploadConfig(config)) patched = true;
    } catch {
      // Runtime modules may not be loaded on the first idle tick.
    }
    try {
      for (const input of Array.from(document.querySelectorAll?.('input[type="file"]') || [])) {
        if (input.closest?.("#watermark-free-media-panel")) continue;
        const accept = String(input.accept || input.getAttribute?.("accept") || "");
        if (!/jpe?g|png|webp|image/i.test(accept)) continue;
        input.setAttribute("accept", DOLA_MEDIA_ACCEPT);
        input.multiple = true;
        patched = true;
      }
    } catch {
      // A page-owned file input can disappear during a route transition.
    }
    return patched;
  }

  function dolaFindInputProps() {
    const inputs = Array.from(document.querySelectorAll?.('input[type="file"]') || [])
      .filter(node => !node.closest?.("#watermark-free-media-panel"))
      .sort((left, right) => Number(right.matches?.('[data-testid="upload-file-input"]')) - Number(left.matches?.('[data-testid="upload-file-input"]')));
    for (const input of inputs) {
      const key = Object.keys(input).find(name => name.startsWith("__reactFiber$"));
      let fiber = key ? input[key] : null;
      for (let index = 0; fiber && index < 10; index += 1, fiber = fiber.return) {
        const props = fiber.memoizedProps || {};
        if (props.chatId && props.skill && props.inputUploadConfig) return props;
      }
    }
    return null;
  }

  function dolaFindOfficialVideoInput() {
    const inputs = Array.from(document.querySelectorAll?.('input[type="file"]') || [])
      .filter(node => !node.closest?.("#watermark-free-media-panel"))
      .sort((left, right) => Number(right.matches?.('[data-testid="upload-file-input"]')) - Number(left.matches?.('[data-testid="upload-file-input"]')));
    for (const input of inputs) {
      const key = Object.keys(input).find(name => name.startsWith("__reactFiber$"));
      const fiber = key ? input[key] : null;
      const props = fiber?.memoizedProps || {};
      if (typeof props.onChange === "function" && (input.matches?.('[data-testid="upload-file-input"]') || /audio|video|mp4|mov/i.test(String(input.accept || "")))) {
        return { input, props };
      }
    }
    return null;
  }

  function dolaPreprocessErrorSummary(phase, args) {
    const summary = { phase: String(phase || "error"), message: "", code: "", status: "", keys: [] };
    const codeKeys = ["code", "errorCode", "error_code", "err_code", "status_code", "statusCode", "ret"];
    const messageKeys = ["message", "msg", "errorMessage", "error_message", "reason", "detail"];
    const visit = (value, depth = 0) => {
      if (value == null || depth > 2) return;
      if (typeof value === "string") {
        if (!summary.message && value.trim()) summary.message = value.trim().slice(0, 240);
        return;
      }
      if (typeof value === "number" || typeof value === "boolean") {
        if (!summary.message) summary.message = String(value).slice(0, 120);
        return;
      }
      if (typeof value !== "object") return;
      for (const key of codeKeys) {
        if (!summary.code && (typeof value[key] === "string" || typeof value[key] === "number")) summary.code = String(value[key]).slice(0, 100);
      }
      for (const key of messageKeys) {
        if (!summary.message && typeof value[key] === "string" && value[key].trim()) summary.message = value[key].trim().slice(0, 240);
      }
      if (!summary.status && (typeof value.status === "string" || typeof value.status === "number")) summary.status = String(value.status).slice(0, 80);
      if (!summary.keys.length) {
        try { summary.keys = Reflect.ownKeys(value).filter(key => typeof key === "string").slice(0, 24); } catch { /* opaque error */ }
      }
      for (const key of ["error", "cause", "errorOption", "data", "detail"]) visit(value[key], depth + 1);
    };
    for (const arg of Array.isArray(args) ? args : [args]) visit(arg);
    return summary;
  }

  function dolaInstallPreprocessProbe(service) {
    if (!service) return false;
    let initInstalled = Boolean(service.initUploader?.__WATERMARK_FREE_AUDIO_PROBED__);
    if (typeof service.initUploader === "function" && !initInstalled) {
      const originalInit = service.initUploader;
      const wrappedInit = async function (options) {
        try {
          const media = options?.mediaUploaderOptions || {};
          window.__WATERMARK_FREE_AUDIO_UPLOADER_CONFIG__ = {
            scene: String(media.scene || media.resourcePrepareUploadParams?.scene_id || ""),
            tenantId: String(media.resourcePrepareUploadParams?.tenant_id || ""),
            resourceType: String(media.resourcePrepareUploadParams?.resource_type || media.resourceType || media.resource_type || ""),
            mode: media.useResourcePrepareUpload === false ? "standard-vod-token" : "resource-prepare"
          };
        } catch { /* diagnostic-only */ }
        return originalInit.apply(this, arguments);
      };
      wrappedInit.__WATERMARK_FREE_AUDIO_PROBED__ = true;
      wrappedInit.__WATERMARK_FREE_AUDIO_ORIGINAL__ = originalInit;
      try {
        service.initUploader = wrappedInit;
        initInstalled = service.initUploader === wrappedInit;
      } catch {
        initInstalled = false;
      }
    }
    if (typeof service.preprocessFile !== "function") return initInstalled;
    if (service.preprocessFile.__WATERMARK_FREE_AUDIO_PROBED__) return initInstalled;
    const original = service.preprocessFile;
    const wrapped = function (file, type) {
      if (!dolaAudioUploadPending || !["audio", "video"].includes(type)) return original.apply(this, arguments);
      const capture = (phase, args) => {
        const event = {
          ...dolaPreprocessErrorSummary(phase, args),
          fileName: String(file?.name || "").slice(0, 180),
          type: String(type || "")
        };
        dolaAudioPreprocessEvents.push(event);
        if (dolaAudioPreprocessEvents.length > 8) dolaAudioPreprocessEvents.shift();
        dolaAudioPreprocessState = event;
        window.__WATERMARK_FREE_LAST_AUDIO_PREPROCESS__ = event;
      };
      try {
        const result = original.apply(this, arguments);
        if (result && typeof result.catch === "function") result.catch(error => capture("rejection", [error]));
        try {
          dolaAudioPreprocessState = {
            ...(dolaAudioPreprocessState || {}),
            called: true,
            fileName: String(file?.name || "").slice(0, 180),
            type: String(type || ""),
            resultKeys: result && typeof result === "object" ? Reflect.ownKeys(result).filter(key => typeof key === "string").slice(0, 24) : []
          };
          window.__WATERMARK_FREE_LAST_AUDIO_PREPROCESS__ = dolaAudioPreprocessState;
        } catch { /* diagnostics must not change upload behavior */ }
        return result;
      } catch (error) {
        capture("throw", [error]);
        throw error;
      }
    };
    wrapped.__WATERMARK_FREE_AUDIO_PROBED__ = true;
    wrapped.__WATERMARK_FREE_AUDIO_ORIGINAL__ = original;
    try {
      service.preprocessFile = wrapped;
      return initInstalled || service.preprocessFile === wrapped;
    } catch {
      return false;
    }
  }

  function dolaInstallMediaUploaderProbe(runtime) {
    let uploader = null;
    try {
      uploader = runtime(16889)?.GX?.("attachmentUploadStore")?.mediaUploader;
    } catch {
      return false;
    }
    if (typeof uploader?.upload !== "function") return false;
    if (uploader.upload.__WATERMARK_FREE_AUDIO_PROBED__) return true;
    const original = uploader.upload;
    const capture = (phase, file, payload) => {
      const summary = dolaPreprocessErrorSummary(phase, [payload]);
      const extra = payload?.extra || {};
      const detail = extra.error?.message || extra.error || "";
      const response = payload?.res || extra.res || {};
      const request = payload?.req || extra.req || {};
      let endpoint = String(request?.url || "").slice(0, 300);
      try {
        const parsed = new URL(endpoint, location.href);
        endpoint = `${parsed.origin}${parsed.pathname}`;
      } catch {
        endpoint = endpoint.split("?")[0];
      }
      let responseShape = "";
      try {
        const body = typeof response?.body === "string" ? response.body : "";
        const parsed = body ? JSON.parse(body) : null;
        if (parsed && typeof parsed === "object") {
          const result = parsed.Result && typeof parsed.Result === "object" ? parsed.Result : null;
          const inner = result?.InnerUploadAddress && typeof result.InnerUploadAddress === "object"
            ? result.InnerUploadAddress
            : null;
          responseShape = [
            `root=${Object.keys(parsed).slice(0, 12).join(",")}`,
            result ? `result=${Object.keys(result).slice(0, 12).join(",")}` : "",
            inner ? `inner=${Object.keys(inner).slice(0, 12).join(",")}` : ""
          ].filter(Boolean).join(";").slice(0, 360);
        } else if (body) {
          responseShape = "non-object-json";
        }
      } catch {
        responseShape = response?.body ? "non-json" : "";
      }
      const event = {
        ...summary,
        phase,
        fileName: String(file?.name || "").slice(0, 180),
        stage: String(payload?.stage || "").slice(0, 100),
        status: String(payload?.status ?? summary.status ?? "").slice(0, 80),
        code: String(extra.errorCode ?? payload?.errorCode ?? summary.code ?? "").slice(0, 100),
        message: String(extra.message || detail || summary.message || "").slice(0, 240),
        detail: String(detail || "").slice(0, 360),
        responseStatus: Number(response?.status || 0),
        endpoint,
        responseShape
      };
      dolaAudioPreprocessEvents.push(event);
      if (dolaAudioPreprocessEvents.length > 8) dolaAudioPreprocessEvents.shift();
      dolaAudioPreprocessState = event;
      window.__WATERMARK_FREE_LAST_AUDIO_PREPROCESS__ = event;
    };
    const wrapped = function (file, callbacks, options) {
      const originalError = callbacks?.error;
      const wrappedCallbacks = callbacks && typeof callbacks === "object"
        ? {
            ...callbacks,
            error(payload) {
              capture("uploader-error", file, payload);
              return originalError?.apply(this, arguments);
            }
          }
        : callbacks;
      try {
        return original.call(this, file, wrappedCallbacks, options);
      } catch (error) {
        capture("uploader-throw", file, error);
        throw error;
      }
    };
    wrapped.__WATERMARK_FREE_AUDIO_PROBED__ = true;
    wrapped.__WATERMARK_FREE_AUDIO_ORIGINAL__ = original;
    try {
      uploader.upload = wrapped;
      return uploader.upload === wrapped;
    } catch {
      return false;
    }
  }

  function dolaBotId(runtime, chatId) {
    try {
      return runtime(372595)?.S?.(chatId, true)
        || runtime(29155)?.IO?.(runtime(986344)?.NW?.getState?.())
        || "";
    } catch {
      return "";
    }
  }

  function dolaReadMediaDuration(file, kind = "audio") {
    return new Promise(resolve => {
      const url = URL.createObjectURL(file);
      const media = document.createElement(kind === "video" ? "video" : "audio");
      let settled = false;
      const finish = duration => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        const value = Number.isFinite(duration) && duration > 0 ? duration : 0;
        resolve({ duration: value, unreadable: !value });
      };
      const timer = window.setTimeout(() => finish(0), 3500);
      media.preload = "metadata";
      media.onloadedmetadata = () => {
        window.clearTimeout(timer);
        finish(media.duration);
      };
      media.onerror = () => {
        window.clearTimeout(timer);
        finish(0);
      };
      media.src = url;
    });
  }

  function dolaWriteAscii(view, offset, text) {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  }

  function dolaEncodePcm16Wav(audioBuffer) {
    const channelCount = Math.max(1, Math.min(2, Number(audioBuffer.numberOfChannels || 1)));
    const frameCount = Number(audioBuffer.length || 0);
    const sampleRate = Number(audioBuffer.sampleRate || 44100);
    const dataSize = frameCount * channelCount * 2;
    const output = new ArrayBuffer(44 + dataSize);
    const view = new DataView(output);
    dolaWriteAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    dolaWriteAscii(view, 8, "WAVE");
    dolaWriteAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channelCount, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channelCount * 2, true);
    view.setUint16(32, channelCount * 2, true);
    view.setUint16(34, 16, true);
    dolaWriteAscii(view, 36, "data");
    view.setUint32(40, dataSize, true);
    const channels = Array.from({ length: channelCount }, (_, index) => audioBuffer.getChannelData(index));
    let offset = 44;
    for (let frame = 0; frame < frameCount; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        const sample = Math.max(-1, Math.min(1, Number(channels[channel][frame] || 0)));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
    return output;
  }

  async function dolaPrepareCompatibleAudioFile(file) {
    dolaAudioCompatibilityState = {
      attempted: false,
      converted: false,
      sourceName: String(file?.name || ""),
      sourceSize: Number(file?.size || 0),
      sourceType: String(file?.type || "")
    };
    window.__WATERMARK_FREE_LAST_AUDIO_COMPATIBILITY__ = dolaAudioCompatibilityState;
    try {
      const name = String(file?.name || "");
      const type = String(file?.type || "").toLowerCase();
      const isMp3 = /\.mp3$/i.test(name) || type === "audio/mpeg" || type === "audio/mp3";
      if (!isMp3 || Number(file?.size || 0) > 5 * 1024 * 1024) return file;
      const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
      const hasId3 = head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33;
      if (hasId3) return file;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (typeof AudioContextClass !== "function") return file;
      dolaAudioCompatibilityState = { ...dolaAudioCompatibilityState, attempted: true, reason: "raw_mp3_without_id3" };
      window.__WATERMARK_FREE_LAST_AUDIO_COMPATIBILITY__ = dolaAudioCompatibilityState;
      const context = new AudioContextClass();
      let decoded;
      try {
        decoded = await context.decodeAudioData(await file.arrayBuffer());
      } finally {
        try { await context.close(); } catch { /* best-effort cleanup */ }
      }
      const estimatedSize = 44 + Number(decoded.length || 0) * Math.min(2, Number(decoded.numberOfChannels || 1)) * 2;
      if (!decoded.length || estimatedSize > 32 * 1024 * 1024) return file;
      const wav = dolaEncodePcm16Wav(decoded);
      const compatibleName = name.replace(/\.mp3$/i, "") + "-compat.wav";
      const compatibleFile = new File([wav], compatibleName, {
        type: "audio/wav",
        lastModified: Number(file.lastModified || Date.now())
      });
      dolaAudioCompatibilityState = {
        ...dolaAudioCompatibilityState,
        converted: true,
        outputName: compatibleFile.name,
        outputSize: compatibleFile.size,
        outputType: compatibleFile.type,
        duration: Number(decoded.duration || 0),
        sampleRate: Number(decoded.sampleRate || 0),
        channels: Number(decoded.numberOfChannels || 0)
      };
      window.__WATERMARK_FREE_LAST_AUDIO_COMPATIBILITY__ = dolaAudioCompatibilityState;
      return compatibleFile;
    } catch (error) {
      dolaAudioCompatibilityState = {
        ...dolaAudioCompatibilityState,
        attempted: true,
        converted: false,
        message: String(error?.message || error || "audio compatibility conversion failed").slice(0, 240)
      };
      window.__WATERMARK_FREE_LAST_AUDIO_COMPATIBILITY__ = dolaAudioCompatibilityState;
      return file;
    }
  }

  async function dolaInitMediaUploader(runtime, kind = "audio") {
    const service = await runtime(431565)?.D?.("attachmentUploadStoreService");
    const mediaConfig = runtime(607159);
    const base = mediaConfig?.tV;
    const scene = kind === "video" ? mediaConfig?.eq : mediaConfig?.Ew;
    if (!service?.initUploader || !base || !scene) return;
    const mediaUploaderOptions = {
      ...base,
      scene,
      resourcePrepareUploadParams: {
        ...(base.resourcePrepareUploadParams || {}),
        scene_id: scene
      }
    };
    await service.initUploader({ mediaUploaderOptions });
    window.__WATERMARK_FREE_AUDIO_UPLOADER_CONFIG__ = {
      scene: String(scene),
      tenantId: String(base.resourcePrepareUploadParams?.tenant_id || ""),
      resourceType: String(base.resourcePrepareUploadParams?.resource_type || base.resourceType || base.resource_type || ""),
      mode: "resource-prepare"
    };
    dolaInstallMediaUploaderProbe(runtime);
  }

  function dolaReferenceStats(runtime, chatId) {
    const stats = {
      imageCount: 0,
      videoCount: 0,
      audioCount: 0,
      videoTotalDuration: 0,
      audioTotalDuration: 0
    };
    try {
      const attachmentsStore = runtime(16889)?.GX?.("attachmentsStore");
      const uploadStore = runtime(16889)?.GX?.("attachmentUploadStore");
      const attachments = attachmentsStore?.attachmentsMap?.[chatId]?.[`_${VIDEO_ABILITY_TYPE}`] || [];
      const taskMap = uploadStore?.preprocessTaskMap || {};
      for (const attachment of attachments) {
        const kind = attachment?.type;
        if (!Object.prototype.hasOwnProperty.call({ image: 1, video: 1, audio: 1 }, kind)) continue;
        stats[`${kind}Count`] += 1;
        if (kind !== "video" && kind !== "audio") continue;
        const task = taskMap[attachment?.localKey] || {};
        const duration = Number(
          attachment?.mediaDuration
          || task?.uploadResult?.VideoMeta?.Duration
          || task?.ctx?.extraParams?.duration_seconds
          || 0
        );
        if (Number.isFinite(duration) && duration > 0) stats[`${kind}TotalDuration`] += duration;
      }
    } catch {
      // Missing model stats must not prevent the uploader from reporting its own validation error.
    }
    return stats;
  }

  function dolaFormatSeconds(value) {
    const seconds = Number(value || 0);
    if (!Number.isFinite(seconds) || seconds <= 0) return "未知";
    return seconds >= 60
      ? `${Math.floor(seconds / 60)}分${Math.round(seconds % 60)}秒`
      : `${Math.round(seconds * 10) / 10}秒`;
  }

  function dolaMediaRuleError(runtime, chatId, file, mediaMeta, kind = "audio") {
    try {
      const modelKey = runtime(704975)?.YC?.("video-model") || "";
      const helpers = runtime(112573);
      const config = helpers?.kc?.(modelKey);
      const rules = config?.model_input_rule;
      if (!modelKey || !Array.isArray(rules) || !rules.length) return null;
      const support = helpers?.Jz?.(modelKey);
      if (support && support[kind] === false) {
        return new Error(`当前模型 ${modelKey} 不支持${kind === "video" ? "视频" : "音频"}参考`);
      }
      const rejection = helpers?.dC?.({
        kind,
        durationSeconds: Number(mediaMeta?.duration || 0),
        durationUnreadable: Boolean(mediaMeta?.unreadable)
      }, dolaReferenceStats(runtime, chatId), config);
      if (!rejection) return null;
      const duration = dolaFormatSeconds(mediaMeta?.duration);
      const limit = Number(rejection.limit);
      const label = kind === "video" ? "视频" : "音频";
      let message = `${file.name} 不符合当前模型的${label}参考限制`;
      if (["exceed_audio_duration", "exceed_video_duration", "exceed_mixed_duration"].includes(rejection.code) && Number.isFinite(limit)) {
        message = `${file.name} 时长 ${duration}，当前模型参考素材总时长最多 ${dolaFormatSeconds(limit)}`;
      } else if (["exceed_audio_count", "exceed_video_count", "exceed_mixed_count"].includes(rejection.code) && Number.isFinite(limit)) {
        message = `${file.name} 无法加入，当前模型参考素材最多 ${limit} 个`;
      }
      const error = new Error(message);
      error.diagnostic = { stage: "model_rule", kind, modelKey, code: rejection.code || "rejected", limit, duration: mediaMeta?.duration || 0 };
      return error;
    } catch {
      return null;
    }
  }

  function dolaTaskErrorText(task) {
    const values = [
      task?.errorMessage,
      task?.failReason,
      task?.reason,
      task?.message,
      task?.error?.message,
      task?.error?.errorOption?.message,
      task?.uploadError?.message,
      task?.err?.message
    ];
    const text = values.find(value => typeof value === "string" && value.trim());
    if (text) return text.trim().slice(0, 240);
    const scan = (value, depth = 0, seen = new WeakSet()) => {
      if (!value || typeof value !== "object" || depth > 3 || seen.has(value)) return "";
      seen.add(value);
      for (const key of ["error", "errorOption", "uploadError", "response", "result", "data", "detail"]) {
        const nested = value[key];
        if (!nested) continue;
        if (typeof nested === "string" && nested.trim()) return nested.trim().slice(0, 240);
        const found = scan(nested, depth + 1, seen);
        if (found) return found;
      }
      return "";
    };
    return scan(task);
  }

  function dolaTaskSafeFields(task) {
    const fields = {};
    if (!task || typeof task !== "object") return fields;
    for (const [key, value] of Object.entries(task)) {
      if (!/(error|err|fail|reason|message|status|code|ret)/i.test(key)) continue;
      if (["string", "number", "boolean"].includes(typeof value)) fields[key] = String(value).slice(0, 160);
    }
    return fields;
  }

  function dolaTaskSafeSnapshot(value, depth = 0, seen = new WeakSet()) {
    if (value == null || ["string", "number", "boolean"].includes(typeof value)) return typeof value === "string" ? value.slice(0, 240) : value;
    if (typeof value !== "object" || depth > 3 || seen.has(value)) return undefined;
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 8).map(item => dolaTaskSafeSnapshot(item, depth + 1, seen));
    const output = {};
    let keys = [];
    try { keys = Reflect.ownKeys(value).filter(key => typeof key === "string"); } catch { return output; }
    for (const key of keys.slice(0, 40)) {
      if (/file|token|secret|cookie|header|body|blob|arraybuffer/i.test(key)) continue;
      if (!/(error|err|fail|reason|message|status|code|ret|response|result|data|detail|ctx|option|stage|local|upload)/i.test(key)) continue;
      try {
        const item = dolaTaskSafeSnapshot(value[key], depth + 1, seen);
        if (item !== undefined) output[key] = item;
      } catch { /* opaque task property */ }
    }
    return output;
  }

  function dolaNetworkFailure(events) {
    return [...(events || [])].reverse().find(event => {
      if (!event) return false;
      if (!event.status || event.status >= 400) return true;
      const code = String(event.code || "").toLowerCase();
      return Boolean(code && !["0", "200", "ok", "success"].includes(code));
    }) || null;
  }

  function dolaUploadDiagnostic(file, attachment, task, stage = "upload", kind = "audio") {
    const diagnostic = {
      stage,
      kind,
      fileName: file?.name || "",
      fileSize: Number(file?.size || 0),
      mimeType: file?.type || "",
      localKey: attachment?.localKey || "",
      loading: Boolean(task?.loading),
      failed: Boolean(task?.failed),
      percent: Number.isFinite(Number(task?.percent)) ? Number(task.percent) : null,
      hasKey: Boolean(dolaReferenceUploadKey(attachment, task)),
      code: task?.errorCode || task?.code || task?.status || task?.error?.errorOption?.code || "",
      message: dolaTaskErrorText(task),
      taskFields: dolaTaskSafeFields(task),
      taskSnapshot: dolaTaskSafeSnapshot(task),
      preprocess: dolaAudioPreprocessState || window.__WATERMARK_FREE_LAST_AUDIO_PREPROCESS__ || null,
      preprocessEvents: dolaAudioPreprocessEvents.slice(-6),
      compatibility: dolaAudioCompatibilityState || window.__WATERMARK_FREE_LAST_AUDIO_COMPATIBILITY__ || null,
      pipeline: dolaAudioPipelineState || window.__WATERMARK_FREE_LAST_AUDIO_PIPELINE__ || null,
      native: window.__WATERMARK_FREE_LAST_AUDIO_NATIVE__ || null,
      uploader: window.__WATERMARK_FREE_AUDIO_UPLOADER_CONFIG__ || null,
      fallback: window.__WATERMARK_FREE_LAST_AUDIO_FALLBACK__ || null,
      fileRehydrated: Boolean(window.__WATERMARK_FREE_AUDIO_FILE_BRIDGE__?.rehydrated),
      network: dolaAudioNetworkEvents.slice(-6)
    };
    window.__WATERMARK_FREE_LAST_AUDIO_UPLOAD__ = diagnostic;
    return diagnostic;
  }

  async function dolaRemoveFailedMediaDuplicate(runtime, chatId, file, kind = "audio") {
    try {
      const attachmentsStore = runtime(16889)?.GX?.("attachmentsStore");
      const uploadStore = runtime(16889)?.GX?.("attachmentUploadStore");
      const attachments = attachmentsStore?.attachmentsMap?.[chatId]?.[`_${VIDEO_ABILITY_TYPE}`] || [];
      const taskMap = uploadStore?.preprocessTaskMap || {};
      const indexes = [];
      attachments.forEach((attachment, index) => {
        const name = attachment?.fileName || attachment?.file?.name || "";
        if (attachment?.type === kind && (!name || name === file.name) && taskMap[attachment?.localKey]?.failed) indexes.push(index);
      });
      if (!indexes.length) return;
      const service = await runtime(431565)?.D?.("attachmentsStoreService");
      for (const index of indexes.reverse()) {
        await service?.deleteAttachment?.({ chatId, skillType: VIDEO_ABILITY_TYPE, index });
      }
      await dolaWait(50);
    } catch {
      // A stale failed row is harmless when the page has already removed it.
    }
  }

  async function dolaAddAudioAttachment(runtime, props, file, mediaMeta) {
    const service = await runtime(431565)?.D?.("attachmentsStoreService");
    if (typeof service?.addAttachment !== "function") throw new Error("Dola 音频附件服务尚未加载，请刷新页面后重试");
    await dolaInitMediaUploader(runtime, "audio");
    await service.addAttachment({
      chatId: props.chatId,
      skillType: VIDEO_ABILITY_TYPE,
      file,
      type: "audio",
      disablePreprocess: false,
      ctx: dolaBuildAttachmentCtx({
        skill: props.skill,
        chatId: props.chatId,
        runtime,
        mediaMeta
      })
    });
  }

  async function dolaPrepareAudioUploadProbe(runtime) {
    try {
      const service = await runtime(431565)?.D?.("attachmentUploadStoreService");
      dolaInstallPreprocessProbe(service);
      return service;
    } catch {
      return null;
    }
  }

  async function dolaRunConfiguredMediaPipeline(runtime, props, file, mediaMeta, kind = "audio") {
    const inputUploadConfig = props?.inputUploadConfig || {};
    let resolved;
    try {
      resolved = await dolaWaitForConfiguredPipeline(runtime, inputUploadConfig);
    } catch (error) {
      dolaAudioPipelineState = {
        attempted: true,
        stage: "runtime-wait",
        message: String(error?.message || error || "").slice(0, 240)
      };
      throw error;
    }
    const { pipelineConfig, runPipeline, moduleId, source: runnerSource } = resolved;
    await dolaInitMediaUploader(runtime, kind);
    dolaPatchUploadConfig(pipelineConfig);
    const buildAttachmentCtx = ({ file: currentFile, skill, uploadCollectionId: collectionId }) => ({
      conversationId: props.chatId || "",
      chatType: "other_default",
      skillType: Number(skill?.skill_type || VIDEO_ABILITY_TYPE),
      skillId: String(skill?.skill_type || VIDEO_ABILITY_TYPE),
      botId: dolaBotId(runtime, props.chatId),
      from: "",
      uploadCollectionWay: "single",
      uploadId: "",
      uploadWay: "browse_folder",
      uploadFrom: "video_generation",
      uploadCollectionId: collectionId,
      uploadType: String(currentFile?.type || ""),
      extraParams: {
        ...(Number(mediaMeta?.duration) > 0 ? { duration_seconds: String(mediaMeta.duration) } : {}),
        ...(mediaMeta?.unreadable ? { duration_unreadable: "1" } : {})
      }
    });
    dolaAudioPipelineState = {
      attempted: true,
      stage: "dispatch",
      runtime: true,
      kind,
      moduleId: String(moduleId || ""),
      runnerSource: String(runnerSource || ""),
      uploaderMode: "resource-prepare",
      configKeys: Object.keys(pipelineConfig).filter(key => !/token|secret|auth|cookie/i.test(key)).slice(0, 32)
    };
    window.__WATERMARK_FREE_LAST_AUDIO_PIPELINE__ = dolaAudioPipelineState;
    await runPipeline({
      inputUploadConfig,
      trigger: "click",
      chatId: props.chatId,
      chatType: props.chatType,
      skill: props.skill,
      reportParams: props.reportParams,
      files: [file],
      inputConfigKey: props.inputConfigKey,
      attachmentChannel: VIDEO_ABILITY_TYPE,
      targetAttachmentChannel: VIDEO_ABILITY_TYPE,
      uploadPipelineConfig: {
        ...pipelineConfig,
        buildAttachmentCtx
      }
    });
    dolaAudioPipelineState = { ...dolaAudioPipelineState, returned: true };
    window.__WATERMARK_FREE_LAST_AUDIO_PIPELINE__ = dolaAudioPipelineState;
  }

  async function dolaDispatchOfficialAudio(file) {
    const target = dolaFindOfficialVideoInput();
    if (!target) return false;
    const { input, props } = target;
    try {
      const onChange = props?.onChange;
      if (typeof onChange !== "function") return false;
      input.accept = DOLA_MEDIA_ACCEPT;
      input.multiple = true;
      const transfer = new DataTransfer();
      transfer.items.add(file);
      try {
        input.files = transfer.files;
      } catch {
        try { Object.defineProperty(input, "files", { configurable: true, value: transfer.files }); } catch { /* dataTransfer remains available */ }
      }
      const event = {
        dataTransfer: transfer,
        target: input,
        currentTarget: input,
        nativeEvent: new Event("change", { bubbles: true, cancelable: true }),
        bubbles: true,
        stopPropagation() {},
        preventDefault() {}
      };
      const result = onChange.call(input, event);
      if (result && typeof result.catch === "function") result.catch(error => {
        window.__WATERMARK_FREE_LAST_AUDIO_NATIVE__ = {
          dispatched: true,
          rejected: true,
          message: String(error?.message || error || "").slice(0, 240)
        };
      });
      window.__WATERMARK_FREE_LAST_AUDIO_NATIVE__ = {
        dispatched: true,
        testId: input.getAttribute?.("data-testid") || "",
        accept: String(input.accept || "").slice(0, 240),
        handler: true
      };
      return true;
    } catch (error) {
      window.__WATERMARK_FREE_LAST_AUDIO_NATIVE__ = {
        dispatched: false,
        message: String(error?.message || error || "").slice(0, 240)
      };
      return false;
    }
  }

  function dolaIsPipelineUnavailable(error) {
    return error?.code === DOLA_PIPELINE_UNAVAILABLE_CODE
      || /配置化上传管线尚未加载|媒体上传配置尚未加载/.test(String(error?.message || ""));
  }

  async function dolaCreatePageFile(sourceFile) {
    try {
      const bytes = await sourceFile.arrayBuffer();
      const file = new File([bytes], String(sourceFile.name || "audio.mp3"), {
        type: String(sourceFile.type || "audio/mpeg"),
        lastModified: Number(sourceFile.lastModified || Date.now())
      });
      if (file.size !== Number(sourceFile.size || 0)) throw new Error("文件字节数在跨世界复制后不一致");
      window.__WATERMARK_FREE_AUDIO_FILE_BRIDGE__ = {
        rehydrated: true,
        sourceConstructor: sourceFile?.constructor?.name || "",
        pageConstructor: file.constructor?.name || "",
        pageFileInstance: file instanceof File,
        size: file.size,
        type: file.type
      };
      return file;
    } catch (error) {
      const failure = new Error(`无法在页面环境读取媒体文件：${error?.message || "File bridge failed"}`);
      failure.diagnostic = { stage: "file_bridge", message: error?.message || "", fileName: sourceFile?.name || "" };
      throw failure;
    }
  }

  function dolaBuildAttachmentCtx({ skill, chatId, runtime, mediaMeta }) {
    const skillType = Number(skill?.skill_type || VIDEO_ABILITY_TYPE);
    const duration = Number(mediaMeta?.duration || 0);
    return {
      conversationId: chatId || "",
      chatType: "other_default",
      skillType,
      skillId: String(skillType),
      botId: dolaBotId(runtime, chatId),
      from: "",
      uploadCollectionWay: "single",
      uploadId: "",
      uploadWay: "browse_folder",
      uploadFrom: "video_generation",
      extraParams: {
        ...(duration > 0 ? { duration_seconds: String(duration) } : {}),
        ...(mediaMeta?.unreadable ? { duration_unreadable: "1" } : {})
      }
    };
  }

  const dolaWait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function dolaReferenceUploadKey(attachment, task) {
    const uploadResult = task?.uploadResult || {};
    const candidates = [
      attachment?.key,
      attachment?.fileKey,
      attachment?.uploadKey,
      attachment?.mediaKey,
      attachment?.resourceKey,
      task?.key,
      task?.fileKey,
      task?.uploadKey,
      task?.mediaKey,
      task?.resourceKey,
      uploadResult?.key,
      uploadResult?.Key,
      uploadResult?.fileKey,
      uploadResult?.FileKey,
      uploadResult?.tosKey,
      uploadResult?.TosKey,
      uploadResult?.storeUri,
      uploadResult?.StoreUri
    ];
    return candidates.find(value => typeof value === "string" && value.trim()) || "";
  }

  function dolaReferenceAttachments(runtime, preferredChatId = "") {
    try {
      const stores = runtime(16889);
      const attachmentsStore = stores?.GX?.("attachmentsStore");
      const attachmentsMap = attachmentsStore?.attachmentsMap || {};
      const currentChatId = stores?.GX?.("chatViewCoreStore")?.currentChatViewConfig?.chatId || "";
      const groups = [];
      const preferredIds = Array.from(new Set([preferredChatId, currentChatId].filter(Boolean)));
      for (const chatId of preferredIds) {
        const chatGroup = attachmentsMap?.[chatId];
        if (chatGroup && typeof chatGroup === "object") groups.push(chatGroup);
      }
      // Dola has changed the chat/channel indexing more than once. Search the
      // remaining map as a compatibility fallback; beforeLocalKeys prevents an
      // older card from being mistaken for the file dispatched in this request.
      for (const chatGroup of Object.values(attachmentsMap)) {
        if (chatGroup && typeof chatGroup === "object" && !groups.includes(chatGroup)) groups.push(chatGroup);
      }
      const attachments = [];
      for (const group of groups) {
        if (Array.isArray(group)) attachments.push(...group);
        else for (const value of Object.values(group)) if (Array.isArray(value)) attachments.push(...value);
      }
      if (Array.isArray(attachmentsStore?.attachments)) attachments.push(...attachmentsStore.attachments);
      return Array.from(new Set(attachments.filter(item => item && typeof item === "object")));
    } catch {
      return [];
    }
  }

  async function dolaWaitForReferenceUpload(runtime, chatId, beforeLocalKeys, file, kind = "audio") {
    const deadline = Date.now() + DOLA_ATTACHMENT_BIND_TIMEOUT_MS;
    let failedSince = 0;
    let boundSince = 0;
    let lastDiagnostic = null;
    while (Date.now() < deadline) {
      const uploadStore = runtime(16889)?.GX?.("attachmentUploadStore");
      const attachments = dolaReferenceAttachments(runtime, chatId);
      const attachment = attachments.find(item => {
        if (beforeLocalKeys.has(item?.localKey || "")) return false;
        const name = item?.fileName || item?.file?.name || "";
        return item?.type === kind && (!name || name === file.name);
      });
      if (attachment) {
        if (!boundSince) boundSince = Date.now();
        const task = uploadStore?.preprocessTaskMap?.[attachment.localKey];
        const key = dolaReferenceUploadKey(attachment, task);
        if (key && !task?.loading && !task?.failed) {
          dolaUploadDiagnostic(file, attachment, task, "complete", kind);
          return { attachment, key, complete: true };
        }
        if (task?.failed) {
          lastDiagnostic = dolaUploadDiagnostic(file, attachment, task, "upload", kind);
          if (!failedSince) failedSince = Date.now();
          if (Date.now() - failedSince >= 1500) {
            const networkFailure = dolaNetworkFailure(lastDiagnostic.network);
            const networkDetail = networkFailure && (networkFailure.message || networkFailure.code || `HTTP ${networkFailure.status} ${networkFailure.endpoint}`);
            const preprocess = lastDiagnostic.preprocess || {};
            const preprocessDetail = [
              preprocess.code ? `[${preprocess.code}]` : "",
              preprocess.message || (preprocess.phase ? `客户端${preprocess.phase}` : ""),
              preprocess.detail && preprocess.detail !== preprocess.message ? `(${preprocess.detail})` : ""
            ].filter(Boolean).join(" ");
            const native = lastDiagnostic.native || {};
            const pipeline = lastDiagnostic.pipeline || {};
            const fallbackDetail = `客户端预处理失败（${[
              preprocess.phase,
              native.dispatched ? "原生上传已触发" : "未触发原生上传",
              pipeline.attempted ? `配置化管线${pipeline.stage || "已尝试"}` : "",
              lastDiagnostic.uploader?.scene ? `scene=${lastDiagnostic.uploader.scene}` : ""
            ].filter(Boolean).join("；") || "task_failed"}）`;
            const taskDetail = [
              lastDiagnostic.code ? `[${lastDiagnostic.code}]` : "",
              lastDiagnostic.message || ""
            ].filter(Boolean).join(" ");
            const detail = taskDetail || preprocessDetail || networkDetail || fallbackDetail;
            const error = new Error(`${file.name} 上传失败：${detail}`);
            error.diagnostic = lastDiagnostic;
            throw error;
          }
        } else {
          failedSince = 0;
          // Dola renders the reference card before the background uploader exposes
          // a remote key. Card creation is the UI hand-off point, so do not keep
          // this extension panel locked behind the old 120-second key poll.
          if (Date.now() - boundSince >= DOLA_ATTACHMENT_SETTLE_MS) {
            dolaUploadDiagnostic(file, attachment, task, "bound", kind);
            return { attachment, key, complete: false };
          }
        }
      }
      await dolaWait(300);
    }
    const preprocessFailure = dolaAudioPreprocessEvents.slice().reverse().find(event =>
      /error|reject|fail/i.test(String(event?.phase || ""))
    );
    const nativeFailure = window.__WATERMARK_FREE_LAST_AUDIO_NATIVE__;
    if (preprocessFailure || nativeFailure?.rejected) {
      const failure = preprocessFailure || nativeFailure;
      const detail = [
        failure?.code ? `[${failure.code}]` : "",
        failure?.message || failure?.detail || failure?.phase || "客户端上传失败"
      ].filter(Boolean).join(" ");
      const error = new Error(`${file.name} 上传失败：${detail}`);
      error.diagnostic = { stage: "dispatch_failure", fileName: file.name, preprocess: preprocessFailure || null, native: nativeFailure || null };
      throw error;
    }
    // A successful configured-pipeline return (or a successfully invoked native
    // onChange handler) means Dola accepted the hand-off. Newer builds may keep
    // the card in React state that is not exposed through the legacy store path.
    // Do not turn that observability gap into an upload failure or a locked panel.
    return { attachment: null, key: "", complete: false, storeObserved: false, dispatched: true };
  }

  function dolaReferenceSnapshot(runtime, preferredChatId = "") {
    try {
      const attachmentsStore = runtime(16889)?.GX?.("attachmentsStore");
      const uploadStore = runtime(16889)?.GX?.("attachmentUploadStore");
      const attachmentsMap = attachmentsStore?.attachmentsMap || {};
      const taskMap = uploadStore?.preprocessTaskMap || {};
      const currentChatId = runtime(16889)?.GX?.("chatViewCoreStore")?.currentChatViewConfig?.chatId || "";
      const chatIds = Array.from(new Set([currentChatId, preferredChatId].filter(Boolean)));
      if (dolaLastReferenceChatId && chatIds.includes(dolaLastReferenceChatId)) chatIds.unshift(dolaLastReferenceChatId);
      let selected = { chatId: preferredChatId || currentChatId, attachments: [] };
      for (const chatId of chatIds) {
        const attachments = attachmentsMap?.[chatId]?.[`_${VIDEO_ABILITY_TYPE}`] || [];
        if (attachments.length) {
          selected = { chatId, attachments };
          break;
        }
      }
      const attachmentKeys = [];
      const attachmentStates = [];
      const counts = { image: 0, video: 0, audio: 0 };
      let pendingMedia = 0;
      for (const attachment of selected.attachments) {
        const kind = attachment?.type;
        if (Object.prototype.hasOwnProperty.call(counts, kind)) counts[kind] += 1;
        const localKey = attachment?.localKey || "";
        const task = localKey ? taskMap[localKey] : null;
        const uploadResult = task?.uploadResult || {};
        const videoMeta = uploadResult.VideoMeta || {};
        const extra = task?.ctx?.extraParams || {};
        const key = dolaReferenceUploadKey(attachment, task);
        if (["video", "audio"].includes(kind) && (!key || task?.loading || task?.failed)) pendingMedia += 1;
        attachmentKeys.push(key || undefined);
        attachmentStates.push({
          type: kind,
          localKey,
          fileKey: key || undefined,
          fileName: attachment?.fileName || attachment?.file?.name || videoMeta.FileName || "",
          size: Number(attachment?.size || attachment?.file?.size || videoMeta.Size || 0),
          md5: attachment?.md5 || task?.md5 || videoMeta.Md5,
          mediaDuration: Number(attachment?.mediaDuration || videoMeta.Duration || extra.duration_seconds || 0),
          mediaResourceUri: attachment?.mediaResourceUri || task?.mediaResourceUri,
          mediaCoverUrl: attachment?.mediaCoverUrl || extra.cover_local_url || task?.blobUrl || "",
          mediaCoverWidth: Number(attachment?.mediaCoverWidth || extra.cover_width || videoMeta.Width || 0),
          mediaCoverHeight: Number(attachment?.mediaCoverHeight || extra.cover_height || videoMeta.Height || 0),
          imageWidth: Number(attachment?.imageWidth || uploadResult.ImageWidth || 0),
          imageHeight: Number(attachment?.imageHeight || uploadResult.ImageHeight || 0),
          url: attachment?.url || task?.blobUrl || "",
          src: attachment?.src || task?.blobUrl || "",
          uploadPercent: Number.isFinite(Number(task?.percent)) ? Number(task.percent) : 100,
          status: task?.failed ? "Retry" : task?.loading ? "Uploading" : "Normal"
        });
      }
      return { ...selected, attachmentKeys, attachmentStates, counts, pendingMedia };
    } catch {
      return {
        chatId: preferredChatId,
        attachments: [],
        attachmentKeys: [],
        attachmentStates: [],
        counts: { image: 0, video: 0, audio: 0 },
        pendingMedia: 0
      };
    }
  }

  function dolaReferenceUploadStatus(kind = "", expectedNames = []) {
    const safeKind = kind === "video" ? "video" : "audio";
    const names = Array.from(new Set((Array.isArray(expectedNames) ? expectedNames : [])
      .map(value => String(value || "").split(/[\\\\/]/).pop().trim().toLowerCase())
      .filter(Boolean)));
    try {
      const runtime = dolaGetWebpackRequire();
      if (typeof runtime !== "function") return { available: false, matchedCount: 0, boundCount: 0, pendingCount: 0, failedCount: 0 };
      const stores = runtime(16889);
      if (!stores?.GX) return { available: false, matchedCount: 0, boundCount: 0, pendingCount: 0, failedCount: 0 };
      const attachmentsStore = stores.GX("attachmentsStore");
      const uploadStore = stores.GX("attachmentUploadStore");
      if (!attachmentsStore && !uploadStore) return { available: false, matchedCount: 0, boundCount: 0, pendingCount: 0, failedCount: 0 };
      const props = dolaFindInputProps();
      const snapshot = dolaReferenceSnapshot(runtime, props?.chatId || dolaLastReferenceChatId || "");
      const states = (snapshot.attachmentStates || []).filter(item => item?.type === safeKind);
      const remaining = new Map();
      names.forEach(name => remaining.set(name, (remaining.get(name) || 0) + 1));
      let matchedCount = 0;
      let boundCount = 0;
      let pendingCount = 0;
      let failedCount = 0;
      states.forEach(state => {
        const name = String(state?.fileName || "").trim().toLowerCase();
        if (!name || !remaining.get(name)) return;
        remaining.set(name, remaining.get(name) - 1);
        matchedCount += 1;
        const status = String(state?.status || "");
        if (status === "Retry") failedCount += 1;
        else if (status === "Uploading" || !String(state?.fileKey || "")) pendingCount += 1;
        else boundCount += 1;
      });
      return {
        available: true,
        matchedCount,
        boundCount,
        pendingCount,
        failedCount,
        pendingMedia: Number(snapshot.pendingMedia || 0)
      };
    } catch {
      return { available: false, matchedCount: 0, boundCount: 0, pendingCount: 0, failedCount: 0 };
    }
  }

  globalThis.__WATERMARK_FREE_DOLA_REFERENCE_STATUS__ = dolaReferenceUploadStatus;

  function dolaAttachmentBlockCounts(block) {
    const counts = { image: 0, video: 0, audio: 0 };
    const attachments = block?.content?.attachment_block?.attachments || [];
    for (const item of attachments) {
      if (item?.type === 1) counts.image += 1;
      if (item?.type === 2 && item?.media?.media_type === 2) counts.video += 1;
      if (item?.type === 2 && item?.media?.media_type === 1) counts.audio += 1;
    }
    return counts;
  }

  function dolaIsVideoMessage(message) {
    let ability = message?.ext?.chat_ability;
    if (typeof ability === "string") {
      try { ability = JSON.parse(ability); } catch { ability = {}; }
    }
    return Number(ability?.ability_type) === VIDEO_ABILITY_TYPE;
  }

  function dolaEnsureMediaReferences(runtime, request) {
    const messages = Array.isArray(request?.messages) ? request.messages : [];
    const videoMessageIndex = messages.findIndex(dolaIsVideoMessage);
    if (videoMessageIndex < 0) return request;
    const preferredChatId = messages[videoMessageIndex]?.conversation_id || "";
    const snapshot = dolaReferenceSnapshot(runtime, preferredChatId);
    const expectedMedia = snapshot.counts.video + snapshot.counts.audio;
    if (!expectedMedia) return request;
    let block = null;
    try {
      const builder = runtime(597338)?.S;
      block = typeof builder === "function" ? builder({
        attachments: snapshot.attachments,
        attachmentKeys: snapshot.attachmentKeys,
        attachmentStates: snapshot.attachmentStates
      }) : null;
    } catch {
      block = null;
    }
    const submitted = dolaAttachmentBlockCounts(block);
    const submittedMedia = submitted.video + submitted.audio;
    if (!block || snapshot.pendingMedia || submittedMedia < expectedMedia) {
      window.__WATERMARK_FREE_LAST_AUDIO_REFERENCE_SUBMIT__ = {
        ...submitted,
        expectedVideo: snapshot.counts.video,
        expectedAudio: snapshot.counts.audio,
        blocked: true
      };
      throw new Error("Reference audio/video is still uploading or not bound");
    }
    const clonedMessages = messages.map(message => ({
      ...message,
      content_blocks_v2: Array.isArray(message.content_blocks_v2) ? [...message.content_blocks_v2] : []
    }));
    let targetIndex = clonedMessages.findIndex(message => message.content_blocks_v2.some(item => item?.block_type === DOLA_ATTACHMENT_BLOCK_TYPE));
    if (targetIndex < 0) targetIndex = videoMessageIndex;
    const blocks = clonedMessages[targetIndex].content_blocks_v2;
    const blockIndex = blocks.findIndex(item => item?.block_type === DOLA_ATTACHMENT_BLOCK_TYPE);
    if (blockIndex >= 0) blocks[blockIndex] = block;
    else blocks.unshift(block);
    window.__WATERMARK_FREE_LAST_AUDIO_REFERENCE_SUBMIT__ = {
      ...submitted,
      blocked: false,
      patched: true,
      chatId: snapshot.chatId
    };
    return { ...request, messages: clonedMessages };
  }

  async function dolaPatchSubmit() {
    if (dolaSubmitPatchPending) return false;
    const runtime = dolaGetWebpackRequire();
    if (typeof runtime !== "function") return false;
    if (runtime.m && !runtime.m[431565]) return false;
    dolaSubmitPatchPending = true;
    try {
      const chatIMService = await runtime(431565)?.D?.("chatIMService");
      const messageService = await chatIMService?.getMessageService?.();
      if (!messageService || typeof messageService.sendMessage !== "function") return false;
      if (messageService.sendMessage.__INTL_DOUBAO_MEDIA_REFERENCES_PATCHED__ || messageService.sendMessage[DOLA_MEDIA_PATCH_MARK]) return true;
      const originalSendMessage = messageService.sendMessage;
      const patchedSendMessage = function (request, ...args) {
        return originalSendMessage.call(this, dolaEnsureMediaReferences(runtime, request), ...args);
      };
      patchedSendMessage.__INTL_DOUBAO_MEDIA_REFERENCES_PATCHED__ = true;
      patchedSendMessage[DOLA_MEDIA_PATCH_MARK] = true;
      messageService.sendMessage = patchedSendMessage;
      return true;
    } catch {
      return false;
    } finally {
      dolaSubmitPatchPending = false;
    }
  }

  function dolaPostMediaStatus(requestId, kind, phase, text, extra = {}) {
    window.postMessage({
      source: DOLA_AUDIO_REFERENCE_SOURCE,
      type: DOLA_AUDIO_REFERENCE_STATUS,
      requestId: String(requestId || ""),
      phase,
      text,
      kind,
      ...extra
    }, "*");
  }

  async function dolaAddMediaReferences(files, requestId, kind = "audio") {
    const label = kind === "video" ? "视频" : "音频";
    const selectedFiles = Array.from(files || []).filter(file => dolaMaterialKind(file) === kind);
    const limit = kind === "video" ? DOLA_VIDEO_LIMIT : DOLA_AUDIO_LIMIT;
    if (!selectedFiles.length) throw new Error(`请选择${kind === "video" ? " MP4 或 MOV 视频" : " MP3 或 WAV 音频"}`);
    if (selectedFiles.length > limit) throw new Error(`${label}参考最多 ${limit} 个`);
    const props = dolaFindInputProps();
    if (!props) throw new Error("未找到 Dola 视频上传上下文，请先打开 Seedance 2.5 生成框");
    if (Number(props.skill?.skill_type) !== VIDEO_ABILITY_TYPE || !/2\.5|seedance[^\d]*2[^\d]*5/i.test(selectedModelText())) {
      throw new Error("请先切换到 Seedance 2.5 视频生成");
    }
    const runtime = dolaGetWebpackRequire();
    if (typeof runtime !== "function") throw new Error("Dola 页面运行时尚未加载");
    for (let index = 0; index < selectedFiles.length; index += 1) {
      const sourceFile = selectedFiles[index];
      const pageFile = await dolaCreatePageFile(sourceFile);
      const file = pageFile;
      dolaAudioCompatibilityState = {
        attempted: false,
        converted: false,
        mode: "original-page-file",
        kind,
        inputName: file.name,
        inputSize: file.size,
        inputType: file.type
      };
      window.__WATERMARK_FREE_LAST_AUDIO_COMPATIBILITY__ = dolaAudioCompatibilityState;
      await dolaRemoveFailedMediaDuplicate(runtime, props.chatId, file, kind);
      const existing = dolaReferenceAttachments(runtime, props.chatId);
      const beforeLocalKeys = new Set(existing.map(item => item?.localKey).filter(Boolean));
      dolaPostMediaStatus(requestId, kind, "metadata", `读取${label} metadata（${index + 1}/${selectedFiles.length}）：${file.name}`);
      const mediaMeta = await dolaReadMediaDuration(file, kind);
      const ruleError = dolaMediaRuleError(runtime, props.chatId, file, mediaMeta, kind);
      if (ruleError) throw ruleError;
      dolaAudioPreprocessEvents = [];
      dolaAudioPreprocessState = null;
      dolaAudioPipelineState = null;
      window.__WATERMARK_FREE_LAST_AUDIO_PREPROCESS__ = null;
      window.__WATERMARK_FREE_LAST_AUDIO_PIPELINE__ = null;
      window.__WATERMARK_FREE_LAST_AUDIO_NATIVE__ = null;
      window.__WATERMARK_FREE_LAST_AUDIO_FALLBACK__ = null;
      dolaPostMediaStatus(requestId, kind, "uploading", `上传${label}（${index + 1}/${selectedFiles.length}）：${file.name}`);
      try {
        try {
          await dolaRunConfiguredMediaPipeline(runtime, props, file, mediaMeta, kind);
        } catch (pipelineError) {
          if (!dolaIsPipelineUnavailable(pipelineError)) throw pipelineError;
          const nativeDispatched = await dolaDispatchOfficialAudio(file);
          if (!nativeDispatched) throw pipelineError;
          dolaAudioPipelineState = {
            ...(dolaAudioPipelineState || { attempted: true }),
            stage: "official-input-fallback",
            fallback: true,
            message: String(pipelineError?.message || pipelineError || "").slice(0, 240)
          };
          window.__WATERMARK_FREE_LAST_AUDIO_PIPELINE__ = dolaAudioPipelineState;
        }
        const uploadState = await dolaWaitForReferenceUpload(runtime, props.chatId, beforeLocalKeys, file, kind);
        dolaAudioPipelineState = {
          ...dolaAudioPipelineState,
          handoffAccepted: true,
          attachmentBound: Boolean(uploadState.attachment),
          storeObserved: uploadState.storeObserved !== false,
          uploadComplete: Boolean(uploadState.complete),
          backgroundUpload: !uploadState.complete,
          localKey: String(uploadState.attachment?.localKey || "")
        };
        window.__WATERMARK_FREE_LAST_AUDIO_PIPELINE__ = dolaAudioPipelineState;
      } catch (error) {
        dolaAudioPipelineState = {
          ...(dolaAudioPipelineState || { attempted: true }),
          stage: dolaAudioPipelineState?.stage || "failed",
          message: String(error?.message || error || "").slice(0, 240)
        };
        window.__WATERMARK_FREE_LAST_AUDIO_PIPELINE__ = dolaAudioPipelineState;
        await dolaRemoveFailedMediaDuplicate(runtime, props.chatId, file, kind);
        throw error;
      }
    }
    dolaLastReferenceChatId = props.chatId;
    const snapshot = dolaReferenceSnapshot(runtime, props.chatId);
    return { counts: snapshot.counts, acceptedCount: selectedFiles.length, chatId: snapshot.chatId };
  }

  async function dolaHandleMediaRequest(message) {
    const requestId = message?.requestId || "";
    const kind = message?.kind === "video" ? "video" : "audio";
    const label = kind === "video" ? "视频" : "音频";
    if (dolaAudioUploadPending) {
      dolaPostMediaStatus(requestId, kind, "error", "已有参考素材正在上传，请等待完成");
      return;
    }
    dolaAudioNetworkEvents = [];
    window.__WATERMARK_FREE_AUDIO_FILE_BRIDGE__ = null;
    dolaAudioUploadPending = true;
    dolaPostMediaStatus(requestId, kind, "start", `正在连接 Dola ${label}上传管线`);
    try {
      const result = await dolaAddMediaReferences(message?.files, requestId, kind);
      dolaPostMediaStatus(requestId, kind, "done", `${label}已交给 Dola 处理：${result.acceptedCount}/${kind === "video" ? DOLA_VIDEO_LIMIT : DOLA_AUDIO_LIMIT}，可继续选择或上传`, result);
    } catch (error) {
      const diagnostic = error?.diagnostic || window.__WATERMARK_FREE_LAST_AUDIO_UPLOAD__ || null;
      dolaPostMediaStatus(requestId, kind, "error", error?.message || `${label}上传失败`, diagnostic ? { diagnostic } : {});
    } finally {
      dolaAudioUploadPending = false;
    }
  }

  window.addEventListener("message", event => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || message.source !== DOLA_AUDIO_REFERENCE_SOURCE || message.type !== DOLA_AUDIO_REFERENCE_REQUEST) return;
    dolaHandleMediaRequest(message);
  });

  if (host === "dola.com" || host.endsWith(".dola.com") || host === "ciciai.com" || host.endsWith(".ciciai.com")) {
    dolaHookUploadChunk();
    dolaEnhanceMediaSupport();
    dolaPatchSubmit().catch(() => {});
    setTimeout(() => {
      dolaEnhanceMediaSupport();
      dolaPatchSubmit().catch(() => {});
    }, 700);
    setInterval(() => {
      dolaEnhanceMediaSupport();
      dolaPatchSubmit().catch(() => {});
    }, 1500);
  }

  patchRequests();
  publishDurationState();
  enhanceDurationOptions();
  setInterval(enhanceDurationOptions, 1000);
})();
