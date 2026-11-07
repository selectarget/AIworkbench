import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('release configuration', () => {
  it('references hardened macOS entitlements for both app and helper processes', () => {
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { build?: { mac?: Record<string, unknown> } };
    expect(packageJson.build?.mac?.hardenedRuntime).toBe(true);
    expect(packageJson.build?.mac?.entitlements).toBe('build-assets/entitlements.mac.plist');
    expect(packageJson.build?.mac?.entitlementsInherit).toBe('build-assets/entitlements.mac.plist');
  });

  it('keeps the Electron/Chromium and packaged native-module entitlements present', () => {
    const path = resolve('build-assets', 'entitlements.mac.plist');
    expect(existsSync(path)).toBe(true);
    const plist = readFileSync(path, 'utf8');
    expect(plist).toContain('<key>com.apple.security.cs.allow-jit</key>');
    expect(plist).toContain('<key>com.apple.security.cs.allow-unsigned-executable-memory</key>');
    expect(plist).toContain('<key>com.apple.security.cs.disable-library-validation</key>');
  });

  it('keeps the signed macOS release workflow complete for both thin architectures', () => {
    const workflowPath = resolve('..', '.github', 'workflows', 'release-macos.yml');
    expect(existsSync(workflowPath)).toBe(true);
    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain('arch: x64');
    expect(workflow).toContain('runner: macos-15-intel');
    expect(workflow).toContain('arch: arm64');
    expect(workflow).toContain('runner: macos-15');
    expect(workflow).toContain('MACOS_CERTIFICATE_P12_BASE64');
    expect(workflow).toContain('APPLE_APP_SPECIFIC_PASSWORD');
    expect(workflow).toContain('electron-builder --mac dmg --${{ matrix.arch }} --publish always');
    expect(workflow).toContain('electron-builder --mac dmg --${{ matrix.arch }} --publish never');
    expect(workflow).toContain('scripts/audit-package.mjs');
    expect(workflow).toContain('scripts/smoke-packaged.mjs');
    expect(workflow).toContain('scripts/verify-macos-release.mjs');
    expect(workflow).toContain('--signed');
  });

  it('keeps the unsigned macOS build workflow at the repository root', () => {
    const workflowPath = resolve('..', '.github', 'workflows', 'build-macos.yml');
    const nestedWorkflowPath = resolve('.github', 'workflows', 'build-macos.yml');
    expect(existsSync(workflowPath)).toBe(true);
    expect(existsSync(nestedWorkflowPath)).toBe(false);
    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain('working-directory: app');
    expect(workflow).toContain('runs-on: macos-15');
    expect(workflow).toContain('npm run pack:mac');
    expect(workflow).toContain('npm run dist:mac:unsigned');
    expect(workflow).toContain('scripts/audit-package.mjs');
    expect(workflow).toContain('scripts/smoke-packaged.mjs');
    expect(workflow).toContain('scripts/verify-macos-release.mjs');
  });

  it('builds Windows and macOS binaries for a tagged release', () => {
    const workflowPath = resolve('..', '.github', 'workflows', 'release.yml');
    expect(existsSync(workflowPath)).toBe(true);
    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain('tags:');
    expect(workflow).toContain('runs-on: windows-latest');
    expect(workflow).toContain('runner: macos-15-intel');
    expect(workflow).toContain('runner: macos-15');
    expect(workflow).toContain('electron-builder --win portable --x64 --publish never');
    expect(workflow).toContain('electron-builder --mac dmg --${{ matrix.arch }} --publish never');
    expect(workflow).toContain('scripts/audit-package.mjs release/win-unpacked win32 x64');
    expect(workflow).toContain('scripts/verify-macos-release.mjs');
    expect(workflow).toContain('gh release create');
    expect(workflow).toContain('SHA256SUMS.txt');
  });

  it('does not reference retired macOS runner images', () => {
    const workflows = readdirSync(resolve('..', '.github', 'workflows'))
      .filter((name) => name.endsWith('.yml'))
      .map((name) => readFileSync(resolve('..', '.github', 'workflows', name), 'utf8'))
      .join('\n');
    expect(workflows).not.toMatch(/macos-13|macos-14\b/);
  });
});
