(function installMaowangPlatformRules(root) {
  "use strict";

  if (root.MaowangPlatformRules) return;

  const QIANWEN_EXCLUDED_URL = /avatar|icon|logo|emoji|\.jfif(?:\?|$)/i;
  const QIANWEN_MEDIA_PATH = /workspace|generated|generation|aigc|creation|output|media|image/i;
  const QIANWEN_RESULT_CONTEXT = /assistant|answer|result|generation|creation|workspace|message.*ai/i;

  function findDoubaoVideoKey(value, depth = 0) {
    if (!value || depth > 10) return "";
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findDoubaoVideoKey(item, depth + 1);
        if (found) return found;
      }
      return "";
    }
    if (typeof value !== "object") return "";

    const direct = value.vid || value.video_id;
    if (typeof direct === "string" && direct.startsWith("v0")) return direct;
    for (const child of Object.values(value)) {
      const found = findDoubaoVideoKey(child, depth + 1);
      if (found) return found;
    }
    return "";
  }

  function extractDoubaoCreations(creations) {
    const images = [];
    for (const creation of creations || []) {
      const image = creation?.image;
      const original = image?.image_ori_raw;
      if (!original?.url) continue;
      images.push({
        watermarkUrl: image.image_thumb?.url || "",
        url: original.url,
        width: original.width || 0,
        height: original.height || 0
      });
    }
    return images;
  }

  function extractDoubaoMessageMedia(messages) {
    const images = [];
    const videos = [];
    for (const message of messages || []) {
      const messageId = String(message?.message_id || "").trim();
      for (const block of message?.content_block || []) {
        images.push(...extractDoubaoCreations(block?.content?.creation_block?.creations));
      }
      const videoKey = findDoubaoVideoKey(message);
      if (videoKey) videos.push({ videoKey, messageId });
    }
    return { images, videos };
  }

  function extractDoubaoPatchMedia(payload) {
    const images = [];
    const videos = [];
    const fallbackMessageId = String(payload?.message_id || "").trim();
    for (const operation of payload?.patch_op || []) {
      const value = operation?.patch_value;
      for (const block of value?.content_block || []) {
        images.push(...extractDoubaoCreations(block?.content?.creation_block?.creations));
      }
      const messageId = String(value?.message_id || fallbackMessageId).trim();
      const videoKey = findDoubaoVideoKey(value);
      if (videoKey) videos.push({ videoKey, messageId });
    }
    return { images, videos };
  }

  function noWatermark(url) {
    return String(url || "").replace(/lr=[^&]+/g, "lr=video_gen_no_watermark");
  }

  function safeDoubaoUrl(value) {
    try {
      const parsed = new URL(String(value || "").trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      return noWatermark(parsed.href);
    } catch (_) {
      return "";
    }
  }

  function doubaoPlayUrls(value) {
    if (!value || typeof value !== "object") return [];
    const fields = [
      "main_url", "mainUrl", "main", "url", "play_url", "playUrl",
      "video_url", "videoUrl", "download_url", "downloadUrl",
      "origin_url", "original_url", "raw_url", "source_url", "media_url",
      "fplay_url", "fplayUrl", "backup_url", "backupUrl", "backup",
      "no_watermark_url", "noWatermarkUrl", "watermark_free_url", "watermarkFreeUrl",
      "unwatermarked_url", "unwatermarkedUrl"
    ];
    return fields
      .map((field) => safeDoubaoUrl(value[field]))
      .filter(Boolean);
  }

  function uniqueDoubaoUrls(values) {
    return [...new Set((values || []).filter(Boolean))].slice(0, 8);
  }

  function extractDoubaoPlayInfo(payload) {
    if (payload?.code !== 0 || !payload?.data) {
      return { success: false, error: payload?.msg || "视频地址解析失败" };
    }
    const original = payload.data.original_media_info;
    const playInfos = Array.isArray(payload.data.play_infos) ? payload.data.play_infos : [];
    const fallbackInfos = [...playInfos, payload.data.play_info]
      .filter((value) => value && typeof value === "object");
    const fallback = fallbackInfos[0];
    const allUrls = uniqueDoubaoUrls([
      ...doubaoPlayUrls(original),
      ...fallbackInfos.flatMap((value) => doubaoPlayUrls(value))
    ]);
    const url = safeDoubaoUrl(original?.main_url || original?.mainUrl || original?.main)
      || allUrls[0]
      || "";
    if (!url) return { success: false, error: "没有找到视频地址" };
    const backupUrl = uniqueDoubaoUrls([
      safeDoubaoUrl(original?.backup_url || original?.backupUrl || original?.backup),
      ...fallbackInfos.map((value) => safeDoubaoUrl(value.backup_url || value.backupUrl || value.backup))
    ]).find((value) => value !== url) || "";
    const alternateUrls = allUrls
      .filter((value) => value !== url && value !== backupUrl)
      .slice(0, 8);
    return {
      success: true,
      url,
      backupUrl,
      alternateUrls,
      width: original?.width || fallback?.width || 0,
      height: original?.height || fallback?.height || 0
    };
  }

  function buildDoubaoPlayInfoRequest(videoKey, webTabId) {
    const query = new URLSearchParams({
      aid: "497858",
      device_platform: "web",
      samantha_web: "1",
      "use-olympus-account": "1",
      version_code: "20800",
      pkg_type: "release_version",
      web_tab_id: webTabId
    });
    return {
      url: `https://www.doubao.com/samantha/media/get_play_info?${query.toString()}`,
      init: {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "agw-js-conv": "str"
        },
        credentials: "include",
        body: JSON.stringify({ key: videoKey, type: "video" })
      }
    };
  }

  function isDoubaoCompletionUrl(input, baseUrl = "https://www.doubao.com/") {
    const raw = typeof input === "string" ? input : input?.url || "";
    try {
      const parsed = new URL(raw, baseUrl);
      return /(^|\.)doubao\.com$/.test(parsed.hostname)
        && /\/chat\/completion\/?$/.test(parsed.pathname);
    } catch (_) {
      return /\/chat\/completion(?:[/?#]|$)/.test(raw);
    }
  }

  function patchDoubaoDurationBody(body, selectedDuration, targetDuration, targetModel) {
    if (selectedDuration !== targetDuration || typeof body !== "string" || !body.trim()) return body;
    try {
      const payload = JSON.parse(body);
      const ability = payload?.chat_ability;
      if (Number(ability?.ability_type) !== 17) return body;
      let params = {};
      if (ability.ability_param && typeof ability.ability_param === "object") {
        params = { ...ability.ability_param };
      } else if (typeof ability.ability_param === "string" && ability.ability_param.trim()) {
        params = JSON.parse(ability.ability_param);
      }
      params.model = targetModel;
      params.duration = targetDuration;
      ability.ability_param = JSON.stringify(params);
      return JSON.stringify(payload);
    } catch (_) {
      return body;
    }
  }

  function qianwenImageDecision(candidate) {
    const width = Number(candidate?.width) || 0;
    const height = Number(candidate?.height) || 0;
    if (width < 360 || height < 240) return { accepted: false, reason: "small" };

    const rawUrl = String(candidate?.url || "");
    if (!rawUrl || /^(data|blob):/i.test(rawUrl)) return { accepted: false, reason: "local-url" };
    if (QIANWEN_EXCLUDED_URL.test(rawUrl)) return { accepted: false, reason: "excluded-url" };

    try {
      const url = new URL(rawUrl);
      if (url.hostname === "workspace-zb-cdn.qianwen.com") {
        return { accepted: true, reason: "known-host" };
      }
      const context = String(candidate?.context || "");
      if (QIANWEN_MEDIA_PATH.test(url.pathname) && QIANWEN_RESULT_CONTEXT.test(context)) {
        return { accepted: true, reason: "result-signal" };
      }
      return { accepted: false, reason: "unknown-source" };
    } catch (_) {
      return { accepted: false, reason: "invalid-url" };
    }
  }

  root.MaowangPlatformRules = Object.freeze({
    findDoubaoVideoKey,
    extractDoubaoCreations,
    extractDoubaoMessageMedia,
    extractDoubaoPatchMedia,
    extractDoubaoPlayInfo,
    buildDoubaoPlayInfoRequest,
    isDoubaoCompletionUrl,
    patchDoubaoDurationBody,
    qianwenImageDecision
  });
})(globalThis);
