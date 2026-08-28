import { app, BrowserWindow, WebContentsView, ipcMain } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const userData = mkdtempSync(join(tmpdir(), 'aiam-platform-pages-'));
const remotePreload = resolve('out/preload/remote.js');
const browserCompatSource = readFileSync(resolve('site-assets/scripts/browser-compat.js'), 'utf8');
const genericCaptureSource = readFileSync(resolve('site-assets/scripts/generic-video-capture.js'), 'utf8');
const dolaBridgeSource = readFileSync(resolve('site-assets/scripts/dola-resource-bridge.js'), 'utf8');
const pageMessageProbeSource = `(() => {
  window.__aiamSmokeMessages = [];
  window.addEventListener('message', (event) => {
    if (event.source === window && event.data && typeof event.data === 'object' && event.data.type) window.__aiamSmokeMessages.push(event.data);
  });
})();`;
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-proxy-server');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP www.kimi.com 127.0.0.1,MAP www.dola.com 127.0.0.1,EXCLUDE localhost');
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

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

const server = createServer((request, response) => {
  const path = String(request.url || '/').split('?')[0];
  if (path === '/api/kimi') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ result: { image_url: 'https://cdn.example.test/generated/kimi-api.png', width: 1024, height: 1024 } }));
    return;
  }
  if (/\.(?:png|jpg|jpeg|webp|mp4)$/i.test(path)) {
    if (/\.mp4$/i.test(path)) {
      response.writeHead(200, { 'content-type': 'video/mp4' });
      response.end(Buffer.from('aiam-platform-page-fixture'));
    } else {
      response.writeHead(200, { 'content-type': 'image/svg+xml' });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#6b7280"/></svg>');
    }
    return;
  }
  if (path === '/dola') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html>
      <title>Dola platform page smoke</title>
      <main><div id="generation-state">正在生成视频</div></main>
      <script>
        setTimeout(() => {
          const state = document.getElementById('generation-state');
          state.textContent = '生成完成';
          const root = document.createElement('section');
          root.className = 'creation-card generated-video';
          root.style.width = '640px';
          root.style.height = '420px';
          root.innerHTML = '<video id="dola-result" src="/media/dola-result.mp4" poster="/media/dola-poster.jpg" style="width:640px;height:360px"></video><button>下载视频</button><span>Dola fixture generated video</span>';
          document.querySelector('main').appendChild(root);
          const slash = String.fromCharCode(92);
          window._ROUTER_DATA = { video_url: '"https:' + slash + '/' + slash + '/cdn.example.test/media/dola-encoded.mp4?x=1&amp;y=2' + slash + 'u0026z=3"' };
          root.setAttribute('data-encoded-resource', '1');
        }, 1600);
      </script>`);
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html>
    <title>Kimi platform page smoke</title>
    <style>
      main { padding: 24px; }
      .generated { width: 900px; min-height: 520px; }
      .generated img { width: 512px; height: 512px; }
      .generated video { width: 640px; height: 360px; }
    </style>
    <main><article class="generated" data-testid="generated-card">
      <h1>Generated Kimi assets</h1>
      <div class="generated-image" data-image-url="/media/kimi-result.png" data-mime-type="image/png" style="width:512px;height:512px">generated image</div>
      <picture><source srcset="/media/kimi-responsive.webp 1x, /media/kimi-responsive@2x.webp 2x"><img src="/media/kimi-result.png" srcset="/media/kimi-result-small.webp 1x, /media/kimi-result-large.webp 2x" width="512" height="512" alt="generated responsive image"></picture>
      <div class="generated-background" data-background-image="/media/kimi-card-result.webp" style="width:512px;height:512px;background-image:url('/media/kimi-card-result.webp')"></div>
      <video src="/media/kimi-result.mp4" poster="/media/kimi-poster.jpg"><source src="/media/kimi-source.webm" type="video/webm"></video>
    </article></main>
    <script>
      fetch('/api/kimi').catch(() => undefined);
      setTimeout(() => {
        const slash = String.fromCharCode(92);
        const encoded = '"' + 'https:' + slash + '/' + slash + '/cdn.example.test/media/kimi-download.mp4?x=1&amp;y=2' + slash + 'u0026z=3' + '"';
        window.postMessage({ type: 'electronDownload', data: { url: encoded, filename: 'kimi-download.mp4' } }, '*');
      }, 180);
    </script>`);
});

let window;
const views = new Map();
const mediaMessages = [];
const noticeMessages = [];
const remoteMediaHandler = (event, raw) => {
  const label = views.get(event.sender.id);
  if (label) mediaMessages.push({ label, raw });
};
const remoteNoticeHandler = (event, raw) => {
  const label = views.get(event.sender.id);
  if (label) noticeMessages.push({ label, raw });
};

async function createFixtureView(label, targetUrl, scripts) {
  const view = new WebContentsView({ webPreferences: { preload: remotePreload, partition: `persist:${label}`, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  views.set(view.webContents.id, label);
  window.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1100, height: 760 });
  try {
    await withTimeout(view.webContents.loadURL('about:blank'), `${label} bootstrap`);
    view.webContents.debugger.attach('1.3');
    await view.webContents.debugger.sendCommand('Page.enable');
    for (const source of scripts) await view.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source });
    await withTimeout(view.webContents.loadURL(targetUrl), `${label} page load`);
    return view;
  } catch (error) {
    try { view.webContents.debugger.detach(); } catch { /* cleanup */ }
    try { window.contentView.removeChildView(view); } catch { /* cleanup */ }
    try { view.webContents.close(); } catch { /* cleanup */ }
    views.delete(view.webContents.id);
    throw error;
  }
}

async function main() {
  let failed = false;
  let port;
  try {
    port = await listen(server);
    await app.whenReady();
    window = new BrowserWindow({ show: false, width: 1100, height: 760, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    ipcMain.on('remote:media', remoteMediaHandler);
    ipcMain.on('remote:video-generated', remoteNoticeHandler);

    const kimiView = await createFixtureView('platform-kimi', `http://www.kimi.com:${port}/kimi`, [pageMessageProbeSource, browserCompatSource, genericCaptureSource]);
    await wait(1400);
    const kimiMessages = mediaMessages.filter((item) => item.label === 'platform-kimi').map((item) => item.raw);
    const kimiTypes = new Set(kimiMessages.map((item) => item?.type));
    const kimiState = await kimiView.webContents.executeJavaScript(`({ generic: Boolean(window.__genericVideoCaptureInstalled), compat: Boolean(window.__AIAM_BROWSER_COMPAT), imageNodes: document.querySelectorAll('[data-image-url]').length, imageUrl: document.querySelector('[data-image-url]')?.getAttribute('data-image-url') || '', html: document.querySelector('main')?.innerHTML?.slice(0, 400) || '', pageMessages: window.__aiamSmokeMessages || [] })`, true);
    if (!kimiMessages.some((item) => item?.type === 'image' && String(item.url || '').includes('/media/kimi-result.png'))) throw new Error(`generic page image capture failed: ${JSON.stringify({ kimiState, kimiMessages })}`);
    if (!kimiMessages.some((item) => item?.type === 'video' && String(item.url || '').includes('/media/kimi-result.mp4'))) throw new Error(`generic page video capture failed: ${JSON.stringify(kimiMessages)}`);
    if (!kimiMessages.some((item) => item?.type === 'image' && String(item.url || '').includes('/media/kimi-responsive.webp'))) throw new Error(`responsive picture capture failed: ${JSON.stringify(kimiMessages)}`);
    if (!kimiMessages.some((item) => item?.type === 'image' && String(item.url || '').includes('/media/kimi-card-result.webp'))) throw new Error(`background image capture failed: ${JSON.stringify(kimiMessages)}`);
    if (!kimiMessages.some((item) => item?.type === 'video' && String(item.url || '').includes('/media/kimi-source.webm'))) throw new Error(`picture/source video capture failed: ${JSON.stringify(kimiMessages)}`);
    if (!kimiMessages.some((item) => item?.autoDownload === true && item.url === 'https://cdn.example.test/media/kimi-download.mp4?x=1&y=2&z=3')) throw new Error(`escaped electronDownload URL normalization failed: ${JSON.stringify(kimiMessages)}`);
    if (!kimiTypes.has('image') || !kimiTypes.has('video')) throw new Error(`generic page did not produce both media types: ${JSON.stringify(kimiMessages)}`);
    console.log(`generic platform page ok: ${kimiMessages.length} remote media messages (${[...kimiTypes].join(', ')})`);
    try { kimiView.webContents.debugger.detach(); } catch { /* cleanup */ }
    window.contentView.removeChildView(kimiView);
    kimiView.webContents.close();
    views.delete(kimiView.webContents.id);

    const fallbackView = await createFixtureView('platform-remote-fallback', `http://www.kimi.com:${port}/kimi`, [browserCompatSource]);
    await wait(1600);
    const fallbackMessages = mediaMessages.filter((item) => item.label === 'platform-remote-fallback').map((item) => item.raw);
    const fallbackMessagesFromRemote = fallbackMessages.filter((item) => item?.source === 'dom-fallback');
    if (!fallbackMessagesFromRemote.some((item) => item?.type === 'image' && String(item.url || '').includes('/media/kimi-result.png'))) throw new Error(`remote preload fallback image capture failed: ${JSON.stringify(fallbackMessages)}`);
    if (!fallbackMessagesFromRemote.some((item) => item?.type === 'image' && String(item.url || '').includes('/media/kimi-responsive.webp'))) throw new Error(`remote preload fallback responsive capture failed: ${JSON.stringify(fallbackMessages)}`);
    if (!fallbackMessagesFromRemote.some((item) => item?.type === 'image' && String(item.url || '').includes('/media/kimi-card-result.webp'))) throw new Error(`remote preload fallback background capture failed: ${JSON.stringify(fallbackMessages)}`);
    if (!fallbackMessagesFromRemote.some((item) => item?.type === 'video' && String(item.url || '').includes('/media/kimi-source.webm'))) throw new Error(`remote preload fallback source capture failed: ${JSON.stringify(fallbackMessages)}`);
    console.log(`remote preload fallback ok: ${fallbackMessagesFromRemote.length} dom-fallback media messages`);
    try { fallbackView.webContents.debugger.detach(); } catch { /* cleanup */ }
    window.contentView.removeChildView(fallbackView);
    fallbackView.webContents.close();
    views.delete(fallbackView.webContents.id);

    const dolaView = await createFixtureView('platform-dola', `http://www.dola.com:${port}/dola`, [browserCompatSource, genericCaptureSource, dolaBridgeSource]);
    await wait(4200);
    const dolaMedia = mediaMessages.filter((item) => item.label === 'platform-dola').map((item) => item.raw);
    const dolaNotices = noticeMessages.filter((item) => item.label === 'platform-dola').map((item) => item.raw);
    if (!dolaMedia.some((item) => item?.type === 'video' && String(item.url || '').includes('/media/dola-result.mp4'))) throw new Error(`Dola page media bridge failed: ${JSON.stringify(dolaMedia)}`);
    if (!dolaNotices.some((item) => String(item?.key || '').includes('/media/dola-result.mp4') || String(item?.title || '').includes('Dola fixture'))) throw new Error(`Dola generated notice failed: ${JSON.stringify(dolaNotices)}`);
    const dolaState = await dolaView.webContents.executeJavaScript(`({ bridge: Boolean(window.__AIAM_DOLA_RESOURCE_BRIDGE__), video: document.querySelectorAll('video').length, overlay: document.querySelectorAll('.aiam-dola-video-overlay').length })`, true);
    if (!dolaState.bridge || dolaState.video < 1 || dolaState.overlay < 1) throw new Error(`Dola page bridge UI failed: ${JSON.stringify(dolaState)}`);
    console.log(`Dola platform page ok: ${dolaMedia.length} remote media messages, ${dolaNotices.length} generated notice(s), overlay=${dolaState.overlay}`);
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    failed = true;
    process.exitCode = 1;
  } finally {
    ipcMain.removeListener('remote:media', remoteMediaHandler);
    ipcMain.removeListener('remote:video-generated', remoteNoticeHandler);
    for (const [id] of views) {
      try { BrowserWindow.getAllWindows().flatMap((candidate) => candidate.contentView.children).find((child) => child.webContents.id === id)?.webContents.close(); } catch { /* cleanup */ }
      views.delete(id);
    }
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
