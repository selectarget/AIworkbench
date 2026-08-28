import { describe, expect, it, vi } from 'vitest';
import { adaptFingerprintProfile, buildFingerprintScript, createFingerprintProfile, FingerprintService } from '../src/main/fingerprint';

describe('account fingerprint profiles', () => {
  it('is stable for the same seed and varies for another seed', () => {
    const first = createFingerprintProfile('doubao', 'stable-seed'); const second = createFingerprintProfile('doubao', 'stable-seed'); const other = createFingerprintProfile('doubao', 'other-seed');
    expect(first).toEqual(second); expect(first.seed).toBe('stable-seed'); expect(first.userAgent).toBeTruthy(); expect(first.screenWidth !== other.screenWidth || first.hardwareConcurrency !== other.hardwareConcurrency || first.webGlRenderer !== other.webGlRenderer).toBe(true);
  });
  it('keeps the seed and account choices while adapting a migrated profile to the current OS', () => {
    const source = createFingerprintProfile('doubao', 'cross-platform-seed');
    const migrated = { ...source, runtimePlatform: source.runtimePlatform === 'darwin' ? 'win32' as const : 'darwin' as const, userAgent: source.runtimePlatform === 'darwin' ? 'windows-placeholder' : 'mac-placeholder', platform: source.runtimePlatform === 'darwin' ? 'Win32' : 'MacIntel' };
    const adapted = adaptFingerprintProfile('doubao', migrated);
    expect(adapted.seed).toBe(source.seed);
    expect(adapted.runtimePlatform).toBe(process.platform === 'darwin' ? 'darwin' : 'win32');
    expect(adapted.userAgent).not.toBe(migrated.userAgent);
    expect(adapted.languages).toEqual(source.languages);
    expect(adapted.hardwareConcurrency).toBe(source.hardwareConcurrency);
    expect(adapted.userAgent).toMatch(process.platform === 'darwin' ? /Macintosh/ : /Windows NT/);
  });
  it('injects before document creation and includes navigator/screen/WebGL hooks', () => {
    const script = buildFingerprintScript(createFingerprintProfile('dola', 'script-seed'));
    expect(script).toContain('Navigator.prototype'); expect(script).toContain('Screen.prototype'); expect(script).toContain('WebGLRenderingContext.prototype'); expect(script).toContain('getHighEntropyValues');
  });
  it('guards WebRTC against non-proxied UDP when the account policy requests it', () => {
    const script = buildFingerprintScript(createFingerprintProfile('dola', 'webrtc-seed'));
    expect(script).toContain("iceTransportPolicy: 'relay'");
    expect(script).toContain("value: RestrictedPeerConnection");
  });
  it('registers the document hook before the network user-agent override and records diagnostics', async () => {
    const account = { id: 'dola_1', platform: 'dola' as const, fingerprint: { ...createFingerprintProfile('dola', 'install-seed'), enabled: true } };
    const update = vi.fn((_id: string, patch: { fingerprint: typeof account.fingerprint }) => {
      account.fingerprint = patch.fingerprint;
      return account;
    });
    const accounts = { get: vi.fn(() => account), update };
    const methods: string[] = [];
    const debuggerChannel = {
      isAttached: vi.fn(() => true),
      attach: vi.fn(),
      sendCommand: vi.fn(async (method: string) => {
        methods.push(method);
        return method === 'Page.addScriptToEvaluateOnNewDocument' ? { identifier: 'fingerprint-script' } : {};
      })
    };
    const service = new FingerprintService(accounts as never);

    await service.install('dola_1', { debugger: debuggerChannel } as never);

    expect(methods.slice(0, 2)).toEqual(['Page.addScriptToEvaluateOnNewDocument', 'Network.setUserAgentOverride']);
    expect(debuggerChannel.sendCommand).toHaveBeenNthCalledWith(1, 'Page.addScriptToEvaluateOnNewDocument', { source: expect.stringContaining('__AIAM_FINGERPRINT_APPLIED') });
    expect(debuggerChannel.sendCommand).toHaveBeenNthCalledWith(2, 'Network.setUserAgentOverride', expect.objectContaining({ userAgent: account.fingerprint.userAgent, platform: account.fingerprint.userAgentDataPlatform }));
    expect(update).toHaveBeenCalledWith('dola_1', { fingerprint: expect.objectContaining({ lastAppliedAt: expect.any(String), lastError: '' }) });
  });
});
