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
  // 16 is not in Chrome's set. navigator.deviceMemory is privacy-rounded to one of
  // 0.25/0.5/1/2/4/8 and never reports anything else, so a profile drawn from [4,8,16] carried a
  // value the browser cannot produce about a third of the time (1343 of 4000 sampled seeds).
  const deviceMemory = pick(bytes, 1, [4, 8] as const);
  // screen.width/height are CSS pixels, so the pair has to be consistent with the DPR beside it -
  // [2560,1440,1.25] describes a 3200x1800 panel rather than the 2560x1440 one it was meant to be,
  // and [2560,1600,2] on macOS describes a 5120x3200 display that does not exist. These are real
  // desktop configurations, expressed the way the API reports them.
  const sizes: readonly (readonly [number, number, number])[] = mac
    ? [[1440, 900, 2], [1512, 982, 2], [1728, 1117, 2]]
    : [[1920, 1080, 1], [2048, 1152, 1.25], [1536, 864, 1]];
  const size = pick(bytes, 2, sizes);
  const renderer = mac
    ? pick(bytes, 3, ['ANGLE (Apple, Apple M1, OpenGL 4.1)', 'ANGLE (Apple, Apple M2, OpenGL 4.1)', 'ANGLE (Apple, Apple GPU, OpenGL 4.1)'] as const)
    : pick(bytes, 3, ['ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'] as const);
  // navigator.vendor and the WebGL unmasked vendor are different strings in Chrome, and the WebGL
  // one carries the ANGLE backend in parentheses - `Google Inc. (Intel)`, `Google Inc. (NVIDIA)`.
  // One variable used to feed both, so every profile reported a bare `Google Inc.` next to a
  // renderer that names its backend: a pair no real Chrome emits, and the first thing a WebGL
  // fingerprint compares. chromeVendor keeps navigator.vendor exact; webGlVendor is derived.
  const chromeVendor = 'Google Inc.';
  const backend = /^ANGLE \(([^,]+),/.exec(renderer)?.[1] ?? (mac ? 'Apple' : 'Intel');
  const webGlVendor = `${chromeVendor} (${backend})`;
  const arch = mac ? (process.arch === 'arm64' ? 'arm' : 'x86') : 'x86';
  const platformVersion = mac ? '10.15.7' : '15.0.0';
  return fingerprintSchema.parse({
    // Default on. Must stay in step with the fingerprintSchema.default in src/shared/contracts.ts:
    // the new-account form sends its own `enabled`, and the create path does
    // `{ ...createFingerprintProfile(...), enabled: input.fingerprint.enabled }`, so a mismatch
    // would let the form's value silently win over the generated one.
    enabled: true,
    seed,
    runtimePlatform,
    userAgent: ua,
    platform: browserPlatform,
    vendor: chromeVendor,
    languages: ['zh-CN', 'zh', 'en-US', 'en'],
    hardwareConcurrency,
    deviceMemory,
    maxTouchPoints: 0,
    webGlVendor,
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
    // Defined on the instance, NOT on Window.prototype, even though every other hook here targets a
    // prototype and that would look more consistent. Measured: this Chromium installs
    // devicePixelRatio as an own accessor on the window object (a clean iframe reports
    // getOwnPropertyNames(win).includes('devicePixelRatio') === true and undefined on
    // Window.prototype), so a prototype definition is shadowed by the engine's own property and the
    // real value leaks through - verified, it reported the host's 1.1979 instead of the profile's.
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
    // availHeight is the work area, not the screen: reporting it equal to height claims a desktop
    // with no taskbar (Windows) or no menu bar (macOS), which no real machine does.
    const chromeInset = p.userAgentDataPlatform === 'macOS' ? 25 : 40;
    define(Screen.prototype, 'width', p.screenWidth); define(Screen.prototype, 'height', p.screenHeight); define(Screen.prototype, 'availWidth', p.screenWidth); define(Screen.prototype, 'availHeight', Math.max(0, p.screenHeight - chromeInset));
    const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) { if (parameter === 37445) return p.webGlVendor; if (parameter === 37446) return p.webGlRenderer; return originalGetParameter.call(this, parameter); };
    if (globalThis.WebGL2RenderingContext) { const originalGetParameter2 = WebGL2RenderingContext.prototype.getParameter; WebGL2RenderingContext.prototype.getParameter = function(parameter) { if (parameter === 37445) return p.webGlVendor; if (parameter === 37446) return p.webGlRenderer; return originalGetParameter2.call(this, parameter); }; }
    // Noise must not depend on how many times something has been read. This used to advance a
    // counter on every call, so reading the same unchanged canvas twice returned two different
    // pixels - measured: bytes 59, 60, 59 across three consecutive reads of one canvas, and two
    // different toDataURL() strings. A real browser is byte-stable for an unchanged canvas, so
    // that is both a broken instrument and the easiest possible detection: a page just reads twice
    // and compares. It also coupled canvas and audio through one shared counter, so a canvas read
    // changed the audio result.
    //
    // The perturbation is now a pure function of (seed, byte position) and is applied with XOR, so
    // it is idempotent as well as stable: a page that reads, writes back and reads again gets the
    // same bytes instead of drifting. Only one bit of every sampled red channel moves, so no
    // visible change and alpha is never touched.
    const seedBytes = new TextEncoder().encode(String(p.seed));
    let seedHash = 2166136261 >>> 0;
    for (let i = 0; i < seedBytes.length; i += 1) seedHash = Math.imul(seedHash ^ seedBytes[i], 16777619) >>> 0;
    // The finalizer has to be non-linear in the seed, which is why this is not the xorshift it
    // replaced. Xorshift32 uses only XOR and shifts, so it is linear over GF(2): feeding it
    // "seedHash XOR position" and taking one bit yields L(seed) XOR L(position) for a fixed linear
    // functional L. The position part is then identical for every seed and the seed contributes
    // exactly ONE bit - measured, the XOR of bit(sh,i) with bit(sh,0) decomposed identically for
    // every seed tried, and 2000 seeds produced only 2 distinct 64-sample patterns (bitwise
    // complements of each other, largest bucket 1012/2000). So two accounts collided on their
    // canvas noise half the time, and a page could see that every "different" profile differed
    // only by a global inversion of one fixed pattern. The imul carries below break that
    // linearity: measured 2000 distinct patterns across 2000 seeds, per-position bit balance
    // 937-1040 out of 2000.
    const noise = (x, y) => {
      let h = (seedHash ^ Math.imul(y * 8192 + x + 1, 2654435761)) >>> 0;
      h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
      return h;
    };
    // Keyed by the pixel's position on the canvas, NOT by its offset in the buffer the caller asked
    // for. The previous version walked the returned buffer with a stride derived from its length,
    // so a pixel's noise depended on the shape of the read: the same canvas read as 32x32 and as 8x8
    // reported 28 of their 64 overlapping pixels differently. A real browser reports one value per
    // pixel no matter how it is asked for, so that is a watermark a page can read off by calling
    // getImageData twice with different rectangles. Here the decision is a pure function of
    // (seed, x, y), so every read path - including the full-canvas read inside toDataURL below -
    // agrees, and the result is still stable, still idempotent under read/write/read, and still
    // sparse (about one pixel in sixteen, red channel only, moved by one).
    const applyNoise = (data, originX, originY, width) => {
      for (let i = 0; i < data.length; i += 4) {
        const pixel = i / 4;
        if ((noise(originX + (pixel % width), originY + Math.floor(pixel / width)) & 15) === 0) data[i] = (data[i] ^ 1) & 255;
      }
      return data;
    };
    if (p.canvasNoise) {
      const imageData = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {
        const result = imageData.call(this, sx, sy, sw, sh);
        if (result.data.length && sw > 0) applyNoise(result.data, sx, sy, sw);
        return result;
      };
      const toDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(...args) {
        // Encode a perturbed COPY. The previous version perturbed the caller's own 2D context and
        // wrote it back, which mutated the page's canvas as a side effect of asking for a string;
        // it also silently did nothing for a WebGL canvas, where getContext('2d') is null.
        try {
          const copy = document.createElement('canvas');
          copy.width = this.width; copy.height = this.height;
          const context = copy.getContext('2d');
          if (context) {
            context.drawImage(this, 0, 0);
            const image = imageData.call(context, 0, 0, copy.width, copy.height);
            if (image.data.length && copy.width > 0) applyNoise(image.data, 0, 0, copy.width);
            context.putImageData(image, 0, 0);
            return toDataURL.apply(copy, args);
          }
        } catch { /* A tainted canvas must still fail exactly as the native call would. */ }
        return toDataURL.apply(this, args);
      };
    }
    if (p.audioNoise && globalThis.AnalyserNode) {
      const frequency = AnalyserNode.prototype.getFloatFrequencyData;
      const audioBias = ((seedHash >>> 8) & 255) / 255 * 2e-4 - 1e-4;
      // The native call rewrites the whole array first, so this offset cannot accumulate.
      AnalyserNode.prototype.getFloatFrequencyData = function(array) { frequency.call(this, array); if (array.length) array[0] += audioBias; };
    }
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
    // "Restore defaults" restores the default profile, and the default is now enabled. It used to
    // force `enabled = false`, which would have made this the one control in the editor that
    // silently switches the feature off - regenerate() already preserves the flag, so both now
    // leave the enable state exactly as the user set it.
    const account = this.account(accountId); const next = { ...createFingerprintProfile(account.platform), enabled: account.fingerprint.enabled };
    return this.accounts.update(accountId, { fingerprint: next }).fingerprint;
  }

  private account(accountId: string): Account { const account = this.accounts.get(accountId); if (!account) throw new Error('账号不存在'); return account; }
}
