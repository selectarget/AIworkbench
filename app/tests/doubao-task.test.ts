import { describe, expect, it } from 'vitest';
import { buildDoubao15sPromptSendScript, buildDoubaoDurationControlScript, DOUBAO_15S_ENHANCEMENT_PROMPT } from '../src/main/doubao-task';

describe('Doubao visible 15s prompt action', () => {
  it('builds a self-contained DOM interaction and keeps the legacy prompt', () => {
    const script = buildDoubao15sPromptSendScript();
    expect(script).toContain('doubao\\.com');
    expect(script).toContain('15 秒视频生成规则');
    expect(script).toContain('send.click()');
    expect(script).not.toContain('fetch(');
    expect(script).not.toContain('XMLHttpRequest');
    expect(() => new Function(`return ${script}`)).not.toThrow();
    expect(DOUBAO_15S_ENHANCEMENT_PROMPT).toContain('seedance2.0 fast');
  });

  it('escapes HTML delimiters when the prompt is supplied by the caller', () => {
    const script = buildDoubao15sPromptSendScript('</script>\nwindow.__unexpected = true;');
    expect(script).not.toContain('</script>');
    expect(() => new Function(`return ${script}`)).not.toThrow();
  });
});

describe('Doubao visible duration control', () => {
  it('builds a page-local 30 second toggle without private network calls', () => {
    const script = buildDoubaoDurationControlScript(30);
    expect(script).toContain('intl_doubao_enable_30s_v1');
    expect(script).toContain('watermark-free-duration-30-change');
    expect(script).toContain('Seedance');
    expect(script).not.toContain('fetch(');
    expect(script).not.toContain('XMLHttpRequest');
    expect(() => new Function(`return ${script}`)).not.toThrow();
  });

  it('keeps the 15 second control explicit and constrained to Doubao', () => {
    const script = buildDoubaoDurationControlScript(15);
    expect(script).toContain("durationFlag: '0'");
    expect(script).toContain('当前不是豆包页面');
    expect(() => new Function(`return ${script}`)).not.toThrow();
  });
});
