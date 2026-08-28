import { app, BrowserWindow, WebContentsView, session } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const userData = mkdtempSync(join(tmpdir(), 'aiam-account-isolation-'));
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

async function load(view, url) {
  await withTimeout(view.webContents.loadURL(url), 'loadURL');
}

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><title>isolation smoke</title><main>local isolation fixture</main>');
});

let window;
let first;
let second;
let firstSession;
let secondSession;

async function main() {
let failed = false;
try {
  const port = await listen(server);
  console.log(`isolation smoke server listening on ${port}`);
  console.log('isolation smoke waiting for app ready');
  await app.whenReady();
  console.log('isolation smoke app ready');
  const url = `http://127.0.0.1:${port}/`;
  window = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  console.log('isolation smoke window created');
  firstSession = session.fromPartition('persist:account_smoke_a');
  secondSession = session.fromPartition('persist:account_smoke_b');
  first = new WebContentsView({ webPreferences: { session: firstSession, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  second = new WebContentsView({ webPreferences: { session: secondSession, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.contentView.addChildView(first);
  window.contentView.addChildView(second);
  await Promise.all([load(first, url), load(second, url)]);
  console.log('isolation smoke pages loaded');

  const firstMarker = await execute(first, async function () {
    localStorage.setItem('owner', 'account-a');
    document.cookie = 'owner=account-a; Path=/';
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('aiam-isolation-smoke', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('values');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('values', 'readwrite');
      transaction.objectStore('values').put('account-a', 'owner');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    const cache = await caches.open('aiam-isolation-smoke');
    await cache.put('/owner', new Response('account-a'));
    return { local: localStorage.getItem('owner'), cookie: document.cookie };
  });
  const secondBefore = await execute(second, async function () {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('aiam-isolation-smoke', 1);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => request.result.createObjectStore('values');
      request.onsuccess = () => resolve(request.result);
    });
    const indexed = await new Promise((resolve, reject) => {
      const transaction = database.transaction('values', 'readonly');
      const request = transaction.objectStore('values').get('owner');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result ?? null);
    });
    const cache = await caches.open('aiam-isolation-smoke');
    const response = await cache.match('/owner');
    return { local: localStorage.getItem('owner'), cookie: document.cookie, indexed, cache: response ? await response.text() : null };
  });
  console.log('isolation smoke first marker written and second session inspected');
  const secondMarker = await execute(second, async function () {
    localStorage.setItem('owner', 'account-b');
    document.cookie = 'owner=account-b; Path=/';
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('aiam-isolation-smoke', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('values', 'readwrite');
      transaction.objectStore('values').put('account-b', 'owner');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    const cache = await caches.open('aiam-isolation-smoke');
    await cache.put('/owner', new Response('account-b'));
    return { local: localStorage.getItem('owner'), cookie: document.cookie };
  });
  const firstAfter = await execute(first, async function () {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('aiam-isolation-smoke', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const indexed = await new Promise((resolve, reject) => {
      const transaction = database.transaction('values', 'readonly');
      const request = transaction.objectStore('values').get('owner');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result ?? null);
    });
    const cache = await caches.open('aiam-isolation-smoke');
    const response = await cache.match('/owner');
    return { local: localStorage.getItem('owner'), cookie: document.cookie, indexed, cache: response ? await response.text() : null };
  });
  console.log('isolation smoke second marker written and first session re-inspected');

  const checks = [
    firstMarker.local === 'account-a',
    firstMarker.cookie.includes('owner=account-a'),
    secondBefore.local === null && !secondBefore.cookie.includes('account-a') && secondBefore.indexed === null && secondBefore.cache === null,
    secondMarker.local === 'account-b' && secondMarker.cookie.includes('owner=account-b'),
    firstAfter.local === 'account-a' && firstAfter.cookie.includes('owner=account-a') && firstAfter.indexed === 'account-a' && firstAfter.cache === 'account-a'
  ];
  if (checks.some((value) => !value)) throw new Error(`account session isolation failed: ${JSON.stringify({ firstMarker, secondBefore, secondMarker, firstAfter })}`);
  console.log('account session isolation ok: Cookie, LocalStorage, IndexedDB and CacheStorage are partitioned');
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  failed = true;
  process.exitCode = 1;
} finally {
  try { if (first && window) window.contentView.removeChildView(first); } catch { /* cleanup */ }
  try { if (second && window) window.contentView.removeChildView(second); } catch { /* cleanup */ }
  try { first?.webContents.close(); } catch { /* cleanup */ }
  try { second?.webContents.close(); } catch { /* cleanup */ }
  try { if (window && !window.isDestroyed()) window.destroy(); } catch { /* cleanup */ }
  try { await firstSession?.clearStorageData(); } catch { /* cleanup */ }
  try { await secondSession?.clearStorageData(); } catch { /* cleanup */ }
  await withTimeout(new Promise((resolve) => server.close(() => resolve())), 'server close', 3000).catch(() => undefined);
  try { rmSync(userData, { recursive: true, force: true }); } catch { /* the OS may still hold a Chromium lock briefly */ }
  if (app.isReady()) {
    if (failed) app.exit(1);
    else app.quit();
  }
}
}

main();
