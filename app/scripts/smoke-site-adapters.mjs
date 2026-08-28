import { app, BrowserWindow, WebContentsView, ipcMain, session } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const userData = mkdtempSync(join(tmpdir(), 'aiam-site-adapters-'));
const remotePreload = resolve('out/preload/remote.js');
const browserCompatSource = readFileSync(resolve('site-assets/scripts/browser-compat.js'), 'utf8');
const dolaDurationSource = readFileSync(resolve('site-assets/scripts/dola-duration-bridge.js'), 'utf8');
const dolaDurationSeedSource = `(() => { try { localStorage.setItem('intl_doubao_enable_30s_v1', '1'); } catch {} })();`;
const errorProbeSource = `(() => { window.__aiamAdapterErrors = []; window.addEventListener('error', event => window.__aiamAdapterErrors.push(String(event.error?.stack || event.message || 'error'))); window.addEventListener('unhandledrejection', event => window.__aiamAdapterErrors.push(String(event.reason?.stack || event.reason || 'rejection'))); })();`;
const doubaoCreationSource = readFileSync(resolve('site-assets/scripts/doubao-creation-download.js'), 'utf8');
const higgsfieldSource = readFileSync(resolve('site-assets/scripts/higgsfield-course.js'), 'utf8');
const jimengSource = readFileSync(resolve('site-assets/scripts/jimeng-image-download.js'), 'utf8');
// The real Jimeng hostname is HSTS-preloaded in Chromium, so a plain local
// HTTP fixture would be upgraded before it reaches the test server. The
// production source stays unchanged; only this fixture removes its explicit
// hostname guard while static adapter tests continue to cover that guard.
const jimengFixtureSource = jimengSource.split(/\r?\n/).filter((line) => !(line.includes('location.hostname') && line.includes('jimeng'))).join('\n');
const genericCaptureSource = readFileSync(resolve('site-assets/scripts/generic-video-capture.js'), 'utf8');
const fixtureImage = readFileSync(resolve('build-assets/app.png'));

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-proxy-server');
app.commandLine.appendSwitch(
  'host-resolver-rules',
  [
    'MAP www.dola.com 127.0.0.1',
    'MAP www.doubao.com 127.0.0.1',
    'MAP higgsfield.ai 127.0.0.1',
    'MAP www.higgsfield.ai 127.0.0.1',
    'MAP jimeng.jianying.com 127.0.0.1',
    'EXCLUDE localhost'
  ].join(',')
);
app.setPath('userData', userData);

function listen(server) {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise(server.address().port));
  });
}

function withTimeout(promise, label, milliseconds = 15_000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function readRequest(request) {
  return new Promise((resolvePromise) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    request.on('error', () => resolvePromise(''));
  });
}

function json(response, value, status = 200) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(body);
}

const requests = [];
let fixturePort = 0;

const server = createServer((request, response) => {
  void (async () => {
    const path = String(request.url || '/').split('?')[0];
    const body = await readRequest(request);
    if (body) {
      let parsed = body;
      try { parsed = JSON.parse(body); } catch { /* keep non-JSON request bodies for diagnostics */ }
      requests.push({ host: String(request.headers.host || ''), path, body: parsed });
    }

    if (path === '/chat/completion') {
      json(response, { code: 0, data: { ok: true } });
      return;
    }

    if (path === '/samantha/aispace/homepage') {
      json(response, {
        code: 0,
        data: {
          nodes: [{ id: '100000001', key: '100000001', name: '我的创作', node_type: 1 }]
        }
      });
      return;
    }

    if (path === '/samantha/aispace/node_info') {
      json(response, {
        code: 0,
        data: {
          has_more: false,
          next_cursor: '',
          nodes: [{
            id: '100000002',
            key: 'vfixture001',
            name: 'fixture.mp4',
            node_type: 6,
            node_cover: { list_view: { cover_url: 'https://cdn.example.test/fixture-cover.jpg' } },
            content: { width: 1920, height: 1080, duration: 5, message_id_str: '100000003' }
          }]
        }
      });
      return;
    }

    if (path === '/samantha/aispace/get_download_info') {
      json(response, {
        code: 0,
        data: {
          download_infos: [{
            main_url: 'https://videoweb-download.doubao.com/download/fixture.mp4?download=true&mime_type=video_mp4',
            backup_url: 'https://videoweb.doubao.com/download/fixture-backup.mp4?download=true&mime_type=video_mp4'
          }]
        }
      });
      return;
    }

    if (path === '/mweb/v1/get_local_item_list') {
      json(response, {
        ret: '0',
        data: {
          item_list: [{
            common_attr: { title: '夹具原图' },
            image: {
              large_images: [{ image_url: `http://jimeng.jianying.com:${fixturePort}/jimeng-original.png`, width: 2048, height: 2048 }]
            }
          }]
        }
      });
      return;
    }

    if (path.endsWith('.png') || path.endsWith('.jpg') || path.endsWith('.jpeg')) {
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': fixtureImage.length });
      response.end(fixtureImage);
      return;
    }

    const host = String(request.headers.host || '').split(':')[0].toLowerCase();
    if (host.includes('dola.com')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html>
        <title>Dola duration adapter fixture</title>
        <style>
          #duration-menu { width: 180px; height: 120px; padding: 8px; }
          #duration-menu button { display: block; width: 100px; height: 32px; }
          #model { width: 180px; height: 34px; }
        </style>
        <main>
          <div id="model" data-input-engine-actionbar-control-key="video-model">Seedance 2.5</div>
          <div id="duration-menu" role="menu">
            <button role="menuitem">5s</button>
            <button role="menuitem">10s</button>
          </div>
        </main>
        <script>
          localStorage.setItem('intl_doubao_enable_30s_v1', '1');
          setTimeout(() => {
            fetch('/chat/completion', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ chat_ability: { ability_type: 17, ability_param: JSON.stringify({ model: 'seedance_v2.5', duration: 15 }) } })
            }).catch(() => undefined);
          }, 250);
        </script>`);
      return;
    }

    if (host.includes('higgsfield.ai')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>Higgsfield adapter fixture</title><main>course fixture</main>');
      return;
    }

    if (host.includes('jimeng.jianying.com') || path === '/ai-tool/asset') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html>
        <title>即梦资产夹具</title>
        <main>
          <article class="asset-card" style="width:260px;height:260px;padding:20px">
            <img id="asset-image" src="/fixture.png" alt="夹具图片" style="width:220px;height:220px" />
          </article>
        </main>
        <script>
          const image = document.getElementById('asset-image');
          image.__reactFiber$fixture = { memoizedProps: { record: { prompt: '夹具原图', imageList: [{ itemId: '100000004', imageUri: image.src }] } } };
        </script>`);
      return;
    }

    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>site adapter fixture</title><main>fixture</main>');
  })().catch((error) => {
    json(response, { code: 500, message: error instanceof Error ? error.message : String(error) }, 500);
  });
});

let window;
const views = new Map();
const mediaMessages = [];
const remoteMediaHandler = (event, raw) => {
  const label = views.get(event.sender.id);
  if (label) mediaMessages.push({ label, raw });
};

async function createFixtureView(label, targetUrl, scripts, options = {}) {
  const partition = `persist:${label}`;
  const view = new WebContentsView({
    webPreferences: {
      preload: remotePreload,
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  views.set(view.webContents.id, label);
  window.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1100, height: 760 });
  try {
    if (options.beforeLoad) await options.beforeLoad(session.fromPartition(partition));
    await withTimeout(view.webContents.loadURL('about:blank'), `${label} bootstrap`);
    view.webContents.debugger.attach('1.3');
    await view.webContents.debugger.sendCommand('Page.enable');
    for (const source of scripts) {
      await view.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source });
    }
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

async function closeFixtureView(view) {
  try { view.webContents.debugger.detach(); } catch { /* cleanup */ }
  try { window.contentView.removeChildView(view); } catch { /* cleanup */ }
  try { view.webContents.close(); } catch { /* cleanup */ }
  views.delete(view.webContents.id);
}

async function execute(view, source) {
  return withTimeout(view.webContents.executeJavaScript(`(${source})()`, true), 'executeJavaScript');
}

async function main() {
  let failed = false;
  let higgsRedirectListener;
  try {
    fixturePort = await listen(server);
    await app.whenReady();
    window = new BrowserWindow({ show: false, width: 1100, height: 760, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    ipcMain.on('remote:media', remoteMediaHandler);

    const dolaView = await createFixtureView('adapter-dola', `http://www.dola.com:${fixturePort}/chat`, [errorProbeSource, dolaDurationSeedSource, browserCompatSource, dolaDurationSource]);
    await wait(2500);
    const dolaState = await execute(dolaView, () => ({
      installed: window.__watermarkFreeDurationAudioReferenceInstalledV1 === true,
      key: localStorage.getItem('intl_doubao_enable_30s_v1'),
      enabled: document.documentElement.getAttribute('data-watermark-free-duration-30') === '1',
      option30: Boolean(document.querySelector('[data-watermark-free-duration-option="30"]')),
      model: document.querySelector('[data-input-engine-actionbar-control-key="video-model"]')?.textContent || '',
      menu: (() => { const node = document.querySelector('#duration-menu'); const rect = node?.getBoundingClientRect(); return { text: node?.textContent || '', width: rect?.width || 0, height: rect?.height || 0 }; })(),
      errors: window.__aiamAdapterErrors || []
    }));
    const durationRequest = requests.find((item) => item.host.startsWith('www.dola.com:') && item.path === '/chat/completion');
    const durationPayload = durationRequest?.body?.chat_ability?.ability_param ? JSON.parse(durationRequest.body.chat_ability.ability_param) : null;
    if (!dolaState.installed || dolaState.key !== '1' || !dolaState.option30 || !/Seedance 2\.5/.test(dolaState.model) || durationPayload?.duration !== 30) {
      throw new Error(`Dola duration adapter failed: ${JSON.stringify({ dolaState, durationPayload })}`);
    }
    console.log('Dola duration adapter ok: 30s option and ability_type=17 request patch');
    await closeFixtureView(dolaView);

    const doubaoView = await createFixtureView('adapter-doubao', `http://www.doubao.com:${fixturePort}/chat/create-image?tab=myCreation`, [browserCompatSource, doubaoCreationSource]);
    await wait(350);
    const doubaoResult = await execute(doubaoView, () => window.__AIAM_DOUBAO_CREATION_SCAN_TO_RESOURCE_PANEL__());
    await wait(500);
    const doubaoMessage = mediaMessages.find((item) => item.label === 'adapter-doubao' && item.raw?.type === 'video' && String(item.raw.url || '').includes('videoweb-download.doubao.com'));
    if (!doubaoResult?.ok || Number(doubaoResult.count) !== 1 || !doubaoMessage?.raw?.confirmedNoWatermark || doubaoMessage.raw.source !== 'doubao-creation-resource-panel') {
      throw new Error(`Doubao creation adapter failed: ${JSON.stringify({ doubaoResult, doubaoMessage, mediaMessages })}`);
    }
    console.log('Doubao creation adapter ok: public download-info result reached remote media bridge');
    await closeFixtureView(doubaoView);

    const higgsSession = session.fromPartition('persist:adapter-higgsfield');
    higgsRedirectListener = (details, callback) => {
      const target = new URL(details.url);
      callback({ redirectURL: `http://www.higgsfield.ai:${fixturePort}${target.pathname}${target.search}${target.hash}` });
    };
    higgsSession.webRequest.onBeforeRequest({ urls: ['https://higgsfield.ai/*', 'https://www.higgsfield.ai/*'] }, higgsRedirectListener);
    const higgsView = await createFixtureView('adapter-higgsfield', `http://www.higgsfield.ai:${fixturePort}/quiz`, [browserCompatSource, higgsfieldSource]);
    await wait(7000);
    const higgsState = await execute(higgsView, () => ({ marker: window.__WORKBENCH_HIGGSFIELD_COURSE__ === true, url: location.href }));
    if (!higgsState.marker || !/\/academy\/courses\/cinema-studio-pro\/set-up-your-project$/i.test(new URL(higgsState.url).pathname)) {
      throw new Error(`Higgsfield course adapter failed: ${JSON.stringify(higgsState)}`);
    }
    console.log('Higgsfield course adapter ok: quiz -> introduction -> setup bounded navigation');
    await closeFixtureView(higgsView);

    const jimengView = await createFixtureView('adapter-jimeng', `http://127.0.0.1:${fixturePort}/ai-tool/asset`, [errorProbeSource, browserCompatSource, genericCaptureSource, jimengFixtureSource]);
    await wait(1200);
    const jimengState = await execute(jimengView, () => ({
      marker: window.__AIAM_JIMENG_IMAGE_DOWNLOAD__ || '',
      cards: document.querySelectorAll('.aiam-jimeng-download-card').length,
      buttons: document.querySelectorAll('.aiam-jimeng-original-download').length,
      panel: Boolean(document.querySelector('.aiam-jimeng-select-panel')),
      url: location.href,
      errors: window.__aiamAdapterErrors || [],
      image: (() => { const image = document.querySelector('#asset-image'); const rect = image?.getBoundingClientRect(); return { complete: image?.complete, naturalWidth: image?.naturalWidth, naturalHeight: image?.naturalHeight, clientWidth: image?.clientWidth, clientHeight: image?.clientHeight, rectWidth: rect?.width, rectHeight: rect?.height, src: image?.currentSrc || image?.src || '' }; })()
    }));
    if (!jimengState.marker || jimengState.cards < 1 || jimengState.buttons < 1 || !jimengState.panel) {
      throw new Error(`Jimeng adapter did not install controls: ${JSON.stringify(jimengState)}`);
    }
    await execute(jimengView, () => { document.querySelector('.aiam-jimeng-original-download')?.click(); return true; });
    await wait(700);
    const jimengMessage = mediaMessages.find((item) => item.label === 'adapter-jimeng' && item.raw?.type === 'image' && String(item.raw.url || '').includes('/jimeng-original.png'));
    if (!jimengMessage?.raw || jimengMessage.raw.source !== 'site-download') {
      throw new Error(`Jimeng original download bridge failed: ${JSON.stringify({ jimengState, jimengMessage, mediaMessages })}`);
    }
    console.log('Jimeng original adapter ok: asset button -> page download message -> remote media bridge');
    await closeFixtureView(jimengView);
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    failed = true;
    process.exitCode = 1;
  } finally {
    ipcMain.removeListener('remote:media', remoteMediaHandler);
    if (higgsRedirectListener) {
      try { session.fromPartition('persist:adapter-higgsfield').webRequest.onBeforeRequest(null); } catch { /* cleanup */ }
    }
    for (const [id] of views) {
      try { BrowserWindow.getAllWindows().flatMap((candidate) => candidate.contentView.children).find((child) => child.webContents.id === id)?.webContents.close(); } catch { /* cleanup */ }
      views.delete(id);
    }
    try { if (window && !window.isDestroyed()) window.destroy(); } catch { /* cleanup */ }
    await withTimeout(new Promise((resolvePromise) => {
      server.close(() => resolvePromise());
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
