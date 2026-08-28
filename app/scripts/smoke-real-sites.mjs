import { app, BrowserWindow, WebContentsView, ipcMain, session } from 'electron';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * Opt-in real-site acceptance smoke.
 *
 * This script deliberately does not automate credentials, CAPTCHA, 2FA or
 * passkeys.  When --user-data is supplied it opens the same Electron
 * `persist:account_<id>` session used by the workbench, so a tester can
 * complete login manually in a headed window and then inspect the resulting
 * page/adapter/capture state without exporting cookies or passwords.
 */

const SITE_CASES = Object.freeze({
  doubao: { url: 'https://www.doubao.com/chat', scripts: ['browser-compat.js', 'generic-video-capture.js', 'dola-duration-bridge.js', 'doubao-creation-download.js'], extensions: ['maowang-doubao', 'doubao-download', 'doubao-video-15s'] },
  qianwen: { url: 'https://www.qianwen.com/', scripts: ['browser-compat.js', 'generic-video-capture.js'], extensions: ['maowang-doubao'] },
  dola: { url: 'https://www.dola.com/', scripts: ['browser-compat.js', 'generic-video-capture.js', 'dola-duration-bridge.js', 'dola-resource-bridge.js'], extensions: ['doubao-video-15s'] },
  yunque: { url: 'https://xyq.jianying.com/', scripts: ['browser-compat.js', 'generic-video-capture.js'], extensions: [] },
  higgsfield: { url: 'https://higgsfield.ai/academy/courses/cinema-studio-pro/set-up-your-project', scripts: ['browser-compat.js', 'generic-video-capture.js', 'higgsfield-course.js'], extensions: [] },
  kimi: { url: 'https://kimi.moonshot.cn/', scripts: ['browser-compat.js', 'generic-video-capture.js'], extensions: [] },
  oiioii: { url: 'https://www.oiioii.ai/home', scripts: ['browser-compat.js', 'generic-video-capture.js'], extensions: [] },
  nano: { url: 'https://xcgai.cn/', scripts: ['browser-compat.js', 'generic-video-capture.js'], extensions: [] },
  lovart: { url: 'https://www.lovart.ai/zh/home', scripts: ['browser-compat.js', 'generic-video-capture.js'], extensions: [] },
  jimeng: { url: 'https://jimeng.jianying.com/ai-tool/asset', scripts: ['browser-compat.js', 'generic-video-capture.js', 'jimeng-image-download.js'], extensions: [] },
  custom: { url: '', scripts: ['browser-compat.js', 'generic-video-capture.js'], extensions: [] }
});

const SITE_IDS = new Set(Object.keys(SITE_CASES));
const SAFE_ACCOUNT_ID = /^[a-zA-Z0-9_-]{6,80}$/;

function argumentValue(args, name) {
  const index = args.indexOf(name);
  if (index >= 0) return String(args[index + 1] ?? '').trim();
  const inline = args.find((item) => item.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1).trim() : '';
}

function hasArgument(args, name) {
  return args.includes(name);
}

function httpUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label}必须是有效的 HTTP(S) 地址`); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error(`${label}只允许不带凭据的 HTTP(S) 地址`);
  }
  return url.href;
}

export function parseRealSiteArgs(args = process.argv.slice(2)) {
  if (hasArgument(args, '--help') || hasArgument(args, '-h')) return { help: true };
  const platform = argumentValue(args, '--platform') || process.env.AIAM_REAL_E2E_PLATFORM?.trim() || '';
  if (!SITE_IDS.has(platform)) throw new Error(`必须通过 --platform 指定受支持的平台：${[...SITE_IDS].join(', ')}`);
  const caseInfo = SITE_CASES[platform];
  const url = httpUrl(argumentValue(args, '--url') || process.env.AIAM_REAL_E2E_URL?.trim() || caseInfo.url, '站点地址');
  const accountId = argumentValue(args, '--account-id') || process.env.AIAM_REAL_E2E_ACCOUNT_ID?.trim() || `real-site-${platform}`;
  if (!SAFE_ACCOUNT_ID.test(accountId)) throw new Error('账号 ID 必须为 6-80 位字母、数字、下划线或短横线');
  const userData = argumentValue(args, '--user-data') || process.env.AIAM_REAL_E2E_USER_DATA?.trim() || '';
  const waitMs = Math.min(120_000, Math.max(2_000, Number(argumentValue(args, '--wait-ms') || process.env.AIAM_REAL_E2E_WAIT_MS || 10_000)));
  return {
    help: false,
    platform,
    url,
    accountId,
    userData: userData ? resolve(userData) : '',
    waitMs,
    show: hasArgument(args, '--show'),
    requireAuth: hasArgument(args, '--require-auth'),
    expectCapture: hasArgument(args, '--expect-capture')
  };
}

export const REAL_SITE_SMOKE_HELP = `用法：
  npm run smoke:real-sites -- --platform dola [选项]

选项：
  --platform <id>       doubao/qianwen/dola/yunque/higgsfield/kimi/oiioii/nano/lovart/jimeng/custom
  --url <https-url>     覆盖平台默认地址；custom 必须显式提供
  --account-id <id>     使用 persist:account_<id>，默认 real-site-<platform>
  --user-data <目录>    工作台的 Electron Session 根目录；省略则使用临时目录
  --show                显示窗口，允许人工完成登录、验证码、2FA 或 Passkey
  --wait-ms <毫秒>      页面检查等待时间，默认 10000，范围 2000-120000
  --require-auth        仅在检测到登录/验证门控时失败（启发式，仅供辅助）
  --expect-capture      要求等待期间至少捕获一条页面媒体消息

安全边界：脚本不接收、不填写、不输出密码，不复制 Cookie，不绕过第三方验证。
`;

function withTimeout(promise, label, milliseconds) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}超时（${milliseconds} ms）`)), milliseconds); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function evaluate(view, expression) {
  return withTimeout(view.webContents.executeJavaScript(`(${expression})()`, true), '页面状态读取', 15_000);
}

async function loadAdapterScripts(view, caseInfo) {
  await withTimeout(view.webContents.loadURL('about:blank'), '隔离页面初始化', 20_000);
  view.webContents.debugger.attach('1.3');
  await view.webContents.debugger.sendCommand('Page.enable');
  for (const name of caseInfo.scripts) {
    const path = resolve('site-assets', 'scripts', name);
    if (!existsSync(path)) throw new Error(`适配器脚本缺失：${path}`);
    await view.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(path, 'utf8') });
  }
}

async function loadBuiltInExtensions(target, caseInfo) {
  const loaded = [];
  for (const name of caseInfo.extensions) {
    const path = resolve('site-assets', 'extensions', name);
    if (!existsSync(path)) throw new Error(`内置扩展缺失：${path}`);
    try {
      const extension = await target.extensions.loadExtension(path, { allowFileAccess: false });
      loaded.push({ name, id: extension.id });
    } catch (error) {
      throw new Error(`内置扩展 ${name} 加载失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return loaded;
}

function pageStateExpression() {
  return () => {
    const body = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const passwordInput = Boolean(document.querySelector('input[type="password"]'));
    const authText = /登录|登录后|sign\s*in|log\s*in|verification|验证码|verify|继续验证|two[- ]factor|passkey/i.test(body);
    const composerCount = document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"],input[type="text"]').length;
    const mediaCount = document.querySelectorAll('video,audio,img').length;
    return {
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      browserCompat: window.__AIAM_BROWSER_COMPAT === true,
      genericCapture: window.__genericVideoCaptureInstalled === true,
      dolaBridge: window.__AIAM_DOLA_RESOURCE_BRIDGE__ === true,
      higgsfieldCourse: window.__WORKBENCH_HIGGSFIELD_COURSE__ === true,
      jimengDownload: typeof window.__AIAM_JIMENG_IMAGE_DOWNLOAD__ === 'string' && window.__AIAM_JIMENG_IMAGE_DOWNLOAD__.length > 0,
      authSignal: passwordInput || authText,
      passwordInput,
      composerCount,
      mediaCount
    };
  };
}

function safeMessageSummary(raw) {
  return {
    type: raw && typeof raw === 'object' ? String(raw.type || '') : '',
    source: raw && typeof raw === 'object' ? String(raw.source || '') : '',
    hasUrl: Boolean(raw && typeof raw === 'object' && String(raw.url || '').trim())
  };
}

async function run(options) {
  console.log(`real-site smoke starting: ${options.platform}`);
  const temporaryUserData = options.userData ? '' : mkdtempSync(join(tmpdir(), `aiam-real-site-${options.platform}-`));
  const userData = options.userData || temporaryUserData;
  const caseInfo = SITE_CASES[options.platform];
  const remotePreload = resolve('out', 'preload', 'remote.js');
  if (!existsSync(remotePreload)) throw new Error('缺少 out/preload/remote.js，请先运行 npm run build');
  let window;
  let view;
  const messages = [];
  const senderIds = new Set();
  const onMedia = (event, raw) => { if (senderIds.has(event.sender.id)) messages.push(safeMessageSummary(raw)); };
  try {
    app.commandLine.appendSwitch('disable-gpu');
    if (options.show) app.commandLine.appendSwitch('disable-background-timer-throttling');
    app.setPath('userData', userData);
    console.log('real-site smoke waiting for Electron');
    await withTimeout(app.whenReady(), 'Electron 就绪', 15_000);
    console.log('real-site smoke Electron ready');
    const target = session.fromPartition(`persist:account_${options.accountId}`);
    window = new BrowserWindow({ show: options.show, width: 1440, height: 900, title: `真实站点验收 · ${options.platform}`, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    view = new WebContentsView({ webPreferences: { preload: remotePreload, session: target, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    senderIds.add(view.webContents.id);
    window.contentView.addChildView(view);
    console.log('real-site smoke view attached');
    view.setBounds({ x: 0, y: 0, width: 1440, height: 900 });
    ipcMain.on('remote:media', onMedia);
    const extensions = await loadBuiltInExtensions(target, caseInfo);
    await loadAdapterScripts(view, caseInfo);
    console.log('real-site smoke scripts registered');
    await withTimeout(view.webContents.loadURL(options.url), '真实站点页面加载', Math.max(30_000, options.waitMs + 20_000));
    console.log('real-site smoke page loaded');
    await sleep(options.waitMs);
    const state = await evaluate(view, pageStateExpression());
    const cookies = await target.cookies.get({ url: options.url }).catch(() => []);
    const report = {
      platform: options.platform,
      accountId: options.accountId,
      url: state.url,
      title: state.title,
      readyState: state.readyState,
      sessionCookieCount: cookies.length,
      scripts: {
        browserCompat: state.browserCompat,
        genericCapture: state.genericCapture,
        dolaBridge: state.dolaBridge,
        higgsfieldCourse: state.higgsfieldCourse,
        jimengDownload: state.jimengDownload
      },
      page: { authSignal: state.authSignal, passwordInput: state.passwordInput, composerCount: state.composerCount, mediaCount: state.mediaCount },
      remoteMedia: { count: messages.length, types: [...new Set(messages.map((item) => item.type).filter(Boolean))], items: messages.slice(0, 20) },
      extensions: extensions.map(({ name, id }) => ({ name, loaded: Boolean(id) }))
    };
    console.log(JSON.stringify(report, null, 2));
    const expectedBridge = options.platform === 'dola' ? state.dolaBridge : options.platform === 'higgsfield' ? state.higgsfieldCourse : options.platform === 'jimeng' ? state.jimengDownload : true;
    if (!state.browserCompat || !state.genericCapture || !expectedBridge) throw new Error('目标页面未观察到所需适配器脚本标记');
    if (options.requireAuth && !state.authSignal) throw new Error('未观察到登录/验证门控；请确认 --user-data 与 --account-id 指向待验收登录态');
    if (options.expectCapture && messages.length === 0) throw new Error('等待期间没有捕获页面媒体消息');
    console.log(`real-site smoke passed: ${options.platform} adapter/page checks; authenticated feature behavior still requires manual site actions.`);
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  } finally {
    ipcMain.removeListener('remote:media', onMedia);
    try { if (view && window) window.contentView.removeChildView(view); } catch { /* cleanup */ }
    try { view?.webContents.debugger.detach(); } catch { /* cleanup */ }
    try { view?.webContents.close(); } catch { /* cleanup */ }
    try { if (window && !window.isDestroyed()) window.destroy(); } catch { /* cleanup */ }
    if (app.isReady()) {
      // Let stdout/stderr flush before Electron tears down its message loop;
      // this is especially useful when a real page rejects navigation.
      app.quit();
    }
    if (temporaryUserData) {
      try { rmSync(temporaryUserData, { recursive: true, force: true }); } catch { /* Chromium may hold a lock briefly. */ }
    }
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    const options = parseRealSiteArgs();
    if (options.help) {
      console.log(REAL_SITE_SMOKE_HELP);
      // Importing `electron` keeps its message loop alive even when the
      // command only requested help. Exit explicitly so npm callers do not
      // wait for an application that was never started.
      process.exit(0);
    }
    else {
      // Do not top-level-await run(): Electron must return to its own event
      // loop before it can emit `ready` on Windows. Existing Electron smoke
      // scripts intentionally start their async main function this way too.
      void run(options).catch((error) => {
        console.error(error instanceof Error ? error.stack ?? error.message : String(error));
        process.exitCode = 1;
        if (app.isReady()) app.quit();
      });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
