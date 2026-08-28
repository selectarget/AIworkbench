import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const childScriptPath = fileURLToPath(new URL('./smoke-session-restart-child.mjs', import.meta.url));

function withTimeout(promise, label, milliseconds = 15000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function runChildPhase(phase, userData, url) {
  const require = createRequire(import.meta.url);
  const electronCli = require.resolve('electron/cli.js');
  const childEnv = {
    ...process.env,
    AIAM_SESSION_RESTART_PHASE: phase,
    AIAM_SESSION_RESTART_USER_DATA: userData,
    AIAM_SESSION_RESTART_URL: url
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;

  const child = spawn(process.execPath, [electronCli, childScriptPath], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const result = await withTimeout(new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  }), `Electron ${phase} phase`, 45000).catch((error) => {
    try { child.kill(); } catch { /* best effort */ }
    throw new Error(`${error.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  });

  if (result.code !== 0) {
    throw new Error(`Electron ${phase} phase failed with ${result.code ?? result.signal}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
}

async function runParent() {
  const userData = mkdtempSync(join(tmpdir(), 'aiam-session-restart-'));
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>session restart smoke</title><main>persistent session fixture</main>');
  });
  try {
    const port = await listen(server);
    const url = `http://127.0.0.1:${port}/`;
    console.log(`session restart smoke server listening on ${port}`);
    await runChildPhase('write', userData, url);
    console.log('session restart smoke write phase completed; starting a fresh Electron process');
    await runChildPhase('read', userData, url);
    console.log('session restart smoke ok: Cookie, LocalStorage, IndexedDB and CacheStorage persisted and remained isolated after restart');
  } finally {
    await new Promise((resolve) => server.close(() => resolve())).catch(() => undefined);
    try { rmSync(userData, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

await runParent();
