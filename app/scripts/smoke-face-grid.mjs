import { app, BrowserWindow, ipcMain } from 'electron';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.cwd());
const opencvChunkName = readdirSync(resolve(root, 'out/renderer/assets')).find((name) => /^opencv-[^/]+\.js$/.test(name));
if (!opencvChunkName) throw new Error('built OpenCV renderer chunk not found; run npm run build first');
const opencvChunkPath = pathToFileURL(resolve(root, 'out/renderer/assets', opencvChunkName)).href;
const preloadPath = resolve(root, 'out/preload/index.js');
const prototxt = new Uint8Array(readFileSync(resolve(root, 'face-grid-assets/deploy.prototxt')));
const model = new Uint8Array(readFileSync(resolve(root, 'face-grid-assets/res10_300x300_ssd_iter_140000.caffemodel')));
const tracePath = resolve(tmpdir(), 'ai-creation-workbench-face-grid-smoke.log');
const userDataPath = mkdtempSync(join(tmpdir(), 'ai-creation-workbench-face-grid-smoke-'));
const trace = (message) => { appendFileSync(tracePath, `${new Date().toISOString()} ${message}\n`); console.log(message); };
rmSync(tracePath, { force: true });

app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', userDataPath);

async function main() {
  trace('app: waiting for ready');
  await app.whenReady();
  trace('app: ready');
  ipcMain.handle('face-grid:model', () => ({ ok: true, data: { prototxt, model } }));
  const window = new BrowserWindow({
    show: false,
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.webContents.on('console-message', (_event, _level, message) => console.log(`[renderer] ${message}`));
  window.webContents.on('did-fail-load', (_event, code, description, url) => console.error(`renderer load failed: ${code} ${description} ${url}`));
  const htmlPath = join(userDataPath, 'smoke.html');
  const html = '<!doctype html><html><body><div id="root"></div><canvas id="input" width="300" height="300"></canvas></body></html>';
  writeFileSync(htmlPath, html, 'utf8');
  trace('smoke: loading renderer');
  await window.loadFile(htmlPath);
  trace('smoke: renderer loaded');
  const result = await Promise.race([
    window.webContents.executeJavaScript(`(async () => {
    console.log('page: starting');
    const api = await window.workbench.faceGrid.model();
    if (!api?.ok) throw new Error(api?.error?.message || 'model IPC failed');
    console.log('page: model received');
    globalThis.Module ??= {};
    const cvModule = await import(${JSON.stringify(opencvChunkPath)});
    console.log('page: OpenCV chunk imported', Object.keys(cvModule), typeof cvModule.o, cvModule.o && Object.keys(cvModule.o).slice(0, 8));
    const cvCandidate = cvModule.o?.default ?? cvModule.o ?? cvModule.default ?? cvModule;
    const cvRuntime = await Promise.resolve(cvCandidate);
    console.log('page: OpenCV candidate ready', typeof cvRuntime, typeof cvRuntime?.readNetFromCaffe, Object.keys(cvRuntime || {}).slice(0, 8));
    if (!cvRuntime || typeof cvRuntime.readNetFromCaffe !== 'function') throw new Error('OpenCV DNN Caffe importer unavailable');
    console.log('page: OpenCV runtime ready');
    const bytes = (value) => value instanceof Uint8Array ? value : new Uint8Array(Object.values(value));
    const suffix = Date.now().toString(36);
    const protoPath = '/smoke-' + suffix + '.prototxt';
    const modelPath = '/smoke-' + suffix + '.caffemodel';
    cvRuntime.FS_createDataFile('/', protoPath.slice(1), bytes(api.data.prototxt), true, false);
    cvRuntime.FS_createDataFile('/', modelPath.slice(1), bytes(api.data.model), true, false);
    const net = cvRuntime.readNetFromCaffe(protoPath, modelPath);
    cvRuntime.FS_unlink(protoPath);
    cvRuntime.FS_unlink(modelPath);
    console.log('page: Caffe model loaded');
    const canvas = document.getElementById('input');
    const context = canvas.getContext('2d');
    context.fillStyle = '#808080';
    context.fillRect(0, 0, 300, 300);
    const rgba = cvRuntime.imread(canvas);
    const bgr = new cvRuntime.Mat();
    cvRuntime.cvtColor(rgba, bgr, cvRuntime.COLOR_RGBA2BGR);
    const blob = cvRuntime.blobFromImage(bgr, 1, new cvRuntime.Size(300, 300), new cvRuntime.Scalar(104, 177, 123), false, false);
    try {
      net.setInput(blob);
      const output = net.forward();
      try { return { rows: output.rows, cols: output.cols, values: (output.data32F || output.data64F || []).length }; }
      finally { output.delete(); }
    } finally { blob.delete(); rgba.delete(); bgr.delete(); net.delete?.(); }
  })()`),
    new Promise((_, reject) => setTimeout(() => reject(new Error('face-grid smoke timed out after 45 seconds')), 45_000))
  ]);
  trace(`smoke: result ${JSON.stringify(result)}`);
  console.log(JSON.stringify({ ok: true, ...result }));
  window.destroy();
  app.quit();
}

main().catch((error) => {
  trace(`smoke: failed ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  app.exit(1);
});
