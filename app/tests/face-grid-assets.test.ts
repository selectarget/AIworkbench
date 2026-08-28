import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const assetRoot = resolve('face-grid-assets');

describe('face grid native model assets', () => {
  it('ships the V4.4-compatible SSD Caffe model and local license notice', () => {
    const prototxt = resolve(assetRoot, 'deploy.prototxt');
    const model = resolve(assetRoot, 'res10_300x300_ssd_iter_140000.caffemodel');
    const license = resolve(assetRoot, 'licenses', 'opencv-js-Apache-2.0.txt');
    expect(existsSync(prototxt)).toBe(true);
    expect(existsSync(model)).toBe(true);
    expect(existsSync(license)).toBe(true);
    expect(statSync(prototxt).size).toBeGreaterThan(20_000);
    expect(statSync(model).size).toBeGreaterThan(10_000_000);
    expect(readFileSync(prototxt, 'utf8')).toContain('input_shape');
    expect(createHash('sha256').update(readFileSync(model)).digest('hex')).toBe('2a56a11a57a4a295956b0660b4a3d76bbdca2206c4961cea8efe7d95c7cb2f2d');
  });

  it('keeps face-grid processing local and model-backed', () => {
    const source = readFileSync(resolve('src/renderer/src/face-grid.ts'), 'utf8');
    expect(source).toContain('readNetFromCaffe');
    expect(source).toContain('processFaceGrid');
    expect(source).not.toMatch(/https?:\/\//i);
  });
});
