import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('media preview tool assets', () => {
  it('ships the verified Windows FFmpeg resource used by packaged previews', () => {
    const binary = resolve('media-tools', 'win32-x64', 'ffmpeg.exe');
    expect(existsSync(binary)).toBe(true);
    expect(statSync(binary).size).toBeGreaterThan(90_000_000);
    expect(readFileSync(binary).subarray(0, 2).toString('ascii')).toBe('MZ');
    expect(createHash('sha256').update(readFileSync(binary)).digest('hex')).toBe('228d7a8556258de907fdb55f36850078ebc7680b84ec30d84ea02e99bec1d1eb');
  });

  it.each([
    ['darwin-x64', 70_000_000, 'ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894', 0x01000007],
    ['darwin-arm64', 40_000_000, 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584', 0x0100000c]
  ])('ships the verified macOS %s FFmpeg resource', (target, minimumSize, expectedHash, expectedCpuType) => {
    const binary = resolve('media-tools', target, 'ffmpeg');
    const bytes = readFileSync(binary);
    expect(existsSync(binary)).toBe(true);
    expect(statSync(binary).size).toBeGreaterThan(minimumSize);
    if (process.platform !== 'win32') expect(statSync(binary).mode & 0o111).toBe(0o111);
    expect(bytes.readUInt32LE(0)).toBe(0xfeedfacf);
    expect(bytes.readUInt32LE(4)).toBe(expectedCpuType);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(expectedHash);
  });

  it('keeps the media preparation script reproducible and architecture-aware', () => {
    const script = readFileSync(resolve('scripts', 'prepare-media-resources.mjs'), 'utf8');
    expect(script).toContain('b6.1.1/ffmpeg-darwin-x64.gz');
    expect(script).toContain('b6.1.1/ffmpeg-darwin-arm64.gz');
    expect(script).toContain('architectureMatches');
  });

  it('documents that conversion is a compatibility transcode, not a DRM bypass', () => {
    const readme = readFileSync(resolve('media-tools', 'README.md'), 'utf8');
    expect(readme).toContain('不包含 DRM 解密');
    expect(readme).toContain('darwin-arm64');
  });
});
