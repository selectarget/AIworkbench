import { app, BrowserWindow, net, protocol, session } from 'electron';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = mkdtempSync(join(tmpdir(), 'workbench-real-media-'));
const output = resolve('.verification'); mkdirSync(output, { recursive: true });
app.setPath('userData', join(root, 'sessions'));
protocol.registerSchemesAsPrivileged([{ scheme: 'workbench-media', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } }]);
let server; let window;
const observations = { accountRequests: 0, blockedOtherAccount: false, preview: false, thumbnail: false, cached: false, pauseResume: false, ranged: false, fallback: false };
async function waitFor(predicate, label, milliseconds = 15_000) {
  const started = Date.now();
  while (Date.now() - started < milliseconds) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 40)); }
  throw new Error(label);
}

async function main() {
try {
  await app.whenReady();
  console.log('media runtime: Electron ready');
  const ffmpeg = resolve('media-tools/win32-x64/ffmpeg.exe');
  const clip = join(root, 'sample.mp4');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=480x270:rate=24', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', clip], { windowsHide: true });
  const data = readFileSync(clip);
  const entry = ["export { MediaService } from './src/main/media.ts';", "export { createMediaProtocolHandler } from './src/main/media-protocol.ts';"].join('\n');
  const bundle = join(root, 'runtime.mjs');
  await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', external: ['electron'], outfile: bundle });
  console.log('media runtime: production modules bundled');
  const { MediaService, createMediaProtocolHandler } = await import(pathToFileURL(bundle).href);
  console.log('media runtime: modules loaded');
  server = createServer((req, res) => {
    if (req.url === '/missing.mp4') { res.writeHead(403); res.end(); return; }
    if (!String(req.headers.cookie).includes('owner=A') || req.headers.referer !== `${base}/page`) { res.writeHead(403); res.end(); return; }
    observations.accountRequests++;
    const range = /^bytes=(\d+)-/.exec(req.headers.range || ''); const start = range ? Number(range[1]) : 0;
    if (range) observations.ranged = true;
    res.writeHead(range ? 206 : 200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="video.mp4"', 'content-length': data.length - start, etag: '"fixture-video"', 'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${start}-${data.length - 1}/${data.length}` } : {}) });
    let offset = start;
    const timer = setInterval(() => { const end = Math.min(data.length, offset + 4096); res.write(data.subarray(offset, end)); offset = end; if (offset >= data.length) { clearInterval(timer); res.end(); } }, 15);
    res.on('close', () => clearInterval(timer));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  await session.fromPartition('persist:account_runtime_a').cookies.set({ url: base, name: 'owner', value: 'A' });
  session.fromPartition('persist:account_runtime_a').on('will-download', (event) => {
    event.preventDefault();
    throw new Error('Main-process media must not trigger the native download interceptor');
  });
  const accounts = { list: () => ['runtime_a', 'runtime_b'].map((id) => ({ id, name: id, platform: 'custom', customUrl: `${base}/page` })) };
  const settings = { get: () => ({ downloadDir: join(root, 'downloads'), videoDownloadDir: '', useAccountDownloadSubfolders: true, downloadFolderPattern: 'account', downloadConcurrency: 1, downloadRetryCount: 0, legacyVideoLayout: false, ffmpegPath: ffmpeg }) };
  const media = new MediaService(accounts, settings, undefined, undefined, undefined, join(root, 'cache'));
  protocol.handle('workbench-media', createMediaProtocolHandler(() => media));
  const item = media.add('runtime_a', { type: 'video', url: `${base}/video.mp4`, source: 'site-download', title: '真实账号会话视频预览' });
  const prepared = await media.preparePreview(item.id);
  console.log('media runtime: authenticated preview cached');
  observations.cached = prepared.previewCached === true;
  const requests = observations.accountRequests;
  await media.preparePreview(item.id);
  if (observations.accountRequests !== requests) throw new Error('cache did not prevent refetch');
  window = new BrowserWindow({ show: false, width: 850, height: 620, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="background:#f5f6f8;font:16px sans-serif;padding:25px"><h2>真实 Electron 视频链路验证</h2><p>账号隔离 · 本地缓存 · 视频封面 · 可播放及跳转</p><video id="clip" controls muted style="width:550px;border-radius:15px"></video><img id="cover" style="width:160px;border-radius:12px;margin-left:20px"></body>'));
  await window.webContents.executeJavaScript(`document.querySelector('#clip').src=${JSON.stringify(prepared.previewUrl)};document.querySelector('#cover').src=${JSON.stringify(prepared.previewThumbUrl)};`);
  await waitFor(() => window.webContents.executeJavaScript('document.querySelector("#clip").readyState >= 2 && document.querySelector("#clip").videoWidth === 480'), 'video did not decode');
  observations.preview = true;
  await waitFor(() => window.webContents.executeJavaScript('document.querySelector("#cover").naturalWidth === 640'), 'thumbnail did not decode');
  observations.thumbnail = true;
  await window.webContents.executeJavaScript('document.querySelector("#clip").currentTime=2;');
  await waitFor(() => window.webContents.executeJavaScript('document.querySelector("#clip").currentTime >= 1.9 && !document.querySelector("#clip").seeking'), 'local video seek did not complete');
  const rangeResponse = await net.fetch(prepared.previewUrl, { headers: { Range: 'bytes=0-15' } });
  const rangeResult = { status: rangeResponse.status, size: (await rangeResponse.arrayBuffer()).byteLength };
  if (rangeResult.status !== 206 || rangeResult.size !== 16) throw new Error('local range protocol is incorrect');
  writeFileSync(join(output, 'media-runtime.png'), (await window.webContents.capturePage()).toPNG());
  const other = media.add('runtime_b', { type: 'video', url: `${base}/video.mp4`, source: 'site-download' });
  try { await media.preparePreview(other.id); throw new Error('account isolation failed'); } catch (error) { if (!String(error).includes('过期')) throw error; observations.blockedOtherAccount = true; }
  const task = media.enqueue(item.id);
  await waitFor(() => media.tasks().find((task) => task.resourceId === item.id)?.receivedBytes >= 4096, 'download never started');
  media.pause(task.id);
  await media.resumeTask(task.id);
  await waitFor(() => media.tasks().find((item) => item.id === task.id)?.status === 'completed', 'resumed download failed');
  if (!readFileSync(media.tasks().find((item) => item.id === task.id).path).equals(data)) throw new Error('resumed bytes differ');
  observations.pauseResume = true;
  const fallback = media.add('runtime_a', { type: 'video', url: `${base}/missing.mp4`, backupUrl: `${base}/video.mp4`, source: 'site-download' });
  const fallbackTask = media.enqueue(fallback.id);
  await waitFor(() => media.tasks().find((item) => item.id === fallbackTask.id)?.status === 'completed', 'candidate fallback failed');
  observations.fallback = true;
  writeFileSync(join(output, 'media-runtime.json'), JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), ...observations }, null, 2));
  console.log('PASS real media runtime', JSON.stringify(observations));
} catch (error) {
  console.error(error); process.exitCode = 1;
  writeFileSync(join(output, 'media-runtime.json'), JSON.stringify({ passed: false, ...observations, error: String(error) }, null, 2));
} finally {
  window?.destroy();
  if (server) await new Promise((resolve) => server.close(resolve));
  // Electron closes file handles asynchronously; the temporary test profile is
  // deliberately kept if the OS has not yet released them.
  try { rmSync(root, { recursive: true, force: true }); } catch { /* temporary profile only */ }
  app.exit(process.exitCode || 0);
}
}
main().catch((error) => { console.error(error); app.exit(1); });
