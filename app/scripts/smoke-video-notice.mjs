import { app, BrowserWindow, WebContentsView, ipcMain } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const userData = mkdtempSync(join(tmpdir(), 'aiam-video-notice-'));
const remotePreload = resolve('out/preload/remote.js');
const bridgeSource = readFileSync(resolve('site-assets/scripts/dola-resource-bridge.js'), 'utf8').replace(
  'if (!/(^|\\.)dola\\.com$/i.test(location.hostname) && !/(^|\\.)ciciai\\.com$/i.test(location.hostname)) return;',
  'if (location.hostname !== "127.0.0.1") return;'
);
app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', userData);

function listen(server) {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise(server.address().port));
  });
}

function withTimeout(promise, label, milliseconds = 15000) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const server = createServer((request, response) => {
  console.log(`video notice smoke request: ${request.headers.host}${request.url}`);
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html>
    <title>Dola video notice smoke</title>
    <main id="generation-state">正在生成视频</main>
    <script>
      setTimeout(() => {
        const root = document.createElement('section');
        root.style.width = '360px';
        root.style.height = '240px';
        root.innerHTML = '<video id="generated-video" src="/video.mp4" poster="/poster.jpg"></video><button>下载视频</button><span>Smoke generated video</span>';
        document.body.appendChild(root);
      }, 700);
    </script>`);
});

let window;
let view;
const notices = [];
const mediaRequests = [];
const remoteNoticeHandler = (event, raw) => {
  if (view && event.sender.id === view.webContents.id) notices.push(raw);
};
const remoteMediaHandler = (event, raw) => {
  if (view && event.sender.id === view.webContents.id) mediaRequests.push(raw);
};

async function main() {
  let failed = false;
  try {
    const port = await listen(server);
    console.log(`video notice smoke server listening on ${port}`);
    await app.whenReady();
    console.log('video notice smoke app ready');
    window = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    view = new WebContentsView({ webPreferences: { preload: remotePreload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.contentView.addChildView(view);
    console.log('video notice smoke view attached');
    ipcMain.on('remote:video-generated', remoteNoticeHandler);
    ipcMain.on('remote:media', remoteMediaHandler);
    await withTimeout(view.webContents.loadURL('about:blank'), 'bootstrap blank page');
    console.log('video notice smoke blank page loaded');
    view.webContents.debugger.attach('1.3');
    console.log('video notice smoke debugger attached');
    await view.webContents.debugger.sendCommand('Page.enable');
    console.log('video notice smoke page enabled');
    await view.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: bridgeSource });
    console.log('video notice smoke bridge registered');
    await withTimeout(view.webContents.loadURL(`http://127.0.0.1:${port}/`), 'Dola fixture load');
    console.log('video notice smoke page loaded');
    const pageState = await view.webContents.executeJavaScript(`({ url: location.href, title: document.title, html: document.documentElement?.outerHTML?.slice(0, 300) || '', bridge: Boolean(window.__AIAM_DOLA_RESOURCE_BRIDGE__), text: document.body?.innerText || '', videos: document.querySelectorAll('video').length, generated: Boolean(document.querySelector('#generation-state')) })`, true);
    console.log(`video notice smoke page state: ${JSON.stringify(pageState)}`);
    for (let attempt = 0; attempt < 30 && notices.length === 0; attempt += 1) await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 800));
    if (notices.length !== 1) throw new Error(`expected one generated-video notice, received ${JSON.stringify(notices)}`);
    const notice = notices[0];
    if (!notice || typeof notice.key !== 'string' || !notice.key || !String(notice.title || '').includes('Smoke generated video')) throw new Error(`invalid generated-video notice: ${JSON.stringify(notice)}`);
    const overlayState = await view.webContents.executeJavaScript(`(() => { const current = document.querySelector('.aiam-dola-video-overlay .aiam-dola-overlay-current'); return { overlays: document.querySelectorAll('.aiam-dola-video-overlay').length, downloadButtons: document.querySelectorAll('.aiam-dola-video-overlay .aiam-dola-overlay-primary').length, currentButtons: document.querySelectorAll('.aiam-dola-video-overlay .aiam-dola-overlay-current').length, currentDisabled: current ? current.disabled : null, currentLabel: current ? current.textContent : '' }; })()`, true);
    if (overlayState.overlays < 1 || overlayState.downloadButtons < 1) throw new Error(`expected one per-video Dola action overlay, received ${JSON.stringify(overlayState)}`);
    if (overlayState.currentButtons !== 1 || overlayState.currentDisabled) throw new Error(`per-video current-address action is not enabled: ${JSON.stringify(overlayState)}`);
    await view.webContents.executeJavaScript(`document.querySelector('.aiam-dola-video-overlay .aiam-dola-overlay-current')?.click(); void 0;`, true);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    const actionState = await view.webContents.executeJavaScript(`(() => { const current = document.querySelector('.aiam-dola-video-overlay .aiam-dola-overlay-current'); return { label: current ? current.textContent : '', className: current ? current.className : '' }; })()`, true);
    for (let attempt = 0; attempt < 20 && mediaRequests.length === 0; attempt += 1) await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    if (!mediaRequests.some((item) => item && item.autoDownload === true && String(item.url || '').includes('/video.mp4'))) throw new Error(`per-video current-address action did not reach remote:media: action=${JSON.stringify(actionState)} requests=${JSON.stringify(mediaRequests)}`);
    await view.webContents.executeJavaScript(`window.postMessage({ type: 'AIAM_ALT_ORIGINAL_MEDIA_FOUND', items: [{ type: 'video', url: 'http://127.0.0.1:${port}/legacy-original.mp4', backupUrl: 'http://127.0.0.1:${port}/legacy-backup.mp4', messageId: 'legacy-smoke-1', title: 'Legacy public original' }] }, '*'); void 0;`, true);
    for (let attempt = 0; attempt < 20 && !mediaRequests.some((item) => item && String(item.source || '') === 'legacy-public-original'); attempt += 1) await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    const legacyRequest = mediaRequests.find((item) => item && String(item.source || '') === 'legacy-public-original');
    if (!legacyRequest || !String(legacyRequest.url || '').includes('/legacy-original.mp4') || legacyRequest.confirmedNoWatermark === true) throw new Error(`legacy original event was not routed safely: ${JSON.stringify(mediaRequests)}`);
    await view.webContents.executeJavaScript(`window.postMessage({ type: 'AIAM_DOLA_RESOURCE_DOWNLOAD', resource: { thirdVideoUrl: 'http://127.0.0.1:${port}/legacy-panel.mp4', messageId: 'legacy-panel-1', title: 'Legacy panel download' }, filename: 'legacy-panel.mp4' }, '*'); void 0;`, true);
    for (let attempt = 0; attempt < 20 && !mediaRequests.some((item) => item && String(item.source || '') === 'dola-resource-panel' && String(item.url || '').includes('/legacy-panel.mp4')); attempt += 1) await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    const legacyPanelRequest = mediaRequests.find((item) => item && String(item.source || '') === 'dola-resource-panel' && String(item.url || '').includes('/legacy-panel.mp4'));
    if (!legacyPanelRequest) throw new Error(`legacy resource download event did not reach the unified queue: ${JSON.stringify(mediaRequests)}`);
    await view.webContents.executeJavaScript(`window.postMessage({ type: 'AIAM_DOLA_RESOURCE_DOWNLOAD', resource: { thirdVideoUrl: 'http://127.0.0.1:${port}/legacy-panel-url-only.mp4', title: 'Legacy URL-only panel download' }, filename: 'legacy-panel-url-only.mp4' }, '*'); void 0;`, true);
    for (let attempt = 0; attempt < 20 && !mediaRequests.some((item) => item && String(item.source || '') === 'dola-resource-panel' && String(item.url || '').includes('/legacy-panel-url-only.mp4')); attempt += 1) await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    const legacyUrlOnlyRequest = mediaRequests.find((item) => item && String(item.source || '') === 'dola-resource-panel' && String(item.url || '').includes('/legacy-panel-url-only.mp4'));
    if (!legacyUrlOnlyRequest) throw new Error(`legacy URL-only resource download event did not reach the unified queue: ${JSON.stringify(mediaRequests)}`);
    console.log(`video notice smoke ok: one notice received (${notice.key}); per-video overlay=${overlayState.overlays}; remote media=${mediaRequests.length}; legacy events routed (id + URL-only)`);
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    failed = true;
    process.exitCode = 1;
  } finally {
    ipcMain.removeListener('remote:video-generated', remoteNoticeHandler);
    ipcMain.removeListener('remote:media', remoteMediaHandler);
    try { view?.webContents.debugger.detach(); } catch { /* cleanup */ }
    try { if (view && window) window.contentView.removeChildView(view); } catch { /* cleanup */ }
    try { view?.webContents.close(); } catch { /* cleanup */ }
    try { if (window && !window.isDestroyed()) window.destroy(); } catch { /* cleanup */ }
    await withTimeout(new Promise((resolvePromise) => { server.close(() => resolvePromise()); server.closeAllConnections?.(); server.closeIdleConnections?.(); }), 'server close', 3000).catch(() => undefined);
    try { rmSync(userData, { recursive: true, force: true }); } catch { /* Chromium may still hold a lock briefly */ }
    if (app.isReady()) {
      if (failed) app.exit(1);
      else app.quit();
    }
  }
}

main();
