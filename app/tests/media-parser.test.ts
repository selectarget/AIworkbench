import { describe, expect, it } from 'vitest';
import { createCipheriv, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDolaPayload, parseMediaPayload, parseNdjsonPayloads, parseSsePayloads, upgradeDolaNoWatermarkUrl, upgradeDoubaoNoWatermarkUrl } from '../src/main/media-parser';
import { normalizeCapturedHttpUrl } from '../src/shared/url-utils';

const QAAB_SALT = Buffer.from('4dd4c2e6b83162090e52b3c7a6733ba41cb2462b829ab58a196b39db57177524f49baf7f08e8d68d26a72e37c1a95a2f1f05a51892aef2949732b62a38aadd58', 'hex');
function encodeQaabUrl(url: string, seed: Buffer): { token: string; keySeed: string } {
  const first = createHash('sha512').update(seed.subarray(0, 32)).digest();
  const second = createHash('sha512').update(Buffer.concat([first, QAAB_SALT])).digest();
  const key = second.subarray(0, 16); const iv = second.subarray(16, 32);
  const plain = Buffer.from(url, 'ascii'); const padding = 16 - (plain.length % 16); const padded = Buffer.concat([plain, Buffer.alloc(padding, padding)]);
  const cipher = createCipheriv('aes-128-cbc', key, iv); cipher.setAutoPadding(false);
  return { token: Buffer.concat([Buffer.from([0xa8, 0, 1, 0]), cipher.update(padded), cipher.final()]).toString('base64'), keySeed: seed.toString('base64') };
}

describe('media response parser', () => {
  it('normalizes legacy escaped, quoted, and HTML-encoded media URLs', () => {
    const encoded = String.raw`"https:\/\/cdn.example.com\/generated\/video.mp4?x=1&amp;y=2\u0026z=3"`;
    expect(normalizeCapturedHttpUrl(encoded)).toBe('https://cdn.example.com/generated/video.mp4?x=1&y=2&z=3');
    expect(parseMediaPayload(JSON.stringify({ video_url: encoded }), 'cdp:dola')).toEqual([
      expect.objectContaining({ type: 'video', url: 'https://cdn.example.com/generated/video.mp4?x=1&y=2&z=3' })
    ]);
  });

  it('extracts original image and video URLs from nested JSON', () => {
    const body = JSON.stringify({ data: { title: '作品', width: 1920, height: 1080, original_media_info: { main_url: 'https://media.example.com/work.mp4?lr=video_gen_no_watermark' }, image_ori_raw: { url: 'https://img.example.com/raw.webp' } } });
    const result = parseMediaPayload(body, 'fixture');
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'video', confirmedNoWatermark: true }),
      expect.objectContaining({ type: 'image', url: 'https://img.example.com/raw.webp' })
    ]));
  });
  it('keeps V4.4 image_ori_raw images when the CDN URL has no extension', () => {
    const body = JSON.stringify({ data: { image_ori_raw: { url: 'https://cdn.example.com/generated/image-result-1', width: 2048, height: 2048 } } });
    expect(parseMediaPayload(body, 'cdp:doubao')).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image', url: 'https://cdn.example.com/generated/image-result-1', confirmedNoWatermark: true, qualityEvidence: 'server-original', resolutionMethod: 'image-ori-raw', width: 2048, height: 2048 })
    ]));
  });
  it('parses multiline SSE data and ignores DONE', () => {
    const body = 'data: {"video_url":"https://cdn.example.com/a.mp4"}\n\ndata: [DONE]\n\n';
    expect(parseSsePayloads(body)).toHaveLength(1);
    expect(parseMediaPayload(body)).toEqual([expect.objectContaining({ type: 'video' })]);
  });
  it('parses compact SSE events without requiring a blank separator', () => {
    const body = 'data: {"image_url":"https://cdn.example.com/a.png"}\ndata: {"video_url":"https://cdn.example.com/b.mp4"}\ndata: [DONE]';
    expect(parseSsePayloads(body)).toHaveLength(2);
    expect(parseMediaPayload(body)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image' }),
      expect.objectContaining({ type: 'video' })
    ]));
  });
  it('parses newline-delimited JSON while ignoring non-JSON text', () => {
    const body = 'event: progress\n{"image_url":"https://cdn.example.com/a.png"}\nnot-json\n{"video_url":"https://cdn.example.com/b.mp4"}';
    expect(parseNdjsonPayloads(body)).toHaveLength(2);
    expect(parseMediaPayload(body)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image' }),
      expect.objectContaining({ type: 'video' })
    ]));
  });
  it('unwraps bounded nested JSON strings from streaming responses', () => {
    const body = JSON.stringify({
      payload: JSON.stringify({ result: { resource_url: 'https://cdn.example.com/nested-image', mime_type: 'image/webp', width: 1024, height: 1024 } })
    });
    expect(parseMediaPayload(body, 'cdp:kimi')).toEqual([
      expect.objectContaining({ type: 'image', url: 'https://cdn.example.com/nested-image', resolutionMethod: 'payload-url' })
    ]);
  });
  it('unwraps nested Dola token payloads without treating arbitrary text as a token', () => {
    const encoded = encodeQaabUrl('https://cdn.example.com/nested-dola.mp4', Buffer.from('abcdef0123456789abcdef0123456789', 'ascii'));
    const body = JSON.stringify({ payload: JSON.stringify({ data: { key_seed: encoded.keySeed, video_url: encoded.token } }) });
    expect(parseDolaPayload(body, 'https://www.dola.com/samantha/video/get_play_info')).toEqual([
      expect.objectContaining({ type: 'video', url: 'https://cdn.example.com/nested-dola.mp4', resolutionMethod: 'dola-qAAB-token' })
    ]);
  });
  it('extracts extensionless CDN resources when the payload provides an explicit media type', () => {
    const body = JSON.stringify({ result: {
      image: { resource_url: 'https://cdn.example.com/assets/image-result-1', mime_type: 'image/webp', width: 1024, height: 1024 },
      video: { url: 'https://cdn.example.com/assets/video-result-1?sig=abc', content_type: 'video/mp4', duration: 6 }
    } });
    expect(parseMediaPayload(body, 'cdp:kimi')).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image', url: expect.stringContaining('image-result-1'), width: 1024, height: 1024 }),
      expect.objectContaining({ type: 'video', url: expect.stringContaining('video-result-1'), duration: 6 })
    ]));
  });
  it('classifies extensionless TIFF and Matroska resources from explicit MIME fields', () => {
    const body = JSON.stringify({ result: {
      image: { resource_url: 'https://cdn.example.com/assets/image-result-2', mime_type: 'image/tiff' },
      video: { resource_url: 'https://cdn.example.com/assets/video-result-2', media_type: 'video/x-matroska' }
    } });
    expect(parseMediaPayload(body, 'cdp:kimi')).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image', url: expect.stringContaining('image-result-2') }),
      expect.objectContaining({ type: 'video', url: expect.stringContaining('video-result-2') })
    ]));
  });
  it('blocks logos and script assets', () => {
    const body = JSON.stringify({ logo: 'https://cdn.example.com/logo.png', script: 'https://cdn.example.com/app.js' });
    expect(parseMediaPayload(body)).toEqual([]);
  });
  it('upgrades Dola watermark routing parameters before exposing a video', () => {
    const watermarked = 'https://cdn.example.com/video/fplay/a.mp4?lr=video_gen_watermark_dyn&logo_type=watermark';
    expect(upgradeDolaNoWatermarkUrl(watermarked)).toContain('lr=video_gen_no_watermark');
    expect(parseMediaPayload(JSON.stringify({ video_url: watermarked }), 'cdp:dola')).toEqual([expect.objectContaining({ confirmedNoWatermark: true, url: expect.stringContaining('logo_type=no_watermark') })]);
  });
  it('upgrades legacy Doubao play-info URLs and parses old response fixtures', () => {
    const messagePath = resolve(process.cwd(), 'site-assets/extensions/maowang-doubao/tests/fixtures/doubao-message.json');
    const playInfoPath = resolve(process.cwd(), 'site-assets/extensions/maowang-doubao/tests/fixtures/doubao-play-info.json');
    const message = parseMediaPayload(readFileSync(messagePath, 'utf8'), 'cdp:doubao');
    const playInfo = parseMediaPayload(readFileSync(playInfoPath, 'utf8'), 'cdp:doubao');
    expect(upgradeDoubaoNoWatermarkUrl('https://videoweb-download.doubao.com/video/a.mp4?lr=watermark')).toContain('video_gen_no_watermark');
    expect(message).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'image', width: 2048, height: 2048 })]));
    expect(playInfo).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'video', url: expect.stringContaining('video_gen_no_watermark'), confirmedNoWatermark: true, qualityEvidence: 'platform-api', resolutionMethod: 'doubao-url-variant' })]));
  });
  it('decodes Dola qAAB main_url values from public play-info responses', () => {
    const encoded = encodeQaabUrl('https://cdn.example.com/original.mp4?x-expires=9999999999', Buffer.from('0123456789abcdef0123456789abcdef', 'ascii'));
    const body = JSON.stringify({ data: { title: 'Dola 作品', vid: 'vid-1', message_id: 'message-1', conversation_id: 'conversation-1', share_id: 'share-1', share_url: 'https://www.dola.com/share/1', thread_url: 'https://www.dola.com/thread/1', key_seed: encoded.keySeed, video_list: [{ main_url: encoded.token, vwidth: 1920, vheight: 1080 }] } });
    expect(parseDolaPayload(body, 'https://www.dola.com/samantha/video/get_play_info')).toEqual([expect.objectContaining({ type: 'video', url: expect.stringContaining('original.mp4'), vid: 'vid-1', messageId: 'message-1', conversationId: 'conversation-1', shareId: 'share-1', shareUrl: 'https://www.dola.com/share/1', threadUrl: 'https://www.dola.com/thread/1', qualityEvidence: 'decoded-token', resolutionMethod: 'dola-qAAB-token', confirmedNoWatermark: true })]);
  });
  it('retains legacy Dola backup and man URL candidates on extensionless responses', () => {
    const body = JSON.stringify({ data: {
      type: 'video', message_id: 'message-multi',
      main_url: 'https://cdn.example.com/video/main-resource',
      backup_url_1: 'https://cdn.example.com/video/backup-resource',
      backup_url_2: 'https://cdn.example.com/video/third-resource',
      man_url: 'https://cdn.example.com/video/man-resource'
    } });
    expect(parseDolaPayload(body, 'https://www.dola.com/samantha/video/get_play_info')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        url: 'https://cdn.example.com/video/main-resource',
        backupUrl: 'https://cdn.example.com/video/backup-resource',
        alternateUrls: expect.arrayContaining([
          'https://cdn.example.com/video/third-resource',
          'https://cdn.example.com/video/man-resource'
        ])
      })
    ]));
  });
  it('decodes legacy Dola no-watermark token fields', () => {
    const encoded = encodeQaabUrl('https://cdn.example.com/original-no-watermark', Buffer.from('fedcba9876543210fedcba9876543210', 'ascii'));
    const body = JSON.stringify({ data: { type: 'video', key_seed: encoded.keySeed, no_watermark_url: encoded.token, mime_type: 'video/mp4' } });
    expect(parseDolaPayload(body, 'https://www.dola.com/samantha/video/get_play_info')).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'video', url: 'https://cdn.example.com/original-no-watermark', confirmedNoWatermark: true, resolutionMethod: 'dola-qAAB-token' })
    ]));
  });
  it('keeps public Dola endpoint parsing scoped to media fields', () => {
    const body = JSON.stringify({ data: { thread_url: 'https://www.dola.com/thread/123', description: 'https://cdn.example.com/readme.txt' } });
    expect(parseDolaPayload(body, 'https://www.dola.com/samantha/thread/share/info')).toEqual([]);
  });
});
