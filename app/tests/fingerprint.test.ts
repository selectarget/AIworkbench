import { describe, expect, it, vi } from 'vitest';
import { adaptFingerprintProfile, buildFingerprintScript, createFingerprintProfile, FingerprintService } from '../src/main/fingerprint';
import { fingerprintSchema } from '../src/shared/contracts';

/**
 * A canvas stub faithful enough to run the generated hooks against: pixels really live somewhere,
 * getImageData really returns a copy, and putImageData/drawImage really write. Without that the
 * determinism assertions below could pass against a stub that discarded everything.
 */
function installFingerprintHooks(seed: string): { makeCanvas: () => any; restore: () => void } {
  // The suite runs in the node environment, so none of these exist yet. They are installed through
  // defineProperty rather than assignment because Node ships its own `Navigator` global and a plain
  // assignment to a non-writable one would throw in strict mode (test files are modules).
  const stubs: Record<string, unknown> = {};
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown): void => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    stubs[key] = value;
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };

  const makeCanvas = (): any => {
    const width = 32; const height = 32;
    const pixels = new Uint8ClampedArray(width * height * 4);
    // Rectangle-aware. A stub that ignored the origin and just handed back the first w*h pixels
    // would make the coherence test below pass against the very bug it exists to catch.
    const impl = {
      read(sx: number, sy: number, sw: number, sh: number) {
        const out = new Uint8ClampedArray(sw * sh * 4);
        for (let y = 0; y < sh; y += 1) {
          for (let x = 0; x < sw; x += 1) {
            const from = ((sy + y) * width + (sx + x)) * 4;
            const to = (y * sw + x) * 4;
            for (let k = 0; k < 4; k += 1) out[to + k] = pixels[from + k]!;
          }
        }
        return { data: out, width: sw, height: sh };
      },
      write(image: { data: Uint8ClampedArray; width: number; height: number }) {
        for (let y = 0; y < image.height; y += 1) {
          for (let x = 0; x < image.width; x += 1) {
            const from = (y * image.width + x) * 4;
            const to = (y * width + x) * 4;
            for (let k = 0; k < 4; k += 1) pixels[to + k] = image.data[from + k]!;
          }
        }
      },
      snapshot: () => ({ data: pixels, width, height }),
      encode: () => Array.from(pixels).join(',')
    };
    const canvas: any = Object.create(stubs.HTMLCanvasElement ? (stubs.HTMLCanvasElement as any).prototype : Object.prototype);
    canvas.width = width; canvas.height = height; canvas.__impl = impl;
    Object.defineProperty(canvas, '__pixels', { get: () => pixels });
    const context: any = Object.create((stubs.CanvasRenderingContext2D as any).prototype);
    context.__impl = impl;
    canvas.getContext = (kind: string) => (kind === '2d' ? context : null);
    canvas.fill = (byte: number) => { for (let i = 0; i < pixels.length; i += 1) pixels[i] = byte; };
    return canvas;
  };

  const c2dProto = {
    getImageData(this: any, x: number, y: number, w: number, h: number) { return this.__impl.read(x, y, w, h); },
    putImageData(this: any, image: { data: Uint8ClampedArray; width: number; height: number }) { this.__impl.write(image); },
    drawImage(this: any, source: any) { this.__impl.write(source.__impl.snapshot()); }
  };
  install('CanvasRenderingContext2D', { prototype: c2dProto });
  install('HTMLCanvasElement', { prototype: { toDataURL(this: any) { return this.__impl.encode(); } } });
  install('Navigator', { prototype: {} });
  install('Screen', { prototype: {} });
  install('WebGLRenderingContext', { prototype: { getParameter: () => 'native' } });
  install('document', { createElement: () => makeCanvas() });

  const before = c2dProto.getImageData;
  new Function(buildFingerprintScript(createFingerprintProfile('doubao', seed)))();

  // Guards against a vacuously passing test. The script swallows every error in its own try/catch,
  // so if it aborted early the hooks would still be native and every determinism assertion below
  // would hold trivially - a green result proving nothing.
  expect(c2dProto.getImageData).not.toBe(before);
  expect((globalThis as any).__AIAM_FINGERPRINT_APPLIED).toBe(true);

  const restore = (): void => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
    delete (globalThis as any).__AIAM_FINGERPRINT_APPLIED;
  };
  return { makeCanvas, restore };
}

describe('account fingerprint profiles', () => {
  it('is enabled by default, and the schema default agrees with the generator', () => {
    // The new-account form starts from fingerprintSchema.parse({}) while the create path generates
    // server-side and then overwrites `enabled` with whatever the form sent, so these two defaults
    // have to match or the form silently switches the feature back off.
    expect(createFingerprintProfile('doubao', 'default-seed').enabled).toBe(true);
    expect(fingerprintSchema.parse({}).enabled).toBe(true);
  });
  it('leaves the enable state alone when the profile is regenerated or reset', () => {
    const account = { id: 'dola_1', platform: 'dola' as const, fingerprint: { ...createFingerprintProfile('dola', 'keep-seed'), enabled: false } };
    const update = vi.fn((_id: string, patch: { fingerprint: typeof account.fingerprint }) => { account.fingerprint = patch.fingerprint; return account; });
    const service = new FingerprintService({ get: vi.fn(() => account), update } as never);
    expect(service.regenerate('dola_1').enabled).toBe(false);
    expect(service.reset('dola_1').enabled).toBe(false);
  });
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
  it('perturbs canvas reads as a pure function of the seed, not of how often it is read', () => {
    // A real browser returns identical bytes for an unchanged canvas however many times it is read.
    // The previous noise engine advanced a counter on every call - measured, byte 0 of one canvas
    // read 59, 60, 59 across three consecutive reads, and two toDataURL() calls returned two
    // different strings. Reading twice and comparing is the cheapest bot check there is, and the
    // shared counter also meant a canvas read changed the audio result.
    const first = installFingerprintHooks('noise-seed');
    let pattern: number[];
    try {
      const canvas = first.makeCanvas();
      canvas.fill(120);
      const context = canvas.getContext('2d');
      const reads = [0, 1, 2].map(() => Array.from(context.getImageData(0, 0, 32, 32).data) as number[]);
      expect(reads[1]).toEqual(reads[0]);
      expect(reads[2]).toEqual(reads[0]);
      pattern = reads[0]!;
      // The hook must actually perturb something, or "stable" is satisfied by a no-op.
      expect(pattern).not.toEqual(new Array(32 * 32 * 4).fill(120));

      expect(canvas.toDataURL()).toBe(canvas.toDataURL());
      // Asking for a string must not rewrite the page's own canvas. The old toDataURL perturbed the
      // caller's context in place and wrote it back, so an encode silently changed later reads.
      expect(Array.from(canvas.__pixels)).toEqual(new Array(32 * 32 * 4).fill(120));
    } finally { first.restore(); }

    // Same seed, fresh realm, same bytes - the perturbation is derived from the seed and the byte
    // position alone, which is what makes it idempotent across read/write/read round trips.
    const second = installFingerprintHooks('noise-seed');
    try {
      const canvas = second.makeCanvas();
      canvas.fill(120);
      expect(Array.from(canvas.getContext('2d').getImageData(0, 0, 32, 32).data)).toEqual(pattern);
    } finally { second.restore(); }

    // The seed has to reach every sampled position, not just one global bit. The xorshift this
    // replaced was linear over GF(2), so `L(seed) ^ L(position)` gave the seed exactly one bit of
    // influence: 2000 seeds produced 2 distinct patterns (complements of each other), and two
    // accounts collided on their canvas noise half the time. A handful of seeds is enough to catch
    // that - a linear scheme collapses to at most 2 patterns almost immediately.
    const seeds = Array.from({ length: 24 }, (_value, index) => `collision-probe-${index}`);
    const patterns = new Set(seeds.map((seed) => {
      const hooks = installFingerprintHooks(seed);
      try {
        const canvas = hooks.makeCanvas();
        canvas.fill(120);
        return Array.from(canvas.getContext('2d').getImageData(0, 0, 32, 32).data).join(',');
      } finally { hooks.restore(); }
    }));
    expect(patterns.size).toBe(seeds.length);
  });
  it('reports one value per pixel however the read rectangle is shaped', () => {
    // The noise used to be indexed by the byte's offset inside whichever buffer the caller asked
    // for, with a stride derived from that buffer's length. So a pixel's value depended on the
    // shape of the read: a 32x32 read and an 8x8 read of the same canvas disagreed on 28 of their
    // 64 overlapping pixels. A real browser answers the same pixel the same way every time, so that
    // is a watermark a page can read off by asking twice with different rectangles.
    const hooks = installFingerprintHooks('coherence-seed');
    try {
      const canvas = hooks.makeCanvas();
      canvas.fill(255);
      const context = canvas.getContext('2d');
      const full = Array.from(context.getImageData(0, 0, 32, 32).data) as number[];
      const band = Array.from(context.getImageData(0, 0, 8, 8).data) as number[];
      const differing: string[] = [];
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          if (full[(y * 32 + x) * 4] !== band[(y * 8 + x) * 4]) differing.push(`${x},${y}`);
        }
      }
      expect(differing).toEqual([]);
      // Agreement must not come from the noise being absent.
      expect(full.filter((value, index) => index % 4 === 0 && value !== 255).length).toBeGreaterThan(0);
    } finally { hooks.restore(); }
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
