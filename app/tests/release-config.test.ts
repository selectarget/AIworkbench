import { existsSync, readFileSync } from 'node:fs';
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
    expect(workflow).toContain('runner: macos-13');
    expect(workflow).toContain('arch: arm64');
    expect(workflow).toContain('runner: macos-14');
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
    expect(workflow).toContain('runs-on: macos-14');
    expect(workflow).toContain('npm run pack:mac');
    expect(workflow).toContain('npm run dist:mac:unsigned');
    expect(workflow).toContain('scripts/audit-package.mjs');
    expect(workflow).toContain('scripts/smoke-packaged.mjs');
    expect(workflow).toContain('scripts/verify-macos-release.mjs');
  });
});
