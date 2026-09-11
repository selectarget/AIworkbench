import { app, BrowserWindow, WebContentsView } from 'electron';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

app.setPath('userData', mkdtempSync(join(tmpdir(), 'workbench-occlusion-')));
app.commandLine.appendSwitch('disable-gpu');
const output = resolve('out/qa/browser-manager.cjs');
async function main() {
await build({ entryPoints: ['src/main/browser-manager.ts'], outfile: output, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
const { BrowserManager } = createRequire(import.meta.url)(output);
const timeout = setTimeout(() => { console.error('native occlusion test timed out'); app.exit(1); }, 30000);
let window;
const views = [];
const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<body><video src="/result.mp4"></video></body>'); });
try {
  await app.whenReady();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  window = new BrowserWindow({ show: false, width: 1080, height: 720, ...(process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#ffffff', height: 36 } } : {}) });
  await window.loadURL('data:text/html,<body style="background:white"><h1>Settings overlay</h1></body>');
  const manager = new BrowserManager(window, { list: () => [] }, { get: () => ({}) });
  for (const id of ['first', 'second', 'third']) {
    const view = new WebContentsView(); views.push(view);
    window.contentView.addChildView(view);
    await view.webContents.loadURL('data:text/html,<body style="background:cyan"><input value="preserved"><script>window.token=Math.random()</script></body>');
    manager.entries.set(id, { view });
  }
  const tokens = await Promise.all(views.map(v => v.webContents.executeJavaScript('window.token')));
  views[0].webContents.setZoomFactor(1.25);
  const primary = { x: 10, y: 90, width: 500, height: 500 };
  const secondary = { x: 520, y: 90, width: 500, height: 500 };
  manager.setLayout({ primary, secondary }); manager.activate('first', 'second');
  assert.deepEqual(views[0].getBounds(), primary);
  assert.deepEqual(views[1].getBounds(), secondary);
  for (const overlay of ['settings', 'preview', 'candidates', 'tools']) {
    manager.setLayout({ primary, secondary, occluded: true });
    manager.activate('third', 'first');
    window.setSize(1440, 900);
    manager.setLayout({ primary: { ...primary, width: 640 }, secondary, occluded: true });
    assert(views.every(v => v.getBounds().width === 0), `${overlay} leaked a native view`);
    manager.setLayout({ primary, secondary, occluded: false });
    assert.deepEqual(views[2].getBounds(), primary);
    assert.deepEqual(views[0].getBounds(), secondary);
  }
  manager.activate('first'); manager.setLayout({ primary });
  assert.deepEqual(views[0].getBounds(), primary);
  assert.equal(views[1].getBounds().width, 0);
  assert.equal(views[0].webContents.getZoomFactor(), 1.25);
  assert.deepEqual(await Promise.all(views.map(v => v.webContents.executeJavaScript('window.token'))), tokens);
  assert.equal(await views[0].webContents.executeJavaScript('document.querySelector("input").value'), 'preserved');
  for (const platform of ['doubao', 'qianwen']) {
    const view = views[2];
    await view.webContents.loadURL(`http://127.0.0.1:${server.address().port}/`);
    const extensionSource = ['shared/platform-rules.js', 'shared/workbench-mode.js', `content/${platform}.js`]
      .map((file) => readFileSync(resolve('site-assets/extensions/maowang-doubao', file), 'utf8'))
      .join('\n');
    const runtimeSetup = `window.messages=[]; const runtime={onMessage:{addListener(){}},sendMessage(m,cb){window.messages.push(m);cb?.({success:true});}}; try { Object.defineProperty(window,'chrome',{configurable:true,writable:true,value:{...(window.chrome||{}),runtime}}); } catch (_) { try { Object.defineProperty(window.chrome,'runtime',{configurable:true,writable:true,value:runtime}); } catch (_) {} }`;
    await view.webContents.executeJavaScript(`${runtimeSetup}\n${extensionSource}\n;void 0;`);
    await view.webContents.executeJavaScript(`window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:{source:'maowang-doubao-bridge',type:'MW_DOUBAO_MEDIA',videos:[{videoKey:'test-video',url:'https://example.test/result.mp4'}]}}));document.dispatchEvent(new KeyboardEvent('keydown',{key:'m',ctrlKey:true,shiftKey:true}));`);
    let state = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      state = await view.webContents.executeJavaScript(`({panel:!!document.querySelector('.mw-console'),mediaButton:!!document.querySelector('.mw-media-action[data-kind="video"]'),messages:window.messages})`);
      if (state.messages.some((message) => message.type === 'MW_STATUS_UPDATE' && message.videoCount > 0)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(state.panel, false, `${platform} created a floating panel`);
    assert(state.messages.some((message) => message.type === 'MW_STATUS_UPDATE' && message.videoCount > 0), `${platform} extraction stopped: ${JSON.stringify(state)}`);
  }
  console.log('PASS: real native views hide across overlays, activation and resize; single/dual layouts, page state and zoom restore without reload');
} catch (error) { console.error(error); process.exitCode = 1; }
finally { clearTimeout(timeout); server.close(); for (const view of views) view.webContents.close(); window?.destroy(); app.exit(process.exitCode || 0); }
}
void main().catch(error => { console.error(error); app.exit(1); });
