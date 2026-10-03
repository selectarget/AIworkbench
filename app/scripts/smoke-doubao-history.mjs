import { app, BrowserWindow, WebContentsView } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const profile = mkdtempSync(join(tmpdir(), 'aiam-history-smoke-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-proxy-server');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP www.doubao.com 127.0.0.1');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function fixture(mode) {
  const verification = mode.startsWith('verify-');
  const zeroSelected = verification || ['unselected', 'native-events', 'all-loaded'].includes(mode);
  const total = verification && mode !== 'verify-remaining' ? 0 : verification ? 3 : 5;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body {margin:0;font:16px sans-serif} header {height:64px;display:flex;justify-content:center}
    h1 {font-size:18px} #more {position:absolute;right:20px;top:12px;width:40px;height:32px}
    button {min-height:32px} #row-more {margin:140px 40px} #menu {position:absolute;right:20px;top:55px}
    #footer {position:fixed;bottom:0;width:100%;padding:15px;background:#eee;display:flex;gap:25px}
    #confirm {position:absolute;top:120px;left:200px;padding:30px;background:#ddd}
    [hidden] {display:none!important}
  </style></head><body>
    <header><h1>管理历史对话</h1><div aria-haspopup="dialog" style="position:absolute;right:20px;top:12px;width:40px;height:32px"><button id="more" aria-label="更多" ${mode === 'missing-menu' ? 'hidden' : ''}>···</button></div></header>
    <button id="row-more" aria-label="更多">···</button>
    <div id="menu" role="dialog" hidden><button id="batch" role="menuitem">批量删除对话</button></div>
    <section id="rows" ${mode === 'verify-loading' ? 'aria-busy="true"' : ''}>${verification ? mode === 'verify-empty' ? '' : `<div data-testid="thread_detail_item" data-type="bot">主对话<button role="checkbox" ${['verify-retained','verify-loading','verify-transient'].includes(mode) ? 'disabled' : ''}>□</button></div>` : '当前只加载 2 个，账号总计 5 个会话'}</section>
    <div id="footer" hidden><button id="loaded" role="checkbox" aria-checked="false" style="width:32px">□</button><span id="counter">已选 ${zeroSelected ? 0 : 2} 个对话</span><div id="all" style="cursor:pointer" ${zeroSelected ? 'hidden' : ''}>选择全部 ${total} 个对话</div><button id="cancel">取消</button><button id="delete" ${zeroSelected ? 'disabled' : ''}>删除</button></div>
    <div id="confirm" role="dialog" hidden><p id="question">确定删除 5 个对话及关联作品？</p><button id="no">取消</button><button id="yes">确认删除</button></div>
    ${mode === 'stale-toast' ? '<div role="status">删除成功</div>' : ''}
    <script>
      const mode = ${JSON.stringify(mode)};
      const el = (id) => document.getElementById(id);
      window.historyLog = [];
      window.inputLog = [];
      if (mode === 'verify-transient') setTimeout(() => { el('all').textContent = '选择全部 3 个对话'; }, 700);
      document.addEventListener('click', event => inputLog.push({ id: event.target.id, trusted: event.isTrusted, detail: event.detail }), true);
      const accept = (event) => mode !== 'native-events' || event.isTrusted;
      el('more').onclick = (event) => { if (!accept(event)) return; historyLog.push('more'); el('menu').hidden = false; };
      el('row-more').onclick = () => historyLog.push('WRONG_ROW_MENU');
      el('batch').onclick = (event) => { if (!accept(event)) return; historyLog.push('batch'); el('menu').hidden = true; el('footer').hidden = false; };
      el('loaded').onclick = (event) => {
        if (!accept(event)) return; historyLog.push('loaded'); el('loaded').setAttribute('aria-checked', 'true');
        el('counter').textContent = mode === 'all-loaded' ? '已选 5 个对话' : '已选 2 个对话';
        el('all').hidden = mode === 'all-loaded'; el('delete').disabled = false;
      };
      el('all').onclick = (event) => {
        if (!accept(event)) return;
        event.preventDefault(); historyLog.push('all');
        el('counter').textContent = mode === 'count-mismatch' ? '已选 4 个对话' : '已选 5 个对话';
        el('delete').disabled = false;
      };
      el('delete').onclick = (event) => {
        if (!accept(event)) return;
        historyLog.push('delete');
        if (mode === 'stale-toast') return;
        if (mode === 'wrong-dialog') el('question').textContent = '确定删除账号？';
        if (mode === 'wrong-dialog-count') el('question').textContent = '确定删除 4 个对话？';
        el('confirm').hidden = false;
      };
      el('yes').onclick = (event) => {
        if (!accept(event)) return;
        historyLog.push('confirm');
        setTimeout(() => {
          el('confirm').hidden = true;
          const toast = document.createElement('div'); toast.setAttribute('role', 'status');
          if (mode === 'failure' || mode === 'deleted-with-error') { toast.textContent = '删除失败，请稍后再试'; if (mode === 'deleted-with-error') { el('footer').hidden = true; el('rows').textContent = '主对话'; } }
          else { toast.textContent = '删除成功'; el('footer').hidden = true; el('rows').textContent = '暂无历史对话'; }
          document.body.append(toast);
        }, mode === 'slow-dialog' ? 500 : 0);
      };
    </script></body></html>`;
}

let window, view;
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(fixture(url.searchParams.get('mode') || 'success'));
});
async function main() {
  await app.whenReady();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  const { buildDoubaoHistoryScript } = await import(pathToFileURL(resolve('out/main/doubaoHistory.js')).href);
  window = new BrowserWindow({ show: false, width: 1000, height: 720 });
  view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.contentView.addChildView(view);
  const [contentWidth, contentHeight] = window.getContentSize();
  view.setBounds({ x: 0, y: 0, width: contentWidth, height: contentHeight });
  window.showInactive();
  const contents = view.webContents;
  contents.debugger.attach('1.3');
  const evaluate = (script) => contents.executeJavaScript(script, true);
  const log = () => evaluate('window.historyLog');
  const load = async (mode = 'success') => {
    console.log(`Checking ${mode}`);
    let watchdog;
    try {
      await Promise.race([contents.loadURL(`http://www.doubao.com:${port}/chat/thread/list?mode=${mode}`), new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error(`${mode}: fixture load timeout`)), 15_000); })]);
    } finally { clearTimeout(watchdog); }
    await evaluate('new Promise(done => { setTimeout(done, 300); requestAnimationFrame(() => requestAnimationFrame(done)); })');
    await new Promise(done => setTimeout(done, 150));
  };
  const run = async (phase, token, count, timeout) => {
    const deadline = Date.now() + timeout;
    const clicked = new Set();
    while (Date.now() < deadline) {
      const result = await evaluate(buildDoubaoHistoryScript(phase, token, count, deadline - Date.now(), true));
      if (!result.action) return result;
      const { kind, xRatio, yRatio } = result.action;
      if (phase === 'verify') assert(['menu','batch'].includes(kind), 'read-only verification requested selection or deletion');
      if (!clicked.has(kind)) {
        clicked.add(kind);
        const size = await evaluate('({width:innerWidth,height:innerHeight})');
        const x = Math.round(xRatio * size.width), y = Math.round(yRatio * size.height);
        for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
      }
      await new Promise(done => setTimeout(done, 20));
    }
    return { ok: false, submitted: clicked.has('remove') };
  };
  const prepare = (timeout = 1600) => run('prepare', 'test-token', 0, timeout);
  const remove = (token = 'test-token', count = 5, timeout = 1600) => run('delete', token, count, timeout);
  const results = [];

  for (const mode of ['success', 'unselected', 'slow-dialog', 'native-events', 'all-loaded']) {
    await load(mode);
    const ready = await prepare();
    assert(ready.ok && ready.count === 5, `${mode}: must select all 5, not only 2 loaded: ${JSON.stringify(ready)}, log=${JSON.stringify(await log())}, input=${JSON.stringify(await evaluate('window.inputLog'))}`);
    const expected = ['more', 'batch', ...(['unselected', 'native-events', 'all-loaded'].includes(mode) ? ['loaded'] : []), ...(mode === 'all-loaded' ? [] : ['all'])];
    assert(JSON.stringify(await log()) === JSON.stringify(expected), `${mode}: preparation must never delete or use row menu: ${JSON.stringify(await log())}`);
    const result = await remove();
    assert(result.ok && result.count === 5, `${mode}: deletion not confirmed: ${result.message}`);
    assert((await log()).filter((item) => item === 'confirm').length === 1, `${mode}: confirmation repeated`);
    assert(!(await remove()).ok, `${mode}: consumed token allowed repeated deletion`);
    results.push(mode);
  }
  for (const mode of ['missing-menu', 'count-mismatch']) {
    await load(mode);
    assert(!(await prepare(500)).ok, `${mode}: preparation should fail`);
    assert(!(await log()).includes('delete'), `${mode}: unexpected deletion`);
    results.push(mode);
  }
  for (const variant of ['wrong-token', 'wrong-count', 'expired', 'selection-changed', 'page-dialog']) {
    await load(); await prepare();
    if (variant === 'expired') await evaluate('window.__AIAM_HISTORY_CLEANUP__.createdAt -= 6 * 60_000');
    if (variant === 'selection-changed') await evaluate('document.getElementById("counter").textContent = "已选 4 个对话"');
    if (variant === 'page-dialog') await evaluate('document.getElementById("confirm").hidden = false');
    const result = await remove(variant === 'wrong-token' ? 'wrong' : 'test-token', variant === 'wrong-count' ? 4 : 5);
    assert(!result.ok && !result.submitted, `${variant}: stale state not rejected`);
    assert(!(await log()).includes('delete'), `${variant}: unexpected deletion`);
    results.push(variant);
  }
  for (const mode of ['wrong-dialog', 'wrong-dialog-count', 'failure', 'stale-toast']) {
    await load(mode); await prepare();
    const result = await remove('test-token', 5, 900);
    assert(!result.ok, `${mode}: deletion incorrectly reported successful`);
    if (mode.startsWith('wrong-dialog')) assert(!(await log()).includes('confirm'), `${mode}: unrelated confirmation was clicked`);
    assert((await log()).filter((item) => item === 'delete').length === 1, `${mode}: deletion retried`);
    results.push(mode);
  }
  // Reproduce the live site's contradictory toast, then verify the refreshed
  // native count without selecting or deleting the retained main conversation.
  await load('deleted-with-error'); await prepare();
  const toastFailure = await remove();
  assert(!toastFailure.ok && toastFailure.submitted, 'fixture must reproduce the live failure toast');
  assert((await log()).filter(item => item === 'delete').length === 1, 'toast failure caused a deletion retry');
  for (const mode of ['verify-retained', 'verify-empty', 'verify-remaining', 'verify-inconsistent', 'verify-transient', 'verify-loading']) {
    await load(mode);
    const result = await run('verify', 'verification-only', 5, mode === 'verify-loading' ? 900 : 3000);
    const success = ['verify-retained', 'verify-empty'].includes(mode);
    assert(Boolean(result.ok) === success, `${mode}: incorrect final result ${JSON.stringify(result)}`);
    assert(JSON.stringify(await log()) === JSON.stringify(['more', 'batch']), `${mode}: verification must only open the native count: ${JSON.stringify(await log())}`);
    if (mode === 'verify-retained') assert(result.message.includes('主对话'), 'retained main conversation not explained');
    if (mode === 'verify-transient') assert(result.message.includes('3 个'), 'transient zero count was mistaken for final success');
    results.push(mode);
  }
  await load('verify-retained');
  const emptyAccount = await prepare(3000);
  assert(emptyAccount.ok && emptyAccount.count === 0, 'already-cleared account incorrectly treated as preparation failure');
  assert(JSON.stringify(await log()) === JSON.stringify(['more', 'batch']), 'already-cleared account selected or deleted again');
  results.push('already-cleared');
  console.log(JSON.stringify({ ok: true, passed: results.length, cases: results, note: '真实 WebContentsView 加载本地样本；未删除任何真实豆包数据' }, null, 2));
}
main().then(() => finish(0)).catch((error) => { console.error(error.stack || error); finish(1); });
function finish(code) {
  if (view && !view.webContents.isDestroyed()) view.webContents.close();
  if (window && !window.isDestroyed()) window.destroy();
  server.close();
  // This is a freshly-created, task-owned temporary profile.
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  app.exit(code);
}
