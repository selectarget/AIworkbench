import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const rawPackageRoot = process.argv[2] || '';
if (!rawPackageRoot) throw new Error('用法：node scripts/smoke-packaged.mjs <打包目录、.app 或 Windows portable .exe> [平台] [架构] [保持秒数]');
const packageRoot = resolve(rawPackageRoot);
const targetPlatform = process.argv[3] || process.platform;
const targetArch = process.argv[4] || process.arch;
const holdSeconds = Math.max(2, Number(process.argv[5] || 6));

if (!packageRoot || !existsSync(packageRoot)) throw new Error(`打包目录不存在：${packageRoot || '(empty)'}`);
if (!['win32', 'darwin'].includes(targetPlatform)) throw new Error(`不支持的打包冒烟平台：${targetPlatform}`);
if (!['x64', 'arm64'].includes(targetArch)) throw new Error(`不支持的打包冒烟架构：${targetArch}`);

function executablePath() {
  if (statSync(packageRoot).isFile()) {
    if (targetPlatform !== 'win32' || extname(packageRoot).toLowerCase() !== '.exe') {
      throw new Error(`Windows portable smoke 只接受 .exe 文件：${packageRoot}`);
    }
    return packageRoot;
  }
  if (targetPlatform === 'win32') {
    const path = join(packageRoot, 'AI创作工作台.exe');
    if (!existsSync(path)) throw new Error(`未找到 Windows 打包程序：${path}`);
    return path;
  }

  const macExecutableRoot = join(packageRoot, 'Contents', 'MacOS');
  const preferred = join(macExecutableRoot, 'AI创作工作台');
  if (existsSync(preferred)) return preferred;
  const fallback = readdirSync(macExecutableRoot, { withFileTypes: true })
    .find((entry) => entry.isFile())?.name;
  if (!fallback) throw new Error(`未找到 macOS .app 可执行文件：${macExecutableRoot}`);
  return join(macExecutableRoot, fallback);
}

function exited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child, timeoutMs) {
  if (exited(child)) return Promise.resolve();
  return Promise.race([
    once(child, 'exit').then(() => undefined),
    new Promise((resolveExit) => setTimeout(resolveExit, timeoutMs))
  ]);
}

async function terminate(child) {
  if (exited(child)) return Promise.resolve();
  if (targetPlatform === 'win32' && child.pid) {
    await new Promise((resolveExit) => {
      execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => resolveExit());
    });
    await waitForExit(child, 4000);
    if (exited(child)) return;
  }
  try { child.kill('SIGTERM'); } catch { /* the process may have exited between checks */ }
  await waitForExit(child, 4000);
  if (!exited(child)) {
    try { child.kill('SIGKILL'); } catch { /* best effort */ }
    await waitForExit(child, 1500);
  }
}

function waitForHold(child, timeoutMs, getOutput) {
  return new Promise((resolveHold, reject) => {
    let timer;
    const onError = (error) => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      reject(error);
    };
    const onExit = (code, signal) => {
      clearTimeout(timer);
      child.removeListener('error', onError);
      reject(new Error(`打包程序提前退出：code=${code ?? 'null'} signal=${signal ?? 'none'}${getOutput() ? `\n${getOutput()}` : ''}`));
    };
    child.once('error', onError);
    child.once('exit', onExit);
    timer = setTimeout(() => {
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      resolveHold();
    }, timeoutMs);
  });
}

const executable = executablePath();
const smokeUserData = mkdtempSync(join(tmpdir(), 'aiwb-packaged-smoke-'));
const child = spawn(executable, [`--user-data-dir=${smokeUserData}`], {
  cwd: statSync(packageRoot).isFile() ? dirname(executable) : packageRoot,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, AIAM_SMOKE_PACKAGED: '1' },
  // Keep directory, portable and macOS bundle smoke runs out of the user's
  // normal Electron profile. This also makes a portable artifact test safe
  // to repeat on a machine that already has real account sessions.
});
let output = '';
const collect = (chunk) => { output = `${output}${chunk.toString('utf8')}`.slice(-4000); };
child.stdout?.on('data', collect);
child.stderr?.on('data', collect);

try {
  await waitForHold(child, holdSeconds * 1000, () => output);
  if (exited(child)) throw new Error(`打包程序在冒烟窗口结束前退出：code=${child.exitCode ?? 'null'} signal=${child.signalCode ?? 'none'}${output ? `\n${output}` : ''}`);
  console.log(`packaged smoke ok: ${basename(packageRoot)} ${targetPlatform}-${targetArch} stayed alive for ${holdSeconds}s`);
} finally {
  await terminate(child);
  try { rmSync(smokeUserData, { recursive: true, force: true }); } catch { /* best effort */ }
}
