import { describe, expect, it } from 'vitest';
import {
  canonicalMediaExtension,
  extensionFromMimeType,
  extensionFromValue,
  mediaExtensionFromSignature,
  mediaTypeFromExtension,
  mediaTypeFromMimeType
} from '../src/main/media-formats';

describe('legacy-compatible media format detection', () => {
  it('recognises image and video suffixes from paths and signed URLs', () => {
    expect(extensionFromValue('https://cdn.example/result.tif?x-expires=1')).toBe('.tif');
    expect(canonicalMediaExtension('https://cdn.example/result.tif?x-expires=1')).toBe('.tiff');
    expect(canonicalMediaExtension('result.jpeg')).toBe('.jpg');
    expect(mediaTypeFromExtension('result.apng')).toBe('image');
    expect(mediaTypeFromExtension('result.heic')).toBe('image');
    expect(mediaTypeFromExtension('result.mkv')).toBe('video');
    expect(mediaTypeFromExtension('report.pdf')).toBe('other');
  });

  it('maps the V4.4 image MIME variants and common video MIME variants', () => {
    expect(extensionFromMimeType('image/pjpeg; charset=binary')).toBe('.jpg');
    expect(extensionFromMimeType('image/avif-sequence')).toBe('.avif');
    expect(extensionFromMimeType('image/heic-sequence')).toBe('.heic');
    expect(extensionFromMimeType('image/x-tiff')).toBe('.tiff');
    expect(extensionFromMimeType('image/vnd.microsoft.icon')).toBe('.ico');
    expect(extensionFromMimeType('video/x-matroska')).toBe('.mkv');
    expect(mediaTypeFromMimeType('image/svg+xml; charset=utf-8')).toBe('image');
    expect(mediaTypeFromMimeType('video/mp2t')).toBe('video');
  });

  it('recognises the legacy image signatures and ISO-BMFF image brands', () => {
    expect(mediaExtensionFromSignature(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('.jpg');
    expect(mediaExtensionFromSignature(Uint8Array.from([0x49, 0x49, 0x2a, 0x00]))).toBe('.tiff');
    expect(mediaExtensionFromSignature(Uint8Array.from([0x00, 0x00, 0x01, 0x00]))).toBe('.ico');
    expect(mediaExtensionFromSignature(new TextEncoder().encode('<?xml version="1.0"?><svg></svg>'))).toBe('.svg');
    const avif = new Uint8Array(24); avif.set([0, 0, 0, 24]); avif.set(new TextEncoder().encode('ftyp'), 4); avif.set(new TextEncoder().encode('avif'), 8);
    expect(mediaExtensionFromSignature(avif)).toBe('.avif');
  });

  it('recognises the video signatures without confusing them with image containers', () => {
    expect(mediaExtensionFromSignature(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe('.webm');
    expect(mediaExtensionFromSignature(new TextEncoder().encode('FLV\x01\x05'))).toBe('.flv');
    const mp4 = new Uint8Array(24); mp4.set([0, 0, 0, 24]); mp4.set(new TextEncoder().encode('ftyp'), 4); mp4.set(new TextEncoder().encode('isom'), 8);
    expect(mediaExtensionFromSignature(mp4)).toBe('.mp4');
  });
});
