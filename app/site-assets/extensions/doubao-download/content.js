// content.js - 改造后版本
const originalXHROpen = XMLHttpRequest.prototype.open;
const originalXHRSend = XMLHttpRequest.prototype.send;
const originalFetch = window.fetch;
const processedUrls = new Set();
const MAX_DEDUP_SIZE = 100;
const MIN_IMAGE_URL_TTL_MS = 5 * 60 * 1000;
const videoCache = new Map();
const videoNodeIdCache = new Map();
const maowangVideoRequests = new Map();

function normalizeDoubaoCandidate(value) {
  try {
    const parsed = new URL(String(value || '').trim(), location.href);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    const text = parsed.href;
    if (/video_gen_watermark|watermark_dyn|with_watermark|aigc_busi_mark|aigc_resize_mark|wm=1/i.test(text)) return '';
    return text.replace(/lr=[^&]+/gi, 'lr=video_gen_no_watermark');
  } catch (_) {
    return '';
  }
}

function doubaoCandidateUrls(value) {
  const fields = [
    'main_url', 'mainUrl', 'main', 'url', 'play_url', 'playUrl',
    'video_url', 'videoUrl', 'download_url', 'downloadUrl',
    'origin_url', 'original_url', 'raw_url', 'source_url', 'media_url',
    'fplay_url', 'fplayUrl', 'backup_url', 'backupUrl', 'backup',
    'no_watermark_url', 'noWatermarkUrl', 'watermark_free_url', 'watermarkFreeUrl',
    'unwatermarked_url', 'unwatermarkedUrl'
  ];
  const values = Array.isArray(value) ? value : fields.map((field) => value?.[field]);
  return [...new Set(values.flatMap((item) => Array.isArray(item) ? item : [item])
    .map(normalizeDoubaoCandidate)
    .filter(Boolean))].slice(0, 8);
}

function rememberVideoNodeId(videoKey, nodeId, messageId = "") {
  const key = String(videoKey || "").trim();
  const node = String(nodeId || "").trim();
  const msg = String(messageId || "").trim();
  if (!node || !/^\d{8,}$/.test(node)) return;
  if (key) videoNodeIdCache.set(key, node);
  if (msg) videoNodeIdCache.set(`message:${msg}`, node);
}

function requestMaowangBridgeVideo(videoKey, messageId) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      maowangVideoRequests.delete(requestId);
      resolve({ success: false, error: "老猫豆包解析超时", videoKey });
    }, 12000);

    maowangVideoRequests.set(requestId, (result) => {
      clearTimeout(timer);
      resolve(result || { success: false, error: "老猫豆包解析失败", videoKey });
    });

    window.postMessage({
      source: "maowang-doubao-content",
      type: "MW_RESOLVE_VIDEO",
      requestId,
      videoKey: videoKey || "",
      messageId: messageId || ""
    }, location.origin);
  });
}

function fromMaowangVideoResult(result, info, options = {}) {
  if (!result?.success || !result.url) return null;
  if (!isConfirmedNoWatermarkVideoUrl(result.url)) return null;
  return {
    success: true,
    messageId: info?.messageId || result.messageId || "",
    vid: info?.vid || result.videoKey || "",
    videoUrl: result.url,
    backupUrl: result.backupUrl || "",
    alternateUrls: doubaoCandidateUrls(result.alternateUrls).filter((url) => url !== result.url && url !== result.backupUrl),
    width: result.width || null,
    height: result.height || null,
    definition: result.definition || "unknown",
    source: "maowang_bridge",
    confirmedNoWatermark: true,
    title: options.title || "",
    filename: options.filename || "",
    suppressAutoDownload: !!options.suppressAutoDownload,
    downloadAfterResolve: !!options.downloadAfterResolve
  };
}

async function callGetPlayInfo(videoKey) {
  const baseUrl = 'https://www.doubao.com/samantha/media/get_play_info';
  const params = new URLSearchParams({
    aid: '497858',
    device_platform: 'web',
    samantha_web: '1',
    'use-olympus-account': '1',
    version_code: '20800',
    pkg_type: 'release_version',
    web_tab_id: crypto.randomUUID()
  });
  const url = `${baseUrl}?${params.toString()}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'agw-js-conv': 'str',
      'origin': location.origin,
      'referer': location.href
    },
    credentials: 'include',
    body: JSON.stringify({ key: videoKey, type: 'video' })
  });
  
  const json = await response.json();
  if (json.code !== 0) {
    throw new Error(`get_play_info 接口返回错误: code=${json.code}, msg=${json.msg || '未知'}`);
  }
  
  const data = json.data;
  if (!data) throw new Error('响应中无 data 字段');
  
  const originalMedia = data.original_media_info;
  if (!originalMedia || !originalMedia.main_url) {
    // 兼容老结构：回退到 play_infos[0].main
    console.warn('[content] 未找到 original_media_info，尝试使用 play_infos');
    const playInfos = data.play_infos || (data.play_info ? [data.play_info] : []);
    const playInfo = playInfos[0];
    if (!playInfo || !playInfo.main) {
      throw new Error('未找到视频播放地址');
    }
    const mainUrl = playInfo.main.replace(/lr=[^&]+/g, 'lr=video_gen_no_watermark');
    const backupUrl = playInfo.backup ? playInfo.backup.replace(/lr=[^&]+/g, 'lr=video_gen_no_watermark') : null;
    return {
      success: true,
      mainUrl: mainUrl,
      backupUrl: backupUrl,
      alternateUrls: playInfos.flatMap(doubaoCandidateUrls).filter((url) => url !== mainUrl && url !== backupUrl).slice(0, 8),
      width: playInfo.width,
      height: playInfo.height,
      definition: playInfo.definition || 'unknown',
      confirmedNoWatermark: false
    };
  }
  
  let mainUrl = originalMedia.main_url;
  let backupUrl = originalMedia.backup_url || null;
  
  return {
    success: true,
    mainUrl: mainUrl,
    backupUrl: backupUrl,
    alternateUrls: doubaoCandidateUrls(originalMedia).filter((url) => url !== mainUrl && url !== backupUrl),
    width: originalMedia.width || null,
    height: originalMedia.height || null,
    definition: originalMedia.definition || data.video_info?.definition || 'unknown',
    confirmedNoWatermark: false
  };
}

async function callGetDownloadInfo(nodeId) {
  const id = String(nodeId || "").trim();
  if (!/^\d{8,}$/.test(id)) {
    throw new Error("缺少豆包作品节点ID");
  }

  const response = await fetch("/samantha/aispace/get_download_info", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "agw-js-conv": "str",
      "origin": location.origin,
      "referer": location.href
    },
    credentials: "include",
    body: JSON.stringify({ requests: [{ node_id: id }] })
  });

  const json = await response.json();
  if (json.code !== 0) {
    throw new Error(`get_download_info 接口返回错误: code=${json.code}, msg=${json.msg || "未知"}`);
  }

  const info = json?.data?.download_infos?.[0];
  const mainUrl = info?.main_url || info?.mainUrl || "";
  const backupUrl = info?.backup_url || info?.backupUrl || "";
  if (!mainUrl) throw new Error("豆包未返回原视频下载地址");
  if (!isConfirmedNoWatermarkVideoUrl(mainUrl)) {
    throw new Error("豆包返回的下载地址未确认无水印");
  }

  return {
    success: true,
    mainUrl,
    backupUrl,
    alternateUrls: doubaoCandidateUrls(info).filter((url) => url !== mainUrl && url !== backupUrl),
    width: info.width || null,
    height: info.height || null,
    definition: info.definition || "download",
    confirmedNoWatermark: true,
    nodeId: id
  };
}

async function resolveDoubaoDownloadInfo(info, options = {}) {
  const ids = [];
  const push = value => {
    const id = String(value || "").trim();
    if (/^\d{8,}$/.test(id) && !ids.includes(id)) ids.push(id);
  };
  push(options.nodeId);
  push(info?.nodeId);
  push(videoNodeIdCache.get(info?.vid || ""));
  push(videoNodeIdCache.get(`message:${info?.messageId || ""}`));
  push(/^\d{8,}$/.test(String(info?.messageId || "")) ? info.messageId : "");

  let lastError = null;
  for (const id of ids) {
    try {
      return await callGetDownloadInfo(id);
    } catch (error) {
      lastError = error;
      console.warn("[content] get_download_info 失败:", id, error?.message || error);
    }
  }

  throw lastError || new Error("未找到可用于豆包原视频下载的作品节点ID");
}

// 原有 findVideoAndMessageId, findVidByMessageId, findVidInObject 等函数保持不变
function findVideoAndMessageId() {
  const routerData = window._ROUTER_DATA;
  if (!routerData) return null;
  const cells = routerData?.loaderData?.chat_layout?.trimmedChainRecentConvCells || [];
  for (const cell of cells) {
    const messages = cell?.conversation?.messages || [];
    for (const msg of messages) {
      const msgId = String(msg.message_id || msg.messageId || "").trim();
      if (!msgId || msgId === "0") continue;
      const info = findVideoInfoInObject(msg);
      if (info?.vid) {
        if (info.nodeId) rememberVideoNodeId(info.vid, info.nodeId, msgId);
        return { vid: info.vid, nodeId: info.nodeId || "", messageId: msgId };
      }
    }
  }
  return null;
}

function findVidByMessageId(messageId) {
  const cached = videoCache.get(messageId);
  if (cached) return { vid: cached, nodeId: videoNodeIdCache.get(`message:${messageId}`) || videoNodeIdCache.get(cached) || "", messageId };
  const routerData = window._ROUTER_DATA;
  if (!routerData) return null;
  const cells = routerData?.loaderData?.chat_layout?.trimmedChainRecentConvCells || [];
  for (const cell of cells) {
    const messages = cell?.conversation?.messages || [];
    for (const msg of messages) {
      const msgId = String(msg.message_id || msg.messageId || "").trim();
      if (msgId === messageId) {
        const info = findVideoInfoInObject(msg);
        if (info?.vid) {
          videoCache.set(messageId, info.vid);
          if (info.nodeId) rememberVideoNodeId(info.vid, info.nodeId, messageId);
          return { vid: info.vid, nodeId: info.nodeId || "", messageId };
        }
      }
    }
  }
  return null;
}

function getCurrentConversationId() {
  const match = String(location.pathname || "").match(/\/chat\/(\d{8,})/);
  return match ? match[1] : "";
}

function getRecentChainSingleUrl() {
  try {
    const entries = performance.getEntriesByType("resource") || [];
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const url = String(entries[i]?.name || "");
      if (url.includes("/im/chain/single")) return url;
    }
  } catch (e) {}
  return "";
}

function buildChainSingleUrl() {
  const recent = getRecentChainSingleUrl();
  if (recent) return recent;
  const params = new URLSearchParams({
    version_code: "20800",
    language: "zh",
    device_platform: "web",
    aid: "497858",
    real_aid: "497858",
    pkg_type: "release_version",
    region: "CN",
    sys_region: "CN",
    samantha_web: "1",
    web_platform: "browser",
    "use-olympus-account": "1",
    web_tab_id: crypto.randomUUID()
  });
  return `/im/chain/single?${params.toString()}`;
}

async function fetchChainSingleForMessageId(messageId) {
  const conversationId = getCurrentConversationId();
  if (!conversationId) return null;
  const body = {
    cmd: 3100,
    uplink_body: {
      pull_singe_chain_uplink_body: {
        conversation_id: conversationId,
        anchor_index: 9007199254740991,
        conversation_type: 3,
        direction: 1,
        limit: 20,
        ext: {},
        filter: { index_list: [] },
        evaluate_ab_params: "",
        evaluate_common_params: ""
      }
    },
    sequence_id: crypto.randomUUID(),
    channel: 2,
    version: "1"
  };
  const response = await originalFetch(buildChainSingleUrl(), {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json; encoding=utf-8",
      "agw-js-conv": "str",
      referer: location.href
    },
    credentials: "include",
    body: JSON.stringify(body)
  });
  const json = await response.json();
  extractAndPublishFromApiResponse(json, "manual-chain-single");
  return findVidByMessageId(messageId);
}

function findVidInObject(obj, depth = 0) {
  return findVideoInfoInObject(obj, depth)?.vid || null;
}

function findVideoInfoInObject(obj, depth = 0, seen = new WeakSet()) {
  if (depth > 10 || !obj) return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findVideoInfoInObject(item, depth + 1, seen);
      if (found) return found;
    }
  } else if (typeof obj === "object") {
    if (seen.has(obj)) return null;
    seen.add(obj);
    const vid = obj.vid || obj.video_id || obj.videoId || obj.key;
    const nodeId = obj.node_id || obj.nodeId || obj.item_id || obj.itemId;
    if (vid && typeof vid === "string" && vid.startsWith("v0")) {
      return { vid, nodeId: /^\d{8,}$/.test(String(nodeId || "")) ? String(nodeId) : "" };
    }
    for (const val of Object.values(obj)) {
      const found = findVideoInfoInObject(val, depth + 1, seen);
      if (found) return found;
    }
  }
  return null;
}

async function callBigmusicShareSave(messageId) {
  return new Promise((resolve) => {
    function handler(ev) {
      if (ev.data?.type === "bigmusicShareSaveResult") {
        window.removeEventListener("message", handler);
        resolve(ev.data.data);
      }
    }
    window.postMessage({ type: "bigmusicShareSave", messageId }, "*");
    window.addEventListener("message", handler);
    setTimeout(() => {
      window.removeEventListener("message", handler);
      resolve(null);
    }, 15000);
  });
}

async function callGetVideoShareInfo(shareId, vid) {
  const url = "https://www.doubao.com/creativity/share/get_video_share_info?version_code=20800&language=zh&device_platform=web&aid=497858&real_aid=497858&pkg_type=release_version&device_id=7550681679050343936&pc_version=3.14.6&region=CN&sys_region=CN&samantha_web=1&use-olympus-account=1&web_tab_id=" + crypto.randomUUID();
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "agw-js-conv": "str"
      },
      credentials: "include",
      body: JSON.stringify({ share_id: shareId, vid, creation_id: "" })
    });
    const json = await resp.json();
    if (json.code === 0 && json.data) return json.data;
    return null;
  } catch (e) {
    return null;
  }
}

function extractNoWatermarkVideoUrl(data) {
  const playInfo = data?.play_infos?.[0] || data?.play_info || (data?.main ? data : null);
  if (!playInfo?.main) return null;
  const replaceLr = (url) => url?.replace(/lr=video_gen_watermark_dyn/, "lr=video_gen_no_watermark").replace(/lr=video_gen_watermark/, "lr=video_gen_no_watermark");
  const result = {
    mainUrl: replaceLr(playInfo.main),
    backupUrl: replaceLr(playInfo.backup),
    alternateUrls: (data?.play_infos || []).flatMap(doubaoCandidateUrls).filter((url) => url !== playInfo.main && url !== playInfo.backup).slice(0, 8),
    width: playInfo.width,
    height: playInfo.height,
    definition: playInfo.definition,
    confirmedNoWatermark: true
  };
  if (!isConfirmedNoWatermarkVideoUrl(result.mainUrl)) return null;
  return result;
}

function isConfirmedNoWatermarkVideoUrl(url) {
  const text = String(url || '').toLowerCase();
  if (!text) return false;
  if (/video_gen_watermark|watermark_dyn|with_watermark|aigc_busi_mark|aigc_resize_mark|wm=1/.test(text)) return false;
  try {
    const parsed = new URL(url, location.href);
    if (/videoweb-download\.doubao\.com$/i.test(parsed.hostname)) return true;
    if (/(^|-)videoweb\.doubao\.com$/i.test(parsed.hostname)
      && parsed.searchParams.get('download') === 'true'
      && /video_gen_no_watermark/i.test(parsed.searchParams.get('lr') || '')) return true;
    if (parsed.hostname.includes('doubao.com') && parsed.pathname.includes('/download') && parsed.searchParams.get('download') === 'true') return true;
  } catch (e) {}
  return false;
}

// ========== 改造 startVideoDownload：优先使用新接口 ==========
async function startVideoDownload(options = {}) {
  const info = findVideoAndMessageId();
  if (!info) return { success: false, error: "未找到视频内容" };

  try {
    const playResult = await resolveDoubaoDownloadInfo(info, options);
    if (playResult?.mainUrl) {
      return {
        success: true,
        messageId: info.messageId,
        vid: info.vid,
        nodeId: playResult.nodeId || info.nodeId || "",
        videoUrl: playResult.mainUrl,
        backupUrl: playResult.backupUrl,
        alternateUrls: playResult.alternateUrls || [],
        width: playResult.width,
        height: playResult.height,
        definition: playResult.definition,
        source: "doubao_download_info",
        confirmedNoWatermark: true,
        title: options.title || "",
        filename: options.filename || "",
        suppressAutoDownload: !!options.suppressAutoDownload,
        downloadAfterResolve: !!options.downloadAfterResolve
      };
    }
  } catch (err) {
    console.warn("[content] 豆包下载信息接口失败:", err);
  }

  return { success: false, error: "未获取到豆包无水印视频链接，已停止下载", messageId: info.messageId, filename: options.filename || "" };
}
// ========== 改造 startVideoDownloadByMessageId：优先使用新接口 ==========
async function resolveByMaowangBridge(info, options = {}) {
  const messageId = String(info?.messageId || options.messageId || "");
  const videoKey = String(info?.vid || options.videoKey || "");
  const bridgeResult = await requestMaowangBridgeVideo(videoKey, messageId);
  return fromMaowangVideoResult(bridgeResult, { ...info, messageId, vid: videoKey }, options);
}

async function startVideoDownloadByMessageId(messageId, options = {}) {
  let info = findVidByMessageId(messageId);
  if (!info) {
    try {
      info = await fetchChainSingleForMessageId(messageId);
    } catch (err) {
      console.warn("[content] 豆包当前会话补拉失败:", err);
    }
  }
  info = info || {
    vid: "",
    nodeId: options.nodeId || "",
    messageId
  };

  if (info.vid || info.nodeId) {
    try {
      const playResult = await resolveDoubaoDownloadInfo(info, options);
      if (playResult?.mainUrl) {
        return {
          success: true,
          messageId: info.messageId,
          vid: info.vid,
          nodeId: playResult.nodeId || info.nodeId || "",
          videoUrl: playResult.mainUrl,
          backupUrl: playResult.backupUrl,
          alternateUrls: playResult.alternateUrls || [],
          width: playResult.width,
          height: playResult.height,
          definition: playResult.definition,
          source: "doubao_download_info",
          confirmedNoWatermark: true,
          title: options.title || "",
          filename: options.filename || "",
          suppressAutoDownload: !!options.suppressAutoDownload,
          downloadAfterResolve: !!options.downloadAfterResolve
        };
      }
    } catch (err) {
      console.warn("[content] 豆包下载信息接口失败:", err);
    }
  }

  try {
    const bridgeResult = await resolveByMaowangBridge(info, { ...options, messageId });
    if (bridgeResult?.success && bridgeResult.videoUrl) return bridgeResult;
  } catch (err) {
    console.warn("[content] 豆包桥接解析失败:", err);
  }

  return { success: false, error: "未找到视频内容或原视频链接", messageId, filename: options.filename || "" };
}
// ========== 改造结束 ==========

function scanInitialVideoData() {
  const routerData = window._ROUTER_DATA;
  if (!routerData) return;
  const cells = routerData?.loaderData?.chat_layout?.trimmedChainRecentConvCells || [];
  const videos = [];
  for (const cell of cells) {
    const messages = cell?.conversation?.messages || [];
    for (const msg of messages) {
      const msgId = String(msg.message_id || msg.messageId || "").trim();
      if (!msgId || msgId === "0") continue;
      const vid = findVidInObject(msg);
      if (vid) {
        videoCache.set(msgId, vid);
        videos.push({ vid, messageId: msgId });
      }
    }
  }
  if (videos.length) window.postMessage({ type: "videoDataExtracted", data: videos }, "*");
}

function extractFromCreations(creations) {
  const images = [];
  for (const cr of creations) {
    const img = cr?.image;
    const raw = img?.image_ori_raw;
    const title = pickPromptText(cr) || pickPromptText(img);
    if (raw?.url) {
      const match = raw.url.match(/x-expires=(\d+)/);
      const expires = match ? new Date(parseInt(match[1]) * 1000).toISOString() : null;
      images.push({
        watermark_url: img.image_thumb?.url,
        no_watermark_url: raw.url,
        expires_at: expires,
        width: raw.width || null,
        height: raw.height || null,
        title
      });
    }
  }
  return images;
}

function pickPromptText(obj, depth = 0, seen = new WeakSet()) {
  if (!obj || depth > 8) return "";
  if (typeof obj === "string") {
    const text = obj.replace(/\s+/g, " ").trim();
    if (!text || text.length < 2 || /^https?:\/\//i.test(text)) return "";
    if (/^(image|video|url|id|true|false|null)$/i.test(text)) return "";
    return text.slice(0, 120);
  }
  if (typeof obj !== "object") return "";
  if (seen.has(obj)) return "";
  seen.add(obj);
  for (const key of ["prompt", "query", "description", "caption", "title", "text"]) {
    const value = obj[key];
    if (typeof value === "string") {
      const picked = pickPromptText(value, depth + 1, seen);
      if (picked) return picked;
    }
  }
  for (const key of ["gen_params", "genParams", "params", "metadata", "content"]) {
    const picked = pickPromptText(obj[key], depth + 1, seen);
    if (picked) return picked;
  }
  return "";
}

function extractFromPatchOps(patchOps) {
  let images = [];
  for (const op of patchOps) {
    const blocks = op?.patch_value?.content_block;
    if (blocks) {
      for (const block of blocks) {
        const creations = block?.content?.creation_block?.creations;
        if (creations) images.push(...extractFromCreations(creations));
      }
    }
  }
  return images;
}

function extractFromMessages(messages) {
  let images = [];
  for (const msg of messages) {
    for (const block of msg?.content_block || []) {
      const creations = block?.content?.creation_block?.creations;
      if (creations) images.push(...extractFromCreations(creations));
    }
  }
  return images;
}

function extractVideoFromMessages(messages) {
  const videos = [];
  for (const msg of messages) {
    const msgId = String(msg.message_id || msg.messageId || "").trim();
    if (!msgId || msgId === "0") continue;
    const info = findVideoInfoInObject(msg);
    if (info?.vid) {
      videoCache.set(msgId, info.vid);
      if (info.nodeId) rememberVideoNodeId(info.vid, info.nodeId, msgId);
      videos.push({ vid: info.vid, nodeId: info.nodeId || "", messageId: msgId, title: pickPromptText(msg) });
    }
  }
  return videos;
}

function markProcessed(url) {
  if (url) {
    processedUrls.add(url);
    if (processedUrls.size > MAX_DEDUP_SIZE) {
      const first = processedUrls.values().next().value;
      processedUrls.delete(first);
    }
  }
}

function publishImages(images) {
  if (!images.length) return;
  const now = Date.now();
  const valid = images.filter(img => !img.expires_at || new Date(img.expires_at).getTime() > now + MIN_IMAGE_URL_TTL_MS);
  if (valid.length) window.postMessage({ type: "imageDataExtracted", data: valid }, "*");
}

function publishVideos(videos) {
  if (videos.length) window.postMessage({ type: "videoDataExtracted", data: videos }, "*");
}

async function readSSEStream(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        const match = part.match(/^data: (.+)$/m);
        if (match) {
          try {
            const data = JSON.parse(match[1]);
            const patchOps = data?.patch_op;
            if (patchOps) {
              const images = extractFromPatchOps(patchOps);
              if (images.length) window.postMessage({ type: "imageDataExtracted", data: images }, "*");
              const msgId = String(data?.message_id || data?.messageId || "").trim();
              for (const op of patchOps) {
                const pv = op?.patch_value;
                if (!pv) continue;
                const id = String(pv.message_id || pv.messageId || msgId || "").trim();
                if (!id || id === "0") continue;
                const vid = findVidInObject(pv);
                if (vid) {
                  videoCache.set(id, vid);
                  window.postMessage({ type: "videoDataExtracted", data: [{ vid, messageId: id }] }, "*");
                }
              }
            }
          } catch(e) {}
        }
      }
    }
  } catch(e) {}
}

function extractAndPublishFromXHR(response, url) {
  if (url && processedUrls.has(url)) return;
  const messages = response?.downlink_body?.pull_singe_chain_downlink_body?.messages;
  if (!messages) return;
  const images = extractFromMessages(messages);
  markProcessed(url);
  publishImages(images);
  publishVideos(extractVideoFromMessages(messages));
}

function collectMessages(obj, out = [], depth = 0, seen = new WeakSet()) {
  if (depth > 18 || !obj || typeof obj !== "object") return out;
  if (seen.has(obj)) return out;
  seen.add(obj);

  if (Array.isArray(obj)) {
    for (const item of obj) collectMessages(item, out, depth + 1, seen);
    return out;
  }

  if (obj.message_id || obj.messageId) out.push(obj);
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object") collectMessages(val, out, depth + 1, seen);
  }
  return out;
}

function extractAndPublishFromApiResponse(response, url) {
  if (!response) return;
  const directMessages = response?.downlink_body?.pull_singe_chain_downlink_body?.messages;
  const messages = Array.isArray(directMessages) ? directMessages : collectMessages(response);
  if (!messages.length) return;
  markProcessed(url);
  publishImages(extractFromMessages(messages));
  publishVideos(extractVideoFromMessages(messages));
}

// 消息监听
window.addEventListener("message", async (ev) => {
  const msg = ev.data;
  if (msg?.source === "maowang-doubao-bridge") {
    if (msg.type === "MW_DOUBAO_MEDIA") {
      for (const video of msg.videos || []) {
        if (video?.messageId && video?.videoKey) {
          videoCache.set(String(video.messageId), String(video.videoKey));
        }
      }
    } else if (msg.type === "MW_VIDEO_RESULT") {
      const resolve = maowangVideoRequests.get(msg.requestId);
      if (resolve) {
        maowangVideoRequests.delete(msg.requestId);
        resolve(msg);
      }
    }
    return;
  }

  if (msg?.type === "startVideoDownload") {
    const result = await startVideoDownload({
      title: msg.title || "",
      nodeId: msg.nodeId || "",
      filename: msg.filename || "",
      suppressAutoDownload: !!msg.suppressAutoDownload,
      downloadAfterResolve: !!msg.downloadAfterResolve
    });
    window.postMessage({ type: "videoDownloadResult", data: result }, "*");
  } else if (msg?.type === "startVideoDownloadByMessageId") {
    const result = await startVideoDownloadByMessageId(msg.messageId, {
      title: msg.title || "",
      nodeId: msg.nodeId || "",
      filename: msg.filename || "",
      suppressAutoDownload: !!msg.suppressAutoDownload,
      downloadAfterResolve: !!msg.downloadAfterResolve
    });
    window.postMessage({ type: "videoDownloadResult", data: result }, "*");
  } else if (msg?.type === "scanInitialVideos") {
    scanInitialVideoData();
  }
});

// 劫持 fetch 和 XHR 以捕获图片数据
window.fetch = function(...args) {
  const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
  if (typeof url === "string" && url.includes("/samantha/media/get_play_info")) {
    try {
      const body = args[1]?.body || (args[0] && typeof args[0] === "object" ? args[0].body : "");
      const parsed = typeof body === "string" ? JSON.parse(body) : null;
      if (parsed?.key && parsed?.node_id) rememberVideoNodeId(parsed.key, parsed.node_id);
    } catch (e) {}
  }
  if (typeof url === "string" && url.includes("chat/completion")) {
    if (processedUrls.has(url)) return originalFetch.apply(this, args);
    markProcessed(url);
    return originalFetch.apply(this, args).then(async (resp) => {
      const contentType = resp.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream")) return resp;
      const [stream1, stream2] = resp.body.tee();
      const newResp = new Response(stream1, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
      readSSEStream(stream2);
      return newResp;
    });
  }
  return originalFetch.apply(this, args).then((resp) => {
    if (typeof url === "string" && /chain|conversation|message|recent_conv|pull_singe/i.test(url)) {
      const contentType = resp.headers.get("content-type") || "";
      if (contentType.includes("json") || contentType.includes("text")) {
        resp.clone().text().then((text) => {
          try {
            extractAndPublishFromApiResponse(JSON.parse(text), url);
          } catch(e) {}
        }).catch(() => {});
      }
    }
    return resp;
  });
};

XMLHttpRequest.prototype.open = function(method, url, ...rest) {
  this._url = url;
  return originalXHROpen.call(this, method, url, ...rest);
};

XMLHttpRequest.prototype.send = function(...args) {
  if (typeof this._url === "string" && this._url.includes("/samantha/media/get_play_info")) {
    try {
      const body = args[0];
      const parsed = typeof body === "string" ? JSON.parse(body) : null;
      if (parsed?.key && parsed?.node_id) rememberVideoNodeId(parsed.key, parsed.node_id);
    } catch (e) {}
  }
  this.addEventListener("load", () => {
    if (typeof this._url === "string" && this._url.includes("chain/single")) {
      try {
        extractAndPublishFromApiResponse(JSON.parse(this.responseText), this._url);
      } catch(e) {}
    }
  });
  return originalXHRSend.apply(this, args);
};
