import { existsSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import type { DolaReferenceKind } from '../shared/contracts';

const MAX_REFERENCE_COUNT = 10;
const MAX_REFERENCE_BYTES = 200 * 1024 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 500 * 1024 * 1024;

const referenceExtensions: Record<DolaReferenceKind, ReadonlySet<string>> = {
  audio: new Set(['.mp3', '.wav']),
  video: new Set(['.mp4', '.mov'])
};

export function validateDolaMediaReferencePaths(kind: DolaReferenceKind, paths: string[]): string[] {
  const unique = [...new Set(paths.map((path) => resolve(path.trim())))];
  if (unique.length > MAX_REFERENCE_COUNT) throw new Error(`${kind === 'audio' ? '音频' : '视频'}参考最多 ${MAX_REFERENCE_COUNT} 个`);
  let totalBytes = 0;
  for (const path of unique) {
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`参考${kind === 'audio' ? '音频' : '视频'}不存在：${basename(path)}`);
    if (!referenceExtensions[kind].has(extname(path).toLowerCase())) {
      throw new Error(`不支持的参考${kind === 'audio' ? '音频' : '视频'}格式：${basename(path)}`);
    }
    const bytes = statSync(path).size;
    if (bytes > MAX_REFERENCE_BYTES) throw new Error(`参考素材超过 200 MB：${basename(path)}`);
    totalBytes += bytes;
  }
  if (totalBytes > MAX_TOTAL_REFERENCE_BYTES) throw new Error('参考素材总大小超过 500 MB');
  return unique;
}

export function buildDolaReferenceInputPreparationScript(kind: DolaReferenceKind): string {
  const accept = kind === 'audio'
    ? 'audio/mpeg,audio/wav,.mp3,.wav'
    : 'video/mp4,video/quicktime,.mp4,.mov';
  return `(() => {
    const accept = ${JSON.stringify(accept)};
    const candidates = Array.from(document.querySelectorAll('input[type="file"]'))
      .filter((input) => !input.closest?.('#watermark-free-media-panel'));
    const preferred = candidates.find((input) => input.matches?.('[data-testid="upload-file-input"]'))
      || candidates.find((input) => /image|video|audio|mp4|mov|mp3|wav|\\*/i.test(String(input.accept || '')))
      || candidates[0];
    if (!preferred) return { ok: false, message: 'Dola 未找到可用的参考素材输入框' };
    preferred.setAttribute('accept', accept);
    preferred.multiple = true;
    return { ok: true, accept: String(preferred.accept || accept), testId: String(preferred.getAttribute('data-testid') || '') };
  })()`;
}

export function buildDolaReferenceInputDispatchScript(kind: DolaReferenceKind): string {
  const pattern = kind === 'audio' ? 'audio|mp3|wav' : 'video|mp4|mov';
  const label = kind === 'audio' ? '音频' : '视频';
  return `(() => {
    const candidates = Array.from(document.querySelectorAll('input[type="file"]'))
      .filter((input) => !input.closest?.('#watermark-free-media-panel'));
    const preferred = candidates.find((input) => /${pattern}/i.test(String(input.accept || '')))
      || candidates.find((input) => input.matches?.('[data-testid="upload-file-input"]'))
      || candidates[0];
    if (!preferred) return { ok: false, message: 'Dola 未找到可触发的参考${label}输入框' };
    preferred.dispatchEvent(new Event('input', { bubbles: true }));
    preferred.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, count: Number(preferred.files?.length || 0), testId: String(preferred.getAttribute('data-testid') || '') };
  })()`;
}

export function buildDolaReferenceUploadStatusScript(kind: DolaReferenceKind, expectedNames: string[]): string {
  const pattern = kind === 'audio' ? 'audio|mp3|wav' : 'video|mp4|mov';
  const names = expectedNames.map((value) => basename(value)).filter(Boolean);
  return `(() => {
    const kind = ${JSON.stringify(kind)};
    const expectedNames = ${JSON.stringify(names)};
    const candidates = Array.from(document.querySelectorAll('input[type="file"]'))
      .filter((input) => !input.closest?.('#watermark-free-media-panel'));
    const preferred = candidates.find((input) => /${pattern}/i.test(String(input.accept || '')))
      || candidates.find((input) => input.matches?.('[data-testid="upload-file-input"]'))
      || candidates[0];
    const inputFiles = preferred ? Array.from(preferred.files || []) : [];
    const inputNames = inputFiles.map((file) => String(file?.name || '')).filter(Boolean);
    let page = null;
    try {
      const probe = window.__WATERMARK_FREE_DOLA_REFERENCE_STATUS__;
      if (typeof probe === 'function') page = probe(kind, inputNames.length ? inputNames : expectedNames);
    } catch (_) { page = null; }
    const expectedCount = expectedNames.length || inputNames.length;
    const inputCount = inputFiles.length;
    const available = Boolean(page?.available);
    const matchedCount = Number(page?.matchedCount || 0);
    const boundCount = Number(page?.boundCount || 0);
    const pendingCount = Math.max(Number(page?.pendingCount || 0), Number(page?.pendingMedia || 0));
    const failedCount = Number(page?.failedCount || 0);
    const readyForSubmit = inputCount >= expectedCount && (!available
      ? true
      : matchedCount >= expectedCount && boundCount >= expectedCount && pendingCount === 0 && failedCount === 0);
    return {
      ok: true,
      kind,
      expectedCount,
      inputCount,
      available,
      matchedCount,
      boundCount,
      pendingCount,
      failedCount,
      readyForSubmit,
      status: failedCount > 0 ? 'failed' : readyForSubmit ? (available ? 'settled' : 'unavailable') : (available ? 'pending' : 'unavailable')
    };
  })()`;
}
