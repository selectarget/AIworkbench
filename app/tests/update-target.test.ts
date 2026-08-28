import { describe, expect, it } from 'vitest';
import { isCompatibleUpdateAsset, resolveUpdateTarget, selectUpdateManifestAsset, validateReleaseUrl } from '../src/main/update-target';

describe('cross-platform update targets', () => {
  it('maps only the supported release architectures', () => {
    expect(resolveUpdateTarget('win32', 'x64')).toBe('win32-x64');
    expect(resolveUpdateTarget('darwin', 'x64')).toBe('darwin-x64');
    expect(resolveUpdateTarget('darwin', 'arm64')).toBe('darwin-arm64');
    expect(resolveUpdateTarget('linux', 'x64')).toBeNull();
    expect(resolveUpdateTarget('win32', 'arm64')).toBeNull();
  });

  it('prefers the target-specific manifest and retains the legacy fallback', () => {
    const assets = [
      { name: 'update-manifest.json', browser_download_url: 'https://example.test/generic.json' },
      { name: 'update-manifest-darwin-arm64.json', browser_download_url: 'https://example.test/arm.json' }
    ];
    expect(selectUpdateManifestAsset(assets, 'darwin-arm64')?.name).toBe('update-manifest-darwin-arm64.json');
    expect(selectUpdateManifestAsset(assets, 'darwin-x64')?.name).toBe('update-manifest.json');
  });

  it('rejects a package from another platform or architecture', () => {
    expect(isCompatibleUpdateAsset('AI创作工作台-1.0.0-mac-arm64.dmg', 'darwin-arm64')).toBe(true);
    expect(isCompatibleUpdateAsset('AI创作工作台-1.0.0-mac-x64.dmg', 'darwin-arm64')).toBe(false);
    expect(isCompatibleUpdateAsset('AI创作工作台-1.0.0-win-x64-portable.zip', 'darwin-x64')).toBe(false);
    expect(isCompatibleUpdateAsset('AI创作工作台-1.0.0-win-x64-portable.zip', 'win32-x64')).toBe(true);
  });

  it('only allows the public GitHub release page to be opened', () => {
    expect(validateReleaseUrl('https://github.com/example/workbench/releases/tag/v1.0.0')).toContain('github.com/example/workbench');
    expect(() => validateReleaseUrl('http://github.com/example/workbench/releases')).toThrow(/GitHub HTTPS/);
    expect(() => validateReleaseUrl('https://evil.example/releases')).toThrow(/GitHub HTTPS/);
  });
});
