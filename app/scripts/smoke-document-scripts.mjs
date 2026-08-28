import { app, BrowserWindow, WebContentsView } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const userData = mkdtempSync(join(tmpdir(), 'aiam-document-scripts-'));
const browserCompatSource = readFileSync(join(process.cwd(), 'site-assets', 'scripts', 'browser-compat.js'), 'utf8');
console.log('document script smoke starting');
app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', userData);

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function withTimeout(promise, label, milliseconds = 15000) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function execute(view, script) {
  return withTimeout(view.webContents.executeJavaScript(`(${script})()`, true), 'executeJavaScript');
}

const server = createServer((request, response) => {
  if (request.url === '/probe') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('probe-ok');
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html>
    <title>${'early-script-smoke'}</title>
    <script>
      window.__aiamInlineSawEarlyScript = window.__aiamEarlyDocumentScript === true;
    </script>
    <main id="result"></main>
    <script>
      fetch('/probe').then(response => response.text()).then(value => {
        document.getElementById('result').dataset.probe = value;
      });
    </script>`);
});

let window;
let view;

async function main() {
  let failed = false;
  try {
    const port = await listen(server);
    console.log(`document script smoke server listening on ${port}`);
    await app.whenReady();
    console.log('document script smoke app ready');
    window = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    console.log('document script smoke view created');
    window.contentView.addChildView(view);
    console.log('document script smoke view attached');
    await withTimeout(view.webContents.loadURL('about:blank'), 'bootstrap blank page');
    console.log('document script smoke blank document ready');
    view.webContents.debugger.attach('1.3');
    console.log('document script smoke debugger attached');
    await view.webContents.debugger.sendCommand('Page.enable');
    console.log('document script smoke page domain enabled');
    await view.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        window.__aiamEarlyDocumentScript = true;
        const originalFetch = window.fetch;
        window.fetch = function (...args) {
          window.__aiamFetchObserved = true;
          return originalFetch.apply(this, args);
        };
      })();`
    });
    console.log('document script smoke early script registered');
    await view.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: browserCompatSource });
    console.log('document script smoke browser compatibility script registered');
    await withTimeout(view.webContents.loadURL(`http://127.0.0.1:${port}/`), 'loadURL');
    let result;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      result = await execute(view, () => ({
        inlineSawEarlyScript: window.__aiamInlineSawEarlyScript === true,
        fetchObserved: window.__aiamFetchObserved === true,
        probe: document.getElementById('result')?.dataset.probe || '',
        browserCompat: window.__AIAM_BROWSER_COMPAT === true,
        chromeRuntime: Boolean(window.chrome && window.chrome.runtime),
        connection: Boolean(navigator.connection),
        plugins: Boolean(navigator.plugins && navigator.plugins.length >= 1),
        mimeTypes: Boolean(navigator.mimeTypes && navigator.mimeTypes.length >= 1),
        outerShape: window.outerWidth >= window.innerWidth && window.outerHeight >= window.innerHeight,
        hasFocusCompat: typeof Document !== 'undefined' && Document.prototype.hasFocus.__aiamCompat === true
      }));
      if (result.probe === 'probe-ok') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!result?.inlineSawEarlyScript || !result.fetchObserved || result.probe !== 'probe-ok' || !result.browserCompat || !result.chromeRuntime || !result.connection || !result.plugins || !result.mimeTypes || !result.outerShape || !result.hasFocusCompat) throw new Error(`document script ordering or browser compatibility failed: ${JSON.stringify(result)}`);
    console.log('document script ordering and browser compatibility ok: early hooks run before inline page code and observe first fetch');
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    failed = true;
    process.exitCode = 1;
  } finally {
    try { if (view && window) window.contentView.removeChildView(view); } catch { /* cleanup */ }
    try { view?.webContents.close(); } catch { /* cleanup */ }
    try { if (window && !window.isDestroyed()) window.destroy(); } catch { /* cleanup */ }
    await withTimeout(new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
    }), 'server close', 3000).catch(() => undefined);
    try { rmSync(userData, { recursive: true, force: true }); } catch { /* the OS may still hold a Chromium lock briefly */ }
    if (app.isReady()) {
      if (failed) app.exit(1);
      else app.quit();
    }
  }
}

main();
