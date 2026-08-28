import { describe, expect, it } from 'vitest';
import { buildDolaCalibrationScript, buildDolaClickCaptureScript, buildDolaLoginStepScript, normalizeDolaClickPoint, normalizeDolaLoginStep } from '../src/main/dola-login';

describe('Dola login helpers', () => {
  it('builds a self-contained DOM-only login script and escapes HTML delimiters', () => {
    const script = buildDolaLoginStepScript('user@example.com</script>', 'p<assword');
    expect(() => new Function(`return ${script}`)).not.toThrow();
    expect(script).toContain('captcha');
    expect(script).not.toContain('user@example.com</script>');
    expect(script).toContain('accounts.google.com');
  });

  it('shares the normal Google form flow with Higgsfield without adding private API calls', () => {
    const script = buildDolaLoginStepScript('user@example.com', 'secret', 'higgsfield');
    expect(() => new Function(`return ${script}`)).not.toThrow();
    expect(script).toContain('higgsfield.ai');
    expect(script).toContain('Higgsfield 页面已显示登录态');
    expect(script).not.toContain('fetch(');
    expect(script).not.toContain('XMLHttpRequest');
  });

  it('builds a calibration script without credentials', () => {
    const script = buildDolaCalibrationScript();
    expect(() => new Function(`return ${script}`)).not.toThrow();
    expect(script).not.toContain('password');
    expect(script).toContain('未识别登录入口');
  });

  it('builds a visible point-capture script without embedding credentials', () => {
    const script = buildDolaClickCaptureScript('google');
    expect(() => new Function(`return ${script}`)).not.toThrow();
    expect(script).toContain('__aiam_dola_click_capture__');
    expect(script).toContain('Google 登录入口');
    expect(script).not.toContain('password');
  });

  it('normalizes calibrated ratios and rejects invalid page results', () => {
    expect(normalizeDolaClickPoint({ ok: true, xRatio: 0.2, yRatio: 0.8 })).toEqual({ xRatio: 0.2, yRatio: 0.8 });
    expect(normalizeDolaClickPoint({ ok: true, xRatio: 2, yRatio: 0.8 })).toBeNull();
    expect(normalizeDolaClickPoint({ ok: false, xRatio: 0.2, yRatio: 0.8 })).toBeNull();
  });

  it('normalizes untrusted page results to the shared contract', () => {
    expect(normalizeDolaLoginStep({ ok: 1, readyToSync: true, field: 42, message: '完成' })).toEqual({ ok: true, readyToSync: true, field: '42', message: '完成' });
    expect(normalizeDolaLoginStep(null)).toEqual({ ok: false, message: '未能识别登录页面' });
  });
});
