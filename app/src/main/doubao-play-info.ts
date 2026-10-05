import { parseDolaResolveResponse } from './dola-resolver';
import type { CapturedCandidate } from './media-parser';

export function parseDoubaoPlayInfoResponse(responseUrl: string, body: string): CapturedCandidate[] | null {
  let api: URL;
  try { api = new URL(responseUrl); } catch { return null; }
  if (!/(^|\.)doubao\.com$/i.test(api.hostname) || !/^\/samantha\/media\/get_play_info\/?$/i.test(api.pathname)) return null;
  try {
    const resolved = parseDolaResolveResponse(body);
    const payload = JSON.parse(body);
    const data = payload.video_info?.data ?? payload.data?.video_info?.data ?? payload.data ?? payload;
    const vid = api.searchParams.get('video_id') || api.searchParams.get('vid') || String(data.video_id ?? data.vid ?? '') || undefined;
    const original = api.searchParams.get('logo_type') === 'unwatermarked';
    return [{ type: 'video', url: resolved.videoUrl, alternateUrls: resolved.alternateUrls, thumbUrl: resolved.posterUrl || undefined, vid,
      source: original ? 'doubao-video-fallback-api' : 'doubao-play-info', confirmedNoWatermark: original,
      qualityEvidence: 'platform-api', resolutionMethod: original ? 'fallback_api' : 'play-info', title: '豆包视频' }];
  } catch { return []; }
}
