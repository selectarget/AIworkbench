import { createHash, randomBytes } from 'node:crypto';
import type { WebContents } from 'electron';
import { fingerprintSchema, type Account, type FingerprintProfile, type PlatformId } from '../shared/contracts';
import type { AccountService } from './accounts';

const chromeVersion = (): string => process.versions.chrome || '128.0.0.0';
export type FingerprintRuntimePlatform = 'win32' | 'darwin';

function currentRuntimePlatform(): FingerprintRuntimePlatform {
  return process.platform === 'darwin' ? 'darwin' : 'win32';
}

function inferRuntimePlatform(profile: FingerprintProfile): FingerprintRuntimePlatform | undefined {
  if (profile.runtimePlatform) return profile.runtimePlatform;
  if (profile.platform === 'Win32' || /Windows NT/i.test(profile.userAgent) || /^Windows$/i.test(profile.userAgentDataPlatform)) return 'win32';
  if (profile.platform === 'MacIntel' || /Macintosh|Mac OS X/i.test(profile.userAgent) || /^macOS$/i.test(profile.userAgentDataPlatform)) return 'darwin';
  return undefined;
}

function seedBytes(seed: string): Buffer {
  return createHash('sha256').update(seed).digest();
}

function pick<T>(bytes: Buffer, offset: number, values: readonly T[]): T {
  return values[bytes[offset % bytes.length]! % values.length]!;
}

function timezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'; } catch { return 'Asia/Shanghai'; }
}

export function createFingerprintProfile(platform: PlatformId, seed = randomBytes(24).toString('base64url')): FingerprintProfile {
  const bytes = seedBytes(seed);
  const runtimePlatform = currentRuntimePlatform();
  const mac = runtimePlatform === 'darwin';
  const ua = mac
    ? `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion()} Safari/537.36`
    : `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion()} Safari/537.36`;
  const browserPlatform = mac ? 'MacIntel' : 'Win32';
  const dataPlatform = mac ? 'macOS' : 'Windows';
  const major = chromeVersion().split('.')[0] || '128';
  const hardwareConcurrency = pick(bytes, 0, [4, 8, 12, 16] as const);
  const deviceMemory = pick(bytes, 1, [4, 8, 16] as const);
  const sizes: readonly (readonly [number, number, number])[] = mac ? [[1440, 900, 2], [1728, 1117, 2], [2560, 1600, 2]] : [[1920, 1080, 1], [2560, 1440, 1.25], [1536, 864, 1]];
  const size = pick(bytes, 2, sizes);
  const renderer = mac
    ? pick(bytes, 3, ['ANGLE (Apple, Apple M1, OpenGL 4.1)', 'ANGLE (Apple, Apple M2, OpenGL 4.1)', 'ANGLE (Apple, Apple GPU, OpenGL 4.1)'] as const)
    : pick(bytes, 3, ['ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'] as const);
  const vendor = mac ? 'Google Inc.' : 'Google Inc.';
  const arch = mac ? (process.arch === 'arm64' ? 'arm' : 'x86') : 'x86';
  const platformVersion = mac ? '10.15.7' : '15.0.0';
  return fingerprintSchema.parse({
    enabled: false,
    seed,
    runtimePlatform,
    userAgent: ua,
    platform: browserPlatform,
    vendor,
    languages: ['zh-CN', 'zh', 'en-US', 'en'],
    hardwareConcurrency,
    deviceMemory,
    maxTouchPoints: 0,
    webGlVendor: vendor,
    webGlRenderer: renderer,
    userAgentDataBrands: `"Not/A)Brand";v="8", "Chromium";v="${major}"`,
    userAgentDataFullVersionList: `"Not/A)Brand";v="8.0.0.0", "Chromium";v="${chromeVersion()}"`,
    userAgentDataMobile: false,
    userAgentDataPlatform: dataPlatform,
    userAgentDataArchitecture: arch,
    userAgentDataBitness: '64',
    userAgentDataPlatformVersion: platformVersion,
    screenWidth: size[0],
    screenHeight: size[1],
    deviceScaleFactor: size[2],
    timezone: timezone(),
    webRtcPolicy: 'disable_non_proxied_udp',
    canvasNoise: true,
    audioNoise: true
  });
}

/**
 * Keep account-specific randomness stable while adapting system-shaped values
 * to the host that is currently running the app. This matters after copying
 * an account file from Windows to macOS: retaining a Windows UA on macOS is
 * both surprising and inconsistent with the platform contract.
 *
 * The profile is deliberately browser-visible only. It does not claim to
 * change the host OS, fonts, TLS stack, physical GPU or network identity.
 */
export function adaptFingerprintProfile(platform: PlatformId, profile: FingerprintProfile): FingerprintProfile {
  const runtimePlatform = currentRuntimePlatform();
  const recordedPlatform = inferRuntimePlatform(profile);
  if (recordedPlatform === runtimePlatform) {
    return profile.runtimePlatform === runtimePlatform ? profile : fingerprintSchema.parse({ ...profile, runtimePlatform });
  }

  // If an old/hand-authored profile has no recognizable origin, only add the
  // marker. There is no evidence that its values should be regenerated.
  if (!recordedPlatform) return fingerprintSchema.parse({ ...profile, runtimePlatform });

  const generated = createFingerprintProfile(platform, profile.seed || undefined);
  return fingerprintSchema.parse({
    ...generated,
    enabled: profile.enabled,
    seed: profile.seed || generated.seed,
    // These are account choices rather than OS identity. Preserve them when
    // rebuilding the system-shaped portion of a migrated profile.
    languages: profile.languages,
    hardwareConcurrency: profile.hardwareConcurrency,
    deviceMemory: profile.deviceMemory,
    maxTouchPoints: profile.maxTouchPoints,
    timezone: profile.timezone,
    webRtcPolicy: profile.webRtcPolicy,
    canvasNoise: profile.canvasNoise,
    audioNoise: profile.audioNoise,
    generatedAt: profile.generatedAt,
    lastAppliedAt: profile.lastAppliedAt,
    lastError: profile.lastError,
    runtimePlatform
  });
}

function safeDefine(target: object, key: string, value: unknown): void {
  try { Object.defineProperty(target, key, { configurable: true, get: () => value }); } catch { /* Host objects may reject an override. */ }
}

function parseBrands(value: string): Array<{ brand: string; version: string }> {
  return value.split(/,\s*/).map((item) => {
    const match = item.match(/^\s*"?(.+?)"?\s*;v="?([^"\s]+)"?\s*$/);
    return match ? { brand: match[1]!, version: match[2]! } : null;
  }).filter((item): item is { brand: string; version: string } => Boolean(item));
}

export function buildFingerprintScript(profile: FingerprintProfile): string {
  const payload = JSON.stringify(profile).replace(/</g, '\\u003c');
  return `(() => {
  try {
    const p = ${payload};
    globalThis.__AIAM_FINGERPRINT_APPLIED = true;
    const define = (target, key, value) => { try { Object.defineProperty(target, key, { configurable: true, get: () => value }); } catch {} };
    const nav = Navigator.prototype;
    define(nav, 'userAgent', p.userAgent);
    define(nav, 'platform', p.platform);
    define(nav, 'vendor', p.vendor);
    define(nav, 'language', p.languages[0]);
    define(nav, 'languages', Object.freeze([...p.languages]));
    define(nav, 'hardwareConcurrency', p.hardwareConcurrency);
    define(nav, 'deviceMemory', p.deviceMemory);
    define(nav, 'maxTouchPoints', p.maxTouchPoints);
    define(globalThis, 'devicePixelRatio', p.deviceScaleFactor);
    const brandList = String(p.userAgentDataBrands || '').split(/,\\s*/).map(item => { const match = item.match(/^"?(.+?)"?;v="?([^"\\s]+)"?$/); return match ? { brand: match[1], version: match[2] } : null; }).filter(Boolean);
    const fullVersion = String(p.userAgentDataFullVersionList || '').match(/Chromium";v="([^"]+)/)?.[1] || '';
    const uaData = {
      brands: brandList,
      mobile: Boolean(p.userAgentDataMobile),
      platform: p.userAgentDataPlatform,
      getHighEntropyValues: async (hints) => {
        const result = {};
        for (const hint of hints) {
          if (hint === 'architecture') result.architecture = p.userAgentDataArchitecture;
          else if (hint === 'bitness') result.bitness = p.userAgentDataBitness;
          else if (hint === 'model') result.model = '';
          else if (hint === 'platform') result.platform = p.userAgentDataPlatform;
          else if (hint === 'platformVersion') result.platformVersion = p.userAgentDataPlatformVersion;
          else if (hint === 'fullVersionList') result.fullVersionList = [{ brand: 'Chromium', version: fullVersion }];
        }
        return result;
      }
    };
    define(nav, 'userAgentData', Object.freeze(uaData));
    define(Screen.prototype, 'width', p.screenWidth); define(Screen.prototype, 'height', p.screenHeight); define(Screen.prototype, 'availWidth', p.screenWidth); define(Screen.prototype, 'availHeight', p.screenHeight);
    const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) { if (parameter === 37445) return p.webGlVendor; if (parameter === 37446) return p.webGlRenderer; return originalGetParameter.call(this, parameter); };
    if (globalThis.WebGL2RenderingContext) { const originalGetParameter2 = WebGL2RenderingContext.prototype.getParameter; WebGL2RenderingContext.prototype.getParameter = function(parameter) { if (parameter === 37445) return p.webGlVendor; if (parameter === 37446) return p.webGlRenderer; return originalGetParameter2.call(this, parameter); }; }
    const bytes = new TextEncoder().encode(String(p.seed)); let state = bytes.reduce((sum, item) => (sum * 33 + item) >>> 0, 2166136261);
    const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
    if (p.canvasNoise) {
      const imageData = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function(...args) { const result = imageData.apply(this, args); if (result.data.length) result.data[0] = (result.data[0] + Math.floor(next() * 3)) & 255; return result; };
      const toDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(...args) { const context = this.getContext('2d'); if (context) { const pixel = context.getImageData(0, 0, 1, 1); pixel.data[0] = (pixel.data[0] + Math.floor(next() * 3)) & 255; context.putImageData(pixel, 0, 0); } return toDataURL.apply(this, args); };
    }
    if (p.audioNoise && globalThis.AnalyserNode) { const frequency = AnalyserNode.prototype.getFloatFrequencyData; AnalyserNode.prototype.getFloatFrequencyData = function(array) { frequency.call(this, array); if (array.length) array[0] += next() * 0.0001; }; }
    try { const originalResolved = Intl.DateTimeFormat.prototype.resolvedOptions; Intl.DateTimeFormat.prototype.resolvedOptions = function() { return { ...originalResolved.call(this), timeZone: p.timezone }; }; } catch {}
    if (p.webRtcPolicy === 'disable_non_proxied_udp' && globalThis.RTCPeerConnection) {
      try {
        const NativePeerConnection = globalThis.RTCPeerConnection;
        const normalizeConfig = (config) => ({ ...(config || {}), iceTransportPolicy: 'relay', iceServers: Array.isArray(config?.iceServers) ? config.iceServers : [] });
        const RestrictedPeerConnection = function(config) { return new NativePeerConnection(normalizeConfig(config)); };
        RestrictedPeerConnection.prototype = NativePeerConnection.prototype;
        Object.defineProperty(globalThis, 'RTCPeerConnection', { configurable: true, writable: true, value: RestrictedPeerConnection });
      } catch {}
    }
  } catch {}
})();`;
}

export class FingerprintService {
  constructor(private readonly accounts: AccountService) {}

  get(accountId: string): FingerprintProfile { return this.account(accountId).fingerprint; }

  async install(accountId: string, webContents: WebContents): Promise<void> {
    const account = this.account(accountId);
    if (!account.fingerprint.enabled) return;
    const fingerprint = adaptFingerprintProfile(account.platform, account.fingerprint);
    const script = buildFingerprintScript(fingerprint);
    try {
      if (!webContents.debugger.isAttached()) webContents.debugger.attach('1.3');
      await webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: script });
      await webContents.debugger.sendCommand('Network.setUserAgentOverride', {
        userAgent: fingerprint.userAgent,
        acceptLanguage: fingerprint.languages.join(','),
        platform: fingerprint.userAgentDataPlatform,
        userAgentMetadata: { brands: parseBrands(fingerprint.userAgentDataBrands), fullVersionList: parseBrands(fingerprint.userAgentDataFullVersionList), platform: fingerprint.userAgentDataPlatform, platformVersion: fingerprint.userAgentDataPlatformVersion, architecture: fingerprint.userAgentDataArchitecture, model: '', mobile: fingerprint.userAgentDataMobile, bitness: fingerprint.userAgentDataBitness }
      });
      this.accounts.update(accountId, { fingerprint: { ...fingerprint, lastAppliedAt: new Date().toISOString(), lastError: '' } });
    } catch (error) {
      // Fingerprint hooks are best effort and must never make a site unavailable,
      // but the failure must remain visible for diagnosis.
      try {
        const current = this.account(accountId);
        this.accounts.update(accountId, { fingerprint: { ...current.fingerprint, lastError: error instanceof Error ? error.message : String(error) } });
      } catch { /* Diagnostic persistence must not block page loading. */ }
    }
  }

  regenerate(accountId: string): FingerprintProfile {
    const account = this.account(accountId); const next = { ...createFingerprintProfile(account.platform), enabled: account.fingerprint.enabled };
    return this.accounts.update(accountId, { fingerprint: next }).fingerprint;
  }

  update(accountId: string, patch: Partial<FingerprintProfile>): FingerprintProfile {
    const account = this.account(accountId); const next = fingerprintSchema.parse({ ...account.fingerprint, ...patch });
    return this.accounts.update(accountId, { fingerprint: next }).fingerprint;
  }

  reset(accountId: string): FingerprintProfile {
    const account = this.account(accountId); const next = createFingerprintProfile(account.platform); next.enabled = false;
    return this.accounts.update(accountId, { fingerprint: next }).fingerprint;
  }

  private account(accountId: string): Account { const account = this.accounts.get(accountId); if (!account) throw new Error('账号不存在'); return account; }
}
