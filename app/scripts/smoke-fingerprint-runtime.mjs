import { app, BrowserWindow, WebContentsView, session } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildFingerprintScript, createFingerprintProfile } = require('../out/main/fingerprintRuntime.js');
const userData = mkdtempSync(join(tmpdir(), 'aiam-fingerprint-runtime-'));
const profile = { ...createFingerprintProfile('dola', 'runtime-smoke-seed'), enabled: true };
const fingerprintSource = buildFingerprintScript(profile);

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-proxy-server');
app.setPath('userData', userData);

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function withTimeout(promise, label, milliseconds = 15000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function execute(view, script) {
  return withTimeout(view.webContents.executeJavaScript(`(${script})()`, true), 'executeJavaScript');
}

function parseBrands(value) {
  return String(value || '').split(/,\s*/).map((item) => {
    const match = item.match(/^\s*"?(.+?)"?\s*;v="?([^"\s]+)"?\s*$/);
    return match ? { brand: match[1], version: match[2] } : null;
  }).filter(Boolean);
}

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html>
    <title>fingerprint runtime smoke</title>
    <script>
      window.__aiamInlineFingerprint = {
        applied: window.__AIAM_FINGERPRINT_APPLIED === true,
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        dataPlatform: navigator.userAgentData?.platform || ''
      };
    </script>
    <main>fingerprint fixture</main>`);
});

let window;
let view;

async function main() {
  let failed = false;
  try {
    const port = await listen(server);
    await app.whenReady();
    window = new BrowserWindow({ show: false, width: 900, height: 650, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    view = new WebContentsView({ webPreferences: { session: session.fromPartition('persist:fingerprint-runtime-smoke'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 900, height: 650 });
    await withTimeout(view.webContents.loadURL('about:blank'), 'bootstrap blank page');
    view.webContents.debugger.attach('1.3');
    await view.webContents.debugger.sendCommand('Page.enable');
    await view.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: fingerprintSource });
    await view.webContents.debugger.sendCommand('Network.setUserAgentOverride', {
      userAgent: profile.userAgent,
      acceptLanguage: profile.languages.join(','),
      platform: profile.userAgentDataPlatform,
      userAgentMetadata: {
        brands: parseBrands(profile.userAgentDataBrands),
        fullVersionList: parseBrands(profile.userAgentDataFullVersionList),
        platform: profile.userAgentDataPlatform,
        platformVersion: profile.userAgentDataPlatformVersion,
        architecture: profile.userAgentDataArchitecture,
        model: '',
        mobile: profile.userAgentDataMobile,
        bitness: profile.userAgentDataBitness
      }
    });
    await withTimeout(view.webContents.loadURL(`http://127.0.0.1:${port}/`), 'fingerprint fixture load');

    const result = await execute(view, async () => {
      const inline = window.__aiamInlineFingerprint || {};
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const context = canvas.getContext('2d');
      let canvasStable = null;
      let canvasPerturbed = null;
      if (context) {
        // An opaque fill makes the un-noised value known (every red byte starts at 255), so a
        // perturbation is observable and a missing one is not confused with an empty canvas.
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, 32, 32);
        const readCanvas = () => Array.from(context.getImageData(0, 0, 32, 32).data);
        const firstRead = readCanvas();
        // Reading an unchanged canvas twice must return identical bytes - that is what a real
        // browser does, and a page that gets two different answers has found the hook. This used to
        // assert the opposite (`new Set(samples).size >= 2` over 16 reads of one pixel), which
        // required the noise to be non-deterministic. The engine it was written against advanced a
        // counter per call, so byte 0 read 59, 60, 59 across three consecutive reads.
        canvasStable = JSON.stringify(firstRead) === JSON.stringify(readCanvas());
        canvasPerturbed = firstRead.some((value, index) => index % 4 === 0 && value !== 255);
      }
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      const webgl = gl ? { vendor: gl.getParameter(37445), renderer: gl.getParameter(37446) } : null;
      let rtcPolicy = 'unavailable';
      try {
        if (globalThis.RTCPeerConnection) {
          const peer = new RTCPeerConnection();
          rtcPolicy = peer.getConfiguration().iceTransportPolicy || 'default';
          peer.close();
        }
      } catch (error) {
        rtcPolicy = `error:${error instanceof Error ? error.message : String(error)}`;
      }
      const highEntropy = navigator.userAgentData?.getHighEntropyValues
        ? await navigator.userAgentData.getHighEntropyValues(['architecture', 'bitness', 'platformVersion'])
        : {};
      return {
        inline,
        applied: window.__AIAM_FINGERPRINT_APPLIED === true,
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        vendor: navigator.vendor,
        language: navigator.language,
        languages: [...navigator.languages],
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory,
        userAgentData: { platform: navigator.userAgentData?.platform || '', mobile: navigator.userAgentData?.mobile ?? null, highEntropy },
        devicePixelRatio: window.devicePixelRatio,
        screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight },
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        canvasStable,
        canvasPerturbed,
        webgl,
        rtcPolicy
      };
    });

    const failures = [];
    if (!result.applied || !result.inline.applied) failures.push('document hook did not run before inline page code');
    if (result.userAgent !== profile.userAgent || result.inline.userAgent !== profile.userAgent) failures.push('User-Agent override mismatch');
    if (result.platform !== profile.platform || result.inline.platform !== profile.platform) failures.push('navigator.platform mismatch');
    if (result.vendor !== profile.vendor) failures.push('navigator.vendor mismatch');
    if (result.language !== profile.languages[0] || JSON.stringify(result.languages) !== JSON.stringify(profile.languages)) failures.push('language list mismatch');
    if (result.hardwareConcurrency !== profile.hardwareConcurrency || result.deviceMemory !== profile.deviceMemory) failures.push('hardware profile mismatch');
    if (result.userAgentData.platform !== profile.userAgentDataPlatform || result.userAgentData.mobile !== profile.userAgentDataMobile) failures.push('User-Agent Client Hints mismatch');
    if (result.userAgentData.highEntropy.architecture !== profile.userAgentDataArchitecture || result.userAgentData.highEntropy.bitness !== profile.userAgentDataBitness || result.userAgentData.highEntropy.platformVersion !== profile.userAgentDataPlatformVersion) failures.push('high entropy User-Agent Client Hints mismatch');
    if (result.devicePixelRatio !== profile.deviceScaleFactor || result.screen.width !== profile.screenWidth || result.screen.height !== profile.screenHeight) failures.push('screen profile mismatch');
    if (result.timezone !== profile.timezone) failures.push('timezone mismatch');
    if (profile.canvasNoise && result.canvasStable !== true) failures.push('canvas reads of an unchanged canvas are not stable - the noise is not a pure function of the seed and the byte position');
    if (profile.canvasNoise && result.canvasPerturbed !== true) failures.push('canvas noise hook did not perturb any sampled pixel');
    if (result.webgl && (result.webgl.vendor !== profile.webGlVendor || result.webgl.renderer !== profile.webGlRenderer)) failures.push('WebGL profile mismatch');
    if (profile.webRtcPolicy === 'disable_non_proxied_udp' && result.rtcPolicy !== 'relay' && result.rtcPolicy !== 'unavailable') failures.push(`WebRTC policy mismatch: ${result.rtcPolicy}`);
    if (failures.length) throw new Error(`fingerprint runtime failed: ${JSON.stringify({ failures, result, expected: profile })}`);
    console.log(`fingerprint runtime ok: early hook, UA/UA-CH, screen, timezone, canvas noise, WebRTC policy${result.webgl ? ' and WebGL' : ''}`);
    console.log(`fingerprint runtime details: ${JSON.stringify({ inline: result.inline.applied, platform: result.platform, dataPlatform: result.userAgentData.platform, canvasStable: result.canvasStable, canvasPerturbed: result.canvasPerturbed, webgl: result.webgl, rtcPolicy: result.rtcPolicy })}`);
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    failed = true;
    process.exitCode = 1;
  } finally {
    try { if (view && window) window.contentView.removeChildView(view); } catch { /* cleanup */ }
    try { view?.webContents.debugger.detach(); } catch { /* cleanup */ }
    try { view?.webContents.close(); } catch { /* cleanup */ }
    try { if (window && !window.isDestroyed()) window.destroy(); } catch { /* cleanup */ }
    await withTimeout(new Promise((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
    }), 'server close', 3000).catch(() => undefined);
    try { rmSync(userData, { recursive: true, force: true }); } catch { /* Chromium may still hold a lock briefly */ }
    if (app.isReady()) {
      if (failed) app.exit(1);
      else app.quit();
    }
  }
}

main();
