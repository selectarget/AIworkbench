import { createConnection, createServer } from 'node:net';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const root = resolve(process.cwd());
const workspaceRoot = join(tmpdir(), `aiam-proxy-runtime-${process.pid}`);
const suffix = process.platform === 'win32' ? '.exe' : '';
const executable = join(root, 'sing-box', `${process.platform}-${process.arch}`, `sing-box${suffix}`);

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

function canConnect(port) {
  return new Promise((resolveValue) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (value) => { socket.destroy(); resolveValue(value); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    setTimeout(() => finish(false), 800);
  });
}

async function waitForPort(port, expected, timeoutMs = 12000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if ((await canConnect(port)) === expected) return;
    await new Promise((resolveValue) => setTimeout(resolveValue, 120));
  }
  throw new Error(`port ${port} did not become ${expected ? 'available' : 'closed'}`);
}

function killTree(child) {
  if (!child.pid) return Promise.resolve();
  if (process.platform !== 'win32') {
    try { child.kill('SIGKILL'); } catch { /* already exited */ }
    return Promise.resolve();
  }
  return new Promise((resolveValue) => execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => resolveValue()));
}

function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return Promise.race([
    new Promise((resolveValue) => child.once('exit', resolveValue)),
    new Promise((resolveValue) => setTimeout(resolveValue, timeoutMs))
  ]);
}

async function startRuntime(name, port) {
  const workspace = join(workspaceRoot, name);
  mkdirSync(workspace, { recursive: true });
  const configPath = join(workspace, 'config.json');
  writeFileSync(configPath, `${JSON.stringify({ log: { level: 'error' }, inbounds: [{ type: 'socks', tag: 'account-in', listen: '127.0.0.1', listen_port: port }], outbounds: [{ type: 'direct', tag: 'node-direct' }], route: { final: 'node-direct' } }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  const child = spawn(executable, ['run', '-c', configPath], { cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostic = '';
  child.stderr?.on('data', (chunk) => { diagnostic = `${diagnostic}${chunk.toString('utf8')}`.slice(-2000); });
  child.stdout?.on('data', (chunk) => { diagnostic = `${diagnostic}${chunk.toString('utf8')}`.slice(-2000); });
  try { await waitForPort(port, true); } catch (error) { await killTree(child); await waitForExit(child); throw new Error(`${error instanceof Error ? error.message : String(error)}${diagnostic ? `: ${diagnostic}` : ''}`); }
  return { child, port, workspace };
}

if (!existsSync(executable)) throw new Error(`missing sing-box executable: ${executable}`);

let first;
let second;
try {
  const [firstPort, secondPort] = await Promise.all([freePort(), freePort()]);
  first = await startRuntime('account-a', firstPort);
  second = await startRuntime('account-b', secondPort);
  if (first.port === second.port || first.child.pid === second.child.pid) throw new Error(`runtime identity collision: ${JSON.stringify({ first: first.child.pid, second: second.child.pid })}`);
  await killTree(first.child);
  await waitForExit(first.child);
  await waitForPort(first.port, false);
  if (!(await canConnect(second.port))) throw new Error('stopping account A affected account B');
  await killTree(second.child);
  await waitForExit(second.child);
  await waitForPort(second.port, false);
  console.log(`proxy runtime isolation ok: ports ${first.port}/${second.port}, PIDs ${first.child.pid}/${second.child.pid}`);
} finally {
  if (first) { await killTree(first.child); await waitForExit(first.child); }
  if (second) { await killTree(second.child); await waitForExit(second.child); }
  try { rmSync(workspaceRoot, { recursive: true, force: true }); } catch { /* best effort */ }
}
