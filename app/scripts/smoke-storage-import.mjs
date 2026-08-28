import { app, BrowserWindow, WebContentsView, session } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildStorageImportScript, normalizeIndexedDbBundle } from '../out/main/storageImport.js';

const userData = mkdtempSync(join(tmpdir(), 'aiam-storage-import-'));
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
  return withTimeout(view.webContents.executeJavaScript(script, true), 'executeJavaScript');
}

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><title>storage import smoke</title><main>storage import fixture</main>');
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
    await app.whenReady();
    const url = `http://127.0.0.1:${port}/`;
    window = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    firstSession = session.fromPartition('persist:storage-import-a');
    secondSession = session.fromPartition('persist:storage-import-b');
    first = new WebContentsView({ webPreferences: { session: firstSession, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    second = new WebContentsView({ webPreferences: { session: secondSession, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.contentView.addChildView(first);
    window.contentView.addChildView(second);
    await Promise.all([withTimeout(first.webContents.loadURL(url), 'first load'), withTimeout(second.webContents.loadURL(url), 'second load')]);

    const fixture = normalizeIndexedDbBundle({ databases: [{ name: 'imported-db', version: 1, objectStores: [{ name: 'items', keyPath: 'id', indexes: [{ name: 'by-kind', keyPath: 'kind', unique: false }], records: [{ value: { id: 'one', kind: 'image', bytes: { __type: 'ArrayBuffer', value: 'AQI=' } } }, { value: { id: 'two', kind: 'video' } }] }, { name: 'key-value', keyPath: null, records: [{ key: 'answer', value: 42 }] }] }] });
    if (!fixture.bundle) throw new Error('fixture normalization returned no bundle');
    const bundle = { localStorage: { owner: 'account-a' }, sessionStorage: {}, indexedDb: fixture.bundle };
    const imported = await execute(first, buildStorageImportScript(bundle));
    const firstAfter = await execute(first, `(async () => {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('imported-db'); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result); });
      const item = await new Promise((resolve, reject) => { const request = db.transaction('items', 'readonly').objectStore('items').get('one'); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result); });
      const answer = await new Promise((resolve, reject) => { const request = db.transaction('key-value', 'readonly').objectStore('key-value').get('answer'); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result); });
      const indexFound = db.transaction('items', 'readonly').objectStore('items').indexNames.contains('by-kind');
      db.close();
      return { local: localStorage.getItem('owner'), item: { id: item?.id, kind: item?.kind }, answer, bytes: { byteLength: item?.bytes?.byteLength ?? -1, values: item?.bytes ? Array.from(new Uint8Array(item.bytes)) : [] }, indexFound };
    })()`);
    const secondAfter = await execute(second, `(async () => {
      let indexed = null;
      try {
        const db = await new Promise((resolve, reject) => { const request = indexedDB.open('imported-db'); request.onerror = () => reject(request.error); request.onupgradeneeded = () => request.result.createObjectStore('items'); request.onsuccess = () => resolve(request.result); });
        indexed = await new Promise((resolve, reject) => { const request = db.transaction('items', 'readonly').objectStore('items').get('one'); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result ?? null); });
        db.close();
      } catch { indexed = null; }
      return { local: localStorage.getItem('owner'), indexed };
    })()`);
    const bytes = firstAfter.bytes;
    const checks = [
      imported?.local === 1 && imported?.session === 0 && imported?.indexedDB === 1,
      firstAfter.local === 'account-a' && firstAfter.item?.id === 'one' && firstAfter.item?.kind === 'image' && firstAfter.answer === 42 && bytes?.byteLength === 2 && bytes?.values?.[0] === 1 && bytes?.values?.[1] === 2 && firstAfter.indexFound,
      secondAfter.local === null && secondAfter.indexed === null
    ];
    if (checks.some((value) => !value)) throw new Error(`storage import failed: ${JSON.stringify({ imported, firstAfter, secondAfter })}`);
    console.log('storage import ok: WebStorage, IndexedDB records, indexes and binary markers restored; second partition remains isolated');
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    failed = true;
    process.exitCode = 1;
  } finally {
    try { if (first && window) window.contentView.removeChildView(first); } catch {}
    try { if (second && window) window.contentView.removeChildView(second); } catch {}
    try { first?.webContents.close(); } catch {}
    try { second?.webContents.close(); } catch {}
    try { if (window && !window.isDestroyed()) window.destroy(); } catch {}
    try { await firstSession?.clearStorageData(); } catch {}
    try { await secondSession?.clearStorageData(); } catch {}
    await withTimeout(new Promise((resolve) => server.close(() => resolve())), 'server close', 3000).catch(() => undefined);
    try { rmSync(userData, { recursive: true, force: true }); } catch {}
    if (app.isReady()) {
      if (failed) app.exit(1);
      else app.quit();
    }
  }
}

main();
