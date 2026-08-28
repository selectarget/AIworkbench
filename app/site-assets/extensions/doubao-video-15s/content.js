(function () {
  'use strict';

  const TARGET_DURATION = 15;
  const TARGET_MODEL = 'seedance_v2.0';
  const STORAGE_KEY = 'codex_doubao_video_duration_choice';
  const MARK = 'data-codex-doubao-cn-15s';
  const STYLE_ID = 'codex-doubao-cn-15s-style';
  const FALLBACK_MENU_ID = 'codex-doubao-cn-15s-fallback-menu';
  let timer = 0;
  let toolbarSyncTimer = 0;
  let lastToolbarTrigger = null;

  function selectedDuration() {
    try {
      return Number(localStorage.getItem(STORAGE_KEY)) || 0;
    } catch (_) {
      return 0;
    }
  }

  function saveDuration(seconds) {
    try {
      if (seconds) localStorage.setItem(STORAGE_KEY, String(seconds));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (_) { }
  }

  function isCompletionUrl(input) {
    const raw = typeof input === 'string'
      ? input
      : (input && (input.url || input.href)) || String(input || '');
    try {
      const url = new URL(raw, location.href);
      return /(^|\.)(doubao|dola|ciciai)\.com$/.test(url.hostname) && url.pathname === '/chat/completion';
      // return /(^|\.)doubao\.com$/.test(url.hostname) && url.pathname === '/chat/completion';
    } catch (_) {
      return /\/chat\/completion(?:\?|$)/.test(raw);
    }
  }

  function parseAbilityParam(value) {
    if (value && typeof value === 'object') return { ...value };
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch (_) { }
    }
    return {};
  }

  function patchBody(rawBody) {
    if (typeof rawBody !== 'string' || !rawBody.trim()) return { changed: false, body: rawBody };
    if (selectedDuration() !== TARGET_DURATION) return { changed: false, body: rawBody };

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (_) {
      return { changed: false, body: rawBody };
    }

    const ability = payload && payload.chat_ability;
    if (!ability || Number(ability.ability_type) !== 17) return { changed: false, body: rawBody };

    const param = parseAbilityParam(ability.ability_param);
    param.model = TARGET_MODEL;
    param.duration = TARGET_DURATION;
    ability.ability_param = JSON.stringify(param);
    return { changed: true, body: JSON.stringify(payload) };
  }

  function patchFetch() {
    if (typeof window.fetch !== 'function' || window.fetch.__codexDoubaoCn15s) return;
    const originalFetch = window.fetch;

    async function patchedFetch(input, init) {
      try {
        if (!isCompletionUrl(input)) return originalFetch.apply(this, arguments);

        if (init && Object.prototype.hasOwnProperty.call(init, 'body')) {
          const patched = patchBody(init.body);
          if (patched.changed) return originalFetch.call(this, input, { ...init, body: patched.body });
          return originalFetch.apply(this, arguments);
        }

        if (window.Request && input instanceof window.Request && String(input.method || '').toUpperCase() === 'POST') {
          const raw = await input.clone().text();
          const patched = patchBody(raw);
          if (patched.changed) return originalFetch.call(this, new window.Request(input, { body: patched.body }), init);
        }
      } catch (error) {
        console.warn('[Doubao CN 15s] fetch patch failed:', error);
      }
      return originalFetch.apply(this, arguments);
    }

    patchedFetch.__codexDoubaoCn15s = true;
    window.fetch = patchedFetch;
  }

  function patchXhr() {
    const proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (!proto || proto.__codexDoubaoCn15s) return;

    const originalOpen = proto.open;
    const originalSend = proto.send;

    proto.open = function (method, url) {
      this.__codexDoubaoCn15sMethod = method;
      this.__codexDoubaoCn15sUrl = url;
      return originalOpen.apply(this, arguments);
    };

    proto.send = function (body) {
      try {
        if (
          String(this.__codexDoubaoCn15sMethod || '').toUpperCase() === 'POST' &&
          isCompletionUrl(this.__codexDoubaoCn15sUrl)
        ) {
          const patched = patchBody(body);
          if (patched.changed) return originalSend.call(this, patched.body);
        }
      } catch (error) {
        console.warn('[Doubao CN 15s] xhr patch failed:', error);
      }
      return originalSend.apply(this, arguments);
    };

    proto.__codexDoubaoCn15s = true;
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function text(el) {
    return String((el && el.textContent) || '').replace(/\s+/g, '').replace(/[✓✔√]/g, '').trim();
  }

  function exactDuration(el) {
    const match = text(el).match(/^(5|10|15)(?:s|秒)?$/i);
    return match ? Number(match[1]) : 0;
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [${MARK}="option"] {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 26px !important;
        cursor: pointer !important;
      }
      [${MARK}="option"] [${MARK}-check] {
        margin-left: auto;
        flex: 0 0 auto;
        color: currentColor;
        font-size: 18px;
        line-height: 1;
      }
      [${MARK}-native-check="hidden"] {
        visibility: hidden !important;
      }
      #${FALLBACK_MENU_ID} {
        position: fixed !important;
        z-index: 2147483647 !important;
        min-width: 96px !important;
        padding: 6px !important;
        border-radius: 12px !important;
        border: 1px solid rgba(15, 23, 42, 0.12) !important;
        background: #fff !important;
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18) !important;
        color: #0f172a !important;
        font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      }
      #${FALLBACK_MENU_ID} button {
        width: 100% !important;
        height: 34px !important;
        border: 0 !important;
        border-radius: 8px !important;
        background: transparent !important;
        color: inherit !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        padding: 0 10px !important;
        cursor: pointer !important;
        font: inherit !important;
      }
      #${FALLBACK_MENU_ID} button:hover,
      #${FALLBACK_MENU_ID} button[aria-selected="true"] {
        background: rgba(37, 99, 235, 0.10) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function closestClickable(el) {
    let current = el && el.nodeType === Node.TEXT_NODE ? el.parentElement : el;
    for (let i = 0; current && i < 7; i += 1, current = current.parentElement) {
      const role = current.getAttribute && current.getAttribute('role');
      if (
        current.tagName === 'BUTTON' ||
        role === 'button' ||
        role === 'menuitem' ||
        role === 'option' ||
        current.tabIndex >= 0 ||
        /pointer/.test(String(getComputedStyle(current).cursor || ''))
      ) {
        return current;
      }
    }
    return el && el.parentElement;
  }

  function findDurationMenuRoot() {
    if (!document.body) return null;
    const candidates = Array.from(document.querySelectorAll('[role="menu"], [data-slot*="dropdown-menu"], div'))
      .filter(visible)
      .filter(el => {
        const t = text(el);
        if (t.length > 220) return false;
        const hasDurationOptions = /5(?:s|秒)?/i.test(t) && /10(?:s|秒)?/i.test(t);
        if (!hasDurationOptions) return false;
        const hasDurationLabel = /时长|duration/i.test(t);
        const compactDurationMenu = t.length <= 90 && /(5|10)(?:s|秒)/i.test(t);
        if (!hasDurationLabel && !compactDurationMenu) return false;
        return !/Seedance/.test(t) && !/比例/.test(t);
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      });
    return candidates[0] || null;
  }

  function optionTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return /^\s*(5|10|15)(?:s|秒)?\s*$/i.test(node.nodeValue || '')
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function findMenuOptions(root) {
    const out = [];
    for (const node of optionTextNodes(root)) {
      const parent = node.parentElement;
      if (!visible(parent)) continue;
      const item = closestClickable(parent);
      if (!item || !root.contains(item)) continue;
      if (!exactDuration(item)) continue;
      if (out.some(existing => existing === item || existing.contains(item))) continue;
      for (let i = out.length - 1; i >= 0; i -= 1) {
        if (item.contains(out[i])) out.splice(i, 1);
      }
      out.push(item);
    }
    return out;
  }

  function durationTextNode(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (/^\s*(5|10|15)(?:s|秒)?\s*$/i.test(walker.currentNode.nodeValue || '')) return walker.currentNode;
    }
    return null;
  }

  function removeOwnChecks(el) {
    el.querySelectorAll(`[${MARK}-check]`).forEach(node => node.remove());
  }

  function setNativeChecksHidden(item, hidden) {
    item.querySelectorAll(`[${MARK}-native-check]`).forEach(node => node.removeAttribute(`${MARK}-native-check`));
    if (!hidden) return;

    item.querySelectorAll('svg,img,canvas').forEach(node => node.setAttribute(`${MARK}-native-check`, 'hidden'));

    const nodes = [];
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return /[✓✔√]/.test(node.nodeValue || '')
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      const parent = node.parentElement;
      if (parent && /^[\s✓✔√]+$/.test(parent.textContent || '')) {
        parent.setAttribute(`${MARK}-native-check`, 'hidden');
      }
    }
  }

  function scrubClone(clone) {
    clone.removeAttribute('aria-selected');
    clone.removeAttribute('aria-checked');
    clone.removeAttribute('checked');
    clone.removeAttribute('selected');
    removeOwnChecks(clone);
    clone.removeAttribute(`${MARK}-active`);
    const node = durationTextNode(clone);
    if (node) node.nodeValue = '15s';
    else clone.textContent = '15s';
  }

  function setToolbarText(seconds) {
    const next = seconds === TARGET_DURATION ? '15s' : `${seconds}s`;
    const menuRoot = findDurationMenuRoot();
    const nodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return /^\s*(5|10|15)(?:s|秒)?\s*$/i.test(node.nodeValue || '')
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      const parent = node.parentElement;
      if (!visible(parent)) continue;
      if (menuRoot && menuRoot.contains(parent)) continue;
      const click = closestClickable(parent);
      if (!click || !visible(click)) continue;
      if (menuRoot && menuRoot.contains(click)) continue;
      const role = click.getAttribute && click.getAttribute('role');
      if (role === 'menuitem' || role === 'option') continue;

      const rect = click.getBoundingClientRect();
      const compactDurationTrigger =
        exactDuration(click) &&
        rect.width > 24 &&
        rect.width < 180 &&
        rect.height > 20 &&
        rect.height < 80;

      let groupedDurationTrigger = false;
      let current = click.parentElement;
      for (let i = 0; current && i < 7; i += 1, current = current.parentElement) {
        const t = text(current);
        if (t.length < 260 && /(比例|模型|Seedance|Mini|Fast|2\.0)/.test(t) && /(5|10|15)s/.test(t)) {
          groupedDurationTrigger = true;
          break;
        }
      }

      if (compactDurationTrigger || groupedDurationTrigger) {
        node.nodeValue = next;
        click.setAttribute(`${MARK}-selected-duration`, String(seconds));
        if (!click.hasAttribute(`${MARK}-trigger`)) {
          click.setAttribute(`${MARK}-trigger`, '1');
          click.addEventListener('click', () => {
            setTimeout(inject15Option, 80);
            setTimeout(inject15Option, 240);
          }, true);
        }
      }
    }
    syncToolbarDurationText(next, menuRoot);
    if (seconds === TARGET_DURATION) forceVisibleToolbarDurationButtons(TARGET_DURATION);
  }

  function isInsideDurationMenu(el, menuRoot) {
    if (!el) return false;
    if (menuRoot && menuRoot.contains(el)) return true;
    let current = el;
    for (let i = 0; current && i < 6; i += 1, current = current.parentElement) {
      const role = current.getAttribute && current.getAttribute('role');
      if (role === 'menu' || role === 'menuitem' || role === 'option' || role === 'listbox') return true;
    }
    return false;
  }

  function looksLikeToolbarDurationNode(node, menuRoot) {
    const parent = node && node.parentElement;
    if (!parent || !visible(parent) || isInsideDurationMenu(parent, menuRoot)) return false;

    let current = parent;
    for (let i = 0; current && i < 8; i += 1, current = current.parentElement) {
      if (!visible(current) || isInsideDurationMenu(current, menuRoot)) continue;
      const rect = current.getBoundingClientRect();
      const t = text(current);
      const compact =
        rect.width >= 18 &&
        rect.width <= 260 &&
        rect.height >= 16 &&
        rect.height <= 96;
      const hasDuration = /^(5|10|15)(?:s|秒)?$/i.test(t) || /(^|[^0-9])(5|10|15)(?:s|秒)([^0-9]|$)/i.test(t);
      const hasToolbarContext = /Seedance|Mini|Fast|2\.0|比例|模型|时长|duration/i.test(t) || current.hasAttribute(`${MARK}-trigger`);
      if (compact && (hasDuration || hasToolbarContext)) return true;
    }
    return false;
  }

  function syncToolbarDurationText(next, menuRoot) {
    if (!document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return /^\s*(5|10|15)(?:s|秒)?\s*$/i.test(node.nodeValue || '')
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      if (looksLikeToolbarDurationNode(node, menuRoot)) {
        node.nodeValue = next;
        const click = closestClickable(node.parentElement);
        if (click && !isInsideDurationMenu(click, menuRoot)) {
          click.setAttribute(`${MARK}-selected-duration`, next);
          if (!click.hasAttribute(`${MARK}-trigger`)) {
            click.setAttribute(`${MARK}-trigger`, '1');
            click.addEventListener('click', () => {
              setTimeout(inject15Option, 80);
              setTimeout(inject15Option, 240);
            }, true);
          }
        }
      }
    }
  }

  function forceTriggerDurationText(trigger, seconds) {
    if (!trigger || !trigger.isConnected) return false;
    const next = seconds === TARGET_DURATION ? '15s' : `${seconds}s`;
    let changed = false;
    const walker = document.createTreeWalker(trigger, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return durationValueFromText(node.nodeValue)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      node.nodeValue = next;
      changed = true;
    }
    trigger.setAttribute(`${MARK}-selected-duration`, String(seconds));
    return changed;
  }

  function forceDurationTextInElement(el, seconds) {
    if (!el || !el.isConnected) return false;
    const next = seconds === TARGET_DURATION ? '15s' : `${seconds}s`;
    let changed = false;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return durationValueFromText(node.nodeValue)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      node.nodeValue = next;
      changed = true;
    }
    if (changed) el.setAttribute(`${MARK}-selected-duration`, String(seconds));
    return changed;
  }

  function isNativeMenuNode(el) {
    if (!el) return false;
    if (el.closest(`#${FALLBACK_MENU_ID}`)) return true;
    let current = el;
    for (let i = 0; current && i < 8; i += 1, current = current.parentElement) {
      const role = current.getAttribute && current.getAttribute('role');
      if (role === 'menu' || role === 'menuitem' || role === 'option' || role === 'listbox') return true;
      const t = text(current);
      const rect = current.getBoundingClientRect();
      if (
        rect.width <= 260 &&
        rect.height <= 260 &&
        /时长|duration/i.test(t) &&
        /5s/i.test(t) &&
        /10s/i.test(t)
      ) {
        return true;
      }
    }
    return false;
  }

  function isToolbarDurationButton(el) {
    if (!el || !visible(el) || isNativeMenuNode(el)) return false;
    const tag = String(el.tagName || '').toUpperCase();
    const role = el.getAttribute && el.getAttribute('role');
    if (tag !== 'BUTTON' && role !== 'button') return false;
    if (!durationValueFromText(el.textContent)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 32 && rect.width <= 190 && rect.height >= 24 && rect.height <= 80;
  }

  function closestButtonLike(el) {
    let current = el && el.nodeType === Node.TEXT_NODE ? el.parentElement : el;
    for (let i = 0; current && i < 8; i += 1, current = current.parentElement) {
      const role = current.getAttribute && current.getAttribute('role');
      if (current.tagName === 'BUTTON' || role === 'button' || role === 'menuitem' || role === 'option') {
        return current;
      }
    }
    return el && el.parentElement;
  }

  function closestDurationChoice(el) {
    let current = el && el.nodeType === Node.TEXT_NODE ? el.parentElement : el;
    for (let i = 0; current && i < 8; i += 1, current = current.parentElement) {
      const value = durationValueFromText(current.textContent);
      if (value) return { node: current, value };
      const role = current.getAttribute && current.getAttribute('role');
      if (role === 'menu' || role === 'listbox') break;
    }
    return { node: null, value: 0 };
  }

  function applySelectedDuration(seconds) {
    if (seconds === TARGET_DURATION) {
      saveDuration(TARGET_DURATION);
      forceTriggerDurationText(lastToolbarTrigger, TARGET_DURATION);
      forceVisibleToolbarDurationButtons(TARGET_DURATION);
      setToolbarText(TARGET_DURATION);
      keepToolbarTextSynced();
      [30, 80, 160, 240, 400, 600, 900, 1200, 1800, 2500].forEach(delay => {
        setTimeout(() => {
          forceTriggerDurationText(lastToolbarTrigger, TARGET_DURATION);
          forceVisibleToolbarDurationButtons(TARGET_DURATION);
          setToolbarText(TARGET_DURATION);
        }, delay);
      });
      return;
    }

    if (seconds === 5 || seconds === 10) {
      saveDuration(0);
      forceTriggerDurationText(lastToolbarTrigger, seconds);
      forceVisibleToolbarDurationButtons(seconds);
      setToolbarText(seconds);
    }
  }

  function installGlobalDurationClickCapture() {
    if (window.__AIAM_DOUBAO_15S_CLICK_CAPTURE__) return;
    window.__AIAM_DOUBAO_15S_CLICK_CAPTURE__ = true;
    document.addEventListener('click', event => {
      const buttonLike = closestButtonLike(event.target);
      if (isToolbarDurationButton(buttonLike)) {
        lastToolbarTrigger = buttonLike;
        setTimeout(inject15Option, 80);
        setTimeout(inject15Option, 240);
        return;
      }

      const choice = closestDurationChoice(event.target);
      if (!choice.value) return;
      if (!isNativeMenuNode(choice.node)) return;
      setTimeout(() => applySelectedDuration(choice.value), 0);
      setTimeout(() => applySelectedDuration(choice.value), 80);
      setTimeout(() => applySelectedDuration(choice.value), 240);
    }, true);
  }

  function forceVisibleToolbarDurationButtons(seconds) {
    if (!document.body) return false;
    let changed = false;
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible);
    for (const button of buttons) {
      if (isNativeMenuNode(button)) continue;
      if (!durationValueFromText(button.textContent)) continue;
      const rect = button.getBoundingClientRect();
      const compact =
        rect.width >= 32 &&
        rect.width <= 180 &&
        rect.height >= 24 &&
        rect.height <= 72;
      if (!compact) continue;
      const hasIcon = !!button.querySelector('svg,img,canvas');
      const inLowerInputArea = rect.top > window.innerHeight * 0.45;
      const alreadyKnown = button.hasAttribute(`${MARK}-fallback-bound`) || button.hasAttribute(`${MARK}-trigger`);
      if (hasIcon || inLowerInputArea || alreadyKnown) {
        changed = forceDurationTextInElement(button, seconds) || changed;
      }
    }
    return changed;
  }

  function keepToolbarTextSynced() {
    clearInterval(toolbarSyncTimer);
    let left = 40;
    toolbarSyncTimer = setInterval(() => {
      if (selectedDuration() !== TARGET_DURATION || left <= 0) {
        clearInterval(toolbarSyncTimer);
        toolbarSyncTimer = 0;
        return;
      }
      left -= 1;
      forceVisibleToolbarDurationButtons(TARGET_DURATION);
      setToolbarText(TARGET_DURATION);
    }, 250);
  }

  function durationValueFromText(value) {
    const match = String(value || '').replace(/\s+/g, '').match(/^(5|10|15)(?:s|\u79d2)?$/i);
    return match ? Number(match[1]) : 0;
  }

  function hideFallbackMenu() {
    const old = document.getElementById(FALLBACK_MENU_ID);
    if (old) old.remove();
  }

  function findToolbarDurationTriggers() {
    if (!document.body) return [];
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return durationValueFromText(node.nodeValue)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });

    while (walker.nextNode()) {
      const parent = walker.currentNode.parentElement;
      if (!parent || !visible(parent) || parent.closest(`#${FALLBACK_MENU_ID}`)) continue;
      const click = closestClickable(parent);
      if (!click || !visible(click) || click.closest(`#${FALLBACK_MENU_ID}`)) continue;
      if (isInsideDurationMenu(click, findDurationMenuRoot())) continue;
      const role = click.getAttribute && click.getAttribute('role');
      if (role === 'menuitem' || role === 'option') continue;
      const rect = click.getBoundingClientRect();
      if (rect.width < 24 || rect.width > 220 || rect.height < 20 || rect.height > 90) continue;
      if (!out.includes(click)) out.push(click);
    }
    return out;
  }

  function hasVisible15MenuOption() {
    if (document.getElementById(FALLBACK_MENU_ID)) return true;
    const menuRoot = findDurationMenuRoot();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return durationValueFromText(node.nodeValue) === TARGET_DURATION
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    while (walker.nextNode()) {
      const parent = walker.currentNode.parentElement;
      if (parent && visible(parent) && isInsideDurationMenu(parent, menuRoot)) return true;
    }
    return false;
  }

  function chooseFallbackDuration(seconds, trigger) {
    const toolbarTrigger = trigger || lastToolbarTrigger;
    hideFallbackMenu();
    if (seconds === TARGET_DURATION) {
      saveDuration(TARGET_DURATION);
      forceTriggerDurationText(toolbarTrigger, TARGET_DURATION);
      forceVisibleToolbarDurationButtons(TARGET_DURATION);
      setToolbarText(TARGET_DURATION);
      keepToolbarTextSynced();
      setTimeout(() => forceTriggerDurationText(toolbarTrigger, TARGET_DURATION), 30);
      setTimeout(() => forceTriggerDurationText(toolbarTrigger, TARGET_DURATION), 80);
      setTimeout(() => forceTriggerDurationText(toolbarTrigger, TARGET_DURATION), 240);
      setTimeout(() => forceTriggerDurationText(toolbarTrigger, TARGET_DURATION), 600);
      setTimeout(() => forceVisibleToolbarDurationButtons(TARGET_DURATION), 30);
      setTimeout(() => forceVisibleToolbarDurationButtons(TARGET_DURATION), 80);
      setTimeout(() => forceVisibleToolbarDurationButtons(TARGET_DURATION), 240);
      setTimeout(() => forceVisibleToolbarDurationButtons(TARGET_DURATION), 600);
      setTimeout(() => setToolbarText(TARGET_DURATION), 80);
      setTimeout(() => setToolbarText(TARGET_DURATION), 240);
      setTimeout(() => setToolbarText(TARGET_DURATION), 600);
      return;
    }
    saveDuration(0);
    forceTriggerDurationText(toolbarTrigger, seconds);
    setToolbarText(seconds);
  }

  function showFallbackMenu(trigger) {
    if (!trigger || !document.body) return;
    hideFallbackMenu();
    const rect = trigger.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = FALLBACK_MENU_ID;
    menu.setAttribute('role', 'menu');
    const current = selectedDuration() === TARGET_DURATION
      ? TARGET_DURATION
      : durationValueFromText(trigger.textContent) || 10;

    [5, 10, 15].forEach(seconds => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${seconds}s${seconds === current ? '  ✓' : ''}`;
      button.setAttribute('role', 'menuitem');
      button.setAttribute('aria-selected', seconds === current ? 'true' : 'false');
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        chooseFallbackDuration(seconds, trigger);
      }, true);
      menu.appendChild(button);
    });

    document.body.appendChild(menu);
    const menuRect = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuRect.width - 8));
    const below = rect.bottom + 8;
    const above = rect.top - menuRect.height - 8;
    const top = below + menuRect.height < window.innerHeight ? below : Math.max(8, above);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    const close = event => {
      if (menu.contains(event.target) || trigger.contains(event.target)) return;
      hideFallbackMenu();
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = event => {
      if (event.key === 'Escape') {
        hideFallbackMenu();
        document.removeEventListener('pointerdown', close, true);
        document.removeEventListener('keydown', onKey, true);
      }
    };
    setTimeout(() => {
      document.addEventListener('pointerdown', close, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
  }

  function bindToolbarFallbackTriggers() {
    for (const trigger of findToolbarDurationTriggers()) {
      if (trigger.hasAttribute(`${MARK}-fallback-bound`)) continue;
      trigger.setAttribute(`${MARK}-fallback-bound`, '1');
      trigger.addEventListener('click', () => {
        lastToolbarTrigger = trigger;
        setTimeout(inject15Option, 80);
        setTimeout(() => {
          inject15Option();
          if (!hasVisible15MenuOption()) showFallbackMenu(trigger);
        }, 220);
      }, true);
    }
  }

  function renderChecks(options) {
    const selected15 = selectedDuration() === TARGET_DURATION;
    for (const item of options) {
      const value = exactDuration(item);
      if (value === 5 || value === 10) setNativeChecksHidden(item, selected15);
      if (value === TARGET_DURATION) {
        removeOwnChecks(item);
        setNativeChecksHidden(item, !selected15);
        item.setAttribute('aria-selected', selected15 ? 'true' : 'false');
        item.setAttribute('aria-checked', selected15 ? 'true' : 'false');
        if (selected15) {
          const check = document.createElement('span');
          check.setAttribute(`${MARK}-check`, '1');
          check.textContent = '✓';
          item.appendChild(check);
        }
      }
      item.removeAttribute(`${MARK}-active`);
    }
  }

  function bindNative(item, seconds) {
    if (item.hasAttribute(`${MARK}-native`)) return;
    item.setAttribute(`${MARK}-native`, String(seconds));
    item.addEventListener('click', () => {
      saveDuration(0);
      setToolbarText(seconds);
      setTimeout(inject15Option, 80);
    }, true);
  }

  function bind15(item) {
    if (item.hasAttribute(MARK)) return;
    item.setAttribute(MARK, 'option');
    item.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const toolbarTrigger = lastToolbarTrigger || findToolbarDurationTriggers()[0] || null;
      saveDuration(TARGET_DURATION);
      forceTriggerDurationText(toolbarTrigger, TARGET_DURATION);
      forceVisibleToolbarDurationButtons(TARGET_DURATION);
      setToolbarText(TARGET_DURATION);
      keepToolbarTextSynced();
      setTimeout(() => forceTriggerDurationText(toolbarTrigger, TARGET_DURATION), 30);
      setTimeout(() => forceTriggerDurationText(toolbarTrigger, TARGET_DURATION), 80);
      setTimeout(() => forceTriggerDurationText(toolbarTrigger, TARGET_DURATION), 240);
      setTimeout(() => forceTriggerDurationText(toolbarTrigger, TARGET_DURATION), 600);
      setTimeout(() => forceTriggerDurationText(toolbarTrigger, TARGET_DURATION), 1200);
      setTimeout(() => forceTriggerDurationText(toolbarTrigger, TARGET_DURATION), 2500);
      setTimeout(() => forceVisibleToolbarDurationButtons(TARGET_DURATION), 30);
      setTimeout(() => forceVisibleToolbarDurationButtons(TARGET_DURATION), 80);
      setTimeout(() => forceVisibleToolbarDurationButtons(TARGET_DURATION), 240);
      setTimeout(() => forceVisibleToolbarDurationButtons(TARGET_DURATION), 600);
      setTimeout(() => forceVisibleToolbarDurationButtons(TARGET_DURATION), 1200);
      setTimeout(() => forceVisibleToolbarDurationButtons(TARGET_DURATION), 2500);
      setTimeout(() => setToolbarText(TARGET_DURATION), 80);
      setTimeout(() => setToolbarText(TARGET_DURATION), 240);
      setTimeout(() => setToolbarText(TARGET_DURATION), 600);
      setTimeout(() => setToolbarText(TARGET_DURATION), 1200);
      setTimeout(() => setToolbarText(TARGET_DURATION), 2500);
      setTimeout(() => document.body && document.body.click(), 30);
    }, true);
  }

  function inject15Option() {
    const root = findDurationMenuRoot();
    if (!root) return;
    const options = findMenuOptions(root);
    if (!options.length) return;

    for (const item of options) {
      const value = exactDuration(item);
      if (value === 5 || value === 10) bindNative(item, value);
      if (value === TARGET_DURATION) bind15(item);
    }

    if (!options.some(item => exactDuration(item) === TARGET_DURATION)) {
      const after = options.find(item => exactDuration(item) === 10) || options[options.length - 1];
      const template = options.find(item => exactDuration(item) === 5) || after;
      if (!after || !template || !after.parentElement) return;
      const clone = template.cloneNode(true);
      scrubClone(clone);
      bind15(clone);
      after.parentElement.insertBefore(clone, after.nextSibling);
      options.push(clone);
    }

    renderChecks(options);
  }

  function tick() {
    bindToolbarFallbackTriggers();
    if (selectedDuration() === TARGET_DURATION) {
      forceVisibleToolbarDurationButtons(TARGET_DURATION);
      setToolbarText(TARGET_DURATION);
    }
    inject15Option();
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(tick, 100);
  }

  function start() {
    installStyle();
    installGlobalDurationClickCapture();
    tick();
    window.__AIAM_DOUBAO_15S_REFRESH__ = tick;
    const observer = new MutationObserver(schedule);
    const waitBody = () => {
      if (!document.body) return setTimeout(waitBody, 200);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      schedule();
    };
    waitBody();
  }

  patchFetch();
  patchXhr();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
