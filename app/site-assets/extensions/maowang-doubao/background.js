"use strict";

importScripts("shared/platform-rules.js");

const APP_VERSION = chrome.runtime.getManifest().version;
const platformRules = globalThis.MaowangPlatformRules;
const pageStats = new Map();

function safeFileName(value, fallback) {
  const cleaned = String(value || fallback || "media")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  return cleaned || fallback || "media";
}

function isDownloadableUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch (_) {
    return false;
  }
}

async function downloadOne(item, sender) {
  if (!item || !isDownloadableUrl(item.url)) {
    return { success: false, error: "下载地址无效" };
  }

  const tabId = sender?.tab?.id;
  if (typeof tabId !== "number") return { success: false, error: "无法确定当前账号页面" };
  const data = {
    ...item,
    type: item.type || (/\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(item.url) ? "video" : "image"),
    filename: safeFileName(item.filename, `maowang_${Date.now()}`),
    title: item.title || item.filename || "猫王素材",
    source: item.source || "maowang-extension"
  };
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "AIAM_DOWNLOAD_REQUEST", data }, (response) => {
      if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
      else resolve(response || { success: true });
    });
  });
}

async function downloadMany(items, sender) {
  const safeItems = Array.isArray(items) ? items.slice(0, 600) : [];
  const results = [];

  for (let index = 0; index < safeItems.length; index += 1) {
    results.push(await downloadOne(safeItems[index], sender));
    if (index < safeItems.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  }

  return {
    success: results.some((result) => result.success),
    successCount: results.filter((result) => result.success).length,
    failCount: results.filter((result) => !result.success).length,
    total: results.length
  };
}

async function resolveDoubaoVideo(videoKey) {
  if (!videoKey) return { success: false, error: "缺少视频标识" };

  try {
    const request = platformRules.buildDoubaoPlayInfoRequest(videoKey, crypto.randomUUID());
    const response = await fetch(request.url, request.init);
    return platformRules.extractDoubaoPlayInfo(await response.json());
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function normalizeHealth(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    contentReady: Boolean(source.contentReady),
    bridgeReady: Boolean(source.bridgeReady),
    scanCount: Math.max(0, Number(source.scanCount) || 0),
    completionRequests: Math.max(0, Number(source.completionRequests) || 0),
    mediaPayloads: Math.max(0, Number(source.mediaPayloads) || 0),
    durationOptionReady: Boolean(source.durationOptionReady),
    candidateImages: Math.max(0, Number(source.candidateImages) || 0),
    lastIssue: String(source.lastIssue || "").slice(0, 80),
    lastEventAt: Math.max(0, Number(source.lastEventAt) || 0)
  };
}

function updateStats(message, sender) {
  const tabId = sender.tab?.id ?? "unknown";
  const platform = message.platform === "qianwen" ? "qianwen" : "doubao";
  pageStats.set(`${platform}:${tabId}`, {
    platform,
    imageCount: Math.max(0, Number(message.imageCount) || 0),
    videoCount: Math.max(0, Number(message.videoCount) || 0),
    health: normalizeHealth(message.health),
    updatedAt: Date.now()
  });
}

function getStats() {
  const totals = {
    doubao: { imageCount: 0, videoCount: 0 },
    qianwen: { imageCount: 0, videoCount: 0 }
  };
  const health = {
    activePages: 0,
    readyPages: 0,
    warningPages: 0,
    platforms: {
      doubao: "inactive",
      qianwen: "inactive"
    }
  };

  for (const stat of pageStats.values()) {
    totals[stat.platform].imageCount += stat.imageCount;
    totals[stat.platform].videoCount += stat.videoCount;
    health.activePages += 1;
    const ready = stat.health.contentReady
      && (stat.platform !== "doubao" || stat.health.bridgeReady)
      && !stat.health.lastIssue;
    if (ready) {
      health.readyPages += 1;
      if (health.platforms[stat.platform] !== "warning") {
        health.platforms[stat.platform] = "ready";
      }
    } else {
      health.warningPages += 1;
      health.platforms[stat.platform] = "warning";
    }
  }

  return {
    success: true,
    version: APP_VERSION,
    totals,
    health,
    imageCount: totals.doubao.imageCount + totals.qianwen.imageCount,
    videoCount: totals.doubao.videoCount + totals.qianwen.videoCount
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;

  if (message.type === "MW_PING") {
    sendResponse({ success: true });
    return false;
  }

  if (message.type === "MW_STATUS_UPDATE") {
    updateStats(message, sender);
    sendResponse({ success: true });
    return false;
  }

  if (message.type === "MW_GET_STATUS") {
    sendResponse(getStats());
    return false;
  }

  if (message.type === "MW_DOWNLOAD") {
    downloadOne(message.item, sender).then(sendResponse);
    return true;
  }

  if (message.type === "MW_DOWNLOAD_MANY") {
    downloadMany(message.items, sender).then(sendResponse);
    return true;
  }

  if (message.type === "MW_RESOLVE_DOUBAO_VIDEO") {
    resolveDoubaoVideo(message.videoKey).then(sendResponse);
    return true;
  }

  return false;
});

chrome.tabs?.onRemoved?.addListener((tabId) => {
  for (const key of pageStats.keys()) {
    if (key.endsWith(`:${tabId}`)) pageStats.delete(key);
  }
});

chrome.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;
  for (const key of pageStats.keys()) {
    if (key.endsWith(`:${tabId}`)) pageStats.delete(key);
  }
});
