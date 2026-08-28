import type { BatchLoginPlatform, DolaClickPoint, DolaClickTarget, DolaLoginStep } from '../shared/contracts';

/**
 * Builds the conservative DOM-only portion of the Dola/Google login helper.
 *
 * The script fills visible form controls and clicks visible, human-facing
 * buttons. It deliberately stops when a CAPTCHA, 2FA, passkey or phone
 * verification screen is present. It does not call a private login API or
 * persist the supplied credentials.
 */
export function buildDolaLoginStepScript(email: string, password: string, platform: BatchLoginPlatform = 'dola'): string {
  const payload = JSON.stringify({ email, password }).replace(/</g, '\\u003c');
  const targetPlatform = JSON.stringify(platform);
  return `(() => {
    const data = ${payload};
    const targetPlatform = ${targetPlatform};
    const visible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && !element.disabled;
    };
    const text = (element) => String(element?.innerText || element?.value || element?.getAttribute?.('aria-label') || '').trim();
    const buttons = () => [...document.querySelectorAll('button,[role="button"],input[type="submit"],a')].filter(visible);
    const click = (pattern) => {
      const target = buttons().find((element) => pattern.test(text(element)));
      if (!target) return false;
      target.scrollIntoView({ block: 'center', inline: 'center' });
      target.click();
      return true;
    };
    const setValue = (element, value) => {
      element.focus();
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, value); else element.value = value;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const body = String(document.body?.innerText || '');
    const host = String(location.hostname || '').toLowerCase();
    const href = String(location.href || '');
    const pageText = body + ' ' + href;
    if (/captcha|验证码|通行密钥|安全密钥|两步|2-step|verification code|手机号|phone/i.test(body)) {
      return { ok: false, manual: true, message: '需要人工验证，完成后继续' };
    }
    if (/登录 Chrome|登录Chrome|Sign in to Chrome|在不登录账号的情况下使用 Chrome|继续不使用账号|Continue without|Use Chrome without|Not now|暂不/i.test(pageText)) {
      if (click(/在不登录账号的情况下使用 Chrome|继续不使用账号|Continue without signing in|Use Chrome without an account|Not now|暂不/i)) {
        return { ok: true, field: 'chrome-skip', message: '已跳过 Chrome 首次登录提示' };
      }
      return { ok: false, message: '等待 Chrome 首次登录提示按钮' };
    }
    if (/workspacetermsofservice|服务条款|Google\s*Workspace|Terms\s*of\s*Service|我了解|I understand/i.test(pageText)) {
      if (click(/我了解|了解|知道了|I understand|Got it|Accept|Agree|Continue|继续/i)) {
        return { ok: true, field: 'terms', message: '已确认 Google 页面提示，等待登录继续' };
      }
      return { ok: false, message: '等待 Google 页面确认按钮' };
    }
    if (/accountchooser|Choose an account|选择账号|选择帐户/i.test(pageText)) {
      const accountItems = [...document.querySelectorAll('[data-identifier],[data-email],[role="link"],[role="button"],.OVnw0d')]
        .filter(visible)
        .filter((element) => /@/.test(text(element)) && !/Use another account|使用其他账号|使用其他帐户/i.test(text(element)));
      const matchedAccount = accountItems.find((element) => text(element).toLowerCase().includes(data.email.toLowerCase())) || accountItems[0];
      if (matchedAccount) {
        matchedAccount.scrollIntoView({ block: 'center', inline: 'center' });
        matchedAccount.click();
        return { ok: true, field: 'account', message: '已选择对应 Google 账号' };
      }
      return { ok: false, message: '等待 Google 账号选择项' };
    }
    if (/确认你的年龄|确认您已满18周岁|已满18|未能确认将会影响/i.test(body)) {
      const dialog = [...document.querySelectorAll('[role="dialog"],.semi-modal,.semi-modal-content,[class*="modal"],[aria-modal="true"]')]
        .filter(visible)
        .sort((left, right) => right.getBoundingClientRect().width * right.getBoundingClientRect().height - left.getBoundingClientRect().width * left.getBoundingClientRect().height)[0];
      const scope = dialog || document;
      const confirm = [...scope.querySelectorAll('button,[role="button"],input[type="submit"],a')]
        .filter(visible)
        .find((element) => /确认|确定|Confirm|OK|是的|Yes/i.test(text(element)));
      if (confirm) {
        confirm.scrollIntoView({ block: 'center', inline: 'center' });
        confirm.click();
        return { ok: true, field: 'age', message: '已确认 Dola 年龄提示' };
      }
      return { ok: false, message: '等待 Dola 年龄确认按钮' };
    }
    const emailInput = [...document.querySelectorAll('input[type="email"],#identifierId,input[name="identifier"]')].find(visible);
    if (emailInput) {
      setValue(emailInput, data.email);
      click(/下一步|next/i);
      return { ok: true, field: 'email', message: '已填写邮箱并进入下一步' };
    }
    const passwordInput = [...document.querySelectorAll('input[type="password"],input[name="password"]')].find(visible);
    if (passwordInput) {
      setValue(passwordInput, data.password);
      click(/下一步|next|登录|sign in/i);
      return { ok: true, field: 'password', message: '已填写密码并进入下一步' };
    }
    if (/accounts\.google\.com/i.test(host)) {
      if (click(/继续|continue|允许|allow|同意|agree/i)) return { ok: true, field: 'continue', message: '已继续 Google 授权' };
      return { ok: false, message: '等待 Google 登录页面' };
    }
    if (/dola\.com|ciciai\.com|higgsfield\.ai/i.test(host)) {
      const needsLogin = /登录以解锁|google\\s*登录|谷歌登录|sign in/i.test(body);
      if (needsLogin && click(/登录|google|谷歌|sign in/i)) return { ok: true, field: 'login', message: '已按当前页面入口打开 Google 登录' };
      if (needsLogin) return { ok: false, manual: true, message: '未识别登录入口，请人工点击后继续' };
      return targetPlatform === 'higgsfield'
        ? { ok: true, readyToSync: true, field: 'higgsfield', message: 'Higgsfield 页面已显示登录态' }
        : { ok: true, readyToSync: true, field: 'dola', message: 'Dola 页面已显示登录态' };
    }
    return { ok: false, message: '等待登录页面' };
  })()`;
}

export function buildDolaCalibrationScript(): string {
  return `(() => {
    const visible = (element) => {
      const rect = element?.getBoundingClientRect?.();
      const style = element && getComputedStyle(element);
      return Boolean(rect && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && !element.disabled);
    };
    const candidates = [...document.querySelectorAll('button,[role="button"],a')]
      .filter(visible)
      .map((element) => ({ element, label: String(element.innerText || element.getAttribute('aria-label') || '').trim() }));
    const match = candidates.find(({ label }) => /Google|谷歌|登录以解锁|登录|Sign in/i.test(label));
    if (!match) return { ok: false, manual: true, message: '未识别登录入口，请在浏览器中人工点击' };
    match.element.scrollIntoView({ block: 'center', inline: 'center' });
    match.element.click();
    return { ok: true, field: 'login', message: '已识别并点击登录入口：' + match.label.slice(0, 40) };
  })()`;
}

/**
 * Installs a short-lived, visible page overlay and resolves with the click
 * position as viewport ratios. This is used only to calibrate the normal
 * human-facing Dola login controls; it does not inspect or submit credentials.
 */
export function buildDolaClickCaptureScript(target: DolaClickTarget): string {
  const label = target === 'login' ? '登录入口' : 'Google 登录入口';
  return `(() => {
    const target = ${JSON.stringify(target)};
    const existing = document.getElementById('__aiam_dola_click_capture__');
    if (existing) existing.remove();
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.id = '__aiam_dola_click_capture__';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(23,34,61,.18);display:flex;align-items:flex-start;justify-content:center;font:600 14px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff;';
      const banner = document.createElement('div');
      banner.style.cssText = 'margin:18px;padding:12px 16px;border:1px solid rgba(255,255,255,.34);border-radius:12px;background:rgba(8,13,25,.92);box-shadow:0 8px 32px rgba(0,0,0,.35);pointer-events:none;text-align:center;';
      banner.innerHTML = ${JSON.stringify(`请点击${label}位置 · 按 Esc 取消`)};
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.dataset.aiamCancel = '1';
      cancel.textContent = '取消';
      cancel.style.cssText = 'position:fixed;right:18px;top:18px;z-index:1;border:1px solid rgba(255,255,255,.35);border-radius:8px;padding:7px 12px;background:rgba(8,13,25,.92);color:#fff;cursor:pointer;';
      overlay.append(banner, cancel);
      const finish = (value) => {
        window.clearTimeout(timeout);
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        resolve(value);
      };
      const onKey = (event) => { if (event.key === 'Escape') finish({ ok: false, target, message: '已取消点位校准' }); };
      const timeout = window.setTimeout(() => finish({ ok: false, target, message: '点位校准超时，请重试' }), 10 * 60 * 1000);
      cancel.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); finish({ ok: false, target, message: '已取消点位校准' }); }, true);
      overlay.addEventListener('click', (event) => {
        if (event.target === cancel || cancel.contains(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        const width = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
        const height = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
        finish({ ok: true, target, xRatio: Math.max(0.01, Math.min(0.99, event.clientX / width)), yRatio: Math.max(0.01, Math.min(0.99, event.clientY / height)), viewportWidth: width, viewportHeight: height, message: '点位已记录' });
      }, true);
      document.addEventListener('keydown', onKey, true);
      (document.documentElement || document.body).appendChild(overlay);
    });
  })()`;
}

export function normalizeDolaClickPoint(value: unknown): DolaClickPoint | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as { ok?: unknown; xRatio?: unknown; yRatio?: unknown };
  if (item.ok !== true) return null;
  const xRatio = Number(item.xRatio);
  const yRatio = Number(item.yRatio);
  if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio) || xRatio < 0.01 || xRatio > 0.99 || yRatio < 0.01 || yRatio > 0.99) return null;
  return { xRatio, yRatio };
}

export function normalizeDolaLoginStep(value: unknown, fallback = '未能识别登录页面'): DolaLoginStep {
  if (!value || typeof value !== 'object') return { ok: false, message: fallback };
  const item = value as Partial<DolaLoginStep>;
  return {
    ok: Boolean(item.ok),
    ...(item.readyToSync ? { readyToSync: true } : {}),
    ...(item.manual ? { manual: true } : {}),
    ...(item.field ? { field: String(item.field) } : {}),
    message: typeof item.message === 'string' && item.message ? item.message : fallback
  };
}
