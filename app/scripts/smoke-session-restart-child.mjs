import { app, BrowserWindow, WebContentsView, session } from 'electron';

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

async function load(view, url) {
  await withTimeout(view.webContents.loadURL(url), 'loadURL');
}

function indexedDbWriteScript(owner) {
  return `(async function () {
    localStorage.setItem('owner', ${JSON.stringify(owner)});
    document.cookie = 'owner=${owner}; Path=/; Max-Age=86400';
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('aiam-session-restart-smoke', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('values')) request.result.createObjectStore('values');
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('values', 'readwrite');
      transaction.objectStore('values').put(${JSON.stringify(owner)}, 'owner');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    const cache = await caches.open('aiam-session-restart-smoke');
    await cache.put('/owner', new Response(${JSON.stringify(owner)}));
    return { local: localStorage.getItem('owner'), cookie: document.cookie };
  })`;
}

const indexedDbReadScript = `(async function () {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('aiam-session-restart-smoke', 1);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => reject(new Error('IndexedDB unexpectedly needed an upgrade'));
    request.onsuccess = () => resolve(request.result);
  });
  if (!database.objectStoreNames.contains('values')) {
    database.close();
    throw new Error('IndexedDB values store is missing');
  }
  const indexed = await new Promise((resolve, reject) => {
    const transaction = database.transaction('values', 'readonly');
    const request = transaction.objectStore('values').get('owner');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result ?? null);
  });
  database.close();
  const cache = await caches.open('aiam-session-restart-smoke');
  const response = await cache.match('/owner');
  return {
    local: localStorage.getItem('owner'),
    cookie: document.cookie,
    indexed,
    cache: response ? await response.text() : null
  };
})`;

const phase = process.env.AIAM_SESSION_RESTART_PHASE;
const userData = process.env.AIAM_SESSION_RESTART_USER_DATA;
const url = process.env.AIAM_SESSION_RESTART_URL;
if (!phase || !userData || !url) throw new Error('session restart smoke child environment is incomplete');

app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', userData);

let window;
let first;
let second;
let firstSession;
let secondSession;
let failed = false;

async function main() {
try {
  console.log(`session restart smoke child starting phase=${phase}`);
  await app.whenReady();
  console.log('session restart smoke child app ready');
  window = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  firstSession = session.fromPartition('persist:restart-a');
  secondSession = session.fromPartition('persist:restart-b');
  first = new WebContentsView({ webPreferences: { session: firstSession, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  second = new WebContentsView({ webPreferences: { session: secondSession, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  first.setBounds({ x: 0, y: 0, width: 400, height: 600 });
  second.setBounds({ x: 400, y: 0, width: 400, height: 600 });
  window.contentView.addChildView(first);
  window.contentView.addChildView(second);
  await Promise.all([load(first, url), load(second, url)]);

  if (phase === 'write') {
    const firstMarker = await execute(first, indexedDbWriteScript('account-a'));
    const secondMarker = await execute(second, indexedDbWriteScript('account-b'));
    await Promise.all([firstSession.flushStorageData(), secondSession.flushStorageData()]);
    if (firstMarker.local !== 'account-a' || secondMarker.local !== 'account-b') {
      throw new Error(`session restart smoke write failed: ${JSON.stringify({ firstMarker, secondMarker })}`);
    }
    console.log('session restart smoke write phase stored separate account markers');
  } else if (phase === 'read') {
    const firstRead = await execute(first, indexedDbReadScript);
    const secondRead = await execute(second, indexedDbReadScript);
    const valid = firstRead.local === 'account-a'
      && firstRead.cookie.includes('owner=account-a')
      && firstRead.indexed === 'account-a'
      && firstRead.cache === 'account-a'
      && secondRead.local === 'account-b'
      && secondRead.cookie.includes('owner=account-b')
      && secondRead.indexed === 'account-b'
      && secondRead.cache === 'account-b';
    if (!valid) throw new Error(`session restart smoke read failed: ${JSON.stringify({ firstRead, secondRead })}`);
    console.log(`session restart smoke read phase verified: ${JSON.stringify({ firstRead, secondRead })}`);
  } else {
    throw new Error(`unknown session restart smoke phase: ${phase}`);
  }
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  try { if (first && window) window.contentView.removeChildView(first); } catch { /* cleanup */ }
  try { if (second && window) window.contentView.removeChildView(second); } catch { /* cleanup */ }
  try { first?.webContents.close(); } catch { /* cleanup */ }
  try { second?.webContents.close(); } catch { /* cleanup */ }
  try { if (window && !window.isDestroyed()) window.destroy(); } catch { /* cleanup */ }
  if (app.isReady()) app.exit(failed ? 1 : 0);
}
}

main();
