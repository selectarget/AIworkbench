import { app, BrowserWindow, WebContentsView } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const testUserData = mkdtempSync(join(tmpdir(), 'aiam-task-workflows-'));
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-proxy-server');
app.commandLine.appendSwitch(
  'host-resolver-rules',
  'MAP www.dola.com 127.0.0.1, MAP www.doubao.com 127.0.0.1, EXCLUDE localhost'
);
app.setPath('userData', testUserData);

const timeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
]);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function dolaFixtureHtml(isThirtySecond) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Dola task fixture</title>
<style>
  body { margin: 24px; font: 16px sans-serif; background: #fff; color: #111; }
  #model, button, textarea { display: block; margin: 10px 0; }
  #model { width: 260px; padding: 10px; border: 1px solid #888; cursor: pointer; }
  button { min-width: 96px; min-height: 32px; }
  textarea { width: 520px; height: 90px; }
  #model-option { display: none; }
  #durations[data-thirty="true"] { display: none; }
</style></head>
<body>
  <div id="model" data-input-engine-actionbar-control-key="video-model">Seedance 2.0</div>
  <button id="model-option" role="option">Seedance 2.5</button>
  <div id="ratios">
    <button role="option" data-ratio="1:1">1:1</button>
    <button role="option" data-ratio="3:4">3:4</button>
    <button role="option" data-ratio="4:3">4:3</button>
    <button role="option" data-ratio="16:9">16:9</button>
    <button role="option" data-ratio="9:16">9:16</button>
    <button role="option" data-ratio="21:9">21:9</button>
  </div>
  <div id="durations" data-thirty="${isThirtySecond ? 'true' : 'false'}">
    <button role="option">15s</button>
    <button role="option">30s</button>
  </div>
  <textarea id="composer" placeholder="输入提示词"></textarea>
  <button id="send">生成</button>
  <script>
    window.__taskLog = [];
    const model = document.getElementById('model');
    const modelOption = document.getElementById('model-option');
    model.addEventListener('click', () => { modelOption.style.display = 'block'; });
    modelOption.addEventListener('click', () => {
      model.textContent = 'Seedance 2.5';
      modelOption.style.display = 'none';
      document.getElementById('durations').style.display = 'block';
      window.__taskLog.push({ kind: 'model', value: model.textContent });
    });
    document.querySelectorAll('[data-ratio]').forEach((button) => {
      button.addEventListener('click', () => {
        window.__taskLog.push({ kind: 'ratio', value: button.dataset.ratio });
      });
    });
    document.querySelectorAll('#durations button').forEach((button) => {
      button.addEventListener('click', () => {
        window.__taskLog.push({ kind: 'duration', value: button.textContent });
      });
    });
    document.getElementById('send').addEventListener('click', () => {
      const composer = document.getElementById('composer');
      window.__taskLog.push({ kind: 'send', prompt: composer.value, durationFlag: localStorage.getItem('intl_doubao_enable_30s_v1') });
      composer.value = '';
    });
  </script>
</body></html>`;
}

function doubaoFixtureHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Doubao task fixture</title>
<style>
  body { margin: 24px; font: 16px sans-serif; background: #fff; color: #111; }
  textarea { display: block; width: 520px; height: 90px; margin: 10px 0; }
  button { min-width: 96px; min-height: 32px; }
</style></head>
<body>
  <div data-input-engine-actionbar-control-key="video-model">Seedance 2.5</div>
  <textarea id="composer" placeholder="描述你想生成的视频"></textarea>
  <button id="send" type="submit">发送</button>
  <script>
    window.__taskLog = [];
    document.addEventListener('watermark-free-duration-30-change', () => {
      window.__taskLog.push({ kind: 'duration-bridge-event', value: localStorage.getItem('intl_doubao_enable_30s_v1') });
    });
    document.getElementById('send').addEventListener('click', (event) => {
      event.preventDefault();
      const composer = document.getElementById('composer');
      window.__taskLog.push({ kind: 'send', prompt: composer.value });
      composer.value = '';
    });
  </script>
</body></html>`;
}

async function startFixtureServer() {
  const server = createServer((request, response) => {
    const isDoubao = request.url?.startsWith('/doubao');
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(isDoubao ? doubaoFixtureHtml() : dolaFixtureHtml(request.url?.includes('/dola-30')));
  });
  await timeout(new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen)), 5000, 'fixture server');
  const address = server.address();
  assert(address && typeof address === 'object', 'fixture server did not expose an address');
  return { server, port: address.port };
}

async function createView(window, url) {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 900, height: 700 });
  await timeout(view.webContents.loadURL(url), 15000, `load ${url}`);
  return view;
}

async function evaluate(view, script, label) {
  return timeout(view.webContents.executeJavaScript(script, true), 10000, label);
}

async function readTaskLog(view) {
  return evaluate(view, `(() => window.__taskLog)()`, 'read task log');
}

async function closeView(window, view) {
  window.contentView.removeChildView(view);
  view.webContents.close();
  await new Promise((resolveClose) => setImmediate(resolveClose));
}

async function main() {
  await app.whenReady();
  const { buildDolaVideoTaskScript } = await import(
    pathToFileURL(resolve('out/main/dolaTask.js')).href
  );
  const { buildDoubao15sPromptSendScript, buildDoubaoDurationControlScript } = await import(
    pathToFileURL(resolve('out/main/doubaoTask.js')).href
  );
  const fixture = await startFixtureServer();
  let window;
  const views = [];
  try {
    window = new BrowserWindow({ show: false, width: 900, height: 700 });

    const dola15 = await createView(window, `http://www.dola.com:${fixture.port}/dola-15`);
    views.push(dola15);
    const result15 = await evaluate(
      dola15,
      buildDolaVideoTaskScript('fixture 15 second prompt', '9:16', 15, 0),
      'Dola 15s workflow'
    );
    const log15 = await readTaskLog(dola15);
    const send15 = log15.find((entry) => entry.kind === 'send');
    assert(result15?.ok === true && result15?.clicked === true, 'Dola 15s script did not complete');
    assert(result15.duration === 15 && result15.aspectRatio === '9:16', 'Dola 15s options were not selected');
    assert(send15?.prompt.includes('fixture 15 second prompt') && send15?.prompt.includes('15 秒') && send15?.prompt.includes('9:16'), 'Dola 15s prompt was not sent through the page');

    const dola30 = await createView(window, `http://www.dola.com:${fixture.port}/dola-30`);
    views.push(dola30);
    const result30 = await evaluate(
      dola30,
      buildDolaVideoTaskScript('fixture 30 second prompt', '21:9', 30, 0),
      'Dola 30s workflow'
    );
    const log30 = await readTaskLog(dola30);
    const send30 = log30.find((entry) => entry.kind === 'send');
    assert(result30?.ok === true && result30?.clicked === true, 'Dola 30s script did not complete');
    assert(result30.duration === 30 && result30.aspectRatio === '21:9', 'Dola 30s options were not selected');
    assert(log30.some((entry) => entry.kind === 'model' && entry.value === 'Seedance 2.5'), 'Dola 30s did not select Seedance 2.5');
    assert(send30?.prompt.includes('fixture 30 second prompt') && send30?.prompt.includes('30 秒') && send30?.prompt.includes('21:9') && send30?.durationFlag === '1', 'Dola 30s page state was not set correctly');

    const doubao = await createView(window, `http://www.doubao.com:${fixture.port}/doubao`);
    views.push(doubao);
    const doubaoResult = await evaluate(
      doubao,
      buildDoubao15sPromptSendScript('fixture Doubao 15 second prompt'),
      'Doubao 15s workflow'
    );
    const doubaoLog = await readTaskLog(doubao);
    const doubaoSend = doubaoLog.find((entry) => entry.kind === 'send');
    assert(doubaoResult?.ok === true, 'Doubao 15s script did not complete');
    assert(doubaoSend?.prompt.includes('fixture Doubao 15 second prompt'), 'Doubao prompt was not sent through the page');
    const doubaoDuration30 = await evaluate(
      doubao,
      buildDoubaoDurationControlScript(30),
      'Doubao 30s duration control'
    );
    assert(doubaoDuration30?.ok === true && doubaoDuration30.duration === 30, 'Doubao 30s duration control did not complete');
    assert(doubaoDuration30.durationFlag === '1' && doubaoDuration30.modelSupports30 === true, 'Doubao 30s page state was not enabled for Seedance 2.5');
    const doubaoDuration15 = await evaluate(
      doubao,
      buildDoubaoDurationControlScript(15),
      'Doubao 15s duration control'
    );
    const durationEvents = (await readTaskLog(doubao)).filter((entry) => entry.kind === 'duration-bridge-event');
    assert(doubaoDuration15?.ok === true && doubaoDuration15.duration === 15 && doubaoDuration15.durationFlag === '0', 'Doubao 15s duration control did not restore the page state');
    assert(durationEvents.length === 2 && durationEvents.at(-1)?.value === '0', 'Doubao duration bridge event was not published');

    console.log(JSON.stringify({
      dola15: { ok: result15.ok, duration: result15.duration, aspectRatio: result15.aspectRatio },
      dola30: { ok: result30.ok, duration: result30.duration, aspectRatio: result30.aspectRatio, model: 'Seedance 2.5' },
      doubao15: { ok: doubaoResult.ok, promptSent: true },
      doubaoDuration: { enabled30: doubaoDuration30.durationFlag === '1', restored15: doubaoDuration15.durationFlag === '0', bridgeEvents: durationEvents.length },
      note: '本地正常页面 fixture；未宣称真实登录态、真实生成或真实下载已验证'
    }, null, 2));
  } finally {
    for (const view of views.reverse()) {
      try { await closeView(window, view); } catch {}
    }
    if (window && !window.isDestroyed()) window.destroy();
    await new Promise((resolveClose) => fixture.server.close(resolveClose));
  }
}

main()
  .then(() => {
    try { rmSync(testUserData, { recursive: true, force: true }); } catch {}
    app.exit(0);
  })
  .catch((error) => {
    console.error(error?.stack || error);
    try { rmSync(testUserData, { recursive: true, force: true }); } catch {}
    app.exit(1);
  });
