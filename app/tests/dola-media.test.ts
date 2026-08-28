import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { buildDolaReferenceInputDispatchScript, buildDolaReferenceInputPreparationScript, buildDolaReferenceUploadStatusScript, validateDolaMediaReferencePaths } from '../src/main/dola-media';

const temporaryDirectories: string[] = [];
afterEach(() => { for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('Dola media references', () => {
  it('validates media kind, count and file size before CDP upload', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aiam-dola-media-'));
    temporaryDirectories.push(directory);
    const audio = join(directory, 'reference.mp3');
    const video = join(directory, 'reference.mp4');
    writeFileSync(audio, Buffer.from('audio'));
    writeFileSync(video, Buffer.from('video'));
    expect(validateDolaMediaReferencePaths('audio', [audio, audio])).toEqual([audio]);
    expect(validateDolaMediaReferencePaths('video', [video])).toEqual([video]);
    expect(() => validateDolaMediaReferencePaths('audio', [video])).toThrow('不支持的参考音频格式');
  });

  it('builds page-side input preparation and native change dispatch scripts', () => {
    const preparation = buildDolaReferenceInputPreparationScript('audio');
    const dispatch = buildDolaReferenceInputDispatchScript('video');
    expect(() => new Function(preparation)).not.toThrow();
    expect(() => new Function(dispatch)).not.toThrow();
    expect(preparation).toContain('audio/mpeg');
    expect(dispatch).toContain("new Event('change'");
  });

  it('builds an upload status probe that distinguishes file handoff from page binding', () => {
    const status = buildDolaReferenceUploadStatusScript('video', ['C:/refs/a.mp4', 'C:/refs/b.mov']);
    expect(() => new Function(status)).not.toThrow();
    expect(status).toContain('__WATERMARK_FREE_DOLA_REFERENCE_STATUS__');
    expect(status).toContain('matchedCount');
    expect(status).toContain('readyForSubmit');
    expect(status).toContain('a.mp4');
    expect(status).toContain('b.mov');
  });

  it('does not call a file-input handoff complete while the page reports a pending attachment', () => {
    const status = buildDolaReferenceUploadStatusScript('video', ['a.mp4']);
    const input = {
      accept: 'video/mp4',
      files: [{ name: 'a.mp4' }],
      closest: () => null,
      matches: () => false
    };
    const value = runInNewContext(status, {
      Array,
      Boolean,
      Number,
      String,
      document: { querySelectorAll: () => [input] },
      window: {
        __WATERMARK_FREE_DOLA_REFERENCE_STATUS__: () => ({ available: true, matchedCount: 1, boundCount: 0, pendingCount: 1, failedCount: 0 })
      }
    }) as { readyForSubmit: boolean; status: string; inputCount: number };
    expect(value.inputCount).toBe(1);
    expect(value.readyForSubmit).toBe(false);
    expect(value.status).toBe('pending');
  });
});
