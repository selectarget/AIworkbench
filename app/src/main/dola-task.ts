type DolaTaskPhase = 'full' | 'prepare' | 'submit';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds the normal-page interaction used by the Dola task panel.
 *
 * Reference images are attached by the main process through the DevTools
 * file-input API. The page script only opens the normal composer and clicks
 * the same controls a user would use; it never calls a private task API.
 */
function buildDolaTaskScript(prompt: string, aspectRatio: string, duration: 15 | 30, referenceCount: number, phase: DolaTaskPhase): string {
  const encodedPrompt = JSON.stringify(prompt);
  const encodedRatio = JSON.stringify(aspectRatio || '16:9');
  const encodedRatioPattern = JSON.stringify(escapeRegExp(aspectRatio || '16:9'));
  const safeReferenceCount = Math.max(0, Math.min(9, Math.floor(referenceCount)));
  return `(() => {
    const prompt = ${encodedPrompt};
    const ratio = ${encodedRatio};
    const ratioPattern = ${encodedRatioPattern};
    const seconds = ${duration};
    const referenceCount = ${safeReferenceCount};
    const phase = ${JSON.stringify(phase)};
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (element) => {
      if (!element || !element.isConnected) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 4 && rect.height > 4 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.05 && !element.disabled;
    };
    const text = (element) => String(element?.innerText || element?.textContent || element?.getAttribute?.('aria-label') || element?.getAttribute?.('placeholder') || '').replace(/\\s+/g, ' ').trim();
    const controls = () => Array.from(document.querySelectorAll('button,[role="button"],[role="option"],a,label')).filter(visible);
    const findControl = (patterns) => controls().find((element) => {
      const value = text(element);
      return value.length > 0 && value.length < 160 && patterns.some((pattern) => pattern.test(value));
    });
    const click = (element) => {
      if (!element) return false;
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.click();
      return true;
    };
    const findComposer = () => {
      const selectors = ['textarea[placeholder]', 'textarea', '[contenteditable="true"][role="textbox"]', '[contenteditable="true"]', 'div[role="textbox"]', 'input[type="text"]'];
      for (const selector of selectors) {
        const element = Array.from(document.querySelectorAll(selector)).filter(visible).sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
        if (element && element.getBoundingClientRect().width > 160) return element;
      }
      return null;
    };
    const findModelControl = () => {
      const selector = '[data-input-engine-actionbar-control-key="video-model"],[data-input-engine-actionbar-control-key="model"]';
      const direct = Array.from(document.querySelectorAll(selector)).find(visible);
      return direct || findControl([/^模型$/i, /^Model$/i, /Seedance/i, /视频模型/i]);
    };
    const selectSeedance25ForThirtySeconds = async () => {
      if (seconds !== 30) return true;
      const readModel = () => text(document.querySelector('[data-input-engine-actionbar-control-key="video-model"],[data-input-engine-actionbar-control-key="model"]'));
      if (/2\\.5|seedance[^\\d]*2[^\\d]*5/i.test(readModel())) return true;
      if (findControl([/^30\\s*(?:s|秒)?$/i])) return true;
      const trigger = findModelControl();
      if (!trigger) return false;
      click(trigger);
      await sleep(350);
      const option = findControl([/seedance\\s*2\\.5/i, /2\\.5/i]);
      if (!option) return false;
      click(option);
      await sleep(500);
      return /2\\.5|seedance[^\\d]*2[^\\d]*5/i.test(readModel()) || Boolean(findControl([/30\\s*(?:s|秒)?/i]));
    };
    const setDurationBridgeState = () => {
      try {
        localStorage.setItem('intl_doubao_enable_30s_v1', seconds === 30 ? '1' : '0');
        document.documentElement?.setAttribute('data-watermark-free-duration-30', seconds === 30 ? '1' : '0');
        document.dispatchEvent(new Event('watermark-free-duration-30-change'));
      } catch {
        // The page may deny storage access; the native duration selection still remains authoritative.
      }
    };
    const findReferenceInput = () => {
      const inputs = Array.from(document.querySelectorAll('input[type="file"]')).filter((element) => !element.disabled);
      const imageInput = inputs.find((element) => /image|png|jpe?g|webp|\\*/i.test(String(element.getAttribute('accept') || '')));
      return imageInput || inputs[0] || null;
    };
    const openReferencePicker = async () => {
      let input = findReferenceInput();
      if (input) return input;
      const attach = findControl([/参考图/i, /参考图片/i, /添加图片/i, /上传图片/i, /reference/i, /upload\\s*image/i]);
      if (attach) { click(attach); await sleep(350); }
      input = findReferenceInput();
      return input;
    };
    const fill = (element, value) => {
      element.focus();
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (setter) setter.call(element, value); else element.value = value;
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      try { document.execCommand('selectAll', false); document.execCommand('insertText', false, value); } catch { element.textContent = value; }
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    };
    const findSend = (composer) => {
      const explicit = controls().filter((element) => /^(发送|提交|生成|send|submit|generate)$/i.test(text(element)) || /^(发送|提交|生成|send|submit|generate)/i.test(text(element)));
      if (explicit.length) return explicit[explicit.length - 1];
      const rect = composer.getBoundingClientRect();
      return controls().filter((element) => {
        const candidate = element.getBoundingClientRect();
        return candidate.left > rect.left + rect.width * 0.55 && candidate.top > rect.top - 120 && candidate.bottom < rect.bottom + 180 && candidate.width >= 24 && candidate.width <= 100 && candidate.height >= 24 && candidate.height <= 100;
      }).sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0] || null;
    };
    const choose = async (pattern) => {
      const option = findControl([pattern]);
      if (option) { click(option); await sleep(350); return true; }
      return false;
    };
    const baseResult = (ok, message, extra = {}) => ({ ok, message, duration: seconds, aspectRatio: ratio, referenceCount, ...extra });
    return (async () => {
      const host = String(location.hostname || '').toLowerCase();
      if (!/(^|\\.)(?:dola|ciciai)\\.com$/.test(host)) return baseResult(false, '当前不是 Dola 页面');
      const body = String(document.body?.innerText || '');
      if (/登录以解锁|Sign in to continue|请先登录/i.test(body) && !findComposer()) return baseResult(false, '当前 Dola 页面尚未登录');

      if (phase !== 'submit') {
        const creation = findControl([/AI\\s*创作/i, /AI\\s*Creation/i]);
        if (creation) { click(creation); await sleep(700); }
        const video = findControl([/视频生成/i, /生成视频/i, /Create\\s*Video/i]);
        if (video) { click(video); await sleep(700); }
        const more = findControl([/^更多$/i, /^More$/i]);
        if (more && !findControl([/视频生成/i, /Create\\s*Video/i])) { click(more); await sleep(350); }
        if (!(await selectSeedance25ForThirtySeconds())) {
          return baseResult(false, '当前 Dola 页面未能切换到 Seedance 2.5，未提交 30 秒任务');
        }
        await choose(new RegExp(ratioPattern.replace(':', '\\\\s*[:：]\\\\s*')));
        let durationChoice = await choose(new RegExp('^' + seconds + '\\\\s*(?:s|秒)?$', 'i'));
        if (!durationChoice) {
          const durationMenu = findControl([/时长/i, /duration/i]);
          if (durationMenu) { click(durationMenu); await sleep(300); durationChoice = await choose(new RegExp('^' + seconds + '\\\\s*(?:s|秒)?$', 'i')); }
        }
        if (!durationChoice) return baseResult(false, '当前 Dola 页面没有可用的 ' + seconds + ' 秒选项，未提交任务');
        setDurationBridgeState();
      }

      const composer = findComposer();
      if (!composer) return baseResult(false, '未找到 Dola 视频提示词输入框，请先进入新对话或 AI 创作页面');
      if (phase === 'prepare') {
        const input = referenceCount > 0 ? await openReferencePicker() : null;
        if (referenceCount > 0 && !input) return baseResult(false, '未找到 Dola 参考图上传控件，请先打开视频创作面板', { composerReady: true, referenceInput: false });
        return baseResult(true, referenceCount > 0 ? '已打开参考图上传入口，正在附加图片' : 'Dola 视频面板已准备就绪', { composerReady: true, referenceInput: Boolean(input) });
      }

      const finalPrompt = '生成视频：' + prompt + '\\n【任务参数】视频时长固定 ' + seconds + ' 秒，画幅固定 ' + ratio + '。请按当前账号可用的 Dola 视频能力提交。';
      fill(composer, finalPrompt);
      await sleep(450);
      const send = findSend(composer);
      if (!send) return baseResult(false, '提示词已填入，但未找到发送/生成按钮，请手动点击');
      click(send);
      return baseResult(true, '已点击 Dola 生成按钮，正在确认请求（' + seconds + ' 秒，' + ratio + (referenceCount > 0 ? '，含 ' + referenceCount + ' 张参考图' : '') + '）', { clicked: true });
    })();
  })()`;
}

export function buildDolaVideoTaskScript(prompt: string, aspectRatio: string, duration: 15 | 30, referenceCount = 0): string {
  return buildDolaTaskScript(prompt, aspectRatio, duration, referenceCount, 'full');
}

export function buildDolaVideoPreparationScript(aspectRatio: string, duration: 15 | 30, referenceCount: number): string {
  return buildDolaTaskScript('', aspectRatio, duration, referenceCount, 'prepare');
}

export function buildDolaVideoSubmissionScript(prompt: string, aspectRatio: string, duration: 15 | 30, referenceCount: number): string {
  return buildDolaTaskScript(prompt, aspectRatio, duration, referenceCount, 'submit');
}
