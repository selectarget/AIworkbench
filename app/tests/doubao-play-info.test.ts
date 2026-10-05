import { describe, expect, it } from 'vitest';
import { parseDoubaoPlayInfoResponse } from '../src/main/doubao-play-info';
describe('V6.8 Doubao play-info capture', () => {
  const original = 'https://v26-vdl.doubao.com/original.mp4?signature=unchanged';
  const body = JSON.stringify({ video_info: { data: { video_list: { small: { main_url: Buffer.from('https://v26-vdl.doubao.com/small.mp4').toString('base64'), vwidth: 384, vheight: 216 }, hd: { main_url: Buffer.from(original).toString('base64'), vwidth: 1920, vheight: 1080 } }, poster_url: 'https://cdn.example/poster.jpg' } } });
  it('decodes the highest quality stream and preserves the current video ID', () => {
    expect(parseDoubaoPlayInfoResponse('https://www.doubao.com/samantha/media/get_play_info?video_id=current-video', body)?.[0]).toMatchObject({ url: original, vid: 'current-video', confirmedNoWatermark: false, source: 'doubao-play-info' });
  });
  it('retains explicit original API provenance even on a vdl host', () => {
    expect(parseDoubaoPlayInfoResponse('https://www.doubao.com/samantha/media/get_play_info?video_id=current-video&logo_type=unwatermarked', body)?.[0]).toMatchObject({ url: original, confirmedNoWatermark: true, source: 'doubao-video-fallback-api' });
  });
  it('does not apply this decoder to unrelated responses or malformed tokens', () => {
    expect(parseDoubaoPlayInfoResponse('https://example.com/samantha/media/get_play_info', body)).toBeNull();
    expect(parseDoubaoPlayInfoResponse('https://www.doubao.com/samantha/media/get_play_info', '{}')).toEqual([]);
  });
});
