"use strict";

const imageCount = document.getElementById("imageCount");
const videoCount = document.getElementById("videoCount");
const version = document.getElementById("version");
const refreshButton = document.getElementById("refreshButton");
const healthStatus = document.getElementById("healthStatus");

function formatCount(value) {
  return String(Math.max(0, Number(value) || 0)).padStart(2, "0");
}

async function loadStatus() {
  refreshButton.classList.add("is-loading");
  try {
    if (!globalThis.chrome?.runtime?.sendMessage) return;
    const status = await chrome.runtime.sendMessage({ type: "MW_GET_STATUS" });
    if (!status?.success) return;
    imageCount.textContent = formatCount(status.imageCount);
    videoCount.textContent = formatCount(status.videoCount);
    version.textContent = `V${status.version || chrome.runtime.getManifest().version}`;
    const health = status.health || {};
    if (!health.activePages) {
      healthStatus.dataset.state = "inactive";
      healthStatus.textContent = "适配监测：未连接支持页面";
    } else if (health.warningPages) {
      healthStatus.dataset.state = "warning";
      healthStatus.textContent = `适配监测：${health.warningPages} 个页面需要检查`;
    } else {
      healthStatus.dataset.state = "ready";
      healthStatus.textContent = `适配监测：${health.readyPages} 个页面运行正常`;
    }
  } catch (_) {
    // 预览页面或扩展正在重载时保持默认状态。
  } finally {
    setTimeout(() => refreshButton.classList.remove("is-loading"), 180);
  }
}

refreshButton.addEventListener("click", loadStatus);
loadStatus();
