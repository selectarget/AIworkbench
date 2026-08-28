document.addEventListener('DOMContentLoaded', () => {
  const imageCount = document.getElementById('imageCount');
  const videoCount = document.getElementById('videoCount');
  const versionText = document.getElementById('versionText');

  chrome.runtime.sendMessage({ type: 'GET_IMAGE_LIST' }, (response) => {
    if (chrome.runtime.lastError) return;
    const images = Array.isArray(response?.data) ? response.data : [];
    if (imageCount) imageCount.textContent = String(images.length);
  });

  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (videoCount) videoCount.textContent = String(Number(response?.videoCount) || 0);
    if (versionText) versionText.textContent = `本地功能状态 · V${String(response?.version || '1.0')}`;
  });
});
