(function () {
  const SCRIPT_VERSION = '2026-07-02-select-v5';
  if (window.__AIAM_JIMENG_IMAGE_DOWNLOAD__ === SCRIPT_VERSION) return;
  window.__AIAM_JIMENG_IMAGE_DOWNLOAD__ = SCRIPT_VERSION;

  if (!/(^|\.)jimeng\.jianying\.com$/i.test(location.hostname)) return;

  const STYLE_ID = 'aiam-jimeng-original-download-style';
  const CARD_CLASS = 'aiam-jimeng-download-card';
  const BUTTON_CLASS = 'aiam-jimeng-original-download';
  const FLOAT_BUTTON_CLASS = 'aiam-jimeng-original-download-float';
  const PANEL_CLASS = 'aiam-jimeng-select-panel';
  const SELECT_HIT_CLASS = 'aiam-jimeng-select-hit';
  const STATUS_CLASS = 'aiam-jimeng-download-status';
  let hoverTarget = null;
  let selectionMode = false;
  let selectHoverNode = null;

  document.querySelectorAll(`.${BUTTON_CLASS},.${FLOAT_BUTTON_CLASS},.${PANEL_CLASS},.${STATUS_CLASS}`).forEach(node => node.remove());

  function isAssetPage() {
    return /^\/ai-tool\/asset(?:\/|$)/i.test(location.pathname);
  }

  function installStyle() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.documentElement.appendChild(style);
    }
    style.textContent = `
      .${CARD_CLASS} { position: relative !important; }
      .${BUTTON_CLASS} {
        position: absolute !important;
        right: 8px !important;
        bottom: 8px !important;
        z-index: 2147483647 !important;
        height: 32px !important;
        padding: 0 12px !important;
        border: none !important;
        border-radius: 999px !important;
        background: rgba(17, 24, 39, 0.9) !important;
        color: #fff !important;
        font-size: 12px !important;
        font-weight: 700 !important;
        line-height: 32px !important;
        cursor: pointer !important;
        box-shadow: 0 8px 22px rgba(0,0,0,.22) !important;
        opacity: 0 !important;
        pointer-events: none !important;
        transition: opacity .15s ease, transform .15s ease !important;
      }
      .${CARD_CLASS}:hover > .${BUTTON_CLASS},
      .${BUTTON_CLASS}:hover {
        opacity: 1 !important;
        pointer-events: auto !important;
        transform: translateY(-1px) !important;
      }
      .${BUTTON_CLASS}:hover { background: rgba(37, 99, 235, .96) !important; }
      .${PANEL_CLASS} {
        position: fixed !important;
        right: 24px !important;
        top: 82px !important;
        z-index: 2147483647 !important;
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        padding: 8px !important;
        border-radius: 12px !important;
        background: rgba(255,255,255,.96) !important;
        color: #111827 !important;
        box-shadow: 0 12px 32px rgba(15,23,42,.18) !important;
        border: 1px solid rgba(15,23,42,.08) !important;
        font-size: 13px !important;
        line-height: 1.3 !important;
      }
      .${PANEL_CLASS} button {
        height: 32px !important;
        padding: 0 12px !important;
        border: none !important;
        border-radius: 999px !important;
        background: #2563eb !important;
        color: #fff !important;
        font-size: 13px !important;
        font-weight: 700 !important;
        cursor: pointer !important;
      }
      .${PANEL_CLASS} button[data-active="1"] { background: #111827 !important; }
      .${PANEL_CLASS} span {
        max-width: 190px !important;
        color: #64748b !important;
        white-space: nowrap !important;
      }
      html.aiam-jimeng-select-mode img,
      html.aiam-jimeng-select-mode [style*="background-image"] {
        cursor: crosshair !important;
      }
      .${SELECT_HIT_CLASS} {
        outline: 3px solid #2563eb !important;
        outline-offset: -3px !important;
        box-shadow: inset 0 0 0 9999px rgba(37,99,235,.12) !important;
      }
      .${FLOAT_BUTTON_CLASS} {
        position: fixed !important;
        z-index: 2147483647 !important;
        height: 34px !important;
        padding: 0 14px !important;
        border: none !important;
        border-radius: 999px !important;
        background: rgba(17, 24, 39, 0.92) !important;
        color: #fff !important;
        font-size: 13px !important;
        font-weight: 700 !important;
        line-height: 34px !important;
        cursor: pointer !important;
        box-shadow: 0 8px 24px rgba(0,0,0,.24) !important;
        display: none;
      }
      .${FLOAT_BUTTON_CLASS}:hover { background: rgba(37, 99, 235, .96) !important; }
      .${STATUS_CLASS} {
        position: fixed !important;
        right: 84px !important;
        top: 90px !important;
        z-index: 2147483647 !important;
        max-width: 360px !important;
        padding: 9px 13px !important;
        border-radius: 999px !important;
        background: rgba(17,24,39,.92) !important;
        color: #fff !important;
        font-size: 13px !important;
        line-height: 1.35 !important;
        pointer-events: none !important;
        box-shadow: 0 10px 26px rgba(0,0,0,.24) !important;
      }
    `;
  }

  function showStatus(text) {
    installStyle();
    let node = document.querySelector(`.${STATUS_CLASS}`);
    if (!node) {
      node = document.createElement('div');
      node.className = STATUS_CLASS;
      document.documentElement.appendChild(node);
    }
    node.textContent = text;
    clearTimeout(node.__timer);
    node.__timer = setTimeout(() => node.remove(), 2200);
  }

  function visible(node) {
    if (!node || node === document.body || node === document.documentElement) return false;
    const rect = node.getBoundingClientRect();
    return rect.width >= 10 && rect.height >= 10 &&
      rect.bottom > 0 && rect.right > 0 &&
      rect.top < window.innerHeight && rect.left < window.innerWidth;
  }

  function isLikelyTile(node) {
    if (!node || node.closest('header,nav,aside,footer,[role="navigation"],[class*="logo"],[class*="icon"],[class*="avatar"]')) return false;
    const rect = node.getBoundingClientRect();
    return rect.width >= 96 && rect.height >= 96 &&
      rect.width <= window.innerWidth * 0.95 &&
      rect.height <= window.innerHeight * 0.95 &&
      visible(node);
  }

  function isLikelyUserImage(img) {
    if (!img || img.tagName !== 'IMG') return false;
    const src = String(img.currentSrc || img.src || '').toLowerCase();
    const w = img.naturalWidth || img.clientWidth || 0;
    const h = img.naturalHeight || img.clientHeight || 0;
    if (w < 96 || h < 96) return false;
    if (/logo|icon|avatar|placeholder|loading|empty|sprite|banner|background|default/i.test(src)) return false;
    return isLikelyTile(img);
  }

  function getBackgroundUrl(node) {
    try {
      const bg = getComputedStyle(node).backgroundImage || '';
      const match = bg.match(/url\(["']?([^"')]+)["']?\)/i);
      return match ? match[1] : '';
    } catch (e) {
      return '';
    }
  }

  function getCard(node) {
    return node.closest('[class*="asset"],[class*="work"],[class*="card"],[class*="image"],[class*="material"],[class*="creation"],li,article') ||
      node.parentElement ||
      node;
  }

  function findFiberRecord(node) {
    let current = node;
    while (current && current !== document.documentElement) {
      const fiberKey = Object.keys(current).find(key => key.startsWith('__reactFiber'));
      let fiber = fiberKey ? current[fiberKey] : null;
      while (fiber) {
        const props = fiber.memoizedProps;
        if (props?.record) return props.record;
        if (props?.item && (props.item.imageList || props.item.itemList)) return props.item;
        fiber = fiber.return;
      }
      current = current.parentElement;
    }
    return null;
  }

  function normalizeUri(value) {
    const text = String(value || '');
    const match = text.match(/tos-[^/?#"'\\]+\/[a-z0-9]{16,}/i);
    return match ? match[0] : '';
  }

  function selectImageFromRecord(record, imageNode) {
    const images = Array.isArray(record?.imageList) ? record.imageList : [];
    if (!images.length) return null;

    const thumbUri = normalizeUri(imageNode?.currentSrc || imageNode?.src || '');
    if (thumbUri) {
      const matched = images.find(item => {
        const uri = normalizeUri(item.imageUri || item.downloadUri || item.coverUri || item.downloadUrl || item.coverUrl);
        return uri && uri === thumbUri;
      });
      if (matched) return matched;
    }

    return images[0];
  }

  function buildImageInfo(format) {
    const imageFormat = format || 'webp';
    return {
      width: 2048,
      height: 2048,
      format: imageFormat,
      image_scene_list: [
        { scene: 'normal', width: 2048, height: 2048, uniq_key: '2048', format: imageFormat },
        { scene: 'loss', width: 360, height: 360, uniq_key: '360', format: imageFormat }
      ]
    };
  }

  async function fetchWorkDetail(itemId, preferNoWatermark) {
    const body = {
      item_id_list: [String(itemId)],
      pack_item_opt: {
        scene: 'Download',
        need_data_integrity: true
      },
      image_info: buildImageInfo('webp'),
      is_for_video_download: false
    };
    if (preferNoWatermark) {
      body.pack_item_opt.use_commerce_benefits_type = 'rwm';
    }

    const res = await fetch('/mweb/v1/get_local_item_list', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await res.json().catch(() => null);
    if (!json || json.ret !== '0') {
      throw new Error(json?.errmsg || `接口失败 ${res.status}`);
    }
    return json.data?.item_list?.[0] || null;
  }

  function scoreUrl(url, width, height) {
    const text = String(url || '');
    let score = Number(width || 0) * Number(height || 0) / 10000;
    if (/aigc_resize(?::|_)/i.test(text)) score += 800;
    if (/origin|original|source|raw|large/i.test(text)) score += 120;
    if (/aigc_(?:resize_)?mark|busi_mark|watermark|wm_/i.test(text)) score -= 1200;
    if (/2048|2560|0:0/i.test(text)) score += 80;
    return score;
  }

  function collectImageCandidates(detail) {
    const candidates = [];
    const push = (url, width, height, source) => {
      if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
      if (!/\.(png|jpe?g|webp)(\?|#|$)|[?&]format=\.?(png|jpe?g|webp)(?:&|$)|\.image(?:\?|#|$)/i.test(url)) return;
      candidates.push({ url, width, height, source, score: scoreUrl(url, width, height) });
    };

    const image = detail?.image || {};
    (image.large_images || []).forEach(item => {
      push(item.image_url, item.width, item.height, 'large_images');
    });

    const common = detail?.common_attr || {};
    push(common.cover_url, common.cover_width, common.cover_height, 'cover_url');
    Object.entries(common.cover_url_map || {}).forEach(([key, url]) => {
      const size = Number(key) || 0;
      push(url, size, size, `cover_url_map_${key}`);
    });

    candidates.forEach(item => {
      if (item.source === 'large_images') item.score += 500;
      if (/\.png(?:\?|#|$)|format=\.?png/i.test(item.url)) item.score += 80;
    });
    return candidates.sort((a, b) => b.score - a.score);
  }

  function sanitizeFilename(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .trim()
      .slice(0, 48);
  }

  function getTitle(record, detail) {
    const common = detail?.common_attr || {};
    return sanitizeFilename(common.title || common.description || record?.prompt || record?.text2ImageParams?.prompt || '即梦原图') || '即梦原图';
  }

  function getImageExtension(url) {
    const path = String(url || '').split('?')[0];
    const match = path.match(/\.(png|jpe?g|webp|image)$/i);
    if (!match) return '.png';
    const ext = match[1].toLowerCase();
    if (ext === 'jpeg') return '.jpg';
    if (ext === 'image') return '.png';
    return `.${ext}`;
  }

  function postDownload(url, filename) {
    window.postMessage({
      type: 'electronDownload',
      data: { url, filename }
    }, '*');
  }

  async function downloadFromTarget(node, button) {
    if (!node) throw new Error('未选中图片');
    const image = node.tagName === 'IMG' ? node : node.querySelector?.('img');
    await resolveSingleImage(getCard(node) || node, image || node, button);
  }

  async function resolveSingleImage(card, imageNode, button) {
    const record = findFiberRecord(imageNode || card);
    const image = selectImageFromRecord(record, imageNode);
    const itemId = image?.itemId ||
      image?.publishedItemId ||
      record?.itemList?.[0]?.commonAttr?.id ||
      record?.itemList?.[0]?.id;

    if (!itemId) {
      throw new Error('未找到图片 itemId');
    }

    button.textContent = '解析中';
    let detail = null;
    let usedFallback = false;
    try {
      detail = await fetchWorkDetail(itemId, true);
    } catch (e) {
      usedFallback = true;
      detail = await fetchWorkDetail(itemId, false);
    }

    const candidates = collectImageCandidates(detail);
    const best = candidates[0];
    if (!best?.url) {
      throw new Error('接口未返回大图');
    }

    const hasMarkInUrl = /aigc_(?:resize_)?mark|busi_mark|watermark|wm_/i.test(best.url);
    const title = getTitle(record, detail);
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const filename = `即梦_${title}_${stamp}${getImageExtension(best.url)}`;
    postDownload(best.url, filename);

    button.textContent = '已发送';
    if (usedFallback || hasMarkInUrl) {
      showStatus('已发送下载，但当前账号接口没有返回无水印链');
    } else {
      showStatus('已发送即梦原图下载');
    }
  }

  function ensureButtonForNode(node, imageNode) {
    if (!isAssetPage() || !isLikelyTile(node)) return;
    installStyle();
    let host = node;
    if (!host || host.tagName === 'IMG') host = getCard(imageNode || node);
    if (!host || host.tagName === 'IMG' || !host.appendChild) return;
    if (host.querySelector?.(`:scope > .${BUTTON_CLASS}`)) return;

    host.classList.add(CARD_CLASS);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    button.textContent = '原图下载';
    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await resolveSingleImage(host, imageNode || host.querySelector?.('img') || host, button);
      } catch (e) {
        button.textContent = '解析失败';
        showStatus(`即梦原图解析失败：${e.message || '未知错误'}`);
      } finally {
        setTimeout(() => { button.textContent = '原图下载'; }, 1800);
      }
    }, true);
    host.appendChild(button);
  }

  function getNodeAtPoint(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const pathNode = path.find(node => {
      if (!(node instanceof Element)) return false;
      if (node.tagName === 'IMG' && isLikelyUserImage(node)) return true;
      if (getBackgroundUrl(node) && isLikelyTile(node)) return true;
      return false;
    });
    if (pathNode) return pathNode;

    const elements = document.elementsFromPoint?.(event.clientX, event.clientY) || [];
    const pointNode = elements.find(node => {
      if (!(node instanceof Element)) return false;
      if (node.tagName === 'IMG' && isLikelyUserImage(node)) return true;
      const img = node.querySelector?.('img');
      if (img && isLikelyUserImage(img)) return true;
      if (getBackgroundUrl(node) && isLikelyTile(node)) return true;
      return false;
    });
    if (pointNode) return pointNode.tagName === 'IMG' ? pointNode : (pointNode.querySelector?.('img') || pointNode);

    return Array.from(document.querySelectorAll('img')).find(img => {
      if (!isLikelyUserImage(img)) return false;
      const rect = img.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom;
    }) || null;
  }

  function ensureFloatButton() {
    installStyle();
    let button = document.querySelector(`.${FLOAT_BUTTON_CLASS}`);
    if (button) {
      button.textContent = '原图下载';
      return button;
    }

    button = document.createElement('button');
    button.type = 'button';
    button.className = FLOAT_BUTTON_CLASS;
    button.textContent = '原图下载';
    button.addEventListener('mouseenter', () => {
      if (hoverTarget) hoverTarget.keep = true;
    }, true);
    button.addEventListener('mouseleave', () => {
      if (hoverTarget) hoverTarget.keep = false;
      setTimeout(hideFloatButtonIfNeeded, 180);
    }, true);
    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      if (!hoverTarget?.node) return;
      try {
        await resolveSingleImage(hoverTarget.card || hoverTarget.node, hoverTarget.image || hoverTarget.node, button);
      } catch (e) {
        button.textContent = '解析失败';
        showStatus(`即梦原图解析失败：${e.message || '未知错误'}`);
      } finally {
        setTimeout(() => { button.textContent = '原图下载'; }, 1800);
      }
    }, true);
    document.documentElement.appendChild(button);
    return button;
  }

  function positionFloatButton(node) {
    if (!isAssetPage() || !node || !isLikelyTile(node)) return;
    const image = node.tagName === 'IMG' ? node : node.querySelector?.('img');
    const card = getCard(node) || node;
    const rect = (image && visible(image) ? image : node).getBoundingClientRect();
    if (rect.width < 96 || rect.height < 96) return;

    hoverTarget = { node, image, card, keep: false, ts: Date.now() };
    const button = ensureFloatButton();
    button.style.left = `${Math.max(8, Math.min(window.innerWidth - 116, rect.right - 106))}px`;
    button.style.top = `${Math.max(8, Math.min(window.innerHeight - 46, rect.bottom - 42))}px`;
    button.style.setProperty('display', 'block', 'important');
  }

  function hideFloatButtonIfNeeded() {
    const button = document.querySelector(`.${FLOAT_BUTTON_CLASS}`);
    if (!button || hoverTarget?.keep) return;
    if (hoverTarget && Date.now() - hoverTarget.ts < 260) return;
    button.style.setProperty('display', 'none', 'important');
  }

  function updateSelectionPanel() {
    const panel = document.querySelector(`.${PANEL_CLASS}`);
    if (!panel) return;
    const button = panel.querySelector('button');
    const label = panel.querySelector('span');
    if (button) {
      button.dataset.active = selectionMode ? '1' : '0';
      button.textContent = selectionMode ? '选择中...' : '选择图片下载原图';
    }
    if (label) {
      label.textContent = selectionMode ? '现在点一张图片' : '用于资产页无水印原图';
    }
  }

  function setSelectionMode(active) {
    selectionMode = Boolean(active);
    document.documentElement.classList.toggle('aiam-jimeng-select-mode', selectionMode);
    if (!selectionMode && selectHoverNode) {
      selectHoverNode.classList.remove(SELECT_HIT_CLASS);
      selectHoverNode = null;
    }
    updateSelectionPanel();
    if (selectionMode) {
      showStatus('已开启即梦原图选择：请点一张要下载的图片');
    }
  }

  function ensureSelectionPanel() {
    if (!isAssetPage()) return null;
    installStyle();
    let panel = document.querySelector(`.${PANEL_CLASS}`);
    if (panel) {
      updateSelectionPanel();
      return panel;
    }

    panel = document.createElement('div');
    panel.className = PANEL_CLASS;

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '选择图片下载原图';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      setSelectionMode(!selectionMode);
    }, true);

    const label = document.createElement('span');
    label.textContent = '用于资产页无水印原图';

    panel.appendChild(button);
    panel.appendChild(label);
    document.documentElement.appendChild(panel);
    updateSelectionPanel();
    return panel;
  }

  function setupSelectionResolver() {
    if (window.__AIAM_JIMENG_SELECTION_RESOLVER__ === SCRIPT_VERSION) return;
    window.__AIAM_JIMENG_SELECTION_RESOLVER__ = SCRIPT_VERSION;

    document.addEventListener('mousemove', event => {
      if (!selectionMode || !isAssetPage()) return;
      const node = getNodeAtPoint(event);
      if (node === selectHoverNode) return;
      if (selectHoverNode) selectHoverNode.classList.remove(SELECT_HIT_CLASS);
      selectHoverNode = node || null;
      if (selectHoverNode) selectHoverNode.classList.add(SELECT_HIT_CLASS);
    }, true);

    document.addEventListener('click', async event => {
      if (!selectionMode || !isAssetPage()) return;
      if (event.target?.closest?.(`.${PANEL_CLASS},.${BUTTON_CLASS},.${FLOAT_BUTTON_CLASS}`)) return;

      const node = getNodeAtPoint(event);
      if (!node) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      const panel = ensureSelectionPanel();
      const button = panel?.querySelector('button') || { textContent: '' };
      try {
        await downloadFromTarget(node, button);
        setSelectionMode(false);
      } catch (e) {
        button.textContent = '解析失败';
        showStatus(`即梦原图解析失败：${e.message || '未知错误'}`);
        setTimeout(updateSelectionPanel, 1600);
      }
    }, true);
  }

  window.__AIAM_JIMENG_SCRIPT_VERSION__ = SCRIPT_VERSION;
  window.__AIAM_JIMENG_START_SELECT__ = () => {
    if (!isAssetPage()) {
      showStatus('请先进入即梦资产页');
      return false;
    }
    ensureSelectionPanel();
    setSelectionMode(true);
    return true;
  };

  function setupHoverResolver() {
    if (window.__AIAM_JIMENG_HOVER_RESOLVER__ === SCRIPT_VERSION) return;
    window.__AIAM_JIMENG_HOVER_RESOLVER__ = SCRIPT_VERSION;
    document.addEventListener('mousemove', event => {
      if (!isAssetPage()) return;
      const node = getNodeAtPoint(event);
      if (node) {
        positionFloatButton(node);
      } else {
        setTimeout(hideFloatButtonIfNeeded, 220);
      }
    }, true);
    window.addEventListener('scroll', () => {
      const button = document.querySelector(`.${FLOAT_BUTTON_CLASS}`);
      if (button) button.style.setProperty('display', 'none', 'important');
    }, true);
  }

  function scan() {
    if (!isAssetPage()) return;
    ensureSelectionPanel();
    document.querySelectorAll('img').forEach(img => {
      if (!isLikelyUserImage(img)) return;
      ensureButtonForNode(getCard(img) || img, img);
    });
    document.querySelectorAll('div,li,article,section').forEach(node => {
      if (!getBackgroundUrl(node)) return;
      ensureButtonForNode(node, node.querySelector?.('img') || node);
    });
  }

  let started = false;
  function start() {
    if (started) return;
    const root = document.documentElement || document.body;
    if (!root) {
      setTimeout(start, 50);
      return;
    }
    started = true;
    root.classList.remove('aiam-jimeng-select-mode');
    const observer = new MutationObserver(() => {
      clearTimeout(observer._timer);
      observer._timer = setTimeout(scan, 300);
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'style', 'data-src', 'data-url']
    });

    window.addEventListener('load', scan, true);
    window.addEventListener('scroll', () => {
      clearTimeout(window.__AIAM_JIMENG_SCROLL_TIMER__);
      window.__AIAM_JIMENG_SCROLL_TIMER__ = setTimeout(scan, 250);
    }, true);
    ensureSelectionPanel();
    setupSelectionResolver();
    setupHoverResolver();
    scan();
    setInterval(scan, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
