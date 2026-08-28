import { describe, expect, it } from 'vitest';
import { buildDolaVideoPreparationScript, buildDolaVideoSubmissionScript, buildDolaVideoTaskScript } from '../src/main/dola-task';

describe('Dola task script', () => {
  it('embeds duration and aspect ratio without interpolating prompt as code', () => {
    const script = buildDolaVideoTaskScript("猫\n'); window.__unexpected = true; //", '16:9', 30);
    expect(script).toContain('const seconds = 30');
    expect(script).toContain('const ratio = "16:9"');
    expect(script).toContain('window.__unexpected');
    expect(() => new Function(`return ${script}`)).not.toThrow();
    for (const ratio of ['1:1', '3:4', '4:3', '9:16', '16:9', '21:9']) {
      const ratioScript = buildDolaVideoTaskScript('safe prompt', ratio, 15);
      expect(ratioScript).toContain(`const ratio = "${ratio}"`);
      expect(() => new Function(`return ${ratioScript}`)).not.toThrow();
    }
  });

  it('supports a staged normal-page upload flow for reference images', () => {
    const preparation = buildDolaVideoPreparationScript('9:16', 15, 3);
    const submission = buildDolaVideoSubmissionScript('参考图任务', '9:16', 15, 3);
    expect(preparation).toContain('const phase = "prepare"');
    expect(preparation).toContain('const referenceCount = 3');
    expect(preparation).toContain('input[type="file"]');
    expect(submission).toContain('const phase = "submit"');
    expect(submission).toContain('含 \' + referenceCount + \' 张参考图');
    expect(() => new Function(`return ${preparation}`)).not.toThrow();
    expect(() => new Function(`return ${submission}`)).not.toThrow();
  });

  it('requires the requested duration option and prepares the 30-second bridge state', () => {
    const script = buildDolaVideoTaskScript('safe prompt', '9:16', 30);
    expect(script).toContain('selectSeedance25ForThirtySeconds');
    expect(script).toContain('当前 Dola 页面没有可用的 ');
    expect(script).toContain("intl_doubao_enable_30s_v1");
    expect(script).toContain('未提交 30 秒任务');
    expect(() => new Function(`return ${script}`)).not.toThrow();
  });
});
